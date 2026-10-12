"""Rating + record term, with the field-goal tiebreaker applied to the combined score.
score = rating + k * (wins - losses) / games. Holds keep score[winner] >= score[loser] + gap."""
import numpy as np
from h2h import solve

def fit(S, idx, k=6.0, window=3.0, gap=0.5, rounds=20, bonus=3.0):
    m = S.hp[idx] - S.ap[idx]
    w = np.where(m > 0, S.home[idx], S.away[idx]); l = np.where(m > 0, S.away[idx], S.home[idx])
    W = np.bincount(w, minlength=S.n); L = np.bincount(l, minlength=S.n)
    o = k * (W - L) / np.maximum(W + L, 1)
    need = gap - (o[w] - o[l])            # rating gap that makes the score gap reach `gap`
    th = solve(S, idx, bonus=bonus)
    kept = np.zeros(len(idx), bool); above = {}
    def reaches(a, b):
        stack, seen = [a], set()
        while stack:
            x = stack.pop()
            if x == b: return True
            if x in seen: continue
            seen.add(x); stack.extend(above.get(x, ()))
        return False
    for _ in range(rounds):
        sc = th[:S.n] + o
        short = sc[l] - sc[w]
        cand = np.flatnonzero(~kept & (short > -gap * 0.999) & (short < window))
        cand = cand[np.lexsort((S.gid[idx][cand], short[cand]))]
        added = False
        for c in cand:
            a, b = w[c], l[c]
            if reaches(b, a): continue
            above.setdefault(a, set()).add(b); kept[c] = True; added = True
        if not added: break
        th = solve(S, idx, kept=kept, start=th, gap=need, bonus=bonus)
    return th[:S.n] + o
