/** Compare v1/v2 on identical current inputs; these examples never select settings. */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { strict as assert } from "node:assert";
import { computeSeason } from "../src/engine/season";
import { round6 } from "../src/engine/model";
import type { Ranking } from "../src/engine/types";
import { DATA_DIR } from "./lib";

const season = process.argv[2] ?? "2026";
const dir = join(DATA_DIR, "seasons", season);
const read = (file: string) => readFileSync(join(dir, file), "utf8");
const config = JSON.parse(read("config.json"));
const input = {
  season,
  teamsCsv: read("teams.csv"),
  gamesCsv: read("games.csv"),
};
const legacy = await computeSeason({
  ...input,
  configJson: JSON.stringify({
    ...config,
    algorithmVersion: "earned-standing-1",
    classifications: ["fbs", "fcs"],
    winQuality: undefined,
    resume: undefined,
    calibrationId: "calendar-2014-2019-v1",
  }),
});
const snapshot = legacy.files.at(-1)!;
const before = JSON.parse(snapshot.json) as Ranking;
const published = JSON.parse(
  readFileSync(
    join(DATA_DIR, "rankings", season, `${snapshot.id}.json`),
    "utf8",
  ),
) as Ranking;
// v3 publishes the resume while retaining exactly the v2 points being audited.
const after: Ranking = {
  ...published,
  teams: published.teams
    .map((t) =>
      published.manifest.resume
        ? { ...t, height: t.earnedHeight ?? null, rank: t.earnedRank ?? null }
        : t,
    )
    .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.id - b.id),
};
const receipts = new Map(before.credits.map((c) => [c.gameId, c]));
const all = new Map(
  [...after.teams, ...(after.opponents ?? [])].map((t) => [t.id, t]),
);
for (const t of after.teams) {
  const wins = after.credits.filter((c) => c.winner === t.id);
  const losses = after.credits.filter((c) => c.loser === t.id);
  assert.equal(t.wins, wins.length);
  assert.equal(t.losses, losses.length);
  assert.equal(
    t.height,
    wins.length || losses.length
      ? round6(wins.reduce((s, c) => s + c.value, 0) - losses.length)
      : null,
  );
}
const examples = [
  "James Madison",
  "Tarleton State",
  "Lehigh",
  "Stephen F. Austin",
].map((school) => {
  const a = before.teams.find((t) => t.school === school)!,
    b = after.teams.find((t) => t.school === school)!;
  return {
    school,
    classification: b.classification,
    before: { rank: a.rank, score: a.height },
    after: { rank: b.rank, score: b.height },
    record: { wins: b.wins, losses: b.losses },
    wins: after.credits
      .filter((c) => c.winner === b.id)
      .map((c) => ({
        gameId: c.gameId,
        opponent: all.get(c.loser)?.school,
        cutoff: c.cutoff,
        oldPoints: receipts.get(c.gameId)?.value ?? null,
        newPoints: c.value,
        oldProbability: receipts.get(c.gameId)?.value ?? null,
        newProbability: c.quality?.probability ?? null,
        opponentGames: c.quality?.opponentGames ?? null,
        unmodeled: c.unmodeled ?? false,
      })),
  };
});
const restoredLosses = after.credits
  .filter((c) => c.unmodeled && after.teams.some((t) => t.id === c.loser))
  .map((c) => ({
    gameId: c.gameId,
    team: all.get(c.loser)!.school,
    opponent: all.get(c.winner)!.school,
    deduction: -1,
  }));
const report = {
  status: "current-input diagnostic, not a selection or accuracy test",
  season,
  snapshot: snapshot.id,
  engine: after.manifest.engine,
  inputs: {
    teams: after.manifest.teamsSha256,
    games: after.manifest.gamesSha256,
  },
  settings: after.manifest.winQuality,
  examples,
  restoredLosses,
  fcsTop25: {
    before: before.teams
      .filter(
        (t) => t.classification === "fcs" && t.rank !== null && t.rank <= 25,
      )
      .map((t) => ({ school: t.school, rank: t.rank })),
    after: after.teams
      .filter(
        (t) => t.classification === "fcs" && t.rank !== null && t.rank <= 25,
      )
      .map((t) => ({ school: t.school, rank: t.rank })),
  },
  allScoresAccountedFor: true,
};
writeFileSync(
  new URL("../research/win-quality-audit.json", import.meta.url),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    examples: examples.map(({ wins, ...t }) => t),
    restoredLosses,
    fcsTop25: report.fcsTop25,
    allScoresAccountedFor: true,
  }),
);
