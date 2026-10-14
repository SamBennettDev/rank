import { buildEdges } from "../src/engine/graph";
import { HOLD_GAP, HOLD_STIFFNESS } from "../src/engine/springs";
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
  /** Where this game's spring wants the team: opponent's height + gap after a win, − gap after a loss. */
  value: number;
  /** Pass-2 spring strength (0–2). */
  pull: number;
  /** Steps this game wants between winner and loser. */
  gap: number;
  /** Head-to-head hold on this game. */
  held: boolean;
  /** That hold's push on this team's weighted sum (+ up, − down); 0 when slack. */
  hold: number;
}
/**
 * Rebuilds a team's height the way the spring graph defines it: the pull-weighted
 * average of what its games say, plus any engaged head-to-head holds, with
 * `rankShrink` weight on 0 (an average team).
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
      const me = ctx.byId.get(teamId)!;
      const apart = won
        ? me.height! - opponent.height!
        : opponent.height! - me.height!;
      const push =
        spring.held && apart < HOLD_GAP
          ? HOLD_STIFFNESS * (HOLD_GAP - apart)
          : 0;
      return [
        {
          edge,
          won,
          opponent,
          where,
          margin,
          value: opponent.height! + (won ? spring.gap : -spring.gap),
          pull: spring.pull,
          gap: spring.gap,
          held: spring.held,
          hold: won ? push : -push,
        },
      ];
    });
  const shrink = ctx.ranking.manifest.springs.rankShrink;
  const totalPull = lines.reduce((sum, l) => sum + l.pull, 0);
  const holds = lines.reduce((sum, l) => sum + l.hold, 0);
  const pulled = lines.reduce((sum, l) => sum + l.pull * l.value, 0) + holds;
  return {
    lines,
    shrink,
    totalPull,
    holds,
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
    "Height on the game graph. Every game is a spring holding its winner above its loser: one step for the win, more for a bigger margin, with each extra point counting less. Beating a good team or losing to a bad one pulls hard; beating a bad team or losing to a good one barely pulls. Head-to-head breaks close calls.",
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
