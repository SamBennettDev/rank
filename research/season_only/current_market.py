"""A clearly labeled spread-implied Week 6 comparison, never a neural feature."""
import json
from pathlib import Path
from dataclasses import replace
import numpy as np
import pandas as pd
import pyarrow.parquet as pq
from prepare import HERE,INPUT,digest,download
from data import load,week6
from models import rating
from build import OUT

REV='8c248d2acdf625327b5167df4b0a52cbb03a74ce'
URL=f'https://raw.githubusercontent.com/sportsdataverse/cfbfastR-cfb-data/{REV}/cfb/betting/parquet/betting_2026.parquet'
SCHEDULE_URL=f'https://raw.githubusercontent.com/sportsdataverse/cfbfastR-cfb-data/{REV}/cfb/cfb_schedules/parquet/cfb_schedules_2026.parquet'

def main():
    raw=Path('/tmp/rank-season-only/betting_2026.parquet');download(URL,raw)
    odds=pq.read_table(raw).to_pandas();s=load(2026);cut,tr,_=week6(s)
    ids=set(s.games.iloc[tr].game_id)
    odds=odds[odds.game_id.isin(ids)&odds.home_team_spread.notna()].copy()
    schedule_path=Path('/tmp/rank-season-only/market_schedule_2026.parquet');download(SCHEDULE_URL,schedule_path)
    schedule=pq.read_table(schedule_path,columns=['game_id','home_id','away_id']).to_pandas()
    odds=odds.merge(schedule.rename(columns={'home_id':'quote_home_id','away_id':'quote_away_id'}),on='game_id',validate='one_to_one')
    canonical=s.games.set_index('game_id')
    odds['canonical_home_id']=odds.game_id.map(canonical.home)
    odds['canonical_away_id']=odds.game_id.map(canonical.away)
    normal=(odds.quote_home_id==odds.canonical_home_id)&(odds.quote_away_id==odds.canonical_away_id)
    reverse=(odds.quote_home_id==odds.canonical_away_id)&(odds.quote_away_id==odds.canonical_home_id)
    if not (normal|reverse).all():raise ValueError('Current quote teams differ from scheduled participants')
    odds.loc[reverse,'home_team_spread']=-odds.loc[reverse,'home_team_spread']
    path=INPUT/'week6-2026-spreads.csv';odds[['game_id','home_team_spread','odds_source','quote_home_id','quote_away_id','canonical_home_id','canonical_away_id']].to_csv(path,index=False)
    g=s.games.copy();g['market_spread']=g.game_id.map(odds.set_index('game_id').home_team_spread)
    train=np.flatnonzero(g.game_id.isin(ids)&g.market_spread.notna())
    g['margin']=-g.market_spread
    ms=replace(s,games=g);strength,hfa,_=rating(ms,train,ridge=.25)
    ranked=pd.read_csv(OUT/'week6-2026-rankings.csv')
    ranked=ranked[ranked.method!='spread_implied_market']
    rows=[]
    for field,mask in [('fbs',s.fbs),('fbs_fcs',np.ones(s.n,bool))]:
        ix=np.flatnonzero(mask);order=ix[np.argsort(-strength[ix],kind='stable')]
        pos=dict(zip(ix,pd.Series(strength[ix]).round(10).rank(method='min',ascending=False).astype(int)))
        for i in order:rows.append(dict(method='spread_implied_market',field=field,rank=pos[i],team_id=int(s.ids[i]),team=s.names[i],score=float(strength[i])))
    pd.concat([ranked,pd.DataFrame(rows)],ignore_index=True).to_csv(OUT/'week6-2026-rankings.csv',index=False,float_format='%.10f')
    counts=np.bincount(g.h.iloc[train],minlength=s.n)+np.bincount(g.a.iloc[train],minlength=s.n)
    (OUT/'current-market-source.json').write_text(json.dumps(dict(url=URL,raw_sha256=digest(raw),compact_sha256=digest(path),
        cutoff=pd.Timestamp(cut,unit='s',tz='UTC').isoformat(),games=len(train),home_field=float(hfa),
        schedule_url=SCHEDULE_URL,schedule_sha256=digest(schedule_path),canonical_side_reversals=int(reverse.sum()),
        fbs_teams_with_quotes=int((counts[s.fbs]>0).sum()),fbs_teams=int(s.fbs.sum()),
        interpretation='Least-squares strengths fitted to stored game spreads through Week 6, with equal shrink and fitted venue effect. This is an inferred market ranking, not an official sportsbook poll. Quote capture times are unavailable.'),indent=2)+'\n')
    print('Spread-implied ranking:',len(train),'games,',int((counts[s.fbs]>0).sum()),'FBS teams')

if __name__=='__main__':main()
