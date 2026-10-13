import { h } from "./dom";

export function provisionalFlag() {
  return h("span", {
    class: "provisional-dot",
    role: "img",
    "aria-label": "Provisional: limited opponent evidence",
    title: "Provisional: limited opponent evidence",
  });
}
