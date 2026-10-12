"""Score rating where each game's result mixes the points margin with the EPA margin from play-by-play."""
import numpy as np
import prior as P
from units import agg

def epa_margin(S, idx, garbage=True, st=True, kind="epa", k_sr=120.0):
    """Home-perspective EPA margin per game (NaN when no play-by-play)."""
    A = agg(S.year); out = np.full(len(idx), np.nan)
    for k, g in enumerate(S.gid[idx]):
        rows = A.get(int(g))
        if not rows or len(rows) != 2: continue
        h = S.ids[S.home[idx[k]]]
        hr = [r for r in rows if int(r["team"]) == h]; ar = [r for r in rows if int(r["team"]) != h]
        if not hr or not ar: continue
        if kind == "sr":   # success-rate margin, scaled to points
            e = k_sr * (float(hr[0]["off_succ"]) / max(1, float(hr[0]["off_n"])) - float(ar[0]["off_succ"]) / max(1, float(ar[0]["off_n"])))
        else:
            col = {"epa": "off_epa" if garbage else "off_epa_ng", "noto": "off_epa_noto"}[kind]
            e = float(hr[0][col]) - float(ar[0][col])
        if st: e += float(hr[0]["st_epa"])
        out[k] = e
    return out

def fit(S, idx, beta=0.5, garbage=True, st=True, rho=0.9, lam_p=2.0, bonus=3.0, kind="epa", k_sr=120.0):
    n = S.n
    p = P.prior_mean(S, rho, 0.0, dict(layers=False, bonus=bonus, lam_t=0.005))
    h, a = S.home[idx], S.away[idx]
    m = (S.hp[idx] - S.ap[idx]).astype(float); y0 = m + bonus * np.sign(m)
    e = epa_margin(S, idx, garbage, st, kind, k_sr)
    y = np.where(np.isnan(e), y0, (1 - beta) * y0 + beta * e)
    home = (~S.neutral[idx]).astype(float)
    A = np.zeros((n + 1, n + 1))
    np.add.at(A, (h, h), 1); np.add.at(A, (a, a), 1); np.add.at(A, (h, a), -1); np.add.at(A, (a, h), -1)
    np.add.at(A, (h, n), home); np.add.at(A, (a, n), -home); A[n, :n] = A[:n, n]; A[n, n] = home.sum() + 1e-4
    A[np.arange(n), np.arange(n)] += lam_p
    b = np.zeros(n + 1); b[:n] = np.bincount(h, y, n) - np.bincount(a, y, n) + lam_p * p; b[n] = (home * y).sum()
    return np.linalg.solve(A, b)[:n]
