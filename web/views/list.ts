import type { RankedTeam } from "../../src/engine/types";
import { delta, divTag } from "../bits";
import { type BoardEntry, type Ctx, METRICS, METRIC_HINT, METRIC_LABEL, type Metric, board, fmtHeight, rankLabel, record, teamHref } from "../ctx";
import { h } from "../dom";
import { filterIcon, searchIcon } from "../icons";
import { logo, teamVars } from "../team";

/** The metric the list is ranked by; kept while moving between weeks. */
let metric: Metric = "overall";

export function listView(ctx: Ctx): HTMLElement {
  const unranked = ctx.ranking.teams.filter((t) => t.rank === null);
  const look = (t: RankedTeam) => ctx.teams.get(t.id);
  const hasUnits = ctx.ranked.some((t) => t.offense !== null);
  if (!hasUnits) metric = "overall";
  let entries: BoardEntry[] = [];
  let lo = 0, hi = 0;
  const pct = (v: number) => (hi === lo ? 50 : ((v - lo) / (hi - lo)) * 100);
  const podium = h("section", { class: "podium", "aria-label": "Top five" });
  const hint = h("p", { class: "metric-hint" });
  const valueHead = h("div", { class: "hm" });

  // ---- podium (top 5 by the chosen metric) ----
  const drawPodium = () => podium.replaceChildren(...entries.slice(0, 5).map((e, i) => {
    const t = e.team, tl = look(t), big = i === 0;
    return h("a", { class: `pod tv${big ? " first" : ""}`, href: teamHref(ctx, t.id), style: teamVars(tl?.color) },
      logo(tl, big ? 300 : 190, { className: "wm" }),
      h("div", { class: "top" }, h("div", { class: "rk" }, rankLabel(e.rank, e.tied)), logo(tl, big ? 84 : 56)),
      h("div", {},
        h("div", { class: "name" }, t.school),
        h("div", { class: "meta" }, h("span", {}, record(t)), h("span", {}, "·"), big ? h("span", {}, t.conference) : "", big ? h("span", {}, "·") : "", h("span", {}, fmtHeight(e.value))),
        big ? "" : h("div", { class: "conf" }, t.conference)),
    );
  }));

  // ---- metric switch ----
  const tabs = h("div", { class: "metric-tabs", role: "tablist", "aria-label": "Rank by" });
  const drawTabs = () => tabs.replaceChildren(h("span", { class: "lbl" }, "Rank by"), ...METRICS.map((m) => h("button", {
    type: "button", role: "tab", class: m === metric ? "on" : "", "aria-selected": m === metric, disabled: m !== "overall" && !hasUnits,
    title: m !== "overall" && !hasUnits ? "No play-by-play for this season yet" : METRIC_HINT[m],
    onclick: () => { metric = m; drawTabs(); recompute(); },
  }, METRIC_LABEL[m])));
  const recompute = () => {
    entries = board(ctx, metric);
    const vs = entries.map((e) => e.value);
    hi = Math.max(...vs); lo = Math.min(...vs);
    const missing = ctx.ranked.length - entries.length;
    hint.textContent = METRIC_HINT[metric] + (missing > 0 ? ` ${missing} ranked team${missing === 1 ? " has" : "s have"} no play-by-play yet and ${missing === 1 ? "is" : "are"} left out.` : "");
    valueHead.textContent = metric === "overall" ? "Rating" : `${METRIC_LABEL[metric]} (points per game)`;
    drawPodium();
    render();
  };

  // ---- toolbar ----
  let query = "";
  let division: "all" | "fbs" | "fcs" = "all";
  let conference = "";
  let worstFirst = false;
  const body = h("div");
  const count = h("span", { class: "count" });

  const row = (e: BoardEntry) => {
    const t = e.team, tl = look(t);
    return h("a", { class: "row tv", href: teamHref(ctx, t.id), style: teamVars(tl?.color) },
      h("div", { class: `rank${e.tied ? " t" : ""}` }, rankLabel(e.rank, e.tied)),
      logo(tl, 40, { lazy: true }),
      h("div", { class: "who" }, h("span", { class: "n" }, t.school), h("span", { class: "c" }, divTag(t), t.conference)),
      h("div", { class: "rec" }, record(t)),
      h("div", { class: "meter", title: `${METRIC_LABEL[metric]} ${fmtHeight(e.value)}` },
        h("div", { class: "track" }, h("div", { class: "fill", style: `width:${pct(e.value)}%` }), h("div", { class: "knob", style: `left:${pct(e.value)}%` })),
        h("span", { class: "v" }, fmtHeight(e.value))),
      h("div", { class: "r ch" }, metric === "overall" ? delta(t.change) : ""),
    );
  };

  const render = () => {
    const match = ({ team: t }: { team: RankedTeam }) =>
      (division === "all" || t.classification === division) &&
      (!conference || t.conference === conference) &&
      (!query || t.school.toLowerCase().includes(query) || t.abbreviation.toLowerCase() === query);
    const list = (worstFirst ? [...entries].reverse() : entries).filter(match);
    const filtered = query !== "" || division !== "all" || conference !== "";
    const rows: Node[] = [];
    list.forEach((e, i) => {
      rows.push(row(e));
      // Mark the Top 25 boundary when browsing the full list.
      if (!filtered && !worstFirst && e.rank <= 25 && (list[i + 1]?.rank ?? 99) > 25) rows.push(h("div", { class: "cut" }, "Top 25 above"));
      if (!filtered && worstFirst && e.rank > 25 && (list[i + 1]?.rank ?? 0) <= 25) rows.push(h("div", { class: "cut" }, "Top 25 below"));
    });
    if (rows.length === 0) rows.push(h("div", { class: "noresults" }, "No teams match."));
    const extra = unranked.filter((t) => match({ team: t }));
    body.replaceChildren(...rows, extra.length ? h("div", { class: "unranked-note" }, `Not yet ranked (no counted games): ${extra.map((t) => t.school).join(", ")}`) : "");
    count.textContent = list.length === entries.length ? `${entries.length} teams` : `${list.length} of ${entries.length}`;
  };

  const segOf = <T extends string>(opts: [string, T][], get: () => T, set: (v: T) => void) => {
    const el = h("div", { class: "seg", role: "group" });
    const draw = () => el.replaceChildren(...opts.map(([label, v]) => h("button", { class: get() === v ? "on" : "", "aria-pressed": get() === v, onclick: () => { set(v); draw(); update(); } }, label)));
    draw();
    return { el, draw };
  };
  const conferences = [...new Set(ctx.ranked.map((t) => t.conference))].sort();
  const divSeg = segOf<"all" | "fbs" | "fcs">([["All", "all"], ["FBS", "fbs"], ["FCS", "fcs"]], () => division, (v) => { division = v; fillConferences(); });
  const orderSeg = segOf<"best" | "worst">([["Best → worst", "best"], ["Worst → best", "worst"]], () => (worstFirst ? "worst" : "best"), (v) => (worstFirst = v === "worst"));
  const confSel = h("select", { "aria-label": "Conference", onchange: (e: Event) => { conference = (e.target as HTMLSelectElement).value; update(); } });
  // Only offer conferences in the chosen division; drop a selection that no longer applies.
  const fillConferences = () => {
    const pool = conferences.filter((c) => division === "all" || ctx.ranked.some((t) => t.conference === c && t.classification === division));
    if (!pool.includes(conference)) conference = "";
    confSel.replaceChildren(h("option", { value: "" }, "All conferences"), ...pool.map((c) => h("option", { value: c, selected: c === conference }, c)));
    confSel.value = conference;
  };
  fillConferences();

  // Filters live in a popover behind one icon button; a badge counts the non-default settings.
  const badge = h("span", { class: "badge" });
  const filterBtn = h("button", { class: "fbtn", type: "button", "aria-label": "Filters", title: "Filters", "aria-haspopup": "dialog", "aria-expanded": "false", onclick: (e: Event) => { e.stopPropagation(); setOpen(!filterBtn.classList.contains("open")); } }, filterIcon(), badge);
  const reset = h("button", { class: "freset", type: "button", onclick: () => {
    division = "all"; conference = ""; worstFirst = false; fillConferences(); divSeg.draw(); orderSeg.draw(); update();
  } }, "Reset");
  const panel = h("div", { class: "fpanel", role: "dialog", "aria-label": "Filters", hidden: true, onclick: (e: Event) => e.stopPropagation() },
    h("div", { class: "fsec" }, h("div", { class: "flabel" }, "Division"), divSeg.el),
    h("div", { class: "fsec" }, h("div", { class: "flabel" }, "Conference"), h("div", { class: "sel" }, confSel)),
    h("div", { class: "fsec" }, h("div", { class: "flabel" }, "Order"), orderSeg.el),
    h("div", { class: "ffoot" }, reset, h("button", { class: "btn primary fdone", type: "button", onclick: () => setOpen(false) }, "Done")));
  const setOpen = (open: boolean) => {
    panel.hidden = !open;
    filterBtn.setAttribute("aria-expanded", String(open));
    filterBtn.classList.toggle("open", open);
  };
  const close = (e: Event) => {
    if (!panel.isConnected) return document.removeEventListener("click", close), document.removeEventListener("keydown", close);
    if (e.type === "click" || (e as KeyboardEvent).key === "Escape") setOpen(false);
  };
  document.addEventListener("click", close);
  document.addEventListener("keydown", close);
  const update = () => {
    const n = Number(division !== "all") + Number(conference !== "") + Number(worstFirst);
    badge.textContent = n ? String(n) : "";
    filterBtn.classList.toggle("active", n > 0);
    reset.disabled = n === 0;
    render();
  };

  const toolbar = h("div", { class: "toolbar" },
    h("label", { class: "search" }, searchIcon(), h("input", { type: "search", placeholder: "Find a team", "aria-label": "Find a team", oninput: (e: Event) => { query = (e.target as HTMLInputElement).value.trim().toLowerCase(); render(); } }), count),
    h("div", { class: "filter" }, filterBtn, panel),
  );

  drawTabs();
  recompute();
  update();
  return h("div", {},
    tabs,
    hint,
    podium,
    toolbar,
    h("section", { class: "ladder", "aria-label": "Full ranking" },
      h("div", { class: "lhead" }, h("div", { style: "text-align:center" }, "Rank"), h("div"), h("div", {}, "Team"), h("div", { class: "r" }, "W-L"), valueHead, h("div", { class: "r ch" }, "Week")),
      body),
  );
}
