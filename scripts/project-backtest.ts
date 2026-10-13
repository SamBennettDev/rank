/** Compare final earned-standing forecasts without hindsight-dependent matchups. */
import { writeFileSync } from "node:fs";
import { forecastBatches, kickoff } from "../src/engine/chronology";
import { DEFAULT_SETTINGS } from "../src/engine/defaults";
import { ratedGames } from "../src/engine/evaluation";
import { rateTeams, rankValues, predictMatchup } from "../src/engine/model";
import { projectSeason, type ProjectionMode } from "../src/engine/projection";
import {
  indexedGames,
  scoreStandings,
  winCredit,
} from "../src/engine/standing";
import { sha256Hex } from "../src/engine/hash";
import type { SeasonConfig } from "../src/engine/types";
import { historySeason, HISTORY_REVISION } from "./history";
const args = process.argv.slice(2),
  hi = args.indexOf("--history"),
  ri = args.indexOf("--report"),
  si = args.indexOf("--samples"),
  mi = args.indexOf("--modes");
const range = hi >= 0 ? args[hi + 1] : "2021-2025";
if (!range || !/^\d{4}(-\d{4})?$/.test(range))
  throw new Error("usage: --history YYYY[-YYYY] [--report file] [--samples N]");
const [first, last = first] = range.split("-").map(Number);
if (first! > last! || last! - first! > 40)
  throw new Error("invalid year range");
const config: SeasonConfig = {
  label: "Projection backtest",
  demo: false,
  ...DEFAULT_SETTINGS,
  projectionSamples: si >= 0 ? Number(args[si + 1]) : 256,
};
if (
  !Number.isInteger(config.projectionSamples) ||
  config.projectionSamples < 128 ||
  config.projectionSamples > 8192
)
  throw new Error("invalid sample count");
interface Row {
  year: number;
  week: number;
  cutoff: string;
  inputSha256: string;
  method: string;
  n: number;
  remainingGames: number;
  rankRmse: number;
  rankMae: number;
  rankRangeCoverage: number | null;
  top25Brier: number | null;
}
const rows: Row[] = [];
const modes: ProjectionMode[] =
  mi < 0
    ? ["independent", "correlated", "adaptive"]
    : (args[mi + 1]!.split(",") as ProjectionMode[]);
if (modes.some((m) => !["independent", "correlated", "adaptive"].includes(m)))
  throw new Error("invalid mode");
