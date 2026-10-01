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

export type EdgeWeight = "win" | "margin";
export type Method = "springrank" | "gridiron";

export interface GridironConfig {
  /** Points a win is worth on top of the margin (7 = a touchdown). */
  winBonus: number;
  /** Points beyond expectation after which a game stops pulling harder (21 = three touchdowns). */
  blowoutLimit: number;
  /** Solve home-field advantage from the data. */
  fitHomeField: boolean;
  /** Safety cap on solver rounds. */
  maxIterations: number;
}

export interface SeasonConfig {
  /** Display name, e.g. "2026 season". */
  label: string;
  /** True for the fictional fixture season. The site shows a banner for it. */
  demo: boolean;
  /** Identifier of the ranking method. Bump it when the math changes. */
  algorithmVersion: string;
  /** Ranking model. Defaults to "springrank" when absent (seasons configured before Gridiron Springs). */
  method?: Method;
  /** Weak pull toward zero applied equally to every unknown; makes the answer unique. */
  alpha: number;
  /** Parameters for method "gridiron". */
  gridiron?: GridironConfig;
  /**
   * Spring stiffness per game. "win": every game weighs 1. "margin": a game weighs
   * its point differential, so a 30-point win pulls 30x harder than a 1-point win.
   * Defaults to "win" when absent. Method "springrank" only.
   */
  edgeWeight?: EdgeWeight;
  /** Classifications in scope, matched against teams.csv. */
  classifications: string[];
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
  /** SpringRank height (the y-coordinate), rounded to 1e-6. */
  height: number | null;
  wins: number;
  losses: number;
  /** Places gained since the previous snapshot (positive = moved up). */
  change: number | null;
}

export interface Manifest {
  engine: string;
  algorithmVersion: string;
  method: Method;
  alpha: number;
  /** springrank: spring stiffness per game. */
  edgeWeight?: EdgeWeight;
  /** gridiron: parameters plus what the solver found. */
  gridiron?: GridironConfig & { homeFieldPoints: number; iterations: number };
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
  teams: RankedTeam[];
}

export interface SeasonIndexEntry {
  season: string;
  label: string;
  demo: boolean;
  snapshots: { id: string; label: string }[];
}
