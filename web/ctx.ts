import { buildEdges } from "../src/engine/graph";
import { quality } from "../src/engine/springs";
import type {
  Edge,
  Game,
  RankedTeam,
  Ranking,
  SeasonIndexEntry,
  Team,
} from "../src/engine/types";

export type View = "list" | "graph" | "team" | "about" | "matchups" | "players" | "player";
export interface Ctx {
  seasons: SeasonIndexEntry[];
  entry: SeasonIndexEntry;
  snapId: string;
  ranking: Ranking;
  games: Game[];
  teams: Map<number, Team>;
  edges: Edge[];
  byId: Map<number, RankedTeam>;
  ranked: RankedTeam[];
}
export function makeCtx(base: Omit<Ctx, "edges" | "byId" | "ranked">): Ctx {
  const allTeams = [...base.ranking.teams, ...(base.ranking.opponents ?? [])];
  const { edges } = buildEdges(base.games, allTeams, base.ranking.snapshot);
  return {
    ...base,
    edges,
    byId: new Map(allTeams.map((t) => [t.id, t])),
    ranked: base.ranking.teams.filter((t) => t.rank !== null),
  };
}
/** What the season picker shows: "2026" for college football, "NFL 2026" for the NFL. */
export const seasonLabel = (e: SeasonIndexEntry) =>
  e.league === "nfl" ? `NFL ${e.season.replace(/^nfl-/, "")}` : e.season;
export const postseasonName = (e: SeasonIndexEntry) =>
  e.league === "nfl" ? "Playoffs" : "Bowls";
export const href = (
  season: string,
  snap: string,
  view: View,
  ...ids: (number | string | undefined)[]
) =>
  `#/${season}/${snap}/${view}${ids
    .filter((x) => x !== undefined)
    .map((x) => `/${x}`)
    .join("")}`;
export const playerHref = (ctx: Ctx, teamId: number, playerId: number) =>
  href(ctx.entry.season, ctx.snapId, "player", teamId, playerId);
export const boardHref = (ctx: Ctx, group: string) =>
  href(ctx.entry.season, ctx.snapId, "players", group);
export const teamHref = (ctx: Ctx, id: number) =>
  href(ctx.entry.season, ctx.snapId, "team", id);
export const rankLabel = (rank: number | null, tied: boolean) =>
  rank === null ? "—" : `${tied ? "T-" : ""}${rank}`;
export const fmtHeight = (v: number | null, d = 1) =>
  v === null ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d);
/** Résumé and other 0–100 scores. */
export const fmtScore = (v: number | null, d = 2) =>
  v === null ? "—" : v.toFixed(d);
export const record = (t: RankedTeam) => `${t.wins}-${t.losses}`;
/**
 * The latest result counted in the snapshot on screen: the kickoff of its most recent game,
 * as "Nov 21" (short) and "Saturday, Nov 21" (long). Dated in US Eastern time, as college
 * football slates are, so a Saturday-night kickoff still reads as Saturday everywhere.
 */
export function dataThrough(ctx: Ctx): { short: string; long: string; iso: string } | null {
  const kickoff = new Map(ctx.games.map((g) => [g.id, g.startDate]));
  let latest = "";
  for (const e of ctx.edges) {
    const k = kickoff.get(e.gameId) ?? "";
    if (k > latest) latest = k;
  }
  const d = new Date(latest);
  if (!latest || Number.isNaN(d.getTime())) return null;
  return {
    iso: latest,
    short: d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" }),
    long: d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "America/New_York" }),
  };
}
export function upsets(ctx: Ctx) {
  return ctx.edges
    // Résumé is ranked within each division, so upsets compare teams of the same one.
    .filter(
      (e) =>
        ctx.byId.get(e.winner)?.resumeRank != null &&
        ctx.byId.get(e.loser)?.resumeRank != null &&
        ctx.byId.get(e.winner)!.classification === ctx.byId.get(e.loser)!.classification,
    )
    .map((edge) => ({
      edge,
      gap:
        ctx.byId.get(edge.loser)!.resume! - ctx.byId.get(edge.winner)!.resume!,
    }))
    .filter((u) => u.gap > 0)
    .sort((a, b) => b.gap - a.gap || a.edge.gameId - b.edge.gameId);
}
export interface GameLine {
  edge: Edge;
  won: boolean;
  opponent: RankedTeam;
  where: -1 | 0 | 1;
  margin: number;
  /** Chance a typical top-25 team would have won this game (against this opponent). */
  chance: number;
  /** Result against that benchmark: 1 − chance for a win, −chance for a loss. */
  value: number;
}
/**
 * A team's games against the résumé's top-25 benchmark: each game's chance that a typical
 * top-25 team wins it (from strengths and the calibrated quality logistic, as the engine
 * computes it), and the team's wins against those expected wins.
 */
