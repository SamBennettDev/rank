# Robust neural rankings with stronger loss consequences

The active model uses a robust schedule rating plus a **bounded neural correction**, shrinks performance estimates with limited current-season evidence, and deducts losses **after** performance training. A single neutral-field strength determines both rankings and matchup predictions. Team identity, previous-season team ratings, conference/division, recruiting, polls and live prices remain excluded.

This implements a more loss-sensitive ranking policy. It does **not** establish a predictive accuracy improvement: the new policy picks **70.16%** of winners on 3,603 FBS games in 2020–2025, versus **70.86%** previously, an accuracy difference of -0.69 percentage points. Probability calibration uses 2014–2019 forecasts only and cannot change picks or ranks.

## How it works

1. Cap every game margin to ±35 **before** fitting every selected score-derived rating, including Huber. Fit current-season ratings and opponent-adjusted efficiency. Increasing an already 35-point margin supplies zero extra scoreboard credit; actual play efficiency can still add evidence. Exclude raw scoring averages, uncapped margin, raw EPA averages, margin variation, Elo and record ratings from the neural correction. Opponent margin context uses capped ratings. Existing play summaries exclude garbage time.
2. Three shared neural fits use 50 numeric inputs and an eight-neuron hidden layer. Bound standardized inputs to ±4, and bound the **entire neural correction** to ±1. Add it to the robust margin rating divided by 14.
3. Multiply performance strength by `n / (n + 6)`, using completed games against modeled opponents. At six games, retain 50% of that estimate. At zero games, performance strength is exactly zero.
4. Deduct `2 × losses / (n + 4)` after fitting the performance network. All losses count, including losses to outside opponents. A loss never has a positive direct effect when performance inputs and n are held fixed. Opponent strength and performance still matter, so an actual loss does not guarantee a fixed number of lost ranking positions.
5. Predict with `sigmoid(1.009351 × (strength A − strength B + learned venue effect))`. The positive temperature was selected on older validation forecasts. With six modeled games, one additional loss lowers calibrated log odds by 0.2019; a hypothetical 50% matchup becomes 44.97% with other evidence held fixed.

The scalar architecture gives a consistent neutral order with no favorite cycles. Team pages show completed games, losses and evidence retained after shrinkage; that weight is not confidence in a rank. Downloaded data also contains rank spread across the three fits. That spread measures fit variation, **not** sampling uncertainty or a confidence interval. Limited-evidence flags remain visible; precise ranks still have uncertainty.

## Search and historical validation

The first study tested 24 designs across three older periods and three seeds: 216 neural fits. It applied loss deductions during training; the model could partly compensate through correlated performance features. It picked 70.30% in the later-season comparison and did not resolve the ranking concern.

The second study registered 16 bounded neural configurations, three validation periods and three seeds: 144 neural fits. Three positive **post-fit** loss penalties yielded 48 candidate policies. Selection used 2006–2013→2014–2015, 2006–2015→2016–2017 and 2006–2017→2018–2019, balancing macro-season overall and early-sample accuracy, then log loss. The final chosen settings are `{"anchor_scale": 14.0, "evidence_prior": 6.0, "residual_limit": 1.0, "ridge": 0.003}`, loss coefficient 2.0. A third registered study kept the same 16 configurations and three loss penalties, while imposing the 35-point cap before Huber and every other selected score-derived fit. It adds 144 neural fits. Three sets of 20 annual refits add 180 networks: **684 new neural fits in total**. The final settings above come from the structurally capped study. Verification then found 36 of 60 annual fits had reached the initial iteration budget; the nine selected validation fits and 36 unconverged annual fits were continued on the identical objective until numerical convergence; 24 already-converged annual fits were preserved. This made 45 optimizer continuations without changing architecture, features, loss settings or training cutoffs. Probability calibration was refitted on only the same older validation forecasts.

Every annual model trains only on earlier seasons. There are 19 completed historical prediction seasons, 2007–2025. Architecture and calibration use later years relative to the earliest hindcasts, so those early results are not a contemporaneous prospective test. The final design round followed inspection of earlier studies and both earlier rounds’ 2020–2025 results. **All historical comparisons are retrospective development evidence.** Neither selecting on older folds nor collecting many fits creates an untouched holdout.

| Comparison on identical dated weekly games | Games | New policy accuracy | Benchmark accuracy | Log loss: new / benchmark |
| --- | ---: | ---: | ---: | ---: |
| Previous neural blend | 3,603 | 70.16% | 70.86% | 0.5729 / 0.5617 |
| Spread favorites | 3,594 | 70.23% | 72.33% | 0.5722 / 0.5388 |
| Moneyline favorites | 3,025 | 69.32% | 71.14% | 0.5823 / 0.5521 |
| Adjusted margin | 3,603 | 70.16% | 69.75% | 0.5729 / 0.5760 |

For rankings frozen after Week 6 and used for the remaining season: **67.91%** versus **68.87%** previously on 2,703 games. The new model’s frozen-snapshot log loss is 0.5951, versus 0.5882. The [full comparison](polished-results/calibrated-evaluation.json) includes Brier scores, early samples, paired season-block bootstrap intervals, CFP matched games and all historical seasons. Archived spread prices do not have certified forecast-time capture timestamps; CFP lists are committee outputs, not a public prediction formula.

