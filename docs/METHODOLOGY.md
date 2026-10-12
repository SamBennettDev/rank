# Methodology

This document is the full specification of how rankings are produced. If the code and this document ever disagree, that is a bug; please open an issue.

## Goal

Rank every FBS and FCS team from worst to best using game results, with a process anyone can rerun and get the identical answer.

| Requirement | How it is met |
|---|---|
| Deterministic | No randomness anywhere. Fixed input order, fixed arithmetic order, fixed rounding. Same data in, same bytes out. |
| Auditable | Raw game data, code and output are all in this repository. `npm run verify` and the site's **Recompute** button regenerate every published ranking and compare byte for byte. CI runs it on every change. |
| Transparent | One short formula, one config file per season, and a per-team page that lists every game behind a rank. Git history shows when each result arrived or was corrected. |
| Unbiased | No preseason ranking, no human votes, no home field, no conference or brand weight, no recency weighting. Every team starts equal and only game results (and, for the Margin method, raw score margins) move it. |

## The graph

- **Nodes:** teams in `teams.csv` whose classification is listed in the season's `config.json` (FBS and FCS).
- **Springs:** each completed game between two nodes is one spring between the two teams. Rematches and postseason games add more springs.
- Games that involve a team outside `teams.csv` (for example Division II), games that are not completed, and games with equal scores are not counted. Each snapshot's manifest records how many rows were dropped for each reason.

## The ranking: one-way springs, fewest upsets

Two rules define the ranking:

1. **A win never costs a team.** Every game is a spring that pushes the winner up and the loser down. It never pulls the other way. It pushes hardest while the result is surprising and fades as the winner pulls further ahead, so beating a weak team still helps a little and losing to a strong team still hurts a little.
2. **Winners finish above losers as often as possible.** When results form a cycle (A beat B, B beat C, C beat A) no order can respect them all, so some games must be upsets. The ranking accepts as few as it can find, and every other game's winner is held above its loser.

Two methods are published. They differ only in each game's target `gap`, the point where its push starts to fade:

| Method | `gap` for each game | What it measures |
|---|---|---|
| **Wins** (`win`, the site default) | `restLength` (7) for every win | Only who won. A 1-point win and a 40-point win push the same. |
| **Margin** (`margin`) | winning score − losing score, uncapped | Results and how decisive they were. A 28-point win pushes hard until the winner is 28 points above. |

### The spring

For a game with winner `w`, loser `l` and heights `s`, let `u = (s_w − s_l − gap) / τ`. The game pushes `w` up and `l` down with force

```
push(u) = (1 − u / sqrt(1 + u²)) / 2
```

This is nearly 1 while the winner is below the loser or well short of the gap. It is exactly 1/2 at the gap and fades toward 0 as the winner pulls ahead. It is never negative. `τ` (`softness`, 7 points) sets how gradually it fades. The push is the slope of the energy `τ/2 · (sqrt(1 + u²) − u)`, a smooth hinge. It uses only `sqrt`, so it is exactly reproducible under IEEE-754, unlike `exp` or `log`.

### Step 1: starting order

Heights `s` minimise

```
H(s) = sum_games τ/2 · (sqrt(1 + u²) − u)  +  α/2 · sum_i s_i²
```

`α = 0.01` is a small equal pull toward zero. It makes the minimum unique and stops an unbeaten team's height from running off to infinity. `H` is strictly convex. It is minimised by Newton's method (`oneWaySprings` in `src/engine/springrank.ts`). Each step solves `(Hessian) · step = −gradient` with a dense Cholesky decomposition (`src/engine/linalg.ts`), and halves the step while it does not lower `H`. The loop stops when a step moves no height by more than 1e-9. Teams sorted by these heights give the starting order; exact height ties go by team id, which only affects the starting point.

### Step 2: fewest upsets

