# Rank

Neural college football predictions and rankings for **every FBS and FCS team**. Website: **https://rank.sam-bennett.dev**.

**Order teams by who is more likely to beat whom.** Three saved neural fits provide a bounded adjustment to a robust schedule rating. The model shrinks estimates with limited evidence and deducts losses after performance training. Rankings and venue-aware matchup forecasts use the same strength differences.

- **Current-season evidence.** Shared weights learn from historical pregame examples; every team’s statistics reset each season. Team identity, conference/division, recruiting, preseason ratings and live prices are excluded.
- **A strict score cap.** Margins are capped at 35 before every selected score-derived fit, including Huber. Extra scoreboard margin beyond 35 supplies no additional credit. Actual play efficiency remains evidence.
- **Stronger loss consequences.** Every loss subtracts `2 / (modeled games + 4)` from strength, including losses to outside opponents. This is applied after training. Actual rank changes also depend on performance and other teams.
- **Small samples and uncertainty.** Retain `games / (games + 6)` of performance strength: 50% after six modeled games. Team pages show evidence retained after shrinkage; that weight is not confidence in a rank. Downloaded fit spread is also not a confidence interval.
- **Consistent ordering.** Every higher-ranked team is favored on a neutral field. Positive probability calibration preserves winners and ranks. Home advantage applies to actual game forecasts.
- **Auditable snapshots.** Six-hour result lag, exact team/record reconciliation, source hashes, Python/browser parity, and byte-for-byte reproduction bind forecasts to completed games at each cutoff.

The stricter policy picked **70.16%** of winners on 3,603 dated FBS games in 2020–2025, versus **70.86%** for the previous neural blend. It implements the requested score cap and stronger loss consequences, with a measured accuracy cost; it does not establish a betting-market advantage. See the [new study and all Week 6 rankings](research/season_only/robust/REPORT.md), [original research](research/season_only/README.md), and [methodology](docs/METHODOLOGY.md).

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

Schema 2 publishes the neural order in `teams[].rank`. `teams[].neural` stores average full-field probabilities, evidence shrinkage, loss deductions and fit rank spread; `height` is an ordinal graph coordinate. `manifest.neural` records the model, cap/loss/shrinkage policy, training years, input hash and ordering diagnostics. Supporting opponents appear in `opponents`. `config.neural` enables the saved model; a missing or stale export fails explicitly. `earnedHeight` / `earnedRank`, `credits` and `projection.target = frozen-earned-points` retain the separate archived points model. Division and conference filters preserve full-field ranks.

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
