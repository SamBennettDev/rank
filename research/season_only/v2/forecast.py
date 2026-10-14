"""Use V2 weights with causal statistics and optional published availability."""
import argparse
import json
from pathlib import Path
import numpy as np
import pandas as pd
from common import INPUT,OUT,PARENT
from data import load,week6,LAG
from prepare import INPUT as OLD_INPUT
from graph_build import graph_features
from context_features import addon_features
from model import FEATURE_SETS,combine,predict,load_model
from availability import validate as validate_events,adjust_features

def v1_probability(graph,home,away,venue,year=2026):
    from rich_evaluate import model_probability
    from graph_evaluate import probability as gp
    rh=graph[home,:64];ra=graph[away,:64]
    rm=json.loads((PARENT/'results/rich-rolling-models'/f'{year}.json').read_text());gm=json.loads((PARENT/'results/graph-rolling-models'/f'{year}.json').read_text())
    return .75*model_probability(rm,rh,ra,venue)+.25*gp(gm,graph[home],graph[away],venue)

def probability(obj,x,home,away,venue,baseline_graph=None):
    p=predict(obj,x[home],x[away],venue)
    if baseline_graph is None:return p
    policy=json.loads((OUT/'blend-selection.json').read_text())['chosen']
    if policy['gate']=='constant' and policy['v2_weight']==1.:return p
    from blend import mix
    old=v1_probability(baseline_graph,home,away,venue,obj['year'])
    return mix(p,old,x[home],x[away],policy)

def selected_feature():
    return json.loads((OUT/'selection.json').read_text())['chosen']['settings']['feature_set']

def snapshot(year=2026,week=6,as_of=None):
    s=load(year)
    if as_of is not None:
        cut=pd.Timestamp(as_of)
        if cut.tzinfo is None:raise ValueError('--as-of requires an explicit UTC offset')
        cutoff=cut.timestamp();tr=np.flatnonzero(s.games.time+LAG<=cutoff)
    elif week==6:cutoff,tr,_=week6(s)
    else:
        prior=s.games.season_type.eq('regular')&s.games.week.le(week)
        if not prior.any():raise ValueError('No completed games through this week')
        cutoff=float((s.games.time[prior]+LAG).max());tr=np.flatnonzero(prior&(s.games.time+LAG<=cutoff))
    rich=pd.read_csv(OLD_INPUT/f'rich_{year}.csv');context=pd.read_csv(INPUT/f'context_{year}.csv');players=pd.read_csv(INPUT/f'players_{year}.csv')
    graph=graph_features(s,tr,rich);extra=addon_features(s,tr,context,players,cutoff)
    arrays={kind:combine(graph[:,:64],graph,extra,kind) for kind in FEATURE_SETS}
    arrays['v1_graph']=graph
    return s,cutoff,tr,players,arrays

def events():
    paths=[INPUT/'availability_events.csv',INPUT/'imported_availability.csv']
    frames=[pd.read_csv(p) for p in paths if p.exists()]
    return validate_events(pd.concat(frames,ignore_index=True))

def matchup(obj,s,x,tr,players,cutoff,home,away,neutral=False,game_id=None,with_availability=True,availability_events=None,baseline_graph=None):
    v=np.array([0. if neutral else 1.]);feature=obj['settings']['feature_set']
    calculate=lambda xx:float(probability(obj,xx,np.array([home]),np.array([away]),v,baseline_graph)[0])
    baseline=calculate(x);result=dict(base_probability=baseline,probability=baseline,availability_reports=[],
        availability_supported=feature in ['full','graph_context'])
    if with_availability:
        report=events() if availability_events is None else availability_events
        xx,audit=adjust_features(x,feature,s,tr,players,report,cutoff,game_id)
        result['probability']=calculate(xx);result['availability_reports']=[r for r in audit if r['team_id'] in [int(s.ids[home]),int(s.ids[away])]]
        if any(r['status'] in ['probable','questionable','doubtful'] for r in result['availability_reports']):
            probabilities=[]
            for scenario in ['available','out']:
                changed,_=adjust_features(x,feature,s,tr,players,report,cutoff,game_id,scenario)
                probabilities.append(calculate(changed))
            result['availability_scenario_interval']=[min(probabilities),max(probabilities)]
    return result

