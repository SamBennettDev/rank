# Results-only résumé rankings

**Archived experiment.** This directory preserves the alternative résumé study and its Week 6 snapshot; it does not describe the active neural ranking. Its application implementation remains available at Git commit `9b601d9`.

The experimental standing measures **wins earned above a results-based top-25 FBS benchmark against the same schedule**. It answers an earned-results question; the neural matchup models remain in `../season_only/`.

- [Interactive report](REPORT.html): all 266 current teams, individual game explanations, seven historical methods, and filters for season range, snapshot, and game cohort.
- [PDF report](REPORT.pdf), [Week 6 rankings](week6-2026-rankings.csv), [historical summary](historical-summary.csv).
- [Calibration protocol](protocol.json), [full evaluation](evaluation.json), [current audit](audit-2026.json), [independent Python parity](python-parity.json).

## Formula and evidence

For each focal team, remove **all its games** before fitting opponent strength from the other current-season wins, losses, and venues. Regularized Bradley–Terry starts every team at zero. Use the 25th-highest fitted FBS strength (excluding the focal team) as the reference. At a team’s venue, let `p` be that benchmark’s probability of beating the opponent:

```text
win contribution = 1 − p
loss contribution = −p
résumé = actual wins − sum(p)
```

A score of +1 means one more win than that benchmark expects on the schedule. Quality wins earn more; losses to weaker opponents cost more; road results account for venue. Margins cannot change the résumé. Later opponent results revalue earlier games. Flipping a focal loss into a win on an unchanged schedule adds exactly one without changing its opponent probabilities. A hard schedule without wins cannot create positive credit.

The shared ridge `0.5` and home advantage `0.3` log odds were selected from 16 settings by dated future-game log loss on 2014–2019. The top-25 reference and additive formula are declared policies, not fit to current ranks or polls. There are no team/division priors, preseason ratings, past team performance, conference bonuses, polls, EPA, injuries, recruiting, betting prices, or margin inputs. FBS membership defines the reference field. Names and IDs only join records and display teams.

Probabilities round to six decimals before scoring. A supporting opponent outside the modeled field cannot establish quality: a win earns zero and a loss costs one, while both remain in records. Opponents with fewer than three independent modeled results are flagged as limited evidence. Equal priors leave early and disconnected schedules uncertain.

`recordProbability` is the conditional Poisson-binomial chance of the benchmark matching or exceeding a team’s actual wins. It assumes independent games and does not integrate rating uncertainty. It is a diagnostic, not the score or a confidence level. `scheduleDifficulty` is the mean benchmark loss probability.

## Historical comparison

Seven methods are compared at Week 6 and final cutoffs across **2002–2025**: wins above benchmark, record difficulty, previous frozen-credit v2, win percentage, net wins, Colley, and results-only Bradley–Terry. Each comparison uses identical completed games. Final includes completed postseason games. The separate probability test uses dated pre-week snapshots and a six-hour score-availability lag.

Completed-result agreement asks whether the standing places a completed game’s winner above its loser, with ties worth half. **It is descriptive consistency, not future prediction or an objective résumé ground truth.** Every historical season has already been inspected in this project; none is a pristine holdout. The previous model’s 2014–2019 calibration postdates 2002–2013, so its replay on those years is descriptive, not an as-issued historical forecast. Source publication vintages are not certified. No universal superiority or market-beating claim is made.

Historical inputs are the existing public pinned schedules under `../season_only/inputs/games_YEAR.csv`; `../season_only/prepare.py` and `../season_only/sources.json` describe provenance. Evaluation records SHA-256 for every consumed input. Current inputs are the repository’s 2026 CSVs; the cutoff remains **2026-10-11 08:30 UTC**, through completed Week 6. No paid source or account was used.

## Production integration

At experiment commit `9b601d9`, `src/engine/resume.ts` is shared by Node and the browser. A matrix-free Newton/conjugate-gradient solver uses fixed-arithmetic exponentials. `config.resume` enables the method. `manifest.standingMethod`, `manifest.resume`, `team.resume`, and `resume.games` make its policy and receipts explicit. In that archived version, published `rank`, `height`, `change` and ties refer to the résumé. The active version uses a neural pairwise ordering.

The archived frozen-point standing remains in `earnedHeight` / `earnedRank`; `credits` remains its old ledger. `projection.target = frozen-earned-points` identifies the legacy simulation target. Matchup probabilities and neural research remain separate. No prospective neural forecast or original registration was overwritten.

## Reproduce

Requires the Python packages in `../season_only/requirements.txt` and the existing historical input CSVs. No new Python or application dependency is required.

```sh
OPENBLAS_NUM_THREADS=1 python research/resume/study.py calibrate
OPENBLAS_NUM_THREADS=1 python research/resume/study.py evaluate
OPENBLAS_NUM_THREADS=1 python research/resume/compare_legacy.py
npm run compute
OPENBLAS_NUM_THREADS=1 python research/resume/report.py
npm run typecheck
npm test
npm run verify
npm run build
```

The report reads `week6-2026-snapshot.json`, preserving the experimental ranking independently of the active standings. To reproduce the experimental application and its `npm run audit-resume -- 2026` command, use commit `9b601d9` in a separate checkout.

Calibration and evaluation are deliberately separate commands. To study a new policy, save a new protocol before inspecting later comparisons. Repeated historical experimentation cannot manufacture a fresh holdout.

Integrity checks cover margin/identity invariance, row order, equal starts, no focal-team self-credit, road credit, opponent revaluation, exact receipts, supporting opponents, record-probability arithmetic, future-result leakage, archived projection labeling, and independent Python/TypeScript agreement. The entire browser rebuild must match published bytes.
