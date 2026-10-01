/**
 * Backtest: how well does each ranking method (a) pick next week's winners and
 * (b) agree with the season's results? Every method runs through the real engine.
 *
 *   npm run backtest                      # seasons in data/seasons (no demo)
 *   npm run backtest -- --history 2015-2025
 *
 * --history downloads public, season-complete schedules from the sportsdataverse
 * cfbfastR-data project on GitHub (FBS + FCS games only). That is how the table in
 * docs/BACKTEST.md was produced. Nothing downloaded is published or committed.
 *
 * Protocol, per season: for every week w >= 4, fit each method on that season's
 * games before week w (no priors, no earlier seasons) and predict week w's games
 * between teams already seen; postseason counts as one final week. "Agrees with
 * results" fits the whole season and counts games where the winner is rated above
 * the loser.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCsvObjects } from "../src/engine/csv";
import { parseGames, parseTeams } from "../src/engine/data";
import { gridironSprings } from "../src/engine/gridiron";
import { solve } from "../src/engine/season";
import type { Edge, SeasonConfig } from "../src/engine/types";
import { DATA_DIR } from "./lib";

interface BtGame { id: number; order: number; home: number; away: number; hp: number; ap: number; neutral: boolean }

// ---------------------------------------------------------------- methods
const base = { label: "", demo: false, classifications: ["fbs", "fcs"], alpha: 0.01 };
const gridiron = (winBonus: number, blowoutLimit: number, fitHomeField: boolean): SeasonConfig => ({
  ...base, algorithmVersion: "bt", method: "gridiron", gridiron: { winBonus, blowoutLimit, fitHomeField, maxIterations: 500 },
});
const METHODS: { name: string; config: SeasonConfig; clampMargin?: [number, number] }[] = [
  { name: "Wins only, equal springs (Win Springs, published)", config: { ...base, algorithmVersion: "bt", method: "springrank", edgeWeight: "win", restLength: 7 } },
  { name: "Margin as spring stiffness, uncapped", config: { ...base, algorithmVersion: "bt", method: "springrank", edgeWeight: "margin", restLength: 7 } },
  { name: "Margin as spring stiffness, clamped 7-24", config: { ...base, algorithmVersion: "bt", method: "springrank", edgeWeight: "margin", minMargin: 7, maxMargin: 24, restLength: 7 } },
  { name: "Least squares on margin + home (Massey)", config: gridiron(0, 1e9, true) },
  { name: "Sports-Reference SRS (margin clamped 7-24)", config: gridiron(0, 1e9, false), clampMargin: [7, 24] },
  { name: "Gridiron, no blowout limit", config: gridiron(7, 1e9, true) },
  { name: "Gridiron Springs", config: gridiron(7, 21, true) },
];

function rate(games: BtGame[], config: SeasonConfig, clampMargin?: [number, number]) {
  const ids = [...new Set(games.flatMap((g) => [g.home, g.away]))].sort((a, b) => a - b);
  const index = new Map(ids.map((id, i) => [id, i]));
  if (clampMargin) {
    // SRS: each game counts as its margin clamped to [lo, hi] toward the winner.
    const [lo, hi] = clampMargin;
    const r = gridironSprings(ids.length, games.map((g) => {
      const m = g.hp - g.ap;
      const c = Math.sign(m) * Math.min(hi, Math.max(lo, Math.abs(m)));
      return { home: index.get(g.home)!, away: index.get(g.away)!, homePoints: c, awayPoints: 0, neutral: g.neutral };
    }), config.alpha, config.gridiron!);
    return { s: new Map(ids.map((id, i) => [id, r.heights[i]!])), hfa: 0 };
  }
  const edges: Edge[] = games.map((g) => {
    const homeWon = g.hp > g.ap;
    return { gameId: g.id, winner: homeWon ? g.home : g.away, loser: homeWon ? g.away : g.home, week: g.order, seasonType: "regular",
      winnerPoints: Math.max(g.hp, g.ap), loserPoints: Math.min(g.hp, g.ap), neutralSite: g.neutral, winnerIsHome: homeWon };
  });
  const r = solve(ids.length, edges, index, config);
  return { s: new Map(ids.map((id, i) => [id, r.heights[i]!])), hfa: r.homeField ?? 0 };
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
const results = METHODS.map(() => ({ right: 0, n: 0, agree: 0, games: 0, hfa: [] as number[] }));

for (const [season, games] of seasons) {
  const weeks = [...new Set(games.map((g) => g.order))].sort((x, z) => x - z).filter((w) => w >= 4);
  METHODS.forEach((m, mi) => {
    const r = results[mi]!;
    for (const w of weeks) {
      const train = games.filter((g) => g.order < w);
      const { s, hfa } = rate(train, m.config, m.clampMargin);
      for (const g of games.filter((x) => x.order === w)) {
        if (!s.has(g.home) || !s.has(g.away)) continue;
        const pred = s.get(g.home)! - s.get(g.away)! + (g.neutral ? 0 : hfa);
        r.n++;
        if (pred !== 0 && pred > 0 === g.hp > g.ap) r.right++;
      }
    }
    const { s, hfa } = rate(games, m.config, m.clampMargin);
    r.hfa.push(hfa);
    for (const g of games) {
      r.games++;
      const gap = s.get(g.home)! - s.get(g.away)!;
      if (gap !== 0 && gap > 0 === g.hp > g.ap) r.agree++;
    }
  });
  process.stderr.write(`  ${season}: ${games.length} games\n`);
}

const pct = (a: number, b: number) => `${((100 * a) / b).toFixed(1)}%`;
console.log(`\nSeasons: ${[...seasons.keys()].join(", ")}. Predicted games: ${results[0]!.n}.\n`);
console.log("| Method | Picks next week's winner | Final ranking agrees with results | Home field (avg) |");
console.log("|---|---|---|---|");
METHODS.forEach((m, i) => {
  const r = results[i]!;
  const h = r.hfa.reduce((x, z) => x + z, 0) / r.hfa.length;
  console.log(`| ${m.name} | ${pct(r.right, r.n)} | ${pct(r.agree, r.games)} | ${h ? `${h.toFixed(2)} pts` : "—"} |`);
});
