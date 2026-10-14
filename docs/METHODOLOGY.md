# Methodology

Rank publishes a **neural ranking of who is more likely to beat whom**, with game forecasts from the same model. The active method is `season-only-neural-2` / `season-only-neural-v2`. The [previous neural method](NEURAL_V1.md) and earned-credit method below remain archived for comparison and projections.

## Robust neural strength and explicit losses

Historical pregame examples teach shared weights, while team statistics reset each season. The final model was chosen from three older validation periods, then annually refit using only earlier seasons. The 2026 weights use 2006–2025. Team/player identities, conferences, divisions, recruiting, polls, preseason ratings and live prices are excluded. IDs only join records.

Every score margin is capped to ±35 **before** fitting all selected score-derived ratings, including the robust Huber rating. The 50-feature whitelist excludes raw margins and scoring averages, raw EPA averages, margin variation, Elo and record-based ratings. Opponent margin context uses capped ratings. Actual play efficiency can add evidence even when the score cap binds. Play summaries retain the existing garbage-time filters.

Three neural fits have eight hidden neurons. With standardized inputs clipped to ±4, each produces a correction bounded to ±1. Let `n` be completed games against modeled opponents and `L` all current-season losses, including losses to outside opponents:

```text
correction = tanh(x · linear + tanh(x · W + bias) · output)
performance = Huber rating fitted to capped margins / 14 + correction
strength = n / (n + 6) × performance − 2 × L / (n + 4)
P(A beats B) = sigmoid(T × (mean strength[A] − mean strength[B] + H × venue))
T = 1.009351327591093
```

The loss deduction is applied **after** training the performance network. Holding other features and n fixed, another loss strictly lowers strength. An actual loss can also change efficiency, opponent adjustments and sample size, so no fixed number of ranking places is guaranteed. Every unplayed team has zero performance strength. No team receives an identity or division prior.

At six modeled games, performance strength is shrunk by half; one additional loss lowers calibrated log odds by about 0.20188, turning an otherwise 50% matchup into about 44.97%. `T` is a positive probability-only temperature fitted on the selected 2014–2019 validation forecasts. It preserves picks and ranks. Neutral and venue-reversed probabilities are complementary.

## Ordering and interpretation

All networks produce scalar team strengths, so the neutral ordering is consistent: every higher-ranked team is favored over every lower-ranked team, with 50% for equal strengths. The shared engine still runs its deterministic weighted pair ordering; this model needs no improving insertion moves and has no favorite-cycle disagreements. Those properties do not measure predictive accuracy.

The displayed average is the mean neutral win probability against the full FBS/FCS field, including a .5 self-match. It is not confidence in a rank. Division and conference filters preserve full-field ranks. Teams without counted results remain unranked. Actual game probabilities include venue; the snapshot’s inputs remain fixed and never use future results.

Team pages show completed games, losses and evidence retained after shrinkage. That weight is not confidence in a rank. Downloaded data also includes rank spread across three fits; it does not quantify all sampling or data uncertainty and is not a confidence interval. Fewer than eight counted games, disconnected schedules or missing play coverage flag limited evidence.

## Evaluation and reproducibility

The [study report](../research/season_only/robust/REPORT.md) documents three registered rounds, 684 new neural fits, 45 optimizer continuations, all dated annual results, matched markets/CFP, full Week 6 rankings, and two different sensitivity checks. Whole-game exclusion changes records and evidence along with performance. A separate score-only check holds those constant and verifies that changing an already extreme margin to 35 leaves the entire new probability matrix unchanged.

On 3,603 weekly FBS games in 2020–2025, the final policy picked 70.16% of winners versus 70.86% for the previous blend. Stronger loss consequences and the cap have a measured accuracy cost. Historical seasons were already inspected, so these are development comparisons, not an untouched holdout or evidence of a general betting-market advantage. Earlier prospective registrations remain unchanged.

