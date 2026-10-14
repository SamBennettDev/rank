"""Refresh player-only feature columns after a source-parser change."""
from concurrent.futures import ProcessPoolExecutor
import numpy as np
import pandas as pd
from common import INPUT,CACHE,YEARS
from data import load,batches,week6
from context_features import _player_profile

def refresh(year):
    s=load(year);players=pd.read_csv(INPUT/f'players_{year}.csv');old=np.load(CACHE/f'{year}.npz')
    data={k:old[k].copy() for k in old.files};h=[];a=[]
    plans=[(tr,te,'weekly') for _,tr,te in batches(s)]
    _,tr,te=week6(s);plans.append((tr,te,'frozen_week6'))
    for tr,te,mode in plans:
        games=s.games.iloc[tr];p=players[players.game_id.isin(games.game_id)]
        groups={int(t):g for t,g in p.groupby('team_id')};x=np.zeros((s.n,16))
        for i,t in enumerate(s.ids):
            own=games[(games.h==i)|(games.a==i)].sort_values(['time','game_id'])
            x[i]=_player_profile(own,groups.get(int(t),p.iloc[:0]))
        if mode=='frozen_week6':data['snapshot_x'][:,48:64]=x
        if len(te):h.append(x[s.games.h.iloc[te]]);a.append(x[s.games.a.iloc[te]])
    data['xh'][:,48:64]=np.concatenate(h);data['xa'][:,48:64]=np.concatenate(a)
    np.savez_compressed(CACHE/f'{year}.npz',**data)
    print('Refreshed canonical player joins',year,flush=True)

if __name__=='__main__':
    with ProcessPoolExecutor(max_workers=3) as pool:
        for _ in pool.map(refresh,YEARS):pass
