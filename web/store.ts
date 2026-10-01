import { parseGames, parseTeams } from "../src/engine/data";
import type { Game, Ranking, SeasonIndexEntry, Team } from "../src/engine/types";

const cache = new Map<string, Promise<string>>();

/** Fetches a file under ./data as raw text (bytes matter: they are hashed). */
export function fetchText(path: string): Promise<string> {
  let p = cache.get(path);
  if (!p) {
    p = fetch(`./data/${path}`, { cache: "no-cache" }).then((r) => {
      if (!r.ok) throw new Error(`${r.status} loading data/${path}`);
      return r.text();
    });
    p.catch(() => cache.delete(path));
    cache.set(path, p);
  }
  return p;
}

export async function loadIndex(): Promise<SeasonIndexEntry[]> {
  return (JSON.parse(await fetchText("index.json")) as { seasons: SeasonIndexEntry[] }).seasons;
}

export async function loadRanking(season: string, snap: string): Promise<Ranking> {
  return JSON.parse(await fetchText(`rankings/${season}/${snap}.json`)) as Ranking;
}

export async function loadGames(season: string): Promise<Game[]> {
  return parseGames(await fetchText(`seasons/${season}/games.csv`));
}

export async function loadTeams(season: string): Promise<Map<number, Team>> {
  return new Map(parseTeams(await fetchText(`seasons/${season}/teams.csv`)).map((t) => [t.id, t]));
}

export const seasonFiles = (season: string) => ({
  teamsCsv: `seasons/${season}/teams.csv`,
  gamesCsv: `seasons/${season}/games.csv`,
  configJson: `seasons/${season}/config.json`,
});