`scripts/export-neural.py` rebuilds features from local public-source summaries using production cutoffs and game IDs from `scripts/neural-snapshots.ts`. A result is assumed available six hours after kickoff. The exporter loads saved annual weights and older-fold calibration; it does not retrain. The automatic data-update workflow refreshes rich summaries and numeric snapshots after fetching current results.

```sh
python -m pip install -r scripts/requirements-neural.txt
REFRESH=1 npm run fetch-plays -- 2026
npm run neural:export -- --year 2026 --refresh-rich
npm run compute
npm run verify
```

Portable `neural.json` schema 2 includes 50-feature matrices, games/loss counts, outside-opponent losses, weights, policy, normalization, training years and source hashes. `neural-parity.json` supplies independent Python references for every team at every snapshot and venue cases. The engine rejects stale raw hashes, a wrong year/model, mismatched cutoffs/game IDs or counts that disagree with the raw results. The comparison tool also checks the bundle hash against the displayed ranking.

`rank-engine-19` retains ranking schema 2. `rank`, `tied` and `change` refer to the neural order; `height = field size + 1 − rank` is an ordinal graph coordinate. `teams[].neural` stores full-field probabilities, reliability, calibrated log-odds loss deduction and fit rank spread. Model settings live in `manifest.neural.policy`. `predictions[].homeProbability` is the actual neural forecast; `strengthEdge` is null because the old points scale does not apply. The top-level legacy `lossPenalty` is null for neural methods. `earnedHeight` / `earnedRank`, `credits` and `projection.target = frozen-earned-points` retain the separate archived earned-score calculation.

## Archived frozen-credit model

The remaining sections describe the previous earned-points ranking and its separate predictive/simulation machinery. Those credits do not determine the active neural order.

## Current score and fixed loss deductions

```text
score[i] = sum(frozen win credits earned by i) − number of losses by i
win credit = 2 × P(opponent beats an average FBS team at the winner's venue)
```

A modeled win earns 0–2 points. An average-quality neutral-site win earns 1, balancing the fixed **1-point deduction for every loss**. The v1 range of 0–1 made an ordinary win worth half a loss; this accidentally favored weak unbeaten schedules. V2 fixes that scale without weakening or varying the loss deduction.

Credits freeze at **Monday 12:00 UTC before the game’s calendar week**, using scores assumed available six hours after kickoff. Opponent strength, venue and uncertainty determine the award, not the winning team’s name or the margin of that win. Round opponent probability to six decimals before multiplying by 2. Adding a later loss reduces the losing team’s score exactly 1; past credits cannot improve and undo that deduction. Input corrections and algorithm changes can alter a recomputed award, with hashes and settings identifying its basis.

Every resolved result against an opponent outside the strength-model field stays in the record and ledger: an unsupported win earns **0** quality points and a loss deducts **1**. These results are excluded from the strength fit because their opponents have no calibrated strength data. Supporting opponent metadata appears in `opponents` and cannot occupy a rank. `counts.modeled` and `counts.unmodeled` distinguish the two input groups.

Published six-decimal scores sort descending, with competition ranks for exact ties. A team with any counted result is ranked, including a zero-credit win; only teams with no results are unranked. Team IDs break display-order ties. Filters preserve full-field ranks. There is no division rank ceiling, record overlay or head-to-head override.

## Opponent-strength model and FBS reference

From the home side of a modeled game:

```text
y = home points − away points + 3 × sign(home points − away points)
x = 1 for a home venue, 0 for neutral
minimize Σ_games (y − (r[home] − r[away] + H × x))²
         + shrink × Σ_teams (r[i] − prior[i])²
         + homeFieldShrink × (H − homeFieldPrior)²
```

For v2, the frozen 2014–2019 settings are:

| Setting | Value |
|---|---:|
| Mean FBS–FCS strength gap | 31.644079 |
| Team shrink | 1 |
| Home-field prior | 2.668394 |
| Home-field shrink | 64 |
| Probability scale | 12 |
| Residual scale | 14.934045 |
| Win scale | 2 |

