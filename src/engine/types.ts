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

export interface SeasonConfig {
  /** Display name, e.g. "2026 season". */
  label: string;
  /** True for the fictional fixture season. */
  demo: boolean;
  /** Identifier of the rating math. Bump it when the math or a setting changes. */
  algorithmVersion: string;
  /** Classifications in scope, matched against teams.csv. */
  classifications: string[];
  /** Points added to the winner's margin for winning at all. */
  winBonus: number;
  /** Share of last season's final rating each team starts with (0 to 1). */
  carryover: number;
  /** How many games' worth of evidence that starting rating counts for. */
  priorWeight: number;
  /** false: keep this season only as the next season's starting point; publish no rankings. */
  publish?: boolean;
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
  /** Rating in points (the graph's y-coordinate), rounded to 1e-6; null with no counted games. */
  height: number | null;
  /** Starting rating from last season (carryover x last season's final rating), rounded to 1e-6. */
  prior: number;
  wins: number;
  losses: number;
  /** Places gained since the previous snapshot (positive = moved up). */
  change: number | null;
}

export interface Manifest {
  engine: string;
  algorithmVersion: string;
  winBonus: number;
  carryover: number;
  priorWeight: number;
  /** Fitted home-field edge in points, rounded to 1e-6. */
  homeField: number;
  classifications: string[];
  teamsSha256: string;
  gamesSha256: string;
  /** The season the starting ratings came from, with the hashes of its CSVs; null if none. */
  priorSeason: { season: string; teamsSha256: string; gamesSha256: string } | null;
  counts: GameCounts;
}

export interface Ranking {
  schema: 1;
  season: string;
  snapshot: SnapshotSpec;
  manifest: Manifest;
  teams: RankedTeam[];
}

export interface SeasonIndexEntry {
  season: string;
  label: string;
  demo: boolean;
  snapshots: { id: string; label: string }[];
  /** The season whose final ratings this one starts from, or null. */
  priorSeason: string | null;
}
