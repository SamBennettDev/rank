import { buildEdges, listSnapshots } from "../src/engine/graph";
import { STOP_GAP, STOP_STIFFNESS, gameValue, result } from "../src/engine/rating";
import type { Edge, Game, RankedTeam, Ranking, SeasonIndexEntry, Team } from "../src/engine/types";

export type View = "list" | "graph" | "team" | "about";

export interface Ctx {
  seasons: SeasonIndexEntry[];
  entry: SeasonIndexEntry;
  snapId: string;
  ranking: Ranking;
  games: Game[];
  teams: Map<number, Team>;
  /** Counted games in this snapshot, loser -> winner. */
  edges: Edge[];
  byId: Map<number, RankedTeam>;
  /** Teams with a rank, best first. */
  ranked: RankedTeam[];
  /** Games where head-to-head broke a close call (the winner is held above the loser). */
  heldIds: Set<number>;
}

export function makeCtx(base: Omit<Ctx, "edges" | "byId" | "ranked" | "heldIds">): Ctx {
  const spec = listSnapshots(base.games).find((s) => s.id === base.snapId)!;
  const { edges } = buildEdges(base.games, base.ranking.teams, spec);
  return {
    ...base,
    edges,
    byId: new Map(base.ranking.teams.map((t) => [t.id, t])),
    ranked: base.ranking.teams.filter((t) => t.rank !== null),
    heldIds: new Set(base.ranking.held ?? []),
  };
}

export const href = (season: string, snap: string, view: View, teamId?: number) =>
  `#/${season}/${snap}/${view}${teamId === undefined ? "" : `/${teamId}`}`;
export const teamHref = (ctx: Ctx, id: number) => href(ctx.entry.season, ctx.snapId, "team", id);

export const rankLabel = (rank: number | null, tied: boolean) => (rank === null ? "—" : `${tied ? "T-" : ""}${rank}`);
/** Ratings are in points and print with 1 decimal. */
export const fmtHeight = (v: number | null, d = 1) => (v === null ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d));
export const record = (t: RankedTeam) => `${t.wins}-${t.losses}`;

/** A game is an upset when the winner is rated below the loser; biggest gap first. */
export function upsets(ctx: Ctx): { edge: Edge; gap: number }[] {
  return ctx.edges
    .map((edge) => ({ edge, gap: ctx.byId.get(edge.loser)!.height! - ctx.byId.get(edge.winner)!.height! }))
    .filter((u) => u.gap > 0)
    .sort((a, b) => b.gap - a.gap || a.edge.gameId - b.edge.gameId);
}

export interface GameLine {
  edge: Edge;
  won: boolean;
  opponent: RankedTeam;
  /** +1 home, -1 away, 0 neutral, from this team's side. */
  where: -1 | 0 | 1;
  /** This team's points minus the opponent's. */
  margin: number;
  /** Margin plus the win bonus (or minus it in a loss). */
  result: number;
  /** What this game alone says the team's rating is. */
  value: number;
  /** Head-to-head broke a close call in this game. */
  held: boolean;
  /** That hold's push on this team's rating sum (+ up, − down); 0 when it is not engaged. */
  hold: number;
}

/**
 * Rebuilds a team's rating the way the model defines it: what each of its games says
 * (opponent rating + result, adjusted for home field) plus any head-to-head holds,
 * summed and divided by games + shrink. At the published solution this reproduces the rating.
 */
export function breakdown(ctx: Ctx, teamId: number): { lines: GameLine[]; shrink: number; holds: number; average: number } {
  const m = ctx.ranking.manifest;
  const lines = ctx.edges
    .filter((e) => e.winner === teamId || e.loser === teamId)
    .map((edge) => {
      const won = edge.winner === teamId;
      const opponent = ctx.byId.get(won ? edge.loser : edge.winner)!;
      const atHome = won ? edge.winnerIsHome : !edge.winnerIsHome;
      const where: -1 | 0 | 1 = edge.neutralSite ? 0 : atHome ? 1 : -1;
      const margin = won ? edge.winnerPoints - edge.loserPoints : edge.loserPoints - edge.winnerPoints;
      const held = ctx.heldIds.has(edge.gameId);
      const me = ctx.byId.get(teamId)!;
      const gap = won ? me.height! - opponent.height! : opponent.height! - me.height!;
      const push = held && gap < STOP_GAP ? STOP_STIFFNESS * (STOP_GAP - gap) : 0;
      return { edge, won, opponent, where, margin, result: result(margin, m.winBonus), value: gameValue(opponent.height!, margin, where, m.homeField, m.winBonus), held, hold: won ? push : -push };
    });
  const holds = lines.reduce((s, l) => s + l.hold, 0);
  const average = (lines.reduce((s, l) => s + l.value, 0) + holds) / (lines.length + m.shrink);
  return { lines, shrink: m.shrink, holds, average };
}

export type Metric = "overall" | "offense" | "defense" | "special";
export const METRICS: Metric[] = ["overall", "offense", "defense", "special"];
export const METRIC_LABEL: Record<Metric, string> = { overall: "Overall", offense: "Offense", defense: "Defense", special: "Special teams" };
export const METRIC_HINT: Record<Metric, string> = {
  overall: "Points better than an average FBS or FCS team, from every score this season, who it came against and home field; head-to-head breaks ties within a field goal. Every team starts the season level.",
  offense: "Points per game the offense adds over an average offense: expected points per snap from play-by-play, garbage time removed, adjusted for the defenses it faced and home field.",
  defense: "Points per game the defense saves compared with an average defense: expected points per snap allowed, garbage time removed, adjusted for the offenses it faced and home field.",
  special: "Points per game gained on kickoffs, punts, field goals and returns compared with an average team, adjusted for opponents.",
};

export interface BoardEntry { team: RankedTeam; value: number; rank: number; tied: boolean }

/** Ranked teams by one metric, best first; teams without a value for it are left out. Equal values share a rank. */
export function board(ctx: Ctx, metric: Metric): BoardEntry[] {
  const pick = (t: RankedTeam) => (metric === "overall" ? t.height : t[metric]);
  const list = ctx.ranked.flatMap((t) => (pick(t) === null ? [] : [{ team: t, value: pick(t)! }])).sort((a, b) => b.value - a.value || a.team.id - b.team.id);
  return list.map((e) => {
    const rank = list.findIndex((x) => x.value === e.value) + 1;
    return { ...e, rank, tied: list.filter((x) => x.value === e.value).length > 1 };
  });
}