The division gap is the mean difference between end-of-season FBS/FCS fitted strengths on design seasons; the home-field prior is the mean fitted home effect. Priors are centered to a common zero offset. There are no individual team or conference priors. Ridge strength was selected from a fixed grid by minimum pooled pre-week game log loss on **2014–2019**, with the design-window priors fixed. That is training calibration, not out-of-sample validation. The balanced win scale is a scoring policy: it is not selected to move particular current teams or maximize an agreement statistic by diminishing losses.

Current results update every team away from its division starting estimate. A strong FCS team can become a stronger opponent than an ordinary FBS team and earn more credit. The prior is not a permanent division deduction or a ranking cap. Sparse estimates no longer imply every unknown FCS opponent has a 50% chance against average FBS opposition.

Let `A` be the penalized information matrix, `σ = residualScale`, and `Σ = σ² A⁻¹`. Let `w` average all FBS strengths in the configured model inputs, and `site` be +1 for a win at home, −1 away, or 0 neutral:

```text
FBS benchmark = wᵀ r
credit edge = r[opponent] − FBS benchmark − site × H
c = opponent coefficient − w − site × home-field coefficient
credit variance = cᵀ Σ c
P = logistic(credit edge / sqrt(probabilityScale² + 3 × credit variance / π²))
win credit = 2 × round6(P)
```

The contrast includes covariance between the opponent, FBS benchmark and home field. Treating the benchmark as a fixed zero or as the average of all FBS/FCS teams is incorrect. A common shift in every modeled strength leaves credits unchanged. The logistic variance approximation remains deterministic through fixed arithmetic and Cholesky factors shared by Node and the browser.

For game probabilities, use the home-minus-away contrast plus home field with the same covariance. Each credit records the estimated probability, opponent and reference strengths, venue adjustment, standard error, opponent evidence count and award cutoff. Every loss is still a fixed deduction independent of those quantities.

V1 remains reproducible for archived configurations without `winQuality`: it uses a pooled zero reference, weak equal priors and 0–1 win credits. New real-season configurations use `earned-standing-2` and the frozen settings above.

## Final-standing projection

The simulation engine remains available in downloadable data and research tools; forecasts are no longer displayed on the site. Its target is **Rank's own final earned-standing order over the known remaining schedule**. Simulated games include supporting opponents, while final ranks and probabilities use only the eligible ranked field. `rank` is the whole-number competition rank ordered by ascending simulated mean finish; `expectedRank` is the fractional mean. Ranges and top-25/first probabilities describe that distribution. Sorting mean finishes minimizes total expected squared rank error among complete strict orders.

For each of **2,048 fixed-seed stratified simulations**:

1. Draw a joint team-strength and home-field profile from the current Gaussian model. Center the population's average team strength to zero. Use this same profile for every remaining game, preserving shared uncertainty between opponents and a team's successive results.
2. For each known remaining matchup, add independent logistic game noise with scale 12 to the simulated home/away strength difference and home field. Its sign decides one winner and one loser.
3. Add the winning team's estimated win credit and deduct exactly 1 point from the loser. Future win credits use today's calibrated opponent evidence and the same v2 FBS reference and balanced scale. If a future game belongs to the already-started calendar week, keep its pre-week credit estimate. Later weeks use the current snapshot as the estimate of their eventual pre-week quality.
4. Rank only eligible FBS/FCS teams by final earned scores with the same six-decimal competition-rank rule as current standings; supporting opponents never occupy a rank.

Average the simulated scores and ranks and take empirical rank/rating percentiles. Top-25 and first-place probabilities count simulated competition ranks. With no remaining games, return the exact current scores/ranks without simulation noise. Scheduled unplayed teams can receive a broad projection while remaining unranked currently. Teams without results or a remaining known matchup have no projection.

This is a **correlated results simulation**, not a simulation of final power-rating changes. Future win credits are estimates: they are not frozen actual awards until their real calendar weeks. A more expensive candidate simulated augmented margins and re-fit opponent quality every future week, but had slightly worse design-sample rank RMSE and was not selected.

