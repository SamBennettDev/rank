# Ranking research

Walk-forward benchmark of college football rating algorithms. For every week of every season, each
model is fit on the games played before that week and predicts that week's games between teams that
have already played (higher rating = predicted winner; ties count half). Nothing from later weeks is used.

- **Tuning seasons:** 2014–2019 (`run_baselines.py`, results in `training-results.txt`).
- **Held-out test:** 2021–2025 plus 2026 through week 6, run once after the models were frozen
  (`holdout.py`, then `analyze.py`; results in `holdout-results.txt`).
- **Data:** public season-complete schedules from sportsdataverse/cfbfastR-data (downloaded to
  `/tmp/rank-backtest`; the 2026 games come from this repo). FBS and FCS games only. CFBD's own pregame Elo,
  included in those files, is used as an outside benchmark on the games it covers.

## Models

`models.py` holds the known algorithms: win %, Pythagorean, Colley, Massey (raw, capped, with home field),
Bradley–Terry, Elo (in-season, multi-pass, and with season-to-season carryover), Keener, LRMC, PageRank, and
ports of this repo's spring engines. Each got its main setting tuned on 2014–2019.

`layered.py` and `prior.py` are the new models:

- **Pure** (`layered.fit`): least squares on margin + a 3-point win bonus, home field fitted each week, and
  ratings built as division + conference + team effects, each shrunk separately. Uses only this season.
- **Last-season prior** (`prior.fit`): least squares on margin + 3-point win bonus with home field fitted, plus
  a ridge pulling each team toward 0.9 × its final rating from last season, worth about two games of evidence
  (λ = 2). Teams new to the data start at their division's average. This season's games outweigh the prior as
  they accumulate. It is one linear solve per week.

Also tried and dropped (no gain on 2014–2019): treating blowout margins as censored, robust (pseudo-Huber)
loss, recency weighting, two-season priors, conference-anchored priors.

```
pip install numpy scipy
python3 run_baselines.py      # tuning seasons
python3 holdout.py && python3 analyze.py
```

## Play-by-play (offense, defense, special teams)

`pbp_agg.py` condenses the public cfbfastR play-by-play release (downloaded to `/tmp/rank-pbp/pbp_<year>.parquet`;
needs `pyarrow pandas`) into one row per team per game: snaps and EPA (with and without garbage time), successes,
turnover-free EPA, and net special-teams EPA. `units.py` fits opponent-adjusted offense/defense/special-teams
ratings; `epa_result.py` folds EPA or success-rate margins into each game's result in the score model.

Tested on 2015–2019 (`tune_units.py`, `tune_epa.py`), next-week winners from week 4:

| Model | All games | FBS vs FBS |
|---|---|---|
| Score rating (published model) | 73.07% | 72.92% |
| + success-rate margin mixed in (25%) | 72.93% | 72.92% |
| + turnover-free EPA margin mixed in (50%) | 73.02% | 72.85% |
| Blend with unit overall (30–50%) | 72.6% | 72.1–72.6% |
| Unit overall alone | 68.60% | 71.04% |

None beat final scores, so play-by-play feeds only the separate unit rankings. Per game, EPA margin and points margin
correlate at 0.93 (2015–2019).

## Published model: no preseason input

The site no longer uses the last-season prior. The published model is `prior.fit` with `rho=0` (every team starts
at 0) and `lam_p=0.05` (chosen on 2014–2019 among 0.005–2): margin + 3-point win bonus, home field fitted, a
0.05-game pull toward 0 for every team. Held-out 2021–2026: 70.53% of next-week winners (vs 71.88% with the
last-season prior), level with Massey + home field (70.24%, +0.29, 95% CI −0.11 to +0.67) and ahead of Elo with
carryover (69.68%), Massey (69.65%), LRMC (69.46%) and in-season Elo (68.52%). FBS-vs-FBS: 69.30% vs CFBD Elo 69.16%.

## Head-to-head step (published)

`h2h.py` adds the fewest-upsets step to the published rating: from the rating order, a one-team-at-a-time search
finds the fewest upsets; those games are accepted, and every other winner is held at least ½ point above its
loser (stiff one-sided penalty, Newton on the engaged set). `run_h2h.py`:

| | Next-week winners | Winner above loser at season end |
|---|---|---|
| 2014–19, rating without the step | 71.91% | 81.3% |
| 2014–19, with the step | 70.52% | 90.5% |
| 2021–26, rating without the step | 70.53% | 80.9% |
| 2021–26, with the step (published) | 69.59% | 90.3% |
