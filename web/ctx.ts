import type { Game, Ranking, SeasonIndexEntry } from "../src/engine/types";
import { h } from "./dom";

export type View = "list" | "graph" | "team" | "about";

export interface Ctx {
  seasons: SeasonIndexEntry[];
  entry: SeasonIndexEntry;
  snapId: string;
  ranking: Ranking;
  games: Game[];
}

export const href = (season: string, snap: string, view: View, teamId?: number) =>
  `#/${season}/${snap}/${view}${teamId === undefined ? "" : `/${teamId}`}`;

export const rankLabel = (rank: number | null, tied: boolean) => (rank === null ? "—" : `${tied ? "T-" : ""}${rank}`);

export const fmtHeight = (v: number | null) => (v === null ? "—" : (v > 0 ? "+" : "") + v.toFixed(3));

/** Stable colour per conference (sorted by name so colours never depend on data order). */
const PALETTE = ["#2563eb", "#dc2626", "#16a34a", "#d97706", "#9333ea", "#0891b2", "#db2777", "#65a30d", "#ea580c", "#4f46e5", "#0d9488", "#ca8a04", "#7c3aed", "#be123c", "#0369a1", "#15803d"];
export function conferenceColors(ranking: Ranking): Map<string, string> {
  const names = [...new Set(ranking.teams.map((t) => t.conference))].sort();
  return new Map(names.map((n, i) => [n, PALETTE[i % PALETTE.length]!]));
}

/** Season picker, week picker and the List/Graph toggle shared by both main views. */
export function controls(ctx: Ctx, view: "list" | "graph", extra: Node[] = []): HTMLElement {
  const go = (season: string, snap: string) => {
    location.hash = href(season, snap, view);
  };
  const seasonSel = h(
    "select",
    {
      "aria-label": "Season",
      onchange: (e: Event) => {
        const s = ctx.seasons.find((x) => x.season === (e.target as HTMLSelectElement).value)!;
        const keep = s.snapshots.find((x) => x.id === ctx.snapId);
        go(s.season, (keep ?? s.snapshots.at(-1)!).id);
      },
    },
    ...ctx.seasons.map((s) => h("option", { value: s.season, selected: s.season === ctx.entry.season }, s.label)),
  );
  const weekSel = h(
    "select",
    { "aria-label": "Week", onchange: (e: Event) => go(ctx.entry.season, (e.target as HTMLSelectElement).value) },
    ...[...ctx.entry.snapshots].reverse().map((s) => h("option", { value: s.id, selected: s.id === ctx.snapId }, s.label)),
  );
  const seg = h(
    "div",
    { class: "seg", role: "group", "aria-label": "View" },
    ...(["list", "graph"] as const).map((v) =>
      h("button", { class: v === view ? "on" : "", onclick: () => (location.hash = href(ctx.entry.season, ctx.snapId, v)) }, v === "list" ? "List" : "Graph"),
    ),
  );
  return h("div", { class: "controls" }, seasonSel, weekSel, seg, ...extra);
}

export function demoBanner(ctx: Ctx): HTMLElement | null {
  return ctx.entry.demo
    ? h("div", { class: "banner" }, "This is a ", h("b", {}, "fictional demo season"), " used to show how the site works. Real results appear here once game data has been fetched.")
    : null;
}
