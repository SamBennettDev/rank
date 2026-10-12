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
