# Methodology

This document is the full specification of how rankings are produced. If the code and this document ever disagree, that is a bug; please open an issue.

## Goal

Rank every FBS and FCS team from worst to best, using only final scores, as accurately as possible, with a process anyone can rerun and get the identical answer.

| Requirement | How it is met |
|---|---|
| Deterministic | No randomness anywhere. Fixed input order, fixed arithmetic order, fixed rounding. Same data in, same bytes out. |
| Auditable | Raw game data, code and output are all in this repository. `npm run verify` and the site's **Recompute** button regenerate every published ranking and compare byte for byte. CI runs it on every change. |
| Transparent | One formula, one config file per season, and a team page that rebuilds each rating game by game. Git history shows when each result arrived or was corrected. |
| Unbiased | No votes, no polls, no preseason, no brand or conference weight. Every team starts the season level, and every input is a final score from this season, the two teams and whether the game was at a neutral site. |

## The rating

### What each game says

For a game, the home team's **result** is its margin plus the win bonus:

```
result = (home points − away points) + winBonus × sign(home points − away points)
```

with `winBonus = 3`. A rating `r` is in points, and the model expects a game's result to be

```
r[home] − r[away] + H × home
```

where `H` is the home-field edge in points and `home` is 1 for a true home game and 0 at a neutral site.

### The fit

Ratings `r` and the home-field edge `H` minimise

```
sum_games (result − (r[home] − r[away] + H × home))²
  + shrink × sum_teams r[i]²
  + 0.0001 × H²
```

with `shrink = 0.05`: a small pull of every rating toward 0 (an average team), the same for every team, as if each team had also played 0.05 of a game against an average opponent. It keeps a team with one game from being rated on that game alone and makes the answer unique; it was chosen on 2014–2019 (research folder). The last term only keeps `H` defined before any home game has been played. Setting the gradient to zero gives one symmetric positive-definite linear system with one unknown per team plus `H`. It is solved with a dense Cholesky decomposition (`src/engine/linalg.ts`) written with only `+ − × /` and `sqrt`, in a fixed loop order, which are exactly reproducible under IEEE-754. No iteration, no tuning at run time. See `fitRatings` in `src/engine/rating.ts`.

### Why a team is where it is

At the solution, every team's rating is exactly

```
r[i] = (sum over its games of game value) / (games played + shrink)
```

where a game's **value** is what that game alone says the team is worth:

```
value = opponent's rating + this team's result − H (at home) / + H (away) / ± 0 (neutral)
```

A team's rating is the average of what its games say (divided by games + 0.05 rather than games). The team page draws exactly this: one row per game at its value, and the rating as their average.

### Every loss costs something

The published rating is the rating from games plus a **record bonus**:

```
rating[i] = r[i] + recordWeight × (wins[i] − losses[i]) / games[i]
```

with `recordWeight = 6`: +6 for an unbeaten team, 0 at .500, −6 winless. A loss always costs points, even a close loss to a good team, and costs more early in the season when each game is a bigger share of the record. Head-to-head (below) compares these combined ratings. On the held-out seasons the bonus cost under a tenth of a point of next-week picks (weights from 4 to 10 were all within noise); 6 was chosen so records matter visibly. Each team's bonus is published as `recordBonus`, and the team page shows the rating from games and the bonus separately.

### Head-to-head breaks close calls

If two teams are rated within `headToHeadWindow` points (3, a field goal; record bonus included) and the lower one beat the higher one, head-to-head decides (`closeHeadToHead` in `src/engine/headtohead.ts`):

1. From the fit above, every game whose winner is rated below its loser by less than 3 points (or above it by less than ½ point) gets a **hold**. Candidates are taken closest first, then by game order; a hold is skipped if the loser is already required, directly or through other holds, to stay above the winner, so cycles of close results never fight.
2. The whole ladder is fitted again with those holds. Each adds a very stiff spring that engages only if its winner is less than ½ point above its loser:

```
  + 1000 × sum_held max(0, ½ − (r[winner] − r[loser]))²
```

   solved by Newton steps on the set of engaged holds, each an exact Cholesky solve, until that set repeats.
3. The refit can bring new close pairs into the window, so steps 1–2 repeat until no hold is added. Holds are only ever added, so this stops.

Teams further apart than 3 points keep their places: one upset doesn't outweigh a season of results. Held games are published in each ranking file's `held` array, and every held winner is rated above its loser (a test checks every published file). With holds, the team-page identity becomes `r[i] = (sum of game values + sum of hold pushes) / (games + shrink)`, where an engaged hold pushes 1000 × (½ − gap) up on its winner and down on its loser.

The window was chosen on 2014–2019: 3 points cost 0.4 points of prediction there and raised season-end agreement with results from 81.3% to 86.9%; windows of 7 points or more made both worse.

