"""Opponent-adjusted offense / defense / special-teams ratings from play-by-play aggregates.

offense obs  (team T vs U):  EPA per snap = mu + O[T] - D[U] + h * site      weight = snaps
special obs  (per game):     net ST EPA of T = S[T] - S[U]
overall      = snaps_per_game * (O + D) + S        (points per game better than average)
Each unit has a ridge toward its starting point (carry * last season's final unit rating).
"""
import csv, functools
import numpy as np
from bench import season
import prior as P

@functools.lru_cache(None)
def agg(year):
    rows = list(csv.DictReader(open(f"/tmp/rank-pbp/agg_{year}.csv")))
    by_game = {}
    for r in rows:
        by_game.setdefault(int(r["game_id"]), []).append(r)
    return by_game

def fit_units(S, idx, start=None, lam_off=130.0, lam_st=2.0, garbage=False):
    """Returns dict(O, D, S, snaps) for S's team order, using the season's training games idx."""
    n = S.n; ix = {t: i for i, t in enumerate(S.ids)}
    A = agg(S.year)
    rows = [r for g in S.gid[idx] for r in A.get(int(g), []) if int(r["team"]) in ix and int(r["opp"]) in ix]
    ncol = "off_n" if garbage else "off_n_ng"; ecol = "off_epa" if garbage else "off_epa_ng"
    pO, pD, pS = (np.zeros(n),) * 3 if start is None else start
    # ---- offense/defense: unknowns [O(n), D(n), mu, h]
    N = 2 * n + 2
    M = np.zeros((N, N)); b = np.zeros(N)
    snaps = []
    for r in rows:
        w = float(r[ncol])
        if w <= 0: continue
        y = float(r[ecol]) / w
        t, u = ix[int(r["team"])], ix[int(r["opp"])]
        site = 0.0 if r["neutral"] == "True" else (1.0 if r["home"] == "1" else -1.0)
        x = np.zeros(N); x[t] = 1; x[n + u] = -1; x[2 * n] = 1; x[2 * n + 1] = site
        nz = np.flatnonzero(x)
        M[np.ix_(nz, nz)] += w * np.outer(x[nz], x[nz]); b[nz] += w * y * x[nz]
        snaps.append(float(r["off_n"]))
    M[np.arange(n), np.arange(n)] += lam_off; b[:n] += lam_off * pO
    M[n + np.arange(n), n + np.arange(n)] += lam_off; b[n:2 * n] += lam_off * pD
    M[2 * n, 2 * n] += 1e-6; M[2 * n + 1, 2 * n + 1] += 1e-6
    sol = np.linalg.solve(M, b)
    O, D = sol[:n], sol[n:2 * n]
    # ---- special teams: one observation per game (home row), S[T] - S[U]
    L = np.zeros((n, n)); bs = np.zeros(n)
    seen = set()
    for r in rows:
        g = int(r["game_id"])
        if g in seen: continue
        seen.add(g)
        t, u = ix[int(r["team"])], ix[int(r["opp"])]; y = float(r["st_epa"])
        L[t, t] += 1; L[u, u] += 1; L[t, u] -= 1; L[u, t] -= 1; bs[t] += y; bs[u] -= y
    L[np.arange(n), np.arange(n)] += lam_st; bs += lam_st * pS
    Sv = np.linalg.solve(L, bs)
    has = np.zeros(n, bool)
    for r in rows: has[ix[int(r["team"])]] = True
    return dict(O=O, D=D, S=Sv, snaps=np.mean(snaps) if snaps else 70.0, has=has)

@functools.lru_cache(None)
def last_units(year, garbage=False):
    """Final unit ratings from last season (no start), keyed by team id."""
    try: Pv = season(year - 1); agg(year - 1)
    except Exception: return None
    u = fit_units(Pv, np.arange(len(Pv.gid)), garbage=garbage)
    return {t: (u["O"][i], u["D"][i], u["S"][i]) for i, t in enumerate(Pv.ids) if u["has"][i]}

def start_units(S, carry, garbage=False):
    last = last_units(S.year, garbage)
    if not last or carry == 0: return None
    arr = np.array([last.get(t, (np.nan,) * 3) for t in S.ids], float)
    for div in (0, 1):
        sel = S.fbs == div
        for k in range(3):
            col = arr[:, k]; known = sel & ~np.isnan(col)
            col[sel & np.isnan(col)] = col[known].mean() if known.any() else 0.0
    arr = carry * arr
    return arr[:, 0], arr[:, 1], arr[:, 2]

def fit(S, idx, carry=0.7, lam_off=130.0, lam_st=2.0, alpha=0.5, st_w=1.0, garbage=False, parts=False):
    """Blend: (1 - alpha) * score rating + alpha * unit overall (teams with play-by-play this season)."""
    R = P.fit(S, idx, rho=0.9, lam_p=2)
    u = fit_units(S, idx, start_units(S, carry, garbage), lam_off, lam_st, garbage)
    OV = u["snaps"] * (u["O"] + u["D"]) + st_w * u["S"]
    final = np.where(u["has"], (1 - alpha) * R + alpha * OV, R)
    if parts: return final, R, OV, u
    return final
