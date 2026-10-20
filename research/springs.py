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
STRENGTH_SHRINK, QUALITY_SCALE = 0.5, 0.08
WIN_POINTS = 7.0  # a 1-point win, and the top of the 0-7 quality scale


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
    )


def solve(n, w, l, k, gap, shrink):
    """Heights minimising ½Σ k(h_w − h_l − gap)² + ½·shrink·Σ h²."""
    A = np.zeros((n, n)); b = np.zeros(n)
    np.add.at(A, (w, w), k); np.add.at(A, (l, l), k); np.add.at(A, (w, l), -k); np.add.at(A, (l, w), -k)
    np.add.at(b, w, k * gap); np.add.at(b, l, -k * gap)
    A[np.diag_indices(n)] += shrink
    return np.linalg.solve(A, b)


def margin_gap(margin):
    """WIN_POINTS × (1 + 1/2 + … + 1/margin): each extra point counts less."""
    harmonic = np.concatenate([[0.0], np.cumsum(1 / np.arange(1, margin.max() + 1))])
    return WIN_POINTS * harmonic[margin]


def quality(n, w, l, margin):
    """Margin SpringRank with springs weighted by surprise, as 0-7 quality points."""
    gap = margin_gap(margin)
    strength = solve(n, w, l, np.ones(len(w)), gap, STRENGTH_SHRINK)
    for _ in range(200):  # weight each spring by surprise until the strengths settle
        p = 1 / (1 + np.exp(-QUALITY_SCALE * strength))
        nxt = solve(n, w, l, p[l] + 1 - p[w], gap, STRENGTH_SHRINK)
        moved = np.abs(nxt - strength).max(); strength = nxt
        if moved < 1e-9:
            break
    return WIN_POINTS / (1 + np.exp(-QUALITY_SCALE * strength))


def rank(n, w, l, margin):
    """The ranking is quality."""
    return quality(n, w, l, margin)


def evaluate(years):
    right = games = agree = counted = 0
    for y in years:
        S = load(y)
        W, L, M, O = S["winner"], S["loser"], S["margin"], S["order"]
        for wk in sorted(set(O)):
            if wk < 4:
                continue
            p = O < wk
            h = rank(S["n"], W[p], L[p], M[p])
            played = np.zeros(S["n"], bool); played[W[p]] = played[L[p]] = True
            c = (O == wk) & played[W] & played[L]
            d = h[W[c]] - h[L[c]]
            right += np.sum(d > 0) + 0.5 * np.sum(d == 0); games += c.sum()
        h = rank(S["n"], W, L, M)
        agree += np.sum(h[W] > h[L]); counted += len(W)
    print(f"{years[0]}-{years[-1]}: picks {100 * right / games:.2f}% of {games} next-week games; "
          f"final ranking has the winner above the loser in {100 * agree / counted:.2f}% of {counted} games")


if __name__ == "__main__":
    if sys.argv[1] == "--top":
        S = load(int(sys.argv[2]))
        h = rank(S["n"], S["winner"], S["loser"], S["margin"])
        wins = np.bincount(S["winner"], minlength=S["n"]); losses = np.bincount(S["loser"], minlength=S["n"])
        for j, i in enumerate(np.argsort(-h)[:25]):
            print(f"{j + 1:>2} {S['names'][i]} {wins[i]}-{losses[i]} {h[i]:+.3f}")
    else:
        first, _, last = sys.argv[1].partition("-")
        evaluate([y for y in range(int(first), int(last or first) + 1) if y != 2020])
