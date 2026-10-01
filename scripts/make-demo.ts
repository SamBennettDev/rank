/**
 * Generates the FICTIONAL test fixture season (tests/fixtures/demo) used by the
 * determinism tests. Seeded, so the
 * output is identical on every run. Nothing here is real football data.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gamesToCsv, teamsToCsv } from "../src/engine/data";
import type { Game, Team } from "../src/engine/types";

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(2026);

const first = ["Ash", "Birch", "Cedar", "Dune", "Elm", "Fern", "Glen", "Hazel"];
const second = ["Hollow", "Ridge", "Vale", "Fields"];
const conferences = ["Demo Alpha", "Demo Beta", "Demo Gamma", "Demo Delta"];
const colors = ["#c0392b", "#2471a3", "#1e8449", "#b9770e"];

const teams: Team[] = [];
const strength = new Map<number, number>();
for (let i = 0; i < 32; i++) {
  const id = 9001 + i;
  const conf = i % 4;
  teams.push({
    id,
    school: `${first[i % 8]} ${second[Math.floor(i / 8)]}`,
    abbreviation: `D${String(i + 1).padStart(2, "0")}`,
    conference: conferences[conf]!,
    classification: "fbs",
    color: colors[conf]!,
  });
  strength.set(id, (rand() + rand() + rand() - 1.5) * 2.4);
}

const games: Game[] = [];
let gameId = 800001;
for (let week = 1; week <= 12; week++) {
  const pool = teams.map((t) => t.id);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  const pairs = Math.floor(pool.length / 2) - (week % 3 === 0 ? 2 : 0); // a few byes
  for (let p = 0; p < pairs; p++) {
    const home = pool[2 * p]!;
    const away = pool[2 * p + 1]!;
    const edge = strength.get(home)! - strength.get(away)! + 0.3;
    const homeWins = rand() < 1 / (1 + Math.exp(-edge));
    const winPts = 20 + Math.floor(rand() * 25);
    const losePts = Math.max(0, winPts - 1 - Math.floor(rand() * 21));
    const name = (id: number) => teams.find((t) => t.id === id)!.school;
    games.push({
      id: gameId++,
      season: "demo",
      week,
      seasonType: "regular",
      startDate: `2026-${week < 5 ? "09" : week < 10 ? "10" : "11"}-${String(1 + ((week * 7 + p) % 28)).padStart(2, "0")}T19:00:00.000Z`,
      neutralSite: false,
      completed: true,
      homeId: home,
      homeTeam: name(home),
      homePoints: homeWins ? winPts : losePts,
      awayId: away,
      awayTeam: name(away),
      awayPoints: homeWins ? losePts : winPts,
    });
  }
}

const dir = join(import.meta.dirname, "../tests/fixtures/demo");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "teams.csv"), teamsToCsv(teams));
writeFileSync(join(dir, "games.csv"), gamesToCsv(games));
writeFileSync(
  join(dir, "config.json"),
  JSON.stringify(
    {
      label: "Demo season (fictional data)",
      demo: true,
      algorithmVersion: "springrank-1",
      alpha: 0.01,
      classifications: ["fbs"],
    },
    null,
    2,
  ) + "\n",
);
console.log(`demo: ${teams.length} teams, ${games.length} games`);
