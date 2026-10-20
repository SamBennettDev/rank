import { buildEdges } from "../src/engine/graph";
import type {
  Edge,
  Game,
  RankedTeam,
  Ranking,
  SeasonIndexEntry,
  Team,
} from "../src/engine/types";

export type View = "list" | "graph" | "team" | "about" | "matchups";
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
export const href = (
  season: string,
  snap: string,
  view: View,
  teamId?: number,
) => `#/${season}/${snap}/${view}${teamId === undefined ? "" : `/${teamId}`}`;
export const teamHref = (ctx: Ctx, id: number) =>
  href(ctx.entry.season, ctx.snapId, "team", id);
export const rankLabel = (rank: number | null, tied: boolean) =>
  rank === null ? "—" : `${tied ? "T-" : ""}${rank}`;
export const fmtHeight = (v: number | null, d = 1) =>
  v === null ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d);
export const record = (t: RankedTeam) => `${t.wins}-${t.losses}`;
export function upsets(ctx: Ctx) {
  return ctx.edges
    .filter(
      (e) =>
        ctx.byId.get(e.winner)?.rank !== null &&
        ctx.byId.get(e.loser)?.rank !== null,
    )
    .map((edge) => ({
      edge,
      gap:
        ctx.byId.get(edge.loser)!.height! - ctx.byId.get(edge.winner)!.height!,
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
  /** Where this game's spring wants the team: opponent's height + 1 after a win, − 1 after a loss. */
  value: number;
  /** Pass-2 spring strength (0–2). */
  pull: number;
}
/**
 * Rebuilds a team's height the way the spring graph defines it: the pull-weighted
 * average of what its games say, with `rankShrink` weight on 0 (an average team).
 */
export function breakdown(ctx: Ctx, teamId: number) {
  const springs = new Map(ctx.ranking.springs.map((s) => [s.gameId, s]));
  const lines: GameLine[] = ctx.edges
    .filter((e) => e.winner === teamId || e.loser === teamId)
    .flatMap((edge) => {
      const spring = springs.get(edge.gameId);
      if (!spring) return [];
      const won = edge.winner === teamId,
        opponent = ctx.byId.get(won ? edge.loser : edge.winner)!,
        home = won ? edge.winnerIsHome : !edge.winnerIsHome;
      const where: -1 | 0 | 1 = edge.neutralSite ? 0 : home ? 1 : -1,
        margin = won
          ? edge.winnerPoints - edge.loserPoints
          : edge.loserPoints - edge.winnerPoints;
      return [
        {
          edge,
          won,
          opponent,
          where,
          margin,
          value: opponent.height! + (won ? 1 : -1),
          pull: spring.pull,
        },
      ];
    });
  const shrink = ctx.ranking.manifest.springs.rankShrink;
  const totalPull = lines.reduce((sum, l) => sum + l.pull, 0);
  const pulled = lines.reduce((sum, l) => sum + l.pull * l.value, 0);
  return {
    lines,
    shrink,
    totalPull,
    pulled,
    height: pulled / (totalPull + shrink),
  };
}
export type Metric = "overall" | "offense" | "defense" | "special";
export const METRICS: Metric[] = ["overall", "offense", "defense", "special"];
export const METRIC_LABEL: Record<Metric, string> = {
  overall: "Height",
  offense: "Offense",
  defense: "Defense",
  special: "Special teams",
};
export const METRIC_HINT: Record<Metric, string> = {
  overall:
    "Height on the game graph. Every game is a spring holding its winner one step above its loser; the score doesn't matter. Beating a good team or losing to a bad one pulls hard; beating a bad team or losing to a good one barely pulls.",
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
