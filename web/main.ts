import { h } from "./dom";
import { type Ctx, type View, href, makeCtx } from "./ctx";
import { loadGames, loadIndex, loadRanking, loadTeams } from "./store";
import { aboutView } from "./views/about";
import { graphView } from "./views/graph";
import { listView } from "./views/list";
import { teamView } from "./views/team";
import type { SeasonIndexEntry } from "../src/engine/types";

const app = document.getElementById("app")!;
const nav = document.getElementById("nav")!;
const picker = document.getElementById("picker")!;
let seasons: SeasonIndexEntry[] = [];
let cleanup: (() => void) | null = null;

function defaultEntry(): SeasonIndexEntry {
  const real = seasons.filter((s) => !s.demo && s.snapshots.length > 0);
  const pool = real.length > 0 ? real : seasons.filter((s) => s.snapshots.length > 0);
  const entry = pool.at(-1);
  if (!entry) throw new Error("No ranking data has been published yet.");
  return entry;
}

function renderChrome(ctx: Ctx, view: View, teamId?: number) {
  const s = ctx.entry.season;
  const link = (label: string, v: View, on: boolean) =>
    h("a", { href: href(s, ctx.snapId, v), class: on ? "on" : "", "aria-current": on ? "page" : false }, label);
  nav.replaceChildren(
    link("Rankings", "list", view === "list" || view === "team"),
    link("Graph", "graph", view === "graph"),
    link("Method", "about", view === "about"),
  );
  document.getElementById("foot-method")?.setAttribute("href", href(s, ctx.snapId, "about"));

  // Season + week pickers keep the current view (and team) when changed.
  const go = (season: string, snap: string) => (location.hash = href(season, snap, view, view === "team" ? teamId : undefined));
  const seasonSel = h("select", {
    "aria-label": "Season",
    onchange: (e: Event) => {
      const next = seasons.find((x) => x.season === (e.target as HTMLSelectElement).value)!;
      go(next.season, (next.snapshots.find((x) => x.id === ctx.snapId) ?? next.snapshots.at(-1)!).id);
    },
  }, ...seasons.map((x) => h("option", { value: x.season, selected: x.season === s }, x.season)));
  const idx = ctx.entry.snapshots.findIndex((x) => x.id === ctx.snapId);
  const step = (d: number) => {
    const next = ctx.entry.snapshots[idx + d];
    return h("button", { class: "step", disabled: !next, "aria-label": d < 0 ? "Previous week" : "Next week", onclick: () => next && go(s, next.id) }, d < 0 ? "‹" : "›");
  };
  const weekSel = h("select", { "aria-label": "Week", onchange: (e: Event) => go(s, (e.target as HTMLSelectElement).value) },
    ...[...ctx.entry.snapshots].reverse().map((x) => h("option", { value: x.id, selected: x.id === ctx.snapId }, x.label)));
  picker.replaceChildren(
    seasons.length > 1 ? h("div", { class: "sel" }, seasonSel) : h("span", { class: "season-tag" }, s),
    h("div", { class: "weekpick" }, step(-1), h("div", { class: "sel" }, weekSel), step(1)),
  );
}

async function route() {
  try {
    if (seasons.length === 0) seasons = await loadIndex();
    const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
    const [season, snapId] = parts;
    let view = (parts[2] ?? "list") as View;

    if (!season || !seasons.some((x) => x.season === season)) {
      const e = defaultEntry();
      location.replace(href(e.season, e.snapshots.at(-1)!.id, season === "about" ? "about" : "list"));
      return;
    }
    const entry = seasons.find((x) => x.season === season)!;
    if (!snapId || !entry.snapshots.some((x) => x.id === snapId)) {
      location.replace(href(season, entry.snapshots.at(-1)!.id, view));
      return;
    }
    if (!["list", "graph", "team", "about"].includes(view)) view = "list";
    const teamId = view === "team" ? Number(parts[3]) : undefined;

    const [ranking, games, teams] = await Promise.all([loadRanking(season, snapId), loadGames(season), loadTeams(season)]);
    const ctx = makeCtx({ seasons, entry, snapId, ranking, games, teams });
    renderChrome(ctx, view, teamId);

    cleanup?.();
    cleanup = null;
    document.body.dataset.view = view;
    const node =
      view === "graph" ? graphView(ctx, (fn) => (cleanup = fn))
      : view === "team" ? teamView(ctx, teamId!)
      : view === "about" ? aboutView(ctx)
      : listView(ctx);
    app.replaceChildren(node);
    if (view !== "graph") window.scrollTo(0, 0);
  } catch (err) {
    app.replaceChildren(h("div", { class: "empty" }, h("h2", {}, "Couldn’t load rankings"), h("p", { class: "muted" }, err instanceof Error ? err.message : String(err))));
  }
}

window.addEventListener("hashchange", route);
void route();
