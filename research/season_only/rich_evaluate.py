"""Annual refits and matched benchmarking for the second, exploratory design round."""
import json
from concurrent.futures import ProcessPoolExecutor
import numpy as np
import pandas as pd
from scipy.special import expit
from neural import Network
from rich_train import read_rich,settings,RICH_OUT
from rich_build import RICH_CACHE
from train import primary
from evaluate import metrics,calibrate,paired
from build import OUT,CACHE

def fit_year(year):
    selection=json.loads((OUT/'rich-selection.json').read_text())
    meta,data=read_rich(list(range(2006,year)));mask=primary(meta).to_numpy()
    meta=meta[mask].reset_index(drop=True);data={k:v[mask] for k,v in data.items()}
    scale=np.maximum(np.std(np.r_[data['xh'],data['xa']],axis=0),.01)
    forecast=pd.read_csv(CACHE/f'{year}.csv');target=np.load(RICH_CACHE/f'{year}.npz')
    output=[];pred_logits=[]
    for j in selection['chosen']['indices']:
        cfg=dict(settings()[j]);half=cfg.pop('training_half_life')
        weights=np.ones(len(meta)) if half==0 else 2**((meta.year.to_numpy()-meta.year.max())/half)
        models=[];tz=[];fz=[]
        for seed in [7,19,43]:
            model=Network(**cfg,seed=seed,scale=scale).fit(data['xh'],data['xa'],meta.venue.to_numpy(),meta.y.to_numpy(),meta.margin.to_numpy(),maxiter=350,sample_weights=weights)
            models.append(model.asdict());tz.append(model.logits(data['xh'],data['xa'],meta.venue.to_numpy()))
            fz.append(model.logits(target['xh'],target['xa'],forecast.venue.to_numpy()))
        z=np.mean(tz,axis=0);b,mb=calibrate(z,np.zeros(len(z)),meta.y.to_numpy(),meta.margin.to_numpy())
        output.append(dict(index=j,models=models,temperature=float(b[0]),margin_scale=float(mb[0])))
        pred_logits.append(np.mean(fz,axis=0)*b[0])
    obj=dict(year=year,training_years=list(range(2006,year)),training_games=len(meta),components=output)
    (OUT/'rich-rolling-models'/f'{year}.json').write_text(json.dumps(obj,separators=(',',':'))+'\n')
    p=expit(np.mean(pred_logits,axis=0));np.save(CACHE/f'rich_predictions_{year}.npy',p)
    print('Rich annual refit',year,'prior games',len(meta),'models',3*len(output),flush=True)

def model_probability(obj,h,a,v):
    logits=[]
    for component in obj['components']:
        z=np.mean([Network.fromdict(m).logits(h,a,v) for m in component['models']],axis=0)
        logits.append(z*component['temperature'])
    return expit(np.mean(logits,axis=0))

