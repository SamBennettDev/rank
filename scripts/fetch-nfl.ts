/**
 * Pulls one NFL season of results from nflverse's public schedule file
 * (https://github.com/nflverse/nfldata) and rewrites data/seasons/nfl-<year>/{teams,games}.csv
 * in the same normalized form as the college data. No API key is needed.
 *
 *   npm run fetch-nfl -- 2026
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { gamesToCsv, parseConfig, teamsToCsv } from "../src/engine/data";
import type { Game, Team } from "../src/engine/types";
import { DATA_DIR } from "./lib";

const SOURCE =
  "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv";
const year = process.argv[2];
if (!year || !/^\d{4}$/.test(year)) {
  console.error("usage: npm run fetch-nfl -- <year>");
  process.exit(2);
}

/** Team ids are ESPN's; `conference` holds the division, which gives the graph eight lanes. */
const TEAMS: [number, string, string, string, string][] = [
  [22, "Arizona Cardinals", "ARI", "NFC West", "#97233f"],
  [1, "Atlanta Falcons", "ATL", "NFC South", "#a71930"],
  [33, "Baltimore Ravens", "BAL", "AFC North", "#241773"],
  [2, "Buffalo Bills", "BUF", "AFC East", "#00338d"],
  [29, "Carolina Panthers", "CAR", "NFC South", "#0085ca"],
  [3, "Chicago Bears", "CHI", "NFC North", "#0b162a"],
  [4, "Cincinnati Bengals", "CIN", "AFC North", "#fb4f14"],
  [5, "Cleveland Browns", "CLE", "AFC North", "#ff3c00"],
  [6, "Dallas Cowboys", "DAL", "NFC East", "#003594"],
  [7, "Denver Broncos", "DEN", "AFC West", "#fb4f14"],
  [8, "Detroit Lions", "DET", "NFC North", "#0076b6"],
  [9, "Green Bay Packers", "GB", "NFC North", "#203731"],
  [34, "Houston Texans", "HOU", "AFC South", "#03202f"],
  [11, "Indianapolis Colts", "IND", "AFC South", "#002c5f"],
  [30, "Jacksonville Jaguars", "JAX", "AFC South", "#006778"],
  [12, "Kansas City Chiefs", "KC", "AFC West", "#e31837"],
  [13, "Las Vegas Raiders", "LV", "AFC West", "#000000"],
  [24, "Los Angeles Chargers", "LAC", "AFC West", "#0080c6"],
  [14, "Los Angeles Rams", "LA", "NFC West", "#003594"],
  [15, "Miami Dolphins", "MIA", "AFC East", "#008e97"],
  [16, "Minnesota Vikings", "MIN", "NFC North", "#4f2683"],
  [17, "New England Patriots", "NE", "AFC East", "#002244"],
  [18, "New Orleans Saints", "NO", "NFC South", "#d3bc8d"],
  [19, "New York Giants", "NYG", "NFC East", "#0b2265"],
  [20, "New York Jets", "NYJ", "AFC East", "#125740"],
  [21, "Philadelphia Eagles", "PHI", "NFC East", "#004c54"],
  [23, "Pittsburgh Steelers", "PIT", "AFC North", "#ffb612"],
  [25, "San Francisco 49ers", "SF", "NFC West", "#aa0000"],
  [26, "Seattle Seahawks", "SEA", "NFC West", "#002244"],
  [27, "Tampa Bay Buccaneers", "TB", "NFC South", "#d50a0a"],
  [10, "Tennessee Titans", "TEN", "AFC South", "#0c2340"],
  [28, "Washington Commanders", "WAS", "NFC East", "#5a1414"],
];
const teams: Team[] = TEAMS.map(
  ([id, school, abbreviation, conference, color]) => ({
    id,
    school,
    abbreviation,
    conference,
    classification: "nfl",
    color,
  }),
);
const byAbbr = new Map(teams.map((t) => [t.abbreviation, t]));

