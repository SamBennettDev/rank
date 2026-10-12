# Methodology

This document is the full specification of how rankings are produced. If the code and this document ever disagree, that is a bug; please open an issue.

## Goal

Rank every FBS and FCS team from worst to best, using only final scores, as accurately as possible, with a process anyone can rerun and get the identical answer.

| Requirement | How it is met |
|---|---|
| Deterministic | No randomness anywhere. Fixed input order, fixed arithmetic order, fixed rounding. Same data in, same bytes out. |
| Auditable | Raw game data, code and output are all in this repository. `npm run verify` and the site's **Recompute** button regenerate every published ranking and compare byte for byte. CI runs it on every change. |
| Transparent | One formula, one config file per season, and a team page that rebuilds each rating game by game. Git history shows when each result arrived or was corrected. |
| Unbiased | No votes, no polls, no brand or conference weight. Every input is a final score, the two teams and whether the game was at a neutral site. Last season enters only as a starting point that this season's games outweigh. |

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
  + priorWeight × sum_teams (r[i] − start[i])²
  + 0.0001 × H²
```

with `priorWeight = 2`. The last term only keeps `H` defined before any home game has been played. Setting the gradient to zero gives one symmetric positive-definite linear system with one unknown per team plus `H`. It is solved with a dense Cholesky decomposition (`src/engine/linalg.ts`) written with only `+ − × /` and `sqrt`, in a fixed loop order, which are exactly reproducible under IEEE-754. No iteration, no tuning at run time. See `fitRatings` in `src/engine/rating.ts`.

### Why a team is where it is

At the solution, every team's rating is exactly

```
r[i] = (sum over its games of game value + priorWeight × start[i]) / (games played + priorWeight)
```

where a game's **value** is what that game alone says the team is worth:

```
value = opponent's rating + this team's result − H (at home) / + H (away) / ± 0 (neutral)
```

A team's rating is the average of what its games say, with its starting point counted as two games. The team page draws exactly this: one row per game at its value, the starting point, and the rating as their average.

### The starting point

```
start[i] = carryover × (team i's final rating last season)
```

with `carryover = 0.9`. Last season's final ratings come from the same fit run on all of last season's games (regular season and postseason), with no starting point: every team is pulled toward 0 with weight 0.01, only so the answer is unique. They are centred so the average FBS team is 0. A team that is not in last season's data starts at the average starting point of its classification (FBS or FCS) this season. Without last season's data, every team starts at 0.

The starting point counts as two games. It dominates in the first weeks, and a team's own games outweigh it several times over by midseason. It uses only last season's scores: no polls, recruiting rankings or opinions.

### Configuration

`data/seasons/<year>/config.json`:

```json
{
  "label": "2026 season",
  "demo": false,
  "algorithmVersion": "margin-prior-1",
  "classifications": ["fbs", "fcs"],
  "winBonus": 3,
  "carryover": 0.9,
  "priorWeight": 2
}
```

A season with `"publish": false` is kept only as the next season's starting point and gets no published rankings. Every ranking file's manifest records the engine version, `algorithmVersion`, `winBonus`, `carryover`, `priorWeight`, the fitted home-field edge, and the SHA-256 of this season's and last season's CSVs. Each team's starting point is published next to its rating.

### Rank, ties and unplayed teams

- **Rank is the rating**, highest first. The y-axis of the graph view is that same rating.
- Ratings are rounded to 6 decimals. Teams with the same rounded rating share a rank (shown `T-n`); the next rank skips accordingly. Ties are never broken by name or reputation.
- A team with no counted games yet is **unranked**, rather than placed by its starting point alone.

### Snapshots

`week-NN` uses all regular-season games with `week <= NN`. `postseason` uses every game. A snapshot never looks at later games, and each one is recomputed from scratch from the current CSVs, so any historical ranking can be reproduced.

## How it was chosen, and how accurate it is

The model came out of a walk-forward benchmark in [`research/`](../research/): every week, each method ranks teams using only the games played before that week and predicts that week's games, with the higher-ranked team picked to win. All settings (win bonus, carryover, prior weight) were chosen on 2014–2019, then frozen and tested once on 2021–2025 plus 2026 through week 6, which played no part in the design (6,287 games from week 4 on).

| Method (held-out seasons) | Next-week winners |
|---|---|
| **This rating** | **71.9%** |
| Massey (least squares on margin) with home field | 70.2% |
| Elo carried over from last season | 69.7% |
| Massey | 69.7% |
| LRMC | 69.5% |
| Elo (in season) | 68.5% |
| Keener | 68.2% |
| Pythagorean | 68.2% |
| Bradley–Terry | 67.3% |
| Colley | 67.0% |
| Win percentage | 66.2% |
| PageRank | 64.3% |

It beat the best known method in all six held-out seasons, by 1.6 points overall (95% bootstrap interval +0.9 to +2.4, McNemar p < 0.0001). On FBS-vs-FBS games it beats CollegeFootballData's own pregame Elo by 0.7 points (69.9% vs 69.2%). Ideas that did not help on 2014–2019 and were dropped: treating blowout margins as censored, robust losses, recency weighting, conference layers, and two-season or conference-anchored starting points. Systems that use recruiting, returning players, play-by-play or betting markets (SP+, FPI, Sagarin, Vegas) were not tested.

`npm run backtest -- --history 2021-2025` runs the published pipeline itself (`computeSeason`) on those seasons, from public sportsdataverse schedules, and reports 72.0% of next-week winners. Every team starting at 0 instead scores 70.0%.

## Determinism rules

1. Teams are ordered by numeric id; games by numeric game id. This fixes the matrix and its summation order, so row order in the CSVs is irrelevant (there is a test for that).
2. The fit is one linear solve using only `+ − × /` and `sqrt`, which IEEE-754 defines exactly, in a fixed loop order.
3. Ratings and starting points are rounded to 1e-6 before they are ranked or written.
4. JSON is written with a fixed key order and layout (`formatRanking` in `src/engine/season.ts`).
5. Each ranking file embeds the SHA-256 of the exact CSV bytes it was computed from (this season's and last season's), the settings and the engine version.

## Graph layout

Only the **vertical** position is meaningful: it is the team's rating. Horizontal position is cosmetic and is computed by the website (`web/layout.ts`), not stored in the ranking files: one lane per conference, lanes ordered by the conference's mean rating, with teams nudged sideways only where their logos would overlap.

Edges are not stored in the ranking files either. The site rebuilds them from `games.csv` with the same `buildEdges` function the pipeline uses.

## Per-game quantities on a team page

- **Opp. rating**: the opponent's rating.
- **Game says**: the game's value (above): the opponent's rating plus this team's result, adjusted for home field.
- **Pull**: game value − this team's rating. Positive games pull the rating up, negative games pull it down; together with the starting point (counted twice) they balance at zero.
- **Upset**: the winner is rated below the loser.

## Data pipeline

```
CollegeFootballData API --fetch--> data/seasons/<year>/{teams,games}.csv
                                         |
                    compute (src/engine, deterministic; also reads <year − 1>)
                                         v
                           data/rankings/<year>/<snapshot>.json  +  data/index.json
```

The API is only a source of raw scores and team ids. `npm run fetch` normalises it to CSV sorted by id and the result is committed, so the git diff of each weekly update shows exactly which games were added or corrected. `data/seasons/2025` was built from the public sportsdataverse schedule files (CFBD-derived, same ids and scores) because no API key was available when it was added; `npm run fetch -- 2025` refreshes it from the API.

## Known limitations (stated openly)

- **Teams don't all start equal.** The starting point gives last season's good teams a head start in September. It fades quickly but it is there, and a team that changed a lot over the off-season is misjudged early.
- **Margins count in full.** Running up the score raises a rating; a 50-point win says more than a 1-point win. Capping or censoring margins was tested and made predictions worse.
- **Ratings predict; they don't reward.** The goal is to rank teams by how good they are, which is not the same as a résumé. A team can be rated above a team that beat it when the rest of their results point that way; the site marks those games as upsets.
- **Early season.** Before conferences play each other, comparisons between conferences rest on a few non-conference games and the starting points.
- **Schedule size.** With about 12 games per team, ranks a few places apart are not meaningfully different. The rating shows how close teams are.
- **Source data.** Scores come from the CollegeFootballData API; an error there is an error here until it is corrected upstream and the next update runs.
- **Out-of-division games.** Games against teams outside FBS/FCS are not counted at all.

## Changing the method

Any change to the algorithm, its settings or the output format must bump `algorithmVersion` (math or settings) or `ENGINE_VERSION` (bytes), regenerate the published rankings in the same pull request, and update this document. CI fails if committed rankings do not match a fresh computation.