### Every team starts level

There is no preseason ranking, no carry-over from last season, and no recruiting, reputation or conference input. In week 1 every team is equal (rating 0); only this season's games move anyone. A rating of 0 is the average of all FBS and FCS teams in scope.

This costs some early-season accuracy, deliberately. In the held-out test, starting each team from 90% of last season's rating picked 71.9% of next-week winners; this model picks 70.5%. Early rankings are also more volatile: until teams have played a few connected games, one blowout can move a team a long way.

### Configuration

`data/seasons/<year>/config.json`:

```json
{
  "label": "2026 season",
  "demo": false,
  "algorithmVersion": "margin-4",
  "classifications": ["fbs", "fcs"],
  "winBonus": 3,
  "shrink": 0.05,
  "headToHeadWindow": 3,
  "recordWeight": 6
}
```

Every ranking file's manifest records the engine version, `algorithmVersion`, `winBonus`, `shrink`, `headToHeadWindow`, `recordWeight`, the fitted home-field edge, and the SHA-256 of the season's CSVs.

### Rank, ties and unplayed teams

- **Rank is the rating**, highest first. The y-axis of the graph view is that same rating.
- Ratings are rounded to 6 decimals. Teams with the same rounded rating share a rank (shown `T-n`); the next rank skips accordingly. Ties are never broken by name or reputation.
- A team with no counted games yet is **unranked** rather than guessed.

### Snapshots

`week-NN` uses all regular-season games with `week <= NN`. `postseason` uses every game. A snapshot never looks at later games, and each one is recomputed from scratch from the current CSVs, so any historical ranking can be reproduced.

## Offense, defense and special teams

Separate unit ratings come from play-by-play. They describe *how* a team plays; they do not change the overall rank (see below for why).

**Source.** `npm run fetch-plays -- <year>` downloads the public cfbfastR play-by-play release from the [sportsdataverse](https://github.com/sportsdataverse/sportsdataverse-data) project (CFBD-derived; covers games with at least one FBS team, and most FCS games from 2022). Each play carries an expected-points-added (EPA) value from cfbfastR's open-source expected-points model. The script condenses it to `data/seasons/<year>/plays.csv`, one row per team per game:

| column | meaning |
|---|---|
| `snaps` | the team's scrimmage plays (rushes and passes by the offense) outside garbage time |
| `epa` | expected points added on those snaps |
| `success` | how many of them were successful |
| `special_epa` | net EPA on kickoffs, punts and field goals and their returns, from this team's side (the two teams' values sum to zero) |

Garbage time is a score gap above 38 points in the 2nd quarter, 28 in the 3rd or 22 in the 4th. Plays are summed in game and play-id order.

**The fit** (`fitUnits` in `src/engine/units.ts`). For each team-game row, with site x = +1 at home, −1 away, 0 neutral:

```
epa / snaps ≈ mu + O[team] − D[opponent] + h × x          (weighted by snaps)
special_epa ≈ S[team] − S[opponent]                       (one row per game)
```

Every team starts level: each unit is pulled toward average (0) with `shrink` games' worth of evidence (0.05 games, or 0.05 × the average snaps per game for offense and defense). Both systems are solved exactly by Cholesky. Ratings are published in points per game better than average: offense = O × snaps per game, defense = D × snaps per game, special teams = S. Teams with no play-by-play this season (mostly FCS teams that have only played FCS opponents) have no unit ratings.

**Why play-by-play does not drive the overall rank.** It was tested on 2015–2019 (research folder): the unit ratings on their own (68.6% of next-week winners), blends of them with the score rating (72.3–72.7%), and expected points, turnover-free expected points or success rate mixed into each game's result (72.3–73.0%) all did no better than final scores alone (73.1%). Per game, the expected-points margin and the final margin correlate at 0.93, so final scores already carry most of what the plays say about who will win.

## How it was chosen, and how accurate it is

The model came out of a walk-forward benchmark in [`research/`](../research/): every week, each method ranks teams using only the games played before that week and predicts that week's games, with the higher-ranked team picked to win. All settings (win bonus, carryover, prior weight) were chosen on 2014–2019, then frozen and tested once on 2021–2025 plus 2026 through week 6, which played no part in the design (6,287 games from week 4 on).

| Method (held-out seasons) | Next-week winners | Winner above loser at season end |
|---|---|---|
| **This rating** | **70.3%** | **86.5%** |
| Same rating without record bonus or tiebreaker | 70.5% | 80.9% |
| Massey (least squares on margin) with home field | 70.2% | 80.4% |
| Elo carried over from last season | 69.7% | 80.3% |
| Massey | 69.7% | 80.2% |
| LRMC | 69.5% | 80.7% |
| Elo (in season) | 68.5% | 81.8% |
| Keener | 68.2% | 77.5% |
| Pythagorean | 68.2% | 76.2% |
| Bradley–Terry | 67.3% | 83.2% |
| Colley | 67.0% | 82.5% |
| Win percentage | 66.2% | 78.9% |
| PageRank | 64.3% | 78.2% |

