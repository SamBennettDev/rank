# Methodology

This document is the full specification of how rankings are produced. If the code and this document ever disagree, that is a bug; please open an issue.

## Goal

Rank every FBS and FCS team from worst to best using only who beat whom, with a process anyone can rerun and get the identical answer.

| Requirement | How it is met |
|---|---|
| Deterministic | No randomness anywhere. Fixed input order, fixed arithmetic order, fixed rounding. Same data in, same bytes out. |
| Auditable | Raw game data, code and output are all in this repository. `npm run verify` and the site's **Recompute** button regenerate every published ranking and compare byte for byte. CI runs it on every change. |
| Transparent | One short formula, one config file per season, and a per-team page that lists every game behind a rank. Git history shows when each result arrived or was corrected. |
| Unbiased | No preseason ranking, no human votes, no margins, no home field, no conference or brand weight, no recency weighting. Every team starts equal and only wins and losses move it. |

## The graph

- **Nodes:** teams in `teams.csv` whose classification is listed in the season's `config.json` (FBS and FCS).
- **Springs:** each completed game between two nodes is one spring between the two teams. Rematches and postseason games add more springs.
- Games that involve a team outside `teams.csv` (for example Division II), games that are not completed, and games with equal scores are not counted. Each snapshot's manifest records how many rows were dropped for each reason.

## The ranking: equal win springs

Every game is a spring between the two teams that wants the **winner exactly 7 points above the loser**. Every spring pulls with the same strength: the score, the margin and where the game was played don't matter. Each team's height is where all of its springs, and everyone else's, balance out:

```
H(s) = 1/2 * sum_ij A_ij (s_i - s_j - 7)^2  +  1/2 * alpha * sum_i s_i^2
```

where `A_ij` is the number of times team *i* beat team *j*. Setting the gradient to zero gives one linear system

```
(D_out + D_in - (A + A^T) + alpha*I) s = 7 * (d_out - d_in)
```

where `d_out` is each team's wins and `d_in` its losses. For `alpha > 0` the matrix is symmetric positive definite, so there is exactly one solution. It is solved with a dense Cholesky decomposition (`src/engine/linalg.ts`) written with only `+ - * /` and `sqrt`, in a fixed loop order, which are exactly reproducible under IEEE-754. No iteration, no tuning.

This is SpringRank (De Bacco, Larremore & Moore, *A physical model for efficient ranking in networks*, Science Advances, 2018) with a rest length of 7 instead of 1. The 7 is a display unit: it multiplies every height by 7 and never changes the order. Heights are ranking points, not game points.

How it behaves:

- **Who you beat matters.** Beating a team that sits high pulls you higher; losing to a team that sits low drags you down. Strength of schedule comes from the graph, not a separate formula.
- **Every spring pulls equally.** Each game is one equal vote for "the winner belongs above the loser". Running up the score does nothing.
- **Head-to-head counts but is not absolute.** A win over a team is one spring. If both teams' other results point the other way, the springs can still settle the loser above the winner; the site marks those games as upsets.

`alpha = 0.01` is a tiny equal pull toward zero. It exists so the system always has a unique solution, including early in the season when the graph is not yet connected.

### Configuration

`data/seasons/<year>/config.json`:

```json
{
  "label": "2026 season",
  "demo": false,
  "algorithmVersion": "win-springs-1",
  "alpha": 0.01,
  "restLength": 7,
  "classifications": ["fbs", "fcs"]
}
```

Every ranking file's manifest records the engine version, `algorithmVersion`, `alpha` and `restLength` it was computed with.

### Rank, ties and unplayed teams

- **Rank is the team's height**, highest first. The y-axis of the graph view is that same height.
- Heights are rounded to 6 decimals. Teams with the same rounded height share a rank (shown `T-n`); the next rank skips accordingly. Ties are never broken by name or reputation.
- A team with no counted games has no information, so it is **unranked** rather than assigned a guess.

### Snapshots

