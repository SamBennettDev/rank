"""Known rating algorithms. Each takes (S, idx) = season and training-game indices and returns ratings (higher = better)."""
import numpy as np

def games(S, idx):
    h, a, hp, ap = S.home[idx], S.away[idx], S.hp[idx], S.ap[idx]
    w = np.where(hp > ap, h, a); l = np.where(hp > ap, a, h)
    m = np.abs(hp - ap)
    return h, a, hp, ap, w, l, m

def laplacian(n, i, j, wt=None):
    wt = np.ones(len(i)) if wt is None else wt
    L = np.zeros((n, n))
    np.add.at(L, (i, i), wt); np.add.at(L, (j, j), wt); np.add.at(L, (i, j), -wt); np.add.at(L, (j, i), -wt)
    return L

# ---------------------------------------------------------------- simple
def winpct(S, idx):
    h, a, hp, ap, w, l, m = games(S, idx)
    W = np.bincount(w, minlength=S.n); Lo = np.bincount(l, minlength=S.n)
    return (W + 0.5) / (W + Lo + 1)

def pythag(S, idx, k=2.37):
    h, a, hp, ap, *_ = games(S, idx)
    PF = np.bincount(h, hp, S.n) + np.bincount(a, ap, S.n); PA = np.bincount(h, ap, S.n) + np.bincount(a, hp, S.n)
    return (PF + 1) ** k / ((PF + 1) ** k + (PA + 1) ** k)

def colley(S, idx):
    h, a, hp, ap, w, l, m = games(S, idx)
    C = 2 * np.eye(S.n) + laplacian(S.n, w, l)
    b = 1 + (np.bincount(w, minlength=S.n) - np.bincount(l, minlength=S.n)) / 2
    return np.linalg.solve(C, b)

# ---------------------------------------------------------------- least squares family
def massey(S, idx, lam=0.01, cap=None, hfa=False, win_gap=None):
    """Least squares on (transformed) margins. win_gap: use fixed gap per win instead of margin."""
    h, a, hp, ap, w, l, m = games(S, idx)
    y = (hp - ap).astype(float)
    if cap is not None: y = np.clip(y, -cap, cap)
    if win_gap is not None: y = np.sign(y) * win_gap
    n = S.n
    if not hfa:
        A = laplacian(n, h, a) + lam * np.eye(n)
        b = np.bincount(h, y, n) - np.bincount(a, y, n)
        return np.linalg.solve(A, b)
    # extra unknown: home advantage (0 for neutral)
    x = (~S.neutral[idx]).astype(float)
    A = np.zeros((n + 1, n + 1)); A[:n, :n] = laplacian(n, h, a) + lam * np.eye(n)
    np.add.at(A, (h, n), x); np.add.at(A, (a, n), -x); A[n, :n] = A[:n, n]; A[n, n] = (x * x).sum() + lam
    b = np.zeros(n + 1); b[:n] = np.bincount(h, y, n) - np.bincount(a, y, n); b[n] = (x * y).sum()
    r = np.linalg.solve(A, b)
    return r[:n]

# ---------------------------------------------------------------- probabilistic
def bradley_terry(S, idx, prior=1.0, iters=50):
    """MAP logistic Bradley-Terry with N(0, prior^2) on ratings."""
    h, a, hp, ap, w, l, m = games(S, idx)
    r = np.zeros(S.n)
    for _ in range(iters):
        d = r[w] - r[l]; p = 1 / (1 + np.exp(-d))
        g = -r / prior**2; np.add.at(g, w, 1 - p); np.add.at(g, l, -(1 - p))
        H = laplacian(S.n, w, l, p * (1 - p)) + np.eye(S.n) / prior**2
        step = np.linalg.solve(H, g); r += step
        if np.abs(step).max() < 1e-9: break
    return r

def elo(S, idx, K=30, mov=True, hfa=0.0, passes=1, start=None):
    """In-season Elo (from 0, or `start`), chronological; 538-style margin multiplier."""
    r = np.zeros(S.n) if start is None else start.copy()
    for _ in range(passes):
        for g in idx:
            h, a = S.home[g], S.away[g]; adv = 0 if S.neutral[g] else hfa
            d = r[h] + adv - r[a]; e = 1 / (1 + 10 ** (-d / 400))
            s = 1.0 if S.hp[g] > S.ap[g] else 0.0
            mult = 1.0
            if mov:
                md = abs(S.hp[g] - S.ap[g]); dw = d if s == 1 else -d
                mult = np.log(md + 1) * 2.2 / (dw * 0.001 + 2.2)
            r[h] += K * mult * (s - e); r[a] -= K * mult * (s - e)
    return r

# ---------------------------------------------------------------- eigenvector / Markov
def keener(S, idx, eps=1e-3):
    h, a, hp, ap, *_ = games(S, idx); n = S.n
    Sm = np.zeros((n, n)); np.add.at(Sm, (h, a), hp); np.add.at(Sm, (a, h), ap)
    G = np.zeros((n, n)); np.add.at(G, (h, a), 1); np.add.at(G, (a, h), 1)
    A = np.where(G > 0, (Sm + 1) / (Sm + Sm.T + 2), 0.0)
    A = np.where(G > 0, 0.5 + 0.5 * np.sign(A - 0.5) * np.sqrt(np.abs(2 * A - 1)), 0.0)
    ng = G.sum(1); A = A / np.maximum(ng, 1)[:, None] + eps
    v = np.ones(n) / n
    for _ in range(500): v2 = A @ v; v2 /= v2.sum(); 
    return v2

