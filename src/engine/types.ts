export interface Team {
  id: number;
  school: string;
  abbreviation: string;
  conference: string;
  classification: string;
  color: string;
}

export interface Game {
  /** Historical evaluation only: a postseason/conditional championship matchup. */
  conditionalMatchup?: boolean;
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
  /** Identifier of the ranking math. Bump it when the math or a setting changes. */
  algorithmVersion: string;
  /** Classifications included in the published ranking. */
  classifications: string[];
  /** Divisions kept as inputs without being ranked. */
  opponentClassifications?: string[];
  /** The spring graph that produces the ranking. */
  springs: SpringSettings;
  /** The margin model behind matchup predictions (never the ranking). */
  matchup: MatchupSettings;
  /** Games' worth of pull toward average for offense, defense and special teams. */
  unitShrink: number;
}

export interface SpringSettings {
  /** Pull toward 0 (an average team), in games' worth (springs are 0–2). */
  strengthShrink: number;
  /** Converts a strength (points) into a chance of beating an average team. */
  qualityScale: number;
}

export interface MatchupSettings {
  /** Points added to the winner's margin for winning at all. */
  winBonus: number;
  /** Starting gap between an average FBS and an average FCS team, in points. */
  divisionGap: number;
  /** Games' worth of pull toward each team's division start. */
  shrink: number;
  /** Starting home-field edge in points, and how many games' worth it is held there. */
  homeField: number;
  homeFieldShrink: number;
  /** Logistic scale turning a point edge into a win probability. */
  probabilityScale: number;
  /** Typical miss of a game's margin, in points; sets rating uncertainty. */
  residualScale: number;
  calibrationId: string;
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
  /** Display week; dated snapshots use asOf for game inclusion. */
  throughWeek: number;
  /** Legacy undated window flag; dated snapshots include both season types. */
  includePostseason: boolean;
  /** Calendar cutoff, limited to the latest known score-availability time. */
  asOf?: string;
}

export interface GameCounts {
  /** Rows in games.csv whose assumed score availability falls within the cutoff. */
  inWindow: number;
  /** Rows that became edges. */
  included: number;
  /** Rows where either team is not in teams.csv (D-II and below). */
  outOfScope: number;
  /** Rows not yet completed or without scores. */
  incomplete: number;
  /** Rows with equal scores. */
  tied: number;
  /** Games between two model teams (the matchup model's inputs). */
  modeled: number;
  /** Counted results against lower-division opponents (on the graph only). */
  unmodeled: number;
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
  /** Quality, 0–7: 7 × the chance of beating an average team. The ranking. */
  height: number | null;
  /** Points better than an average team, from the surprise-weighted margin SpringRank. */
  strength: number | null;
  /** Résumé: average game points (a win earns the loser's quality, a loss costs 7 minus the winner's). */
  resume: number | null;
  resumeRank: number | null;
  /** Strength of schedule: average quality of the opponents played. */
  schedule: number | null;
  scheduleRank: number | null;
  component: number | null;
  componentSize: number;
  provisional: boolean;
  /** Offense, defense and special teams from play-by-play, in points per game better than average; null without play-by-play. */
  offense: number | null;
  defense: number | null;
  special: number | null;
  wins: number;
  losses: number;
  /** Places gained since the previous snapshot (positive = moved up). */
  change: number | null;
  /** The same for the résumé and schedule boards. */
  resumeChange: number | null;
  scheduleChange: number | null;
}

export interface Manifest {
  engine: string;
  algorithmVersion: string;
  springs: SpringSettings;
  matchup: MatchupSettings;
  unitShrink: number;
  /** Matchup model's fitted home-field edge in points, and its standard error. */
  homeField: number;
  homeFieldError: number;
  connectedComponents: number;
  classifications: string[];
  opponentClassifications?: string[];
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
  predictions: MatchupPrediction[];
  /** One spring per counted game, in game-id order. */
  springs: PublishedSpring[];
  teams: RankedTeam[];
  /** Opponents outside the ranked field (on the graph, never ranked). */
  opponents?: RankedTeam[];
}

export interface PublishedSpring {
  gameId: number;
  winner: number;
  loser: number;
  /** Winning margin in points; the spring wants 7 × (1 + 1/2 + … + 1/margin). */
  margin: number;
  /** Spring strength, 0–2: chance(loser) + 1 − chance(winner). */
  spring: number;
  /** Résumé points the winner earns: the loser's quality, 0 to 7. */
  win: number;
  /** Résumé points the loser earns: −(7 − the winner's quality), −7 to 0. */
  loss: number;
}

export interface MatchupPrediction {
  gameId: number;
  home: number;
  away: number;
  startDate: string;
  neutralSite: boolean;
  homeProbability: number;
  strengthEdge: number;
  provisional: boolean;
}

export interface SeasonIndexEntry {
  season: string;
  label: string;
  demo: boolean;
  snapshots: { id: string; label: string }[];
}