The model assumes stable strengths and sites. Injuries, roster changes, cancellations and unassigned postseason participants are omitted. The logistic game-noise model and Gaussian strength posterior are approximations. Single-game displayed probabilities use variance matching; simulated marginal probabilities integrate the sampled profile and can differ slightly. Model ranges are conditional rather than guaranteed coverage; finite simulations also add sampling error. The fixed seed and stratification make identical inputs reproducible.

The projection manifest records method, sample count, seed, remaining-game count, horizon, recorded unassigned-matchup count and projected field size. Unknown bowl/playoff/championship games enter after participants are known. Missing future dates cannot be forecast. Historical schedule changes and announcement times are unavailable, so historical projection evaluation assumes the nonconditional slate was known at each cutoff.

## Dates, scope and provisional evidence

The source supplies kickoffs and final scores, without historical result-availability timestamps. Assume scores become available **six hours after kickoff**; unusual delays and retrospective corrections remain limitations. Calendar weeks run from Monday noon UTC to the following Monday. Win-credit estimation, snapshot inclusion and backtesting use this same calendar.

A `week-NN` snapshot retains its source regular-season week label. Its cutoff is the end of the calendar week containing that week's first completed regular-season game, capped at the latest known kickoff plus six hours. Snapshot `asOf` determines inclusion; `throughWeek` is a display label. Regular-season and postseason results share this date ordering, preventing early FCS playoffs from using later regular-season scores. Separate later postseason calendar snapshots are emitted, with `postseason` naming the latest one. The current snapshot extends through the latest known result if a rescheduled game or its result lag crosses the last nominal weekly boundary.

Completed, scored, untied results involving a configured team count, including resolved unmodeled opponents. Only games between model teams affect strength estimates. Duplicate or invalid IDs, invalid scores and undated completed games fail validation. Out-of-scope, incomplete and tied games are counted separately. Dated future matchups after a snapshot cutoff may be projected regardless of whether the archival CSV now contains their later result; future outcome fields are never read. Matchup cards require both teams to have played; season simulations also admit scheduled unplayed teams.

Teams with fewer than three strength-model games, or a played-team graph with multiple connected components, are `provisional`. Output records component ID and size. Cross-group strength comparisons rely on the common zero prior, so early win quality and projections can change substantially as evidence accumulates.

## Archived v1 selection and evaluation

Schedule data are pinned to sportsdataverse/cfbfastR-data commit `a3dd960090c1bfa169cebd491beabf7028b379b2`. Reports include input hashes. Design/calibration uses **2014–2019**; later seasons were previously inspected and are **development evaluation**, not untouched holdouts.

`research/standing-selection.json` compares win percentage, raw wins minus losses, Colley, Bradley–Terry, win-only Elo and a grid of earned-credit formulas. The selection criterion is descriptive season-end winner-above-loser agreement among rules with a fixed loss deduction at least as large as the largest win credit. The selected rule was `sum(win quality) − losses`, agreeing with 80.27% of 8,770 game results. Bradley–Terry and Colley had higher agreement but fail the required fixed-deduction policy. A fixture demonstrates a Colley rating increasing after a loss. Result agreement is not predictive accuracy and is not proof of a uniquely fair ordering.

`npm run calibrate` tunes the internal prediction model on 7,895 walk-forward design forecasts from source week 2. It compares six home-field shrink values and nine logistic scales by pooled log loss. Residual scale is `sqrt(mean(out-of-sample augmented-margin error² / (1 + unit-noise matchup variance)))`. Stronger permanent home-field shrinkage did not improve that objective. Settings are frozen in season configurations under calibration ID `calendar-2014-2019-v1`.

`research/forecast-selection.json` compares carrying current rank forward, ordering current predictive strength, ranking expected future results, independent result simulation, correlated simulation, and simulation with weekly opponent-quality refits. At weeks 4, 7 and 10 over six design seasons, 1,024-sample correlated forecasts had the lowest tested simulation RMSE: **40.83 places**, against current-rank baseline **46.20**, expected-result ordering **43.73**, independent simulation **41.61**, and weekly-refit simulation **40.89**. Nominal 80% range coverage was **78.46%**. The small gap to weekly refitting supports choosing the simpler model, rather than a claim of statistically significant superiority.

