import { select } from "d3-selection";
import { type ZoomTransform, zoom, zoomIdentity } from "d3-zoom";
import type { Edge, RankedTeam } from "../../src/engine/types";
import { type Ctx, restLabel, fmtHeight, rankLabel, record, teamHref, upsets } from "../ctx";
import { h, svg } from "../dom";
import { searchIcon } from "../icons";
import { computeLayout } from "../layout";
import { logo, shortConf, svgLogo, teamVars } from "../team";

const NODE = 24;
type EdgeMode = "none" | "upsets" | "all";

export function graphView(ctx: Ctx, onCleanup: (fn: () => void) => void): HTMLElement {
  const nodes = ctx.ranked;
  const L = computeLayout(nodes.map((t) => ({ id: t.id, height: t.height!, lane: t.conference })), {
    node: NODE, laneWidth: 66, plotHeight: Math.max(1000, nodes.length * 4.6),
  });
  const P = (id: number) => L.pos.get(id)!;
  const upsetSet = new Map(upsets(ctx).map((u) => [u.edge.gameId, u.gap]));
  const isUpset = (e: Edge) => upsetSet.has(e.gameId);
  const adj = new Map<number, Edge[]>();
  for (const e of ctx.edges) for (const id of [e.winner, e.loser]) (adj.get(id) ?? adj.set(id, []).get(id)!).push(e);

  // ---------------------------------------------------------------- svg scene
  const root = svg("svg", { role: "img", "aria-label": "The game graph. Each team sits at its ranking height; higher is better." });
  const scene = svg("g");
  const gBack = svg("g");
  const gEdges = svg("g");
  const gFocus = svg("g");
  const gNodes = svg("g");
  scene.append(gBack, gEdges, gFocus, gNodes);
  root.appendChild(scene);

  // Lane stripes + angled conference labels.
  L.lanes.forEach((lane, i) => {
    if (i % 2 === 0) gBack.appendChild(svg("rect", { class: "lane-bg", x: lane.x - 33, y: L.top - 24, width: 66, height: L.height - L.top + 8, rx: 10 }));
    const fcs = nodes.find((t) => t.conference === lane.name)?.classification === "fcs";
    const label = svg("text", { class: `lane-label${fcs ? " fcs" : ""}`, transform: `translate(${lane.x - 6},${L.top - 30}) rotate(-38)` });
    label.textContent = shortConf(lane.name);
    gBack.appendChild(label);
  });

  // Rank guides: the y of the team holding each landmark rank, plus the Top 25 cut.
  const right = L.width - 8;
  const tick = (y: number, text: string, cls = "") => {
    const g = svg("g", { class: `tick ${cls}` });
    g.append(svg("line", { x1: L.left - 6, x2: right, y1: y, y2: y }));
    const t = svg("text", { x: 6, y: y - 5 });
    t.textContent = text;
    g.appendChild(t);
    gBack.appendChild(g);
  };
  for (const r of [1, 10, 50, 100, 150, 200, 250]) {
    const t = nodes.find((n) => n.rank! >= r);
    if (t && r <= nodes.length) tick(L.y(t.height!), `#${r}`);
  }
  const n25 = nodes.filter((t) => t.rank! <= 25).at(-1);
  const n26 = nodes.find((t) => t.rank! > 25);
  if (n25 && n26) tick((L.y(n25.height!) + L.y(n26.height!)) / 2, "TOP 25", "top25");

  const curve = (e: Edge) => {
    const a = P(e.loser);
    const b = P(e.winner);
    const cx = (a.x + b.x) / 2 + (b.y - a.y) * 0.12;
    return `M${a.x},${a.y} Q${cx},${(a.y + b.y) / 2} ${b.x},${b.y}`;
  };

  // Nodes: ring + logo, monogram underneath if the logo cannot load.
  const nodeEls = new Map<number, SVGGElement>();
  for (const t of nodes) {
    const tl = ctx.teams.get(t.id);
    const p = P(t.id);
    const g = svg("g", { class: "nd tv", transform: `translate(${p.x},${p.y})`, style: teamVars(tl?.color), tabindex: 0, role: "button", "aria-label": `${t.school}, rank ${rankLabel(t.rank, t.tied)}` });
    g.appendChild(svg("circle", { class: "ring", r: NODE / 2 + 1.5 }));
    const mono = svg("g", { class: "mono" });
    mono.appendChild(svg("circle", { r: NODE / 2 - 1 }));
    const mt = svg("text", {});
    mt.textContent = (tl?.abbreviation ?? t.abbreviation).slice(0, 4);
    mono.appendChild(mt);
    g.appendChild(mono);
    const img = svg("image", { x: -NODE / 2 + 2, y: -NODE / 2 + 2, width: NODE - 4, height: NODE - 4, preserveAspectRatio: "xMidYMid meet" });
    g.appendChild(img);
    svgLogo(img, t.id, 64, () => g.classList.add("failed"));
    g.addEventListener("pointerenter", (ev) => hover(t, ev as PointerEvent));
    g.addEventListener("pointermove", (ev) => moveTip(ev as PointerEvent));
    g.addEventListener("pointerleave", () => hover(null));
    g.addEventListener("click", (ev) => { ev.stopPropagation(); selectTeam(t.id); });
    g.addEventListener("keydown", (ev) => { if ((ev as KeyboardEvent).key === "Enter") selectTeam(t.id); });
    gNodes.appendChild(g);
    nodeEls.set(t.id, g);
  }

  // ---------------------------------------------------------------- edges
  let mode: EdgeMode = "none";
  const drawEdges = () => {
    const list = mode === "all" ? ctx.edges : mode === "upsets" ? ctx.edges.filter(isUpset) : [];
    gEdges.replaceChildren(...list.map((e) => svg("path", { class: `e ${isUpset(e) ? "up" : "all"}`, d: curve(e) })));
  };

  let selected: number | null = null;
  const focus = (id: number | null) => {
    for (const el of gNodes.querySelectorAll(".hi")) el.classList.remove("hi");
    gFocus.replaceChildren();
    scene.classList.toggle("focus", id !== null);
    if (id === null) return;
    nodeEls.get(id)?.classList.add("hi");
    for (const e of adj.get(id) ?? []) {
      const won = e.winner === id;
      nodeEls.get(won ? e.loser : e.winner)?.classList.add("hi");
      gFocus.appendChild(svg("path", { class: `e ${won ? "w" : "l"}${isUpset(e) ? " up" : ""}`, d: curve(e) }));
    }
    // keep the focused node on top
    const el = nodeEls.get(id);
    if (el) gNodes.appendChild(el);
  };

  // ---------------------------------------------------------------- tooltip
  const canvas = h("div", { class: "canvas" }, root);
  const tip = h("div", { class: "tip" });
  canvas.appendChild(tip);
  const moveTip = (ev: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    const x = ev.clientX - r.left + 14;
    tip.style.left = `${Math.min(x, r.width - tip.offsetWidth - 8)}px`;
    tip.style.top = `${ev.clientY - r.top + 14}px`;
  };
  const hover = (t: RankedTeam | null, ev?: PointerEvent) => {
    if (!t) {
      tip.style.display = "none";
      focus(selected);
      return;
    }
    tip.replaceChildren(
      h("div", { class: "rk" }, rankLabel(t.rank, t.tied)),
      logo(ctx.teams.get(t.id), 30),
      h("div", {}, h("div", { class: "t1" }, t.school), h("div", { class: "t2" }, `${record(t)} · height ${fmtHeight(t.height)} · ${t.conference}`)),
    );
    tip.style.display = "flex";
    if (ev) moveTip(ev);
    focus(t.id);
  };

  // ---------------------------------------------------------------- zoom
  const z = zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.3, 6])
    .filter((ev: Event) => (ev.type === "wheel" ? (ev as WheelEvent).ctrlKey || (ev as WheelEvent).metaKey : !(ev as MouseEvent).button))
    .on("zoom", (ev: { transform: ZoomTransform }) => scene.setAttribute("transform", ev.transform.toString()));
  const sel = select(root);
  sel.call(z).on("dblclick.zoom", null);
  // Plain wheel / two-finger scroll pans; pinch or ctrl+wheel zooms.
  root.addEventListener("wheel", (ev) => {
    if (ev.ctrlKey || ev.metaKey) return;
    ev.preventDefault();
    const k = (root as unknown as { __zoom?: ZoomTransform }).__zoom?.k ?? 1;
    z.translateBy(sel, -ev.deltaX / k, -ev.deltaY / k);
  }, { passive: false });
  const fit = () => {
    const W = canvas.clientWidth || 1000;
    const H = canvas.clientHeight || 700;
    const k = Math.min(W / L.width, 1.15);
    const ty = L.height * k < H ? (H - L.height * k) / 2 : 0;
    z.transform(sel, zoomIdentity.translate((W - L.width * k) / 2, ty).scale(k));
  };
  const centerOn = (id: number) => {
    const p = P(id);
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    const cur = (root as unknown as { __zoom?: ZoomTransform }).__zoom?.k ?? 1;
    const k = Math.max(cur, 1.3);
    z.transform(sel, zoomIdentity.translate(W / 2 - p.x * k, H / 2 - p.y * k).scale(k));
  };
  root.addEventListener("click", () => selectTeam(null));

  // ---------------------------------------------------------------- side panel
  const panel = h("aside", { class: "gpanel", "aria-live": "polite" });
  const defaultPanel = () => {
    const ups = upsets(ctx).slice(0, 12);
    panel.replaceChildren(
      h("div", { class: "sec" },
        h("h3", {}, "How to read it"),
          h("p", {}, `Every win is a spring pulling the winner ${restLabel(ctx)} above the loser`, ". Where all the springs balance is each team’s height, and height is rank. Columns group conferences, strongest on the left; sideways position carries no rank."),
        h("p", {}, "Hover or tap a team to see its games: green lines go to teams it beat, red to teams it lost to. Scroll to pan, pinch or ⌘-scroll to zoom.")),
      h("div", { class: "sec" },
        h("h3", {}, "Biggest upsets"),
        ups.length === 0 ? h("p", {}, "None. Every winner sits above every team it beat.") : "",
        ...ups.map((u, i) => {
          const w = ctx.byId.get(u.edge.winner)!;
          const l = ctx.byId.get(u.edge.loser)!;
          return h("div", { class: "uprow", role: "button", tabindex: 0, onclick: () => { selectTeam(w.id); centerOn(w.id); } },
            h("span", { class: "ix" }, String(i + 1)),
            h("div", { class: "pair" },
              h("div", { class: "logos" }, logo(ctx.teams.get(w.id), 26), logo(ctx.teams.get(l.id), 20)),
              h("div", { class: "txt" },
                h("span", { class: "w" }, `#${rankLabel(w.rank, w.tied)} ${w.school}`),
                h("span", { class: "bt" }, `beat #${rankLabel(l.rank, l.tied)} ${l.school}, ${u.edge.winnerPoints}–${u.edge.loserPoints}`))),
            h("span", { class: "g", title: "How far below the loser the winner finished" }, `−${u.gap.toFixed(2)}`));
        })),
    );
  };
  const teamPanel = (id: number) => {
    const t = ctx.byId.get(id)!;
    const tl = ctx.teams.get(id);
    const games = [...(adj.get(id) ?? [])].sort((a, b) => (a.seasonType === b.seasonType ? 0 : a.seasonType === "regular" ? -1 : 1) || a.week - b.week);
    panel.replaceChildren(
      h("div", { class: "pcard tv", style: teamVars(tl?.color) },
        h("button", { class: "x", "aria-label": "Close", onclick: () => selectTeam(null) }, "×"),
        h("div", { class: "row1" }, logo(tl, 52), h("div", {}, h("div", { class: "nm" }, t.school), h("div", { class: "cf" }, `${t.conference} · ${t.classification.toUpperCase()}`))),
        h("div", { class: "stats" },
          h("div", {}, h("b", {}, rankLabel(t.rank, t.tied)), h("span", {}, "Rank")),
          h("div", {}, h("b", {}, record(t)), h("span", {}, "Record")),
          h("div", {}, h("b", {}, fmtHeight(t.height)), h("span", {}, "Height")))),
      h("div", { class: "glist" },
        ...games.map((e) => {
          const won = e.winner === id;
          const o = ctx.byId.get(won ? e.loser : e.winner)!;
          return h("div", { class: "grow", role: "button", tabindex: 0, onclick: () => { selectTeam(o.id); centerOn(o.id); } },
            logo(ctx.teams.get(o.id), 24),
            h("div", { class: "op" }, h("span", {}, o.school), h("small", {}, `#${rankLabel(o.rank, o.tied)}`), isUpset(e) ? h("span", { class: "up" }, "UPSET") : ""),
            h("span", { class: `res ${won ? "w" : "l"}` }, `${won ? "W" : "L"} ${won ? e.winnerPoints : e.loserPoints}–${won ? e.loserPoints : e.winnerPoints}`));
        })),
      h("a", { class: "morelink", href: teamHref(ctx, id) }, "Full breakdown →"),
    );
    panel.scrollTop = 0;
  };
  const selectTeam = (id: number | null) => {
    if (selected !== null) nodeEls.get(selected)?.classList.remove("sel");
    selected = id;
    if (id !== null) {
      nodeEls.get(id)?.classList.add("sel");
      teamPanel(id);
    } else defaultPanel();
    focus(id);
  };

  // ---------------------------------------------------------------- toolbar
  const modeSeg = h("div", { class: "seg", role: "group", "aria-label": "Show games" });
  const drawSeg = () => modeSeg.replaceChildren(...(([["No lines", "none"], ["Upsets", "upsets"], ["All games", "all"]] as [string, EdgeMode][])
    .map(([label, m]) => h("button", { class: mode === m ? "on" : "", "aria-pressed": mode === m, onclick: () => { mode = m; drawSeg(); drawEdges(); } }, label))));
  drawSeg();
  const listId = "graph-teams";
  const finder = h("input", { type: "search", placeholder: "Jump to team", list: listId, "aria-label": "Jump to team",
    onchange: (e: Event) => {
      const v = (e.target as HTMLInputElement).value.trim().toLowerCase();
      const t = nodes.find((n) => n.school.toLowerCase() === v) ?? nodes.find((n) => n.school.toLowerCase().startsWith(v));
      if (t) { selectTeam(t.id); centerOn(t.id); (e.target as HTMLInputElement).blur(); }
    } });
  const tools = h("div", { class: "gtools" },
    h("h1", {}, "The Graph"),
    modeSeg,
    h("label", { class: "search" }, searchIcon(), finder, h("datalist", { id: listId }, ...nodes.map((t) => h("option", { value: t.school })))),
    h("div", { class: "zoom" },
      h("button", { "aria-label": "Zoom in", onclick: () => z.scaleBy(sel, 1.3) }, "+"),
      h("button", { "aria-label": "Zoom out", onclick: () => z.scaleBy(sel, 1 / 1.3) }, "−"),
      h("button", { "aria-label": "Fit", title: "Fit to screen", onclick: fit }, "⤢")),
  );
  const legend = h("div", { class: "legend" },
    h("span", { class: "up-arrow" }, "↑ Higher is better"),
    h("span", {}, h("i", { class: "lw" }), "Beat"),
    h("span", {}, h("i", { class: "ll" }), "Lost to"),
    h("span", {}, h("i", { class: "lu" }), "Upset (winner finished lower)"));
  canvas.appendChild(legend);

  const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") selectTeam(null); };
  window.addEventListener("keydown", onKey);
  onCleanup(() => window.removeEventListener("keydown", onKey));

  defaultPanel();
  drawEdges();
  requestAnimationFrame(fit);
  return h("div", { class: "gshell" }, h("div", { class: "gmain" }, tools, canvas), panel);
}
