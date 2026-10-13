# Methodology

Rank publishes one **earned-standing rating**, shown as current standing vs projected final standing. All configured FBS/FCS teams start at zero. No preseason, recruiting, brand, poll or conference input is used. An internal score model estimates opponent quality and game probabilities; its strength estimates are not another published standing.

## Current standing and fixed loss deductions

```text
standing[i] = sum(win credits earned by i) − number of losses by i
win credit = P(opponent beats an average team at the winner's venue)
```

Each win earns 0–1 point. Every loss deducts exactly **1 point**, regardless of opponent, venue, score margin or expected result. Wins against stronger opponents earn more credit. Early or uncertain opponent estimates move toward 0.5 credit. Win credits are rounded to six decimals before being awarded.

Estimate a game's opponent quality at **Monday 12:00 UTC before its calendar week**, using only scores available at that cutoff. Freeze that credit after the game. Adding a later loss therefore reduces the losing team's rating by exactly one point: it cannot revalue previous wins or receive credit for outperforming expectations in defeat. Source corrections and changes to settings can still change a recomputed historical award; the committed inputs and hashes identify its basis.

There is no averaging by games played, record overlay, or head-to-head override. More quality wins accumulate points; the fixed deduction is at least as large as any individual win credit. A team's current score is fully accounted for by its completed results, so it has no modeled current-score error bar. Opponent quality itself is estimated, and the provisional label identifies limited evidence.

Order published six-decimal scores descending. Equal values receive competition ranks and a tie label; a team with no counted games is unranked. Game IDs break display-order ties, not scoring ties. Each output includes `credits`: game ID, winner/loser team IDs, awarded win value and pre-week cutoff. A loser receives −1 without a separate award row. Team pages sum these awards and deductions.

## Internal prediction and opponent-quality model

For each completed, untied game, from the home team's side:

```text
y = home points − away points + winBonus × sign(home points − away points)
x = 1 for a home venue, 0 for a neutral site
minimize Σ_games (y − (r[home] − r[away] + H × x))²
         + shrink × Σ_teams r[i]² + homeFieldShrink × H²
```

The fixed settings are `winBonus = 3`, `shrink = 0.05`, `homeFieldShrink = 0.0001`, `probabilityScale = 12`, and `residualScale = 14.934045`. These are score-model quantities, not earned-standing points. Raw margins inform future estimates of opponent strength; running up a score does not directly add current-standing credit. Cholesky solves the positive-definite system in canonical game/team order.

Let `A` be its penalized information matrix and `σ = residualScale`. Conditional Gaussian uncertainty is `Σ = σ² A⁻¹`. The matchup contrast is `c = (+1 home team, −1 away team, x home-field coefficient)`:

```text
edge = r[home] − r[away] + H × x
variance = cᵀ Σ c
effective scale = sqrt(probabilityScale² + 3 × variance / π²)
P(home wins) = logistic(edge / effective scale)
```

This logistic variance matching is an approximation to posterior prediction. It accounts for team/home-field covariance and brings uncertain probabilities toward 50%.

For a win credit, replace the winning team with an average team of strength zero. With `site = +1` at home, `−1` away, and `0` neutral:

```text
credit edge = r[opponent] − site × H
credit variance = Var(r[opponent] − site × H | population average = 0)
win credit = logistic(credit edge / sqrt(probabilityScale² + 3 × credit variance / π²))
```

Equal team shrink makes the common population-average offset independent of all contrasts. Conditioning it to zero subtracts `σ² / (n × shrink)` from the reference variance. The inverse Cholesky factor computes all variances without another fit. The manifest records fitted home field and its model standard error.

## Final-standing projection

The target is **Rank's own final earned-standing order over the known remaining schedule**, not an AP poll, playoff selection, or championship forecast. The table compares Current Standing and Projected Finish side by side and can sort either column. The primary projected standing is a whole-number position: order teams by ascending average simulated finish and assign competition ranks, preserving exact ties. This produces a coherent final-table estimate with a #1 team. Among complete strict orders, sorting mean finishes minimizes total expected squared rank error. The mean itself may be fractional (for example 6.4) and remains an audit statistic in expandable team details, alongside the median. The 80% finish range and top-25/first probabilities describe the simulation distribution, rather than confidence that the ordinal table position will occur. The table position can lie outside a team’s central simulated range because a single complete ordering is different from independent per-team median or modal estimates.

