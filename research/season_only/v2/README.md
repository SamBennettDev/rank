# Four improvements to the season-only neural ranker

Open [REPORT.html](REPORT.html) or [REPORT.pdf](REPORT.pdf). This study extends the [original comparison](../README.md) with all four requested improvements:

1. A shared early-season neural expert, weighted by actual completed-game evidence rather than calendar week.
2. A point-in-time availability importer, current-season player production/continuity, replacement scenarios, and an actual sourced integration pilot.
3. Opponent-adjusted situation and drive features, evidence/uncertainty signals, and three ordered prior games.
4. Three chronological validation periods, same-cutoff timestamped public odds, and immutable prospective forecasts with subsequent-only grading.

All team statistics reset each season. Historical examples teach shared weights. Team/player IDs and names only join records; no identity embedding, conference/division input, poll, recruiting, carried team strength, or live betting input enters a neural model.

The selected context specialist improves Week 4–6 development accuracy from **67.67% to 69.22%** on the same 900 games, but overall accuracy changes from **70.86% to 70.69%**. The rich specialist variant reaches **73.08% versus 70.00%** for moneyline favorites on the 130-game primary timestamped replay, with worse probability scores and no reliable superiority conclusion. The report presents all variants rather than promoting a replay winner after observing outcomes.

## Data and scope

`inputs/context_YEAR.csv` and `players_YEAR.csv` cover 2006–2026, aggregated from the original archived plays. Source hashes are in `results/context-sources.json`. Athlete IDs reconcile text variants; ambiguous identities remain unmatched. Raw source aliases, including quarterback IDs on incomplete passes and sacks, are handled explicitly. Numeric player summaries use only completed current-season games.

The public odds source is pinned to a GitHub commit and normalized into `inputs/timestamped_quotes.csv.gz`. Capture, observation, and availability times must all precede the forecast. Re-ingestion does not refresh an old observation. Same-book sides must share an exact capture/source; one sportsbook gets one vote across vendors. Live/post-kickoff captures, inferred top-ups, stale observations, unknown times, invalid odds, and participant mismatches are excluded. Timestamp claims come from the public collector and are not independently certified bookmaker clocks. Coverage is a small 2026 replay, not a long historical timestamped archive.

Sportsbook identity is case-normalized, including Bet365/bet365. The included raw-capture index pins referenced payload paths to the source Git tree; missing references are excluded. A benchmark-only prospective addendum corrects these two audit findings **before the first registered game**. The original registration, original quotes, and original market code are retained. All model forecasts remain unchanged, and corrected quotes still use the original issuance cutoff. The grader explicitly records which benchmark addendum it used.

The ESPN daily injury snapshot contained stale earlier-season notes and failed the current-season freshness check. It is not treated as usable 2026 availability data. `inputs/availability_events.csv` contains a small curated pilot of 20 events from ten dated public sources, with roster metadata used only to resolve identities. Day-only publication dates become available after that day ends in America/New_York. A pilot selected around known injuries is not representative and cannot establish population accuracy improvement. No complete historical conference-report archive is claimed.

Availability can adjust the **full** and **graph_context** variants. The selected **context** foundation excludes player inputs because the older validation folds did not support those larger variants. Unreported is unknown; unsupported positions or ambiguous joins get no invented numerical impact. Nominal probabilities for probable/questionable/doubtful statuses are scenario assumptions, not a trained medical forecast. Available/out endpoints expose that uncertainty.

## Models and selection

- `rich`: 64 existing score/play features, with the new specialist training.
- `context`: 112 features; adds 40 adjusted situation/drive ratings and eight evidence signals.
- `full`: 152 features; adds 16 player-production/continuity and 24 ordered-history signals.
- `graph_context`: 240 features; combines the previous opponent graph with every new signal.

Each model has global and early experts with three seeds each. Let `n` be the smaller completed-game count: `g = sigmoid((5-n)/1.5)`. The early expert trains with weights `0.1+0.9*g`. Forecast probability is `(1-alpha*g)*global + alpha*g*early`. Historical training examples also receive a four-year half-life. The raw bounded game-evidence gate is independent of clipping standardized inputs.

Selection uses three folds: 2006–2013→2014–2015, 2006–2015→2016–2017, 2006–2017→2018–2019. There are 32 configurations, two experts, three seeds, and three folds: 576 valid final-search fits. The foundation selection balances macro-season overall and early-sample winner accuracy, then log loss. A separately frozen V1/V2 blend check prioritizes macro-season overall accuracy. Both precede reading the new later-season results. Protocol hashes and every configuration’s validation probabilities are saved.

