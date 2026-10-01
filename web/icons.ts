import { svg } from "./dom";

const icon = (d: string, size = 16) => {
  const s = svg("svg", { viewBox: "0 0 24 24", width: size, height: size, fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" });
  s.innerHTML = d;
  return s;
};

export const searchIcon = () => icon('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>');
export const arrowLeft = () => icon('<path d="M15 18l-6-6 6-6"/>', 14);
export const tri = (up: boolean) => {
  const s = svg("svg", { viewBox: "0 0 10 10", "aria-hidden": "true" });
  s.innerHTML = up ? '<path d="M5 1.5 9 8H1z" fill="currentColor"/>' : '<path d="M5 8.5 1 2h8z" fill="currentColor"/>';
  return s;
};
export const pillarIcons = {
  deterministic: () => icon('<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1.2" fill="currentColor"/><circle cx="15" cy="15" r="1.2" fill="currentColor"/><circle cx="15" cy="9" r="1.2" fill="currentColor"/><circle cx="9" cy="15" r="1.2" fill="currentColor"/>', 18),
  auditable: () => icon('<path d="M9 12l2 2 4-4"/><path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z"/>', 18),
  transparent: () => icon('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', 18),
  unbiased: () => icon('<path d="M12 3v18M5 7h14M5 7l-3 6a3 3 0 0 0 6 0zM19 7l-3 6a3 3 0 0 0 6 0z"/>', 18),
};
