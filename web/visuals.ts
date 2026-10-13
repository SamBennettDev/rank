import type { TeamProjection } from "../src/engine/types";
import { h, svg } from "./dom";

export const percent = (p: number) => `${(100 * p).toFixed(1)}%`;

export function movement(current: number | null, projected: number | null) {
  if (current === null || projected === null)
    return h("span", { class: "delta flat" }, "—");
  const delta = current - projected;
  const arrow = svg("svg", {
    viewBox: "0 0 10 10",
    class: "delta-arrow",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": 1.8,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  });
  arrow.append(
    svg("path", { d: delta > 0 ? "M2 8 8 2M2 2h6v6" : "M2 2 8 8M2 8h6V2" }),
  );
  return h(
    "span",
    {
      class: `delta ${delta > 0 ? "up" : delta < 0 ? "down" : "flat"}`,
      title: `Projected ${Math.abs(delta)} ${Math.abs(delta) === 1 ? "place" : "places"} ${delta > 0 ? "higher" : delta < 0 ? "lower" : "changed"}`,
      "aria-label":
        delta === 0
          ? "Same projected position"
          : `Projected ${Math.abs(delta)} places ${delta > 0 ? "higher" : "lower"}`,
    },
    delta === 0 ? null : arrow,
    delta === 0 ? "—" : Math.abs(delta),
  );
}

export function provisionalFlag() {
  return h("span", {
    class: "provisional-dot",
    role: "img",
    "aria-label": "Provisional: limited opponent evidence",
    title: "Provisional: limited opponent evidence",
  });
}

export function chanceMeter(p: number, label = "Top 25 chance") {
  return h(
    "span",
    {
      class: "chance-meter",
      role: "img",
      "aria-label": `${label}: ${percent(p)}`,
    },
    h("b", {}, percent(p)),
    h(
      "span",
      { class: "chance-track", "aria-hidden": "true" },
      h("i", { style: `width:${p * 100}%` }),
    ),
  );
}

export function probabilityRing(p: number, label: string) {
  const picture = svg("svg", {
    viewBox: "0 0 64 64",
    "aria-hidden": "true",
    class: "probability-ring",
  });
  picture.append(
    svg("circle", { cx: 32, cy: 32, r: 27, class: "ring-track" }),
    svg("circle", {
      cx: 32,
      cy: 32,
      r: 27,
      class: "ring-fill",
      pathLength: 100,
      "stroke-dasharray": `${p * 100} 100`,
      opacity: p > 0 ? 1 : 0,
      transform: "rotate(-90 32 32)",
    }),
  );
  return h(
    "div",
    {
      class: "chance-ring",
      role: "img",
      "aria-label": `${label}: ${percent(p)}`,
    },
    h("div", { class: "ring-inner" }, picture, h("b", {}, percent(p))),
    h("span", {}, label),
  );
}

/** Shared linear rank axis in rows; team detail zooms to the relevant ranks. */
export function rankRange(
  current: number | null,
  p: TeamProjection,
  field: number,
  detail = false,
) {
  const maximum = detail
    ? Math.min(field, Math.max(25, current ?? 1, p.rankHigh, p.rank))
    : field;
  const W = detail ? 560 : 180,
    left = 8,
    right = W - 8;
  const x = (rank: number) =>
    left + ((rank - 1) / Math.max(1, maximum - 1)) * (right - left);
  const root = svg("svg", {
    viewBox: `0 0 ${W} ${detail ? 55 : 22}`,
    class: `rank-range${detail ? " detailed" : ""}`,
    role: "img",
    "aria-label": `${current === null ? "Unranked currently" : `Current rank ${current}`}. Projected rank ${p.rank}. 80% finish range ${p.rankLow} to ${p.rankHigh}. Rank axis 1 to ${maximum}.`,
  });
  root.append(
    svg("line", { x1: left, x2: right, y1: 10, y2: 10, class: "range-track" }),
    svg("rect", {
      x: x(p.rankLow),
      y: 7,
      width: Math.max(1, x(p.rankHigh) - x(p.rankLow)),
      height: 6,
      rx: 3,
      class: "range-band",
    }),
  );
  if (current !== null)
    root.append(
      svg("line", {
        x1: x(current),
        x2: x(current),
        y1: 4,
        y2: 9,
        class: "range-current-stem",
      }),
      svg("circle", { cx: x(current), cy: 3.5, r: 3, class: "range-current" }),
    );
  const px = x(p.rank);
  root.append(
    svg("line", {
      x1: px,
      x2: px,
      y1: 10,
      y2: 15,
      class: "range-projected-stem",
    }),
    svg("path", { d: `M${px} 12l4 4-4 4-4-4z`, class: "range-projected" }),
  );
  if (detail) {
    const ticks = [...new Set([1, Math.round((maximum + 1) / 2), maximum])];
    for (const rank of ticks) {
      const label = svg("text", {
        x: x(rank),
        y: 43,
        "text-anchor":
          rank === 1 ? "start" : rank === maximum ? "end" : "middle",
        class: "range-axis",
      });
      label.textContent = `#${rank}`;
      root.append(label);
    }
  }
  return root;
}
