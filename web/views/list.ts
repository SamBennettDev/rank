import type { RankedTeam } from "../../src/engine/types";
import { delta, divTag } from "../bits";
import { type Ctx, byMargin, fmtHeight, rankLabel, record, teamHref, upsets } from "../ctx";
import { h } from "../dom";
import { searchIcon } from "../icons";
import { logo, teamVars } from "../team";

export function listView(ctx: Ctx): HTMLElement {
  const { ranked } = ctx;
  const unranked = ctx.ranking.teams.filter((t) => t.rank === null);
  const look = (t: RankedTeam) => ctx.teams.get(t.id);
  const hs = ranked.map((t) => t.height!);
  const hi = Math.max(...hs);
  const lo = Math.min(...hs);
  const pct = (v: number) => (hi === lo ? 50 : ((v - lo) / (hi - lo)) * 100);

  // ---- hero ----
  const nUpsets = upsets(ctx).length;
  const fbs = ranked.filter((t) => t.classification === "fbs").length;
  const hero = h("section", { class: "hero" },
    h("div", { class: "eyebrow" }, `${ctx.entry.season} season · ${ctx.ranking.snapshot.label}`),
    h("h1", {}, "Every team.", h("br"), h("em", {}, "One ladder.")),
    h("p", { class: "lede" }, "All ", h("b", {}, `${ranked.length} FBS and FCS teams`), " ranked from best to worst by one thing only: ", h("b", {}, byMargin(ctx) ? "who beat whom, and by how much" : "who beat whom"), ". No votes, no preseason bias, no reputation. Anyone can recompute it."),
    h("div", { class: "chips" },
      h("span", { class: "chip" }, h("b", {}, String(ctx.ranking.manifest.counts.included)), "games counted"),
      h("span", { class: "chip" }, h("b", {}, String(fbs)), "FBS ·", h("b", {}, String(ranked.length - fbs)), "FCS"),
      h("span", { class: "chip" }, h("b", {}, String(nUpsets)), "upsets in the graph"),
      h("a", { class: "chip", href: `#/${ctx.entry.season}/${ctx.snapId}/about` }, h("span", { class: "dot" }), "Reproducible · verify it"),
    ),
  );

  // ---- podium (top 5) ----
  const podium = h("section", { class: "podium", "aria-label": "Top five" },
    ...ranked.slice(0, 5).map((t, i) => {
      const tl = look(t);
      const big = i === 0;
      return h("a", { class: `pod tv${big ? " first" : ""}`, href: teamHref(ctx, t.id), style: teamVars(tl?.color) },
        logo(tl, big ? 300 : 190, { className: "wm" }),
        h("div", { class: "top" }, h("div", { class: "rk" }, rankLabel(t.rank, t.tied)), logo(tl, big ? 84 : 56)),
        h("div", {},
          h("div", { class: "name" }, t.school),
          h("div", { class: "meta" }, h("span", {}, record(t)), h("span", {}, "·"), big ? h("span", {}, t.conference) : "", big ? h("span", {}, "·") : "", h("span", {}, fmtHeight(t.height))),
          big ? "" : h("div", { class: "conf" }, t.conference)),
      );
    }),
  );

  // ---- toolbar ----
  let query = "";
  let division: "all" | "fbs" | "fcs" = "all";
  let conference = "";
  let worstFirst = false;
  const body = h("div");
  const count = h("span", { class: "count" });

  const row = (t: RankedTeam) => {
    const tl = look(t);
    return h("a", { class: "row tv", href: teamHref(ctx, t.id), style: teamVars(tl?.color) },
      h("div", { class: `rank${t.tied ? " t" : ""}` }, rankLabel(t.rank, t.tied)),
      logo(tl, 40, { lazy: true }),
      h("div", { class: "who" }, h("span", { class: "n" }, t.school), h("span", { class: "c" }, divTag(t), t.conference)),
      h("div", { class: "rec" }, record(t)),
      h("div", { class: "meter", title: `Height ${fmtHeight(t.height)}` },
        h("div", { class: "track" }, h("div", { class: "fill", style: `width:${pct(t.height!)}%` }), h("div", { class: "knob", style: `left:${pct(t.height!)}%` })),
        h("span", { class: "v" }, fmtHeight(t.height))),
      h("div", { class: "r ch" }, delta(t.change)),
    );
  };

  const render = () => {
    const match = (t: RankedTeam) =>
      (division === "all" || t.classification === division) &&
      (!conference || t.conference === conference) &&
      (!query || t.school.toLowerCase().includes(query) || t.abbreviation.toLowerCase() === query);
    const list = (worstFirst ? [...ranked].reverse() : ranked).filter(match);
    const filtered = query !== "" || division !== "all" || conference !== "";
    const rows: Node[] = [];
    list.forEach((t, i) => {
      rows.push(row(t));
      // Mark the Top 25 boundary when browsing the full list.
      if (!filtered && !worstFirst && t.rank! <= 25 && (list[i + 1]?.rank ?? 99) > 25) rows.push(h("div", { class: "cut" }, "Top 25 above"));
      if (!filtered && worstFirst && t.rank! > 25 && (list[i + 1]?.rank ?? 0) <= 25) rows.push(h("div", { class: "cut" }, "Top 25 below"));
    });
    if (rows.length === 0) rows.push(h("div", { class: "noresults" }, "No teams match."));
    const extra = unranked.filter(match);
    body.replaceChildren(...rows, extra.length ? h("div", { class: "unranked-note" }, `Not yet ranked (no counted games): ${extra.map((t) => t.school).join(", ")}`) : "");
    count.textContent = `${list.length} of ${ranked.length} teams`;
  };

  const segOf = <T extends string>(opts: [string, T][], get: () => T, set: (v: T) => void) => {
    const el = h("div", { class: "seg", role: "group" });
    const draw = () => el.replaceChildren(...opts.map(([label, v]) => h("button", { class: get() === v ? "on" : "", "aria-pressed": get() === v, onclick: () => { set(v); draw(); render(); } }, label)));
    draw();
    return el;
  };
  const conferences = [...new Set(ranked.map((t) => t.conference))].sort();
  const toolbar = h("div", { class: "toolbar" },
    h("label", { class: "search" }, searchIcon(), h("input", { type: "search", placeholder: "Find a team", "aria-label": "Find a team", oninput: (e: Event) => { query = (e.target as HTMLInputElement).value.trim().toLowerCase(); render(); } })),
    segOf<"all" | "fbs" | "fcs">([["All", "all"], ["FBS", "fbs"], ["FCS", "fcs"]], () => division, (v) => (division = v)),
    h("div", { class: "sel" }, h("select", { "aria-label": "Conference", onchange: (e: Event) => { conference = (e.target as HTMLSelectElement).value; render(); } },
      h("option", { value: "" }, "All conferences"), ...conferences.map((c) => h("option", { value: c }, c)))),
    segOf<"best" | "worst">([["Best → worst", "best"], ["Worst → best", "worst"]], () => (worstFirst ? "worst" : "best"), (v) => (worstFirst = v === "worst")),
    count,
  );

  render();
  return h("div", {},
    hero,
    podium,
    toolbar,
    h("section", { class: "ladder", "aria-label": "Full ranking" },
      h("div", { class: "lhead" }, h("div", { style: "text-align:center" }, "Rank"), h("div"), h("div", {}, "Team"), h("div", { class: "r" }, "W-L"), h("div", { class: "hm" }, "Height in the graph"), h("div", { class: "r ch" }, "Week")),
      body),
  );
}
