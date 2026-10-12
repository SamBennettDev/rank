import json, sys
from functools import partial
from multiprocessing import Pool
import numpy as np
import close_h2h, h2h
from bench import evaluate
SETS = {"2014-19": [2014, 2015, 2016, 2017, 2018, 2019], "2021-26": [2021, 2022, 2023, 2024, 2025, 2026]}
def run(job):
    name, window = job
    f = h2h.plain if window == 0 else partial(close_h2h.fit, window=window)
    r = evaluate(f, SETS[name], retro=True)
    return name, window, r["acc"], r["retro"]
if __name__ == "__main__":
    jobs = [(n, w) for n in SETS for w in (0, 1, 3, 5, 7, 10, 14)]
    with Pool(4) as p:
        res = p.map(run, jobs)
    for n in SETS:
        print(n)
        for name, w, acc, retro in res:
            if name == n: print(f"  window {w:>2} pts: next-week {acc*100:5.2f}%   winner above loser at end {retro*100:5.1f}%")
