"""Fit 36 extra season-only signals on dated snapshots; preserve the original study."""
import json
from dataclasses import replace
from concurrent.futures import ProcessPoolExecutor
import numpy as np
import pandas as pd
from prepare import INPUT,HERE,YEARS
from data import load,batches,week6
from models import od
from rich_prepare import METRICS,SCALES
from features import NAMES
from build import CACHE,OUT

RICH_CACHE=CACHE/'rich'
RICH_NAMES=NAMES+[f'{metric}_{side}' for metric in METRICS for side in ['offense','defense']]+[
    'recent_pass_offense','recent_pass_defense','recent_rush_offense','recent_rush_defense',
    'pass_fraction','drive_evidence','pass_evidence','recent_pbp_evidence']

def extra_features(s,idx,rich):
    g=s.games.iloc[idx];p=rich[rich.game_id.isin(g.game_id)].copy();ix={t:i for i,t in enumerate(s.ids)}
    p=p[p.team_id.isin(ix)&p.opponent_id.isin(ix)].copy()
    p['t']=p.team_id.map(ix).astype(int);p['u']=p.opponent_id.map(ix).astype(int)
    gm=g.set_index('game_id');p['site']=np.where(p.team_id==p.game_id.map(gm.home),1,-1)*p.game_id.map(gm.venue)
    columns=[]
    for metric,factor in zip(METRICS,SCALES):
        pp=p.copy();pp['snaps']=pp[metric+'_n'];pp['epa']=pp[metric+'_sum']
        ridge=3. if metric in ['drive_epa','field_position'] else 60.
        o,d,_,_=od(replace(s,plays=pp),idx,'epa',ridge)
        columns.extend([o*factor,d*factor])
    if len(g):
        age=p.game_id.map(gm.time)-g.time.max();decay=2**(age/(28*86400))
    else:decay=np.zeros(len(p))
    for metric in ['pass_epa','rush_epa']:
        pp=p.copy();pp['snaps']=pp[metric+'_n']*decay;pp['epa']=pp[metric+'_sum']*decay
        o,d,_,_=od(replace(s,plays=pp),idx,'epa',60.)
        columns.extend([o*60,d*60])
    aggregate=lambda col:np.bincount(p.t,p[col].to_numpy(),minlength=s.n)
    passes=aggregate('pass_epa_n');rushes=aggregate('rush_epa_n');drives=aggregate('drive_epa_n')
    rec=np.bincount(p.t,p.scrimmage_snaps.to_numpy()*decay,minlength=s.n)
    columns.extend([passes/np.maximum(passes+rushes,1),drives/(drives+40),passes/(passes+200),rec/(rec+200)])
    x=np.column_stack(columns);assert x.shape==(s.n,36) and np.isfinite(x).all()
    return x

def build(year):
    s=load(year);rich=pd.read_csv(INPUT/f'rich_{year}.csv');old=np.load(CACHE/f'{year}.npz')
    xh=[];xa=[];snapshot=None
    plans=[(cut,tr,te,'weekly') for cut,tr,te in batches(s)]
    cut,tr,te=week6(s);plans.append((cut,tr,te,'frozen_week6'))
    for cut,tr,te,mode in plans:
        x=extra_features(s,tr,rich)
        if mode=='frozen_week6':snapshot=x
        if len(te):
            xh.append(x[s.games.h.iloc[te].to_numpy()]);xa.append(x[s.games.a.iloc[te].to_numpy()])
    h=np.c_[old['xh'],np.concatenate(xh)];a=np.c_[old['xa'],np.concatenate(xa)]
    np.savez_compressed(RICH_CACHE/f'{year}.npz',xh=h,xa=a,snapshot_x=np.c_[old['snapshot_x'],snapshot])
    print('Rich dated features',year,h.shape,flush=True)

if __name__=='__main__':
    RICH_CACHE.mkdir(exist_ok=True)
    (OUT/'rich-features.json').write_text(json.dumps(RICH_NAMES,indent=2)+'\n')
    with ProcessPoolExecutor(max_workers=3) as pool:
        for result in pool.map(build,YEARS+[2026]):pass
