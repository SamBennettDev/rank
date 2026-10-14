"""Reproduce the published ranking (src/engine/springs.ts) on past seasons and measure it.

  python3 research/springs.py 2014-2019        # walk-forward picks and season-end agreement
  python3 research/springs.py 2021-2026
  python3 research/springs.py --top 2026       # a season's final top 25

Schedules come from sportsdataverse/cfbfastR-data at the pinned revision used by
scripts/history.ts (cached in /tmp/rank-backtest); 2026 is read from data/seasons/2026.
Only FBS and FCS teams count. Needs numpy.
"""
import csv, io, os, sys, urllib.request
import numpy as np

REVISION = "a3dd960090c1bfa169cebd491beabf7028b379b2"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Settings from src/engine/defaults.ts (DEFAULT_SPRINGS).
STRENGTH_SHRINK, QUALITY_SCALE, RANK_SHRINK = 10.0, 2.0, 0.1
MARGIN_WEIGHT, HOME_FIELD, WINDOW = 0.5, 2.7, 0.25
HOLD_GAP, HOLD_STIFFNESS = 0.05, 1000.0


def load(year):
    """Completed, untied FBS/FCS games in (week, id) order; postseason after the last week."""
    if year == 2026:
        base = os.path.join(ROOT, "data/seasons/2026")
        teams = list(csv.DictReader(open(f"{base}/teams.csv", encoding="utf8")))
        division = {int(t["id"]): t["classification"] for t in teams}
        names = {int(t["id"]): t["school"] for t in teams}
        rows = [dict(id=int(r["id"]), week=int(r["week"]), post=r["season_type"] == "postseason",
                     h=int(r["home_id"]), a=int(r["away_id"]), hp=r["home_points"], ap=r["away_points"],
                     neutral=r["neutral_site"] == "true", done=r["completed"] == "true")
                for r in csv.DictReader(open(f"{base}/games.csv", encoding="utf8"))]
    else:
        path = f"/tmp/rank-backtest/cfb_schedules_{REVISION}_{year}.csv"
        if not os.path.exists(path):
            os.makedirs(os.path.dirname(path), exist_ok=True)
            url = f"https://raw.githubusercontent.com/sportsdataverse/cfbfastR-data/{REVISION}/schedules/csv/cfb_schedules_{year}.csv"
            with urllib.request.urlopen(url) as response, open(path, "wb") as out:
                out.write(response.read())
        division, names, rows = {}, {}, []
        for r in csv.DictReader(io.open(path, encoding="utf8")):
            for side in ("home", "away"):
                division.setdefault(int(r[f"{side}_id"]), r[f"{side}_division"])
                names.setdefault(int(r[f"{side}_id"]), r[f"{side}_team"])
            rows.append(dict(id=int(r["game_id"]), week=int(r["week"]), post=r["season_type"] == "postseason",
                             h=int(r["home_id"]), a=int(r["away_id"]), hp=r["home_points"], ap=r["away_points"],
                             neutral=r["neutral_site"] == "TRUE", done=r["completed"] == "TRUE"))
    ok = lambda t: division.get(t) in ("fbs", "fcs")
    rows = [r for r in rows if r["done"] and ok(r["h"]) and ok(r["a"])
            and r["hp"].isdigit() and r["ap"].isdigit() and r["hp"] != r["ap"]]
    last = max((r["week"] for r in rows if not r["post"]), default=0)
    rows.sort(key=lambda r: (last + 1 if r["post"] else r["week"], r["id"]))
    ids = sorted({t for r in rows for t in (r["h"], r["a"])})
    ix = {t: i for i, t in enumerate(ids)}
    hp = np.array([int(r["hp"]) for r in rows]); ap = np.array([int(r["ap"]) for r in rows])
    home = np.array([ix[r["h"]] for r in rows]); away = np.array([ix[r["a"]] for r in rows])
    won = hp > ap
    return dict(
        n=len(ids), names=[names[t] for t in ids],
        order=np.array([last + 1 if r["post"] else r["week"] for r in rows]),
        winner=np.where(won, home, away), loser=np.where(won, away, home), margin=np.abs(hp - ap),
        site=np.array([0 if r["neutral"] else (1 if w else -1) for r, w in zip(rows, won)]),
    )


