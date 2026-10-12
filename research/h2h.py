"""Margin rating + fewest upsets: accept the fewest upsets a local search finds, then refit with a stop
holding every other winner at least `gap` above its loser (stiff one-sided penalty, Newton with exact line search)."""
import numpy as np
from models import fewest_order

def solve(S, idx, kept=None, bonus=3.0, shrink=0.05, K=1000.0, gap=0.5, start=None):
    n = S.n
    h, a = S.home[idx], S.away[idx]
    m = (S.hp[idx] - S.ap[idx]).astype(float); y = m + bonus * np.sign(m)
    x = (~S.neutral[idx]).astype(float)
    w = np.where(m > 0, h, a); l = np.where(m > 0, a, h)
    N = n + 1
    def parts(th):
        r, H = th[:n], th[n]
        res = y - (r[h] - r[a] + H * x)
        d = r[w] - r[l]
        act = (kept & (d < gap)) if kept is not None else np.zeros(len(idx), bool)   # gap may be a per-game array
        return res, d, act
    def obj(th):
        res, d, act = parts(th)
        g = gap[act] if np.ndim(gap) else gap
        return (res ** 2).sum() + shrink * (th[:n] ** 2).sum() + 1e-4 * th[n] ** 2 + K * ((g - d[act]) ** 2).sum()
    th = np.zeros(N) if start is None else start.copy()
    for _ in range(100):
        res, d, act = parts(th)
        A = np.zeros((N, N)); b = np.zeros(N)
        # least squares part (Gauss-Newton is exact: residuals are linear)
        np.add.at(A, (h, h), 1); np.add.at(A, (a, a), 1); np.add.at(A, (h, a), -1); np.add.at(A, (a, h), -1)
        np.add.at(A, (h, n), x); np.add.at(A, (a, n), -x); np.add.at(A, (n, h), x); np.add.at(A, (n, a), -x); A[n, n] += (x * x).sum() + 1e-4
        np.add.at(b, h, y); np.add.at(b, a, -y); b[n] += (x * y).sum()
        A[np.arange(n), np.arange(n)] += shrink
        # stops on active kept games: K (gap - (r_w - r_l))^2
        ww, ll = w[act], l[act]
        np.add.at(A, (ww, ww), K); np.add.at(A, (ll, ll), K); np.add.at(A, (ww, ll), -K); np.add.at(A, (ll, ww), -K)
        g = gap[act] if np.ndim(gap) else gap
        np.add.at(b, ww, K * g); np.add.at(b, ll, -K * g)
        new = np.linalg.solve(A, b)
        _, d2, act2 = parts(new)
        if np.array_equal(act2, act): return new
        # line search along new - th (halving) on the true objective
        step = new - th; e0 = obj(th); t = 1.0
        while obj(th + t * step) >= e0 and t > 1e-10: t /= 2
        th = th + t * step
    return th

def fit(S, idx, **kw):
    base = solve(S, idx)
    r = base[:S.n]
    m = S.hp[idx] - S.ap[idx]
    w = np.where(m > 0, S.home[idx], S.away[idx]); l = np.where(m > 0, S.away[idx], S.home[idx])
    order = fewest_order(S.n, w, l, sorted(range(S.n), key=lambda i: (-r[i], i)))
    place = np.empty(S.n, int); place[order] = np.arange(S.n)
    kept = place[w] < place[l]
    return solve(S, idx, kept=kept, start=base)[:S.n]

def plain(S, idx):
    return solve(S, idx)[:S.n]
