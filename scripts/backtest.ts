/** Forecasts at real calendar cutoffs, including earlier postseason rounds. */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseConfig, parseGames, parseTeams } from "../src/engine/data";
import { DEFAULT_SETTINGS } from "../src/engine/defaults";
import {
  evaluateSeason,
  forecastMetrics,
  type ForecastOutcome,
} from "../src/engine/evaluation";
import { sha256Hex } from "../src/engine/hash";
import type { SeasonConfig } from "../src/engine/types";
import { historySeason, HISTORY_REVISION } from "./history";
import { DATA_DIR } from "./lib";

const args = process.argv.slice(2),
  hi = args.indexOf("--history"),
  ri = args.indexOf("--report");
const config: SeasonConfig = {
  label: "Backtest",
  demo: false,
  ...DEFAULT_SETTINGS,
};
const runs = [];
if (hi >= 0) {
  const range = args[hi + 1] ?? "";
  if (!/^\d{4}(-\d{4})?$/.test(range))
    throw new Error("usage: --history YYYY[-YYYY]");
  const [first, last = first] = range.split("-").map(Number);
  if (first! > last! || last! - first! > 40)
    throw new Error("invalid history range");
  for (let year = first!; year <= last!; year++)
    if (year !== 2020) {
      const source = await historySeason(year);
      runs.push({
        season: String(year),
        ...source,
        config,
        sha256: await sha256Hex(source.raw),
      });
    }
}
if (hi < 0 || args.includes("--include-repo"))
  for (const season of readdirSync(join(DATA_DIR, "seasons")).sort()) {
    if (runs.some((r) => r.season === season)) continue;
    const root = join(DATA_DIR, "seasons", season),
      gameFile = join(root, "games.csv");
    if (!existsSync(gameFile)) continue;
    const raw = readFileSync(gameFile, "utf8"),
      cfg = parseConfig(readFileSync(join(root, "config.json"), "utf8"));
    runs.push({
      season,
      teams: parseTeams(readFileSync(join(root, "teams.csv"), "utf8"))
        .filter((t) =>
          [
            ...cfg.classifications,
            ...(cfg.opponentClassifications ?? []),
          ].includes(t.classification),
        )
        .sort((a, b) => a.id - b.id),
      games: parseGames(raw),
      config: cfg,
      sha256: await sha256Hex(raw),
    });
  }
const outcomes: ForecastOutcome[] = [],
  seasons = [];
for (const run of runs) {
  const current = evaluateSeason(run.teams, run.games, run.config);
  outcomes.push(...current);
  const metrics = forecastMetrics(current);
  seasons.push({
    season: run.season,
    inputSha256: run.sha256,
    config: run.config,
    metrics,
  });
  console.log(
    `${run.season}: ${metrics.n} games, ${((metrics.accuracy ?? 0) * 100).toFixed(2)}% accuracy, Brier ${metrics.brier?.toFixed(4)}, log loss ${metrics.logLoss?.toFixed(4)}`,
  );
}
const report = {
  protocol:
    "Monday 12:00 UTC calendar cutoffs; only scores from kickoffs at least six hours earlier; predictions use strength, home field and conditional uncertainty",
  status:
    "development evaluation; these seasons have been inspected and are not an untouched holdout",
  sourceRevision: HISTORY_REVISION,
  calibrationIds: [...new Set(runs.map((r) => r.config.calibrationId))],
  seasons,
  all: forecastMetrics(outcomes),
  fbs: forecastMetrics(outcomes.filter((o) => o.fbs)),
  provisional: forecastMetrics(outcomes.filter((o) => o.provisional)),
  established: forecastMetrics(outcomes.filter((o) => !o.provisional)),
  ...(args.includes("--summary") ? {} : { outcomes }),
};
console.log(
  `All: ${(100 * (report.all.accuracy ?? 0)).toFixed(2)}% of ${report.all.n}; Brier ${report.all.brier?.toFixed(4)}; log loss ${report.all.logLoss?.toFixed(4)}`,
);
console.log(
  `FBS vs FBS: ${(100 * (report.fbs.accuracy ?? 0)).toFixed(2)}% of ${report.fbs.n}`,
);
if (ri >= 0) {
  if (!args[ri + 1]) throw new Error("--report requires a path");
  writeFileSync(args[ri + 1]!, JSON.stringify(report, null, 2) + "\n");
}
