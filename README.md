# Rank

Neural college football predictions and rankings for **every FBS and FCS team**. Website: **https://rank.sam-bennett.dev**.

**Order teams by who is more likely to beat whom.** Six saved neural networks predict every neutral-site head-to-head matchup. The engine starts with expected round-robin wins and improves a weighted consensus ordering across all pairs. Scheduled-game forecasts and the interactive comparison tool use the same networks, with venue adjustment.

- **Current-season team evidence.** Scores, margins, efficiency and opponent statistics reset each season. Shared weights learn from previous seasons’ pregame features and outcomes.
- **No reputation inputs.** Team names, IDs, conferences, divisions, recruiting, preseason rankings and live betting prices do not enter neural features. IDs only join games to statistics.
- **Pairwise ordering.** The ranking maximizes agreement with head-to-head win probabilities through deterministic improving insertion moves. Cycles can prevent every higher-ranked team being favored; this is a local optimum, not a certified global solution.
- **One prediction engine.** Three rich-stat networks contribute 75%; three opponent-graph networks contribute 25%. Browser and Node inference match the independent Python model.
- **Meaningful probabilities.** The average win chance beside a team summarizes neutral games against the full modeled field. Specific matchup chances appear on the Matchups page; the average is not an additive résumé score.
- **Auditable snapshots.** Features use games completed by each calendar cutoff, with a six-hour availability lag. Input hashes reject stale exports. The browser can reproduce all published rankings and forecasts from numeric snapshots and trained weights.

The saved blend picked **70.86%** of winners on 3,603 dated FBS games from 2020–2025. Those inspected seasons are development evidence and do not establish a general betting-market advantage. [Research and reproduction](research/season_only/README.md) describe the models and limits. The previous frozen-credit standings and the alternative résumé experiment remain archived; they do not determine the neural ordering. See [methodology](docs/METHODOLOGY.md).

## Run

Requires Node 22+.

```sh
npm ci
npm run dev
npm run typecheck
npm test
npm run compute
npm run verify
npm run audit-neural -- 2026
npm run audit-win-quality -- 2026  # archived earned-point ledger
npm run build
npm run backtest -- --history 2021-2025
npm run project-backtest -- --history 2021-2025 --samples 2048 --modes correlated --report research/projection-results.json
```

`npm run calibrate` reproduces the archived v1 prediction calibration from pinned 2014–2019 schedules. It writes defaults and a training report; update versioned season configurations deliberately if settings change. `npm run backtest -- --history 2021-2025 --include-repo --summary --report research/development-results.json` reproduces game-prediction results; omit `--summary` for per-game forecasts.

## Data and audit

```text
data/seasons/<year>/teams.csv         configured teams
data/seasons/<year>/games.csv         scores, sites, kickoffs and schedule
data/seasons/<year>/plays.csv         condensed public play-by-play
data/seasons/<year>/rich.csv          passing, rushing, drive and disruption summaries
data/seasons/<year>/neural.json       trained weights and causal numeric snapshots
data/seasons/<year>/config.json       prediction settings and calibration ID
data/rankings/<year>/<snapshot>.json  standing, per-game credits, projections and game forecasts
data/index.json                      available seasons and snapshots
```

Schema 2 publishes the neural order in `teams[].rank`. `teams[].neural` stores average full-field win probabilities; `height` is an ordinal graph coordinate. `manifest.neural` records the model, training years, input hash and ordering diagnostics. Supporting opponents appear in `opponents`. `config.neural` enables the saved model; a missing or stale export fails explicitly. `earnedHeight` / `earnedRank`, `credits` and `projection.target = frozen-earned-points` retain the separate archived points model. Division and conference filters preserve full-field ranks.

## Update results

Get a free key at <https://collegefootballdata.com/key>, then:

```sh
CFBD_API_KEY=... npm run fetch -- 2026
REFRESH=1 npm run fetch-plays -- 2026
npm run neural:export -- --year 2026 --refresh-rich
npm run compute
npm run verify
```

The exporter needs Python 3.12 and `python -m pip install -r scripts/requirements-neural.txt`. Ordinary verification and the browser use saved artifacts and need no Python. Annual model checkpoints must exist before enabling a new forecast year.

Commit the changed data. GitHub’s **Update data** workflow uses the `CFBD_API_KEY` repository secret to refresh and publish automatically.

## Deploy

GitHub Settings → Pages → Source: **GitHub Actions**, with custom domain `rank.sam-bennett.dev`. The DNS CNAME for `rank` points to `sambennettdev.github.io`. Add the API secret and run **Update data** once.

## Layout

```text
src/engine/  earned standings, prediction model, season simulation, chronology and pipeline
scripts/     fetching, calibration, computation, verification and backtesting
web/         static TypeScript site, sharing the same engine
tests/       math, fixed loss deductions, forecasts, chronology and determinism
research/    pinned design comparisons, development reports and archived experiments
docs/        full methodology
```

`tests/fixtures/demo` is fictional, generated by `npm run demo`. Logos load from ESPN’s CDN by team ID.

## License

MIT
