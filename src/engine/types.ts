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
  /** Games' worth of pull toward an average rating, the same for every team. */
  shrink: number;
  /** Head-to-head breaks ties between teams rated within this many points (0 turns it off). */
  headToHeadWindow: number;
}

/** One team's play-by-play summary for one game (see scripts/fetch-plays.ts). */
export interface TeamGamePlays {
  gameId: number;
  teamId: number;
  opponentId: number;
  /** Scrimmage snaps (rushes and passes) outside garbage time. */
  snaps: number;
  /** Expected points added on those snaps. */
  epa: number;
  /** How many of those snaps were successful. */
  success: number;
  /** Net expected points on kickoffs, punts and field goals (and their returns), from this team's side. */
  specialEpa: number;
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
  /** Offense, defense and special teams from play-by-play, in points per game better than average; null without play-by-play. */
  offense: number | null;
  defense: number | null;
  special: number | null;
  wins: number;
  losses: number;
  /** Places gained since the previous snapshot (positive = moved up). */
  change: number | null;
}

export interface Manifest {
  engine: string;
  algorithmVersion: string;
  winBonus: number;
  shrink: number;
  headToHeadWindow: number;
  /** Fitted home-field edge in points, rounded to 1e-6. */
  homeField: number;
  classifications: string[];
  teamsSha256: string;
  gamesSha256: string;
  /** SHA-256 of plays.csv, or null when the season has no play-by-play summary. */
  playsSha256: string | null;
  /** Average scrimmage snaps per team per game, used to turn EPA per snap into points per game; null without plays. */
  snapsPerGame: number | null;
  counts: GameCounts;
}

export interface Ranking {
  schema: 1;
  season: string;
  snapshot: SnapshotSpec;
  manifest: Manifest;
  /** Game ids where head-to-head broke a close call: the winner is held at least ½ point above the loser. Ascending. */
  held: number[];
  teams: RankedTeam[];
}

export interface SeasonIndexEntry {
  season: string;
  label: string;
  demo: boolean;
  snapshots: { id: string; label: string }[];
}