Without the tiebreaker the rating (this season's games only) is level with the best known predictor, Massey with home field (+0.3 points, 95% interval −0.1 to +0.7), and ahead of plain Massey, LRMC, Elo and even Elo carried over from last season. The record bonus and tiebreaker give up a fifth of a point of that (70.3%) and lifts season-end agreement with results to 86.5%, above every other method. Starting each team from 90% of last season's rating would add about 1.4 points of prediction; it was removed so the ranking judges this season only. A stronger head-to-head step (holding every winner above the team it beat, except the fewest upsets cycles force) reached 90.3% agreement but cut picks to 69.6% and let one result move teams a long way; it was removed in favour of the 3-point tiebreaker. Ideas that did not help on 2014–2019 and were dropped: treating blowout margins as censored, robust losses, recency weighting, conference layers and play-by-play (see below). Systems that use recruiting, returning players or betting markets (SP+, FPI, Sagarin, Vegas) were not tested.

`npm run backtest -- --history 2021-2025` runs the published pipeline itself (`computeSeason`) on those seasons, from public sportsdataverse schedules, and reports 70.3% of next-week winners and 86.3% agreement with results.

## Determinism rules

1. Teams are ordered by numeric id; games by numeric game id. This fixes the matrix and its summation order, so row order in the CSVs is irrelevant (there is a test for that).
2. The fit is a few linear solves using only `+ − × /` and `sqrt`, which IEEE-754 defines exactly, in a fixed loop order.
3. Ratings are rounded to 1e-6 before they are ranked or written.
4. JSON is written with a fixed key order and layout (`formatRanking` in `src/engine/season.ts`).
5. Each ranking file embeds the SHA-256 of the exact CSV bytes it was computed from (teams, games and plays), the settings and the engine version.

## Graph layout

Only the **vertical** position is meaningful: it is the team's rating. Horizontal position is cosmetic and is computed by the website (`web/layout.ts`), not stored in the ranking files: one lane per conference, lanes ordered by the conference's mean rating, with teams nudged sideways only where their logos would overlap.

Edges are not stored in the ranking files either. The site rebuilds them from `games.csv` with the same `buildEdges` function the pipeline uses.

## Per-game quantities on a team page

- **Offense, defense, special teams**: the unit ratings above, with each team's rank among teams that have play-by-play.
- **Opp. rating**: the opponent's rating.
- **Game says**: the game's value (above): the opponent's rating plus this team's result, adjusted for home field.
- **Pull**: game value − this team's rating. Positive games pull the rating up, negative games pull it down; together they balance at (almost exactly) zero.
- **Upset**: the winner is rated below the loser (its teams were more than 3 points apart, so head-to-head did not decide it).
- **H2H**: head-to-head broke a close call in this game; the winner is held at least ½ point above the loser.

## Data pipeline

```
CollegeFootballData API --fetch--> data/seasons/<year>/{teams,games}.csv
                                         |
public play-by-play --fetch-plays--> data/seasons/<year>/plays.csv
                                         |
                    compute (src/engine, deterministic)
                                         v
                           data/rankings/<year>/<snapshot>.json  +  data/index.json
```

The API is only a source of raw scores and team ids. `npm run fetch` normalises it to CSV sorted by id and the result is committed, so the git diff of each weekly update shows exactly which games were added or corrected.

## Known limitations (stated openly)

- **Early season.** With every team starting level, the first weeks rest on very few games: a single blowout can move a team a long way, and comparisons between conferences rest on a handful of non-conference games until conference play links everyone.
- **Margins count in full.** Running up the score raises a rating; a 50-point win says more than a 1-point win. Capping or censoring margins was tested and made predictions worse.
- **Ratings predict; they don't reward.** The goal is to rank teams by how good they are, which is not the same as a résumé. A team can be rated above a team that beat it when the rest of their results point that way; the site marks those games as upsets.
- **Schedule size.** With about 12 games per team, ranks a few places apart are not meaningfully different. The rating shows how close teams are.
- **Source data.** Scores come from the CollegeFootballData API; an error there is an error here until it is corrected upstream and the next update runs.
- **Out-of-division games.** Games against teams outside FBS/FCS are not counted at all.

## Changing the method

Any change to the algorithm, its settings or the output format must bump `algorithmVersion` (math or settings) or `ENGINE_VERSION` (bytes), regenerate the published rankings in the same pull request, and update this document. CI fails if committed rankings do not match a fresh computation.
