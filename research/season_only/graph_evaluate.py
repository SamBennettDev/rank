"""Annual graph-neural forecasts and common-game comparisons."""
import json
from concurrent.futures import ProcessPoolExecutor
import numpy as np
import pandas as pd
from scipy.special import expit
from graph_train import read_graph
from graph_build import GRAPH_CACHE
from build import OUT,CACHE
from train import primary
from neural import Network
from evaluate import metrics,calibrate,paired

def fit_year(year):
    selection=json.loads((OUT/'graph-selection.json').read_text());meta,data=read_graph(list(range(2006,year)))
    mask=primary(meta).to_numpy();meta=meta[mask].reset_index(drop=True);data={k:v[mask] for k,v in data.items()}
    scale=np.maximum(np.std(np.r_[data['xh'],data['xa']],axis=0),.01);weights=2**((meta.year.to_numpy()-meta.year.max())/4)
    test=pd.read_csv(CACHE/f'{year}.csv');x=np.load(GRAPH_CACHE/f'{year}.npz');models=[];tz=[];fz=[]
    for seed in [7,19,43]:
        net=Network(**selection['chosen']['settings'],seed=seed,scale=scale).fit(data['xh'],data['xa'],meta.venue.to_numpy(),meta.y.to_numpy(),meta.margin.to_numpy(),maxiter=350,sample_weights=weights)
        models.append(net.asdict());tz.append(net.logits(data['xh'],data['xa'],meta.venue.to_numpy()));fz.append(net.logits(x['xh'],x['xa'],test.venue.to_numpy()))
    z=np.mean(tz,axis=0);b,mb=calibrate(z,np.zeros(len(z)),meta.y.to_numpy(),meta.margin.to_numpy())
    obj=dict(year=year,training_years=list(range(2006,year)),training_games=len(meta),models=models,temperature=float(b[0]),margin_scale=float(mb[0]))
    (OUT/'graph-rolling-models'/f'{year}.json').write_text(json.dumps(obj,separators=(',',':'))+'\n')
    np.save(CACHE/f'graph_predictions_{year}.npy',expit(np.mean(fz,axis=0)*b[0]))
    print('Graph annual refit',year,len(meta),'past games',flush=True)

def probability(obj,h,a,v):
    z=np.mean([Network.fromdict(m).logits(h,a,v) for m in obj['models']],axis=0)
    return expit(z*obj['temperature'])

