import { parseCsvObjects, toCsv } from "./csv";
import type { Game, SeasonConfig, Team } from "./types";

export const TEAM_COLUMNS = ["id", "school", "abbreviation", "conference", "classification", "color"];
export const GAME_COLUMNS = [
  "id", "season", "week", "season_type", "start_date", "neutral_site", "completed",
  "home_id", "home_team", "home_points", "away_id", "away_team", "away_points",
];

export function parseTeams(csv: string): Team[] {
  return parseCsvObjects(csv).map((r) => ({
    id: Number(r.id),
    school: r.school!,
    abbreviation: r.abbreviation!,
    conference: r.conference!,
    classification: r.classification!,
    color: r.color!,
  }));
}

const points = (v: string | undefined) => (v === undefined || v === "" ? null : Number(v));

export function parseGames(csv: string): Game[] {
  return parseCsvObjects(csv).map((r) => ({
    id: Number(r.id),
    season: r.season!,
    week: Number(r.week),
    seasonType: r.season_type === "postseason" ? "postseason" : "regular",
    startDate: r.start_date!,
    neutralSite: r.neutral_site === "true",
    completed: r.completed === "true",
    homeId: Number(r.home_id),
    homeTeam: r.home_team!,
    homePoints: points(r.home_points),
    awayId: Number(r.away_id),
    awayTeam: r.away_team!,
    awayPoints: points(r.away_points),
  }));
}

export function teamsToCsv(teams: Team[]): string {
  return toCsv(TEAM_COLUMNS, [...teams].sort((a, b) => a.id - b.id)
    .map((t) => [t.id, t.school, t.abbreviation, t.conference, t.classification, t.color]));
}

export function gamesToCsv(games: Game[]): string {
  return toCsv(GAME_COLUMNS, [...games].sort((a, b) => a.id - b.id).map((g) => [
    g.id, g.season, g.week, g.seasonType, g.startDate, g.neutralSite, g.completed,
    g.homeId, g.homeTeam, g.homePoints, g.awayId, g.awayTeam, g.awayPoints,
  ]));
}

export function parseConfig(json: string): SeasonConfig {
  const c = JSON.parse(json) as SeasonConfig;
  validateModel(c);
  if (c.power !== undefined) {
    if (typeof c.power !== "object" || c.power === null) throw new Error("config.power must be an object");
    try {
      validateModel(powerConfig(c));
    } catch (e) {
      throw new Error(`config.power: ${(e as Error).message}`);
    }
  }
  return c;
}

/** The full config for the Power view: the season config with the power block's model fields applied. */
export function powerConfig(c: SeasonConfig): SeasonConfig {
  const { power, ...rest } = c;
  return { ...rest, edgeWeight: undefined, restLength: undefined, minMargin: undefined, maxMargin: undefined, gridiron: undefined, ...power };
}

function validateModel(c: SeasonConfig): void {
  if (typeof c.alpha !== "number" || !(c.alpha > 0)) throw new Error("config.alpha must be a positive number");
  if (!Array.isArray(c.classifications) || c.classifications.length === 0) {
    throw new Error("config.classifications must be a non-empty array");
  }
  if (c.method !== undefined && c.method !== "springrank" && c.method !== "gridiron") {
    throw new Error('config.method must be "springrank" or "gridiron"');
  }
  if (c.method === "gridiron") {
    const g = c.gridiron;
    if (!g || typeof g.winBonus !== "number" || typeof g.blowoutLimit !== "number" || typeof g.fitHomeField !== "boolean" || typeof g.maxIterations !== "number") {
      throw new Error("config.gridiron must set winBonus, blowoutLimit, fitHomeField and maxIterations");
    }
  }
  if (c.restLength !== undefined && !(typeof c.restLength === "number" && c.restLength > 0)) {
    throw new Error("config.restLength must be a positive number");
  }
  for (const k of ["minMargin", "maxMargin"] as const) {
    if (c[k] !== undefined && !(typeof c[k] === "number" && c[k]! > 0)) throw new Error(`config.${k} must be a positive number`);
  }
  if (c.minMargin !== undefined && c.maxMargin !== undefined && c.minMargin > c.maxMargin) {
    throw new Error("config.minMargin must not exceed config.maxMargin");
  }
  if (c.edgeWeight !== undefined && c.edgeWeight !== "win" && c.edgeWeight !== "margin") {
    throw new Error('config.edgeWeight must be "win" or "margin"');
  }
  if (typeof c.algorithmVersion !== "string" || c.algorithmVersion === "") throw new Error("config.algorithmVersion must be set");
}
