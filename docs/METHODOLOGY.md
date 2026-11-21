# Methodology

Rank publishes one ranking for FBS and FCS teams (`quality-springs-2`, `src/engine/springs.ts`). **Quality** comes from one SpringRank with margins counted at gently diminishing returns. The official ranking is **résumé** (0–100: a win earns 50 plus half the beaten team's quality, a loss half the winner's, averaged per game); quality is the second board. **Schedule** is the average quality of the opponents played. No home field or head-to-head rules. Every team starts the season at 0; no polls, preseason, recruiting or conference membership enter.

## Quality: SpringRank with margins

Each game `e` is a spring that wants its winner `gap[e]` points above its loser:

```text
gap[e] = 100 × margin[e]^0.75 = 100 × √margin × √√margin
```

A 1-point win is worth 100, a 2-point win 168.2, a 3-point win 228.0, a 7-point win 430.4, a 14-point win 723.8 and a 35-point win 1439.0: each extra point counts a little less than the one before. Computing it with two square roots keeps it exact and platform-independent. Every spring is equally strong, and strengths `s` minimise

```text
½ Σ_games (s[winner] − s[loser] − gap[e])²  +  ½ strengthShrink × Σ_teams s[i]²
```

Setting the slope to zero gives one symmetric positive-definite linear system, solved exactly once with a Cholesky decomposition. At the answer every team's strength is the **average of what its games say**, with `strengthShrink = 0.25` games' weight on 0 (an average team):

```text
s[i] = Σ_games of i (s[opponent] ± gap[e])  /  (games of i + strengthShrink)
```

where the target is the opponent's strength + gap after a win and − gap after a loss. A team with no games stays at 0. The pull toward 0 keeps the system solvable while the graph is still in pieces early in the season. Each strength becomes a **quality**, 100 × the chance of beating an average (strength-0) team:

```text
quality[i] = 100 × logistic(qualityScale × s[i]),   qualityScale = 0.002
```

Because margins count at only gently diminishing returns, a blowout of a weak team says the winner is far better, which is what its rating already says, so it doesn't drag a strong winner down; a bigger win over the same opponent always lifts the winner more. (Version 1 used `100 × (1 + 1/2 + … + 1/margin)` with springs re-weighted by surprise to get the same effect; `research/QUALITY.md` shows the simpler model predicts better.)

Quality, published as each team's `height`, is team strength and the second board.

## Résumé and schedule

Each game gives résumé points to both teams:

```text
winner earns  50 + quality[loser] / 2     (50 to 100)
loser earns   quality[winner] / 2          (0 to 50)
```

| Result | Points |
|---|---|
| Beat a good team (quality 90) | 95 |
| Lose to a good team (quality 90) | 45 |
| Beat a bad team (quality 10) | 55 |
| Lose to a bad team (quality 10) | 5 |

A team's **résumé** is its games' points divided by the games it played, so an extra game is no advantage by itself. Its **schedule** is the average quality of the opponents it played. Both are ranked among the ranked field (`resumeRank`, `scheduleRank`); neither changes the ranking.

