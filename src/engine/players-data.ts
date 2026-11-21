/**
 * players.csv (one row per player per game) and roster.csv (one row per player), built by
 * scripts/fetch-ncaa.ts from the NCAA stats mirror. Offensive numbers leave out garbage
 * time; EPA comes from our expected-points model (src/engine/ep.ts).
 */
import { parseCsvObjects } from "./csv";

export interface PlayerGame {
  gameId: number;
  teamId: number;
  opponentId: number;
  playerId: number;
  /** Passing: dropbacks (attempts + sacks), their EPA and successes. */
  dropbacks: number;
  passEpa: number;
  passSuccess: number;
  attempts: number;
  completions: number;
  passYards: number;
  passTd: number;
  interceptions: number;
  sacksTaken: number;
  rushes: number;
  rushEpa: number;
  rushSuccess: number;
  rushYards: number;
  rushTd: number;
  /** Receiving: targets, and the EPA and successes of the plays thrown his way. */
  targets: number;
  targetEpa: number;
  targetSuccess: number;
  receptions: number;
  recYards: number;
  recTd: number;
  /** Field goals: tries, makes, and points over the model's expectation. */
  fga: number;
  fgm: number;
  fgValue: number;
  /** Defense, from the box score. */
  tackles: number;
  solo: number;
  assists: number;
  sacks: number;
  pbu: number;
  defInt: number;
}

export interface RosterPlayer {
  id: number;
  teamId: number;
  name: string;
  jersey: string;
  position: string;
  /** Class: Fr., So., Jr., Sr., Gr. */
  year: string;
  height: string;
  weight: number;
  hometown: string;
  highSchool: string;
  gamesPlayed: number;
  gamesStarted: number;
}

export const PLAYER_COLUMNS = [
  "game_id", "team_id", "opponent_id", "player_id",
  "dropbacks", "pass_epa", "pass_success", "attempts", "completions", "pass_yards",
  "pass_td", "interceptions", "sacks_taken",
  "rushes", "rush_epa", "rush_success", "rush_yards", "rush_td",
  "targets", "target_epa", "target_success", "receptions", "rec_yards", "rec_td",
  "fga", "fgm", "fg_value",
  "tackles", "solo", "assists", "sacks", "pbu", "def_int",
];

export const ROSTER_COLUMNS = [
  "id", "team_id", "name", "jersey", "position", "year", "height", "weight",
  "hometown", "high_school", "games_played", "games_started",
];

const camel = (c: string) => c.replace(/_([a-z])/g, (_, x: string) => x.toUpperCase());

export function parsePlayerGames(csv: string): PlayerGame[] {
  return parseCsvObjects(csv).map((r) => {
    const g = {} as Record<string, number>;
    for (const c of PLAYER_COLUMNS) {
      const v = Number(r[c]);
      if (!Number.isFinite(v)) throw new Error(`players.csv: bad ${c} "${r[c]}"`);
      g[camel(c)] = v;
    }
    return g as unknown as PlayerGame;
  });
}

export function parseRoster(csv: string): RosterPlayer[] {
  return parseCsvObjects(csv).map((r) => ({
    id: Number(r.id),
    teamId: Number(r.team_id),
    name: r.name ?? "",
    jersey: r.jersey ?? "",
    position: r.position ?? "",
    year: r.year ?? "",
    height: r.height ?? "",
    weight: Number(r.weight) || 0,
    hometown: r.hometown ?? "",
    highSchool: r.high_school ?? "",
    gamesPlayed: Number(r.games_played) || 0,
    gamesStarted: Number(r.games_started) || 0,
  }));
}
