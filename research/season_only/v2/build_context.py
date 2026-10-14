"""Build extra dated features alongside, without changing, the original study."""
import json
from concurrent.futures import ProcessPoolExecutor
import numpy as np
import pandas as pd
from common import INPUT, OUT, CACHE, YEARS
from data import load, batches, week6
from build import CACHE as OLD_CACHE
from rich_build import RICH_CACHE,RICH_NAMES
from graph_build import GRAPH_CACHE,GRAPH_NAMES
from context_features import addon_features,ADDON_NAMES

def build_year(year):
    s=load(year);context=pd.read_csv(INPUT/f'context_{year}.csv');players=pd.read_csv(INPUT/f'players_{year}.csv')
    h=[];a=[];snapshot=None;meta=[]
    plans=[(cut,tr,te,'weekly') for cut,tr,te in batches(s)]
    cut,tr,te=week6(s);plans.append((cut,tr,te,'frozen_week6'))
    for cut,tr,te,mode in plans:
        x=addon_features(s,tr,context,players,cut)
        if mode=='frozen_week6':snapshot=x
        if len(te):
            h.append(x[s.games.h.iloc[te]]);a.append(x[s.games.a.iloc[te]])
            meta.extend(s.games.game_id.iloc[te].tolist())
    old=pd.read_csv(OLD_CACHE/f'{year}.csv');assert np.array_equal(meta,old.game_id)
    np.savez_compressed(CACHE/f'{year}.npz',xh=np.concatenate(h),xa=np.concatenate(a),snapshot_x=snapshot)
    print('V2 dated features',year,len(old),len(ADDON_NAMES),flush=True)

if __name__=='__main__':
    (OUT/'features.json').write_text(json.dumps(dict(rich=RICH_NAMES,graph=GRAPH_NAMES,addon=ADDON_NAMES),indent=2)+'\n')
    with ProcessPoolExecutor(max_workers=3) as pool:
        for _ in pool.map(build_year,YEARS):pass
