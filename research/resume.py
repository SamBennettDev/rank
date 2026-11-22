"""Résumé as strength of record (SOR), compared with the average-game-points résumé.

  python3 research/resume.py 2014-2019
  python3 research/resume.py 2021-2026

Strength of record: a benchmark team (by default the average strength of the 25 best teams by
quality) plays the team's exact schedule. Its chance of winning each game is
σ(qualityScale × (benchmark strength − opponent strength)), the calibrated quality logistic.
Those chances give the benchmark's full distribution of wins (Poisson-binomial, by
convolution), and

    SOR = 100 × (P(benchmark wins fewer) + ½ P(benchmark wins exactly as many))

so 100 means no top-25 team would do as well against that schedule and 50 means a top-25 team
would do about this well. Only wins and losses count; strengths come from the published
quality model. Scores as research/springs.py: next-week picks from week 4 and season-end
agreement (winner above loser). Needs numpy.
"""
import os, sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import springs as sp  # noqa: E402


def strengths(n, w, l, margin):
    return sp.solve(n, w, l, np.ones(len(w)), sp.margin_gap(margin), sp.STRENGTH_SHRINK)


def sor(n, w, l, margin, top=25, mode="sor"):
    """Strength of record for every team (0–100), or wins above the benchmark (mode="wae")."""
    s = strengths(n, w, l, margin)
    played = np.zeros(n, bool); played[w] = played[l] = True
    ranked = np.sort(s[played])[::-1]
    bench = ranked[: min(top, len(ranked))].mean() if len(ranked) else 0.0
    p_win = 1 / (1 + np.exp(-sp.QUALITY_SCALE * (bench - s)))  # benchmark beats team j
    out = np.zeros(n)
    games = [[] for _ in range(n)]
    for a, b in zip(w, l):
        games[a].append((b, 1)); games[b].append((a, 0))
    for i in range(n):
        g = games[i]
        if not g:
            continue
        wins = sum(r for _, r in g)
        if mode == "wae":
            out[i] = wins - sum(p_win[o] for o, _ in g)
            continue
        dist = np.zeros(len(g) + 1); dist[0] = 1.0
        for o, _ in g:
            p = p_win[o]
            dist[1:] = dist[1:] * (1 - p) + dist[:-1] * p
            dist[0] *= 1 - p
        out[i] = 100 * (dist[:wins].sum() + 0.5 * dist[wins])
    return out


def evaluate(years, order):
    right = games = agree = counted = 0
    for y in years:
        S = sp.load(y)
        W, L, M, O = S["winner"], S["loser"], S["margin"], S["order"]
        for wk in sorted(set(O)):
            if wk < 4:
                continue
            p = O < wk
            h = order(S["n"], W[p], L[p], M[p])
            played = np.zeros(S["n"], bool); played[W[p]] = played[L[p]] = True
            c = (O == wk) & played[W] & played[L]
            d = h[W[c]] - h[L[c]]
            right += np.sum(d > 0) + 0.5 * np.sum(d == 0); games += c.sum()
        h = order(S["n"], W, L, M)
        agree += np.sum(h[W] > h[L]); counted += len(W)
    return 100 * right / games, 100 * agree / counted, games, counted


def blend(n, w, l, m, tops=(10, 25, 50, 100, 10_000)):
    """Average SOR over several benchmarks, from a top-10 team to an average team (all teams)."""
    return sum(sor(n, w, l, m, t) for t in tops) / len(tops)


VARIANTS = {
    "current résumé (avg game points)": sp.resume,
    "SOR, benchmark top-25 average": lambda n, w, l, m: sor(n, w, l, m, 25),
    "SOR, benchmark top-50 average": lambda n, w, l, m: sor(n, w, l, m, 50),
    "SOR, benchmark top-100 average": lambda n, w, l, m: sor(n, w, l, m, 100),
    "SOR, benchmark average team": lambda n, w, l, m: sor(n, w, l, m, 10_000),
    "SOR blended (10/25/50/100/avg)": blend,
    "SOR blended (25/50/100)": lambda n, w, l, m: blend(n, w, l, m, (25, 50, 100)),
}


def run(job):
    name, years = job
    os.environ["OMP_NUM_THREADS"] = "1"
    return name, evaluate(years, VARIANTS[name])


if __name__ == "__main__":
    first, _, last = sys.argv[1].partition("-")
    years = [y for y in range(int(first), int(last or first) + 1) if y != 2020]
    for y in years:
        sp.load(y)  # download once before workers start
    from multiprocessing import Pool
    with Pool(min(4, len(VARIANTS))) as pool:
        print(f"{years[0]}-{years[-1]}: next-week picks / season-end agreement")
        for name, (pick, final, g, c) in pool.imap(run, [(v, years) for v in VARIANTS]):
            print(f"  {name:<36} {pick:6.2f}%  {final:6.2f}%   ({g} next-week, {c} season games)", flush=True)
