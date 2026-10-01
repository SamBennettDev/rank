import { buildEdges, listSnapshots } from "../src/engine/graph";
import { edgeWeight } from "../src/engine/season";
import type { Edge, Game, RankedTeam, Ranking, SeasonIndexEntry, Team, ViewId } from "../src/engine/types";

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
  /** Which published ranking is being shown. */
  mode: ViewId;
  /** The other published ranking for this snapshot, when the season has two. */
  alt: Ranking | null;
  altById: Map<number, RankedTeam>;
}

type CtxBase = Omit<Ctx, "edges" | "byId" | "ranked" | "altById">;

/** Builds the context. `format` sets how heights print (only the page's main ranking should). */
export function makeCtx(base: CtxBase, format = true): Ctx {
  const mf = base.ranking.manifest;
  if (format) heightDecimals = mf.method === "gridiron" ? 1 : (mf.restLength ?? 1) > 1 ? 2 : 3;
  const spec = listSnapshots(base.games).find((s) => s.id === base.snapId)!;
  const { edges } = buildEdges(base.games, base.ranking.teams, spec);
  return {
    ...base,
    edges,
    byId: new Map(base.ranking.teams.map((t) => [t.id, t])),
    ranked: base.ranking.teams.filter((t) => t.rank !== null),
    altById: new Map((base.alt?.teams ?? []).map((t) => [t.id, t])),
  };
}

/** The same snapshot seen through the other ranking (e.g. Power numbers on a Résumé page). */
export function otherCtx(ctx: Ctx): Ctx | null {
  if (!ctx.alt) return null;
  return makeCtx({ ...ctx, ranking: ctx.alt, alt: ctx.ranking, mode: ctx.mode === "power" ? "resume" : "power" }, false);
}

export const hasPower = (ctx: Ctx) => (ctx.entry.views ?? []).includes("power");
export const MODE_LABEL: Record<ViewId, string> = { resume: "Résumé", power: "Power" };

/** The view mode carried in every link (`?by=power`); set by the router on each navigation. */
let currentMode: ViewId = "resume";
export const setMode = (m: ViewId) => (currentMode = m);

export const href = (season: string, snap: string, view: View, teamId?: number, mode: ViewId = currentMode) =>
  `#/${season}/${snap}/${view}${teamId === undefined ? "" : `/${teamId}`}${mode === "power" ? "?by=power" : ""}`;
export const teamHref = (ctx: Ctx, id: number) => href(ctx.entry.season, ctx.snapId, "team", id);

export const rankLabel = (rank: number | null, tied: boolean) => (rank === null ? "—" : `${tied ? "T-" : ""}${rank}`);
/** Gridiron ratings are points (one decimal); SpringRank heights are unitless (three). Set per snapshot by makeCtx. */
let heightDecimals = 3;
export const fmtHeight = (v: number | null) => (v === null ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(heightDecimals));
export const fmtPoints = (v: number) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(1);
export const record = (t: RankedTeam) => `${t.wins}-${t.losses}`;

/** SpringRank: how far above the loser each win wants the winner. */
export const restLength = (ctx: Ctx) => ctx.ranking.manifest.restLength ?? 1;
/** "7 points" or "one unit", for copy. */
export const restLabel = (ctx: Ctx) => (restLength(ctx) === 1 ? "one unit" : `${restLength(ctx)} points`);

/** True when springs are weighted by point differential (older files lack the field: win/loss). */
export const byMargin = (ctx: Ctx) => ctx.ranking.manifest.edgeWeight === "margin";

/** Spring stroke width for a game: thicker for bigger margins when weighting by margin. */
/** " (counted between 7 and 24 points)" when the margin is clamped, else "". */
export function clampNote(ctx: Ctx): string {
  const { minMargin: lo, maxMargin: hi } = ctx.ranking.manifest;
  if (lo !== undefined && hi !== undefined) return ` (counted between ${lo} and ${hi} points)`;
  if (lo !== undefined) return ` (at least ${lo} points)`;
  if (hi !== undefined) return ` (at most ${hi} points)`;
  return "";
}

/** Stiffness of a game's spring under the snapshot's SpringRank settings (margin clamped when configured). */
export function stiffness(ctx: Ctx, e: Edge): number {
  const m = ctx.ranking.manifest;
  return edgeWeight(e, m.edgeWeight ?? "win", m);
}

export const springWidth = (ctx: Ctx, e: Edge, base = 2) =>
  isGridiron(ctx) ? Math.max(0.8, base * 1.25 * springPull(ctx, e))
  : byMargin(ctx) ? Math.min(base + 5, base * 0.6 + stiffness(ctx, e) / 9) : base;

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
