from functools import partial
from multiprocessing import Pool
import numpy as np
import close_h2h
from bench import evaluate, season
SETS = {"2014-19": [2014, 2015, 2016, 2017, 2018, 2019], "2021-26": [2021, 2022, 2023, 2024, 2025, 2026]}
B = (3, 7, 10, 14, 21, 28)
def run(job):
    name, b = job
    r = evaluate(partial(close_h2h.fit, bonus=b), SETS[name], retro=True)
    return name, b, r["acc"], r["retro"]
if __name__ == "__main__":
    with Pool(4) as p: res = p.map(run, [(n, b) for n in SETS for b in B])
    for n in SETS:
        print(n)
        for name, b, acc, retro in res:
            if name == n: print(f"  win bonus {b:>2}: next-week {acc*100:5.2f}%   winner above loser at end {retro*100:5.1f}%")
    S = season(2026); idx = np.arange(len(S.gid))
    for b in B:
        r = close_h2h.fit(S, idx, bonus=b); order = np.argsort(-r); rank = {S.names[i]: k + 1 for k, i in enumerate(order)}
        print(f"  2026 wk6, bonus {b:>2}: Utah #{rank['Utah']}, Oregon #{rank['Oregon']}, LSU #{rank['LSU']}, Indiana #{rank['Indiana']}, Notre Dame #{rank['Notre Dame']}, Oklahoma #{rank['Oklahoma']}")