export function breakdown(ctx: Ctx, teamId: number) {
  const m = ctx.ranking.manifest;
  const division = ctx.byId.get(teamId)?.classification;
  const bench =
    m.resumeBenchmarks?.find((b) => b.label === "Top-25 team" && b.classification === division)?.strength ?? 0;
  const lines: GameLine[] = ctx.edges
    .filter((e) => e.winner === teamId || e.loser === teamId)
    .map((edge) => {
      const won = edge.winner === teamId,
        opponent = ctx.byId.get(won ? edge.loser : edge.winner)!,
        home = won ? edge.winnerIsHome : !edge.winnerIsHome;
      const where: -1 | 0 | 1 = edge.neutralSite ? 0 : home ? 1 : -1,
        margin = won
          ? edge.winnerPoints - edge.loserPoints
          : edge.loserPoints - edge.winnerPoints;
      const chance = quality(bench - (opponent.strength ?? 0), m.springs.qualityScale);
      return { edge, won, opponent, where, margin, chance, value: (won ? 1 : 0) - chance };
    });
  const wins = lines.filter((l) => l.won).length;
  const expected = lines.reduce((sum, l) => sum + l.chance, 0);
  return { lines, wins, expected, games: lines.length, bench };
}
export type Metric =
  | "overall"
  | "resume"
  | "schedule"
  | "offense"
  | "defense"
  | "special";
export const METRICS: Metric[] = [
  "overall",
  "resume",
  "schedule",
  "offense",
  "defense",
  "special",
];
export const METRIC_LABEL: Record<Metric, string> = {
  overall: "Quality",
  resume: "Résumé",
  schedule: "Schedule",
  offense: "Offense",
  defense: "Defense",
  special: "Special teams",
};
export const METRIC_HINT: Record<Metric, string> = {
  overall:
    "Quality, 0–100: 100 × the chance of beating an average team. It comes from a spring graph where every game wants its winner above its loser by the margin, each extra point counting a little less.",
  resume:
    "Strength of record, 0–100: how unlikely this record would be for a good team of the same division against the same schedule, averaged over five benchmarks (its top-10, top-25, top-50 and top-100 team, and its average team). FBS and FCS are ranked separately.",
  schedule:
    "Strength of schedule: the average quality (0–100) of the opponents played.",
  offense:
    "Offensive points per game above average from opponent-adjusted play-by-play, excluding garbage time.",
  defense:
    "Defensive points saved per game above average from opponent-adjusted play-by-play, excluding garbage time.",
  special:
    "Special-teams points per game above average from opponent-adjusted kickoffs, punts, field goals and returns.",
};
export interface BoardEntry {
  team: RankedTeam;
  value: number;
  rank: number;
  tied: boolean;
}
export function board(ctx: Ctx, metric: Metric): BoardEntry[] {
  if (metric === "overall")
    return ctx.ranked.map((team) => ({
      team,
      value: team.height!,
      rank: team.rank!,
      tied: team.tied,
    }));
  const list = ctx.ranked
    .filter((t) => t[metric] !== null)
    .map((team) => ({ team, value: team[metric]! }))
    .sort((a, b) => b.value - a.value || a.team.id - b.team.id);
  return list.map((e) => ({
    ...e,
    rank: list.findIndex((x) => x.value === e.value) + 1,
    tied: list.filter((x) => x.value === e.value).length > 1,
  }));
}
