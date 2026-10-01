import type { ViewId } from "../src/engine/types";
import { type Ctx, type View, MODE_LABEL, hasPower, href } from "./ctx";
import { h, svg } from "./dom";

const SUB: Record<ViewId, string> = {
  resume: "Who has earned it · wins only",
  power: "Who would win · margins + home field",
};

function icon(mode: ViewId): SVGSVGElement {
  const s = svg("svg", { viewBox: "0 0 24 24", width: 18, height: 18, fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" });
  s.innerHTML = mode === "resume"
    ? '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3a3 3 0 0 1-3 4M7 5H4a3 3 0 0 0 3 4"/>' // trophy
    : '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>'; // bolt
  return s;
}

/**
 * The Résumé / Power switch. Résumé is the main ranking (earned, wins only);
 * Power is the predictive one. Links keep the current page, week and team.
 */
export function lens(ctx: Ctx, view: View, teamId?: number, compact = false): HTMLElement | null {
  if (!hasPower(ctx)) return null;
  return h("nav", { class: `lens${compact ? " compact" : ""}`, "aria-label": "Ranking type" },
    ...(["resume", "power"] as ViewId[]).map((m) =>
      h("a", { class: m === ctx.mode ? "on" : "", href: href(ctx.entry.season, ctx.snapId, view, teamId, m), "aria-current": m === ctx.mode ? "true" : false, title: SUB[m] },
        h("span", { class: "ic" }, icon(m)),
        h("span", { class: "tx" }, h("b", {}, MODE_LABEL[m]), compact ? "" : h("span", { class: "s" }, SUB[m])))));
}
