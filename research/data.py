"""Season loading for the rating benchmark. One Season = teams + chronologically ordered games."""
import csv
from dataclasses import dataclass, field
import numpy as np

SCHED = "/tmp/rank-backtest/cfb_schedules_{}.csv"
REPO = "/home/user/rank/data/seasons/2026"

@dataclass
class Season:
    year: int
    n: int
    ids: list
    conf: np.ndarray          # conference index per team
    fbs: np.ndarray           # 1 if FBS
    # games (arrays, same length), ordered by (order, id)
    gid: np.ndarray
    order: np.ndarray         # week; postseason = last regular week + 1
    home: np.ndarray
    away: np.ndarray
    hp: np.ndarray
    ap: np.ndarray
    neutral: np.ndarray
    helo: np.ndarray          # CFBD pregame Elo (nan if missing)
    aelo: np.ndarray
    names: list = field(default_factory=list)
    confnames: list = field(default_factory=list)

def _finish(year, rows, teaminfo, elo):
    ids = sorted(teaminfo)
    ix = {t: i for i, t in enumerate(ids)}
    confs = sorted({teaminfo[t][1] for t in ids})
    cix = {c: i for i, c in enumerate(confs)}
    last = max((r["week"] for r in rows if r["type"] == "regular"), default=0)
    rows = sorted(rows, key=lambda r: (last + 1 if r["type"] == "postseason" else r["week"], r["id"]))
    g = lambda k: np.array([r[k] for r in rows])
    return Season(
        year=year, n=len(ids), ids=ids,
        conf=np.array([cix[teaminfo[t][1]] for t in ids]), fbs=np.array([1 if teaminfo[t][0] == "fbs" else 0 for t in ids]),
        gid=g("id"), order=np.array([last + 1 if r["type"] == "postseason" else r["week"] for r in rows]),
        home=np.array([ix[r["h"]] for r in rows]), away=np.array([ix[r["a"]] for r in rows]),
        hp=g("hp").astype(float), ap=g("ap").astype(float), neutral=g("neutral").astype(bool),
        helo=np.array([elo.get(r["id"], (np.nan, np.nan))[0] for r in rows], float),
        aelo=np.array([elo.get(r["id"], (np.nan, np.nan))[1] for r in rows], float),
        names=[teaminfo[t][2] for t in ids], confnames=confs)

def _f(x):
    try: return float(x)
    except: return np.nan

def load(year):
    sched = list(csv.DictReader(open(SCHED.format(year))))
    elo = {int(r["game_id"]): (_f(r["home_pregame_elo"]), _f(r["away_pregame_elo"])) for r in sched}
    if year == 2026:
        teams = list(csv.DictReader(open(f"{REPO}/teams.csv")))
        teaminfo = {int(t["id"]): (t["classification"], t["conference"] or "?", t["school"]) for t in teams}
        rows = []
        for r in csv.DictReader(open(f"{REPO}/games.csv")):
            h, a = int(r["home_id"]), int(r["away_id"])
            if r["completed"].lower() != "true" or h not in teaminfo or a not in teaminfo: continue
            if r["home_points"] == "" or r["home_points"] == r["away_points"]: continue
            rows.append(dict(id=int(r["id"]), week=int(r["week"]), type=r["season_type"], h=h, a=a, hp=int(r["home_points"]), ap=int(r["away_points"]), neutral=r["neutral_site"].lower() == "true"))
        return _finish(year, rows, teaminfo, elo)
    ok = lambda d: d in ("fbs", "fcs")
    teaminfo, rows = {}, []
    for r in sched:
        if r["completed"] != "TRUE" or not ok(r["home_division"]) or not ok(r["away_division"]): continue
        if not r["home_points"].isdigit() or not r["away_points"].isdigit() or r["home_points"] == r["away_points"]: continue
        h, a = int(r["home_id"]), int(r["away_id"])
        teaminfo.setdefault(h, (r["home_division"], r["home_conference"] or "?", r["home_team"]))
        teaminfo.setdefault(a, (r["away_division"], r["away_conference"] or "?", r["away_team"]))
        rows.append(dict(id=int(r["game_id"]), week=int(r["week"]), type=r["season_type"], h=h, a=a, hp=int(r["home_points"]), ap=int(r["away_points"]), neutral=r["neutral_site"] == "TRUE"))
    return _finish(year, rows, teaminfo, elo)

if __name__ == "__main__":
    for y in (2014, 2019, 2025, 2026):
        s = load(y); print(y, s.n, len(s.gid), "max order", s.order.max(), "elo cover", np.mean(~np.isnan(s.helo) & ~np.isnan(s.aelo)).round(2), "confs", len(s.confnames))
