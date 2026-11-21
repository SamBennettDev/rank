"""Compare candidate quality models walk-forward (findings in research/QUALITY.md).

  python3 research/quality.py 2014-2019                 # every preset below
  python3 research/quality.py 2021-2026 current soft-label
  python3 research/quality.py 2014-2019 '{"model": "springs", "gap": "pow", "a": 0.8, "lam": 0.25}'

Models (strengths s, one per team; every team starts at 0, no home field):
  springs     minimise ½ Σ k_e (s_w − s_l − gap(m_e))² + ½ lam Σ s²
                gap  harm: 100·(1 + 1/2 + … + 1/m)   (the published model)
                     pow:  m^a, rescaled so a 14-point win wants the same gap as harm
                k    surprise: p_loser + 1 − p_winner, p = σ(qs·s), re-solved until settled
                     none: every spring 1 (one linear solve)
  soft-label  minimise Σ CE(y_e, σ(s_w − s_l)) + ½ lam Σ s², y_e = σ((m_e + bonus) / T),
              by Newton steps: each game is a soft vote that the winner is better, surer
              the bigger the margin. Once the winner is already rated far above the loser
              the vote is satisfied, so blowouts of weak teams barely pull either team.

Scores, from week 4, using only earlier games (as research/springs.py):
  pick    % of next-week games the higher-quality team won (ties ½)
  ll      log loss of P(winner) = σ(β (s_w − s_l)), one β fitted per model and period
  final   % of the season's games where season-end quality has the winner above the loser
  rpick, rfinal   the same two for résumé (the official ranking), built from quality σ(β s)

Schedules come from sportsdataverse/cfbfastR-data at scripts/history.ts's revision
(cached in /tmp/rank-backtest, as research/springs.py); 2026 from data/seasons/2026.
Before 2014 that file has FBS games only (FCS teams appear just in their FBS games).
Efficiency blends (section 3 of QUALITY.md) add "eff" and "alpha" to a springs config and read
play-by-play team-game rows from /tmp/rank-backtest/plays_<year>.csv, built with
`npm run fetch-plays -- <year> --out /tmp/rank-backtest/plays_<year>.csv` (2014 on; that cfbfastR
fetcher is in commit 7d29c54, since removed).
Needs numpy.
"""
import csv, io, json, os, sys, urllib.request
import numpy as np

REVISION = "a3dd960090c1bfa169cebd491beabf7028b379b2"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = "/tmp/rank-backtest"

PRESETS = {
    "current": {"model": "springs", "gap": "harm", "k": "surprise", "lam": 0.5, "qs": 0.0056},
    "current-pow": {"model": "springs", "gap": "pow", "a": 0.5, "bonus": 1, "k": "surprise", "lam": 0.5, "qs": 0.0056},
    "springs-pow": {"model": "springs", "gap": "pow", "a": 0.7, "k": "none", "lam": 0.25},
    "published": {"model": "springs", "gap": "pow", "a": 0.75, "k": "none", "lam": 0.25},
    "soft-label": {"model": "soft-label", "T": 22, "bonus": 4, "lam": 0.03},
}


def path(year):
    return f"{CACHE}/cfb_schedules_{REVISION}_{year}.csv"


def download(year):
    if year == 2026 or os.path.exists(path(year)):
        return
    os.makedirs(CACHE, exist_ok=True)
    url = f"https://raw.githubusercontent.com/sportsdataverse/cfbfastR-data/{REVISION}/schedules/csv/cfb_schedules_{year}.csv"
    tmp = f"{path(year)}.{os.getpid()}.part"
    with urllib.request.urlopen(url) as response, open(tmp, "wb") as out:
        out.write(response.read())
    os.replace(tmp, path(year))  # never leave a half-written file for another reader


def load(year):
    """Completed, untied FBS/FCS games in (week, id) order; postseason after the last week."""
    if year == 2026:
        base = os.path.join(ROOT, "data/seasons/2026")
        division = {int(t["id"]): t["classification"] for t in csv.DictReader(open(f"{base}/teams.csv", encoding="utf8"))}
        raw = [dict(id=int(r["id"]), week=int(r["week"]), post=r["season_type"] == "postseason",
                    h=int(r["home_id"]), a=int(r["away_id"]), hp=r["home_points"], ap=r["away_points"],
                    done=r["completed"] == "true")
               for r in csv.DictReader(open(f"{base}/games.csv", encoding="utf8"))]
    else:
        download(year)
        division, raw = {}, []
        for r in csv.DictReader(io.open(path(year), encoding="utf8")):
            for side in ("home", "away"):
                division.setdefault(int(r[f"{side}_id"]), r[f"{side}_division"])
            raw.append(dict(id=int(r["game_id"]), week=int(r["week"]), post=r["season_type"] == "postseason",
                            h=int(r["home_id"]), a=int(r["away_id"]), hp=r["home_points"], ap=r["away_points"],
                            done=r["completed"] == "TRUE"))
    ok = lambda t: division.get(t) in ("fbs", "fcs")
    rows = [r for r in raw if r["done"] and ok(r["h"]) and ok(r["a"])
            and r["hp"].isdigit() and r["ap"].isdigit() and r["hp"] != r["ap"]]
    last = max((r["week"] for r in rows if not r["post"]), default=0)
    rows.sort(key=lambda r: (last + 1 if r["post"] else r["week"], r["id"]))
    ids = sorted({t for r in rows for t in (r["h"], r["a"])})
    ix = {t: i for i, t in enumerate(ids)}
    hp = np.array([int(r["hp"]) for r in rows]); ap = np.array([int(r["ap"]) for r in rows])
    home = np.array([ix[r["h"]] for r in rows]); away = np.array([ix[r["a"]] for r in rows])
    won = hp > ap
    S = dict(n=len(ids), order=np.array([last + 1 if r["post"] else r["week"] for r in rows]),
             w=np.where(won, home, away), l=np.where(won, away, home), m=np.abs(hp - ap))
    S.update(efficiency(year, rows, won))
    return S