def ranking(obj,s,x,field='fbs',baseline_graph=None):
    n=s.n;h=np.repeat(np.arange(n),n);a=np.tile(np.arange(n),n)
    p=probability(obj,x,h,a,np.zeros(n*n),baseline_graph);strength=p.reshape(n,n).mean(1)
    eligible=np.flatnonzero(s.fbs if field=='fbs' else np.ones(n,bool));order=eligible[np.argsort(-strength[eligible],kind='stable')]
    return [dict(rank=pos,team_id=int(s.ids[i]),team=s.names[i],score=float(strength[i])) for pos,i in enumerate(order,1)]

def export_rankings():
    s,cut,tr,players,data=snapshot();rows=[]
    for feature in FEATURE_SETS:
        obj=load_model(OUT/'models'/f'{feature}_2026.json.gz')
        x,audit=adjust_features(data[feature],feature,s,tr,players,events(),cut)
        for field in ['fbs','fbs_fcs']:
            for row in ranking(obj,s,x,field):rows.append(dict(method='v2_'+feature,field=field,**row))
    frame=pd.DataFrame(rows);chosen=selected_feature();obj=load_model(OUT/'models'/f'{chosen}_2026.json.gz')
    x,_=adjust_features(data[chosen],chosen,s,tr,players,events(),cut)
    alias=pd.DataFrame([dict(method='v2_recommended',field=field,**row) for field in ['fbs','fbs_fcs']
        for row in ranking(obj,s,x,field,data['v1_graph'])])
    pd.concat([frame,alias],ignore_index=True).to_csv(OUT/'week6-2026-rankings.csv',index=False,float_format='%.10f')
    print('Exported V2 Week 6 rankings for all feature variants',flush=True)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--year',type=int,default=2026);parser.add_argument('--week',type=int,default=6)
    parser.add_argument('--as-of');parser.add_argument('--model',choices=['recommended']+FEATURE_SETS,default='recommended')
    parser.add_argument('--home');parser.add_argument('--away');parser.add_argument('--neutral',action='store_true')
    parser.add_argument('--game-id',type=int);parser.add_argument('--field',choices=['fbs','fbs_fcs'],default='fbs')
    parser.add_argument('--export-rankings',action='store_true');args=parser.parse_args()
    if args.export_rankings:export_rankings();return
    if bool(args.home)!=bool(args.away):parser.error('--home and --away are required together')
    feature=selected_feature() if args.model=='recommended' else args.model
    obj=load_model(OUT/'models'/f'{feature}_{args.year}.json.gz');s,cut,tr,players,data=snapshot(args.year,args.week,args.as_of)
    result=dict(model=feature,as_of=pd.Timestamp(cut,unit='s',tz='UTC').isoformat(),training_years=obj['training_years'])
    if args.home:
        lookup={name.lower():i for i,name in enumerate(s.names)};lookup.update({str(t):i for i,t in enumerate(s.ids)})
        try:h,a=lookup[args.home.lower()],lookup[args.away.lower()]
        except KeyError as e:parser.error('Unknown team: '+str(e))
        result.update(home=s.names[h],away=s.names[a],**matchup(obj,s,data[feature],tr,players,cut,h,a,args.neutral,args.game_id,
            baseline_graph=data['v1_graph'] if args.model=='recommended' else None))
    else:
        x,audit=adjust_features(data[feature],feature,s,tr,players,events(),cut)
        result.update(field=args.field,rankings=ranking(obj,s,x,args.field,data['v1_graph'] if args.model=='recommended' else None),availability_reports=audit)
    print(json.dumps(result,indent=2))

if __name__=='__main__':main()
