"""Record term: rank by rating + K * (wins - losses) / games, i.e. K points for going from .500 to unbeaten (K/2 each way)."""
from functools import partial
from multiprocessing import Pool
import numpy as np
import close_rec
from bench import evaluate, season
SETS = {"2014-19": [2014, 2015, 2016, 2017, 2018, 2019], "2021-26": [2021, 2022, 2023, 2024, 2025, 2026]}
K = (0, 4, 6, 8, 10, 14, 18, 22, 24, 26, 30)
def with_record(S, idx, k):
    return close_rec.fit(S, idx, k=k)
def run(job):
    name, k = job
    r = evaluate(partial(with_record, k=k), SETS[name], retro=True)
    return name, k, r["acc"], r["retro"]
if __name__ == "__main__":
    with Pool(4) as p: res = p.map(run, [(n, k) for n in SETS for k in K])
    for n in SETS:
        print(n)
        for name, k, acc, retro in res:
            if name == n: print(f"  record weight {k:>2}: next-week {acc*100:5.2f}%   winner above loser at end {retro*100:5.1f}%")
    S = season(2026); idx = np.arange(len(S.gid))
    for k in K:
        r = with_record(S, idx, k); order = np.argsort(-r); rank = {S.names[i]: j + 1 for j, i in enumerate(order)}
        top = [S.names[i] for i in order[:25]]
        W = {}; L = {}
        m = S.hp - S.ap
        for g in range(len(S.gid)):
            w, l = (S.home[g], S.away[g]) if m[g] > 0 else (S.away[g], S.home[g]); W[w] = W.get(w, 0) + 1; L[l] = L.get(l, 0) + 1
        twoloss = [f"{S.names[i]} #{j+1}" for j, i in enumerate(order[:25]) if L.get(i, 0) >= 2]
        print(f"  2026 wk6, weight {k:>2}: Oregon #{rank['Oregon']}, Utah #{rank['Utah']}, LSU #{rank['LSU']} | 2+ loss teams in top 25: {', '.join(twoloss) or 'none'}")
