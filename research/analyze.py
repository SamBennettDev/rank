import json, math
import numpy as np
from bench import season
TEST = [2021, 2022, 2023, 2024, 2025, 2026]
d = json.load(open("holdout.json"))
mask = np.array(d.pop("_mask")); cfbd = np.array(d.pop("_cfbd"))
O = {k: np.array(v["o"]) for k, v in d.items()}
# season label per outcome (same order as evaluate)
lab = []
for y in TEST:
    S = season(y)
    for wk in range(4, S.order.max() + 1):
        train = np.flatnonzero(S.order < wk); test = np.flatnonzero(S.order == wk)
        if len(train) == 0 or len(test) == 0: continue
        played = np.zeros(S.n, bool); played[S.home[train]] = True; played[S.away[train]] = True
        lab += [y] * int((played[S.home[test]] & played[S.away[test]]).sum())
lab = np.array(lab)
def paired(a, b, B=4000, seed=1):
    diff = a - b; rng = np.random.default_rng(seed)
    bs = [diff[rng.integers(0, len(diff), len(diff))].mean() for _ in range(B)]
    lo, hi = np.percentile(bs, [2.5, 97.5])
    n01 = ((a > b)).sum(); n10 = ((a < b)).sum()       # discordant (ties at .5 count as half-wins)
    z = (n01 - n10) / math.sqrt(n01 + n10) if n01 + n10 else 0
    p = math.erfc(abs(z) / math.sqrt(2))
    return diff.mean(), lo, hi, p
order = sorted(O, key=lambda k: -O[k].mean())
print(f"HOLDOUT 2021-2026, next-week picks from week 4 (n={len(lab)})\n")
print(f"{'model':26s} {'all':>7s} {'FBSvFBS':>8s} {'retro':>7s} {'wk2+':>7s}  " + " ".join(f"{y:>6d}" for y in TEST))
for k in order:
    o = O[k]; per = " ".join(f"{o[lab == y].mean()*100:6.1f}" for y in TEST)
    print(f"{k:26s} {o.mean()*100:6.2f}% {o[mask].mean()*100:7.2f}% {d[k]['retro']*100:6.1f}% {d[k]['early']*100:6.2f}%  {per}")
print(f"{'CFBD Elo (external)':26s} {'':>7s} {cfbd.mean()*100:7.2f}%")
best_known = max((k for k in O if not k.startswith("NEW")), key=lambda k: O[k].mean())
print(f"\nPaired comparisons (bootstrap 95% CI of accuracy difference, McNemar p):")
for k in ("NEW (last-season prior)", "NEW pure (no prior)"):
    for ref in (best_known, "massey", "elo carryover"):
        m, lo, hi, p = paired(O[k], O[ref])
        print(f"  {k:24s} vs {ref:22s}: {m*100:+.2f} pts  [{lo*100:+.2f}, {hi*100:+.2f}]  p={p:.4f}")
m = O["NEW (last-season prior)"][mask].mean() - cfbd.mean()
print(f"  NEW (last-season prior)  vs CFBD Elo on FBS-v-FBS: {m*100:+.2f} pts (n={mask.sum()})")
