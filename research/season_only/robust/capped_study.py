"""Third registered round: cap margins before every selected score fit."""
import argparse
import hashlib
import json
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
import numpy as np
import pandas as pd
from scipy.special import expit

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parent))
from robust.study import score,baseline,FOLDS,SEEDS
from robust.capped_features import read,NAMES
from robust.bounded_network import BoundedRanker,probability
from evaluate import metrics,paired
from build import CACHE

OUT=HERE/'capped-results'
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def settings():
    return [dict(ridge=r,evidence_prior=e,residual_limit=c,anchor_scale=a)
        for r in [.003,.03]for e in [2.,6.]for c in [.5,1.]for a in [10.,14.]]

def register():
    OUT.mkdir(exist_ok=True)
    protocol=dict(settings=settings(),loss_penalties=[2.,4.,6.],folds=FOLDS,seeds=SEEDS,feature_names=NAMES,score_margin_cap=35,
        selection='Maximize equal-weight macro-season overall and <=6-prior-game accuracy, then minimize pooled log loss, using 2014–2019 only. Loss deduction is applied AFTER fitting the performance network. No current-team rank targets.',
        disclosure='Third design round after inspecting two earlier designs and their 2020–2025 results. Adds a structural score-margin cap; keeps every registered architecture and positive post-fit penalty candidate unchanged. All historical results are exploratory development evidence. Do not claim an untouched holdout or a general market edge.',
        source={p.name:digest(p)for p in [Path(__file__),HERE/'bounded_network.py',HERE/'features.py',HERE/'capped_features.py']})
    path=OUT/'protocol.json'
    if path.exists():assert json.dumps(json.loads(path.read_text()),sort_keys=True)==json.dumps(protocol,sort_keys=True)
    else:path.write_text(json.dumps(protocol,indent=2)+'\n')

def fit(config,year):
    meta,x,_=read(range(2006,year));scale=np.maximum(np.std(np.r_[x['h'],x['a']],axis=0),.01)
    weights=2**((meta.year.to_numpy()-meta.year.max())/4)
    models=[]
    for seed in SEEDS:
        net=BoundedRanker(**config,seed=seed,scale=scale).fit(**x,venue=meta.venue.to_numpy(),y=meta.y.to_numpy(),weights=weights)
        models.append(net.asdict())
    return dict(year=year,training_years=list(range(2006,year)),training_games=len(meta),settings=config,models=models)

def trial(job):
    i,cfg=job;metas=[];logits=[];loads=[];bases=[]
    for year,valyears in FOLDS:
        meta,x,raw=read(valyears);meta['_hg']=x['hg'];meta['_ag']=x['ag']
        path=OUT/f'validation-models/{i}-{year}.json'
        if path.exists():model=json.loads(path.read_text())
        else:
            model=fit(cfg,year);path.write_text(json.dumps(model,separators=(',',':'))+'\n')
        logits.append(np.mean([BoundedRanker.fromdict(m).logits(**x,venue=meta.venue.to_numpy())for m in model['models']],axis=0))
        loads.append(x['hl']/(x['hg']+4)-x['al']/(x['ag']+4));metas.append(meta)
        if i==0:bases.append(baseline(year,raw,meta.venue.to_numpy()))
    meta=pd.concat(metas,ignore_index=True);z=np.concatenate(logits);load=np.concatenate(loads)
    if i==0:
        meta.to_csv(OUT/'validation-games.csv',index=False)
        np.save(OUT/'baseline-validation.npy',np.concatenate(bases))
    results=[]
    for loss in [2.,4.,6.]:
        p=expit(z-loss*load);key=f'{i}-loss-{int(loss)}'
        np.save(OUT/f'validation-models/{key}.npy',p)
        result=dict(index=i,loss_penalty=loss,settings=cfg,validation=score(meta,p));results.append(result)
        print('Bounded validation',key,result['validation']['utility'],flush=True)
    return results

def select():
    register();(OUT/'validation-models').mkdir(exist_ok=True)
    with ProcessPoolExecutor(max_workers=3)as pool:results=sum(list(pool.map(trial,enumerate(settings()))),[])
    chosen=min(results,key=lambda r:(-r['validation']['utility'],r['validation']['pooled']['log_loss']))
    meta=pd.read_csv(OUT/'validation-games.csv');base=np.load(OUT/'baseline-validation.npy')
    result=dict(protocolSha256=digest(OUT/'protocol.json'),chosen=chosen,baseline=score(meta,base),design=results)
    (OUT/'selection.json').write_text(json.dumps(result,indent=2,allow_nan=False)+'\n')
    print('SELECTED',json.dumps(chosen),flush=True)

