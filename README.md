# Rank

College football rankings from a **raw graph of current-season results**. Each team is a node; each completed, non-tied game is an equal one-sided spring that pushes its winner above its loser. Website: https://rank.sam-bennett.dev.

Every spring wants a one-unit winner–loser gap. It pushes the winner up and the loser down while compressed, then stops pushing once separated. All nodes start at zero. Simultaneous relaxation settles the forces, each connected group is centered at zero, and heights determine the standing. Equal published heights share a rank.

Circular results cannot all be ordered perfectly. They settle into the lowest total squared compression, which can leave a winner below its loser. The graph shows every game, with arrows from loser to winner and compressed springs highlighted. Supporting opponents participate equally; only configured FBS/FCS teams receive published ranks. Disconnected groups cannot be compared from their games and remain provisional.

Only winners and losers affect the calculation. Score margin, venue, polls, previous seasons, division strength and neural estimates are unused. There is no extra loss deduction or win credit: each result acts through its spring. This method is a results graph, with no calibrated matchup probabilities or claimed betting-market advantage.

See the [methodology](docs/METHODOLOGY.md), [Week 6 report and full rankings](research/springs/2026/REPORT.md), and [six-snapshot equilibrium audit](research/springs/2026/audit.json). The previous [neural research](research/season_only/robust/REPORT.md) and [neural methodology](docs/NEURAL_V2.md) remain archived; they do not drive the active ranking.

## Run and verify

Requires Node 22+.

```sh
npm ci
npm run dev
npm run typecheck
npm test
npm run compute
npm run verify
npm run audit-springs -- 2026
npm run build
```

The browser and Node use the same engine. The Method page can rebuild all published snapshots and compare their exact bytes. Tests cover spring forces, chains, cycles, repeated meetings, disconnected components, equal starts, identifier independence, causal cutoffs and record reconciliation.

## Data

```text
data/seasons/<year>/teams.csv         names, unique IDs and publication scope
data/seasons/<year>/games.csv         results and dated schedule
data/seasons/<year>/config.json       spring method and ranked classifications
data/rankings/<year>/<snapshot>.json  heights, ranks, records and one spring per game
data/index.json                      available seasons and snapshots
research/springs/<year>/              generated report, CSV and equilibrium audit
```

A snapshot counts completed non-tied games whose assumed score availability (kickoff + six hours) is before its cutoff. All actual opponents in the supplied game file join the graph, including opponents outside the published field. Their nodes start at zero, with no division bonus. The supplied schedule determines the available evidence; no unprovided games are inferred. Tied games have no winner edge and are reported separately. Unplayed teams stay unranked.

`manifest.springs` records normalization, convergence, energy and conflicts. `springs[]` records each game's endpoints, height gap, compression and energy. `height` is an actual graph position. Legacy schema fields for predictions, credits and projections are empty/inactive. Historical play summaries and saved neural bundles remain available for archived research but are not read by the spring pipeline.

## Update results

Fetch public CollegeFootballData results with its free API key, then rebuild:

```sh
CFBD_API_KEY=... npm run fetch -- 2026
npm run compute
npm run verify
npm run audit-springs -- 2026
```

Commit the changed data. The **Update data** GitHub workflow fetches results and rebuilds the graph; no Python training, play data or model export is required. New seasons default to the spring method. Deployment uses the existing GitHub Pages workflow and domain configuration.

## Layout

- `src/engine/springs.ts`: the pure winner/loser spring solver.
- `src/engine/season.ts`: causal snapshots, records, normalization and publication.
- `web/`: graph, standings, team pages and browser verification.
- `scripts/`: public data fetching, computation and audits; older research tools remain available.
- `tests/`: spring math and integration, plus archived prediction-model tests.
- `research/`: current spring audits and previous research, explicitly separated.

MIT licensed. Logos load from ESPN by unique team ID.
