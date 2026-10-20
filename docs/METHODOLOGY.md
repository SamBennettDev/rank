# Methodology

Rank publishes one ranking for FBS and FCS teams in two passes (`springs-then-points-1`, `src/engine/springs.ts`). The first pass is SpringRank with margins counted at diminishing returns, and gives every team a quality from 0 to 7. The second pass adds up each team's games: a win earns the beaten team's quality, a loss costs 7 minus the winner's. The totals are the ranking. No home field or head-to-head rules. Every team starts the season at 0; no polls, preseason, recruiting or conference membership enter.

## Pass 1: SpringRank with margins

Each game `e` is a spring of strength 1 that wants its winner `gap[e]` points above its loser:

```text
gap[e] = 7 × (1 + 1/2 + 1/3 + … + 1/margin[e])
```

A 1-point win is worth 7, a 2-point win 10.5, a 3-point win 12.8, a 14-point win 22.8 and a 35-point win 29.0: each extra point counts less than the one before (it grows like the log of the margin). It needs only + and ÷, so it is exact and platform-independent. Strengths `s` minimise

```text
½ Σ_games (s[winner] − s[loser] − gap[e])²  +  ½ strengthShrink × Σ_teams s[i]²
```

Setting the slope to zero gives one symmetric positive-definite linear system, solved exactly with a Cholesky decomposition. At the answer every team's strength is the **average of what its games say**, with `strengthShrink = 0.5` weight on 0 (an average team):

```text
s[i] = Σ_games of i (s[opponent] ± gap[e])  /  (games of i + strengthShrink)
```

where the target is the opponent's strength + gap after a win and − gap after a loss. A team with no games stays at 0. The pull toward 0 keeps the system solvable while the graph is still in pieces early in the season. Each strength becomes a **quality**, 7 × the chance of beating an average (strength-0) team:

```text
quality[i] = 7 × logistic(qualityScale × s[i]),   qualityScale = 0.08
```

## Pass 2: points, the ranking

Each game gives points to both teams:

```text
winner earns  + quality[loser]
loser earns   − (7 − quality[winner])
```

| Result | Points |
|---|---|
| Beat a good team (quality 6.5) | +6.5 |
| Lose to a good team (quality 6.5) | −0.5 |
| Beat a bad team (quality 0.5) | +0.5 |
| Lose to a bad team (quality 0.5) | −6.5 |

A team's **height** is the sum of its games' points. That total is the ranking.

