"""Materialize all chronological predictions and neural inputs without tuning."""
import json
from pathlib import Path
import numpy as np
import pandas as pd
from concurrent.futures import ProcessPoolExecutor,as_completed
from data import load,batches,week6,game_metadata
from prepare import HERE,YEARS
from models import candidates,rating
from features import features,NAMES

OUT=HERE/'results'
CACHE=Path('/tmp/rank-season-only/features')

def build_year(year):
    out=CACHE/f'{year}.npz'
    if out.exists():return year
    s=load(year);methods=candidates();blocks=[];XH=[];XA=[];RH=[];RA=[];HF=[]
    plans=[(cut,tr,te,'weekly') for cut,tr,te in batches(s)]
    cut,tr,te=week6(s);plans.append((cut,tr,te,'frozen_week6'))
    snapshot=None
    for cut,tr,te,mode in plans:
        cache={};scores=np.column_stack([m.fit(s,tr,cache) for m in methods])
        x=features(s,tr,cache);hfa=rating(s,tr)[1]
        if mode=='frozen_week6':snapshot=(scores,x,hfa,cut)
        if not len(te):continue
        meta=game_metadata(s,te,cut,mode);h=meta.h.to_numpy();a=meta.a.to_numpy()
        blocks.append(meta);XH.append(x[h]);XA.append(x[a]);RH.append(scores[h]);RA.append(scores[a]);HF.append(np.full(len(te),hfa))
    meta=pd.concat(blocks,ignore_index=True)
    meta.to_csv(CACHE/f'{year}.csv',index=False)
    np.savez_compressed(out,xh=np.concatenate(XH),xa=np.concatenate(XA),rh=np.concatenate(RH),ra=np.concatenate(RA),
        hfa=np.concatenate(HF),snapshot_scores=snapshot[0],snapshot_x=snapshot[1],snapshot_hfa=snapshot[2],cutoff=snapshot[3],
        team_ids=s.ids,team_names=np.array(s.names),fbs=s.fbs)
    print(f'Built {year}: {len(meta)} predictions',flush=True)
    return year

if __name__=='__main__':
    OUT.mkdir(exist_ok=True);CACHE.mkdir(exist_ok=True)
    (OUT/'methods.json').write_text(json.dumps([dict(name=m.name,family=m.family,params=dict(m.params)) for m in candidates()],indent=2)+'\n')
    (OUT/'features.json').write_text(json.dumps(NAMES,indent=2)+'\n')
    with ProcessPoolExecutor(max_workers=3) as pool:
        for result in pool.map(build_year,YEARS+[2026]):pass