for (let year = first!; year <= last!; year++)
  if (year !== 2020) {
    const source = await historySeason(year),
      fixed = source.games.filter(
        (g) =>
          g.seasonType === "regular" &&
          !g.conditionalMatchup &&
          g.completed &&
          g.homePoints !== null &&
          g.awayPoints !== null &&
          g.homePoints !== g.awayPoints,
      ),
      teams = source.teams;
    const final = scoreStandings(
        teams.length,
        indexedGames(teams, fixed),
        config,
      ),
      batches = forecastBatches(fixed),
      hash = await sha256Hex(source.raw);
    for (const week of [4, 7, 10]) {
      const batch = batches.find((b) => b.test.some((g) => g.week === week));
      if (!batch) continue;
      const known = indexedGames(teams, batch.train),
        standing = scoreStandings(teams.length, known, config),
        model = rateTeams(teams.length, ratedGames(teams, batch.train), config);
      const future = indexedGames(
        teams,
        fixed.filter((g) => kickoff(g) > Date.parse(batch.cutoff)),
      );
      const expected = standing.scores.slice();
      for (const g of future) {
        const p = predictMatchup(
          model,
          g.home,
          g.away,
          g.neutral,
          config,
        ).homeProbability;
        expected[g.home]! +=
          p *
            winCredit(
              g.away,
              g.neutral ? 0 : 1,
              model.fit,
              model.uncertainty,
              config,
            ) -
          (1 - p);
        expected[g.away]! +=
          (1 - p) *
            winCredit(
              g.home,
              g.neutral ? 0 : -1,
              model.fit,
              model.uncertainty,
              config,
            ) -
          p;
      }
      const baselines = [
        [
          "current standing",
          rankValues(
            Array.from(standing.scores, (v, i) =>
              final.heights[i] === null ? null : v,
            ),
          ),
        ],
        [
          "current predictive strength",
          rankValues(
            Array.from(model.fit.ratings, (v, i) =>
              final.heights[i] === null ? null : v,
            ),
          ),
        ],
        [
          "expected results",
          rankValues(
            Array.from(expected, (v, i) =>
              final.heights[i] === null ? null : v,
            ),
          ),
        ],
      ] as const;
      for (const [method, ranks] of baselines) {
        let n = 0,
          squared = 0,
          absolute = 0;
        teams.forEach((_, i) => {
          const target = final.ranks[i],
            pred = ranks[i];
          if (target == null || pred == null) return;
          n++;
          squared += (pred - target) ** 2;
          absolute += Math.abs(pred - target);
        });
        rows.push({
          year,
          week,
          cutoff: batch.cutoff,
          inputSha256: hash,
          method,
          n,
          remainingGames: future.length,
          rankRmse: Math.sqrt(squared / n),
          rankMae: absolute / n,
          rankRangeCoverage: null,
          top25Brier: null,
        });
      }
      for (const method of modes) {
        const forecast = projectSeason(
          model,
          standing,
          known,
          future,
          config,
          method,
        );
        let n = 0,
          squared = 0,
          absolute = 0,
          coverage = 0,
          brier = 0;
        teams.forEach((_, i) => {
          const target = final.ranks[i],
            p = forecast.projections[i];
          if (target == null || !p) return;
          n++;
          squared += (p.expectedRank - target) ** 2;
          absolute += Math.abs(p.medianRank - target);
          coverage += Number(target >= p.rankLow && target <= p.rankHigh);
          brier += (p.top25Probability - Number(target <= 25)) ** 2;
        });
        const row = {
          year,
          week,
          cutoff: batch.cutoff,
          inputSha256: hash,
          method,
          n,
          remainingGames: future.length,
          rankRmse: Math.sqrt(squared / n),
          rankMae: absolute / n,
          rankRangeCoverage: coverage / n,
          top25Brier: brier / n,
        };
        rows.push(row);
        console.log(
          `${year} week ${week} ${method}: RMSE ${row.rankRmse.toFixed(2)}, coverage ${(100 * row.rankRangeCoverage).toFixed(1)}%`,
        );
      }
    }
  }
function summarize(selected: Row[]) {
  const n = selected.reduce((s, r) => s + r.n, 0);
  return {
    n,
    rankRmse: Math.sqrt(
      selected.reduce((s, r) => s + r.n * r.rankRmse ** 2, 0) / n,
    ),
    rankMae: selected.reduce((s, r) => s + r.n * r.rankMae, 0) / n,
    rankRangeCoverage: selected.every((r) => r.rankRangeCoverage !== null)
      ? selected.reduce((s, r) => s + r.n * r.rankRangeCoverage!, 0) / n
      : null,
    top25Brier: selected.every((r) => r.top25Brier !== null)
      ? selected.reduce((s, r) => s + r.n * r.top25Brier!, 0) / n
      : null,
  };
}
const methods = [...new Set(rows.map((r) => r.method))];
const all = Object.fromEntries(
  methods.map((m) => [m, summarize(rows.filter((r) => r.method === m))]),
);
const report = {
  status:
    last! <= 2019
      ? "training design comparison; primary criterion final-rank RMSE"
      : "development evaluation; these seasons have already informed earlier development",
  sourceRevision: HISTORY_REVISION,
  config,
  target: "final earned-standing rank from nonconditional regular-season games",
  protocol:
    "Monday noon UTC cutoffs at weeks 4, 7 and 10. Only scores available before the cutoff. Bowl/playoff/championship assignments excluded. Actual schedule revisions and announcement times unavailable; known-slate assumption. Adaptive mode simulates augmented margins and re-fits win credit before each calendar week.",
  selected: Object.entries(all)
    .filter(([m]) => ["independent", "correlated", "adaptive"].includes(m))
    .sort((a, b) => a[1].rankRmse - b[1].rankRmse)[0]?.[0],
  all,
  byWeek: Object.fromEntries(
    [4, 7, 10].map((w) => [
      String(w),
      Object.fromEntries(
        methods.map((m) => [
          m,
          summarize(rows.filter((r) => r.week === w && r.method === m)),
        ]),
      ),
    ]),
  ),
  rows,
};
console.log(JSON.stringify(report.all, null, 2));
if (ri >= 0) {
  if (!args[ri + 1]) throw new Error("--report needs a path");
  writeFileSync(args[ri + 1]!, JSON.stringify(report, null, 2) + "\n");
}
