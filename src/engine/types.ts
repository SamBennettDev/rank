export interface Team {
  id: number;
  school: string;
  abbreviation: string;
  conference: string;
  classification: string;
  color: string;
}

export interface Game {
  id: number;
  season: string;
  week: number;
  seasonType: "regular" | "postseason";
  startDate: string;
  neutralSite: boolean;
  completed: boolean;
  homeId: number;
  homeTeam: string;
  homePoints: number | null;
  awayId: number;
  awayTeam: string;
  awayPoints: number | null;
}

/**
 * How a game's spring sets its target gap (winner height − loser height):
 * "win"    every win targets the same fixed gap (restLength), so only who won matters;
 * "margin" each game targets its raw score difference.
 */
export type Method = "win" | "margin";

/** Fixed publishing order; the site shows the first published method by default. */
export const METHODS: readonly Method[] = ["win", "margin"];

export interface MethodConfig {
  /** Identifier of this method's math. Bump it when the math changes. */
  algorithmVersion: string;
  /** "win" only: the gap every win targets (default 1). Scales every height, never the order. */
  restLength?: number;
}

export interface SeasonConfig {
  /** Display name, e.g. "2026 season". */
  label: string;
  /** True for the fictional fixture season. */
  demo: boolean;
  /** Small pull toward zero applied equally to every team; makes the answer unique. */
  alpha: number;
  /** How gradually a spring lets go once its winner passes the target gap, in points. */
  softness: number;
  /** Classifications in scope, matched against teams.csv. */
  classifications: string[];
  /** The ranking methods to publish. Each is written to rankings/<season>/<method>/. */
  methods: Partial<Record<Method, MethodConfig>>;
}

/** One game that counts: an edge from loser to winner. */
export interface Edge {
  gameId: number;
  winner: number;
  loser: number;
  week: number;
  seasonType: "regular" | "postseason";
  winnerPoints: number;
  loserPoints: number;
  neutralSite: boolean;
  winnerIsHome: boolean;
}

export interface SnapshotSpec {
  /** "week-05" or "postseason". */
  id: string;
  label: string;
  /** Regular-season games with week <= throughWeek count. */
  throughWeek: number;
  /** Postseason games count only in the postseason snapshot. */
  includePostseason: boolean;
}

export interface GameCounts {
  /** Rows in games.csv that fall inside the snapshot's week window. */
  inWindow: number;
  /** Rows that became edges. */
  included: number;
  /** Rows where either team is not in teams.csv (D-II and below). */
  outOfScope: number;
  /** Rows not yet completed or without scores. */
  incomplete: number;
  /** Rows with equal scores. */
  tied: number;
}

export interface RankedTeam {
  id: number;
  school: string;
  abbreviation: string;
  conference: string;
  classification: string;
  /** null when the team has no counted games yet. */
  rank: number | null;
  tied: boolean;
  /** Height in the spring graph (the y-coordinate), rounded to 1e-6. */
  height: number | null;
  wins: number;
  losses: number;
  /** Places gained since the previous snapshot (positive = moved up). */
  change: number | null;
}

export interface Manifest {
  engine: string;
  method: Method;
  algorithmVersion: string;
  alpha: number;
  softness: number;
  /** "win" only. */
  restLength?: number;
  classifications: string[];
  teamsSha256: string;
  gamesSha256: string;
  counts: GameCounts;
}

export interface Ranking {
  schema: 1;
  season: string;
  snapshot: SnapshotSpec;
  manifest: Manifest;
  /** Game ids accepted as upsets (their winner may finish below their loser). Ascending. */
  upsets: number[];
  teams: RankedTeam[];
}

export interface SeasonIndexEntry {
  season: string;
  label: string;
  demo: boolean;
  snapshots: { id: string; label: string }[];
  /** Published methods, in METHODS order. */
  methods: Method[];
}
