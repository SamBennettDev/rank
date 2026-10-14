"""Evaluate frozen selections on matched games; save the exact predictions."""
import json,re,pickle
import numpy as np
import pandas as pd
from scipy.special import expit,logit
from prepare import HERE,INPUT,YEARS,digest
from build import OUT,CACHE
from train import read_years,primary,tree_inputs
from neural import Network
from rolling import predict
from evaluate import metrics,paired

def normal(s):
    x=re.sub('[^a-z0-9]','',str(s).lower())
    return {'southerncalifornia':'usc','mississippi':'olemiss','miamifl':'miami','louisianalafayette':'louisiana'}.get(x,x)

def cfp_predictions(meta):
    result=np.full(len(meta),np.nan);both=np.zeros(len(meta),bool);release=np.full(len(meta),'',object)
    tables=json.loads((INPUT/'cfp.json').read_text())+json.loads((INPUT/'cfp-earlier.json').read_text())
    for table in tables:
        year=table['year'];ix=np.flatnonzero((meta.year==year) & (meta['mode']=='weekly'))
        # Publication assumed available Wednesday 01:00 UTC; Selection Sunday 20:00 UTC.
        times=[]
        for j,date in enumerate(table['dates']):
            ts=pd.Timestamp(f'{year}-{date}T00:00:00Z')
            times.append((ts+pd.Timedelta(hours=20) if j==len(table['dates'])-1 else ts+pd.Timedelta(days=1,hours=1)).timestamp())
        for i in ix:
            t=pd.Timestamp(meta.start_date.iloc[i]).timestamp()
            available=[j for j,dt in enumerate(times) if dt<t]
            if not available:continue
            j=available[-1]
            ranks={normal(r['team']):r['ranks'][j] for r in table['rows'] if r['ranks'][j] is not None}
            h=ranks.get(normal(meta.home_name.iloc[i]),26);a=ranks.get(normal(meta.away_name.iloc[i]),26)
            if h==26 and a==26:continue
            result[i]=1. if h<a else 0. if h>a else .5
            both[i]=h<26 and a<26;release[i]=pd.Timestamp(times[j],unit='s',tz='UTC').isoformat()
    return result,both,release

def all_predictions():
    selection=json.loads((OUT/'selection.json').read_text())
    meta,data=read_years(YEARS+[2026]);odds=pd.read_csv(INPUT/'odds.csv')
    meta=meta.merge(odds,on='game_id',how='left',validate='many_to_one',sort=False)
    models=json.loads((OUT/'selected-network.json').read_text())
    nets=[Network.fromdict(m) for m in models['models']]
    z=np.mean([n.logits(data['xh'],data['xa'],meta.venue.to_numpy()) for n in nets],axis=0)
    pred={'neural_frozen':expit(z*models['temperature'])};margins={}
    pred['neural_annual']=np.full(len(meta),np.nan)
    pred['logistic_features']=np.full(len(meta),np.nan)
    pred['gradient_boosting']=np.full(len(meta),np.nan);pred['extra_trees']=np.full(len(meta),np.nan)
    methods=json.loads((OUT/'methods.json').read_text())
    for family in selection['statistical_indices']:pred[family]=np.zeros(len(meta));margins[family]=np.zeros(len(meta))
    margins['neural_annual']=np.full(len(meta),np.nan)
    for yr in sorted(meta.year.unique()):
        ix=np.flatnonzero(meta.year==yr)
        obj=json.loads((OUT/'rolling-models'/f'{yr}.json').read_text()) if yr>=2007 else None
        calibration=obj['statistical_calibration'] if obj else selection['calibration']
        for family,j in selection['statistical_indices'].items():
            b=calibration[j]['probability'];mb=calibration[j]['margin']
            edge=data['rh'][ix,j]-data['ra'][ix,j];venue=meta.venue.iloc[ix].to_numpy()*data['hfa'][ix]
            pred[family][ix]=expit(b[0]*edge+b[1]*venue);margins[family][ix]=mb[0]*edge+mb[1]*venue
        if obj:
            n,l,pm=predict(obj,data['xh'][ix],data['xa'][ix],meta.venue.iloc[ix].to_numpy())
            pred['neural_annual'][ix]=n;pred['logistic_features'][ix]=l;margins['neural_annual'][ix]=pm
            learned=np.load(CACHE/f'rolling_learners_{yr}.npz')
            for name in ['gradient_boosting','extra_trees']:pred[name][ix]=learned[name]
    ensemble=selection['ensemble'];alpha=ensemble['alpha']
    if ensemble['component']:
        component=ensemble['component'].split(':')[1]
        pred['neural_ensemble']=alpha*pred['neural_annual']+(1-alpha)*pred[component]
    else:pred['neural_ensemble']=pred['neural_annual'].copy()
    pred['moneyline_market']=meta.moneyline_p.to_numpy()
    # Spread-to-win calibration is trained solely on archived design-year odds.
    mask=(meta.year<2020)&(meta.year>=2007)&primary(meta)&meta.spread_margin.notna()
    b,_=__import__('evaluate').calibrate(meta.loc[mask,'spread_margin'].to_numpy(),np.zeros(mask.sum()),meta.loc[mask,'y'].to_numpy(),meta.loc[mask,'margin'].to_numpy())
    pred['spread_market']=expit(meta.spread_margin.to_numpy()*b[0]);margins['spread_market']=meta.spread_margin.to_numpy()
    cfp,both,release=cfp_predictions(meta)
    meta['cfp_pick']=cfp;meta['cfp_both_ranked']=both;meta['cfp_available_at']=release
    # Published CFBD pregame Elo is an external historical benchmark, never a feature.
    elo={}
    for yr in YEARS:
        g=pd.read_csv(INPUT/f'games_{yr}.csv')
        for row in g.itertuples():
            if pd.notna(row.home_pregame_elo) and pd.notna(row.away_pregame_elo):elo[int(row.game_id)]=row.home_pregame_elo-row.away_pregame_elo
    meta['cfbd_elo_edge']=meta.game_id.map(elo)
    pred['cfbd_pregame_elo']=expit((meta.cfbd_elo_edge.to_numpy()+meta.venue.to_numpy()*55)*np.log(10)/400)
    return selection,meta,data,pred,margins

