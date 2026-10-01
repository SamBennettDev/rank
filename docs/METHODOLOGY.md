# Methodology

This document is the full specification of how rankings are produced. If the code and this document ever disagree, that is a bug; please open an issue.

## Goal

Rank every FBS and FCS team from worst to best using only who beat whom, with a process anyone can rerun and get the identical answer.

| Requirement | How it is met |
|---|---|
| Deterministic | No randomness anywhere. Fixed input order, fixed arithmetic order, fixed rounding. Same data in, same bytes out. |
| Auditable | Raw game data, code and output are all in this repository. `npm run verify` and the site's **Recompute** button regenerate every published ranking and compare byte for byte. CI runs it on every change. `npm run backtest` reproduces the evidence for the method. |
| Transparent | One short formula, one config file per season, and a per-team page that lists every game behind a rank. Git history shows when each result arrived or was corrected. |
| Unbiased | No preseason ranking, no human votes, no margins, no home field, no conference or brand weight, no recency weighting. Every team starts equal and only wins and losses move it. |

## Two published rankings

Every snapshot is published twice, from the same games, because "who has earned it" and "who would win" are different questions (the same split as Massey's Rating vs Power, or ESPN's Strength of Record vs FPI):

| | **Résumé** (main ranking) | **Power** |
|---|---|---|
| Question | Who has earned it? | Who would win? |
| Model | Win Springs: equal springs, wins only | Gridiron Springs: margin + 7, fitted home field, blowout limit |
| Inputs | Who beat whom | Final scores and game sites |
| Strength (backtest) | Agrees with the most results (83.6%) | Picks the most next-week winners of the spring models (71.2%) |
| Files | `data/rankings/<year>/<snapshot>.json` | `data/rankings/<year>/power/<snapshot>.json` |
| Config | the season's top-level model fields | the season config's `power` block |

The `power` block lists only model fields (`algorithmVersion`, `method`, `alpha`, `gridiron`, …); everything else (divisions, games) is shared. Adding or changing the Power view never changes a byte of the Résumé ranking. Both are recomputed, hashed and verified the same way, and the site's **Recompute** button checks both.

## The graph

- **Nodes:** teams in `teams.csv` whose classification is listed in the season's `config.json` (FBS and FCS).
- **Edges:** each completed game between two nodes is one spring between the two teams. Rematches and postseason games add more springs.
- Games that involve a team outside `teams.csv` (for example Division II), games that are not completed, and games with equal scores are not counted. Each snapshot's manifest records how many rows were dropped for each reason.

## Résumé ranking: Win Springs (wins only)

Seasons whose `config.json` sets `"method": "springrank"`, `"edgeWeight": "win"` and `"restLength": 7` (2026 onward, `algorithmVersion: win-springs-1`) are ranked by **wins alone**.

Every win is a spring between the two teams that wants the **winner exactly 7 points above the loser**. The score, the margin and where the game was played don't matter: a 1-point road win and a 50-point home win are the same spring. Each team's height is where all of its springs, and everyone else's, balance out:

```
H(s) = 1/2 * sum_ij A_ij (s_i - s_j - 7)^2  +  1/2 * alpha * sum_i s_i^2
```

where `A_ij` is the number of times team *i* beat team *j*. Setting the gradient to zero gives one linear system

```
(D_out + D_in - (A + A^T) + alpha*I) s = 7 * (d_out - d_in)
```

where `d_out` is each team's wins and `d_in` its losses. For `alpha > 0` the matrix is symmetric positive definite, so there is exactly one solution. It is solved with a dense Cholesky decomposition (`src/engine/linalg.ts`) written with only `+ - * /` and `sqrt`, in a fixed loop order, which are exactly reproducible under IEEE-754. No iteration, no tuning.

This is SpringRank (De Bacco, Larremore & Moore, *A physical model for efficient ranking in networks*, Science Advances, 2018) with a rest length of 7 instead of 1. The 7 is a display unit ("a win is worth a touchdown"): it multiplies every height by 7 and never changes the order. Heights are ranking points, not game points.

How wins-only behaves:

