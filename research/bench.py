"""Walk-forward benchmark: for each week, fit on earlier games only, predict that week's games."""
import sys, time
import numpy as np
from data import load

SEASONS = {}
def season(y):
    if y not in SEASONS: SEASONS[y] = load(y)
    return SEASONS[y]

def evaluate(model, years, start_week=4, retro=True):
    """model(S, idx) -> ratings. Returns dict with accuracy (ties count 1/2), n, per-game outcomes."""
    outcomes = []; agree = []; 
    for y in years:
        S = season(y)
        for wk in range(start_week, S.order.max() + 1):
            train = np.flatnonzero(S.order < wk); test = np.flatnonzero(S.order == wk)
            if len(train) == 0 or len(test) == 0: continue
            played = np.zeros(S.n, bool); played[S.home[train]] = True; played[S.away[train]] = True
            test = test[played[S.home[test]] & played[S.away[test]]]
            if len(test) == 0: continue
            r = model(S, train)
            w = np.where(S.hp[test] > S.ap[test], S.home[test], S.away[test]); l = np.where(S.hp[test] > S.ap[test], S.away[test], S.home[test])
            outcomes.extend(np.where(r[w] > r[l], 1.0, np.where(r[w] == r[l], 0.5, 0.0)))
        if retro:
            allg = np.arange(len(S.gid)); r = model(S, allg)
            w = np.where(S.hp > S.ap, S.home, S.away); l = np.where(S.hp > S.ap, S.away, S.home)
            agree.extend(np.where(r[w] > r[l], 1.0, np.where(r[w] == r[l], 0.5, 0.0)))
    o = np.array(outcomes)
    return dict(acc=o.mean(), n=len(o), outcomes=o, retro=np.mean(agree) if agree else np.nan)

def cfbd_elo(years, start_week=4):
    """External benchmark: CFBD pregame Elo (carries ratings across seasons). Only games where both teams have Elo."""
    o = []
    for y in years:
        S = season(y)
        for wk in range(start_week, S.order.max() + 1):
            test = np.flatnonzero(S.order == wk)
            train = np.flatnonzero(S.order < wk)
            played = np.zeros(S.n, bool); played[S.home[train]] = True; played[S.away[train]] = True
            test = test[played[S.home[test]] & played[S.away[test]] & ~np.isnan(S.helo[test]) & ~np.isnan(S.aelo[test])]
            hw = S.hp[test] > S.ap[test]; d = S.helo[test] - S.aelo[test]
            o.extend(np.where(d == 0, 0.5, ((d > 0) == hw).astype(float)))
    return np.array(o)

def elo_subset_mask(years, start_week=4):
    """Mask aligned with evaluate() outcomes: True where both teams have CFBD Elo."""
    m = []
    for y in years:
        S = season(y)
        for wk in range(start_week, S.order.max() + 1):
            train = np.flatnonzero(S.order < wk); test = np.flatnonzero(S.order == wk)
            if len(train) == 0 or len(test) == 0: continue
            played = np.zeros(S.n, bool); played[S.home[train]] = True; played[S.away[train]] = True
            test = test[played[S.home[test]] & played[S.away[test]]]
            m.extend(~np.isnan(S.helo[test]) & ~np.isnan(S.aelo[test]))
    return np.array(m, bool)
