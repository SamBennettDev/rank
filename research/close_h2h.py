"""Head-to-head as a tiebreaker for close teams: if a team is rated below a team it beat by less than
`window` points, hold it `gap` above that team and refit the whole ladder. Repeat until no new close upset
appears. Holds that would contradict earlier ones (a cycle) are skipped; closest first."""
import numpy as np
from h2h import solve

def fit(S, idx, window=3.0, gap=0.5, rounds=20):
    th = solve(S, idx)
    m = S.hp[idx] - S.ap[idx]
    w = np.where(m > 0, S.home[idx], S.away[idx]); l = np.where(m > 0, S.away[idx], S.home[idx])
    kept = np.zeros(len(idx), bool)
    above = {}   # enforced: winner -> set of teams it must stay above (transitively checked)
    def reaches(a, b):   # is a already required to be above b (path a -> ... -> b)?
        stack, seen = [a], set()
        while stack:
            x = stack.pop()
            if x == b: return True
            if x in seen: continue
            seen.add(x); stack.extend(above.get(x, ()))
        return False
    for _ in range(rounds):
        r = th[:S.n]
        short = r[l] - r[w]                      # > 0: loser rated above winner
        cand = np.flatnonzero(~kept & (short > -gap * 0.999) & (short < window))
        cand = cand[np.lexsort((S.gid[idx][cand], short[cand]))]   # closest first, then game id
        added = False
        for k in cand:
            a, b = w[k], l[k]
            if reaches(b, a): continue           # would form a cycle with holds already in place
            above.setdefault(a, set()).add(b); kept[k] = True; added = True
        if not added: break
        th = solve(S, idx, kept=kept, start=th, gap=gap)
    return th[:S.n]