- **Who you beat matters.** Beating a team that sits high pulls you higher; losing to a team that sits low drags you down. Strength of schedule comes from the graph, not a separate formula.
- **Every spring pulls equally.** Margin, home field and the date don't change a spring. Each game is one equal vote for "the winner belongs above the loser".
- **Head-to-head counts but is not absolute.** A win over a team is one spring. If both teams' other results point the other way, the springs can still settle the loser above the winner; the site marks those games as upsets.
- **Running up the score does nothing**, and home field is ignored.

`alpha = 0.01` is a tiny equal pull toward zero. It exists so the system always has a unique solution, including early in the season when the graph is not yet connected.

### Rank, ties and unplayed teams

- Heights are rounded to 6 decimals. Teams with the same rounded height share a rank (shown `T-n`); the next rank skips accordingly. Ties are never broken by name or reputation.
- A team with no counted games has no information, so it is **unranked** rather than assigned a guess.

### Snapshots

`week-NN` uses all regular-season games with `week <= NN`. `postseason` uses every game. A snapshot never looks at later games, and each one is recomputed from scratch from the current CSVs, so any historical ranking can be reproduced.

## How it compares (evidence)

Each method was run through this engine on ten past seasons (2015–2025, 2020 skipped, 11,593 predicted games):

| Method | Picks next week's winner | Final ranking agrees with results |
|---|---|---|
| **Wins only, equal springs (Win Springs, published)** | 67.6% | **83.6%** |
| Margin as spring stiffness, uncapped | 68.3% | 81.1% |
| Margin as spring stiffness, clamped 7–24 | 68.6% | 82.4% |
| Least squares on margin + home (Massey) | 71.6% | 80.2% |
| Sports-Reference SRS (margin clamped 7–24) | 70.2% | 81.7% |
| Gridiron Springs (margin + 7, home field, blowout limit) | 71.2% | 81.9% |

"Agrees with results" is the share of all games where the final ranking puts the winner above the loser. Full protocol, caveats and sources: [BACKTEST.md](BACKTEST.md). Reproduce with `npm run backtest -- --history 2015-2025`.

## Power ranking: Gridiron Springs

The Power view uses Gridiron Springs (`"method": "gridiron"`, `algorithmVersion: gridiron-springs-1`), set in the season config's `power` block.

Every team gets a rating `s` in **points**. Every game is a spring that wants

```
s_winner − s_loser ± h  =  margin + winBonus
```

where `h` is the home-field advantage (added for the home team, nothing at a neutral site). The ratings and `h` are the values that minimise

```
E(s, h) = Σ_games huber( margin + winBonus − (s_winner − s_loser ± h) ;  blowoutLimit )  +  (α/2) · (Σ s² + h²)

huber(r; L) = r²/2              if |r| ≤ L
            = L·|r| − L²/2      if |r| > L
```

#### The four football rules

| Rule | Parameter | Why |
|---|---|---|
| **A win is worth a touchdown.** Each spring wants the winner as many points above the loser as they won by, plus a bonus. | `winBonus: 7` | A ranking that replaces a poll has to reward winning, not only point differential. A bonus keeps every win meaningful (a 3-point win still counts for 10), and in the backtest it makes the final ranking agree with more results at no cost to prediction. |
| **Home field is measured, not guessed.** `h` is solved together with the ratings, from the same games, every snapshot. | `fitHomeField: true` | Home field in college football is worth a few points and has been shrinking. Fitting it means no hand-picked number. The fitted value is published in every manifest (`homeFieldPoints`; it ranges from about 2.3 to 3.6 points across past seasons). |
| **Blowouts have a limit.** A spring pulls normally until a result is more than `blowoutLimit` points beyond what the ratings expect; past that its pull stops growing (Huber loss). | `blowoutLimit: 21` | Running up the score can't buy a ranking. Unlike a plain cap on margins, this does not penalise a strong team for beating a weak one by a lot, because the limit applies to the *surprise* (result minus expectation), not the raw margin. |
| **Every game counts the same.** | — | No recency weighting (it would reward late-season results, a documented bias in AP voting) and no preseason or recruiting priors. Opponent strength is not a separate formula: it comes from where each opponent settles in the same graph. |

