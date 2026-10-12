"""Season-to-season prior: each team's rating starts at rho * (last season's final rating) and is
pulled toward it with strength lam_p; this season's games take over as they accumulate."""
import numpy as np
from bench import season
import layered

_cache = {}
def last_season_ratings(year, **cfg):
    """Final ratings from the previous season (all games), keyed by team id, centred on the FBS mean."""
    key = (year, tuple(sorted(cfg.items())))
    if key not in _cache:
        P = season(year - 1)
        R = layered.fit(P, np.arange(len(P.gid)), **cfg)
        R = R - R[P.fbs == 1].mean()
        _cache[key] = dict(zip(P.ids, R))
    return _cache[key]

def prior_mean(S, rho, rho2, base, rho_conf=None):
    def get(year):
        prev = last_season_ratings(year, **base)
        known = np.array([t in prev for t in S.ids]); p = np.array([prev.get(t, np.nan) for t in S.ids])
        for div in (0, 1):
            sel = (S.fbs == div)
            fill = np.nanmean(np.where(known & sel, p, np.nan)) if (known & sel).any() else 0.0
            p[sel & ~known] = fill
        return p
    last = get(S.year)
    if rho_conf is None:
        p = rho * last
    else:
        # team part regresses with rho, conference average (this season's membership) with rho_conf
        cm = np.array([last[S.conf == S.conf[i]].mean() for i in range(S.n)])
        p = rho * (last - cm) + rho_conf * cm
    if rho2: p = p + rho2 * get(S.year - 1)
    return p

def fit(S, idx, rho=0.6, lam_p=0.05, base=None, decay=1.0, bonus=3.0, lam_t=0.005, rho2=0.0, rho_conf=None, **kw):
    """Massey-style margin fit (with win bonus and home field) plus a ridge toward rho * last season."""
    base = base or dict(layers=False, bonus=bonus, lam_t=lam_t)
    n = S.n
    p = prior_mean(S, rho, rho2, base, rho_conf)
    h, a = S.home[idx], S.away[idx]
    m = (S.hp[idx] - S.ap[idx]).astype(float); y = m + bonus * np.sign(m)
    home = (~S.neutral[idx]).astype(float)
    wgt = decay ** (S.order[idx].max() - S.order[idx]).astype(float)
    # weighted least squares: sum w (y - (r_h - r_a + hfa*home))^2 + lam_p sum (r - p)^2 + lam_t sum r^2(eps)
    A = np.zeros((n + 1, n + 1))
    np.add.at(A, (h, h), wgt); np.add.at(A, (a, a), wgt); np.add.at(A, (h, a), -wgt); np.add.at(A, (a, h), -wgt)
    np.add.at(A, (h, n), wgt * home); np.add.at(A, (a, n), -wgt * home); A[n, :n] = A[:n, n]; A[n, n] = (wgt * home).sum() + 1e-4
    A[np.arange(n), np.arange(n)] += lam_p
    b = np.zeros(n + 1); b[:n] = np.bincount(h, wgt * y, n) - np.bincount(a, wgt * y, n) + lam_p * p; b[n] = (wgt * home * y).sum()
    return np.linalg.solve(A, b)[:n]
