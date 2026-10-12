import { buildEdges, listSnapshots } from "../src/engine/graph";
import { push } from "../src/engine/springrank";
import type { Edge, Game, Method, RankedTeam, Ranking, SeasonIndexEntry, Team } from "../src/engine/types";

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
  /** Which published ranking method is shown. */
  method: Method;
  /** Games accepted as upsets in this ranking (their winner may finish below their loser). */
  upsetIds: Set<number>;
}

export function makeCtx(base: Omit<Ctx, "edges" | "byId" | "ranked" | "upsetIds">): Ctx {
  const spec = listSnapshots(base.games).find((s) => s.id === base.snapId)!;
  const { edges } = buildEdges(base.games, base.ranking.teams, spec);
  return {
    ...base,
    edges,
    byId: new Map(base.ranking.teams.map((t) => [t.id, t])),
    ranked: base.ranking.teams.filter((t) => t.rank !== null),
    upsetIds: new Set(base.ranking.upsets ?? []),
  };
}

export const METHOD_LABEL: Record<Method, string> = { win: "Wins", margin: "Margin" };
export const METHOD_HINT: Record<Method, string> = {
  win: "Every win counts the same: only who won matters",
  margin: "Each game counts by its score margin",
};

/** The height gap a game's spring wants between winner and loser under the shown method. */
export const targetGap = (ctx: Ctx, e: Edge) =>
  ctx.method === "win" ? ctx.ranking.manifest.restLength ?? 1 : e.winnerPoints - e.loserPoints;

/** Win is the default; links carry `?method=margin` otherwise. Set by the router on each navigation. */
let currentMethod: Method = "win";
export const setMethod = (m: Method) => (currentMethod = m);

export const href = (season: string, snap: string, view: View, teamId?: number, method: Method = currentMethod) =>
  `#/${season}/${snap}/${view}${teamId === undefined ? "" : `/${teamId}`}${method === "win" ? "" : `?method=${method}`}`;
export const teamHref = (ctx: Ctx, id: number) => href(ctx.entry.season, ctx.snapId, "team", id);

export const rankLabel = (rank: number | null, tied: boolean) => (rank === null ? "—" : `${tied ? "T-" : ""}${rank}`);
/** Heights are in score points and print with 2 decimals. */
export const fmtHeight = (v: number | null) => (v === null ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(2));
export const record = (t: RankedTeam) => `${t.wins}-${t.losses}`;

/** Upsets are the games the ranking accepted as upsets (published in the ranking file), biggest height gap first. */
export function upsets(ctx: Ctx): { edge: Edge; gap: number }[] {
  return ctx.edges
    .filter((edge) => ctx.upsetIds.has(edge.gameId))
    .map((edge) => ({ edge, gap: ctx.byId.get(edge.loser)!.height! - ctx.byId.get(edge.winner)!.height! }))
    .sort((a, b) => b.gap - a.gap || a.edge.gameId - b.edge.gameId);
}

/** How hard a game's spring pushes its winner up and its loser down (0 to 1), with the gap it pushes for. */
export function springPush(ctx: Ctx, e: Edge): { push: number; target: number; upset: boolean } {
  const target = targetGap(ctx, e);
  const gap = ctx.byId.get(e.winner)!.height! - ctx.byId.get(e.loser)!.height!;
  return { push: push(gap, target, ctx.ranking.manifest.softness), target, upset: ctx.upsetIds.has(e.gameId) };
}