def evaluate():
    base=pd.read_csv(OUT/'predictions.csv.gz',low_memory=False);rich=pd.read_csv(OUT/'rich-predictions.csv.gz')
    p=np.full(len(base),np.nan)
    for yr in range(2007,2027):p[base.year.eq(yr)]=np.load(CACHE/f'graph_predictions_{yr}.npy')
    validation=primary(base)&base.year.isin([2018,2019]);combinations=[]
    for alpha in [0.,.25,.5,.75,1.]:
        q=alpha*p[validation]+(1-alpha)*rich.loc[validation,'p_rich_neural'].to_numpy()
        combinations.append(dict(alpha=alpha,validation=metrics(base.y[validation],q)))
    blend=min(combinations,key=lambda x:(-x['validation']['accuracy'],x['validation']['log_loss']))
    (OUT/'graph-blend-selection.json').write_text(json.dumps(dict(**blend,design=combinations),indent=2)+'\n')
    mix=blend['alpha']*p+(1-blend['alpha'])*rich.p_rich_neural.to_numpy()
    report=dict(blend=blend,overall={},paired={},season_market_comparison=[],cfp={});annual=[]
    for mode in ['weekly','frozen_week6']:
        main=(base['mode']==mode)&base.fbs&base.year.between(2020,2025)
        report['overall'][mode]=dict(graph_neural=metrics(base.y[main],p[main]),graph_ensemble=metrics(base.y[main],mix[main]))
        for competitor in ['moneyline_market','spread_market','massey','gradient_boosting','rich_neural']:
            q=rich.p_rich_neural.to_numpy() if competitor=='rich_neural' else base['p_'+competitor].to_numpy()
            mask=main&np.isfinite(q)
            for model,probs in [('graph_neural',p),('graph_ensemble',mix)]:
                report['paired'][mode+':'+model+':vs:'+competitor]=dict(neural=metrics(base.y[mask],probs[mask]),
                    benchmark=metrics(base.y[mask],q[mask]),comparison=paired(base.y[mask],probs[mask],q[mask],base.year[mask]))
    for year in range(2007,2027):
        for mode in ['weekly','frozen_week6']:
            main=(base['mode']==mode)&base.fbs&base.year.eq(year)
            if main.sum():
                for model,probs in [('graph_neural',p),('graph_ensemble',mix)]:annual.append(dict(year=year,mode=mode,method=model,**metrics(base.y[main],probs[main])))
            if mode!='weekly':continue
            for market in ['moneyline_market','spread_market']:
                mask=main&base['p_'+market].notna()
                if not mask.sum():continue
                m=metrics(base.y[mask],mix[mask]);b=metrics(base.y[mask],base.loc[mask,'p_'+market])
                report['season_market_comparison'].append(dict(year=year,market=market,neural=m,benchmark=b,accuracy_difference=m['accuracy']-b['accuracy']))
    for both in [False,True]:
        mask=primary(base)&base.year.between(2020,2025)&base.cfp_pick.notna()
        if both:mask&=base.cfp_both_ranked
        y=base.y[mask].to_numpy();cp=base.cfp_pick[mask].to_numpy();comparison=paired(y,mix[mask],cp,base.year[mask])
        comparison.pop('log_loss_difference');comparison.pop('log_loss_95_interval')
        report['cfp']['both_ranked' if both else 'at_least_one_ranked']=dict(games=int(mask.sum()),neural=metrics(y,mix[mask]),
            cfp_accuracy=float(np.where(cp==.5,.5,cp==y).mean()),comparison=comparison)
    extra=base[['year','game_id','mode','y','fbs']].copy();extra['p_graph_neural']=p;extra['p_graph_ensemble']=mix
    extra.to_csv(OUT/'graph-predictions.csv.gz',index=False,float_format='%.10f',compression=dict(method='gzip',mtime=0))
    pd.DataFrame(annual).to_csv(OUT/'graph-season-metrics.csv',index=False,float_format='%.10f')
    (OUT/'graph-evaluation.json').write_text(json.dumps(report,indent=2)+'\n')
    x=np.load(GRAPH_CACHE/'2026.npz')['snapshot_x'];old=np.load(CACHE/'2026.npz');n=len(x);h=np.repeat(x,n,axis=0);a=np.tile(x,(n,1));v=np.zeros(n*n)
    obj=json.loads((OUT/'graph-rolling-models/2026.json').read_text());pg=probability(obj,h,a,v)
    from rich_evaluate import model_probability
    richobj=json.loads((OUT/'rich-rolling-models/2026.json').read_text());pr=model_probability(richobj,h[:,:64],a[:,:64],v)
    pm=blend['alpha']*pg+(1-blend['alpha'])*pr
    rankings=pd.read_csv(OUT/'week6-2026-rankings.csv');rankings=rankings[~rankings.method.isin(['graph_neural','graph_ensemble'])];rows=[]
    for model,probs in [('graph_neural',pg),('graph_ensemble',pm)]:
        score=probs.reshape(n,n).mean(1)
        for field,mask in [('fbs',old['fbs']),('fbs_fcs',np.ones(n,bool))]:
            ix=np.flatnonzero(mask);order=ix[np.argsort(-score[ix],kind='stable')]
            for pos,i in enumerate(order,1):rows.append(dict(method=model,field=field,rank=pos,team_id=int(old['team_ids'][i]),team=str(old['team_names'][i]),score=float(score[i])))
    pd.concat([rankings,pd.DataFrame(rows)],ignore_index=True).to_csv(OUT/'week6-2026-rankings.csv',index=False,float_format='%.10f')
    print('GRAPH DEVELOPMENT',json.dumps(report['overall'],indent=2),flush=True)
    print('GRAPH MATCHED MONEYLINES',json.dumps(report['paired']['weekly:graph_ensemble:vs:moneyline_market'],indent=2),flush=True)

if __name__=='__main__':
    (OUT/'graph-rolling-models').mkdir(exist_ok=True)
    with ProcessPoolExecutor(max_workers=3) as pool:
        for result in pool.map(fit_year,range(2007,2027)):pass
    evaluate()
