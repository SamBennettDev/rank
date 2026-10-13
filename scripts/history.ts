import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCsvObjects } from "../src/engine/csv";
import type { Game, Team } from "../src/engine/types";
export const HISTORY_REVISION = "a3dd960090c1bfa169cebd491beabf7028b379b2";

export async function historySeason(year: number) {
  const cache = join(tmpdir(), "rank-backtest");
  mkdirSync(cache, { recursive: true });
  const file = join(cache, `cfb_schedules_${HISTORY_REVISION}_${year}.csv`);
  if (!existsSync(file)) {
    const response = await fetch(
      `https://raw.githubusercontent.com/sportsdataverse/cfbfastR-data/${HISTORY_REVISION}/schedules/csv/cfb_schedules_${year}.csv`,
    );
    if (!response.ok) throw new Error(`${response.status} downloading ${year}`);
    writeFileSync(file, await response.text());
  }
  const raw = readFileSync(file, "utf8"),
    teams = new Map<number, Team>(),
    games: Game[] = [];
  const ok = (v: string | undefined) => v === "fbs" || v === "fcs";
  for (const r of parseCsvObjects(raw)) {
    if (!ok(r.home_division) || !ok(r.away_division)) continue;
    for (const side of ["home", "away"] as const) {
      const id = Number(r[`${side}_id`]);
      if (!teams.has(id))
        teams.set(id, {
          id,
          school: r[`${side}_team`]!,
          abbreviation: "",
          conference: r[`${side}_conference`] ?? "",
          classification: r[`${side}_division`]!,
          color: "",
        });
    }
    const points = (v: string | undefined) =>
      v && /^\d+$/.test(v) ? Number(v) : null;
    games.push({
      conditionalMatchup:
        r.season_type === "postseason" ||
        /championship|playoff|bowl/i.test(r.notes ?? ""),
      id: Number(r.game_id),
      season: String(year),
      week: Number(r.week),
      seasonType: r.season_type === "postseason" ? "postseason" : "regular",
      startDate: r.start_date ?? "",
      neutralSite: r.neutral_site === "TRUE",
      completed: r.completed === "TRUE",
      homeId: Number(r.home_id),
      homeTeam: r.home_team ?? "",
      homePoints: points(r.home_points),
      awayId: Number(r.away_id),
      awayTeam: r.away_team ?? "",
      awayPoints: points(r.away_points),
    });
  }
  return { teams: [...teams.values()].sort((a, b) => a.id - b.id), games, raw };
}
