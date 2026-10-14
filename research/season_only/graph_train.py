"""Graph-neural design round. Same dates and objective as the richer-input study."""
import json
from pathlib import Path
import numpy as np
from concurrent.futures import ProcessPoolExecutor
from scipy.special import expit
from graph_build import GRAPH_CACHE
from train import read_years,primary
from neural import Network
from evaluate import metrics,calibrate
from build import OUT

GRAPH_OUT=OUT/'graph-networks'

def read_graph(years):
    meta,data=read_years(years)
    for k in ['xh','xa']:data[k]=np.concatenate([np.load(GRAPH_CACHE/f'{y}.npz')[k] for y in years])
    return meta,data

def settings():
    return [dict(kind=k,width=w,ridge=r,auxiliary=a,focus=f) for k in ['rank','matchup'] for w in [8,16]
            for r in [.003,.03] for a in [0.,.03] for f in [0.,.5]]

def trial(cfg):
    weights=2**((TR.year.to_numpy()-TR.year.max())/4)
    models=[];zt=[];zv=[]
    for seed in [7,19,43]:
        net=Network(**cfg,seed=seed,scale=SCALE).fit(TX['xh'],TX['xa'],TR.venue.to_numpy(),TR.y.to_numpy(),TR.margin.to_numpy(),maxiter=350,sample_weights=weights)
        models.append(net.asdict());zt.append(net.logits(TX['xh'],TX['xa'],TR.venue.to_numpy()));zv.append(net.logits(VX['xh'],VX['xa'],VA.venue.to_numpy()))
    z=np.mean(zt,axis=0);b,mb=calibrate(z,np.zeros(len(z)),TR.y.to_numpy(),TR.margin.to_numpy())
    result=dict(settings=cfg,validation=metrics(VA.y,expit(np.mean(zv,axis=0)*b[0])),temperature=float(b[0]),margin_scale=float(mb[0]),
        models=models,iterations=[m['iterations'] for m in models],converged=[m['converged'] for m in models])
    j=settings().index(cfg);(GRAPH_OUT/f'{j}.json').write_text(json.dumps(result,separators=(',',':'))+'\n')
    result.pop('models');print('Graph trial',j,result['validation']['accuracy'],flush=True);return result

if __name__=='__main__':
    GRAPH_OUT.mkdir(exist_ok=True)
    tr,tx=read_graph(list(range(2006,2018)));va,vx=read_graph([2018,2019]);ti=primary(tr).to_numpy();vi=primary(va).to_numpy()
    TR=tr[ti].reset_index(drop=True);VA=va[vi].reset_index(drop=True);TX={k:v[ti] for k,v in tx.items()};VX={k:v[vi] for k,v in vx.items()}
    SCALE=np.maximum(np.std(np.r_[TX['xh'],TX['xa']],axis=0),.01)
    with ProcessPoolExecutor(max_workers=3) as pool:results=list(pool.map(trial,settings()))
    best=min(range(len(results)),key=lambda j:(-results[j]['validation']['accuracy'],results[j]['validation']['log_loss']))
    (OUT/'graph-design.json').write_text(json.dumps(results,indent=2)+'\n')
    (OUT/'graph-selection.json').write_text(json.dumps(dict(index=best,chosen=results[best],settings=len(results),networks=len(results)*3,
        training_years=list(range(2006,2018)),validation_years=[2018,2019],training_half_life=4.,
        protocol='Exploratory third design round; later-season results are inspected development data.'),indent=2)+'\n')
    print('GRAPH SELECTION',best,results[best],flush=True)
