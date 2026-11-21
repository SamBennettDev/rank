import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { computePlayers } from "../src/engine/player-output";
import { computeSeason } from "../src/engine/season";
import type { Ranking } from "../src/engine/types";

export const DATA_DIR = resolve(import.meta.dirname, "../data");

/** Every file under data/rankings plus data/index.json, as relative path -> contents. */
export async function expectedOutputs(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const seasonsDir = join(DATA_DIR, "seasons");
  const seasons = readdirSync(seasonsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  const index = [];
  const files = (season: string) => {
    const dir = join(seasonsDir, season);
    if (!existsSync(join(dir, "games.csv"))) return undefined;
    const plays = join(dir, "plays.csv");
    return {
      season,
      teamsCsv: readFileSync(join(dir, "teams.csv"), "utf8"),
      gamesCsv: readFileSync(join(dir, "games.csv"), "utf8"),
      ...(existsSync(plays) ? { playsCsv: readFileSync(plays, "utf8") } : {}),
    };
  };
  for (const season of seasons) {
    const current = files(season);
    if (!current) continue;
    const configJson = readFileSync(
      join(seasonsDir, season, "config.json"),
      "utf8",
    );
    const result = await computeSeason({ ...current, configJson });
    for (const f of result.files)
      out.set(`rankings/${season}/${f.id}.json`, f.json);
    const dir = join(seasonsDir, season);
    const players = join(dir, "players.csv"),
      roster = join(dir, "roster.csv");
    const latest = result.files.at(-1);
    if (existsSync(players) && existsSync(roster) && latest) {
      for (const f of computePlayers({
        season,
        teamsCsv: current.teamsCsv,
        playersCsv: readFileSync(players, "utf8"),
        rosterCsv: readFileSync(roster, "utf8"),
        ranking: JSON.parse(latest.json) as Ranking,
      }))
        out.set(`rankings/${season}/${f.id}.json`, f.json);
      result.index.players = true;
    }
    index.push(result.index);
  }
  out.set("index.json", JSON.stringify({ seasons: index }, null, 2) + "\n");
  return out;
}
