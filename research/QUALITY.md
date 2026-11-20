# Data source and quality-model research (November 2026)

Two questions: can a Node package that mirrors stats.ncaa.org replace or back up the data
source, and is there a better quality algorithm? `research/quality.py` reproduces every
number below.

## 1. A stats.ncaa.org mirror on npm

| Package | What it reads | Status |
|---|---|---|
| [`sportsdataverse`](https://www.npmjs.com/package/sportsdataverse) 4.0.0 (Oct 2026) | ESPN, ncaa.com, stats.ncaa.org scrapers, and SportsDataverse release parquet | Maintained. Its stats.ncaa.org scrapers (`ncaa.getTeamData`, …) are **deprecated**: Akamai answers plain HTTP clients with 403. Its ncaa.com casablanca scoreboard only serves past seasons, and the per-game endpoints 404. |
| [`ncaa-stats`](https://www.npmjs.com/package/ncaa-stats) 2.0.0 (2017) | stats.ncaa.org HTML | Abandoned; same 403 problem; uses the deprecated `request`. |
| `cfb-stats-mcp`, `cfbd`, `cfb-data` | CFBD API / ESPN | Not NCAA data. |

The usable "mirror" is the **`ncaa_mfb_schedule` release in
[sportsdataverse-data](https://github.com/sportsdataverse/sportsdataverse-data/releases/tag/ncaa_mfb_schedule)**.
It is a stats.ncaa.org scrape published as one parquet per season (2013 on), loaded by
`sportsdataverse`'s `cfb.loadNcaaMfbSchedule` or read directly with `hyparquet` +
`hyparquet-compressors` (the files are ZSTD; the repo's `hyparquet` alone can't decode them).

Checked against `data/seasons/2026/games.csv` on 2026-11-20:

- One row per team per game, with the NCAA `contest_id`, the NCAA team-season id, the
  result and score, attendance, and from 2021 on an `espn_game_id` crosswalk to the ids
  this repo uses (CFBD's ids are ESPN's).
- Covers 266 FBS + FCS team schedules. Of 1,418 completed repo games, 1,359 match by
  ESPN id with **0 score disagreements**. Most of the other 59 are in the mirror but have no
  crosswalk id (56 scored rows lack one).
- **It lags.** Its latest scored game was 2026-11-17 while the repo had games through
  2026-11-20, and it has dates but no kickoff times or neutral-site flag. It can't replace the
  hourly CFBD feed, whose kickoffs the snapshot calendar needs.
- Before 2021 there is no crosswalk: opponents are NCAA abbreviations ("@ Western Ky.")
  and need a name map. 2013 was scraped with empty results.

**Verdict:** usable as an *independent audit source* (official NCAA scores to cross-check
CFBD's, matched by ESPN id), not as the primary feed. Note also that this cloud sandbox
blocks the ncaa.com hosts, so the live ncaa.com endpoints could not be probed here; GitHub
Actions would reach them, but stats.ncaa.org still refuses plain clients.

## 2. A better quality algorithm

Quality is meant to measure team strength, so the target is predicting next week's games
(picks and log loss) without giving up season-end agreement on résumé, the official ranking.
Settings were searched on 2014–2019 (about 200 configurations). 2021–2026 had already been
looked at; **2008–2013 had never been used** (that file has FBS games only, so FCS teams
appear just in their FBS games).

| Model | 2014–2019 (search) | 2021–2026 | 2008–2013 (untouched) |
|---|---|---|---|
| **current** (harmonic gap, surprise springs, shrink 0.5) | 70.44% · 0.5637 · 83.07% | 68.97% · 0.5845 · 82.33% | 72.34% · 0.5425 · 85.12% |
| current-pow (gap = margin^0.5 + 1, surprise springs) | 70.74% · 0.5591 · 83.06% | 69.27% · 0.5796 · 82.22% | 72.90% · 0.5384 · 84.93% |
| **springs-pow** (gap = margin^0.7, every spring 1, shrink 0.25) | **71.59% · 0.5458** · 81.89% | **70.11% · 0.5671** · 80.75% | **73.72% · 0.5305** · 84.10% |
| **soft-label** (see below; T 22, bonus 4, shrink 0.03) | 71.61% · 0.5475 · 82.50% | 69.82% · 0.5690 · 81.28% | 73.34% · 0.5339 · 84.38% |

Each cell is quality's next-week picks · log loss · season-end winner-above-loser agreement.
Résumé (the official ranking) barely moves:

| Résumé from… | 2014–2019 picks · final | 2021–2026 | 2008–2013 |
|---|---|---|---|
| current | 68.54% · 83.55% | 67.11% · 82.44% | 70.33% · 85.52% |
| springs-pow | 68.60% · 83.65% | 67.30% · 82.45% | 70.71% · 85.40% |
| soft-label | 68.62% · 83.68% | 67.34% · 82.45% | 70.56% · 85.29% |

(Résumé here uses each model's fitted logistic scale, 0.0059 for current, so it differs
slightly from the published 0.0056 figures.)

### What was learned

1. **Margin curvature is a frontier, not a free lunch.** Within the spring graph, flatter
   diminishing returns (closer to linear margin) predict better; steeper ones (closer to
   win/loss) fit season-end ordering better. Harmonic sits at the win/loss end. Log loss is
   flat from margin^0.7 to margin^0.9; beyond that only agreement falls.
2. **The surprise weighting is not pulling its weight.** With a gentler gap, blowouts of weak
   teams no longer drag the winner down, and dropping the reweighting (every spring 1) scores
   as well or better. Quality becomes one linear solve, with no 200-round loop.
3. **Résumé is robust to the quality model.** It is driven mostly by wins and losses, so quality
   can be tuned for strength (about +1 pt of next-week picks and 0.012–0.018 better log loss
   in every period) while the official ranking's accuracy holds or improves slightly.
4. **Soft-label Bradley–Terry** sits on a slightly better frontier on the search seasons
   (same picks as springs-pow with 0.6 pt more season-end agreement) but not out of sample.
   Each game is a soft vote that the winner is better, y = σ((margin + 4)/22): a 1-point
   win is a 56% vote, 14 points 70%, 35 points 85%. Strengths minimise
   Σ cross-entropy(y, σ(s_w − s_l)) + ½·0.03·Σ s², by Newton steps that are each a
   Cholesky solve. A satisfied vote stops pulling, which is what the surprise weighting aims
   at, and quality is a probability directly.
5. Home field (estimated jointly) improves venue-aware predictions (72.2% on 2014–2019) but
   not the ranking order. Not recommended, since the project excludes it.

### Adopted (`quality-springs-2`)

The engine now uses springs-pow with exponent 0.75 instead of 0.7, because
margin^0.75 = √margin·√√margin keeps the engine to + − × / and √. Exponents 0.7–0.9 score
alike. Gap = 100 × margin^0.75 (with equal springs the solve is linear, so the gap's scale
only rescales strengths); shrink 0.25; qualityScale 0.002 (fitted: 0.00197).

| margin^0.75, shrink 0.25 | quality pick · log loss · final | résumé pick · final |
|---|---|---|
| 2014–2019 | 71.66% · 0.5453 · 81.54% | 68.52% · 83.59% |
| 2021–2026 | 70.01% · 0.5664 · 80.55% | 67.19% · 82.46% |
| 2008–2013 | 73.46% · 0.5302 · 83.93% | 70.65% · 85.40% |

(Résumé on the first two rows uses the published 0.002 scale, from `research/springs.py`;
the 2008–2013 row uses the fitted scale, from `research/quality.py`.)

### Recommendation (as written before adoption)

**springs-pow** is the smallest change that improves quality in every period. Keep the
spring graph; replace `100 × harmonic(margin)` with `325.2 × (margin / 14)^0.7`; set every
spring to 1; use shrink 0.25 and refit `qualityScale` (≈0.0045). The trade is about 1.0–1.6 pts
of season-end agreement on the *quality* board. If that matters more than log loss,
`soft-label`, or springs-pow with margin^0.6, gives some back. `margin^0.7` needs `Math.pow`; for
the engine's bit-exact `+ − × /` rule it can be precomputed as a table of margins 1–100
(exact decimals published with the spec), or replaced by the capped-linear gap `min(m, 35)`,
which scores within noise (0.5481 log loss on 2014–2019).

Reproduce:

```sh
python3 research/quality.py 2014-2019
python3 research/quality.py 2021-2026
python3 research/quality.py 2008-2013
python3 research/quality.py 2014-2019 '{"model": "springs", "gap": "pow", "a": 0.8, "lam": 0.25, "k": "none"}'
```

## 3. Efficiency test: does play-by-play improve quality? (November 2026)

Each game with play-by-play on both sides gets the target gap
`(1 − α) × gap(score margin) + α × gap(efficiency margin)`, the same signed `x^0.75` shape;
games without it keep the score gap. The efficiency margins come from `fetch-plays`' team-game
rows (scrimmage EPA with garbage time removed, net special-teams EPA, success rate), built for
history with `npm run fetch-plays -- <year> --out /tmp/rank-backtest/plays_<year>.csv`. The
play-by-play release starts in 2014 and before 2022 covers only games with an FBS team, so
there is no untouched holdout; settings were picked on 2014–2019 and checked on 2022–2026,
where FCS games are covered too.

| Blend (α) | 2014–2019 pick · log loss · final | 2022–2026 pick · log loss · final |
|---|---|---|
| published (score only) | 71.66% · 0.5453 · 81.54% | 70.04% · 0.5658 · 80.76% |
| EPA + special teams, 0.25 | 71.62% · 0.5461 · 81.48% | 70.32% · 0.5663 · 80.66% |
| EPA + special teams, 0.5 | 71.24% · 0.5484 · 81.45% | 69.88% · 0.5706 · 80.20% |
| EPA + special teams, 1.0 (EPA replaces score) | 70.91% · 0.5575 · 81.11% | 68.32% · 0.5909 · 77.75% |
| EPA per snap + special teams, 0.5 | 71.68% · 0.5478 · 81.13% | 70.01% · 0.5691 · 80.06% |
| **success rate × 150, 0.25** | **71.86% · 0.5429** · 81.22% | **70.54% · 0.5611** · 80.17% |
| success rate × 100, 0.55 | 71.81% · 0.5456 · 80.92% | 70.72% · 0.5618 · 79.82% |

(`success rate × 150` turns a 10-point success-rate edge into a 15-point margin. Résumé moves by
under 0.15 pts in every row.)

- **EPA does not help.** Scaled like points (margin ≈ 0.93 × EPA + 4, correlation 0.79), it
  still predicts worse than the scoreboard, and the more weight it gets the worse; replacing
  the score with it costs 0.75–1.7 pts of picks. The final score already contains the EPA plus
  what the model misses (returns, real turnover value), and the public EPA model is noisy.
- **Success rate helps a little and consistently**: +0.2 and +0.5 pts of picks, log loss down
  0.0024 and 0.0047, for 0.3–0.6 pts of quality's season-end agreement. It is a different
  signal from the score, the share of snaps that kept the offense on schedule.
- **Not adopted yet.** The gain is a fifth of the margin-curve change's, and it would make
  quality depend on a second, later-arriving data source with uneven coverage (most FCS games
  only from 2022, none for the NFL), and make a game's spring no longer readable from its
  score alone. It is worth adopting if those costs are acceptable.

Reproduce: `python3 research/quality.py 2022-2026 published '{"model": "springs", "gap": "pow", "a": 0.75, "k": "none", "lam": 0.25, "eff": "sr", "srScale": 150, "alpha": 0.25}'`
(after building the history play files as above).