Each game's `margin`, `win` (the winner's points) and `loss` (the loser's points) are published in `springs`, and each team's `strength`, `quality` (published as the 0–1 chance; × 7 for quality points) and `height` in `teams`. Published six-decimal heights sort descending, with competition ranks for exact ties. A team with any counted result is ranked; only teams with no results are unranked. Team IDs break display-order ties. Filters preserve full-field ranks.

## Settings and accuracy

The settings were chosen on public 2014–2019 schedules (FBS + FCS) and frozen. `strengthShrink` gave pass 1 its best next-week accuracy and `qualityScale` its best log loss, so quality is a calibrated win probability. Accuracy is measured two ways: next-week winners picked by each week's ranking (from week 4, using only earlier games) and season-end agreement (the final ranking has the winner above the loser). `python3 research/springs.py 2014-2019` reproduces them:

| Seasons | Next-week winners | Winner above loser at season end |
|---|---:|---:|
| 2014–2019 (design, 6,797 and 8,770 games) | 67.9% | 83.1% |
| 2021–2026 through week 7 (6,403 and 8,613 games) | 66.9% | 82.9% |

2021–2026 were looked at during design, so they are a check rather than an untouched holdout.

## Dates, scope and provisional evidence

The source supplies kickoffs and final scores, without historical result-availability timestamps. Assume scores become available **six hours after kickoff**; unusual delays and retrospective corrections remain limitations. Calendar weeks run from Monday noon UTC to the following Monday. Snapshot inclusion and backtesting use this same calendar.

A `week-NN` snapshot retains its source regular-season week label. Its cutoff is the end of the calendar week containing that week's first completed regular-season game, capped at the latest known kickoff plus six hours. Snapshot `asOf` determines inclusion; `throughWeek` is a display label. Regular-season and postseason results share this date ordering, preventing early FCS playoffs from using later regular-season scores. Separate later postseason calendar snapshots are emitted, with `postseason` naming the latest one. The current snapshot extends through the latest known result if a rescheduled game or its result lag crosses the last nominal weekly boundary.

Completed, scored, untied results involving a configured team count, including results against lower-division opponents: those opponents become nodes on the spring graph (listed in `opponents`, never ranked). Only games between model teams affect the matchup model. Duplicate or invalid IDs, invalid scores and undated completed games fail validation. Out-of-scope, incomplete and tied games are counted separately. Dated future matchups after a snapshot cutoff get a prediction regardless of whether the archival CSV now contains their later result; future outcome fields are never read. Matchup cards require both teams to have played.

Teams with fewer than three matchup-model games, or a played-team graph with multiple connected components, are `provisional`. Output records component ID and size. Cross-group comparisons rely on the common pull toward 0, so early heights can change substantially as evidence accumulates.

## Matchup predictions

Game odds on the matchups page come from a separate, calibrated margin model (`src/engine/rating.ts`, `matchup.ts`, `model.ts`); it never changes the ranking. From the home side of a modeled game:

```text
y = home points − away points + winBonus × sign(home points − away points)
x = 1 for a home venue, 0 for neutral
minimize Σ_games (y − (r[home] − r[away] + H × x))²
         + shrink × Σ_teams (r[i] − start[i])²
         + homeFieldShrink × (H − homeField)²
P(home wins) = logistic(edge / sqrt(probabilityScale² + 3 × variance / π²))
```

`start` is 0 for FBS teams and −`divisionGap` for FCS teams, centred on 0. Settings (`config.matchup`): winBonus 3, divisionGap 31.644079, shrink 1, homeField 2.668394, homeFieldShrink 64, probabilityScale 12, residualScale 14.934045, all chosen on 2014–2019. Variance is the matchup contrast under `residualScale² × A⁻¹`, where `A` is the penalized information matrix. `npm run backtest -- --history 2021-2025 --include-repo --summary` evaluates these odds from week 4 at Monday cutoffs. Teams with fewer than three model games, or a graph in several pieces, are `provisional`.

## Unit ratings

Offense, defense and special teams are explanatory outputs from public cfbfastR play-by-play, leaving the ranking and matchup predictions unchanged. Garbage-time thresholds exclude score gaps above 38 in quarter 2, 28 in quarter 3, and 22 in quarter 4. Opponent/site-adjusted EPA per snap yields offense/defense, weighted by snaps and shrunk toward average; net special-teams EPA yields a separate game-based fit. Mean snaps convert offense/defense to points per game. Missing covered plays produce null unit statistics.

## Determinism and changes

Teams and games use numeric ID order for summation. The pass-1 spring graph, pass-2 sums, the matchup model, variances and ranking use fixed loops and Cholesky with only + − × / and √. The quality logistic and probabilities use fixed-arithmetic `expFixed`, avoiding platform-dependent transcendental functions in published bytes. Values round to six decimals. JSON has fixed key order with one team, prediction and spring per line.

Schema 1 includes engine/algorithm versions, spring and prediction settings, hashes, counts, diagnostics, every game's points (`springs`: margin, win and loss), each team's pass-1 `strength`, `quality` and pass-2 `height`, and matchup predictions. Node verification and browser Recompute call the same `computeSeason` pipeline. There is no runtime randomness or wall-clock input.

Mathematical or setting changes bump `algorithmVersion`; output-byte/schema changes bump `ENGINE_VERSION`. Regenerate every ranking and update this specification together. CI checks type safety, tests, byte reproduction and the production build.
