"""Continue the selected model's identical objective to numerical convergence."""
import hashlib
import json
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
import numpy as np
import pandas as pd
from scipy.optimize import minimize
from scipy.special import expit,logit

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parent))
from robust.capped_features import read
from robust.bounded_network import BoundedRanker,probability
from robust.study import FOLDS
from evaluate import metrics

ORIGINAL=HERE/'capped-results'
OUT=HERE/'polished-results'
digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()

def continue_fit(model,meta,x):
    n=len(meta);d=len(model.scale);k=model.width
    raw=np.r_[x['h'],x['a']];z=np.clip(raw/model.scale,-model.clip,model.clip)
    rel=np.r_[x['hg']/(x['hg']+model.evidence_prior),x['ag']/(x['ag']+model.evidence_prior)]
    anchor=raw[:,1]/model.anchor_scale;sign=np.r_[np.ones(n),-np.ones(n)]
    y=meta.y.to_numpy();venue=meta.venue.to_numpy();weights=2**((meta.year.to_numpy()-meta.year.max())/4);weights/=weights.sum()
    penalty=np.ones(len(model.theta));penalty[d+d*k:d+d*k+k]=0;penalty[-1]=.1
    def objective(t):
        linear,W,b,out,home=model.unpack(t);hidden=np.tanh(z@W+b);residual=np.tanh(z@linear+hidden@out)
        scores=rel*(anchor+model.residual_limit*residual);edge=scores[:n]-scores[n:]+home*venue
        value=np.sum(weights*(np.logaddexp(0,edge)-y*edge))+model.ridge*.5*np.sum(penalty*t*t)
        de=weights*(expit(edge)-y);ds=np.r_[de,de]*sign*rel*model.residual_limit*(1-residual**2)
        gh=ds[:,None]*out*(1-hidden**2)
        grad=np.r_[z.T@ds,(z.T@gh).ravel(),gh.sum(0),hidden.T@ds,de@venue]+model.ridge*penalty*t
        return value,grad
    initial_value=objective(model.theta)[0]
    if model.converged:
        return model,dict(initialObjective=float(initial_value),finalObjective=float(initial_value),additionalIterations=0,gradientInfinityNorm=float(np.max(np.abs(objective(model.theta)[1]))),message='Saved fit already converged; preserved unchanged.')
    result=minimize(objective,model.theta,jac=True,method='L-BFGS-B',options=dict(maxiter=10000,ftol=1e-9,gtol=1e-5,maxls=40))
    assert result.fun<=initial_value+1e-10
    model.theta=result.x;model.iterations+=result.nit;model.converged=bool(result.success)
    assert model.converged,f'Optimizer did not converge: {result.message}'
    return model,dict(initialObjective=float(initial_value),finalObjective=float(result.fun),additionalIterations=result.nit,gradientInfinityNorm=float(np.max(np.abs(result.jac))),message=str(result.message))

def annual(year):
    meta,x,_=read(range(2006,year));obj=json.loads((ORIGINAL/f'annual-models/{year}.json').read_text());models=[];checks=[]
    for m in obj['models']:
        model,check=continue_fit(BoundedRanker.fromdict(m),meta,x);models.append(model.asdict());checks.append(check)
    obj['models']=models;obj['optimization']=checks
    (OUT/f'annual-models/{year}.json').write_text(json.dumps(obj,separators=(',',':'))+'\n')
    target,tx,_=read([year],primary=False)
    np.save(OUT/f'annual-predictions/{year}.npy',probability(obj,**tx,venue=target.venue.to_numpy()))
    print('Converged annual',year,flush=True)

def main():
    OUT.mkdir(exist_ok=True);(OUT/'annual-models').mkdir(exist_ok=True);(OUT/'annual-predictions').mkdir(exist_ok=True)
    protocol=dict(sourceSha256=digest(Path(__file__)),selectionSha256=digest(ORIGINAL/'selection.json'),
        policy='Preserve already-converged fits. Continue other selected fits on their identical performance objective from saved weights, with at most 10,000 additional iterations, ftol 1e-9, gtol 1e-5. No architecture, feature, loss, season-weight, or sample-selection changes. Require convergence. Recalibrate positive temperature on the same older validation forecasts. Later-season outputs remain development evidence.')
    path=OUT/'protocol.json'
    if path.exists():assert json.loads(path.read_text())==protocol
    else:path.write_text(json.dumps(protocol,indent=2)+'\n')
    (OUT/'selection.json').write_text((ORIGINAL/'selection.json').read_text())
    selection=json.loads((ORIGINAL/'selection.json').read_text())['chosen'];metas=[];predictions=[]
    for year,valyears in FOLDS:
        meta,x,_=read(range(2006,year));obj=json.loads((ORIGINAL/f'validation-models/{selection["index"]}-{year}.json').read_text());models=[];checks=[]
        for m in obj['models']:
            model,check=continue_fit(BoundedRanker.fromdict(m),meta,x);model.loss_penalty=selection['loss_penalty'];models.append(model.asdict());checks.append(check)
        obj['models']=models;obj['optimization']=checks
        (OUT/f'validation-{year}.json').write_text(json.dumps(obj,separators=(',',':'))+'\n')
        target,tx,_=read(valyears);metas.append(target);predictions.append(probability(obj,**tx,venue=target.venue.to_numpy()))
    meta=pd.concat(metas,ignore_index=True);p=np.concatenate(predictions);z=logit(np.clip(p,1e-10,1-1e-10));y=meta.y.to_numpy()
    def objective(t):return np.mean(np.logaddexp(0,z*t[0])-y*z*t[0])+1e-6*t[0]**2,np.array([np.mean((expit(z*t[0])-y)*z)+2e-6*t[0]])
    result=minimize(objective,[1.],jac=True,method='L-BFGS-B',bounds=[(.2,3.)])
    calibration=dict(protocolSha256=digest(path),temperature=float(result.x[0]),before=metrics(y,p),after=metrics(y,expit(z*result.x[0])))
    (OUT/'calibration.json').write_text(json.dumps(calibration,indent=2)+'\n');meta.to_csv(OUT/'validation-games.csv',index=False);np.save(OUT/'validation-predictions.npy',p)
    with ProcessPoolExecutor(max_workers=3)as pool:list(pool.map(annual,range(2007,2027)))

if __name__=='__main__':main()
