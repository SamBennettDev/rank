/** The Python feature exporter uses the production chronology and team field. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseConfig, parseGames, parseTeams } from "../src/engine/data";
import { buildEdges, listSnapshots } from "../src/engine/graph";

const year = process.argv[2];
if (!year || !/^\d{4}$/.test(year))
  throw new Error("usage: neural-snapshots <year>");
const dir = resolve(import.meta.dirname, `../data/seasons/${year}`);
const read = (name: string) => readFileSync(resolve(dir, name), "utf8");
const config = parseConfig(read("config.json"));
const classifications = new Set([
  ...config.classifications,
  ...(config.opponentClassifications ?? []),
]);
const teams = parseTeams(read("teams.csv"))
  .filter((t) => classifications.has(t.classification))
  .sort((a, b) => a.id - b.id);
const games = parseGames(read("games.csv"));
console.log(
  JSON.stringify({
    teamIds: teams.map((t) => t.id),
    snapshots: listSnapshots(games).map((snap) => ({
      ...snap,
      gameIds: buildEdges(games, teams, snap).edges.map((e) => e.gameId),
    })),
  }),
);
