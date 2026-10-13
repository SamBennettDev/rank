# Rank

Open, deterministic college football rankings for **every FBS and FCS team**. Live at **https://rank.sam-bennett.dev**.

**One current score.** A win earns **2 × the opponent’s pre-week probability of beating an average FBS team at that venue**. An average-quality neutral-site win earns 1 point; every loss deducts exactly 1. The standings show rank, team and score, with a carousel of the current top 10.

- **A consistent benchmark.** Opponent strength is measured relative to the average FBS team, including the benchmark’s uncertainty and covariance. It does not use the weaker pooled FBS/FCS average.
- **Stable early estimates.** A division gap measured on 2014–2019 results and calibrated regularization stabilize sparse schedules. Current games can establish that an FCS opponent is strong; no division has a rank ceiling or fixed credit cap.
- **Losses always cost one.** Win credits stay frozen before each calendar week. Later losses cannot revalue earlier wins and offset their own deductions.
- **Lower-division results count.** Unmodeled opponent wins earn zero quality points. Losses still deduct 1, and all resolved results remain in records and receipts.
- **Every score starts at zero.** Historical division assumptions inform opponent strength, not starting points. No team reputation, recruiting, poll, conference bonus or head-to-head override.
- **Both divisions, one standing.** Division and conference filters preserve the full-field ranks. The current #1 sets Rank’s accent color.
- **Reproduce every point.** The Node scripts and browser share one engine. Credits include the prior cutoff, estimated probability, reference strength, venue adjustment and uncertainty.

Version 2 fixes a pooled-reference error, equal-strength assumptions for sparse lower-division opponents, an imbalance between average win credit and fixed loss deductions, and dropped lower-division losses. `research/win-quality-calibration.json` records the **2014–2019** design study; `win-quality-development.json` compares already-inspected **2021–2025**; `win-quality-audit.json` traces the current teams on identical inputs. They are development findings, not an untouched holdout or proof of universal superiority. The simulation engine and older reports remain available for audit and research; the site displays current scores. See [methodology](docs/METHODOLOGY.md).

## Run

Requires Node 22+.

```sh
npm ci
npm run dev
npm run typecheck
npm test
npm run compute
npm run verify
npm run audit-win-quality -- 2026
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
data/seasons/<year>/config.json       prediction settings and calibration ID
data/rankings/<year>/<snapshot>.json  standing, per-game credits, projections and game forecasts
data/index.json                      available seasons and snapshots
```

Schema 2 publishes FBS/FCS standings in `teams`. Unranked supporting metadata appears in `opponents`, including teams outside the modeled field needed for complete result receipts. `config.classifications` selects the ranked field; `opponentClassifications` can retain additional model inputs. `config.winQuality` fixes the v2 benchmark, priors, regularization and balanced win scale. Unsupported opponents contribute zero win quality and fixed loss deductions, without affecting the strength fit. Downloadable projections cover the known modeled schedule; the site displays current scores. All snapshots use calendar cutoffs.

## Update results

Get a free key at <https://collegefootballdata.com/key>, then:

```sh
CFBD_API_KEY=... npm run fetch -- 2026
npm run fetch-plays -- 2026
npm run compute
npm run verify
```

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