def summary_report(selection,meta,pred,margins):
    results={};per_year=[];paired_results={};cohorts={}
    for mode in ['weekly','frozen_week6']:
        for phase,years in [('training',range(2002,2014)),('validation',range(2014,2020)),('development',range(2020,2026)),('current_2026',[2026])]:
            base=(meta['mode']==mode)&meta.fbs.astype(bool)&meta.year.isin(years)
            key=f'{mode}:{phase}';results[key]={}
            for name,p in pred.items():
                mask=base&np.isfinite(p)
                if mask.sum()==0:continue
                pm=margins.get(name)
                results[key][name]=metrics(meta.y[mask],p[mask],meta.margin[mask] if pm is not None else None,pm[mask] if pm is not None else None)
        for yr in YEARS+[2026]:
            base=(meta['mode']==mode)&meta.fbs.astype(bool)&meta.year.eq(yr)
            for name,p in pred.items():
                mask=base&np.isfinite(p)
                if not mask.sum():continue
                per_year.append(dict(year=yr,mode=mode,method=name,**metrics(meta.y[mask],p[mask])))
        base=(meta['mode']==mode)&meta.fbs.astype(bool)&meta.year.between(2020,2025)
        for opponent in ['moneyline_market','spread_market','massey','success_margin','gradient_boosting','cfbd_pregame_elo']:
            for nn in ['neural_annual','neural_ensemble']:
                mask=base&np.isfinite(pred[nn])&np.isfinite(pred[opponent])
                if not mask.sum():continue
                key=f'{mode}:{nn}:vs:{opponent}'
                paired_results[key]=dict(neural=metrics(meta.y[mask],pred[nn][mask]),benchmark=metrics(meta.y[mask],pred[opponent][mask]),
                    comparison=paired(meta.y[mask],pred[nn][mask],pred[opponent][mask],meta.year[mask]))
    # Same-game cohort comparisons: complete probabilities for every listed participant.
    for name,mask in [
        ('moneyline_2020_2025',primary(meta)&meta.year.between(2020,2025)&np.isfinite(pred['moneyline_market'])),
        ('spread_2020_2025',primary(meta)&meta.year.between(2020,2025)&np.isfinite(pred['spread_market'])),
        ('moneyline_2007_2025_hindcast',primary(meta)&meta.year.between(2007,2025)&np.isfinite(pred['moneyline_market']))]:
        cohorts[name]={method:metrics(meta.y[mask],p[mask]) for method,p in pred.items() if np.isfinite(p[mask]).all()}
    cfp={}
    for scope,years in [('development',range(2020,2026)),('all_available_hindcast',range(2014,2026))]:
        for label,both in [('at_least_one_ranked',False),('both_ranked',True)]:
            mask=primary(meta)&meta.year.isin(years)&meta.cfp_pick.notna()
            if both:mask&=meta.cfp_both_ranked
            c=meta.loc[mask,'cfp_pick'].to_numpy();y=meta.y[mask].to_numpy()
            accuracy=float(np.where(c==.5,.5,c==y).mean())
            values=dict(games=int(mask.sum()),cfp_accuracy=accuracy,models={})
            for method in ['neural_annual','neural_ensemble','massey','success_margin','gradient_boosting']:
                values['models'][method]=metrics(y,pred[method][mask])
            market_mask=mask&np.isfinite(pred['moneyline_market'])
            values['moneyline_matched_games']=int(market_mask.sum())
            values['moneyline_market']=metrics(meta.y[market_mask],pred['moneyline_market'][market_mask])
            values['neural_ensemble_on_moneyline_games']=metrics(meta.y[market_mask],pred['neural_ensemble'][market_mask])
            c2=meta.cfp_pick[market_mask].to_numpy();y2=meta.y[market_mask].to_numpy()
            values['cfp_accuracy_on_moneyline_games']=float(np.where(c2==.5,.5,c2==y2).mean())
            cfp[f'{scope}:{label}']=values
    table=pd.DataFrame(per_year);table.to_csv(OUT/'season-metrics.csv',index=False,float_format='%.10f')
    years_comparison=[]
    for year in range(2007,2026):
        for market in ['moneyline_market','spread_market']:
            mask=primary(meta)&meta.year.eq(year)&np.isfinite(pred[market])
            if not mask.sum():continue
            neural=metrics(meta.y[mask],pred['neural_ensemble'][mask]);benchmark=metrics(meta.y[mask],pred[market][mask])
            years_comparison.append(dict(year=year,market=market,neural=neural,benchmark=benchmark,accuracy_difference=neural['accuracy']-benchmark['accuracy']))
    return dict(selection_sha256=digest(OUT/'selection.json'),protocol=selection['protocol'],counts=selection['counts'],
        overall=results,matched_cohorts=cohorts,paired=paired_results,cfp=cfp,season_market_comparison=years_comparison)

