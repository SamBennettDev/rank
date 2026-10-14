import { choleskySolve } from "./linalg";
import { expFixed } from "./probability";
import type { SpringSettings } from "./types";

export type { SpringSettings };

/** One game on the graph: a spring from the loser up to the winner. */
export interface Spring {
  winner: number;
  loser: number;
  /** Winner's points minus loser's points (always > 0). */
  margin: number;
  /** +1 when the winner was at home, −1 when it was away, 0 at a neutral site. */
  site: -1 | 0 | 1;
}

/** A held winner is kept at least this far above its loser... */
export const HOLD_GAP = 0.05;
/** ...by a one-sided spring this stiff. */
export const HOLD_STIFFNESS = 1000;

const LN2 = 0.6931471805599453;
/** Natural log with + − × / only, so published bytes never depend on Math.log. */
export function logFixed(x: number): number {
  if (!(x > 0) || !Number.isFinite(x))
    throw new Error("logFixed needs a finite x > 0");
  let k = 0;
  while (x >= 2) {
    x /= 2;
    k++;
  }
  while (x < 1) {
    x *= 2;
    k--;
  }
  const z = (x - 1) / (x + 1),
    z2 = z * z;
  let term = z,
    sum = 0;
  for (let i = 1; i <= 41; i += 2) {
    sum += term / i;
    term *= z2;
  }
  return k * LN2 + 2 * sum;
}

/** Chance a team at this pass-1 height beats an average (height 0) team. */
export const quality = (strength: number, scale: number) => {
  const e = expFixed(-Math.abs(strength) * scale);
  return strength >= 0 ? 1 / (1 + e) : e / (1 + e);
};

/**
 * Pass-2 spring strength for one game: quality(loser) + (1 − quality(winner)).
 * Beating a good team or losing to a bad one is a stiff spring; beating a bad team
 * or losing to a good one barely pulls. Range 0–2; two average teams give 1.
 */
export const pullStrength = (winnerQuality: number, loserQuality: number) =>
  loserQuality + (1 - winnerQuality);

/**
 * How far above its loser a pass-2 spring wants the winner:
 *
 *   1 + marginWeight × ln(1 + max(0, margin − homeField × site))
 *
 * Every win is worth one step; each extra point adds less than the one before.
 */
export const springGap = (s: Spring, settings: SpringSettings) =>
  1 +
  settings.marginWeight *
    logFixed(1 + Math.max(0, s.margin - settings.homeField * s.site));

/**
 * Heights that minimise
 *
 *   ½ Σ_games stiffness · (h[winner] − h[loser] − gap)²  +  ½ shrink · Σ_teams h²
 *   + ½ HOLD_STIFFNESS · Σ_held max(0, HOLD_GAP − (h[winner] − h[loser]))²
 *
 * Without holds this is one symmetric positive-definite system, solved by Cholesky
 * with + − × / and sqrt in a fixed order. Each team's height is then the
 * stiffness-weighted average of what its games say (opponent + gap after a win,
 * opponent − gap after a loss), with `shrink` weight on 0. Holds only engage while
 * their winner is less than HOLD_GAP above its loser; the engaged set is found by
 * repeating the solve (with a halving line search) until it stops changing.
 */
