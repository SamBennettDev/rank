import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { computeSeason } from "../src/engine/season";

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
    return { season, teamsCsv: readFileSync(join(dir, "teams.csv"), "utf8"), gamesCsv: readFileSync(join(dir, "games.csv"), "utf8") };
  };
  for (const season of seasons) {
    const current = files(season);
    if (!current) continue;
    const configJson = readFileSync(join(seasonsDir, season, "config.json"), "utf8");
    if (JSON.parse(configJson).publish === false) continue; // kept only as the next season's starting point
    // Each season starts from the one before it, when that season's data is in the repository.
    const result = await computeSeason({ ...current, configJson, previous: files(String(Number(season) - 1)) });
    for (const f of result.files) out.set(`rankings/${season}/${f.id}.json`, f.json);
    index.push(result.index);
  }
  out.set("index.json", JSON.stringify({ seasons: index }, null, 2) + "\n");
  return out;
}
