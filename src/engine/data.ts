import { parseCsvObjects, toCsv } from "./csv";
import type { Game, SeasonConfig, Team, TeamGamePlays } from "./types";

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
  const num = (k: keyof SeasonConfig, ok: (v: number) => boolean, what: string) => {
    if (typeof c[k] !== "number" || !ok(c[k] as number)) throw new Error(`config.${k} must be ${what}`);
  };
  if (typeof c.algorithmVersion !== "string" || c.algorithmVersion === "") throw new Error("config.algorithmVersion must be set");
  if (!Array.isArray(c.classifications) || c.classifications.length === 0) {
    throw new Error("config.classifications must be a non-empty array");
  }
  num("winBonus", (v) => v >= 0, "a number >= 0");
  num("carryover", (v) => v >= 0 && v <= 1, "a number from 0 to 1");
  num("priorWeight", (v) => v > 0, "a positive number");
  if (c.publish !== undefined && typeof c.publish !== "boolean") throw new Error("config.publish must be true or false");
  return c;
}

export const PLAY_COLUMNS = ["game_id", "team_id", "opponent_id", "snaps", "epa", "success", "special_epa"];

export function parsePlays(csv: string): TeamGamePlays[] {
  return parseCsvObjects(csv).map((r) => ({
    gameId: Number(r.game_id),
    teamId: Number(r.team_id),
    opponentId: Number(r.opponent_id),
    snaps: Number(r.snaps),
    epa: Number(r.epa),
    success: Number(r.success),
    specialEpa: Number(r.special_epa),
  }));
}

const fixed6 = (v: number) => (Math.abs(v) < 5e-7 ? 0 : v).toFixed(6);

/** EPA columns keep 6 decimals; rows sorted by game then team. */
export function playsToCsv(rows: TeamGamePlays[]): string {
  return toCsv(PLAY_COLUMNS, [...rows].sort((a, b) => a.gameId - b.gameId || a.teamId - b.teamId)
    .map((r) => [r.gameId, r.teamId, r.opponentId, r.snaps, fixed6(r.epa), r.success, fixed6(r.specialEpa)]));
}
