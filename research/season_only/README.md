# Season-only college football research

Historical supervised learning is compatible with equal preseason starts: learn shared weights from older seasons’ **pregame current-season features plus eventual winner labels**, then apply those weights to the forecast season’s statistics. No team identity, conference, division, recruiting, poll, preseason rating, or carried team strength enters a neural feature vector.

Open [REPORT.html](REPORT.html) for the interactive comparison and every Week 6 ranking, [REPORT.pdf](REPORT.pdf) for the printable report, and [METHODS.html](METHODS.html) for mechanisms, formulas, and all features.

The [four-improvement follow-up](v2/README.md) adds early-season experts, availability ingestion and a sourced pilot, richer situation/drive/player features, multi-period validation, timestamp-matched public odds, and an immutable prospective registration. Its [report](v2/REPORT.html) compares the new variants with this original baseline.

The selected neural blend achieved **70.86%** winner accuracy on 3,603 FBS games in 2020–2025. On the same 3,594 games with archived spreads, it achieved **70.90% versus 72.33%** for spread favorites. On the same 3,025 moneyline games, it achieved **70.35% versus 71.14%** for market favorites. This research does **not** establish a general market edge. It does outperform the CFP higher-ranked-team pick on the matched committee-ranking games. Details, uncertainty, coverage, and differing information dates are in the report.

The [Week 6 Wake Forest/Oregon diagnosis](production/2026-week-06-diagnosis.md) checks team identity, reproduces all published neural scores and ranks, compares simpler methods, and refits the features and ordering after individual game exclusions. It documents sensitivity without retraining or changing the standings.

## Saved work

- 24 historical input seasons, 2002–2025; 2026 through completed Week 6.
- 151 equal-start classical configurations across 22 families.
- 264 neural configurations across four rounds, three seeds each, plus three longer-optimization fits: 795 experimental network fits.
- 240 annual network refits for 2007–2026: 1,035 experimental and annual fits total.
- Logistic regression, boosted trees, randomized trees, archived CFBD pregame Elo, archived sportsbook favorites, and actual CFP lists as comparisons.
- Source hashes, compact inputs, all neural checkpoints, annual weights, selections, per-game probabilities, per-season metrics, all-configuration ranking exports, and 791 future-game forecasts from the fixed Week 6 snapshot.

The recommended model is 75% rich-neural probability and 25% graph-neural probability, chosen on 2018–2019. Historical-market supervision did not improve the selected blend; its selected weight is zero. Rich ensemble and market-distilled ensemble outputs are therefore aliases, not additional independent learners.

## Use the trained models

From the repository root with Python 3.12:

```bash
python -m pip install -r research/season_only/requirements.txt
export OPENBLAS_NUM_THREADS=1
export OMP_NUM_THREADS=1
python research/season_only/predict.py --year 2026 --week 6
python research/season_only/predict.py --home 'Notre Dame' --away Alabama --neutral
python research/season_only/predict.py --model rich --field fbs_fcs
python research/season_only/predict.py --future
```

Available model names: `recommended`, `basic`, `rich`, `graph`, `market_distilled`. Team names or numeric IDs resolve joins only. No betting-price input is accepted by inference. Saved annual checkpoints support 2007–2026; changing weeks recomputes features using only games completed through that regular-season week. These are archived snapshots, not a live data feed.

The common reference field for neural rankings is all modeled FBS/FCS teams. `--field fbs` only filters the resulting output; division does not affect the neural model. Rank scores average neutral-site win probabilities against that common field. Scores from different algorithms have different units.

The production site converts these same neural probabilities into a weighted head-to-head consensus order. Its [Week 6 ordering](production/2026-week-06-rankings.csv), [35,245 neutral matchup probabilities](production/2026-week-06-head-to-head.csv), [ordering audit](production/2026-week-06-audit.json), and [verification evidence](production/verification.json) are saved separately. The original research tables retain their average-probability ordering.

## Reproduce

