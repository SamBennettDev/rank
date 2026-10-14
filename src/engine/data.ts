import { parseCsvObjects, toCsv } from "./csv";
import type { Game, SeasonConfig, Team, TeamGamePlays } from "./types";

export const TEAM_COLUMNS = [
  "id",
  "school",
  "abbreviation",
  "conference",
  "classification",
  "color",
];
export const GAME_COLUMNS = [
  "id",
  "season",
  "week",
  "season_type",
  "start_date",
  "neutral_site",
  "completed",
  "home_id",
  "home_team",
  "home_points",
  "away_id",
  "away_team",
  "away_points",
];

export function parseTeams(csv: string): Team[] {
  const teams = parseCsvObjects(csv).map((r) => ({
    id: Number(r.id),
    school: r.school!,
    abbreviation: r.abbreviation!,
    conference: r.conference!,
    classification: r.classification!,
    color: r.color!,
  }));
  const seen = new Set<number>();
  for (const t of teams) {
    if (!Number.isSafeInteger(t.id) || t.id <= 0 || seen.has(t.id))
      throw new Error(`invalid or duplicate team id ${t.id}`);
    seen.add(t.id);
  }
  return teams;
}

const points = (v: string | undefined) =>
  v === undefined || v === "" ? null : Number(v);

export function parseGames(csv: string): Game[] {
  const games: Game[] = parseCsvObjects(csv).map((r) => ({
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
  const seen = new Set<number>();
  for (const g of games) {
    if (g.homeId !== 0 && g.homeId === g.awayId)
      throw new Error(`game ${g.id} has identical opponents`);
    if (!Number.isSafeInteger(g.id) || g.id <= 0 || seen.has(g.id))
      throw new Error(`invalid or duplicate game id ${g.id}`);
    if (
      ![g.homeId, g.awayId, g.week].every(
        (v) => Number.isSafeInteger(v) && v >= 0,
      )
    )
      throw new Error(`invalid team or week in game ${g.id}`);
    for (const p of [g.homePoints, g.awayPoints])
      if (p !== null && (!Number.isSafeInteger(p) || p < 0))
        throw new Error(`invalid score in game ${g.id}`);
    seen.add(g.id);
  }
  return games;
}

export function teamsToCsv(teams: Team[]): string {
  return toCsv(
    TEAM_COLUMNS,
    [...teams]
      .sort((a, b) => a.id - b.id)
      .map((t) => [
        t.id,
        t.school,
        t.abbreviation,
        t.conference,
        t.classification,
        t.color,
      ]),
  );
}

export function gamesToCsv(games: Game[]): string {
  return toCsv(
    GAME_COLUMNS,
    [...games]
      .sort((a, b) => a.id - b.id)
      .map((g) => [
        g.id,
        g.season,
        g.week,
        g.seasonType,
        g.startDate,
        g.neutralSite,
        g.completed,
        g.homeId,
        g.homeTeam,
        g.homePoints,
        g.awayId,
        g.awayTeam,
        g.awayPoints,
      ]),
  );
}

export function parseConfig(json: string): SeasonConfig {
  const c = JSON.parse(json) as SeasonConfig;
  const num = (
    k: keyof SeasonConfig,
    ok: (v: number) => boolean,
    what: string,
  ) => {
    if (
      typeof c[k] !== "number" ||
      !Number.isFinite(c[k]) ||
      !ok(c[k] as number)
    )
      throw new Error(`config.${k} must be ${what}`);
  };
  if (typeof c.algorithmVersion !== "string" || c.algorithmVersion === "")
    throw new Error("config.algorithmVersion must be set");
  if (!Array.isArray(c.classifications) || c.classifications.length === 0) {
    throw new Error("config.classifications must be a non-empty array");
  }
  if (
    c.opponentClassifications !== undefined &&
    (!Array.isArray(c.opponentClassifications) ||
      c.opponentClassifications.length === 0 ||
      c.opponentClassifications.some(
        (value) => typeof value !== "string" || !value,
      ))
  )
    throw new Error(
      "config.opponentClassifications must be a non-empty array of strings",
    );
  if (c.method !== undefined && c.method !== "one-sided-springs-v1")
    throw new Error("config.method must select one-sided-springs-v1");
  if (c.method && (c.neural || c.winQuality))
    throw new Error(
      "spring rankings cannot include neural or win-quality settings",
    );
  if (c.method)
    return {
      ...c,
      winBonus: 0,
      shrink: 0,
      projectionSamples: 0,
      projectionSeed: 0,
      homeFieldShrink: 0,
      probabilityScale: 0,
      residualScale: 0,
      calibrationId: "none",
    };
  num("winBonus", (v) => v >= 0, "a number >= 0");
  num("shrink", (v) => v > 0, "a positive number");
  num(
    "projectionSamples",
    (v) => Number.isInteger(v) && v >= 128 && v <= 8192,
    "an integer from 128 to 8192",
  );
  num(
    "projectionSeed",
    (v) => Number.isInteger(v) && v >= 0 && v <= 4294967295,
    "an unsigned 32-bit integer",
  );
  num("homeFieldShrink", (v) => v > 0, "a positive number");
  num("probabilityScale", (v) => v > 0, "a positive number");
  num("residualScale", (v) => v > 0, "a positive number");
  if (typeof c.calibrationId !== "string" || !c.calibrationId)
    throw new Error("config.calibrationId must be set");
  if (c.winQuality !== undefined) {
    const q = c.winQuality;
    if (
      !q ||
      q.reference !== "fbs" ||
      q.winScale !== 2 ||
      typeof q.calibrationId !== "string" ||
      !q.calibrationId ||
      !Number.isFinite(q.divisionGap) ||
      q.divisionGap < 0 ||
      !Number.isFinite(q.shrink) ||
      q.shrink <= 0 ||
      !Number.isFinite(q.homeField) ||
      !Number.isFinite(q.homeFieldShrink) ||
      q.homeFieldShrink <= 0
    )
      throw new Error(
        "config.winQuality must specify a valid calibrated FBS reference and balanced win scale",
      );
  }
  if (c.algorithmVersion === "earned-standing-2" && !c.winQuality)
    throw new Error("config.winQuality is required for earned-standing-2");
  if (
    c.neural !== undefined &&
    (!c.neural ||
      !["season-only-rich-graph-v1", "season-only-robust-loss-v2"].includes(
        c.neural.model,
      ))
  )
    throw new Error("config.neural must select a supported neural model");
  if (c.algorithmVersion === "season-only-neural-1" && !c.neural)
    throw new Error("config.neural is required for season-only-neural-1");
  return c;
}

export const PLAY_COLUMNS = [
  "game_id",
  "team_id",
  "opponent_id",
  "snaps",
  "epa",
  "success",
  "special_epa",
];

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
  return toCsv(
    PLAY_COLUMNS,
    [...rows]
      .sort((a, b) => a.gameId - b.gameId || a.teamId - b.teamId)
      .map((r) => [
        r.gameId,
        r.teamId,
        r.opponentId,
        r.snaps,
        fixed6(r.epa),
        r.success,
        fixed6(r.specialEpa),
      ]),
  );
}
