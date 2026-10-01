import { select } from "d3-selection";
import { zoom, zoomIdentity } from "d3-zoom";
import { buildEdges, listSnapshots } from "../../src/engine/graph";
import { LAYOUT_HEIGHT, layoutY } from "../../src/engine/layout";
import { svg, h } from "../dom";
import { type Ctx, controls, conferenceColors, demoBanner, fmtHeight, href, rankLabel } from "../ctx";

const R = 7;

export function graphView(ctx: Ctx): HTMLElement {
  const colors = conferenceColors(ctx.ranking);
  const spec = listSnapshots(ctx.games).find((s) => s.id === ctx.snapId)!;
  const { edges } = buildEdges(ctx.games, ctx.ranking.teams, spec);
  const nodes = ctx.ranking.teams.filter((t) => t.rank !== null);
  const byId = new Map(nodes.map((t) => [t.id, t]));
  const heights = nodes.map((t) => t.height!);
  const min = Math.min(...heights);
  const max = Math.max(...heights);
  const pos = (id: number) => ({ x: byId.get(id)!.x!, y: layoutY(byId.get(id)!.height!, min, max) });

  const xs = nodes.map((t) => t.x!);
  const x0 = Math.min(...xs) - 70;
  const x1 = Math.max(...xs) + 30;
  const root = svg("svg", { viewBox: `${x0} ${-30} ${x1 - x0} ${LAYOUT_HEIGHT + 60}`, role: "img", "aria-label": "Game graph: each team's vertical position is its ranking height" });
  const g = svg("g");
  root.appendChild(g);

  // Horizontal guides at whole-number heights.
  for (let v = Math.ceil(min); v <= Math.floor(max); v++) {
    const y = layoutY(v, min, max);
    g.appendChild(svg("line", { class: "grid", x1: x0, x2: x1, y1: y, y2: y, "vector-effect": "non-scaling-stroke" }));
    const label = svg("text", { class: "gridlabel", x: x0 + 4, y: y - 4 });
    label.textContent = v === 0 ? "0" : (v > 0 ? "+" : "") + v;
    g.appendChild(label);
  }

  const edgeEls = new Map<number, SVGLineElement[]>();
  const link = (id: number, el: SVGLineElement) => (edgeEls.get(id) ?? edgeEls.set(id, []).get(id)!).push(el);
  for (const e of edges) {
    const a = pos(e.loser);
    const b = pos(e.winner);
    const upset = byId.get(e.winner)!.height! < byId.get(e.loser)!.height!;
    const line = svg("line", { class: upset ? "edge upset" : "edge", x1: a.x, y1: a.y, x2: b.x, y2: b.y, "vector-effect": "non-scaling-stroke" });
    g.appendChild(line);
    link(e.winner, line);
    link(e.loser, line);
  }

  const box = h("div", { class: "graphbox" });
  const tip = h("div", { class: "tip" });
  const circles = new Map<number, SVGCircleElement>();
  const neighbors = new Map<number, Set<number>>();
  for (const e of edges) {
    (neighbors.get(e.winner) ?? neighbors.set(e.winner, new Set()).get(e.winner)!).add(e.loser);
    (neighbors.get(e.loser) ?? neighbors.set(e.loser, new Set()).get(e.loser)!).add(e.winner);
  }
  const clear = () => {
    box.classList.remove("focus");
    tip.style.display = "none";
    g.querySelectorAll(".hi").forEach((el) => el.classList.remove("hi"));
  };

  for (const t of nodes) {
    const c = svg("circle", { class: "node", cx: t.x!, cy: layoutY(t.height!, min, max), r: R, fill: colors.get(t.conference)!, "vector-effect": "non-scaling-stroke" });
    circles.set(t.id, c);
    c.addEventListener("pointerenter", (ev) => {
      clear();
      box.classList.add("focus");
      c.classList.add("hi");
      for (const n of neighbors.get(t.id) ?? []) circles.get(n)?.classList.add("hi");
      for (const l of edgeEls.get(t.id) ?? []) l.classList.add("hi");
      tip.textContent = `${rankLabel(t.rank, t.tied)}. ${t.school} (${t.wins}-${t.losses}) · height ${fmtHeight(t.height)} · ${t.conference}`;
      tip.style.display = "block";
      const r = box.getBoundingClientRect();
      tip.style.left = `${Math.min(ev.clientX - r.left + 12, r.width - 260)}px`;
      tip.style.top = `${ev.clientY - r.top + 12}px`;
    });
    c.addEventListener("pointerleave", clear);
    c.addEventListener("click", () => (location.hash = href(ctx.entry.season, ctx.snapId, "team", t.id)));
    g.appendChild(c);
  }

  const z = zoom<SVGSVGElement, unknown>().scaleExtent([1, 40]).on("zoom", (ev) => g.setAttribute("transform", ev.transform.toString()));
  select(root).call(z).call(z.transform, zoomIdentity);

  box.append(
    root,
    tip,
    h("div", { class: "legend" },
      h("div", {}, "Up is better. A team's vertical position is its height. Columns group conferences; sideways position carries no rank."),
      h("div", {}, h("i"), "Upset: the winner ended up below the loser."),
      h("div", { class: "muted" }, "Scroll to zoom, drag to pan, click a team for its games.")),
  );

  return h(
    "div",
    {},
    demoBanner(ctx),
    controls(ctx, "graph", [h("span", { class: "muted" }, `${nodes.length} teams · ${edges.length} games`)]),
    box,
  );
}
