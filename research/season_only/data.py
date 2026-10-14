"""Date-based batches and current-season-only numeric inputs."""
from dataclasses import dataclass
from pathlib import Path
import hashlib
import numpy as np
import pandas as pd
from prepare import ROOT, HERE, INPUT, YEARS

MONDAY = pd.Timestamp('1970-01-05T12:00:00Z').timestamp()
WEEK = 7 * 86400
LAG = 6 * 3600

@dataclass
class Season:
    year: int
    ids: np.ndarray
    names: list
    fbs: np.ndarray
    games: pd.DataFrame
    plays: pd.DataFrame
    n: int

def load(year):
    if year == 2026:
        raw = pd.read_csv(ROOT / 'data/seasons/2026/games.csv')
        teams = pd.read_csv(ROOT / 'data/seasons/2026/teams.csv').sort_values('id')
        g = raw.rename(columns={'id':'game_id','home_id':'home','away_id':'away'})
        plays = pd.read_csv(ROOT / 'data/seasons/2026/plays.csv')
        plays['spread'] = np.nan
        for name in ['snaps','epa','success']:
            plays['all_' + name] = plays[name]
        ids = teams.id.to_numpy(int); names = teams.school.tolist()
        fbs = (teams.classification == 'fbs').to_numpy()
    else:
        raw = pd.read_csv(INPUT / f'games_{year}.csv')
        ok = raw.home_division.isin(['fbs','fcs']) & raw.away_division.isin(['fbs','fcs'])
        g = raw[ok].copy().rename(columns={'home_id':'home','away_id':'away'})
        info = {}
        for r in g.itertuples():
            info[int(r.home)] = (r.home_team, r.home_division == 'fbs')
            info[int(r.away)] = (r.away_team, r.away_division == 'fbs')
        ids = np.array(sorted(info)); names = [info[i][0] for i in ids]
        fbs = np.array([info[i][1] for i in ids])
        plays = pd.read_csv(INPUT / f'plays_{year}.csv')
    g = g[g.completed.astype(str).str.lower().eq('true') & g.home_points.notna() & g.away_points.notna() & g.home_points.ne(g.away_points)].copy()
    ix = {t:i for i,t in enumerate(ids)}
    g = g[g.home.isin(ix) & g.away.isin(ix)].copy()
    g['h'] = g.home.map(ix).astype(int); g['a'] = g.away.map(ix).astype(int)
    g['time'] = pd.to_datetime(g.start_date, utc=True, errors='raise').astype('int64') / 1e9
    # pandas datetime resolution can be us or ns; explicitly use timestamp.
    g['time'] = pd.to_datetime(g.start_date, utc=True).map(lambda x:x.timestamp())
    g['batch'] = MONDAY + np.floor((g.time - MONDAY) / WEEK) * WEEK
    g['margin'] = g.home_points - g.away_points
    g['venue'] = (~g.neutral_site.astype(bool)).astype(float)
    g = g.sort_values(['time','game_id']).reset_index(drop=True)
    assert not g.game_id.duplicated().any()
    plays = plays[plays.team_id.isin(ix) & plays.opponent_id.isin(ix) & plays.game_id.isin(g.game_id)].copy()
    plays['t'] = plays.team_id.map(ix).astype(int); plays['u'] = plays.opponent_id.map(ix).astype(int)
    gm = g.set_index('game_id')
    plays['site'] = np.where(plays.team_id == plays.game_id.map(gm.home),1,-1) * plays.game_id.map(gm.venue)
    assert not plays[['game_id','team_id']].duplicated().any().any()
    return Season(year, ids, names, fbs, g, plays, len(ids))

def batches(s, start_week=4):
    for cutoff in sorted(s.games.batch.unique()):
        test = np.flatnonzero((s.games.batch == cutoff) & ((s.games.week >= start_week) | (s.games.season_type == 'postseason')))
        if not len(test): continue
        train = np.flatnonzero(s.games.time + LAG <= cutoff)
        assert np.all(s.games.time.iloc[train] + LAG <= cutoff)
        assert np.all(s.games.time.iloc[test] >= cutoff)
        yield float(cutoff), train, test

def week6(s):
    through = (s.games.season_type == 'regular') & (s.games.week <= 6)
    if s.year == 2026:
        cutoff = pd.Timestamp('2026-10-11T08:30:00Z').timestamp()
    else:
        cutoff = float((s.games.loc[through,'time'] + LAG).max())
    train = np.flatnonzero(through & (s.games.time + LAG <= cutoff))
    test = np.flatnonzero((s.games.time >= cutoff) & ~through)
    return cutoff, train, test

def game_metadata(s, indices, cutoff, mode):
    g = s.games.iloc[indices]
    return pd.DataFrame(dict(year=s.year, game_id=g.game_id.to_numpy(int), cutoff=cutoff, mode=mode,
        start_date=g.start_date.to_numpy(), week=g.week.to_numpy(), postseason=(g.season_type=='postseason').to_numpy(),
        home=g.home.to_numpy(int), away=g.away.to_numpy(int), h=g.h.to_numpy(int), a=g.a.to_numpy(int),
        home_name=g.home_team.to_numpy(), away_name=g.away_team.to_numpy(), venue=g.venue.to_numpy(),
        y=(g.margin>0).to_numpy(float), margin=g.margin.to_numpy(float),
        fbs=(s.fbs[g.h.to_numpy()] & s.fbs[g.a.to_numpy()])))