| Season | Weekly games | New policy | Previous neural blend |
| --- | ---: | ---: | ---: |
| 2020 | 474 | 72.15% | 70.68% |
| 2021 | 585 | 69.40% | 71.11% |
| 2022 | 584 | 69.01% | 70.72% |
| 2023 | 639 | 71.05% | 71.83% |
| 2024 | 658 | 70.82% | 69.15% |
| 2025 | 663 | 68.93% | 71.64% |

## Sensitivity checks

The audit excludes one complete game at a time and refits all features and opponent adjustments with unchanged annual neural weights. It tests eight largest FBS winning margins through Week 6 in each of 2020–2025, plus every 2026 game of Wake Forest, LSU, Oregon and Oregon State. Selection of the active model does not use these audit outcomes.

Across 48 historical extreme-win exclusions, mean absolute change in average-probability rank is **14.88 places**, versus **11.52** previously. Mean absolute full-field probability change is **4.76 points**, versus **5.06**. Full-game exclusions change the record, evidence count, and performance together. Their rank changes are not a pure blowout test, and stronger loss penalties can increase their sensitivity when a win disappears. Probability calibration also affects probability sensitivity; rank changes are invariant to calibration. These selected scenarios are not population accuracy evidence or confidence intervals. A separate score-only test changes margins above 35 to exactly 35 while holding the winner, sample size, venue, opponent and actual play summaries fixed. The entire new probability matrix remains unchanged to 1e-12 in every one of 53 tested cases. This tests the score-feature path rather than a physically complete alternative game.

| Team | Excluded result | Previous average rank | New rank |
| --- | --- | ---: | ---: |
| LSU | LSU 51–10 Clemson | 9 → 13 | 16 → 32 |
| Oregon | Oregon 84–0 Portland State | 19 → 31 | 45 → 56 |
| Oregon State | Oregon State 52–17 Montana | 17 → 18 | 23 → 41 |
| Wake Forest | Wake Forest 57–3 Stanford | 8 → 13 | 19 → 31 |
| LSU | LSU 63–14 McNeese | 9 → 9 | 16 → 28 |
| Oregon State | Oregon State 66–14 San Diego State | 17 → 25 | 23 → 39 |

Previous average-probability ranks may differ slightly from the previous consensus ordering. Full cases and direct loss counterfactuals are in [sensitivity.json](polished-results/sensitivity.json). Neither robustness nor the loss policy guarantees a preferred team’s position.

## 2026 Week 6 rankings

As of 2026-10-11T08:30:00.000Z, through completed games. The full [ranking export](polished-results/2026-week-06-rankings.csv) includes every FBS/FCS team. Oregon State and Oregon retain distinct identities. Average probabilities use the full field; they are not probabilities that a rank is correct.

| Rank | Team | Record |
| ---: | --- | ---: |
| 1 | Notre Dame | 6–0 |
| 2 | Indiana | 6–0 |
| 3 | Georgia | 6–0 |
| 4 | Miami | 5–0 |
| 5 | Alabama | 5–1 |
| 6 | Utah | 5–0 |
| 7 | Texas Tech | 5–0 |
| 8 | Ohio State | 5–1 |
| 9 | UCLA | 5–0 |
| 10 | Houston | 5–1 |
| 11 | James Madison | 6–0 |
| 12 | BYU | 5–0 |
| 13 | Nebraska | 5–1 |
| 14 | Missouri | 5–1 |
| 15 | Arizona | 5–1 |
| 16 | LSU | 4–2 |
| 17 | Northwestern | 4–1 |
| 18 | Liberty | 5–1 |
| 19 | Wake Forest | 5–1 |
| 20 | Texas | 4–1 |
| 21 | Kentucky | 5–1 |
| 22 | Iowa | 5–1 |
| 23 | Oregon State | 4–2 |
| 24 | Lehigh | 6–0 |
| 25 | Mississippi State | 4–1 |

## Reproduction

From the repository root, with the original pinned Python requirements and existing feature caches:

```sh
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python research/season_only/robust/study.py select
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python research/season_only/robust/study.py refit
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python research/season_only/robust/study.py evaluate
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python research/season_only/robust/bounded_study.py select
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python research/season_only/robust/bounded_study.py refit
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python research/season_only/robust/bounded_study.py evaluate
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python research/season_only/robust/capped_features.py
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python research/season_only/robust/capped_study.py select
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python research/season_only/robust/capped_study.py refit
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python research/season_only/robust/capped_study.py evaluate
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python research/season_only/robust/capped_calibrate.py
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python research/season_only/robust/polish.py
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python -c "import sys; sys.path.insert(0, 'research/season_only'); import robust.capped_study as study; from pathlib import Path; study.OUT=Path('research/season_only/robust/polished-results'); study.evaluate()"
npm run neural:export -- --year 2026
npm run compute
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python research/season_only/robust/sensitivity.py
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python research/season_only/robust/report.py
python -m unittest discover -s research/season_only/robust -p test_robust.py -v
npm test
npm run verify
```

Registered protocols, selections, validation predictions and annual models are saved. Existing prospective registrations and forecasts from earlier studies remain unchanged; this model needs subsequent, separately identified prospective results for an independent test. Report code SHA-256: `b30757ab8d492e0fd7b5c206dc769e9f23d4f6405128cd9aaab00dbef8bc9ffe`.
