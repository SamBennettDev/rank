/**
 * Builds one season's data from the NCAA stats mirror alone (see scripts/ncaa.ts):
 *
 *   npm run fetch -- 2026
 *
 * writes data/seasons/<year>/
 *   teams.csv    FBS and FCS teams (division from stats.ncaa.org)
 *   games.csv    every game of those teams: kickoff, site, score
 *   plays.csv    per team-game scrimmage EPA and success, from our expected-points model
 *   players.csv  per player-game production (passing, rushing, receiving, kicking, defense)
 *   roster.csv   player bios: position, class, height, weight, hometown, games played/started
 *
 * Team ids, abbreviations, conferences and colours come from data/teams-meta.csv, a fixed
 * crosswalk from stats.ncaa.org team names (ids match ESPN's so logos resolve); a team
 * missing from it keeps its stats.ncaa.org id. Results, plays and players come only from
 * the mirror. Everything is written in a canonical order so reruns are byte-identical.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseCsvObjects } from "../src/engine/csv";
import { gamesToCsv, parseConfig, teamsToCsv } from "../src/engine/data";
import { DEFAULT_SETTINGS } from "../src/engine/defaults";
import type { Game, SeasonConfig, Team } from "../src/engine/types";
import { DATA_DIR } from "./lib";
import {
  isPostseason,
  kickoffIso,
  localDate,
  mirror,
  num,
  text,
  weekOf,
} from "./ncaa";
import { buildPlays } from "./ncaa-plays";

const year = Number(process.argv[2]);
if (!Number.isInteger(year) || year < 2013) {
  console.error("usage: npm run fetch -- <year>   (2013 or later)");
  process.exit(2);
}

// ---- team crosswalk ---------------------------------------------------------
interface Meta {
  id: number;
  school: string;
  abbreviation: string;
  conference: string;
  color: string;
}
const meta = new Map<string, Meta>(
  parseCsvObjects(readFileSync(join(DATA_DIR, "teams-meta.csv"), "utf8")).map(
    (r) => [
      r.ncaa_name!,
      {
        id: Number(r.id),
        school: r.school!,
        abbreviation: r.abbreviation!,
        conference: r.conference!,
        color: r.color!,
      },
    ],
  ),
);

const ncaaTeams = await mirror("ncaa_mfb_teams", year);
const schedule = await mirror("ncaa_mfb_schedule", year);
const linescore = await mirror("ncaa_mfb_linescore", year, [
  "contest_id",
  "team",
  "home_away",
  "period",
  "game_date",
  "final",
]);

/** stats.ncaa.org team-season id -> its short name ("Texas A&M"). */
const ncaaName = new Map<string, string>();
const division = new Map<string, string>();
for (const t of ncaaTeams) {
  ncaaName.set(text(t.team_id), text(t.team_name));
  division.set(text(t.team_id), num(t.division) === 11 ? "fbs" : "fcs");
}
const opponentName = (s: string) =>
  s
    .replace(/^@\s*/, "")
    .replace(/\s+@.*$/, "")
    .trim();
/**
 * Opponents outside the NCAA (NAIA and others) have no stats.ncaa.org id: give each a
 * stable one from its name (FNV-1a, in 800,000,000–899,999,999).
 */
const nameId = (name: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return String(800_000_000 + (h % 100_000_000));
};
const opponentId = (r: Record<string, unknown>) =>
  text(r.opponent_id) || nameId(opponentName(text(r.opponent)));
for (const r of schedule) {
  const id = opponentId(r);
  if (id && !ncaaName.has(id)) ncaaName.set(id, opponentName(text(r.opponent)));
}
const unmapped = new Set<string>();
/** Our id for a stats.ncaa.org team: the crosswalk's, else the stats.ncaa.org id. */
const ourId = (ncaaId: string) => {
  const name = ncaaName.get(ncaaId) ?? "";
  const m = meta.get(name);
  if (!m) unmapped.add(name || ncaaId);
  return m ? m.id : Number(ncaaId);
};
const displayName = (ncaaId: string) => {
  const name = ncaaName.get(ncaaId) ?? ncaaId;
  return meta.get(name)?.school ?? name;
};

const teams: Team[] = [...division.keys()].map((nid) => {
  const m = meta.get(ncaaName.get(nid)!);
  return {
    id: ourId(nid),
    school: displayName(nid),
    abbreviation: m?.abbreviation ?? "",
    conference: m?.conference ?? "",
    classification: division.get(nid)!,
    color: m?.color ?? "",
  };
});