def evaluate():
    selection=json.loads((OUT/'rich-selection.json').read_text())
    base=pd.read_csv(OUT/'predictions.csv.gz',low_memory=False)
    p=np.full(len(base),np.nan)
    for yr in range(2007,2027):p[base.year.eq(yr)]=np.load(CACHE/f'rich_predictions_{yr}.npy')
    # Predeclare the blend using the design years, rather than optimize it on later outcomes.
    # Reconstructed 2018/2019 models use those years' actual available prior seasons.
    validation=primary(base)&base.year.isin([2018,2019])
    combinations=[]
    for alpha in [0.,.25,.5,.75,1.]:
        pred=alpha*p[validation]+(1-alpha)*base.loc[validation,'p_neural_annual'].to_numpy()
        combinations.append(dict(alpha=alpha,validation=metrics(base.y[validation],pred)))
    blend=min(combinations,key=lambda x:(-x['validation']['accuracy'],x['validation']['log_loss']))
    (OUT/'rich-blend-selection.json').write_text(json.dumps(dict(**blend,design=combinations),indent=2)+'\n')
    mixed=blend['alpha']*p+(1-blend['alpha'])*base.p_neural_annual.to_numpy()
    result=dict(selection=selection,blend=blend,overall={},paired={},season_market_comparison=[],cfp={})
    for mode in ['weekly','frozen_week6']:
        main=(base['mode']==mode)&base.fbs&base.year.between(2020,2025)
        result['overall'][mode]=dict(rich_neural=metrics(base.y[main],p[main]),rich_ensemble=metrics(base.y[main],mixed[main]))
        for market in ['moneyline_market','spread_market','massey','gradient_boosting','neural_ensemble']:
            mask=main&base['p_'+market].notna()
            for model,probs in [('rich_neural',p),('rich_ensemble',mixed)]:
                result['paired'][mode+':'+model+':vs:'+market]=dict(neural=metrics(base.y[mask],probs[mask]),
                    benchmark=metrics(base.y[mask],base.loc[mask,'p_'+market]),
                    comparison=paired(base.y[mask],probs[mask],base.loc[mask,'p_'+market],base.year[mask]))
    per_year=[]
    for year in range(2007,2027):
        for mode in ['weekly','frozen_week6']:
            main=(base['mode']==mode)&base.fbs&base.year.eq(year)
            if main.sum():
                for method,probs in [('rich_neural',p),('rich_ensemble',mixed)]:per_year.append(dict(year=year,mode=mode,method=method,**metrics(base.y[main],probs[main])))
            if mode!='weekly':continue
            for market in ['moneyline_market','spread_market']:
                mask=main&base['p_'+market].notna()
                if not mask.sum():continue
                n=metrics(base.y[mask],mixed[mask]);b=metrics(base.y[mask],base.loc[mask,'p_'+market])
                result['season_market_comparison'].append(dict(year=year,market=market,neural=n,benchmark=b,accuracy_difference=n['accuracy']-b['accuracy']))
    for both in [False,True]:
        mask=primary(base)&base.year.between(2020,2025)&base.cfp_pick.notna()
        if both:mask&=base.cfp_both_ranked
        y=base.y[mask].to_numpy();cp=base.cfp_pick[mask].to_numpy()
        comp=paired(y,mixed[mask],cp,base.year[mask])
        comp.pop('log_loss_difference');comp.pop('log_loss_95_interval')
        result['cfp']['both_ranked' if both else 'at_least_one_ranked']=dict(games=int(mask.sum()),
            neural=metrics(y,mixed[mask]),cfp_accuracy=float(np.where(cp==.5,.5,cp==y).mean()),comparison=comp)
    pd.DataFrame(per_year).to_csv(OUT/'rich-season-metrics.csv',index=False,float_format='%.10f')
    extra=base[['year','game_id','mode','y','fbs']].copy();extra['p_rich_neural']=p;extra['p_rich_ensemble']=mixed
    extra.to_csv(OUT/'rich-predictions.csv.gz',index=False,float_format='%.10f',compression=dict(method='gzip',mtime=0))
    (OUT/'rich-evaluation.json').write_text(json.dumps(result,indent=2)+'\n')
    current=np.load(RICH_CACHE/'2026.npz');old=np.load(CACHE/'2026.npz');n=len(current['snapshot_x']);x=current['snapshot_x']
    h=np.repeat(x,n,axis=0);a=np.tile(x,(n,1));v=np.zeros(n*n)
    obj=json.loads((OUT/'rich-rolling-models/2026.json').read_text());pn=model_probability(obj,h,a,v)
    from rolling import predict
    oldobj=json.loads((OUT/'rolling-models/2026.json').read_text());po=predict(oldobj,h[:,:28],a[:,:28],v)[0]
    pm=blend['alpha']*pn+(1-blend['alpha'])*po
    rankings=pd.read_csv(OUT/'week6-2026-rankings.csv');rankings=rankings[~rankings.method.isin(['rich_neural','rich_ensemble'])]
    rows=[]
    for method,prob in [('rich_neural',pn),('rich_ensemble',pm)]:
        strength=prob.reshape(n,n).mean(1)
        for field,mask in [('fbs',old['fbs']),('fbs_fcs',np.ones(n,bool))]:
            ix=np.flatnonzero(mask);order=ix[np.argsort(-strength[ix],kind='stable')]
            for pos,i in enumerate(order,1):rows.append(dict(method=method,field=field,rank=pos,team_id=int(old['team_ids'][i]),team=str(old['team_names'][i]),score=float(strength[i])))
    pd.concat([rankings,pd.DataFrame(rows)],ignore_index=True).to_csv(OUT/'week6-2026-rankings.csv',index=False,float_format='%.10f')
    print('RICH DEVELOPMENT',json.dumps(result['overall'],indent=2),flush=True)
    print('RICH MATCHED MONEYLINES',json.dumps(result['paired']['weekly:rich_ensemble:vs:moneyline_market'],indent=2),flush=True)

if __name__=='__main__':
    (OUT/'rich-rolling-models').mkdir(exist_ok=True)
    with ProcessPoolExecutor(max_workers=3) as pool:
        for result in pool.map(fit_year,range(2007,2027)):pass
    evaluate()
