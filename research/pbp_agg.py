"""Condense cfbfastR play-by-play into one row per (game, team): offense, defense, special teams.

Offense = scrimmage plays (rush or pass) with EPA. "ng" columns drop garbage time
(Connelly's thresholds: score gap > 38 in Q2, > 28 in Q3, > 22 in Q4).
Special teams = kickoffs, punts, field goals (and their returns): net EPA from this team's side.
"""
import sys
import numpy as np, pyarrow.parquet as pq

COLS = ["turnover", "game_id", "week", "season_type", "period", "pos_team", "def_pos_team", "home_team", "away_team", "home_team_id", "away_team_id",
        "neutral_site", "rush", "pass", "EPA", "success", "pos_unit", "kickoff_play", "punt", "fg_inds", "pos_score_diff_start", "spread"]

def agg(year, out):
    t = pq.read_table(f"/tmp/rank-pbp/pbp_{year}.parquet", columns=[c for c in COLS if c in pq.ParquetFile(f"/tmp/rank-pbp/pbp_{year}.parquet").schema_arrow.names])
    d = t.to_pandas()
    d = d[d["EPA"].notna()]
    home = d["pos_team"] == d["home_team"]
    away = d["pos_team"] == d["away_team"]
    d = d[home | away].copy()
    d["team"] = np.where(d["pos_team"] == d["home_team"], d["home_team_id"], d["away_team_id"]).astype(int)
    d["opp"] = np.where(d["pos_team"] == d["home_team"], d["away_team_id"], d["home_team_id"]).astype(int)
    d["is_home"] = (d["pos_team"] == d["home_team"]).astype(int)
    scrim = ((d["rush"] == 1) | (d["pass"] == 1)) & (d["pos_unit"].fillna("Offense") == "Offense")
    gap = d["pos_score_diff_start"].abs()
    garbage = ((d["period"] == 2) & (gap > 38)) | ((d["period"] == 3) & (gap > 28)) | ((d["period"] >= 4) & (gap > 22))
    st = (d["kickoff_play"] == 1) | (d["punt"] == 1) | (d["fg_inds"] == 1) | d["pos_unit"].isin(["Kickoff Return", "Punt Offense", "Field Goal Offense"])
    st = st & ~scrim
    d["succ"] = d["success"].fillna(0).astype(float)
    rows = {}
    def acc(key, field, val):
        r = rows.setdefault(key, dict(off_n=0, off_epa=0.0, off_succ=0.0, off_n_ng=0, off_epa_ng=0.0, off_succ_ng=0.0, st_epa=0.0, off_epa_noto=0.0))
        r[field] += val
    g = d[scrim]
    for (gid, team, opp, ih), s in g.groupby(["game_id", "team", "opp", "is_home"]):
        key = (gid, team, opp, ih)
        acc(key, "off_n", len(s)); acc(key, "off_epa", s["EPA"].sum()); acc(key, "off_succ", s["succ"].sum())
        acc(key, "off_epa_noto", s.loc[s["turnover"].fillna(0) != 1, "EPA"].sum())
    g = d[scrim & ~garbage]
    for (gid, team, opp, ih), s in g.groupby(["game_id", "team", "opp", "is_home"]):
        key = (gid, team, opp, ih)
        acc(key, "off_n_ng", len(s)); acc(key, "off_epa_ng", s["EPA"].sum()); acc(key, "off_succ_ng", s["succ"].sum())
    g = d[st]
    for (gid, team, opp, ih), s in g.groupby(["game_id", "team", "opp", "is_home"]):
        e = s["EPA"].sum()
        acc((gid, team, opp, ih), "st_epa", e)          # this team's ST plays as possessing team
        acc((gid, opp, team, 1 - ih), "st_epa", -e)     # the same plays cost the opponent
    meta = d.groupby("game_id").agg(week=("week", "first"), stype=("season_type", "first"), neutral=("neutral_site", "first"), spread=("spread", "first")).to_dict("index") if "spread" in d else {}
    with open(out, "w") as f:
        f.write("game_id,team,opp,home,week,season_type,neutral,spread,off_n,off_epa,off_succ,off_n_ng,off_epa_ng,off_succ_ng,st_epa,off_epa_noto\n")
        for (gid, team, opp, ih), r in sorted(rows.items()):
            m = meta.get(gid, {})
            f.write(f"{gid},{team},{opp},{ih},{m.get('week','')},{m.get('stype','')},{m.get('neutral','')},{m.get('spread','')},{r['off_n']},{r['off_epa']:.6f},{r['off_succ']:.0f},{r['off_n_ng']},{r['off_epa_ng']:.6f},{r['off_succ_ng']:.0f},{r['st_epa']:.6f},{r['off_epa_noto']:.6f}\n")
    print(year, "rows", len(rows), "games", len({k[0] for k in rows}), flush=True)

if __name__ == "__main__":
    for y in sys.argv[1:]:
        agg(int(y), f"/tmp/rank-pbp/agg_{y}.csv")