`npm run project-backtest -- --history 2021-2025 --samples 2048 --modes correlated --report research/projection-results.json` evaluates final earned-standing ranks from the nonconditional regular-season slate. It excludes postseason and source-annotated championship/playoff/bowl assignments from both future schedule and target, avoiding hindsight about selected participants. These existing reports evaluated the combined FBS/FCS field, rather than the new FBS-only publication. At the three cutoffs, over **3,924 team/cutoff observations**, RMSE is **40.24** vs **46.61** carrying current rank forward, median-rank MAE **30.00** vs **34.22**, nominal 80% coverage **78.16%**, and top-25 Brier score **0.04391**. Reports also break out each week and year.

`npm run backtest -- --history 2021-2025 --include-repo --summary --report research/development-results.json` evaluates game probabilities from week 4 onward with the production prediction functions. Monday cutoffs use only earlier available scores. It reports winner accuracy, Brier/log loss, reliability bins, per-season, true FBS-vs-FBS and provisional subsets, with per-game forecasts when `--summary` is omitted. On 2021–2025 plus 2026 through week 6: **71.16% of 6,287 winners**, Brier **0.1888**, log loss **0.5557**. These game metrics measure the internal predictor, not current-standing quality.

None of these comparisons establishes a universal best algorithm or guaranteed future performance. Freeze settings for prospective evaluation on new results. Earlier experiments used a different postseason order and ranking-based predictions; their apparent holdout comparisons cannot establish gains under this protocol.

## Unit ratings

Offense, defense and special teams are explanatory outputs from public cfbfastR play-by-play, leaving the overall standing and forecasts unchanged. Garbage-time thresholds exclude score gaps above 38 in quarter 2, 28 in quarter 3, and 22 in quarter 4. Opponent/site-adjusted EPA per snap yields offense/defense, weighted by snaps and shrunk toward average; net special-teams EPA yields a separate game-based fit. Mean snaps convert offense/defense to points per game. Missing covered plays produce null unit statistics.

## Determinism and changes

Teams and games use numeric ID order for summation. Cholesky, variances, seed arithmetic and ranking use fixed loops. Stratified normal/logistic samples use fixed CDF, quantile, exponential and logarithm approximations, avoiding platform-dependent transcendental functions in published bytes. Values round to six decimals. JSON has fixed key order with one team, prediction and award per line.

Schema 2 includes engine/algorithm versions, the fixed-loss rule, prediction settings, hashes, counts, diagnostics, credits, current standing and forecasts. Node verification and browser Recompute call the same `computeSeason` pipeline. There is no runtime randomness or wall-clock input.

Mathematical or setting changes bump `algorithmVersion`; output-byte/schema changes bump `ENGINE_VERSION`. Regenerate every ranking and update this specification together. CI checks type safety, tests, byte reproduction and the production build.

## V2 evidence and current audit

`research/win_quality.py` reproduces the 2014–2019 design study and `win-quality-calibration.json`, with pinned input hashes and all candidates. `research/win_quality_development.py` freezes those settings on already-inspected 2021–2025 inputs. Across 7,703 pre-week game predictions, log loss changes from **0.56986 to 0.53778** and Brier score from **0.19441 to 0.18176**. Descriptive final-standing FBS game-result agreement changes from **79.09% to 79.76%**, cross-division agreement from **75.08% to 79.73%**, and FCS-only agreement from **81.05% to 80.72%**. These are development comparisons over known FBS/FCS games, not an untouched holdout, an AP-poll test or a guarantee about individual ranks. Lower-division record fixes are covered separately by production tests.

`npm run audit-win-quality -- 2026` writes a same-input current diagnostic, including James Madison and leading FCS teams, every restored lower-division loss, and score-to-ledger equality for all teams. Current examples never select model settings. Downloadable v2 final-standing projections have not had their season-end accuracy re-evaluated; historical forecast-accuracy reports describe v1.