def efficiency(year, rows, won):
    """Per game, from the winner's side: scrimmage EPA margin (garbage time out), net special-teams
    EPA, EPA-per-snap margin × 65 and success-rate margin, from fetch-plays' team-game rows.
    `has` is False where either side has no play-by-play (score margin only)."""
    f = os.path.join(ROOT, "data/seasons/2026/plays.csv") if year == 2026 else f"{CACHE}/plays_{year}.csv"
    plays = {}
    if os.path.exists(f):
        for r in csv.DictReader(open(f, encoding="utf8")):
            plays[(int(r["game_id"]), int(r["team_id"]))] = (int(r["snaps"]), float(r["epa"]), int(r["success"]), float(r["special_epa"]))
    out = {k: np.zeros(len(rows)) for k in ("epa", "st", "perplay", "sr")}
    has = np.zeros(len(rows), bool)
    for i, (r, hw) in enumerate(zip(rows, won)):
        a, b = plays.get((r["id"], r["h"])), plays.get((r["id"], r["a"]))
        if not a or not b or a[0] == 0 or b[0] == 0:
            continue
        wv, lv = (a, b) if hw else (b, a)
        has[i] = True
        out["epa"][i] = wv[1] - lv[1]
        out["st"][i] = wv[3]
        out["perplay"][i] = 65 * (wv[1] / wv[0] - lv[1] / lv[0])
        out["sr"][i] = wv[2] / wv[0] - lv[2] / lv[0]
    return dict(has=has, **{f"eff_{k}": v for k, v in out.items()})


HARMONIC = np.concatenate([[0.0], np.cumsum(1 / np.arange(1, 400))])


def gap(cfg, m):
    if cfg["gap"] == "harm":
        return 100 * HARMONIC[m]
    shape = lambda x: cfg.get("bonus", 0.0) + x ** cfg["a"]
    return shape(m) * (100 * HARMONIC[14] / shape(14))


def solve(n, w, l, k, g, lam):
    A = np.zeros((n, n)); b = np.zeros(n)
    np.add.at(A, (w, w), k); np.add.at(A, (l, l), k); np.add.at(A, (w, l), -k); np.add.at(A, (l, w), -k)
    np.add.at(b, w, k * g); np.add.at(b, l, -k * g)
    A[np.diag_indices(n)] += lam
    return np.linalg.solve(A, b)


def signed_gap(cfg, x):
    """The points gap's shape for a real-valued margin that can favour the loser."""
    return np.sign(x) * np.abs(x) ** cfg["a"] * (100 * HARMONIC[14] / 14 ** cfg["a"])


def blended_gap(cfg, m, E):
    """Each game wants (1 − α)·gap(score margin) + α·gap(efficiency margin) where it has play-by-play.
    eff: epa | epa+st | perplay | perplay+st | sr (success-rate margin, scaled by `srScale` points)."""
    g = gap(cfg, m)
    alpha = cfg.get("alpha", 0.0)
    if not alpha:
        return g
    kind = cfg["eff"]
    x = {"epa": E["eff_epa"], "epa+st": E["eff_epa"] + E["eff_st"], "perplay": E["eff_perplay"],
         "perplay+st": E["eff_perplay"] + E["eff_st"], "sr": E["eff_sr"] * cfg.get("srScale", 100)}[kind]
    return np.where(E["has"], (1 - alpha) * g + alpha * signed_gap(cfg, x), g)


def springs(n, w, l, m, cfg, E=None):
    g = blended_gap(cfg, m, E) if E is not None else gap(cfg, m)
    s = solve(n, w, l, np.ones(len(w)), g, cfg["lam"])
    if cfg.get("k", "surprise") == "none":
        return s
    for _ in range(300):
        p = 1 / (1 + np.exp(-cfg["qs"] * s))
        nxt = solve(n, w, l, p[l] + 1 - p[w], g, cfg["lam"])
        moved = np.abs(nxt - s).max(); s = nxt
        if moved < 1e-9:
            break
    return s


