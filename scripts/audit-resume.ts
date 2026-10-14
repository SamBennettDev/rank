import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Ranking } from "../src/engine/types";
import { toCsv } from "../src/engine/csv";

const year = process.argv[2] ?? "2026";
if (!/^\d{4}$/.test(year)) throw new Error("season must be a year");
const root = resolve(import.meta.dirname, "..");
const index = JSON.parse(
  readFileSync(resolve(root, "data/index.json"), "utf8"),
);
const season = index.seasons.find((s: { season: string }) => s.season === year);
if (!season) throw new Error("unknown season");
const snap = season.snapshots.at(-1).id;
const ranking: Ranking = JSON.parse(
  readFileSync(resolve(root, `data/rankings/${year}/${snap}.json`), "utf8"),
);
if (!ranking.manifest.resume) throw new Error("snapshot has no resume model");
const teams = ranking.teams.filter((t) => t.resume);
let maxLedgerDifference = 0,
  maxExpectedWinDifference = 0;
for (const t of teams) {
  const r = t.resume!;
  maxLedgerDifference = Math.max(
    maxLedgerDifference,
    Math.abs(t.height! - r.games.reduce((s, g) => s + g.value, 0)),
  );
  maxExpectedWinDifference = Math.max(
    maxExpectedWinDifference,
    Math.abs(t.height! - (t.wins - r.expectedWins)),
  );
  if (r.games.length !== t.wins + t.losses)
    throw new Error(`incomplete resume receipt: ${t.id}`);
}
if (maxLedgerDifference > 1e-6 || maxExpectedWinDifference > 1e-6)
  throw new Error("resume ledger does not reconcile");
const out = resolve(root, "research/resume");
mkdirSync(out, { recursive: true });
writeFileSync(
  resolve(out, `week6-${year}-rankings.csv`),
  toCsv(
    [
      "rank",
      "team_id",
      "team",
      "division",
      "wins",
      "losses",
      "wins_above_benchmark",
      "benchmark_expected_wins",
      "benchmark_record_probability",
      "schedule_difficulty",
      "previous_rank",
      "previous_score",
    ],
    teams.map((t) => [
      t.rank,
      t.id,
      t.school,
      t.classification,
      t.wins,
      t.losses,
      t.height,
      t.resume!.expectedWins,
      t.resume!.recordProbability,
      t.resume!.scheduleDifficulty,
      t.earnedRank ?? null,
      t.earnedHeight ?? null,
    ]),
  ),
);
const audit = {
  season: year,
  snapshot: ranking.snapshot,
  settings: ranking.manifest.resume,
  counts: ranking.manifest.counts,
  teams: teams.length,
  maxLedgerDifference,
  maxExpectedWinDifference,
  inputs: {
    teamsSha256: ranking.manifest.teamsSha256,
    gamesSha256: ranking.manifest.gamesSha256,
  },
  top25: teams
    .slice(0, 25)
    .map((t) => ({
      id: t.id,
      team: t.school,
      rank: t.rank,
      record: `${t.wins}-${t.losses}`,
      score: t.height,
      previousRank: t.earnedRank,
      expectedWins: t.resume!.expectedWins,
      recordProbability: t.resume!.recordProbability,
      games: t.resume!.games,
    })),
};
writeFileSync(
  resolve(out, `audit-${year}.json`),
  JSON.stringify(audit, null, 2) + "\n",
);
console.log(
  `resume audit: ${teams.length} complete ledgers; maximum error ${maxLedgerDifference.toExponential(2)}`,
);
