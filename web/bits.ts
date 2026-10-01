import type { RankedTeam } from "../src/engine/types";
import { h } from "./dom";
import { tri } from "./icons";

export function delta(change: number | null): HTMLElement {
  if (change === null) return h("span", { class: "delta flat", title: "No previous week" }, "–");
  if (change === 0) return h("span", { class: "delta flat", title: "No change" }, "—");
  const up = change > 0;
  return h("span", { class: `delta ${up ? "up" : "down"}`, title: `${up ? "Up" : "Down"} ${Math.abs(change)} since last week` }, tri(up), String(Math.abs(change)));
}

export const divTag = (t: Pick<RankedTeam, "classification">) => h("span", { class: "div" }, t.classification.toUpperCase());
