"""Annual, price-free inference after training on past outcomes and market targets."""
import json
from concurrent.futures import ProcessPoolExecutor
import numpy as np
import pandas as pd
from scipy.special import expit
from teacher_train import settings
from rich_train import read_rich
from graph_train import read_graph
from rich_build import RICH_CACHE
from graph_build import GRAPH_CACHE
from build import OUT,CACHE
from prepare import INPUT
from train import primary
from neural import Network
from evaluate import metrics,calibrate,paired

def fit_year(year):
    selection=json.loads((OUT/'teacher-selection.json').read_text());cfg=selection['chosen']['settings']
    read=read_rich if cfg['feature_set']=='rich' else read_graph;cache=RICH_CACHE if cfg['feature_set']=='rich' else GRAPH_CACHE
    meta,data=read(list(range(2006,year)));mask=primary(meta).to_numpy();meta=meta[mask].reset_index(drop=True);data={k:v[mask] for k,v in data.items()}
    actual=meta.y.to_numpy();odds=pd.read_csv(INPUT/'odds.csv').set_index('game_id').moneyline_p;market=meta.game_id.map(odds).to_numpy()
    alpha=cfg['teacher_alpha'];target=np.where(np.isfinite(market),(1-alpha)*actual+alpha*market,actual)
    scale=np.maximum(np.std(np.r_[data['xh'],data['xa']],axis=0),.01);weights=2**((meta.year.to_numpy()-meta.year.max())/4)
    forecast=pd.read_csv(CACHE/f'{year}.csv');x=np.load(cache/f'{year}.npz');models=[];tz=[];fz=[]
    for seed in [7,19,43]:
        params={k:cfg[k] for k in ['kind','width','ridge']}
        net=Network(**params,auxiliary=.03,seed=seed,scale=scale).fit(data['xh'],data['xa'],meta.venue.to_numpy(),target,meta.margin.to_numpy(),
            maxiter=selection['optimizer_budget']['maxiter'],sample_weights=weights,optimizer_memory=selection['optimizer_budget']['optimizer_memory'])
        models.append(net.asdict());tz.append(net.logits(data['xh'],data['xa'],meta.venue.to_numpy()));fz.append(net.logits(x['xh'],x['xa'],forecast.venue.to_numpy()))
    z=np.mean(tz,axis=0);b,mb=calibrate(z,np.zeros(len(z)),actual,meta.margin.to_numpy())
    obj=dict(year=year,feature_set=cfg['feature_set'],training_years=list(range(2006,year)),training_games=len(meta),
        training_market_games=int(np.isfinite(market).sum()),models=models,temperature=float(b[0]),margin_scale=float(mb[0]),teacher_alpha=alpha)
    (OUT/'teacher-rolling-models'/f'{year}.json').write_text(json.dumps(obj,separators=(',',':'))+'\n')
    np.save(CACHE/f'teacher_predictions_{year}.npy',expit(np.mean(fz,axis=0)*b[0]))
    print('Historical-market supervised refit',year,len(meta),'past games',flush=True)

def probability(obj,h,a,v):
    z=np.mean([Network.fromdict(m).logits(h,a,v) for m in obj['models']],axis=0)
    return expit(z*obj['temperature'])

