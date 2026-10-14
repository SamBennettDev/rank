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
const participantIds = [...new Set(games.flatMap(g => [g.homeId,g.awayId]))].filter(id => id > 0).map(id => ({id}));
console.log(
  JSON.stringify({
    teamIds: teams.map((t) => t.id),
    snapshots: listSnapshots(games).map((snap) => {
      const modeled = buildEdges(games, teams, snap).edges;
      const known = new Set(teams.map(t => t.id));
      const allResults = buildEdges(games, participantIds, snap).edges;
      const external = allResults.filter(e => known.has(e.loser) && !known.has(e.winner));
      return {...snap, gameIds: modeled.map(e => e.gameId),
        externalLosses: teams.map(t => external.filter(e => e.loser === t.id).length),
        recordGamesPlayed: teams.map(t => allResults.filter(e => e.winner === t.id || e.loser === t.id).length)};
    }),
  }),
);
