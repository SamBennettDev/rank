import { svg } from "./dom";

const icon = (d: string, size = 16) => {
  const s = svg("svg", {
    viewBox: "0 0 24 24",
    width: size,
    height: size,
    fill: "none",
    stroke: "currentColor",
    "stroke-width": 2,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  });
  s.innerHTML = d;
  return s;
};

export const searchIcon = () =>
  icon('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>');
export const filterIcon = () => icon('<path d="M4 6h16M7 12h10M10 18h4"/>', 18);
export const navIcons = {
  projection: () => icon('<path d="M4 19h16M5 16l5-6 4 3 5-8M15 5h4v4"/>', 18),
  list: () =>
    icon(
      '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01" stroke-width="3"/>',
      18,
    ),
  graph: () =>
    icon(
      '<circle cx="12" cy="5" r="2.5"/><circle cx="5.5" cy="18" r="2.5"/><circle cx="18.5" cy="15" r="2.5"/><path d="M10.8 7.2 6.7 15.8M13.3 7.1l4 5.6M8 17.6l8-2"/>',
      18,
    ),
  about: () =>
    icon('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>', 18),
  matchups: () =>
    icon('<path d="M4 7h13l-3-3M20 17H7l3 3M17 7l-3 3M7 17l3-3"/>', 18),
};
export const arrowLeft = () => icon('<path d="M15 18l-6-6 6-6"/>', 14);
export const tri = (up: boolean) => {
  const s = svg("svg", { viewBox: "0 0 10 10", "aria-hidden": "true" });
  s.innerHTML = up
    ? '<path d="M5 1.5 9 8H1z" fill="currentColor"/>'
    : '<path d="M5 8.5 1 2h8z" fill="currentColor"/>';
  return s;
};
export const pillarIcons = {
  deterministic: () =>
    icon(
      '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1.2" fill="currentColor"/><circle cx="15" cy="15" r="1.2" fill="currentColor"/><circle cx="15" cy="9" r="1.2" fill="currentColor"/><circle cx="9" cy="15" r="1.2" fill="currentColor"/>',
      18,
    ),
  auditable: () =>
    icon(
      '<path d="M9 12l2 2 4-4"/><path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z"/>',
      18,
    ),
  transparent: () =>
    icon(
      '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
      18,
    ),
  unbiased: () =>
    icon(
      '<path d="M12 3v18M5 7h14M5 7l-3 6a3 3 0 0 0 6 0zM19 7l-3 6a3 3 0 0 0 6 0z"/>',
      18,
    ),
};