def evaluate():
    base=pd.read_csv(OUT/'predictions.csv.gz',low_memory=False);graph=pd.read_csv(OUT/'graph-predictions.csv.gz');p=np.full(len(base),np.nan)
    for yr in range(2007,2027):p[base.year.eq(yr)]=np.load(CACHE/f'teacher_predictions_{yr}.npy')
    validation=primary(base)&base.year.isin([2018,2019]);design=[]
    for alpha in [0.,.25,.5,.75,1.]:
        q=alpha*p[validation]+(1-alpha)*graph.loc[validation,'p_graph_ensemble'].to_numpy()
        design.append(dict(alpha=alpha,validation=metrics(base.y[validation],q)))
    blend=min(design,key=lambda c:(-c['validation']['accuracy'],c['validation']['log_loss']))
    (OUT/'teacher-blend-selection.json').write_text(json.dumps(dict(**blend,design=design),indent=2)+'\n')
    mix=blend['alpha']*p+(1-blend['alpha'])*graph.p_graph_ensemble.to_numpy()
    result=dict(blend=blend,overall={},paired={},season_market_comparison=[],cfp={});annual=[]
    for mode in ['weekly','frozen_week6']:
        main=(base['mode']==mode)&base.fbs&base.year.between(2020,2025)
        result['overall'][mode]=dict(market_distilled_neural=metrics(base.y[main],p[main]),market_distilled_ensemble=metrics(base.y[main],mix[main]))
        for comparator in ['moneyline_market','spread_market','massey','gradient_boosting']:
            mask=main&base['p_'+comparator].notna()
            for model,prob in [('market_distilled_neural',p),('market_distilled_ensemble',mix)]:
                result['paired'][mode+':'+model+':vs:'+comparator]=dict(neural=metrics(base.y[mask],prob[mask]),
                    benchmark=metrics(base.y[mask],base.loc[mask,'p_'+comparator]),comparison=paired(base.y[mask],prob[mask],base.loc[mask,'p_'+comparator],base.year[mask]))
    for year in range(2007,2027):
        for mode in ['weekly','frozen_week6']:
            main=(base['mode']==mode)&base.fbs&base.year.eq(year)
            if main.sum():
                for model,prob in [('market_distilled_neural',p),('market_distilled_ensemble',mix)]:annual.append(dict(year=year,mode=mode,method=model,**metrics(base.y[main],prob[main])))
            if mode!='weekly':continue
            for market in ['moneyline_market','spread_market']:
                mask=main&base['p_'+market].notna()
                if not mask.sum():continue
                m=metrics(base.y[mask],mix[mask]);b=metrics(base.y[mask],base.loc[mask,'p_'+market])
                result['season_market_comparison'].append(dict(year=year,market=market,neural=m,benchmark=b,accuracy_difference=m['accuracy']-b['accuracy']))
    for both in [False,True]:
        mask=primary(base)&base.year.between(2020,2025)&base.cfp_pick.notna()
        if both:mask&=base.cfp_both_ranked
        y=base.y[mask].to_numpy();cp=base.cfp_pick[mask].to_numpy();comparison=paired(y,mix[mask],cp,base.year[mask]);comparison.pop('log_loss_difference');comparison.pop('log_loss_95_interval')
        result['cfp']['both_ranked' if both else 'at_least_one_ranked']=dict(games=int(mask.sum()),neural=metrics(y,mix[mask]),cfp_accuracy=float(np.where(cp==.5,.5,cp==y).mean()),comparison=comparison)
    extra=base[['year','game_id','mode','y','fbs']].copy();extra['p_market_distilled_neural']=p;extra['p_market_distilled_ensemble']=mix
    extra.to_csv(OUT/'teacher-predictions.csv.gz',index=False,float_format='%.10f',compression=dict(method='gzip',mtime=0))
    pd.DataFrame(annual).to_csv(OUT/'teacher-season-metrics.csv',index=False,float_format='%.10f')
    (OUT/'teacher-evaluation.json').write_text(json.dumps(result,indent=2)+'\n')
    obj=json.loads((OUT/'teacher-rolling-models/2026.json').read_text());cache=RICH_CACHE if obj['feature_set']=='rich' else GRAPH_CACHE
    x=np.load(cache/'2026.npz')['snapshot_x'];old=np.load(CACHE/'2026.npz');n=len(x);h=np.repeat(x,n,axis=0);a=np.tile(x,(n,1));v=np.zeros(n*n)
    pt=probability(obj,h,a,v)
    from graph_evaluate import probability as gp
    from rich_evaluate import model_probability as rp
    gx=np.load(GRAPH_CACHE/'2026.npz')['snapshot_x'];gh=np.repeat(gx,n,axis=0);ga=np.tile(gx,(n,1))
    pg=gp(json.loads((OUT/'graph-rolling-models/2026.json').read_text()),gh,ga,v)
    pr=rp(json.loads((OUT/'rich-rolling-models/2026.json').read_text()),gh[:,:64],ga[:,:64],v)
    gmix=json.loads((OUT/'graph-blend-selection.json').read_text())['alpha'];oldmix=gmix*pg+(1-gmix)*pr
    final=blend['alpha']*pt+(1-blend['alpha'])*oldmix
    rankings=pd.read_csv(OUT/'week6-2026-rankings.csv');rankings=rankings[~rankings.method.isin(['market_distilled_neural','market_distilled_ensemble'])];rows=[]
    for model,prob in [('market_distilled_neural',pt),('market_distilled_ensemble',final)]:
        score=prob.reshape(n,n).mean(1)
        for field,mask in [('fbs',old['fbs']),('fbs_fcs',np.ones(n,bool))]:
            ix=np.flatnonzero(mask);order=ix[np.argsort(-score[ix],kind='stable')]
            for pos,i in enumerate(order,1):rows.append(dict(method=model,field=field,rank=pos,team_id=int(old['team_ids'][i]),team=str(old['team_names'][i]),score=float(score[i])))
    pd.concat([rankings,pd.DataFrame(rows)],ignore_index=True).to_csv(OUT/'week6-2026-rankings.csv',index=False,float_format='%.10f')
    print('MARKET-SUPERVISED DEVELOPMENT',json.dumps(result['overall'],indent=2),flush=True)
    print('MARKET-SUPERVISED MATCHED MONEYLINES',json.dumps(result['paired']['weekly:market_distilled_ensemble:vs:moneyline_market'],indent=2),flush=True)

if __name__=='__main__':
    (OUT/'teacher-rolling-models').mkdir(exist_ok=True)
    with ProcessPoolExecutor(max_workers=3) as pool:
        for result in pool.map(fit_year,range(2007,2027)):pass
    evaluate()
