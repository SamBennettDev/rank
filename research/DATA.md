# Free in-depth data for FBS and FCS games (November 2026)

What each free source covers for 2026, checked against `data/seasons/2026/games.csv`
(completed games: 635 FBS–FBS, 123 FBS–FCS, 592 FCS–FCS, 68 FCS–lower division).

| Source (all free) | FBS–FBS | FBS–FCS | FCS–FCS | Latest game (on 2026-11-20) | What's in it |
|---|---|---|---|---|---|
| **sportsdataverse `ncaa_mfb_*` releases** (stats.ncaa.org scrape, 2013 on) | 604 | 118 | **578** | Nov 18 | Play-by-play with passer/rusher/receiver (95–100%), tacklers (90% of runs), formation, pass depth and direction, run direction, scrambles; player box scores with tackles (solo/assisted), sacks, PBUs, INTs; rosters with position, class, height, weight, games played and started; team stats. ESPN game id on every game. No EPA, and no shared player id across files (names + jersey within a team). |
| sportsdataverse `cfbfastR_cfb_pbp` (in use: `fetch-plays`) | all | all | most (2022 on) | Nov 15 | ESPN play-by-play with cfbfastR EPA, success, win probability, ESPN athlete ids and positions. Weekly. Starts in 2014; before 2022 only games with an FBS team. |
| sportsdataverse `espn_cfb_*` releases | 635 | 123 | **0** | Nov 20 | Player box (tackles, TFL, sacks, hurries, QBR), play participants, game rosters, usage (target share, opportunities, tackle share), drives. Daily, FBS games only. |
| ESPN site API (`site.api.espn.com`, no key) | yes | yes | to be tested | live | Scoreboard, game summary (box score, plays, drives), rosters. Undocumented and can change. Not reachable from this sandbox; reachable from GitHub Actions. |
| CFBD API (current source of scores) | yes | yes | partial | live | Everything, but the free key is about 1,000 calls a month (CFBD's tiers page also lists a 3,000-call academic tier with a .edu email). Enough for scores; too small for play or player depth across ~1,400 games a season. |
| stats.ncaa.org, ncaa.com | — | — | — | — | stats.ncaa.org refuses plain HTTP clients (Akamai 403); ncaa.com's game JSON moved behind a GraphQL backend. The `ncaa_mfb_*` releases are the practical way to get this data. |

Not available free from any source: per-player snap counts, offensive-line or coverage
charting, pressure data beyond ESPN's FBS-only "hurries", and grades.

## Recommendation

**Adopted (November 2026):** the site now uses the `ncaa_mfb_*` releases exclusively for college
data, with our own expected-points model (`data/models/ep.json`); see `docs/METHODOLOGY.md`.

- **Player boards and anything that must treat FBS and FCS alike: the `ncaa_mfb_*` releases.**
  It is the only free source with FCS–FCS games at play and player depth, it is official NCAA
  stat-crew data, and its ESPN game ids join it to `games.csv`. EPA has to come from our own
  expected-points model fitted on its down/distance/yard line, or the boards use model-free
  measures (success rate, yards per play, first downs, tackles and havoc).
- **Keep CFBD for scores and kickoffs**, which the snapshot calendar needs within the hour.
- **Keep cfbfastR play-by-play for team EPA** (unit ratings), and use the `espn_cfb_*` files
  only as FBS-only extras (hurries, QBR).
- **ESPN's live API** could close the two-day lag later, from the GitHub Actions workflow.

Files are parquet with ZSTD compression: reading them in Node needs `hyparquet-compressors`
next to `hyparquet`. URL pattern:
`https://github.com/sportsdataverse/sportsdataverse-data/releases/download/<tag>/<tag>_<year>.parquet`
(e.g. `ncaa_mfb_pbp/ncaa_mfb_pbp_2026.parquet`).

## Round 2: what works from GitHub Actions (November 22, 2026)

The stats.ncaa mirror stalled after November 17: its own scraper of stats.ncaa.org has been
timing out daily (its raw-capture logs show `captured: 0` and `EXIT=1`), so no games after
November 17 reached the published files. Everything below was tested from a GitHub Actions
runner, where the hourly update runs.

| Source | From Actions | Last Saturday (Nov 21, "week 12") | What it gives | Limits |
|---|---|---|---|---|
| **sportsdataverse ESPN-based releases** (`cfb_schedules`, `cfbfastR_cfb_pbp`, `espn_cfb_rosters`) | ✓ (GitHub downloads) | schedule refreshed Nov 22 14:20 UTC; plays for 50 of 56 FCS–FCS and 43 of 47 FBS games by Saturday night | scores, kickoffs, sites and divisions for every division; structured plays with ESPN player ids and positions (642 of 650 FCS–FCS and 675 of 695 FBS games this season); bios for all 138 FBS and 99 FCS teams | none; refreshed about daily |
| **CFBD API** (repository key) | ✓ | all 64 FCS games with plays (11,168) and player box scores | games, structured plays (players only in text), full defensive box scores for FBS and FCS (TOT, SOLO, SACKS, TFL, PD, QB HUR) with ESPN athlete ids, rosters (13,915 FCS players) | free tier 1,000 calls a month, shared with CBB (629 left on Nov 22) |
| **ncaa.com** (`sdataprod.ncaa.com` persisted GraphQL queries, as used by henrygd/ncaa-api) | ✓ | 64 of 64 FCS final; box score and play-by-play for 40 of 40 sampled | scores; play-by-play as text only ("1 and 10 at 35"); box scores with names and numbers, no positions or ids | unofficial internal API |
| **ESPN site API** (`site.api.espn.com`) | ✗ 403 on every request | — | — | blocks cloud/datacenter traffic |
| **stats.ncaa.org** | ✗ (Akamai) | — | — | blocks automated clients |

### Recommendation

1. **Primary, no key: the sportsdataverse ESPN-based releases.** Scores and schedule from
   `cfb_schedules`, plays from `cfbfastR_cfb_pbp` (EPA recomputed with our own model, whose inputs
   are down, distance and yards to goal), bios from `espn_cfb_rosters`. ESPN ids are already this
   site's team ids, so logos work without the crosswalk, and players get stable ids instead of
   name matching.
2. **CFBD for what the releases lack, within the free tier:** defensive box scores for FCS games
   (`/games/players?classification=fcs`, one call per week) and FBS, bios for FCS teams missing from
   ESPN rosters (`/roster?classification=fcs`, weekly), and scores if the schedule release lags
   (`/games`). About 4 calls a refresh, 2–3 refreshes a day: well under 1,000 a month.
3. **ncaa.com as an emergency fallback for scores only.**
4. **Keep the stats.ncaa mirror's history** for fitting the expected-points model (2014–2025, fixed).