export function solveSprings(
  n: number,
  springs: readonly Spring[],
  stiffness: readonly number[],
  shrink: number,
  gaps?: readonly number[],
  held?: readonly boolean[],
  from?: Float64Array,
): Float64Array {
  if (!(shrink > 0)) throw new Error("spring shrink must be > 0");
  const gap = (e: number) => gaps?.[e] ?? 1;
  const base = new Float64Array(n * n),
    rhs = new Float64Array(n);
  springs.forEach(({ winner: w, loser: l }, e) => {
    const k = stiffness[e]!;
    if (!(k >= 0) || !Number.isFinite(k))
      throw new Error("spring stiffness must be finite and >= 0");
    base[w * n + w]! += k;
    base[l * n + l]! += k;
    base[w * n + l]! -= k;
    base[l * n + w]! -= k;
    rhs[w]! += k * gap(e);
    rhs[l]! -= k * gap(e);
  });
  for (let i = 0; i < n; i++) base[i * n + i]! += shrink;
  if (!held || !held.some(Boolean)) return choleskySolve(base, rhs, n);

  const engaged = (x: Float64Array) =>
    springs.map(
      ({ winner: w, loser: l }, e) => held[e]! && x[w]! - x[l]! < HOLD_GAP,
    );
  const energy = (x: Float64Array) => {
    let sum = 0;
    springs.forEach(({ winner: w, loser: l }, e) => {
      const g = x[w]! - x[l]!,
        r = g - gap(e);
      sum += stiffness[e]! * r * r;
      const short = HOLD_GAP - g;
      if (held[e] && short > 0) sum += HOLD_STIFFNESS * short * short;
    });
    for (let i = 0; i < n; i++) sum += shrink * x[i]! * x[i]!;
    return sum;
  };
  let x: Float64Array = from
    ? Float64Array.from(from)
    : choleskySolve(base, rhs, n);
  let active = engaged(x);
  for (let iter = 0; iter < 200; iter++) {
    const m = Float64Array.from(base),
      b = Float64Array.from(rhs);
    springs.forEach(({ winner: w, loser: l }, e) => {
      if (!active[e]) return;
      m[w * n + w]! += HOLD_STIFFNESS;
      m[l * n + l]! += HOLD_STIFFNESS;
      m[w * n + l]! -= HOLD_STIFFNESS;
      m[l * n + w]! -= HOLD_STIFFNESS;
      b[w]! += HOLD_STIFFNESS * HOLD_GAP;
      b[l]! -= HOLD_STIFFNESS * HOLD_GAP;
    });
    const next = choleskySolve(m, b, n);
    const now = engaged(next);
    if (now.every((v, e) => v === active[e])) return next;
    const e0 = energy(x);
    let t = 1,
      y: Float64Array = next;
    while (energy(y) >= e0 && t > 1e-10) {
      t /= 2;
      y = x.map((v, i) => v + t * (next[i]! - v));
    }
    x = y;
    active = engaged(x);
  }
  throw new Error("head-to-head holds did not settle");
}

/**
 * Head-to-head: any game whose winner sits below its loser by less than `window`
 * steps (or above it by less than HOLD_GAP) gets a hold, and the graph is solved
 * again. Closest calls first, then game order; a hold is skipped when the loser is
 * already required, through other holds, to stay above the winner, so cycles of
 * results never fight. Repeats until no new hold is added.
 */
export function holdHeadToHead(
  n: number,
  springs: readonly Spring[],
  stiffness: readonly number[],
  shrink: number,
  gaps: readonly number[],
  window: number,
) {
  let height = solveSprings(n, springs, stiffness, shrink, gaps);
  const held = springs.map(() => false);
  if (!(window > 0)) return { height, held };
  const above: number[][] = Array.from({ length: n }, () => []);
  const requiredAbove = (a: number, b: number) => {
    const stack = [a],
      seen = new Uint8Array(n);
    while (stack.length) {
      const x = stack.pop()!;
      if (x === b) return true;
      if (seen[x]) continue;
      seen[x] = 1;
      stack.push(...above[x]!);
    }
    return false;
  };
  for (let round = 0; round < 100; round++) {
    const h = height;
    const candidates = springs
      .map((s, e) => ({ e, s, short: h[s.loser]! - h[s.winner]! }))
      .filter((c) => !held[c.e] && c.short > -HOLD_GAP && c.short < window)
      .sort((a, b) => a.short - b.short || a.e - b.e);
    let added = false;
    for (const c of candidates) {
      if (requiredAbove(c.s.loser, c.s.winner)) continue;
      above[c.s.winner]!.push(c.s.loser);
      held[c.e] = true;
      added = true;
    }
    if (!added) return { height, held };
    height = solveSprings(n, springs, stiffness, shrink, gaps, held, height);
  }
  throw new Error("head-to-head holds did not settle");
}

/**
 * The ranking. Pass 1 makes each game's margin its spring strength and gives every
 * team a strength. Pass 2 rebuilds the graph: spring strength from those strengths
 * (see `pullStrength`), gap from the log of the margin (see `springGap`), and
 * head-to-head holds between close teams. Its heights are the published ranking.
 */
export function twoPass(
  n: number,
  springs: readonly Spring[],
  settings: SpringSettings,
) {
  const strength = solveSprings(
    n,
    springs,
    springs.map((s) => s.margin),
    settings.strengthShrink,
  );
  const q = Array.from(strength, (s) => quality(s, settings.qualityScale));
  const pull = springs.map((s) => pullStrength(q[s.winner]!, q[s.loser]!));
  const gap = springs.map((s) => springGap(s, settings));
  const { height, held } = holdHeadToHead(
    n,
    springs,
    pull,
    settings.rankShrink,
    gap,
    settings.headToHeadWindow,
  );
  return { strength, quality: q, pull, gap, held, height };
}