def rank_current(selection):
    data=np.load(CACHE/'2026.npz');obj=json.loads((OUT/'rolling-models/2026.json').read_text())
    x=data['snapshot_x'];n=len(x);h=np.repeat(x,n,axis=0);a=np.tile(x,(n,1));v=np.zeros(n*n)
    nn,linear,_=predict(obj,h,a,v);ensemble=selection['ensemble']['alpha']*nn+(1-selection['ensemble']['alpha'])*linear
    scores={}
    for family,j in selection['statistical_indices'].items():scores[family]=data['snapshot_scores'][:,j]
    scores['neural_annual']=nn.reshape(n,n).mean(1);scores['logistic_features']=linear.reshape(n,n).mean(1)
    scores['neural_ensemble']=ensemble.reshape(n,n).mean(1)
    for family in ['gradient_boosting','extra_trees']:
        with open(CACHE/f'{family}_2026.pkl','rb') as f:model=pickle.load(f)
        t,ts=tree_inputs(h,a,v,np.array(obj['linear']['scale']))
        p=(model.predict_proba(t)[:,1]+1-model.predict_proba(ts)[:,1])/2
        scores[family]=p.reshape(n,n).mean(1)
    ranks=[]
    for method,strength in scores.items():
        for field,mask in [('fbs',data['fbs']),('fbs_fcs',np.ones(n,bool))]:
            index=np.flatnonzero(mask);order=index[np.argsort(-strength[index],kind='stable')]
            positions=dict(zip(index,pd.Series(strength[index]).round(10).rank(method='min',ascending=False).astype(int)))
            for i in order:ranks.append(dict(method=method,field=field,rank=positions[i],team_id=int(data['team_ids'][i]),team=str(data['team_names'][i]),score=float(strength[i])))
    ranking=pd.DataFrame(ranks);ranking.to_csv(OUT/'week6-2026-rankings.csv',index=False,float_format='%.10f')
    methods=json.loads((OUT/'methods.json').read_text())
    allranks=[]
    for j,m in enumerate(methods):
        strength=data['snapshot_scores'][:,j];index=np.flatnonzero(data['fbs']);order=index[np.argsort(-strength[index],kind='stable')]
        positions=dict(zip(index,pd.Series(strength[index]).round(10).rank(method='min',ascending=False).astype(int)))
        for i in order:allranks.append(dict(method=m['name'],rank=positions[i],team_id=int(data['team_ids'][i]),team=str(data['team_names'][i]),score=float(strength[i])))
    pd.DataFrame(allranks).to_csv(OUT/'week6-all-statistical-configurations.csv',index=False,float_format='%.10f')
    return ranking

def main():
    selection,meta,data,pred,margins=all_predictions()
    report=summary_report(selection,meta,pred,margins)
    (OUT/'evaluation.json').write_text(json.dumps(report,indent=2)+'\n')
    out=meta.copy()
    for name,p in pred.items():out['p_'+name]=p
    for name,p in margins.items():out['margin_'+name]=p
    out.to_csv(OUT/'predictions.csv.gz',index=False,float_format='%.10f',compression=dict(method='gzip',mtime=0))
    rank_current(selection)
    print(json.dumps(report['overall']['weekly:development'],indent=2),flush=True)
    print('MATCHED MONEYLINES',json.dumps(report['matched_cohorts']['moneyline_2020_2025'],indent=2),flush=True)

if __name__=='__main__':main()
