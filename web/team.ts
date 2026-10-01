import type { Team } from "../src/engine/types";

/**
 * Team identity: colours and logos. Purely presentational; nothing here affects
 * the ranking. Team ids come from CollegeFootballData, which uses ESPN's ids, so
 * logos are loaded from ESPN's public logo CDN (the same URLs the CFBD API returns).
 */

export type TeamLook = Pick<Team, "id" | "abbreviation" | "color">;

const LOGO_BASE = "https://a.espncdn.com/combiner/i?img=/i/teamlogos/ncaa";
export const logoUrl = (id: number, px: number, dark = false) =>
  `${LOGO_BASE}/${dark ? "500-dark" : "500"}/${id}.png&w=${px}&h=${px}&scale=crop&cquality=80`;

export const prefersDark = () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;

// ---- colour maths -------------------------------------------------------

type RGB = [number, number, number];

function parseHex(hex: string | undefined): RGB | null {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? "").trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toHex = ([r, g, b]: RGB) => "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function luminance([r, g, b]: RGB): number {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
const contrast = (a: RGB, b: RGB) => {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1! + 0.05) / (l2! + 0.05);
};

const DARK_BG: RGB = [11, 13, 18];
const LIGHT_BG: RGB = [255, 255, 255];
const FALLBACK: RGB = [120, 130, 150];

/** The team colour nudged toward white/black until it reads on the given background. */
function readableOn(c: RGB, bg: RGB, min: number): string {
  const target: RGB = luminance(bg) < 0.5 ? [255, 255, 255] : [0, 0, 0];
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const m = mix(c, target, t);
    if (contrast(m, bg) >= min) return toHex(m);
  }
  return toHex(target);
}

export interface Palette {
  /** Brand colour as published. */
  base: string;
  /** Darker shade for gradients. */
  deep: string;
  /** Accent that stays legible on the dark and light page backgrounds. */
  onDark: string;
  onLight: string;
  /** Text colour to put on top of `base`. */
  ink: string;
}

const cache = new Map<string, Palette>();
export function palette(color: string | undefined): Palette {
  const key = color ?? "";
  let p = cache.get(key);
  if (!p) {
    const c = parseHex(color) ?? FALLBACK;
    p = {
      base: toHex(c),
      deep: toHex(mix(c, [0, 0, 0], 0.55)),
      onDark: readableOn(c, DARK_BG, 3.2),
      onLight: readableOn(c, LIGHT_BG, 3.2),
      ink: luminance(c) > 0.45 ? "#0b0d12" : "#ffffff",
    };
    cache.set(key, p);
  }
  return p;
}

/** Inline CSS custom properties consumed by styles.css (--tc, --tc-deep, --tc-ink, --ta-d, --ta-l). */
export function teamVars(color: string | undefined): string {
  const p = palette(color);
  return `--tc:${p.base};--tc-deep:${p.deep};--tc-ink:${p.ink};--ta-d:${p.onDark};--ta-l:${p.onLight}`;
}

// ---- logo elements --------------------------------------------------------

/**
 * A team logo that degrades gracefully: dark-mode variant -> standard logo ->
 * monogram in team colours. `size` is the rendered CSS size in px.
 */
export function logo(team: TeamLook | undefined, size: number, opts: { lazy?: boolean; className?: string } = {}): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = `logo ${opts.className ?? ""}`.trim();
  wrap.style.cssText = `width:${size}px;height:${size}px;${teamVars(team?.color)}`;
  const mono = document.createElement("span");
  mono.className = "mono";
  mono.textContent = (team?.abbreviation ?? "?").slice(0, 4);
  mono.style.fontSize = `${Math.max(8, size * (mono.textContent.length > 3 ? 0.26 : 0.32))}px`;
  wrap.appendChild(mono);
  if (!team) {
    wrap.classList.add("failed");
    return wrap;
  }
  const img = document.createElement("img");
  img.alt = "";
  img.decoding = "async";
  if (opts.lazy) img.loading = "lazy";
  const px = Math.min(500, Math.ceil(size * 2));
  const sources = prefersDark() ? [logoUrl(team.id, px, true), logoUrl(team.id, px)] : [logoUrl(team.id, px)];
  let i = 0;
  img.addEventListener("load", () => wrap.classList.add("loaded"));
  img.addEventListener("error", () => {
    i++;
    if (i < sources.length) img.src = sources[i]!;
    else {
      img.remove();
      wrap.classList.add("failed");
    }
  });
  img.src = sources[0]!;
  wrap.appendChild(img);
  return wrap;
}

/** Same fallback chain for an SVG <image>; the caller draws the monogram underneath. */
export function svgLogo(image: SVGImageElement, id: number, px: number, onFail: () => void): void {
  const sources = prefersDark() ? [logoUrl(id, px, true), logoUrl(id, px)] : [logoUrl(id, px)];
  let i = 0;
  image.addEventListener("error", () => {
    i++;
    if (i < sources.length) image.setAttribute("href", sources[i]!);
    else {
      image.remove();
      onFail();
    }
  });
  image.addEventListener("load", () => image.parentElement?.classList.add("loaded"));
  image.setAttribute("href", sources[0]!);
}

/** Short conference labels for tight spaces (graph lane headers, chips). */
const SHORT: Record<string, string> = {
  "American Athletic": "American", "Big Ten": "Big Ten", "Mid-American": "MAC", "Mountain West": "Mountain West",
  "Conference USA": "C-USA", "FBS Independents": "FBS Ind.", "FCS Independents": "FCS Ind.", "Coastal Athletic": "CAA",
  Southern: "SoCon", "Sun Belt": "Sun Belt",
};
export const shortConf = (c: string) => SHORT[c] ?? c;
