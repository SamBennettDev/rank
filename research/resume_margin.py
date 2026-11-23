"""Résumé with margin of victory: strength of record blended with a margin-based record score.

  python3 research/resume_margin.py 2014-2019

For each division benchmark b (as research/springs.py's résumé), per game:
  result   g = ±gap(min(margin, CAP))            (the quality model's diminishing returns)
  expected e = b − strength[opponent]            (what the benchmark would do, in the same units)
  margin score(b) = 100 × Φ( Σ (g − e) / (σ √n) ),  σ = the season's spring residual spread
résumé_α = (1 − α) × wins-based SOR + α × margin score, averaged over the five benchmarks.
Scored on games between teams of the same division. Needs numpy.
"""
import math, os, sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import springs as sp  # noqa: E402

CAP = 28
TOPS = (10, 25, 50, 100, 0)


def margin_scores(n, w, l, margin, division):
    s = sp.solve(n, w, l, np.ones(len(w)), sp.margin_gap(margin), sp.STRENGTH_SHRINK)
    g = sp.margin_gap(np.minimum(margin, CAP))
    resid = s[w] - s[l] - sp.margin_gap(margin)
    sigma = max(1.0, float(np.sqrt(np.mean(resid ** 2)))) if len(w) else 1.0
    played = np.zeros(n, bool); played[w] = played[l] = True
    games = [[] for _ in range(n)]
    for a, b, gg in zip(w, l, g):
        games[a].append((b, gg)); games[b].append((a, -gg))
    out = np.zeros(n)
    for top in TOPS:
        bench = np.zeros(n)
        for d in set(division.tolist()):
            member = played & (division == d)
            ranked = np.sort(s[member])[::-1]
            k = len(ranked) if top == 0 else min(top, len(ranked))
            bench[division == d] = ranked[:k].mean() if k else 0.0
        for i, gs in enumerate(games):
            if not gs:
                continue
            z = sum(gg - (bench[i] - s[o]) for o, gg in gs) / (sigma * math.sqrt(len(gs)))
            out[i] += 100 * 0.5 * (1 + math.erf(z / math.sqrt(2)))
    return out / len(TOPS)


def blended(alpha):
    def order(n, w, l, m, d):
        wins = sp.resume(n, w, l, m, d)
        return wins if alpha == 0 else (1 - alpha) * wins + alpha * margin_scores(n, w, l, m, d)
    return order


def evaluate(years, order):
    right = games = agree = counted = 0
    for y in years:
        S = sp.load(y)
        W, L, M, O, D = S["winner"], S["loser"], S["margin"], S["order"], S["division"]
        same = D[W] == D[L]
        for wk in sorted(set(O)):
            if wk < 4:
                continue
            p = O < wk
            h = order(S["n"], W[p], L[p], M[p], D)
            played = np.zeros(S["n"], bool); played[W[p]] = played[L[p]] = True
            c = (O == wk) & played[W] & played[L] & same
            d = h[W[c]] - h[L[c]]
            right += np.sum(d > 0) + 0.5 * np.sum(d == 0); games += c.sum()
        h = order(S["n"], W, L, M, D)
        agree += np.sum((h[W] > h[L]) & same); counted += same.sum()
    return 100 * right / games, 100 * agree / counted


def run(job):
    alpha, years = job
    os.environ["OMP_NUM_THREADS"] = "1"
    return alpha, evaluate(years, blended(alpha))


if __name__ == "__main__":
    first, _, last = sys.argv[1].partition("-")
    years = [y for y in range(int(first), int(last or first) + 1) if y != 2020]
    for y in years:
        sp.load(y)
    from multiprocessing import Pool
    with Pool(4) as pool:
        print(f"{years[0]}-{years[-1]} (same-division games): next-week picks / season-end agreement")
        for alpha, (pick, final) in pool.imap(run, [(a, years) for a in (0.0, 0.25, 0.5, 1.0)]):
            print(f"  margin weight {alpha:<4}  {pick:6.2f}%  {final:6.2f}%", flush=True)
