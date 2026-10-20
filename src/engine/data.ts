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
  /** Each listed field of `obj` must be a finite number passing `ok`. */
  const numbers = (
    where: string,
    obj: unknown,
    keys: readonly string[],
    ok: (v: number) => boolean,
    what: string,
  ) => {
    for (const k of keys) {
      const v = (obj as Record<string, unknown> | undefined)?.[k];
      if (typeof v !== "number" || !Number.isFinite(v) || !ok(v))
        throw new Error(`${where}.${k} must be ${what}`);
    }
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
  const positive = (v: number) => v > 0,
    nonNegative = (v: number) => v >= 0;
  numbers(
    "config.springs",
    c.springs,
    ["strengthShrink", "qualityScale", "rankShrink"],
    positive,
    "a positive number",
  );
  numbers(
    "config.matchup",
    c.matchup,
    ["shrink", "homeFieldShrink", "probabilityScale", "residualScale"],
    positive,
    "a positive number",
  );
  numbers(
    "config.matchup",
    c.matchup,
    ["winBonus", "divisionGap"],
    nonNegative,
    "a number >= 0",
  );
  numbers("config.matchup", c.matchup, ["homeField"], () => true, "a number");
  if (typeof c.matchup.calibrationId !== "string" || !c.matchup.calibrationId)
    throw new Error("config.matchup.calibrationId must be set");
  numbers("config", c, ["unitShrink"], positive, "a positive number");
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
