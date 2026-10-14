# Rank

Open, deterministic college football rankings for **every FBS and FCS team**. Live at **https://rank.sam-bennett.dev**.

**Rank the résumé earned this season.** Score = **actual wins − the wins a results-based top-25 FBS benchmark expects against the same schedule**. Quality wins earn more, bad losses cost more, and road results account for venue. A score of +1 means one more win than that benchmark expects. The standings show rank, team and score, with a carousel of the current top 10.

- **Results establish quality.** Regularized Bradley–Terry uses current-season wins, losses and venues. Every team starts equal; margins, polls, recruiting and division strength priors do not enter the résumé.
- **No self-credit.** Remove every focal-team game before assessing its opponents and its benchmark. Flipping one of its losses to a win increases its score by exactly one on the same schedule.
- **Opponent résumés develop.** Later opponent results revalue earlier games. Wins earn `1 − benchmark win probability`; losses cost that probability.
- **Lower-division results count.** Unmodeled opponent wins earn zero quality points. Losses still deduct 1, and all resolved results remain in records and receipts.
- **Sparse evidence stays visible.** An amber dot marks opponents with fewer than three independent modeled results. There is no team, conference or division bonus, rank ceiling, or head-to-head override.
- **Both divisions, one standing.** Division and conference filters preserve the full-field ranks. The current #1 sets Rank’s accent color.
- **Reproduce every point.** The Node scripts and browser share one engine. Each team’s résumé includes every result’s benchmark probability, venue, independent opponent evidence and contribution.

Version 3 calibrates two shared probability settings on **2014–2019** and compares seven résumé methods across **2002–2025**. The top-25 benchmark and additive scoring rule are explicit policies. [The résumé report](research/resume/REPORT.html) separates descriptive completed-result agreement from future-game accuracy and explains the remaining limits. All historical seasons are development data. The previous frozen-credit model remains in `earnedHeight` / `earnedRank`; downloadable projections explicitly target those archived points. Neural matchup research remains separate. See [methodology](docs/METHODOLOGY.md).

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
npm run audit-resume -- 2026
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

Schema 2 publishes FBS/FCS standings in `teams`. `config.resume` selects the results-only standing; `team.resume.games` is its complete ledger. `rank` / `height` refer to that standing. Unranked supporting metadata appears in `opponents`. `config.classifications` selects the published field; `opponentClassifications` can retain model inputs. `config.winQuality` retains the archived v2 earned-point and prediction settings. `credits` is the archived frozen-credit ledger, and `projection.target` identifies its target as `frozen-earned-points`. All snapshots use calendar cutoffs and a six-hour score-availability lag.

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