def solve(n, w, l, k, gap, shrink, held=None, start=None):
    """Heights minimising ½Σ k(h_w − h_l − gap)² + ½·shrink·Σ h², plus one-sided head-to-head holds."""
    def system(hold):
        A = np.zeros((n, n)); b = np.zeros(n)
        springs = [(k, gap)] + ([(hold, np.full(len(w), HOLD_GAP))] if hold is not None else [])
        for K, D in springs:
            np.add.at(A, (w, w), K); np.add.at(A, (l, l), K); np.add.at(A, (w, l), -K); np.add.at(A, (l, w), -K)
            np.add.at(b, w, K * D); np.add.at(b, l, -K * D)
        A[np.diag_indices(n)] += shrink
        return np.linalg.solve(A, b)

    if held is None or not held.any():
        return system(None)

    def energy(x):
        g = x[w] - x[l]; s = np.maximum(0, HOLD_GAP - g)
        return np.sum(k * (g - gap) ** 2) + HOLD_STIFFNESS * np.sum(np.where(held, s * s, 0)) + shrink * np.sum(x * x)

    x = start.copy(); active = held & (x[w] - x[l] < HOLD_GAP)
    for _ in range(200):
        nxt = system(np.where(active, HOLD_STIFFNESS, 0.0))
        if np.array_equal(held & (nxt[w] - nxt[l] < HOLD_GAP), active):
            return nxt
        e0, t, y = energy(x), 1.0, nxt
        while energy(y) >= e0 and t > 1e-10:
            t /= 2; y = x + t * (nxt - x)
        x = y; active = held & (x[w] - x[l] < HOLD_GAP)
    raise RuntimeError("head-to-head holds did not settle")


def rank(n, w, l, margin, site):
    """Pass 1: margins give strength. Pass 2: strength sets each spring's pull, log margin its gap."""
    strength = solve(n, w, l, margin.astype(float), np.ones(len(w)), STRENGTH_SHRINK)
    q = 1 / (1 + np.exp(-QUALITY_SCALE * strength))
    pull = q[l] + 1 - q[w]
    gap = 1 + MARGIN_WEIGHT * np.log1p(np.maximum(0, margin - HOME_FIELD * site))
    h = solve(n, w, l, pull, gap, RANK_SHRINK)
    held = np.zeros(len(w), bool)
    above = [[] for _ in range(n)]

    def required(a, b):
        stack, seen = [a], set()
        while stack:
            x = stack.pop()
            if x == b:
                return True
            if x not in seen:
                seen.add(x); stack.extend(above[x])
        return False

    for _ in range(100):
        short = h[l] - h[w]; added = False
        for e in np.lexsort((np.arange(len(w)), short)):
            if held[e] or not (-HOLD_GAP < short[e] < WINDOW) or required(l[e], w[e]):
                continue
            above[w[e]].append(l[e]); held[e] = True; added = True
        if not added:
            return h
        h = solve(n, w, l, pull, gap, RANK_SHRINK, held, h)
    raise RuntimeError("head-to-head holds did not settle")


def evaluate(years):
    right = games = agree = counted = 0
    for y in years:
        S = load(y)
        W, L, M, T, O = S["winner"], S["loser"], S["margin"], S["site"], S["order"]
        for wk in sorted(set(O)):
            if wk < 4:
                continue
            p = O < wk
            h = rank(S["n"], W[p], L[p], M[p], T[p])
            played = np.zeros(S["n"], bool); played[W[p]] = played[L[p]] = True
            c = (O == wk) & played[W] & played[L]
            d = h[W[c]] - h[L[c]]
            right += np.sum(d > 0) + 0.5 * np.sum(d == 0); games += c.sum()
        h = rank(S["n"], W, L, M, T)
        agree += np.sum(h[W] > h[L]); counted += len(W)
    print(f"{years[0]}-{years[-1]}: picks {100 * right / games:.2f}% of {games} next-week games; "
          f"final ranking has the winner above the loser in {100 * agree / counted:.2f}% of {counted} games")


if __name__ == "__main__":
    if sys.argv[1] == "--top":
        S = load(int(sys.argv[2]))
        h = rank(S["n"], S["winner"], S["loser"], S["margin"], S["site"])
        wins = np.bincount(S["winner"], minlength=S["n"]); losses = np.bincount(S["loser"], minlength=S["n"])
        for j, i in enumerate(np.argsort(-h)[:25]):
            print(f"{j + 1:>2} {S['names'][i]} {wins[i]}-{losses[i]} {h[i]:+.3f}")
    else:
        first, _, last = sys.argv[1].partition("-")
        evaluate([y for y in range(int(first), int(last or first) + 1) if y != 2020])