Visit the teams in id order. Move each to the place in the order that leaves the fewest upsets (games whose winner is placed below its loser). Ties go to the place nearest the team's current place, then the higher one. Only move a team if that strictly lowers the count. Repeat until a full pass moves no one. Every move removes at least one upset, so this always stops. Where it stops, **no single team can be moved to another place to remove an upset**; tests check that by brute force (`fewestUpsetsOrder`).

The games still upside down in that order are the **accepted upsets**. They are published in each ranking file's `upsets` array.

Finding the order with the absolute fewest upsets is the *minimum feedback arc set* problem. It is NP-hard, and it usually has many equally good answers, which would make the ranking depend on how a tie was broken. The local search above is deterministic and leaves no single-move improvement. It is not proven to be the global minimum.

### Step 3: final heights

Every game that is not an accepted upset gets a **stop**: a very stiff spring that engages only if its winner comes within ½ point of its loser. Heights minimise

```
H(s) = sum_games τ/2 · (sqrt(1 + u²) − u)
     + 500 · sum_kept max(0, ½ − (s_w − s_l))²
     + α/2 · sum_i s_i²
```

solved the same way, starting from step 1's heights. The stops keep **every kept winner above its loser**; a test checks every published file, and across ten past seasons the smallest kept gap was 0.49. Accepted upsets keep their ordinary spring, so the upset still pushes its winner up and its loser down. The resulting heights are the ranking.

How it behaves:

- **Every game counts.** Each win pushes up and each loss pushes down, so records matter, and who you played sets how hard each game pushes. Strength of schedule comes from the graph, not a separate formula.
- **Head-to-head is respected wherever results allow.** If A beat B, A finishes above B unless that game is one of the accepted upsets.
- **Wins:** the score is ignored. **Margin:** a bigger win keeps pushing until the winner is further ahead.

### Configuration

`data/seasons/<year>/config.json`:

```json
{
  "label": "2026 season",
  "demo": false,
  "alpha": 0.01,
  "softness": 7,
  "classifications": ["fbs", "fcs"],
  "methods": {
    "win": { "algorithmVersion": "win-springs-2", "restLength": 7 },
    "margin": { "algorithmVersion": "margin-springs-2" }
  }
}
```

Each method listed under `methods` is computed and published separately to `data/rankings/<year>/<method>/`. Every ranking file's manifest records the engine version, `method`, that method's `algorithmVersion`, `alpha`, `softness` and (for Wins) `restLength`. Each file also lists its accepted upsets by game id.

On the site, Wins is the default; `?method=margin` at the end of any link shows the Margin ranking, and the header toggle switches between them while keeping the current view, week and team.

### Rank, ties and unplayed teams

- **Rank is the team's height**, highest first. The y-axis of the graph view is that same height.
- Heights are rounded to 6 decimals. Teams with the same rounded height share a rank (shown `T-n`); the next rank skips accordingly. Ties are never broken by name or reputation.
- A team with no counted games has no information, so it is **unranked** rather than assigned a guess.

### Snapshots

`week-NN` uses all regular-season games with `week <= NN`. `postseason` uses every game. A snapshot never looks at later games, and each one is recomputed from scratch from the current CSVs, so any historical ranking can be reproduced.

## How it performs

