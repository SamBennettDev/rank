/**
 * Condenses one season of public play-by-play into data/seasons/<year>/plays.csv:
 * one row per team per game with its offensive snaps, the expected points added
 * (EPA) on them, how many succeeded, and its net special-teams EPA.
 *
 *   npm run fetch-plays -- 2026
 *
 * Source: the cfbfastR play-by-play release of the sportsdataverse project
 * (https://github.com/sportsdataverse/sportsdataverse-data, CFBD-derived; EPA and
 * success come from cfbfastR's open-source expected-points model). It covers games
 * with at least one FBS team (and, from 2022, most FCS games). No key is needed.
 *
 * Rules (also in docs/METHODOLOGY.md):
 * - Offense: plays flagged as a rush or a pass by the offense unit, with an EPA value,
 *   outside garbage time (score gap above 38 in the 2nd quarter, 28 in the 3rd, 22 in the 4th).
 * - Special teams: kickoffs, punts and field-goal tries and their returns. Each play's
 *   EPA counts for the team with the ball and against the other, so the pair sums to zero.
 * Plays are summed in game and play-id order.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asyncBufferFromFile, parquetReadObjects } from "hyparquet";
import { playsToCsv } from "../src/engine/data";
import type { TeamGamePlays } from "../src/engine/types";
import { DATA_DIR } from "./lib";

const year = process.argv[2];
if (!year || !/^\d{4}$/.test(year)) {
  console.error("usage: npm run fetch-plays -- <year>");
  process.exit(2);
}

const cache = join(tmpdir(), "rank-pbp");
mkdirSync(cache, { recursive: true });
const file = join(cache, `pbp_${year}.parquet`);
const url = `https://github.com/sportsdataverse/sportsdataverse-data/releases/download/cfbfastR_cfb_pbp/play_by_play_${year}.parquet`;
if (!existsSync(file) || process.env.REFRESH) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} downloading ${url}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

const COLUMNS = [
  "game_id",
  "id_play",
  "pos_team",
  "home_team",
  "away_team",
  "home_team_id",
  "away_team_id",
  "rush",
  "pass",
  "EPA",
  "success",
  "pos_unit",
  "kickoff_play",
  "punt",
  "fg_inds",
  "period",
  "pos_score_diff_start",
];
type Row = Record<string, unknown>;
const rows = (await parquetReadObjects({
  file: await asyncBufferFromFile(file),
  columns: COLUMNS,
})) as Row[];

const num = (v: unknown) => (v === null || v === undefined ? NaN : Number(v));
const flag = (v: unknown) => num(v) === 1 || v === true;
const key = (v: unknown) => String(v ?? "");
// Sort by game, then play id (digit strings: shorter first, then lexicographic).
rows.sort(
  (a, b) =>
    num(a.game_id) - num(b.game_id) ||
    key(a.id_play).length - key(b.id_play).length ||
    (key(a.id_play) < key(b.id_play)
      ? -1
      : key(a.id_play) > key(b.id_play)
        ? 1
        : 0),
);

const out = new Map<string, TeamGamePlays>();
const get = (gameId: number, teamId: number, opponentId: number) => {
  const k = `${gameId}:${teamId}`;
  let r = out.get(k);
  if (!r)
    out.set(
      k,
      (r = {
        gameId,
        teamId,
        opponentId,
        snaps: 0,
        epa: 0,
        success: 0,
        specialEpa: 0,
      }),
    );
  return r;
};
const SPECIAL_UNITS = new Set([
  "Kickoff Return",
  "Punt Offense",
  "Field Goal Offense",
]);
for (const p of rows) {
  const epa = num(p.EPA);
  if (Number.isNaN(epa)) continue;
  const home = p.pos_team === p.home_team,
    away = p.pos_team === p.away_team;
  if (!home && !away) continue;
  const gameId = num(p.game_id);
  const team = num(home ? p.home_team_id : p.away_team_id);
  const opp = num(home ? p.away_team_id : p.home_team_id);
  if (
    !Number.isFinite(gameId) ||
    !Number.isFinite(team) ||
    !Number.isFinite(opp)
  )
    continue;
  const unit =
    p.pos_unit === null || p.pos_unit === undefined
      ? "Offense"
      : String(p.pos_unit);
  const scrimmage = (flag(p.rush) || flag(p.pass)) && unit === "Offense";
  if (scrimmage) {
    const gap = Math.abs(num(p.pos_score_diff_start));
    const period = num(p.period);
    const garbage =
      (period === 2 && gap > 38) ||
      (period === 3 && gap > 28) ||
      (period >= 4 && gap > 22);
    if (garbage) continue;
    const r = get(gameId, team, opp);
    r.snaps += 1;
    r.epa += epa;
    if (flag(p.success)) r.success += 1;
  } else if (
    flag(p.kickoff_play) ||
    flag(p.punt) ||
    flag(p.fg_inds) ||
    SPECIAL_UNITS.has(unit)
  ) {
    get(gameId, team, opp).specialEpa += epa;
    get(gameId, opp, team).specialEpa -= epa;
  }
}
const dir = join(DATA_DIR, "seasons", year);
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "plays.csv"), playsToCsv([...out.values()]));
console.log(
  `fetch-plays ${year}: ${rows.length} plays -> ${out.size} team-game rows`,
);