/** Kickoff times are Eastern; DST runs from the second Sunday of March to the first Sunday of November. */
function easternToUtc(day: string, time: string): string {
  const [y, mo, d] = day.split("-").map(Number) as [number, number, number];
  const [hh, mm] = time.split(":").map(Number) as [number, number];
  const nthSunday = (month: number, n: number) => {
    const first = new Date(Date.UTC(y, month, 1)).getUTCDay();
    return 1 + ((7 - first) % 7) + 7 * (n - 1);
  };
  const local = Date.UTC(y, mo - 1, d, hh, mm);
  const start = Date.UTC(y, 2, nthSunday(2, 2), 2); // 2am EST
  const end = Date.UTC(y, 10, nthSunday(10, 1), 1); // 2am EDT = 1am EST
  const offset = local >= start && local < end - 3600e3 ? 4 : 5;
  return new Date(local + offset * 3600e3).toISOString();
}

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${SOURCE}`);
const lines = (await res.text()).trim().split(/\r?\n/);
const header = lines[0]!.split(",");
const col = (name: string) => {
  const i = header.indexOf(name);
  if (i < 0) throw new Error(`nflverse games.csv has no ${name} column`);
  return i;
};
const c = Object.fromEntries(
  [
    "season",
    "game_type",
    "week",
    "gameday",
    "gametime",
    "away_team",
    "away_score",
    "home_team",
    "home_score",
    "location",
    "espn",
  ].map((n) => [n, col(n)]),
) as Record<string, number>;

const games: Game[] = [];
for (const line of lines.slice(1)) {
  const f = line.split(","); // the columns used here never contain commas
  if (f[c.season!] !== year) continue;
  const home = byAbbr.get(f[c.home_team!]!),
    away = byAbbr.get(f[c.away_team!]!);
  if (!home || !away)
    throw new Error(`unknown team in ${f[c.home_team!]} vs ${f[c.away_team!]}`);
  const id = Number(f[c.espn!]);
  if (!Number.isInteger(id) || id <= 0)
    throw new Error(
      `game ${home.abbreviation} v ${away.abbreviation} has no id`,
    );
  const hp = f[c.home_score!] === "" ? null : Number(f[c.home_score!]),
    ap = f[c.away_score!] === "" ? null : Number(f[c.away_score!]);
  games.push({
    id,
    season: year,
    week: Number(f[c.week!]),
    seasonType: f[c.game_type!] === "REG" ? "regular" : "postseason",
    startDate: easternToUtc(f[c.gameday!]!, f[c.gametime!] || "13:00"),
    neutralSite: f[c.location!] === "Neutral",
    completed: hp !== null && ap !== null,
    homeId: home.id,
    homeTeam: home.school,
    homePoints: hp,
    awayId: away.id,
    awayTeam: away.school,
    awayPoints: ap,
  });
}
if (games.length === 0)
  throw new Error(`no ${year} games in the nflverse file`);

const dir = join(DATA_DIR, "seasons", `nfl-${year}`);
mkdirSync(dir, { recursive: true });
const configPath = join(dir, "config.json");
if (!existsSync(configPath)) {
  // A new season starts from the most recent NFL season's settings.
  const prior = readdirSync(join(DATA_DIR, "seasons"))
    .filter((d) => /^nfl-\d{4}$/.test(d) && d !== `nfl-${year}`)
    .sort()
    .at(-1);
  if (!prior) throw new Error(`${configPath} is missing`);
  copyFileSync(join(DATA_DIR, "seasons", prior, "config.json"), configPath);
}
parseConfig(readFileSync(configPath, "utf8"));
writeFileSync(join(dir, "teams.csv"), teamsToCsv(teams));
writeFileSync(join(dir, "games.csv"), gamesToCsv(games));
console.log(
  `fetch nfl-${year}: ${teams.length} teams, ${games.length} games (${games.filter((g) => g.completed).length} completed)`,
);
