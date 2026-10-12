import numpy as np
from multiprocessing import Pool
import h2h
from bench import evaluate, fbs_mask
def run(args):
    name, years = args
    f = h2h.fit if name == "fewest upsets" else h2h.plain
    r = evaluate(f, years, retro=True)
    return name, years[0], r["acc"], r["n"], r["retro"]
if __name__ == "__main__":
    jobs = [(nm, ys) for ys in ([2014, 2015, 2016, 2017, 2018, 2019], [2021, 2022, 2023, 2024, 2025, 2026]) for nm in ("current", "fewest upsets")]
    with Pool(4) as p:
        for name, y0, acc, n, retro in p.map(run, jobs):
            print(f"{'2014-19' if y0 == 2014 else '2021-26'}  {name:14s} next-week {acc*100:5.2f}% (n={n})   winner above loser at season end {retro*100:5.1f}%")