def soft_label(n, w, l, m, cfg):
    y = 1 / (1 + np.exp(-(m + cfg.get("bonus", 0.0)) / cfg["T"]))
    s = np.zeros(n)
    for _ in range(100):
        p = 1 / (1 + np.exp(-(s[w] - s[l]))); r = p - y; v = p * (1 - p)
        grad = cfg["lam"] * s; np.add.at(grad, w, r); np.add.at(grad, l, -r)
        A = np.zeros((n, n))
        np.add.at(A, (w, w), v); np.add.at(A, (l, l), v); np.add.at(A, (w, l), -v); np.add.at(A, (l, w), -v)
        A[np.diag_indices(n)] += cfg["lam"]
        step = np.linalg.solve(A, grad); s -= step
        if np.abs(step).max() < 1e-10:
            break
    return s


def fit(S, mask, cfg):
    if cfg["model"] == "soft-label":
        return soft_label(S["n"], S["w"][mask], S["l"][mask], S["m"][mask], cfg)
    E = {k: S[k][mask] for k in ("has", "eff_epa", "eff_st", "eff_perplay", "eff_sr")}
    return springs(S["n"], S["w"][mask], S["l"][mask], S["m"][mask], cfg, E)


def resume(S, s, beta):
    """Average résumé points: 50 + q_loser/2 for a win, q_winner/2 for a loss, q = 100 σ(β s)."""
    q = 100 / (1 + np.exp(-beta * s)); n = S["n"]
    pts = np.zeros(n); games = np.zeros(n)
    np.add.at(pts, S["w"], 50 + q[S["l"]] / 2); np.add.at(pts, S["l"], q[S["w"]] / 2)
    np.add.at(games, S["w"], 1); np.add.at(games, S["l"], 1)
    return np.where(games > 0, pts / np.maximum(games, 1), 0)


def log_loss(beta, d):
    return np.mean(np.logaddexp(0, -beta * d))


def best_beta(d):
    lo, hi = 0.0, 10.0 / (np.std(d) + 1e-12)
    for _ in range(80):  # golden section; log loss is convex in β
        a = lo + 0.382 * (hi - lo); b = lo + 0.618 * (hi - lo)
        if log_loss(a, d) < log_loss(b, d): hi = b
        else: lo = a
    return (lo + hi) / 2


def evaluate(cfg, years):
    weekly, finals = [], []
    for y in years:
        S = load(y); O = S["order"]
        for wk in sorted(set(O)):
            if wk < 4:
                continue
            p = O < wk
            s = fit(S, p, cfg)
            played = np.zeros(S["n"], bool); played[S["w"][p]] = played[S["l"][p]] = True
            c = (O == wk) & played[S["w"]] & played[S["l"]]
            sub = dict(S, w=S["w"][p], l=S["l"][p])
            weekly.append((S, sub, c, s))
        finals.append((S, fit(S, np.ones(len(O), bool), cfg)))
    d = np.concatenate([s[S["w"][c]] - s[S["l"][c]] for S, _, c, s in weekly])
    beta = best_beta(d)
    rd = np.concatenate([(lambda r: r[S["w"][c]] - r[S["l"][c]])(resume(sub, s, beta)) for S, sub, c, s in weekly])
    rate = lambda z: 100 * (np.sum(z > 0) + 0.5 * np.sum(z == 0)) / len(z)
    games = sum(len(S["w"]) for S, _ in finals)
    final = 100 * sum(np.sum(s[S["w"]] > s[S["l"]]) for S, s in finals) / games
    rfinal = 100 * sum(np.sum((lambda r: r[S["w"]] > r[S["l"]])(resume(S, s, beta))) for S, s in finals) / games
    return dict(pick=rate(d), ll=log_loss(beta, d), final=final, rpick=rate(rd), rfinal=rfinal,
                beta=beta, games=len(d), seasonGames=games)


def run(job):
    name, cfg, years = job
    return name, evaluate(cfg, years)


if __name__ == "__main__":
    first, _, last = sys.argv[1].partition("-")
    years = [y for y in range(int(first), int(last or first) + 1) if y != 2020]
    picked = sys.argv[2:] or list(PRESETS)
    jobs = [(a, PRESETS[a], years) if a in PRESETS else (a, json.loads(a), years) for a in picked]
    for y in years:
        download(y)  # once, before any worker reads
    from multiprocessing import Pool
    with Pool(min(4, len(jobs))) as pool:
        print(f"{years[0]}-{years[-1]}: quality pick / log loss / final, résumé pick / final")
        for name, r in pool.imap(run, jobs):
            print(f"  {name:<12} {r['pick']:6.2f}% {r['ll']:.4f} {r['final']:6.2f}%   {r['rpick']:6.2f}% {r['rfinal']:6.2f}%"
                  f"   ({r['games']} next-week, {r['seasonGames']} season games)", flush=True)
