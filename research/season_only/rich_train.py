"""Second design round: richer inputs, hard-game losses and global training recency."""
import json
from concurrent.futures import ProcessPoolExecutor
import numpy as np
import pandas as pd
from scipy.special import expit
from train import read_years,primary
from rich_build import RICH_CACHE
from build import OUT,CACHE
from neural import Network
from evaluate import metrics,calibrate

RICH_OUT=OUT/'rich-networks'
TRAIN_YEARS=list(range(2006,2018))
VAL_YEARS=[2018,2019]

def read_rich(years):
    meta,data=read_years(years)
    for key in ['xh','xa']:data[key]=np.concatenate([np.load(RICH_CACHE/f'{yr}.npz')[key] for yr in years])
    return meta,data

def settings():
    return [dict(kind=k,width=w,ridge=r,auxiliary=a,focus=f,training_half_life=hl)
      for k in ['rank','matchup'] for w in [8,16,32] for r in [.001,.01] for a in [0.,.03] for f in [0.,1.] for hl in [0.,4.]]

def name(s):return 'rich:'+','.join(f'{k}={v}' for k,v in s.items())

def trial(config):
    global TR,VA,TX,VX,SCALE
    cfg=dict(config);half=cfg.pop('training_half_life')
    weights=np.ones(len(TR)) if half==0 else 2**((TR.year.to_numpy()-TR.year.max())/half)
    models=[];zt=[];zv=[]
    for seed in [7,19,43]:
        net=Network(**cfg,seed=seed,scale=SCALE.copy()).fit(TX['xh'],TX['xa'],TR.venue.to_numpy(),TR.y.to_numpy(),TR.margin.to_numpy(),maxiter=350,sample_weights=weights)
        models.append(net.asdict());zt.append(net.logits(TX['xh'],TX['xa'],TR.venue.to_numpy()));zv.append(net.logits(VX['xh'],VX['xa'],VA.venue.to_numpy()))
    tz=np.mean(zt,axis=0);vz=np.mean(zv,axis=0)
    b,mb=calibrate(tz,np.zeros(len(tz)),TR.y.to_numpy(),TR.margin.to_numpy())
    result=dict(name=name(config),settings=config,temperature=float(b[0]),margin_scale=float(mb[0]),
        validation=metrics(VA.y,expit(vz*b[0])),training=metrics(TR.y,expit(tz*b[0])),
        iterations=[m['iterations'] for m in models],converged=[m['converged'] for m in models])
    idx=settings().index(config);(RICH_OUT/f'{idx}.json').write_text(json.dumps(dict(**result,models=models),separators=(',',':'))+'\n')
    print('Rich trial',idx,'validation accuracy',round(result['validation']['accuracy'],4),flush=True)
    return result,vz*b[0]

def main():
    global TR,VA,TX,VX,SCALE
    RICH_OUT.mkdir(exist_ok=True)
    tr,tx=read_rich(TRAIN_YEARS);va,vx=read_rich(VAL_YEARS)
    ti=primary(tr).to_numpy();vi=primary(va).to_numpy();TR=tr[ti].reset_index(drop=True);VA=va[vi].reset_index(drop=True)
    TX={k:v[ti] for k,v in tx.items()};VX={k:v[vi] for k,v in vx.items()}
    SCALE=np.maximum(np.std(np.r_[TX['xh'],TX['xa']],axis=0),.01)
    results=[];logits=[]
    with ProcessPoolExecutor(max_workers=3) as pool:
        for result,z in pool.map(trial,settings()):results.append(result);logits.append(z)
    order=sorted(range(len(results)),key=lambda i:(-results[i]['validation']['accuracy'],results[i]['validation']['log_loss']))
    # Cross-architecture averaging reduces dependence on any single fitted network.
    combos=[]
    for count in [1,3,5,10]:
        selected=order[:count];p=expit(np.mean([logits[i] for i in selected],axis=0))
        combos.append(dict(indices=selected,validation=metrics(VA.y,p)))
    best=min(combos,key=lambda c:(-c['validation']['accuracy'],c['validation']['log_loss']))
    selection=dict(training_years=TRAIN_YEARS,validation_years=VAL_YEARS,networks=len(results)*3,
        settings=len(results),chosen=best,individual_best=results[order[0]],
        protocol='Second exploratory design round after inspecting the earlier development results. Choices use 2018–2019 only; 2020–2025 results remain development evidence, not an untouched holdout.')
    (OUT/'rich-design.json').write_text(json.dumps(results,indent=2)+'\n')
    (OUT/'rich-selection.json').write_text(json.dumps(selection,indent=2)+'\n')
    print('RICH SELECTION',selection,flush=True)

if __name__=='__main__':main()
