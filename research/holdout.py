"""One-shot holdout test on seasons never used for tuning."""
import json
from functools import partial
from multiprocessing import Pool
import numpy as np
import models as M, layered, prior
from bench import evaluate, cfbd_elo, elo_subset_mask
TEST = [2021, 2022, 2023, 2024, 2025, 2026]
C = {
 "NEW (last-season prior)": partial(prior.fit, rho=0.9, lam_p=2),
 "NEW pure (no prior)": partial(layered.fit, layers=True, C=1e9, bonus=3, delta=1e6, lam_t=0.02, lam_c=0.002),
 "massey": partial(M.massey, lam=0.01),
 "massey +hfa": partial(M.massey, hfa=True),
 "lrmc": partial(M.lrmc, scale=0.06),
 "elo (in-season)": partial(M.elo, K=40, passes=3),
 "elo carryover": partial(M.elo_carry, K=50, regress=0.33),
 "pythagorean": M.pythag,
 "keener": M.keener,
 "colley": M.colley,
 "bradley-terry": partial(M.bradley_terry, prior=2.0),
 "win pct": M.winpct,
 "pagerank": M.pagerank,
 "current engine (margin)": partial(M.engine, method="margin"),
 "current engine (win)": partial(M.engine, method="win"),
}
def run(name):
    r = evaluate(C[name], TEST, retro=True)
    early = evaluate(C[name], TEST, start_week=2, retro=False)
    return name, r["outcomes"].tolist(), r["retro"], early["acc"], early["n"]
if __name__ == "__main__":
    with Pool(4) as p: res = p.map(run, list(C))
    out = {k: dict(o=o, retro=rt, early=e, early_n=en) for k, o, rt, e, en in res}
    out["_mask"] = elo_subset_mask(TEST).tolist(); out["_cfbd"] = cfbd_elo(TEST).tolist()
    json.dump(out, open("holdout.json", "w"))
    print("saved")