Each projection includes `rank` for the ordinal standings estimate and `expectedRank` for the simulated mean. The main UI uses `rank`; its movement arrows compare that position with current standing.

For each of **2,048 fixed-seed stratified simulations**:

1. Draw a joint team-strength and home-field profile from the current Gaussian model. Center the population's average team strength to zero. Use this same profile for every remaining game, preserving shared uncertainty between opponents and a team's successive results.
2. For each known remaining matchup, add independent logistic game noise with scale 12 to the simulated home/away strength difference and home field. Its sign decides one winner and one loser.
3. Add the winning team's estimated win credit and deduct exactly 1 point from the loser. Future win credits use today's opponent evidence. If a future game belongs to the already-started calendar week, keep its pre-week credit estimate. Later weeks use the current snapshot as the estimate of their eventual pre-week quality.
4. Rank final earned scores with the same six-decimal competition-rank rule as current standings.

Average the simulated scores and ranks and take empirical rank/rating percentiles. Top-25 and first-place probabilities count simulated competition ranks. With no remaining games, return the exact current scores/ranks without simulation noise. Scheduled unplayed teams can receive a broad projection while remaining unranked currently. Teams without results or a remaining known matchup have no projection.

This is a **correlated results simulation**, not a simulation of final power-rating changes. Future win credits are estimates: they are not frozen actual awards until their real calendar weeks. A more expensive candidate simulated augmented margins and re-fit opponent quality every future week, but had slightly worse design-sample rank RMSE and was not selected.

The model assumes stable strengths and sites. Injuries, roster changes, cancellations and unassigned postseason participants are omitted. The logistic game-noise model and Gaussian strength posterior are approximations. Single-game displayed probabilities use variance matching; simulated marginal probabilities integrate the sampled profile and can differ slightly. Model ranges are conditional rather than guaranteed coverage; finite simulations also add sampling error. The fixed seed and stratification make identical inputs reproducible.

The projection manifest records method, sample count, seed, remaining-game count, horizon, recorded unassigned-matchup count and projected field size. Unknown bowl/playoff/championship games enter after participants are known. Missing future dates cannot be forecast. Historical schedule changes and announcement times are unavailable, so historical projection evaluation assumes the nonconditional slate was known at each cutoff.

## Dates, scope and provisional evidence

The source supplies kickoffs and final scores, without historical result-availability timestamps. Assume scores become available **six hours after kickoff**; unusual delays and retrospective corrections remain limitations. Calendar weeks run from Monday noon UTC to the following Monday. Win-credit estimation, snapshot inclusion and backtesting use this same calendar.

A `week-NN` snapshot retains its source regular-season week label. Its cutoff is the end of the calendar week containing that week's first completed regular-season game, capped at the latest known kickoff plus six hours. Snapshot `asOf` determines inclusion; `throughWeek` is a display label. Regular-season and postseason results share this date ordering, preventing early FCS playoffs from using later regular-season scores. Separate later postseason calendar snapshots are emitted, with `postseason` naming the latest one. The current snapshot extends through the latest known result if a rescheduled game or its result lag crosses the last nominal weekly boundary.

Only completed, scored, untied games between configured teams count. Duplicate or invalid IDs, invalid scores and undated completed games fail validation. Out-of-scope, incomplete and tied games are counted separately. Dated future matchups after a snapshot cutoff may be projected regardless of whether the archival CSV now contains their later result; future outcome fields are never read. Matchup cards require both teams to have played; season simulations also admit scheduled unplayed teams.

Teams with fewer than three counted games, or a played-team graph with multiple connected components, are `provisional`. Output records component ID and size. Cross-group strength comparisons rely on the common zero prior, so early win quality and projections can change substantially as evidence accumulates.

## Selection and evaluation

Schedule data are pinned to sportsdataverse/cfbfastR-data commit `a3dd960090c1bfa169cebd491beabf7028b379b2`. Reports include input hashes. Design/calibration uses **2014–2019**; later seasons were previously inspected and are **development evaluation**, not untouched holdouts.

