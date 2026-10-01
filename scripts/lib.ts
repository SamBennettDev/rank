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
  for (const season of seasons) {
    const dir = join(seasonsDir, season);
    if (!existsSync(join(dir, "games.csv"))) continue;
    const result = await computeSeason({
      season,
      teamsCsv: readFileSync(join(dir, "teams.csv"), "utf8"),
      gamesCsv: readFileSync(join(dir, "games.csv"), "utf8"),
      configJson: readFileSync(join(dir, "config.json"), "utf8"),
    });
    for (const f of result.files) out.set(`rankings/${season}/${f.id}.json`, f.json);
    index.push(result.index);
  }
  out.set("index.json", JSON.stringify({ seasons: index }, null, 2) + "\n");
  return out;
}