Annual refits use only earlier seasons for 2007–2026. Four selected feature variants × 20 years × six networks produce 480 annual fits. Earlier parser-debugging runs are discarded. This study reused inspected seasons and validation periods; historical results remain retrospective development, not an untouched test. Historical EPA fitting vintages remain an upstream limitation.

## Use saved weights

Use the original pinned requirements and Python 3.12, from the repository root:

```bash
python -m pip install -r research/season_only/requirements.txt
export OPENBLAS_NUM_THREADS=1
export OMP_NUM_THREADS=1
python research/season_only/v2/forecast.py
python research/season_only/v2/forecast.py --home 'Notre Dame' --away Alabama --neutral
python research/season_only/v2/forecast.py --model full --home Florida --away LSU --year 2024 --as-of 2024-11-16T18:00:00Z --game-id 401628420
python research/season_only/v2/forecast.py --model graph_context --field fbs_fcs
```

The `recommended` model applies the saved older-fold V1/V2 policy. Explicit variants use their own specialist mixture. `--as-of` requires an offset and excludes games not completed before that time. `--game-id` restricts matchup-specific availability to the correct game. Rankings average neutral win probabilities against the same modeled FBS/FCS field, then filter the output. These are archived data inputs, not an automatically updating live feed.

## Reproduce the study

The original study’s derived caches are needed for the full experiment; rebuild them using its README when starting fresh. Included compact inputs allow skipping raw downloads. Use a fresh `/tmp/rank-season-only/v2` when changing feature construction; training validation caches are keyed by actual training/validation inputs and model source. Three worker processes are used, so keep BLAS threads at one.

```bash
# Source aggregation; requires the original raw PBP cache.
python research/season_only/v2/prepare_context.py
python research/season_only/v2/build_context.py

# Public quote archive, sourced pilot, and injury freshness audit.
python research/season_only/v2/market.py --public
python research/season_only/v2/curate_availability.py
python research/season_only/v2/availability.py --audit-public

# Choose using older periods, then annually refit and evaluate.
python research/season_only/v2/train_experts.py
python research/season_only/v2/export_validation.py
python research/season_only/v2/blend.py
python research/season_only/v2/rolling.py
python research/season_only/v2/evaluate.py
python research/season_only/v2/availability_pilot.py
python research/season_only/v2/forecast.py --export-rankings

# This creates a one-time, genuinely future registration and refuses overwrite.
python research/season_only/v2/prospective.py issue
python research/season_only/v2/report_v2.py
python -m unittest discover -s research/season_only/v2 -p test_v2.py -v
```

`refresh_players.py` is a targeted cache utility used after canonicalizing the player parser; fresh complete builds do not require it. Fold network checkpoints remain in the derived cache. Published validation probabilities, design metrics, all annual portable weights, source hashes, and game forecasts are committed. Source/parser debugging runs are not mixed into the final valid search.

Reproduction does not recreate an earlier real-world issuance time. The existing prospective registry is immutable; regeneration uses it. New prospective experiments need a separately named registry and must be issued before their games.

## Import public data and grade the registered future cohort

```bash
python research/season_only/v2/market.py --input canonical_quotes.csv
python research/season_only/v2/availability.py --input published_availability.csv
python research/season_only/v2/prospective.py grade --scores sourced_final_scores.csv
```

Quote columns: `game_id,sportsbook,market,side,captured_at,available_at,observed_at,line,odds,source,raw_payload_path,capture_method,is_live`. Times require explicit zones. Moneyline odds are American. Each side must be an actual observation; do not manufacture capture times from game dates or label a retrospective price as a live capture.

Availability columns: `season,team_id,athlete_id,player_name,position,status,published_at,available_at,effective_from,valid_until,game_id,source_url,time_precision`. Supported statuses are `available,probable,questionable,doubtful,out,opt_out`. Empty `game_id` is only appropriate when the source supports a broader interval, such as an explicit season-ending announcement. Publication-day uncertainty must use a conservative upper bound. Imported rows cannot leak into earlier forecasts.

Score columns: `game_id,home_id,away_id,home_points,away_points,completed,observed_at,actual_start,source_url`. The grader requires registered games, reconciled participants, actual kickoff after issuance, and sourced score observations at least six hours after kickoff. It compares V2, frozen V1, and timely market quotes on identical eligible FBS games. Interim summaries are descriptive; grade the entire registered eligible cohort rather than stopping after a favorable subset.
