/**
 * Backtest the published pipeline on past seasons: how often does each week's ranking
 * pick the winners of the following week's games, and how often does the final ranking
 * agree with the season's results?
 *
 *   npm run backtest                      # seasons in data/seasons
 *   npm run backtest -- --history 2015-2025
 *
 * --history downloads public, season-complete schedules from the sportsdataverse
 * cfbfastR-data project on GitHub (FBS + FCS games), converts them to this repository's
 * CSV format and runs `computeSeason` on them.
 * Nothing downloaded is published or committed.
 *
 * Protocol: every game from week 4 on, between two teams that are already ranked, is
 * predicted by the latest snapshot that uses only earlier games (higher rating wins;
 * a tie counts as half). Postseason games use the final regular-season snapshot.
 * "Agrees with results" uses the season's last snapshot and counts games where the
 * winner is rated above the loser.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCsvObjects } from "../src/engine/csv";
import { gamesToCsv, parseGames, teamsToCsv } from "../src/engine/data";
import { type SeasonFiles, computeSeason } from "../src/engine/season";
import type { Game, Ranking, Team } from "../src/engine/types";
import { DATA_DIR } from "./lib";

// ---------------------------------------------------------------- data
function fromRepo(): Map<string, SeasonFiles & { configJson: string }> {
  const out = new Map<string, SeasonFiles & { configJson: string }>();
  const dir = join(DATA_DIR, "seasons");
  for (const season of readdirSync(dir).sort()) {
    if (!existsSync(join(dir, season, "games.csv"))) continue;
    out.set(season, { season, teamsCsv: readFileSync(join(dir, season, "teams.csv"), "utf8"), gamesCsv: readFileSync(join(dir, season, "games.csv"), "utf8"), configJson: readFileSync(join(dir, season, "config.json"), "utf8") });
  }
  return out;
}

async function historySeason(y: number): Promise<SeasonFiles> {
  const cache = join(tmpdir(), "rank-backtest");
  mkdirSync(cache, { recursive: true });
  const file = join(cache, `cfb_schedules_${y}.csv`);
  if (!existsSync(file)) {
    const url = `https://raw.githubusercontent.com/sportsdataverse/cfbfastR-data/main/schedules/csv/cfb_schedules_${y}.csv`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} downloading ${url}`);
    writeFileSync(file, await res.text());
  }
  const ok = (d: string | undefined) => d === "fbs" || d === "fcs";
  const teams = new Map<number, Team>();
  const games: Game[] = [];
  const pts = (v?: string) => (v && /^\d+$/.test(v) ? Number(v) : null);
  for (const r of parseCsvObjects(readFileSync(file, "utf8"))) {
    if (!ok(r.home_division) && !ok(r.away_division)) continue;
    for (const side of ["home", "away"] as const) {
      const id = Number(r[`${side}_id`]);
      if (ok(r[`${side}_division`]) && !teams.has(id)) {
        teams.set(id, { id, school: r[`${side}_team`]!, abbreviation: "", conference: r[`${side}_conference`] ?? "", classification: r[`${side}_division`]!, color: "" });
      }
    }
    games.push({
      id: Number(r.game_id), season: String(y), week: Number(r.week), seasonType: r.season_type === "postseason" ? "postseason" : "regular",
      startDate: r.start_date ?? "", neutralSite: r.neutral_site === "TRUE", completed: r.completed === "TRUE",
      homeId: Number(r.home_id), homeTeam: r.home_team ?? "", homePoints: pts(r.home_points),
      awayId: Number(r.away_id), awayTeam: r.away_team ?? "", awayPoints: pts(r.away_points),
    });
  }
  return { season: String(y), teamsCsv: teamsToCsv([...teams.values()]), gamesCsv: gamesToCsv(games) };
}

const CONFIG = JSON.stringify({ label: "", demo: false, algorithmVersion: "backtest", classifications: ["fbs", "fcs"], winBonus: 3, shrink: 0.05, headToHeadWindow: 3, recordWeight: 6 });

// ---------------------------------------------------------------- scoring
async function score(current: SeasonFiles, configJson: string) {
  const out = await computeSeason({ ...current, configJson });
  const snaps = out.files.map((f) => JSON.parse(f.json) as Ranking);
  const regular = snaps.filter((s) => !s.snapshot.includePostseason);
  const games = parseGames(current.gamesCsv).filter((g) => g.completed && g.homePoints !== null && g.awayPoints !== null && g.homePoints !== g.awayPoints);
  const lastWeek = Math.max(...regular.map((s) => s.snapshot.throughWeek));
  const pick = (r: Ranking | undefined, g: Game) => {
    const h = r?.teams.find((t) => t.id === g.homeId)?.height ?? null;
    const a = r?.teams.find((t) => t.id === g.awayId)?.height ?? null;
    if (h === null || a === null) return null;
    return h === a ? 0.5 : (h > a) === (g.homePoints! > g.awayPoints!) ? 1 : 0;
  };
  let right = 0, predicted = 0, agree = 0, rated = 0;
  for (const g of games) {
    const week = g.seasonType === "postseason" ? lastWeek + 1 : g.week;
    if (week < 4) continue;
    const before = regular.filter((s) => s.snapshot.throughWeek < week).at(-1);
    const p = pick(before, g);
    if (p === null) continue;
    predicted++;
    right += p;
  }
  const final = snaps.at(-1);
  for (const g of games) {
    const p = pick(final, g);
    if (p === null) continue;
    rated++;
    agree += p;
  }
  return { right, predicted, agree, rated };
}

// ---------------------------------------------------------------- run
const args = process.argv.slice(2);
const hi = args.indexOf("--history");
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : "—");
const runs: { season: string; current: SeasonFiles; configJson: string }[] = [];
if (hi >= 0) {
  const [a, b] = (args[hi + 1] ?? "2015-2025").split("-").map(Number);
  for (let y = a!; y <= (b ?? a!); y++) {
    if (y === 2020) continue; // COVID season: conferences played wildly different schedules
    runs.push({ season: String(y), current: await historySeason(y), configJson: CONFIG });
  }
} else {
  for (const [season, s] of fromRepo()) runs.push({ season, current: s, configJson: s.configJson });
}
console.log(`\nSeasons: ${runs.map((r) => r.season).join(", ")}`);
let right = 0, predicted = 0, agree = 0, rated = 0;
for (const r of runs) {
  const s = await score(r.current, r.configJson);
  right += s.right; predicted += s.predicted; agree += s.agree; rated += s.rated;
}
console.log(`  Picks next week's winner:          ${pct(right, predicted)} of ${predicted} games`);
console.log(`  Final ranking agrees with results: ${pct(agree, rated)} of ${rated} games`);