`research/standing-selection.json` compares win percentage, raw wins minus losses, Colley, Bradley–Terry, win-only Elo and a grid of earned-credit formulas. The selection criterion is descriptive season-end winner-above-loser agreement among rules with a fixed loss deduction at least as large as the largest win credit. The selected rule was `sum(win quality) − losses`, agreeing with 80.27% of 8,770 game results. Bradley–Terry and Colley had higher agreement but fail the required fixed-deduction policy. A fixture demonstrates a Colley rating increasing after a loss. Result agreement is not predictive accuracy and is not proof of a uniquely fair ordering.

`npm run calibrate` tunes the internal prediction model on 7,895 walk-forward design forecasts from source week 2. It compares six home-field shrink values and nine logistic scales by pooled log loss. Residual scale is `sqrt(mean(out-of-sample augmented-margin error² / (1 + unit-noise matchup variance)))`. Stronger permanent home-field shrinkage did not improve that objective. Settings are frozen in season configurations under calibration ID `calendar-2014-2019-v1`.

`research/forecast-selection.json` compares carrying current rank forward, ordering current predictive strength, ranking expected future results, independent result simulation, correlated simulation, and simulation with weekly opponent-quality refits. At weeks 4, 7 and 10 over six design seasons, 1,024-sample correlated forecasts had the lowest tested simulation RMSE: **40.83 places**, against current-rank baseline **46.20**, expected-result ordering **43.73**, independent simulation **41.61**, and weekly-refit simulation **40.89**. Nominal 80% range coverage was **78.46%**. The small gap to weekly refitting supports choosing the simpler model, rather than a claim of statistically significant superiority.

`npm run project-backtest -- --history 2021-2025 --samples 2048 --modes correlated --report research/projection-results.json` evaluates final earned-standing ranks from the nonconditional regular-season slate. It excludes postseason and source-annotated championship/playoff/bowl assignments from both future schedule and target, avoiding hindsight about selected participants. At the three cutoffs, over **3,924 team/cutoff observations**, RMSE is **40.24** vs **46.61** carrying current rank forward, median-rank MAE **30.00** vs **34.22**, nominal 80% coverage **78.16%**, and top-25 Brier score **0.04391**. Reports also break out each week and year.

`npm run backtest -- --history 2021-2025 --include-repo --summary --report research/development-results.json` evaluates game probabilities from week 4 onward with the production prediction functions. Monday cutoffs use only earlier available scores. It reports winner accuracy, Brier/log loss, reliability bins, per-season, true FBS-vs-FBS and provisional subsets, with per-game forecasts when `--summary` is omitted. On 2021–2025 plus 2026 through week 6: **71.16% of 6,287 winners**, Brier **0.1888**, log loss **0.5557**. These game metrics measure the internal predictor, not current-standing quality.

None of these comparisons establishes a universal best algorithm or guaranteed future performance. Freeze settings for prospective evaluation on new results. Earlier experiments used a different postseason order and ranking-based predictions; their apparent holdout comparisons cannot establish gains under this protocol.

## Unit ratings

Offense, defense and special teams are explanatory outputs from public cfbfastR play-by-play, leaving the overall standing and forecasts unchanged. Garbage-time thresholds exclude score gaps above 38 in quarter 2, 28 in quarter 3, and 22 in quarter 4. Opponent/site-adjusted EPA per snap yields offense/defense, weighted by snaps and shrunk toward average; net special-teams EPA yields a separate game-based fit. Mean snaps convert offense/defense to points per game. Missing covered plays produce null unit statistics.

## Determinism and changes

Teams and games use numeric ID order for summation. Cholesky, variances, seed arithmetic and ranking use fixed loops. Stratified normal/logistic samples use fixed CDF, quantile, exponential and logarithm approximations, avoiding platform-dependent transcendental functions in published bytes. Values round to six decimals. JSON has fixed key order with one team, prediction and award per line.

Schema 2 includes engine/algorithm versions, the fixed-loss rule, prediction settings, hashes, counts, diagnostics, credits, current standing and forecasts. Node verification and browser Recompute call the same `computeSeason` pipeline. There is no runtime randomness or wall-clock input.

Mathematical or setting changes bump `algorithmVersion`; output-byte/schema changes bump `ENGINE_VERSION`. Regenerate every ranking and update this specification together. CI checks type safety, tests, byte reproduction and the production build.
