import { h } from "./dom";
import { type Ctx, type View, href } from "./ctx";
import { loadGames, loadIndex, loadRanking } from "./store";
import { aboutView } from "./views/about";
import { graphView } from "./views/graph";
import { listView } from "./views/list";
import { teamView } from "./views/team";
import type { SeasonIndexEntry } from "../src/engine/types";

const app = document.getElementById("app")!;
const nav = document.getElementById("nav")!;
let seasons: SeasonIndexEntry[] = [];

function defaultEntry(): SeasonIndexEntry {
  const real = seasons.filter((s) => !s.demo && s.snapshots.length > 0);
  const pool = real.length > 0 ? real : seasons.filter((s) => s.snapshots.length > 0);
  const entry = pool.at(-1);
  if (!entry) throw new Error("No ranking data has been published yet.");
  return entry;
}

function renderNav(ctx: Ctx | null, view: View) {
  const s = ctx?.entry.season ?? defaultEntry().season;
  const snap = ctx?.snapId ?? defaultEntry().snapshots.at(-1)!.id;
  const link = (label: string, v: View, on: boolean) => h("a", { href: href(s, snap, v), class: on ? "on" : "" }, label);
  nav.replaceChildren(link("Rankings", "list", view === "list" || view === "team"), link("Graph", "graph", view === "graph"), link("How it works", "about", view === "about"));
}

async function route() {
  try {
    if (seasons.length === 0) seasons = await loadIndex();
    const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
    let season = parts[0];
    let snapId = parts[1];
    let view = (parts[2] ?? "list") as View;

    if (!season || season === "about" || !seasons.some((s) => s.season === season)) {
      const wantAbout = season === "about";
      const e = defaultEntry();
      location.replace(href(e.season, e.snapshots.at(-1)!.id, wantAbout ? "about" : "list"));
      return;
    }
    const entry = seasons.find((s) => s.season === season)!;
    if (!snapId || !entry.snapshots.some((s) => s.id === snapId)) {
      location.replace(href(season, entry.snapshots.at(-1)!.id, view));
      return;
    }
    if (!["list", "graph", "team", "about"].includes(view)) view = "list";

    const [ranking, games] = await Promise.all([loadRanking(season, snapId), loadGames(season)]);
    const ctx: Ctx = { seasons, entry, snapId, ranking, games };
    renderNav(ctx, view);
    app.className = "";
    document.querySelector("main")!.classList.toggle("wide", view === "graph");
    app.replaceChildren(
      view === "graph" ? graphView(ctx)
      : view === "team" ? teamView(ctx, Number(parts[3]))
      : view === "about" ? aboutView(ctx)
      : listView(ctx),
    );
    window.scrollTo(0, 0);
  } catch (err) {
    renderNav(null, "list");
    app.replaceChildren(h("p", { class: "pad" }, `Could not load rankings: ${err instanceof Error ? err.message : String(err)}`));
  }
}

window.addEventListener("hashchange", route);
void route();
