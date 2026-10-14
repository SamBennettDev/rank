"""Cap margins before every selected score-derived fit, including Huber."""
from dataclasses import replace
from pathlib import Path
import hashlib
import json
from concurrent.futures import ProcessPoolExecutor
import numpy as np
import pandas as pd
from data import load,batches,week6,game_metadata
from graph_build import graph_features
from robust.features import inputs,records,NAMES as OLD_NAMES
from prepare import INPUT,ROOT
from build import CACHE

CAP=35.
NAMES=list(OLD_NAMES);NAMES[1]='huber_on_capped_margin_rating'
DERIVED=Path('/tmp/rank-season-only/robust-capped')

def build(s,idx,rich):
    games=s.games.copy();games['margin']=games.margin.clip(-CAP,CAP)
    graph=graph_features(replace(s,games=games),idx,rich)
    return inputs(graph),records(graph)

def build_year(year):
    DERIVED.mkdir(exist_ok=True)
    s=load(year);rich=pd.read_csv(ROOT/'data/seasons/2026/rich.csv'if year==2026 else INPUT/f'rich_{year}.csv')
    hs=[];aas=[];hgs=[];ags=[];hls=[];als=[];metas=[];snapshot=None
    plans=[(c,tr,te,'weekly')for c,tr,te in batches(s)]
    c,tr,te=week6(s);plans.append((c,tr,te,'frozen_week6'))
    for c,tr,te,mode in plans:
        x,(ng,nl)=build(s,tr,rich)
        if mode=='frozen_week6':snapshot=x
        if not len(te):continue
        meta=game_metadata(s,te,c,mode);h=meta.h.to_numpy();a=meta.a.to_numpy()
        metas.append(meta);hs.append(x[h]);aas.append(x[a]);hgs.append(ng[h]);ags.append(ng[a]);hls.append(nl[h]);als.append(nl[a])
    meta=pd.concat(metas,ignore_index=True);old=pd.read_csv(CACHE/f'{year}.csv')
    assert meta[['year','game_id','mode']].equals(old[['year','game_id','mode']])
    np.savez_compressed(DERIVED/f'{year}.npz',h=np.concatenate(hs),a=np.concatenate(aas),hg=np.concatenate(hgs),ag=np.concatenate(ags),hl=np.concatenate(hls),al=np.concatenate(als),snapshot_x=snapshot)
    print('Capped feature snapshots',year,len(meta),flush=True)

def read(years,primary=True):
    metas=[];arrays={k:[]for k in ['h','a','hg','ag','hl','al']};rawh=[];rawa=[]
    from graph_build import GRAPH_CACHE
    for year in years:
        meta=pd.read_csv(CACHE/f'{year}.csv');x=np.load(DERIVED/f'{year}.npz');raw=np.load(GRAPH_CACHE/f'{year}.npz')
        mask=(meta['mode'].eq('weekly')&meta.fbs).to_numpy()if primary else np.ones(len(meta),bool)
        metas.append(meta[mask]);rawh.append(raw['xh'][mask]);rawa.append(raw['xa'][mask])
        for k in arrays:arrays[k].append(x[k][mask])
    return pd.concat(metas,ignore_index=True),{k:np.concatenate(v)for k,v in arrays.items()},(np.concatenate(rawh),np.concatenate(rawa))

if __name__=='__main__':
    with ProcessPoolExecutor(max_workers=3)as pool:list(pool.map(build_year,range(2006,2027)))