def lrmc(S, idx, scale=0.06, h0=2.5):
    h, a, hp, ap, *_ = games(S, idx); n = S.n
    x = (hp - ap) - np.where(S.neutral[idx], 0, h0)
    r = 1 / (1 + np.exp(-scale * x))   # prob home is the better team
    T = np.zeros((n, n))
    np.add.at(T, (h, a), 1 - r); np.add.at(T, (h, h), r); np.add.at(T, (a, h), r); np.add.at(T, (a, a), 1 - r)
    deg = T.sum(1); T[deg == 0, np.arange(n)[deg == 0]] = 1; T /= T.sum(1)[:, None]
    T = 0.999 * T + 0.001 / n
    pi = np.ones(n) / n
    for _ in range(2000): pi = pi @ T
    return pi

def pagerank(S, idx, d=0.85, margin=False):
    h, a, hp, ap, w, l, m = games(S, idx); n = S.n
    M = np.zeros((n, n)); np.add.at(M, (l, w), m if margin else 1.0)
    out = M.sum(1); dang = out == 0; M[~dang] /= out[~dang][:, None]; M[dang] = 1 / n
    v = np.ones(n) / n
    for _ in range(300): v = (1 - d) / n + d * (v @ M)
    return v

# ---------------------------------------------------------------- our engines (ported)
def oneway(S, idx, gaps, alpha=0.01, tau=7.0, kept=None, start=None):
    h, a, hp, ap, w, l, m = games(S, idx); n = S.n
    s = np.zeros(n) if start is None else start.copy()
    def energy(s):
        d = s[w] - s[l]; u = (d - gaps) / tau
        e = (tau / 2 * (np.sqrt(1 + u * u) - u)).sum() + alpha / 2 * (s * s).sum()
        if kept is not None: e += 500 * (np.maximum(0, 0.5 - d) ** 2 * kept).sum()
        return e
    for _ in range(200):
        d = s[w] - s[l]; u = (d - gaps) / tau; rr = np.sqrt(1 + u * u)
        f = (1 - u / rr) / 2; k = 1 / (2 * tau * rr ** 3)
        if kept is not None:
            act = kept & (d < 0.5); f = f + 1000 * (0.5 - d) * act; k = k + 1000 * act
        g = alpha * s; np.add.at(g, w, -f); np.add.at(g, l, f)
        H = laplacian(n, w, l, k) + alpha * np.eye(n)
        step = np.linalg.solve(H, -g); e0 = energy(s); t = 1.0
        while energy(s + t * step) > e0 and t > 1e-12: t /= 2
        s = s + t * step
        if np.abs(step).max() * t < 1e-9: break
    return s

def fewest_order(n, w, l, start):
    won = [[] for _ in range(n)]; lost = [[] for _ in range(n)]
    for x, y in zip(w, l): won[x].append(y); lost[y].append(x)
    order = list(start)
    while True:
        moved = False
        for t in range(n):
            if not won[t] and not lost[t]: continue
            cur = order.index(t); rest = order[:cur] + order[cur + 1:]
            pos = {x: i for i, x in enumerate(rest)}
            step = np.zeros(len(rest) + 1, int)
            for x in lost[t]: step[pos[x] + 1] -= 1
            for x in won[t]: step[pos[x] + 1] += 1
            costs = len(lost[t]) + np.cumsum(step)
            cur_cost = costs[cur]; best = costs.min()
            if best < cur_cost:
                cands = np.flatnonzero(costs == best); p = cands[np.argmin(np.abs(cands - cur))]
                rest.insert(p, t); order = rest; moved = True
        if not moved: return order

def engine(S, idx, method="win", alpha=0.01, tau=7.0):
    h, a, hp, ap, w, l, m = games(S, idx)
    gaps = np.full(len(w), 7.0) if method == "win" else m.astype(float)
    first = oneway(S, idx, gaps, alpha, tau)
    order = fewest_order(S.n, w, l, sorted(range(S.n), key=lambda i: (-first[i], i)))
    place = np.empty(S.n, int); place[order] = np.arange(S.n)
    kept = place[w] < place[l]
    return oneway(S, idx, gaps, alpha, tau, kept=kept, start=first)

# ---------------------------------------------------------------- Elo with season-to-season carryover
_elo_final = {}
def elo_final(year, K, regress, hfa, mov=True):
    """Final in-season Elo of `year`, each season starting from the previous one regressed toward the mean."""
    from bench import season
    key = (year, K, regress, hfa, mov)
    if key in _elo_final: return _elo_final[key]
    try: S = season(year)
    except Exception: return {}
    start = elo_start(S, K, regress, hfa, mov)
    r = elo(S, np.arange(len(S.gid)), K=K, mov=mov, hfa=hfa, start=start)
    _elo_final[key] = dict(zip(S.ids, r)); return _elo_final[key]

def elo_start(S, K, regress, hfa, mov=True):
    if S.year <= 2008: return np.where(S.fbs == 1, 0.0, -400.0)
    prev = elo_final(S.year - 1, K, regress, hfa, mov)
    vals = np.array([prev.get(t, np.nan) for t in S.ids])
    for div in (0, 1):
        sel = S.fbs == div; known = sel & ~np.isnan(vals)
        vals[sel & np.isnan(vals)] = np.nanmean(vals[known]) if known.any() else (0.0 if div else -400.0)
    mean = vals[S.fbs == 1].mean()
    return mean + (1 - regress) * (vals - mean)

def elo_carry(S, idx, K=30, regress=0.33, hfa=55, mov=True):
    return elo(S, idx, K=K, mov=mov, hfa=hfa, start=elo_start(S, K, regress, hfa, mov))
