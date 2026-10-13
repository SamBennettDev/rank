# Ranking research

The selected current-standing rule is **sum of frozen win-quality credits minus one point per loss**. The selected final-standing predictor is **correlated game-result simulation over the known schedule**. These choices satisfy the fixed-loss policy and performed best on the specified design objectives among the tested candidates. They are not claims of a universally best ranking.

## Reproduce

```sh
npm ci
npm run calibrate
# Python design comparison requires numpy and scipy; calibration downloads its source years.
OPENBLAS_NUM_THREADS=1 python3 research/current_standings.py
npm run project-backtest -- --history 2014-2019 --samples 1024 --report research/forecast-selection.json
npm run project-backtest -- --history 2021-2025 --samples 2048 --modes correlated --report research/projection-results.json
npm run backtest -- --history 2021-2025 --include-repo --summary --report research/development-results.json
```

Calibration writes defaults and `calibration.json`. Update season configurations and versions deliberately if settings change. Schedule data are pinned to cfbfastR-data commit `a3dd960090c1bfa169cebd491beabf7028b379b2`, cached under `/tmp/rank-backtest` with the revision in the filename. Reports include hashes and settings. Design years are **2014–2019**; **2021–2026 are development evaluation**, because these seasons have already been inspected.

## Current standings: respect the loss policy

`standing-selection.json` compares season-end winner-above-loser agreement on 8,770 completed design games. This is a descriptive consistency measure, not future-game prediction or proof of fairness. Candidates include win percentage, Colley, Bradley–Terry, win-only Elo, raw wins minus losses, and earned-credit formulas varying base win credit, opponent-quality weight and loss deduction.

| Method | Result agreement | Every loss a fixed deduction? |
|---|---:|---|
| Bradley–Terry, prior 2 | 83.17% | No |
| Colley | 82.84% | No |
| **Frozen win quality − losses** | **80.27%** | **Yes: −1** |
| Win-only Elo, K=40 | 79.97% | No |
| Raw wins − losses | 79.33% | Yes: −1 |
| Win percentage | 79.30% | No |

Require the fixed loss deduction to be at least the maximum win credit. Among that tested grid, the selected policy awards 0–1 point per win and deducts 1 per loss. A fixture in the report demonstrates Colley *increasing* a losing team's rating by 0.025 after a loss. Elo's deduction varies with expectation. Fitting a schedule-adjusted rating then adding a loss bonus cannot guarantee the requested fixed change; freezing earned credits can.

Quality is the pre-week probability an opponent beats an average team at the venue, estimated from earlier scores. This establishes a transparent earned-results ranking, while score margins still inform later opponent quality and forecasts. All scores are rounded and ranked with the production convention.

## Final standings: simulate results together

`forecast-selection.json` uses the TypeScript production functions at weeks 4, 7 and 10 over six design seasons, totaling 4,569 team/cutoff observations. The target is final earned-standing rank over the nonconditional regular-season slate. Conditional bowl, playoff and championship assignments are excluded from both schedule and target to avoid hindsight about selected participants.

| Predictor | Final-rank RMSE | Nominal 80% range coverage |
|---|---:|---:|
| Carry current standing forward | 46.20 | — |
| Current predictive-strength order | 58.85 | — |
| Rank expected future results | 43.73 | — |
| Independent game simulations | 41.61 | 71.61% |
| **Correlated game simulations** | **40.83** | **78.46%** |
| Correlated simulations with weekly quality refits | 40.89 | 78.07% |

The selected model shares each sampled team-strength profile across games. This preserves uncertainty across a team's future season and its opponents, and each game has a single complementary winner/loser outcome. Rank is nonlinear: ranking expected earned points differs from expected final rank. The UI now presents a whole-number projected standings table ordered by mean simulated finish; those positions are stored as `projection.rank`. The fractional `expectedRank` remains available for audit. RMSE values in the existing reports measure the mean-finish forecast, rather than silently relabeling those metrics as ordinal-table performance.

Future win credits are estimates from current evidence; the already-started calendar week retains its pre-week quality estimate. The weekly-refit candidate instead generates continuous augmented margins and updates opponent quality in each future week. Its small RMSE disadvantage is not proof of a significant difference, but offers no measured reason to take on the added computation and approximation. The primary selection criterion was final-rank RMSE; median-rank MAE and top-25 Brier are also reported. Selection used 1,024 seeded stratified samples; production uses 2,048.

## Later-season development evaluation

`projection-results.json` evaluates the frozen correlated method at those cutoffs over 2021–2025, with 2,048 samples and 3,924 team/cutoff observations:

| Measure | Current-standing baseline | Projection |
|---|---:|---:|
| Final-rank RMSE | 46.61 | 40.24 |
| Final-rank MAE / projected-median MAE | 34.22 | 30.00 |
| Nominal 80% rank-range coverage | — | 78.16% |
| Top-25 Brier | — | 0.04391 |

Reports include year/week details, cutoffs and hashes. Schedule announcement history and revisions are unavailable; evaluation assumes the eventual nonconditional slate was known. It does not validate a full postseason or live immutable feed. Injuries and roster changes are omitted. Repeated tuning on these years must be disclosed; freeze this choice for prospective testing on new results.

## Internal game-prediction calibration

`calibration.json` records 54 candidates and 7,895 walk-forward forecasts from source week 2 in 2014–2019. The minimum log loss selected home-field shrink **0.0001**, logistic scale **12**, residual scale **14.934045**. It retains the prior score-model design of margin plus a 3-point win premium and equal team shrink 0.05. Stronger home-field shrink did not improve the objective.

Forecast at Monday noon UTC using only scores assumed available six hours after kickoff. Regular season and postseason share this calendar. Earlier playoff rounds count; later regular-season scores cannot leak into them. Game forecasts use internal strength plus venue, with conditional uncertainty widening probabilities. This internal model supplies quality and forecasts; it is not the published earned-standing score.

`development-results.json` records 2021–2025 plus local 2026 through week 6:

| Subset | Games | Winner accuracy | Brier | Log loss |
|---|---:|---:|---:|---:|
| All FBS/FCS games | 6,287 | 71.16% | 0.1888 | 0.5557 |
| FBS vs FBS | 3,301 | 69.58% | 0.1954 | 0.5707 |

These measure game probabilities, not standing quality. No untouched holdout or significant future improvement is claimed.

## Sources and archived work

- [Colley's bias-free ranking method](https://www.colleyrankings.com/matrate.pdf): schedule-adjusted results ranking.
- [Bradley and Terry, 1952](https://doi.org/10.1093/biomet/39.3-4.324): paired-comparison strength model.
- [Massey's rating thesis](https://masseyratings.com/theory/massey97.pdf): least-squares opponent-adjusted score ratings.
- [Pinned schedule source](https://github.com/sportsdataverse/cfbfastR-data/tree/a3dd960090c1bfa169cebd491beabf7028b379b2/schedules/csv).

Earlier Python experiments cover Massey, Elo, LRMC, Colley, Bradley–Terry, Keener, PageRank, priors, robust margins, recency, play-by-play and record/H2H overlays. `training-results.txt` and `holdout-results.txt` are archived experiments. Their old benchmark placed all postseason after regular season, leaking 22 later regular-season results into early 2023–2025 playoff forecasts; it also predicted from rank without venue and used an Elo-availability mask in an FBS comparison. Several purported holdout settings were subsequently tuned on inspected years. Those numbers cannot establish gains under the current date-based production protocol.
