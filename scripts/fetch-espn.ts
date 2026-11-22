/**
 * Builds one season's data from the sportsdataverse ESPN-based college football releases
 * (https://github.com/sportsdataverse/sportsdataverse-data/releases), no key needed:
 *
 *   npm run fetch -- 2026
 *
 * writes data/seasons/<year>/
 *   teams.csv    FBS and FCS teams (espn_cfb_teams): ESPN id, school, conference, colour
 *   games.csv    every game with an FBS or FCS team (cfb_schedules): kickoff, site, score
 *   plays.csv    per team-game scrimmage EPA and success from our expected-points model
 *   players.csv  per player-game production (cfbfastR_cfb_pbp, espn_cfb_player_box)
 *   roster.csv   player bios (espn_cfb_rosters; positions from the play-by-play otherwise)
 *
 * Everything is written in a canonical order so reruns are byte-identical.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gamesToCsv, parseConfig, teamsToCsv } from "../src/engine/data";
import { DEFAULT_SETTINGS } from "../src/engine/defaults";
import type { Game, SeasonConfig, Team } from "../src/engine/types";
import { buildEspnPlayers } from "./espn-players";
import { DATA_DIR } from "./lib";
import { flag, num, release, text } from "./ncaa";

const year = Number(process.argv[2]);
if (!Number.isInteger(year) || year < 2014) {
  console.error("usage: npm run fetch -- <year>   (2014 or later)");
  process.exit(2);
}

const teamRows = await release("espn_cfb_teams", `cfb_teams_${year}.parquet`);
const schedule = await release("cfb_schedules", `cfb_schedules_${year}.parquet`);

const ranked = new Set(["fbs", "fcs"]);
const teams: Team[] = teamRows
  // Real programs only: not the all-star, exhibition or "TBA" placeholder entries.
  .filter(
    (t) =>
      ranked.has(text(t.division).toLowerCase()) &&
      !flag(t.is_all_star) &&
      !flag(t.is_exhibition) &&
      text(t.school || t.location).toUpperCase() !== "TBA",
  )
  .map((t) => ({
    id: num(t.team_id),
    school: text(t.school) || text(t.location),
    abbreviation: text(t.abbreviation),
    conference: text(t.cfbd_conference) || text(t.conference_short_name),
    classification: text(t.division).toLowerCase(),
    color: text(t.color) ? `#${text(t.color).replace(/^#/, "")}` : "",
  }))
  .filter((t) => Number.isSafeInteger(t.id) && t.id > 0);
const model = new Set(teams.map((t) => t.id));

const seen = new Set<number>();
const games: Game[] = [];
for (const r of schedule) {
  const id = num(r.game_id),
    home = num(r.home_id),
    away = num(r.away_id);
  if (!Number.isSafeInteger(id) || seen.has(id)) continue;
  if (!model.has(home) && !model.has(away)) continue;
  if (!Number.isSafeInteger(home) || !Number.isSafeInteger(away) || home === away) continue;
  const hp = num(r.home_points),
    ap = num(r.away_points);
  const scored = flag(r.completed) && Number.isInteger(hp) && Number.isInteger(ap);
  seen.add(id);
  games.push({
    id,
    season: String(year),
    week: Math.max(0, num(r.week) || 0),
    seasonType: text(r.season_type) === "postseason" ? "postseason" : "regular",
    startDate: text(r.start_date),
    neutralSite: flag(r.neutral_site),
    completed: scored,
    homeId: home,
    homeTeam: text(r.home_team),
    homePoints: scored ? hp : null,
    awayId: away,
    awayTeam: text(r.away_team),
    awayPoints: scored ? ap : null,
  });
}

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
console.log(
  `fetch ${year}: ${teams.length} teams, ${games.length} games (${games.filter((g) => g.completed).length} played)`,
);

await buildEspnPlayers(year, dir, model);