def annual(year):
    selection=json.loads((OUT/'selection.json').read_text())['chosen'];model=fit(selection['settings'],year)
    model['loss_penalty']=selection['loss_penalty']
    for m in model['models']:m['loss_penalty']=selection['loss_penalty']
    (OUT/f'annual-models/{year}.json').write_text(json.dumps(model,separators=(',',':'))+'\n')
    meta,x,_=read([year],primary=False)
    np.save(OUT/f'annual-predictions/{year}.npy',probability(model,**x,venue=meta.venue.to_numpy()))
    print('Bounded annual',year,flush=True)

def refit():
    (OUT/'annual-models').mkdir(exist_ok=True);(OUT/'annual-predictions').mkdir(exist_ok=True)
    with ProcessPoolExecutor(max_workers=3)as pool:list(pool.map(annual,range(2007,2027)))

def evaluate():
    original=pd.read_csv(HERE.parent/'results/predictions.csv.gz',low_memory=False)
    old=pd.read_csv(HERE.parent/'results/graph-predictions.csv.gz')
    pieces=[]
    for year in range(2007,2027):
        meta,x,_=read([year],primary=False);meta['p_bounded']=np.load(OUT/f'annual-predictions/{year}.npy')
        meta['_hg']=x['hg'];meta['_ag']=x['ag'];pieces.append(meta)
    pred=pd.concat(pieces,ignore_index=True).merge(original[['year','game_id','mode','p_moneyline_market','p_spread_market','p_massey','cfp_pick','cfp_both_ranked']],on=['year','game_id','mode'],validate='one_to_one')
    pred=pred.merge(old[['year','game_id','mode','p_graph_ensemble']],on=['year','game_id','mode'],validate='one_to_one')
    report=dict(selectionSha256=digest(OUT/'selection.json'),overall={},paired={},seasons=[],cfp={})
    for mode in ['weekly','frozen_week6']:
        mask=pred.year.between(2020,2025)&pred.fbs&pred['mode'].eq(mode)
        report['overall'][mode]=dict(bounded=metrics(pred.y[mask],pred.p_bounded[mask]),previous=metrics(pred.y[mask],pred.p_graph_ensemble[mask]))
        for benchmark in ['graph_ensemble','moneyline_market','spread_market','massey']:
            m=mask&pred['p_'+benchmark].notna()
            report['paired'][mode+':'+benchmark]=dict(model=metrics(pred.y[m],pred.p_bounded[m]),benchmark=metrics(pred.y[m],pred['p_'+benchmark][m]),comparison=paired(pred.y[m],pred.p_bounded[m],pred['p_'+benchmark][m],pred.year[m]))
    for year in range(2007,2026):
        for mode in ['weekly','frozen_week6']:
            for name in ['bounded','graph_ensemble','moneyline_market','spread_market','massey']:
                mask=pred.year.eq(year)&pred.fbs&pred['mode'].eq(mode)&pred['p_'+name].notna()
                if mask.any():report['seasons'].append(dict(year=year,mode=mode,method=name,**metrics(pred.y[mask],pred['p_'+name][mask])))
    main=pred.year.between(2020,2025)&pred.fbs&pred['mode'].eq('weekly')
    early=main&(pred._hg.le(6)|pred._ag.le(6))
    report['early']=dict(bounded=metrics(pred.y[early],pred.p_bounded[early]),previous=metrics(pred.y[early],pred.p_graph_ensemble[early]))
    for both in [False,True]:
        mask=main&pred.cfp_pick.notna()
        if both:mask &= pred.cfp_both_ranked
        report['cfp']['both'if both else'any']=dict(games=int(mask.sum()),model=metrics(pred.y[mask],pred.p_bounded[mask]),committee_accuracy=float(np.where(pred.cfp_pick[mask]==.5,.5,pred.cfp_pick[mask]==pred.y[mask]).mean()))
    pred.to_csv(OUT/'predictions.csv.gz',index=False,float_format='%.10f',compression=dict(method='gzip',mtime=0))
    pd.DataFrame(report['seasons']).to_csv(OUT/'season-metrics.csv',index=False,float_format='%.10f')
    (OUT/'evaluation.json').write_text(json.dumps(report,indent=2,allow_nan=False)+'\n')
    print('BOUNDED EVALUATION',json.dumps(report['overall']),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('action',choices=['register','select','refit','evaluate']);args=p.parse_args();globals()[args.action]()
