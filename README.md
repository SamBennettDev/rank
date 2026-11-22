# Rank

Open, deterministic college football rankings for **every FBS and FCS team**. Live at **https://rank.sam-bennett.dev**.

**One spring graph.** Every game is a spring that wants its winner 100 × margin^0.75 points above its loser: a 1-point win is worth 100, a 7-point win 430, a 14-point win 724 and a 35-point win 1439, so each extra point counts a little less. Solving the whole graph once gives every team a strength, the average of what its games say, and from it a **quality**: 100 × its chance of beating an average team, from 0 to 100. Quality measures team strength.

The ranking itself is **résumé**, and two boards are built from quality:

- **Résumé (the ranking):** strength of record, 0–100: how unlikely this record would be for a good team of the same division against the same schedule, averaged over five benchmarks (that division's top-10, top-25, top-50 and top-100 team, and its average team). FBS and FCS are ranked separately.
- **Quality:** one board for FBS and FCS together.
- **Quality** is team strength from the spring graph, shown as the second board.
- **Schedule:** the average quality of the opponents played.

No home field or head-to-head rules.

- **Every team starts at zero.** No preseason, polls, recruiting or conference bonus. FBS and FCS share one graph, and results against lower-division teams count.
- **Explainable game by game.** Each team page walks through its rank in four steps with its own numbers: every game's spring, the solve, quality, and résumé.
- **Players on one scale.** Position boards (QB, RB, WR, TE, K, DL, LB, DB) rate every FBS and FCS player against what an average player does against the same opponents, using our own expected-points model. Each player page shows the calculation step by step.
- **Free public data.** College scores, play-by-play, box scores and rosters come from sportsdataverse's ESPN-based release files, published on GitHub. No API key.
- **Measured.** On 2014–2019, where the settings were chosen, the weekly résumé rankings pick 68.1% of next week's winners and the final ranking has the winner above the loser in 83.3% of games between teams of the same division (67.4% and 81.8% on 2021–2026). Quality, one board for both divisions, picks 71.7% of next week's winners with 81.5% season-end agreement over all games (70.0% and 80.4%). `research/springs.py` reproduces both; `research/QUALITY.md` and `research/resume.py` compare the alternatives.
- **Reproduce every number.** The Node scripts and the browser share one engine; Recompute on the method page rebuilds every published file byte for byte.

Matchup odds come from a separate calibrated margin model and never change the ranking. See [methodology](docs/METHODOLOGY.md).

## Run

Requires Node 22+.

```sh
npm ci
npm run dev
npm run typecheck
npm test
npm run compute
npm run verify
npm run build
npm run backtest -- --history 2021-2025   # matchup odds, walk-forward
python3 research/springs.py 2014-2019      # ranking accuracy (needs numpy)
npm run fit-ep                             # refit the expected-points model (2014–2025)
```

## Data and audit

```text
data/seasons/<year>/teams.csv         configured teams
data/seasons/<year>/games.csv         scores, sites, kickoffs and schedule
data/seasons/<year>/plays.csv         per team-game scrimmage EPA, success and special-teams EPA
data/seasons/<year>/players.csv       per player-game passing, rushing, receiving, kicking and defense
data/seasons/<year>/roster.csv        player bios: position, class, height, weight, hometown
data/seasons/<year>/config.json       algorithm version, spring and matchup settings
data/models/ep.json                   our expected-points and field-goal models, with 2025 holdout calibration
data/rankings/<year>/<snapshot>.json  quality, résumé, schedule, every game's springs, and game odds
data/rankings/<year>/players.json     player settings, team pass/rush units and the position boards
data/rankings/<year>/teams/<id>.json  a team's units and every rated player with game-by-game lines
data/index.json                       available seasons and snapshots
```

Each ranking file lists ranked FBS/FCS teams in `teams` with their `height` (quality, 0–100) and `resume` and `resumeRank` (the official ranking), `strength` (points better than average), `schedule` and `scheduleRank`, and each board's weekly movement (`change`, `resumeChange`, `scheduleChange`), and every counted game in `springs` with its `margin`, `win` (résumé points the winner earned) and `loss` (résumé points the loser lost). Lower-division opponents are on the graph too and appear, unranked, in `opponents`. `config.classifications` selects the ranked field; `opponentClassifications` can keep additional divisions as inputs. All snapshots use calendar cutoffs.

## Update results

College data comes from sportsdataverse's ESPN-based release files (`cfb_schedules`, `cfbfastR_cfb_pbp`, `espn_cfb_rosters`, `espn_cfb_teams`, `espn_cfb_player_box`), no key. They refresh about daily, so a Saturday's games usually arrive Saturday night or Sunday.

```sh
npm run fetch -- 2026     # teams, games, plays, players and roster
npm run compute
npm run verify
```

Commit the changed data. GitHub’s **Update data** workflow does this hourly and publishes when anything changed. Ids are ESPN's for teams, games and players.

## Deploy

GitHub Settings → Pages → Source: **GitHub Actions**, with custom domain `rank.sam-bennett.dev`. The DNS CNAME for `rank` points to `sambennettdev.github.io`. Run **Update data** once.

## Layout

```text
src/engine/  spring graph, résumé and schedule, expected points, player ratings, matchup model, pipeline
scripts/     the data fetch, expected-points fit, computation, verification and backtesting
web/         static TypeScript site, sharing the same engine
tests/       spring math, matchup model, chronology and determinism
research/    reproduces the ranking's accuracy on past seasons and compares quality models
docs/        full methodology
```

`tests/fixtures/demo` is fictional, generated by `npm run demo`. Logos load from ESPN’s CDN by team ID.

## License

MIT

## NFL

The NFL is ranked with the same engine as its own season (`data/seasons/nfl-<year>`), picked from the season selector. `npm run fetch-nfl -- 2026` pulls results from nflverse's public schedule file (no key needed). Settings are carried over from college football and have not been tuned on NFL games, and there are no play-by-play unit ratings for the NFL.

## Hourly updates

GitHub's own `schedule` trigger is best-effort and often runs hours late, so a Cloudflare Worker (`cloudflare/trigger`) starts the **Update data** workflow every hour. One-time setup:

1. Create a fine-grained GitHub token for `SamBennettDev/rank` with **Actions: Read and write**.
2. `cd cloudflare/trigger && npx wrangler secret put GITHUB_TOKEN` (paste the token), then `npx wrangler deploy`.
