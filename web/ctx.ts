import { buildEdges, listSnapshots } from "../src/engine/graph";
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
}

export function makeCtx(base: Omit<Ctx, "edges" | "byId" | "ranked">): Ctx {
  heightDecimals = base.ranking.manifest.method === "gridiron" ? 1 : 3;
  const spec = listSnapshots(base.games).find((s) => s.id === base.snapId)!;
  const { edges } = buildEdges(base.games, base.ranking.teams, spec);
  return {
    ...base,
    edges,
    byId: new Map(base.ranking.teams.map((t) => [t.id, t])),
    ranked: base.ranking.teams.filter((t) => t.rank !== null),
  };
}

export const href = (season: string, snap: string, view: View, teamId?: number) =>
  `#/${season}/${snap}/${view}${teamId === undefined ? "" : `/${teamId}`}`;
export const teamHref = (ctx: Ctx, id: number) => href(ctx.entry.season, ctx.snapId, "team", id);

export const rankLabel = (rank: number | null, tied: boolean) => (rank === null ? "—" : `${tied ? "T-" : ""}${rank}`);
/** Gridiron ratings are points (one decimal); SpringRank heights are unitless (three). Set per snapshot by makeCtx. */
let heightDecimals = 3;
export const fmtHeight = (v: number | null) => (v === null ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(heightDecimals));
export const fmtPoints = (v: number) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(1);
export const record = (t: RankedTeam) => `${t.wins}-${t.losses}`;

/** True when springs are weighted by point differential (older files lack the field: win/loss). */
export const byMargin = (ctx: Ctx) => ctx.ranking.manifest.edgeWeight === "margin";

/** Spring stroke width for a game: thicker for bigger margins when weighting by margin. */
export const springWidth = (ctx: Ctx, e: Edge, base = 2) =>
  isGridiron(ctx) ? Math.max(0.8, base * 1.25 * springPull(ctx, e))
  : byMargin(ctx) ? Math.min(base + 5, base * 0.6 + (e.winnerPoints - e.loserPoints) / 9) : base;

// ---- Gridiron Springs helpers ------------------------------------------------

export const isGridiron = (ctx: Ctx) => ctx.ranking.manifest.method === "gridiron";
export const gridironParams = (ctx: Ctx) => ctx.ranking.manifest.gridiron;
export const homeField = (ctx: Ctx) => ctx.ranking.manifest.gridiron?.homeFieldPoints ?? 0;

export type Site = "home" | "away" | "neutral";

/** Predicted margin for `teamId` against `oppId` at a site, from the published ratings (gridiron only). */
export function expectedMargin(ctx: Ctx, teamId: number, oppId: number, site: Site): number {
  const hf = site === "neutral" ? 0 : site === "home" ? homeField(ctx) : -homeField(ctx);
  return ctx.byId.get(teamId)!.height! - ctx.byId.get(oppId)!.height! + hf;
}

/**
 * Rating gap -> predicted score margin. Each spring credits the winner `winBonus`
 * points on top of the margin, so the bonus comes back off; a gap smaller than the
 * bonus is a toss-up (predicted margin 0, edge to the higher-rated side).
 */
export function predictedMargin(ctx: Ctx, gap: number): number {
  const bonus = gridironParams(ctx)?.winBonus ?? 0;
  return Math.sign(gap) * Math.max(0, Math.abs(gap) - bonus);
}

/** Where a game was played, from one team's point of view. */
export function siteFor(e: Edge, teamId: number): Site {
  if (e.neutralSite) return "neutral";
  return (e.winner === teamId) === e.winnerIsHome ? "home" : "away";
}

/**
 * How hard a game's spring pulls at equilibrium (1 = full). Under Gridiron Springs a
 * game more than `blowoutLimit` points beyond expectation pulls at limit/|residual|.
 * Recomputed from the published ratings, so anyone can check it.
 */
export function springPull(ctx: Ctx, e: Edge): number {
  const g = gridironParams(ctx);
  if (!g) return 1;
  const target = e.winnerPoints - e.loserPoints + g.winBonus;
  const res = Math.abs(target - expectedMargin(ctx, e.winner, e.loser, siteFor(e, e.winner)));
  return res <= g.blowoutLimit ? 1 : g.blowoutLimit / res;
}

/** A game is an upset when the winner finished below the loser. */
export function upsets(ctx: Ctx): { edge: Edge; gap: number }[] {
  return ctx.edges
    .map((edge) => ({ edge, gap: ctx.byId.get(edge.loser)!.height! - ctx.byId.get(edge.winner)!.height! }))
    .filter((u) => u.gap > 0)
    .sort((a, b) => b.gap - a.gap || a.edge.gameId - b.edge.gameId);
}
