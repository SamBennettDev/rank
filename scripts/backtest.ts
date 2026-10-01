/**
 * Backtest the ranking on past seasons: how well does it (a) agree with the
 * season's results and (b) pick next week's winners? Runs the real engine.
 *
 *   npm run backtest                      # seasons in data/seasons
 *   npm run backtest -- --history 2015-2025
 *
 * --history downloads public, season-complete schedules from the sportsdataverse
 * cfbfastR-data project on GitHub (FBS + FCS games only). Nothing downloaded is
 * published or committed.
 *
 * Protocol, per season: for every week w >= 4, rank using only that season's games
 * before week w (no priors, no earlier seasons) and predict the winner of each
 * week-w game between teams already ranked (higher height wins); postseason counts
 * as one final week. "Agrees with results" ranks the whole season and counts games
 * where the winner sits above the loser.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCsvObjects } from "../src/engine/csv";
import { parseGames, parseTeams } from "../src/engine/data";
import { springRank } from "../src/engine/springrank";
import { DATA_DIR } from "./lib";

interface BtGame { id: number; order: number; home: number; away: number; hp: number; ap: number; neutral: boolean }

// ---------------------------------------------------------------- model
const ALPHA = 0.01;
const REST_LENGTH = 7;

function rate(games: BtGame[]): Map<number, number> {
  const ids = [...new Set(games.flatMap((g) => [g.home, g.away]))].sort((a, b) => a - b);
  const index = new Map(ids.map((id, i) => [id, i]));
  const beats = games.map((g) => (g.hp > g.ap ? { winner: index.get(g.home)!, loser: index.get(g.away)! } : { winner: index.get(g.away)!, loser: index.get(g.home)! }));
  const s = springRank(ids.length, beats, ALPHA, REST_LENGTH);
  return new Map(ids.map((id, i) => [id, s[i]!]));
}

// ---------------------------------------------------------------- data
function fromRepo(): Map<string, BtGame[]> {
  const out = new Map<string, BtGame[]>();
  const dir = join(DATA_DIR, "seasons");
  for (const season of readdirSync(dir).sort()) {
    const f = join(dir, season, "games.csv");
    if (!existsSync(f)) continue;
    const teams = new Set(parseTeams(readFileSync(join(dir, season, "teams.csv"), "utf8")).map((t) => t.id));
    const games = parseGames(readFileSync(f, "utf8"));
    const lastWeek = Math.max(0, ...games.filter((g) => g.seasonType === "regular").map((g) => g.week));
    out.set(season, games
      .filter((g) => g.completed && g.homePoints !== null && g.awayPoints !== null && g.homePoints !== g.awayPoints && teams.has(g.homeId) && teams.has(g.awayId))
      .map((g) => ({ id: g.id, order: g.seasonType === "postseason" ? lastWeek + 1 : g.week, home: g.homeId, away: g.awayId, hp: g.homePoints!, ap: g.awayPoints!, neutral: g.neutralSite }))
      .sort((a, b) => a.id - b.id));
  }
  return out;
}

async function fromHistory(range: string): Promise<Map<string, BtGame[]>> {
  const [a, b] = range.split("-").map(Number);
  const cache = join(tmpdir(), "rank-backtest");
  mkdirSync(cache, { recursive: true });
  const out = new Map<string, BtGame[]>();
  for (let y = a!; y <= (b ?? a!); y++) {
    if (y === 2020) continue; // COVID season: conferences played wildly different schedules
    const file = join(cache, `cfb_schedules_${y}.csv`);
    if (!existsSync(file)) {
      const url = `https://raw.githubusercontent.com/sportsdataverse/cfbfastR-data/main/schedules/csv/cfb_schedules_${y}.csv`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} downloading ${url}`);
      writeFileSync(file, await res.text());
    }
    const ok = (d: string | undefined) => d === "fbs" || d === "fcs";
    const rows = parseCsvObjects(readFileSync(file, "utf8")).filter((r) =>
      r.completed === "TRUE" && ok(r.home_division) && ok(r.away_division) && /^\d+$/.test(r.home_points ?? "") && /^\d+$/.test(r.away_points ?? "") && r.home_points !== r.away_points);
    const lastWeek = Math.max(...rows.filter((r) => r.season_type === "regular").map((r) => Number(r.week)));
    out.set(String(y), rows
      .map((r) => ({ id: Number(r.game_id), order: r.season_type === "postseason" ? lastWeek + 1 : Number(r.week), home: Number(r.home_id), away: Number(r.away_id),
        hp: Number(r.home_points), ap: Number(r.away_points), neutral: r.neutral_site === "TRUE" }))
      .sort((x, z) => x.id - z.id));
  }
  return out;
}

// ---------------------------------------------------------------- run
const args = process.argv.slice(2);
const hi = args.indexOf("--history");
const seasons = hi >= 0 ? await fromHistory(args[hi + 1] ?? "2015-2025") : fromRepo();
let right = 0, predicted = 0, agree = 0, games = 0;

for (const [season, list] of seasons) {
  const weeks = [...new Set(list.map((g) => g.order))].sort((x, z) => x - z).filter((w) => w >= 4);
  for (const w of weeks) {
    const s = rate(list.filter((g) => g.order < w));
    for (const g of list.filter((x) => x.order === w)) {
      if (!s.has(g.home) || !s.has(g.away)) continue;
      predicted++;
      const gap = s.get(g.home)! - s.get(g.away)!;
      if (gap !== 0 && gap > 0 === g.hp > g.ap) right++;
    }
  }
  const s = rate(list);
  for (const g of list) {
    games++;
    const gap = s.get(g.home)! - s.get(g.away)!;
    if (gap !== 0 && gap > 0 === g.hp > g.ap) agree++;
  }
  process.stderr.write(`  ${season}: ${list.length} games\n`);
}

const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : "—");
console.log(`\nSeasons: ${[...seasons.keys()].join(", ")}`);
console.log(`Final ranking agrees with results: ${pct(agree, games)} of ${games} games`);
console.log(`Picks next week's winner:          ${pct(right, predicted)} of ${predicted} games`);