Each game's `margin`, `win` (the winner's résumé points) and `loss` (the loser's) are published in `springs`, and each team's `height` (quality), `strength`, `resume`, `resumeRank`, `schedule` and `scheduleRank` in `teams`, with `change`, `resumeChange` and `scheduleChange` giving places gained on each board since the previous snapshot. Published six-decimal qualities sort descending, with competition ranks for exact ties. A team with any counted result is ranked; only teams with no results are unranked. Team IDs break display-order ties. Filters preserve full-field ranks.

## Settings and accuracy

The settings were chosen on public 2014–2019 schedules (FBS + FCS) and frozen. The margin exponent and `strengthShrink` were chosen for next-week log loss (exponents 0.7–0.9 score alike; 0.75 is the one that needs only square roots), and `qualityScale` is the value with the best log loss, so quality is a calibrated win probability. Accuracy is measured two ways: next-week winners picked by each week's ranking (from week 4, using only earlier games) and season-end agreement (the final ranking has the winner above the loser). `python3 research/springs.py 2014-2019` reproduces them:

| Seasons | Résumé: next-week winners | Résumé: season end | Quality: next-week winners | Quality: season end |
|---|---:|---:|---:|---:|
| 2014–2019 (design, 6,797 and 8,770 games) | 68.5% | 83.6% | 71.7% | 81.5% |
| 2021–2026 through week 12 (6,889 and 9,099 games) | 67.2% | 82.5% | 70.0% | 80.6% |

The official ranking is résumé. Quality picks more next-week winners and has lower season-end agreement, as a strength measure should: résumé rewards what was won, quality how good a team is. Against version 1 on the same games, quality picks 1.2 and 1.0 points more next-week winners (70.4% → 71.7%, 69.0% → 70.0%) with lower log loss, and résumé is unchanged (68.6% → 68.5%, 83.4% → 83.6%; 67.1% → 67.2%, 82.5% → 82.5%). On 2008–2013, never used in design, quality picks 73.5% against version 1's 72.3% (`research/quality.py 2008-2013`).

2021–2026 were looked at during design, so they are a check rather than an untouched holdout.

## Data

All college data comes from one free source: the sportsdataverse `ncaa_mfb_*` releases, a public mirror of stats.ncaa.org published as one parquet file per season (`scripts/ncaa.ts`, `scripts/fetch-ncaa.ts`). From it:

- **teams.csv**: FBS and FCS teams by stats.ncaa.org division. Ids, abbreviations, conferences and colours come from `data/teams-meta.csv`, a fixed crosswalk from stats.ncaa.org team names (ids match ESPN's so logos load); a team missing from it keeps its stats.ncaa.org id. Opponents outside the NCAA get a stable id from their name.
- **games.csv**: every game of those teams from the schedules and linescores. A game's id is its NCAA contest id (unplayed games are numbered 990,000,000 and up in kickoff order). Kickoffs are the stat crew's local clock, read as US Eastern time (noon when missing). A schedule entry written "Opponent @City" is a neutral site. Week 1 runs through Labor Day and each later week Tuesday to Monday; games from the Tuesday after the second Saturday of December are postseason (earlier FCS playoff rounds keep regular-season week labels).
- **plays.csv, players.csv**: from the play-by-play with our expected-points model (below), and defense from the box scores.
- **roster.csv**: position, class, height, weight, hometown, high school.

The mirror runs about two days behind the games.

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

## Expected points

Our own model (`src/engine/ep.ts`, fitted by `npm run fit-ep`, published in `data/models/ep.json`). A state's expected points (EP) are the average points of the next score in the half from the offense's side: a touchdown 7 (with its try), a field goal 3, a safety 2, the opponent's scores negative, 0 if nobody scores again in the half. For each down, EP is a piecewise-linear curve in yards to goal (knots at 1, 5, 10, 20, 35, 50, 65, 80, 90, 99) plus a piecewise-linear adjustment for yards to go (knots at 1, 3, 6, 10, 15, 25, measured against 10 to go); when the line to gain is the goal line, a goal-to-go term replaces the yards-to-go adjustment. The 64 coefficients are least squares over every down-and-distance play of regulation in the mirror's 2014–2025 play-by-play (2020 left out, 2.87 million plays) with a one-play ridge, solved by Cholesky. Fitted first without 2025, the model's predictions on 2025 match the average next score within 0.25 points in every one-point bin (RMSE 5.02 against 5.33 for a constant).

A play's expected points added (EPA) are its points if it scored (from the offense's side), otherwise the EP of the next down-and-distance play in the half (negated if the other team has the ball), or 0 at the end of the half, minus its EP. A kickoff's EPA, from the kicking team's side, is minus the receiving team's EP on its first play, less the average of that value (−0.81). A play is a success with half the yards to go on first down, 70% on second, all of them on third and fourth, or a touchdown. Field goals: the make chance is logistic(3.726 − 0.0762 × distance in yards), fitted on 43,248 kicks.

## Unit ratings

Offense, defense and special teams are explanatory outputs from the mirror's play-by-play and our expected points, leaving the ranking and matchup predictions unchanged. Garbage-time thresholds exclude score gaps above 38 in quarter 2, 28 in quarter 3, and 22 in quarter 4. Opponent/site-adjusted EPA per snap yields offense/defense, weighted by snaps and shrunk toward average; net special-teams EPA yields a separate game-based fit. Mean snaps convert offense/defense to points per game. Missing covered plays produce null unit statistics.

## Player ratings

Players are rated on one scale for FBS and FCS (`src/engine/players.ts`), leaving the ranking unchanged. From every team-game's passing and rushing in `players.csv`, fit per-play EPA ≈ μ + offense[team] − defense[opponent] separately for passes and rushes, weighted by plays, each rating pulled toward 0 with 200 plays of evidence. An average offense expects μ − defense[opponent] per play against that defense.

- **Quarterbacks** (dropbacks and rushes), **running backs** (rushes and targets), **receivers and tight ends** (targets and rushes): EPA over expected is, game by game, his EPA minus his plays × what an average offense gains against that defense for each play type. Garbage time is left out. Rating = EPA over expected ÷ (plays + 100 for quarterbacks, 60 for running backs, 40 for receivers and tight ends).
- **Kickers**: field-goal points over expected (3 × made − 3 × make chance) ÷ (tries + 8).
- **Defenders** (line, linebackers, backs): each game's credits, a sack 1.83, an interception 3.96 and a pass breakup 1.12 expected points (what each saves against an average play of its kind in our model), a solo tackle 0.2 and an assisted tackle 0.1, times 0.5 + the opponent's quality ÷ 100. Rating = adjusted credits ÷ (games + 2).

Points per game = rating × plays ÷ games (the rating itself for defenders). Each position board ranks all rated players by points per game. A player's position group is his roster position, or what he did most when it is missing; offensive linemen, punters and long snappers are not rated. Players are matched to rosters by team and name (suffixes ignored). Boards and team files are computed for the season's latest snapshot and verified byte for byte with the rankings.

## Determinism and changes

Teams and games use numeric ID order for summation. The spring graph, résumé and schedule averages, the matchup model, variances and ranking use fixed loops and Cholesky with only + − × / and √. The quality logistic and probabilities use fixed-arithmetic `expFixed`, avoiding platform-dependent transcendental functions in published bytes. Values round to six decimals. JSON has fixed key order with one team, prediction and spring per line.

Schema 1 includes engine/algorithm versions, spring and prediction settings, hashes, counts, diagnostics, every game's springs and résumé points (`springs`: margin, win and loss), each team's `height` (quality), `strength`, `resume`, `schedule` and their ranks, and matchup predictions. Node verification and browser Recompute call the same `computeSeason` pipeline. There is no runtime randomness or wall-clock input.

Mathematical or setting changes bump `algorithmVersion`; output-byte/schema changes bump `ENGINE_VERSION`. Regenerate every ranking and update this specification together. CI checks type safety, tests, byte reproduction and the production build.