`week-NN` uses all regular-season games with `week <= NN`. `postseason` uses every game. A snapshot never looks at later games, and each one is recomputed from scratch from the current CSVs, so any historical ranking can be reproduced.

## How it performs

`npm run backtest -- --history 2015-2025` runs this exact model on ten past seasons (2020 skipped), using public season-complete schedules from the [sportsdataverse cfbfastR-data](https://github.com/sportsdataverse/cfbfastR-data) project (downloaded to a temp folder, never committed):

| Measure | Result |
|---|---|
| Final ranking agrees with results (winner ranked above loser) | **83.6%** of 15,054 games |
| Picks next week's winner (ranking only earlier games that season) | 67.6% of 11,593 games |

During development, margin-based alternatives were tested with the same protocol (margin as spring strength, least squares on margin plus home field, a football-specific margin model). They picked next week's winners more often (up to about 72%) but agreed with results less (80–82%). Equal win springs agreed with the most results, which is what a ranking replacing a poll should do first.

## Determinism rules

1. Teams are ordered by numeric id; games by numeric game id. This fixes the matrix and its summation order, so row order in the CSVs is irrelevant (there is a test for that).
2. Heights are rounded to 1e-6 before they are ranked or written.
3. JSON is written with a fixed key order and layout (`formatRanking` in `src/engine/season.ts`).
4. Each ranking file embeds the SHA-256 of the exact `teams.csv` and `games.csv` bytes it was computed from, the model settings and the engine version.

## Graph layout

Only the **vertical** position is meaningful: it is the team's height. Horizontal position is cosmetic and is computed by the website (`web/layout.ts`), not stored in the ranking files: one lane per conference, lanes ordered by the conference's mean height, with teams nudged sideways only where their logos would overlap.

Edges are not stored in the ranking files either. The site rebuilds them from `games.csv` with the same `buildEdges` function the pipeline uses.

## Per-game quantities on a team page

- **Gap** = this team's height − the opponent's height.
- **Spring** = winner height − loser height − 7. Zero means that spring is at rest; negative means it is stretched and pulling the winner up and the loser down; positive means the winner sits more than 7 above and it pulls them back together.
- **Upset** = the winner finished below the loser.

## Data pipeline

```
CollegeFootballData API --fetch--> data/seasons/<year>/{teams,games}.csv
                                         |
                           compute (src/engine, deterministic)
                                         v
                           data/rankings/<year>/<snapshot>.json  +  data/index.json
```

The API is only a source of raw scores and team ids. `npm run fetch` normalises it to CSV sorted by id and the result is committed, so the git diff of each weekly update shows exactly which games were added or corrected. Anyone who distrusts the source can check the CSV against any other record of the scores; nothing downstream depends on trust.

## Known limitations (stated openly)

- **Margins are ignored on purpose.** A 1-point win and a 50-point win count the same. That makes the ranking impossible to game by running up the score, but it predicts future games less well than margin-based ratings.
- **Beating a much weaker team can lower you.** Each spring wants the winner exactly 7 above the loser; if the winner already sits far higher, that spring pulls it back down a little. A bye adds no spring, so it is neutral, but a team can still move during a bye as its past opponents' results change.
- **Cycles.** When A beat B, B beat C and C beat A, no order can respect every result; the springs find the order that strains them least.
- **Early season.** With one or two games per team, many teams are nearly tied, and undefeated teams with weak schedules can sit low until they play someone. Groups of teams not yet linked by a chain of games are not comparable.
- **Schedule size.** With about 12 games per team, ranks a few places apart are not meaningfully different. The height column shows how close teams are.
- **Source data.** Scores come from the CollegeFootballData API; an error there is an error here until it is corrected upstream and the next update runs.
- **Out-of-division games.** Games against teams outside FBS/FCS are not counted at all.

## Changing the method

Any change to the algorithm, parameters or output format must bump `algorithmVersion` (math/config) or `ENGINE_VERSION` (bytes), regenerate the published rankings in the same pull request, and update this document. CI fails if committed rankings do not match a fresh computation.