// ---- games ------------------------------------------------------------------
/** Linescore: contest -> home/away short names, kickoff and final scores. */
const lines = new Map<
  string,
  { home?: string; away?: string; date: string; homeFinal?: number; awayFinal?: number }
>();
for (const l of linescore) {
  const c = text(l.contest_id);
  const e = lines.get(c) ?? { date: text(l.game_date) };
  if (text(l.home_away) === "home") {
    e.home = text(l.team);
    e.homeFinal = num(l.final);
  } else {
    e.away = text(l.team);
    e.awayFinal = num(l.final);
  }
  lines.set(c, e);
}

interface Side {
  team: string;
  opponent: string;
  away: boolean;
  neutral: boolean;
  score: number;
  oppScore: number;
  date: string;
}
const byGame = new Map<string, Side[]>();
for (const r of schedule) {
  const date = text(r.date);
  const result = text(r.result);
  if (!localDate(date) || /cancel|postpone|forfeit/i.test(result)) continue;
  const team = text(r.team_id),
    opponent = opponentId(r);
  if (!team || !opponentName(text(r.opponent))) continue;
  const opp = text(r.opponent);
  const contest = text(r.contest_id);
  const [a, b] = [ourId(team), ourId(opponent)].sort((x, y) => x - y);
  const key = contest || `future:${localDate(date)}:${a}:${b}`;
  const sides = byGame.get(key) ?? [];
  sides.push({
    team,
    opponent,
    away: /^@/.test(opp),
    neutral: /\S\s*@/.test(opp) && !/^@/.test(opp),
    score: num(r.team_score),
    oppScore: num(r.opponent_score),
    date,
  });
  byGame.set(key, sides);
}

const games: Game[] = [];
const future: Game[] = [];
for (const [key, sides] of byGame) {
  const s = sides[0]!;
  const line = key.startsWith("future:") ? undefined : lines.get(key);
  const t = ourId(s.team),
    o = ourId(s.opponent);
  // Home side: the linescore's, else the schedule's "@", else the lower id at a neutral site.
  let homeIsTeam: boolean;
  if (line?.home && line.away) {
    const homeNcaa = [s.team, s.opponent].find(
      (id) => ncaaName.get(id) === line.home,
    );
    homeIsTeam = homeNcaa ? homeNcaa === s.team : !s.away;
  } else homeIsTeam = s.neutral ? t < o : !s.away;
  const [home, away] = homeIsTeam ? [s.team, s.opponent] : [s.opponent, s.team];
  const scored = Number.isFinite(s.score) && Number.isFinite(s.oppScore);
  const date = line?.date && localDate(line.date) ? line.date : s.date;
  const day = localDate(date)!;
  const game: Game = {
    id: key.startsWith("future:") ? 0 : Number(key),
    season: String(year),
    week: weekOf(day, year),
    seasonType: isPostseason(day, year) ? "postseason" : "regular",
    startDate: kickoffIso(date)!,
    neutralSite: s.neutral,
    completed: scored,
    homeId: ourId(home),
    homeTeam: displayName(home),
    homePoints: scored ? (homeIsTeam ? s.score : s.oppScore) : null,
    awayId: ourId(away),
    awayTeam: displayName(away),
    awayPoints: scored ? (homeIsTeam ? s.oppScore : s.score) : null,
  };
  if (key.startsWith("future:")) future.push(game);
  else games.push(game);
}
// Unplayed games have no contest id yet: number them after every real one, in kickoff order.
future.sort(
  (a, b) =>
    a.startDate.localeCompare(b.startDate) ||
    a.homeId - b.homeId ||
    a.awayId - b.awayId,
);
future.forEach((g, i) => (g.id = 990_000_000 + i));
games.push(...future);

// ---- write ------------------------------------------------------------------
const dir = join(DATA_DIR, "seasons", String(year));
mkdirSync(dir, { recursive: true });
const configPath = join(dir, "config.json");
if (!existsSync(configPath)) {
  const config: SeasonConfig = {
    label: `${year} season`,
    demo: false,
    ...DEFAULT_SETTINGS,
    classifications: ["fbs", "fcs"],
  };
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
}
parseConfig(readFileSync(configPath, "utf8"));
writeFileSync(join(dir, "teams.csv"), teamsToCsv(teams));
writeFileSync(join(dir, "games.csv"), gamesToCsv(games));
const played = games.filter((g) => g.completed).length;
console.log(
  `fetch ${year}: ${teams.length} teams, ${games.length} games (${played} played)` +
    (unmapped.size ? `; not in teams-meta.csv: ${[...unmapped].sort().join(", ")}` : ""),
);

await buildPlays(year, dir, (ncaaId) => ourId(ncaaId), ncaaName, lines);