`npm run backtest -- --history 2015-2025` runs this exact model on ten past seasons (2020 skipped), using public season-complete schedules from the [sportsdataverse cfbfastR-data](https://github.com/sportsdataverse/cfbfastR-data) project (downloaded to a temp folder, never committed). It reports, for each method, how often the final ranking puts the winner above the loser and how often rankings using only earlier games pick the next week's winner. `npm run backtest` uses the seasons currently in this repository.

| 2015–2025, 15,054 games | Winner above loser (final ranking) | Picks next week's winner |
|---|---|---|
| Wins | 90.5% | 67.2% |
| Margin | 90.3% | 69.4% |
| *Before (two-sided springs): Wins* | *83.6%* | *67.6%* |
| *Before (two-sided springs): Margin* | *80.2%* | *70.7%* |

Putting winners above losers as often as possible makes the ranking describe the season's results far more faithfully, at a cost of about one point in predicting games it has not seen yet.

## Determinism rules

1. Teams are ordered by numeric id; games by numeric game id. This fixes the matrix and its summation order, so row order in the CSVs is irrelevant (there is a test for that).
2. The solver and the upset search have no randomness. They use only `+ − × /` and `sqrt`, which IEEE-754 defines exactly, in a fixed loop order. Newton stops at a fixed threshold (no step larger than 1e-9) and the search stops when a full pass moves no team, so the same input takes the same steps on every computer.
3. Heights are rounded to 1e-6 before they are ranked or written.
4. JSON is written with a fixed key order and layout (`formatRanking` in `src/engine/season.ts`).
5. Each ranking file embeds the SHA-256 of the exact `teams.csv` and `games.csv` bytes it was computed from, the model settings and the engine version.

## Graph layout

Only the **vertical** position is meaningful: it is the team's height. Horizontal position is cosmetic and is computed by the website (`web/layout.ts`), not stored in the ranking files: one lane per conference, lanes ordered by the conference's mean height, with teams nudged sideways only where their logos would overlap.

Edges are not stored in the ranking files either. The site rebuilds them from `games.csv` with the same `buildEdges` function the pipeline uses.

## Per-game quantities on a team page

- **Gap** = this team's height − the opponent's height.
- **Push**: how hard the game pushes this team up (↑, a win) or down (↓, a loss), as a share of full force: `push(u)` above with the target gap of 7 under Wins or the score margin under Margin.
- **Upset** = a game in the file's `upsets` list.

## Data pipeline

```
CollegeFootballData API --fetch--> data/seasons/<year>/{teams,games}.csv
                                         |
                           compute (src/engine, deterministic)
                                         v
                           data/rankings/<year>/<method>/<snapshot>.json  +  data/index.json
```

The API is only a source of raw scores and team ids. `npm run fetch` normalises it to CSV sorted by id and the result is committed, so the git diff of each weekly update shows exactly which games were added or corrected. Anyone who distrusts the source can check the CSV against any other record of the scores; nothing downstream depends on trust.

## Known limitations (stated openly)

- **Wins ignores how close a game was.** A 1-point win counts the same as a 50-point win.
- **Margin rewards running up the score.** A 50-point win targets a 50-point height gap, while a 1-point win targets a 1-point gap. Raw margins are deliberately uncapped.
- **Expected results carry little weight.** A win over a much weaker team, or a loss to a much stronger one, pushes only a little. That is deliberate, but it means a team gains little from a soft schedule even when unbeaten. A bye adds no spring, so it is neutral, but a team can still move during a bye as other results change.
- **α and τ are choices.** `α = 0.01` and `τ = 7` were chosen once, by checking the ten-season backtest, and are fixed in each season's config. Changing either changes heights and can change ranks, and needs a new `algorithmVersion`.
- **Fewest upsets is a local search.** No single team can be moved to remove an upset, but a better order that needs several teams moved at once may exist. The exact minimum is NP-hard and usually not unique.
- **Early season.** With one or two games per team, many teams are nearly tied, and undefeated teams with weak schedules can sit low until they play someone. Groups of teams not yet linked by a chain of games are not comparable.
- **Schedule size.** With about 12 games per team, ranks a few places apart are not meaningfully different. The height column shows how close teams are.
- **Source data.** Scores come from the CollegeFootballData API; an error there is an error here until it is corrected upstream and the next update runs.
- **Out-of-division games.** Games against teams outside FBS/FCS are not counted at all.

## Changing the method

Any change to the algorithm, parameters or output format must bump `algorithmVersion` (math/config) or `ENGINE_VERSION` (bytes), regenerate the published rankings in the same pull request, and update this document. CI fails if committed rankings do not match a fresh computation.
