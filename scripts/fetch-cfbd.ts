/**
 * Pulls one season of results from the CollegeFootballData API (https://collegefootballdata.com)
 * and rewrites data/seasons/<year>/{teams,games}.csv in a normalized, id-sorted form.
 * The API is only a data source: everything after this step is the open pipeline.
 *
 *   CFBD_API_KEY=... npm run fetch -- 2026
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gamesToCsv, teamsToCsv } from "../src/engine/data";
import type { Game, SeasonConfig, Team } from "../src/engine/types";
import { DATA_DIR } from "./lib";

const API = "https://api.collegefootballdata.com";
const year = process.argv[2];
const key = process.env.CFBD_API_KEY;
if (!year || !/^\d{4}$/.test(year)) {
  console.error("usage: CFBD_API_KEY=... npm run fetch -- <year>");
  process.exit(2);
}
if (!key) {
  console.error("CFBD_API_KEY is not set (get a free key at https://collegefootballdata.com/key)");
  process.exit(2);
}

type Raw = Record<string, unknown>;

async function get(path: string, params: Record<string, string>): Promise<Raw[]> {
  const url = `${API}${path}?${new URLSearchParams(params)}`;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" } });
    if (res.ok) return (await res.json()) as Raw[];
    if (attempt >= 3 || res.status < 500) throw new Error(`${res.status} ${res.statusText} for ${path}`);
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
}

/** The API has used both camelCase and snake_case field names across versions. */
const pick = (r: Raw, ...names: string[]): unknown => names.map((n) => r[n]).find((v) => v !== undefined && v !== null);
const str = (v: unknown) => (v === undefined ? "" : String(v));
const num = (v: unknown) => (v === undefined ? null : Number(v));

const dir = join(DATA_DIR, "seasons", year);
const configPath = join(dir, "config.json");
const config: SeasonConfig = {
  label: `${year} season`,
  demo: false,
  algorithmVersion: "springrank-1",
  alpha: 0.01,
  classifications: ["fbs", "fcs"],
};
mkdirSync(dir, { recursive: true });
if (existsSync(configPath)) Object.assign(config, JSON.parse(readFileSync(configPath, "utf8")));
else writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");

const rawTeams = await get("/teams", { year });
const teams: Team[] = rawTeams
  .map((r) => ({
    id: Number(r.id),
    school: str(r.school),
    abbreviation: str(r.abbreviation),
    conference: str(r.conference),
    classification: str(r.classification).toLowerCase(),
    color: str(r.color),
  }))
  .filter((t) => config.classifications.includes(t.classification));
if (teams.length === 0) throw new Error("no teams matched config.classifications; did the API response shape change?");

const byId = new Map<number, Game>();
for (const classification of config.classifications) {
  for (const seasonType of ["regular", "postseason"] as const) {
    for (const r of await get("/games", { year, seasonType, classification })) {
      const id = Number(r.id);
      byId.set(id, {
        id,
        season: year,
        week: Number(r.week),
        seasonType,
        startDate: str(pick(r, "startDate", "start_date")),
        neutralSite: Boolean(pick(r, "neutralSite", "neutral_site")),
        completed: Boolean(r.completed),
        homeId: Number(pick(r, "homeId", "home_id")),
        homeTeam: str(pick(r, "homeTeam", "home_team")),
        homePoints: num(pick(r, "homePoints", "home_points")),
        awayId: Number(pick(r, "awayId", "away_id")),
        awayTeam: str(pick(r, "awayTeam", "away_team")),
        awayPoints: num(pick(r, "awayPoints", "away_points")),
      });
    }
  }
}

writeFileSync(join(dir, "teams.csv"), teamsToCsv(teams));
writeFileSync(join(dir, "games.csv"), gamesToCsv([...byId.values()]));
console.log(`fetch ${year}: ${teams.length} teams, ${byId.size} games`);