The compact `inputs/` files and original repository `data/seasons/2026/` suffice for rebuilding features without downloading raw plays. Raw caches and derived feature matrices live under `/tmp/rank-season-only`, outside Git. For a fresh reproduction, use a fresh cache: `build.py` reuses existing yearly feature files, so remove stale derived files when changing inputs or feature code. Keep BLAS threads at one for stable CPU usage; scripts use three worker processes.

Run in this order from the repository root:

```bash
# Optional: retrieve/verify source data instead of using included compact inputs.
python research/season_only/prepare.py
python research/season_only/odds.py
python research/season_only/rich_prepare.py

# First design round and annual basic/statistical fits.
python research/season_only/build.py
python research/season_only/train.py
python research/season_only/rolling.py
python research/season_only/benchmark.py
python research/season_only/current_market.py
python research/season_only/candidate_audit.py

# Rich, graph, and historical-market-label rounds, in this order.
python research/season_only/rich_build.py
python research/season_only/rich_train.py
python research/season_only/rich_evaluate.py
python research/season_only/graph_build.py
python research/season_only/graph_train.py
python research/season_only/graph_evaluate.py
python research/season_only/teacher_train.py
python research/season_only/teacher_polish.py
python research/season_only/teacher_evaluate.py
python research/season_only/extended_audit.py

# Exports and verification.
python research/season_only/predict.py --future
python research/season_only/report.py
python -m unittest discover -s research/season_only -p test_integrity.py -v
```

Retraining all experiments is compute intensive. Viewing reports, using the saved inference tool, and regenerating reports do not require retraining. `fix_keener.py` documents a one-time correction made during this study; fresh feature builds already contain that correction and should not run it.

`benchmark.py` regenerates the basic ranking table. The rich, graph, and teacher evaluation scripts append their own rankings, in order. When rebuilding that table, run all subsequent evaluators before regenerating the report. The CFP input tables are saved from official published tables with source URLs and explicitly recorded corrections; they do not need a scraper rerun.

## Evaluation protocol and limits

Weekly forecasts start in Week 4 at Monday 12:00 UTC. Only games with kickoff plus six hours before the snapshot contribute features. Postseason games use actual dates. Annual learned weights, normalization scales, and calibrations use earlier seasons only. Historical Week 6 tests freeze features for all remaining games. The 2026 snapshot is October 11, 08:30 UTC and includes 748 modeled completed games, 138 FBS teams, and 266 total modeled teams. Games against lower divisions outside that field do not affect the strength fit.

Round 1 trains on 2002–2013 and validates on 2014–2019; subsequent rounds train on 2006–2017 and validate on 2018–2019. Earlier seasons are retrospective architecture hindcasts. Later seasons were inspected in prior repository work and while exploring these rounds, so **2020–2025 is development evidence, not an untouched holdout**. Reusing validation while testing many ideas can overfit model selection. Best configurations in the post-selection audit are labeled exploratory and do not change the selected production blend.

Prices are benchmark inputs or historical supplemental *labels*, never neural features. Same-book paired American moneylines are de-vigged before aggregation. Quote/schedule side reversals are corrected. No reliable quote-capture timestamp exists, so these cannot be certified closing lines or equal-information-time betting tests. Raw EPA/success labels may be retrospectively fitted by their upstream source; a strict historical data-vintage recreation is unavailable. The bootstrap resamples seasons, with only five or six later-season blocks.

The CFP is a committee rather than a public numerical algorithm. Its benchmark picks the higher-ranked team from a list available before kickoff, and omits games between two unranked teams. No official Week 6 2026 CFP list exists; the first release is November 3. The implemented classical methods are explicit equal-start variants, including a margin-based LRMC variant; this study does not establish superiority over every public or proprietary football model.

The website now runs the saved recommended six-network blend through `src/engine/neural.ts`. `scripts/export-neural.py` exports causal numeric snapshots and weights into `data/seasons/<year>/neural.json`. The original research ranking tables retain their average round-robin ordering. The production site additionally improves a weighted head-to-head consensus order, so individual positions can differ while the underlying win probabilities remain the same. Its arbitrary-team comparison tool and scheduled forecasts use those same probabilities. See the root methodology for refresh commands, input hashes and ordering diagnostics.
