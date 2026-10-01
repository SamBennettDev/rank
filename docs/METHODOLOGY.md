# Methodology

This document is the full specification of how rankings are produced. If the code and this document ever disagree, that is a bug; please open an issue.

## Goal

Rank every FBS and FCS team from worst to best using only game results (who won, and by how much), with a process anyone can rerun and get the identical answer.

| Requirement | How it is met |
|---|---|
| Deterministic | No randomness anywhere. Fixed input order, fixed arithmetic order, fixed rounding. Same data in, same bytes out. |
| Auditable | Raw game data, code and output are all in this repository. `npm run verify` and the site's **Recompute** button regenerate every published ranking and compare byte for byte. CI runs it on every change. |
| Transparent | One short method, one config file per season, and a per-team page that lists every game behind a rank. Git history shows when each result arrived or was corrected. |
| Unbiased | No preseason ranking, no human votes, no home field, no conference or brand weight. Every team starts equal and only results move it. |

## The graph

- **Nodes:** teams in `teams.csv` whose classification is listed in the season's `config.json` (FBS and FCS by default).
- **Edges:** each completed game between two nodes is one edge from the loser to the winner. Rematches and postseason games add additional edges.
- Games that involve a team outside `teams.csv` (for example Division II), games that are not completed, and games with equal scores are not counted. Each snapshot's manifest records how many rows were dropped for each reason.

## The ranking: SpringRank

Heights are computed with SpringRank (De Bacco, Larremore & Moore, *A physical model for efficient ranking in networks*, Science Advances, 2018).

Treat each game as a spring that wants the winner exactly 1 unit above the loser. Team heights `s` minimise the total spring energy

```
H(s) = 1/2 * sum_ij A_ij (s_i - s_j - 1)^2  +  1/2 * alpha * sum_i s_i^2
```

where `A_ij` is the total **spring strength** of team *i*'s wins over team *j*. Setting the gradient to zero gives a linear system

```
(D_out + D_in - (A + A^T) + alpha*I) s = d_out - d_in
```

where `d_out` is the total strength of each team's wins and `d_in` of its losses. For `alpha > 0` the matrix is symmetric positive definite, so there is exactly one solution. It is solved with a dense Cholesky decomposition (`src/engine/linalg.ts`) written with only `+ - * /` and `sqrt`, in a fixed loop order, which are exactly reproducible under IEEE-754.

### Spring strength: point differential

Each game's spring strength (its stiffness) is set by `edgeWeight` in the season's `config.json`:

| `edgeWeight` | Strength of one game | Used by |
|---|---|---|
| `"margin"` | winner's points − loser's points | 2026 onward (`algorithmVersion: springrank-margin-1`) |
| `"win"` | 1 | default when the field is absent (`springrank-1`) |

Strength changes **how hard** a game pulls, never **how far**: every spring still wants the winner exactly 1 unit above the loser. So a single game always puts its winner about 1 unit above its loser, but when results conflict (A beat B, B beat C, C beat A) the springs from bigger margins win the tug-of-war. Margins are used raw, with no cap, so the formula has no extra tunable constant.

`alpha` is a tiny shrinkage (default `0.01`, in `config.json`). It exists so the system always has a unique solution, including early in the season when the graph is not yet connected, and it is applied identically to every team.

### Rank, ties and unplayed teams

- **Rank is the team's height**, highest first. The y-axis of the graph view is that same height.
- Heights are rounded to 6 decimals. Teams with the same rounded height share a rank (shown `T-n`); the next rank skips accordingly. Ties are never broken by name or reputation.
- A team with no counted games has no information, so it is **unranked** rather than assigned a guess.

### Snapshots

`week-NN` uses all regular-season games with `week <= NN`. `postseason` uses every game. A snapshot never looks at later games, and each one is recomputed from scratch from the current CSVs, so any historical ranking can be reproduced.

## Determinism rules

1. Teams are ordered by numeric id; games by numeric game id. This fixes the matrix and its summation order, so row order in the CSVs is irrelevant (there is a test for that).
2. Heights are rounded to 1e-6 before they are ranked or written.
3. JSON is written with a fixed key order and layout (`formatRanking` in `src/engine/season.ts`).
4. Each ranking file embeds the SHA-256 of the exact `teams.csv` and `games.csv` bytes it was computed from, the config and the engine version. If the data changes, the hashes change.

## Graph layout

Only the **vertical** position is meaningful: it is the team's height. Horizontal position is cosmetic and is computed by the website (`web/layout.ts`), not stored in the ranking files: one lane per conference, lanes ordered by the conference's mean height, with teams nudged sideways only where their logos would overlap.

Edges are not stored in the ranking files either. The site rebuilds them from `games.csv` with the same `buildEdges` function the pipeline uses.

## Per-game quantities on a team page

- **Line thickness** in the springs diagram and graph = spring strength (point differential).

- **Gap** = winner height − loser height.
- **Tension** = gap − 1. Zero means the result is fully explained by the final heights.
- **Upset** = negative gap: the winner ended up below the loser.

## Data pipeline

```
CollegeFootballData API --fetch--> data/seasons/<year>/{teams,games}.csv
                                         |
                           compute (src/engine, deterministic)
                                         v
                           data/rankings/<year>/<snapshot>.json  +  data/index.json
```

The API is only a source of raw scores. `npm run fetch` normalises it to CSV sorted by id and the result is committed, so the git diff of each weekly update shows exactly which games were added or corrected. Anyone who distrusts the source can check the CSV against any other record of the scores; nothing downstream depends on trust.

## Known limitations (stated openly)

- **Margin of victory counts, uncapped.** A blowout pulls much harder than a close game, so lopsided wins (often against much weaker opponents) carry a lot of weight, and a team can raise its rank by running up the score. Garbage-time points count the same as any others.
- **Connectivity.** Rankings between groups of teams that have never been linked by a chain of games are not comparable. FBS vs FCS games link most teams, but early in a season some separate groups exist. The heights of such groups are each centred on zero by `alpha`.
- **Schedule size.** With only 12 games per team, many teams are close together and ranks within a few places are not statistically meaningful. The height column shows how close they are.
- **Source data.** Scores come from the CollegeFootballData API; an error there is an error here until it is corrected upstream and the next update runs.
- **Out-of-division games.** Games against teams outside FBS/FCS are not counted at all.

## Changing the method

Any change to the algorithm, parameters or output format must bump `algorithmVersion` (math/config) or `ENGINE_VERSION` (bytes), regenerate the published rankings in the same pull request, and update this document. CI fails if committed rankings do not match a fresh computation.
