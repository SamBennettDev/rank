"""Identity-free GraphSAGE-style mean-neighborhood inputs from the current game graph."""
from concurrent.futures import ProcessPoolExecutor
import json
import numpy as np
import pandas as pd
from data import load,batches,week6
from features import features
from rich_build import extra_features,RICH_NAMES
from prepare import INPUT,YEARS
from build import CACHE,OUT

GRAPH_CACHE=CACHE/'graph'
SECOND=list(range(16))
VARIANCE=[0,9,10,11,12,20,21,22]
GRAPH_NAMES=RICH_NAMES+['opponent_mean_'+n for n in RICH_NAMES]+['two_hop_mean_'+RICH_NAMES[i] for i in SECOND]+['opponent_sd_'+RICH_NAMES[i] for i in VARIANCE]

def graph_features(s,idx,rich):
    x=np.c_[features(s,idx,{}),extra_features(s,idx,rich)]
    g=s.games.iloc[idx];A=np.zeros((s.n,s.n))
    np.add.at(A,(g.h,g.a),1);np.add.at(A,(g.a,g.h),1)
    A/=np.maximum(A.sum(1),1)[:,None]
    neighbor=A@x;second=A@neighbor[:,SECOND]
    sd=np.sqrt(np.maximum(0,A@(x[:,VARIANCE]**2)-neighbor[:,VARIANCE]**2))
    return np.c_[x,neighbor,second,sd]

def build(year):
    s=load(year);rich=pd.read_csv(INPUT/f'rich_{year}.csv');h=[];a=[];snapshot=None
    plans=[(cut,tr,te,'weekly') for cut,tr,te in batches(s)]
    cut,tr,te=week6(s);plans.append((cut,tr,te,'frozen_week6'))
    for cut,tr,te,mode in plans:
        x=graph_features(s,tr,rich)
        if mode=='frozen_week6':snapshot=x
        if len(te):h.append(x[s.games.h.iloc[te].to_numpy()]);a.append(x[s.games.a.iloc[te].to_numpy()])
    np.savez_compressed(GRAPH_CACHE/f'{year}.npz',xh=np.concatenate(h),xa=np.concatenate(a),snapshot_x=snapshot)
    print('Graph snapshots',year,len(GRAPH_NAMES),'features',flush=True)

if __name__=='__main__':
    GRAPH_CACHE.mkdir(exist_ok=True);(OUT/'graph-features.json').write_text(json.dumps(GRAPH_NAMES,indent=2)+'\n')
    with ProcessPoolExecutor(max_workers=3) as pool:
        for result in pool.map(build,YEARS+[2026]):pass
