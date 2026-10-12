import sys, json
from functools import partial
from multiprocessing import Pool
import numpy as np
import models as M
from bench import evaluate

TRAIN = [2014, 2015, 2016, 2017, 2018, 2019]
CANDS = {
  "win pct": M.winpct,
  "pythagorean": M.pythag,
  "colley": M.colley,
  "massey (margin)": partial(M.massey, lam=0.01),
  "massey cap 14": partial(M.massey, cap=14),
  "massey cap 21": partial(M.massey, cap=21),
  "massey cap 28": partial(M.massey, cap=28),
  "massey +hfa": partial(M.massey, hfa=True),
  "massey cap21 +hfa": partial(M.massey, cap=21, hfa=True),
  "springs win (old)": partial(M.massey, win_gap=7),
  "bradley-terry p=0.5": partial(M.bradley_terry, prior=0.5),
  "bradley-terry p=1": partial(M.bradley_terry, prior=1.0),
  "bradley-terry p=2": partial(M.bradley_terry, prior=2.0),
  "elo K20": partial(M.elo, K=20),
  "elo K40": partial(M.elo, K=40),
  "elo K60": partial(M.elo, K=60),
  "elo K40 x3 passes": partial(M.elo, K=40, passes=3),
  "keener": M.keener,
  "lrmc 0.03": partial(M.lrmc, scale=0.03),
  "lrmc 0.06": partial(M.lrmc, scale=0.06),
  "lrmc 0.12": partial(M.lrmc, scale=0.12),
  "pagerank": M.pagerank,
  "pagerank margin": partial(M.pagerank, margin=True),
  "engine win (current)": partial(M.engine, method="win"),
  "engine margin (current)": partial(M.engine, method="margin"),
}
def run(name):
    r = evaluate(CANDS[name], TRAIN)
    return name, r["acc"], r["n"], r["retro"]
if __name__ == "__main__":
    with Pool(4) as p:
        res = p.map(run, list(CANDS))
    for name, acc, n, retro in sorted(res, key=lambda x: -x[1]):
        print(f"{name:26s} next-week {acc*100:5.2f}%  (n={n})   retro {retro*100:5.2f}%")
