# Methodology

This document is the full specification of how rankings are produced. If the code and this document ever disagree, that is a bug; please open an issue.

## Goal

Rank every FBS and FCS team from worst to best using game results and raw score margins, with a process anyone can rerun and get the identical answer.

| Requirement | How it is met |
|---|---|
| Deterministic | No randomness anywhere. Fixed input order, fixed arithmetic order, fixed rounding. Same data in, same bytes out. |
| Auditable | Raw game data, code and output are all in this repository. `npm run verify` and the site's **Recompute** button regenerate every published ranking and compare byte for byte. CI runs it on every change. |
| Transparent | One short formula, one config file per season, and a per-team page that lists every game behind a rank. Git history shows when each result arrived or was corrected. |
| Unbiased | No preseason ranking, no human votes, no home field, no conference or brand weight, no recency weighting. Every team starts equal and only game results and raw score margins move it. |

## The graph

- **Nodes:** teams in `teams.csv` whose classification is listed in the season's `config.json` (FBS and FCS).
- **Springs:** each completed game between two nodes is one spring between the two teams. Rematches and postseason games add more springs.
- Games that involve a team outside `teams.csv` (for example Division II), games that are not completed, and games with equal scores are not counted. Each snapshot's manifest records how many rows were dropped for each reason.

## The ranking: raw margin springs

Every game is a spring between the two teams that wants the **winner above the loser by the raw winning score minus the losing score**. A 28-point win targets a 28-point height gap; a 1-point win targets a 1-point gap. There is no fixed rest length, clamping, cap, scaling or home-field adjustment. Each team's height is where all of its springs, and everyone else's, balance out:

```
H(s) = 1/2 * sum_games (s_w - s_l - margin)^2  +  1/2 * alpha * sum_i s_i^2
```

where `w` and `l` are each game's winner and loser and `margin` is the raw score difference. Every game adds one spring, including rematches. Setting the gradient to zero gives one linear system

```
(L + alpha*I) s = winning_margins - losing_margins
```

where `L` is the game-count graph Laplacian: each game adds 1 to both teams' diagonal entries and −1 to both entries connecting them. The right-hand side adds each raw margin to the winner and subtracts it from the loser. For `alpha > 0` the matrix is symmetric positive definite, so there is exactly one solution. It is solved with a dense Cholesky decomposition (`src/engine/linalg.ts`) written with only `+ - * /` and `sqrt`, in a fixed loop order, which are exactly reproducible under IEEE-754. No iteration, no tuning.

This is a least-squares fit of score margins over the game graph. Heights are in score points, centred around zero, and their differences fit the observed game margins.

How it behaves:

- **Who you beat matters.** Beating a team that sits high pulls you higher; losing to a team that sits low drags you down. Strength of schedule comes from the graph, not a separate formula.
- **Margins set each game's target gap.** A larger win asks for more separation between the teams. Every point of margin counts, including large blowouts.
- **Head-to-head counts but is not absolute.** A win over a team is one spring. If both teams' other results point the other way, the springs can still settle the loser above the winner; the site marks those games as upsets.

`alpha = 0.01` is a tiny equal pull toward zero. It exists so the system always has a unique solution, including early in the season when the graph is not yet connected.

### Configuration

`data/seasons/<year>/config.json`:

```json
{
  "label": "2026 season",
  "demo": false,
  "algorithmVersion": "margin-springs-1",
  "alpha": 0.01,
  "classifications": ["fbs", "fcs"]
}
```

Every ranking file's manifest records the engine version, `algorithmVersion` and `alpha` it was computed with.

### Rank, ties and unplayed teams

- **Rank is the team's height**, highest first. The y-axis of the graph view is that same height.
- Heights are rounded to 6 decimals. Teams with the same rounded height share a rank (shown `T-n`); the next rank skips accordingly. Ties are never broken by name or reputation.
- A team with no counted games has no information, so it is **unranked** rather than assigned a guess.

### Snapshots

`week-NN` uses all regular-season games with `week <= NN`. `postseason` uses every game. A snapshot never looks at later games, and each one is recomputed from scratch from the current CSVs, so any historical ranking can be reproduced.

## How it performs

`npm run backtest -- --history 2015-2025` runs this exact model on ten past seasons (2020 skipped), using public season-complete schedules from the [sportsdataverse cfbfastR-data](https://github.com/sportsdataverse/cfbfastR-data) project (downloaded to a temp folder, never committed). It reports how often the final ranking puts the winner above the loser and how often rankings using only earlier games pick the next week's winner. `npm run backtest` uses the seasons currently in this repository.

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
- **Spring** = winner height − loser height − (winning score − losing score). Zero means that spring is at rest; negative means it is stretched and pulling the winner up and the loser down; positive means the height gap exceeds the raw score margin and it pulls them back together.
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

- **Running up the score matters.** A 50-point win targets a 50-point height gap, while a 1-point win targets a 1-point gap. Raw margins are deliberately uncapped.
- **Beating a much weaker team can lower you.** If the winner's height gap already exceeds the winning score margin, that game's spring pulls it back down a little. A bye adds no spring, so it is neutral, but a team can still move during a bye as its past opponents' results change.
- **Cycles.** When A beat B, B beat C and C beat A, no order can respect every result; the springs find the order that strains them least.
- **Early season.** With one or two games per team, many teams are nearly tied, and undefeated teams with weak schedules can sit low until they play someone. Groups of teams not yet linked by a chain of games are not comparable.
- **Schedule size.** With about 12 games per team, ranks a few places apart are not meaningfully different. The height column shows how close teams are.
- **Source data.** Scores come from the CollegeFootballData API; an error there is an error here until it is corrected upstream and the next update runs.
- **Out-of-division games.** Games against teams outside FBS/FCS are not counted at all.

## Changing the method

Any change to the algorithm, parameters or output format must bump `algorithmVersion` (math/config) or `ENGINE_VERSION` (bytes), regenerate the published rankings in the same pull request, and update this document. CI fails if committed rankings do not match a fresh computation.