`α = 0.01` is a tiny equal pull toward zero on every unknown. It makes the answer unique even early in the season when parts of the graph are not yet connected. Ratings average exactly zero, so a rating is points better or worse than an average FBS/FCS team.

#### Solving it

The Huber energy is convex, so it has exactly one minimum. It is found by iteratively reweighted least squares (`src/engine/gridiron.ts`):

1. Give every game full pull (weight 1).
2. Solve the weighted linear system for `s` and `h` with a dense Cholesky decomposition (`src/engine/linalg.ts`), using only `+ − × ÷` and `√` in a fixed loop order, which are exactly reproducible under IEEE-754.
3. Set each game's pull to 1 if it is within `blowoutLimit` points of expectation, otherwise `blowoutLimit / |surprise|`.
4. Repeat until no rating moves by more than 1e-9 points (or `maxIterations`, 500, is reached). The number of rounds used is published as `iterations`; full seasons take about 35–55.

#### Reading the ratings

- **Rank is the team's rating**, highest first. The y-axis of the graph view is that same rating.
- **Predicted margin** between two teams = rating gap (plus `h` for the home team) **minus the win bonus**, because each spring also credits the winner 7 points. A gap under 7 points is close to a coin flip; the site shows it as a "lean".
- On a team page, each game shows the **expected** margin from the final ratings, the result **versus expected**, and the spring's **pull** (below 100% means the blowout limit applied). All of these are recomputed in the browser from the published ratings.

## Other SpringRank configurations

The same solver also runs margin-weighted springs (`edgeWeight: "margin"`, optionally clamped with `minMargin`/`maxMargin`; `margin-springs-1`, `margin-springs-2`) and the paper's original rest length of 1 (`springrank-1`, `springrank-margin-1`). The engine keeps them so those configs reproduce exactly.


## Determinism rules

1. Teams are ordered by numeric id; games by numeric game id. This fixes the matrix and its summation order, so row order in the CSVs is irrelevant (there is a test for that).
2. (Gridiron Springs only) the solver's stopping rule compares exact floating-point values, so every machine stops after the same round.
3. Heights (and any fitted home field) are rounded to 1e-6 before they are ranked or written.
4. JSON is written with a fixed key order and layout (`formatRanking` in `src/engine/season.ts`).
5. Each ranking file embeds the SHA-256 of the exact `teams.csv` and `games.csv` bytes it was computed from, the full config and the engine version.

## Graph layout

Only the **vertical** position is meaningful: it is the team's height. Horizontal position is cosmetic and is computed by the website (`web/layout.ts`), not stored in the ranking files: one lane per conference, lanes ordered by the conference's mean height, with teams nudged sideways only where their logos would overlap.

Edges are not stored in the ranking files either. The site rebuilds them from `games.csv` with the same `buildEdges` function the pipeline uses.

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

- **Margins are ignored on purpose.** A 1-point win and a 50-point win count the same. That makes the ranking impossible to game by running up the score, but it predicts future games less well than margin-based ratings (see the table above).
- **Beating a much weaker team can lower you.** Each spring wants the winner exactly 7 above the loser; if the winner already sits far higher, that spring pulls it back down a little. A bye adds no spring, so it is neutral, but a team can still move during a bye as its past opponents' results change.
- **Cycles.** When A beat B, B beat C and C beat A, no order can respect every result; the springs find the order that strains them least.
- **Early season.** With one or two games per team, many teams are tied or nearly tied, and undefeated teams with weak schedules can sit low until they play someone. Groups of teams not yet linked by a chain of games are not comparable.
- **Cycles.** When A beat B, B beat C and C beat A, no order can respect every result; the springs find the order that strains them least.
- **Schedule size.** With about 12 games per team, many teams are close together and ranks a few places apart are not meaningfully different. The height column shows how close they are.
- **Source data.** Scores come from the CollegeFootballData API; an error there is an error here until it is corrected upstream and the next update runs.
- **Out-of-division games.** Games against teams outside FBS/FCS are not counted at all.

## Changing the method

Any change to the algorithm, parameters or output format must bump `algorithmVersion` (math/config) or `ENGINE_VERSION` (bytes), regenerate the published rankings in the same pull request, rerun the backtest, and update this document. CI fails if committed rankings do not match a fresh computation.
