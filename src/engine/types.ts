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
  /** Identifier of the rating math. Bump it when the math or a setting changes. */
  algorithmVersion: string;
  /** Classifications included in the published standings. */
  classifications: string[];
  /** Divisions retained as model inputs; only classifications are ranked. */
  opponentClassifications?: string[];
  /** Points added to the winner's margin for winning at all. */
  winBonus: number;
  /** Games' worth of pull toward an average rating, the same for every team. */
  shrink: number;
  projectionSamples: number;
  projectionSeed: number;
  homeFieldShrink: number;
  probabilityScale: number;
  residualScale: number;
  calibrationId: string;
  /** Optional v2 win-credit model; omitted only for archived v1 calculations. */
  winQuality?: WinQualitySettings;
  /** Use frozen historical neural weights with current-season numeric features. */
  neural?: { model: "season-only-rich-graph-v1" };
}

export interface WinQualitySettings {
  reference: "fbs";
  divisionGap: number;
  shrink: number;
  homeField: number;
  homeFieldShrink: number;
  /** Two makes an average-quality neutral-site win offset one fixed loss. */
  winScale: 2;
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
  /** v2 separates strength-model games from scored lower-division results. */
  modeled?: number;
  unmodeled?: number;
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
  /** Configured standing; neural models use an ordinal coordinate for graph layout. */
  height: number | null;
  /** Neural height is an ordinal graph coordinate; probabilities live here. */
  neural?: {
    roundRobinWinProbability: number;
    richWinProbability: number;
    graphWinProbability: number;
  };
  earnedHeight?: number | null;
  earnedRank?: number | null;
  projection: TeamProjection | null;
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
}

export interface Manifest {
  engine: string;
  standingMethod:
    "frozen-win-quality-v1" | "frozen-fbs-quality-v2" | "season-only-neural-v1";
  lossPenalty: 1 | null;
  algorithmVersion: string;
  winBonus: number;
  shrink: number;
  projectionSamples: number;
  projectionSeed: number;
  homeFieldShrink: number;
  probabilityScale: number;
  residualScale: number;
  calibrationId: string;
  winQuality?: WinQualitySettings;
  neural?: {
    model: "season-only-rich-graph-v1";
    ordering: "weighted-pairwise-consensus";
    bundleSha256: string;
    trainingYears: number[];
    referenceTeams: number;
    orderingMoves: number;
    initialObjective: number;
    objective: number;
    disagreements: number;
  };
  /** Fitted home-field edge in points, rounded to 1e-6. */
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
  schema: 2;
  season: string;
  snapshot: SnapshotSpec;
  manifest: Manifest;
  projection: ProjectionManifest;
  predictions: MatchupPrediction[];
  credits: StandingCredit[];
  teams: RankedTeam[];
  /** Supporting opponents outside the published field, with no standing. */
  opponents?: RankedTeam[];
}

export interface TeamProjection {
  /** Whole-number projected standing, ordered by ascending simulated mean finish. */
  rank: number;
  expectedRating: number;
  /** Mean finish across simulations; retained for audit, not the displayed standing. */
  expectedRank: number;
  medianRank: number;
  rankLow: number;
  rankHigh: number;
  ratingLow: number;
  ratingHigh: number;
  top25Probability: number;
  firstProbability: number;
}

export interface ProjectionManifest {
  target?: "frozen-earned-points";
  method:
    "independent-results-v1" | "correlated-results-v1" | "adaptive-results-v1";
  samples: number;
  seed: number;
  remainingGames: number;
  horizon: string | null;
  unknownMatchups: number;
  teams: number;
}

export interface StandingCredit {
  gameId: number;
  winner: number;
  loser: number;
  value: number;
  cutoff: string;
  /** No estimated opponent quality: zero win credit, but losses still cost one. */
  unmodeled?: true;
  /** Audit values for v2 awards, all measured before the calendar week. */
  quality?: {
    probability: number;
    opponentStrength: number;
    referenceStrength: number;
    venueAdjustment: number;
    standardError: number;
    opponentGames: number;
  };
}

export interface MatchupPrediction {
  gameId: number;
  home: number;
  away: number;
  startDate: string;
  neutralSite: boolean;
  homeProbability: number;
  strengthEdge: number | null;
  provisional: boolean;
}

export interface SeasonIndexEntry {
  season: string;
  label: string;
  demo: boolean;
  snapshots: { id: string; label: string }[];
}
