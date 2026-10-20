import { choleskySolve } from "./linalg";
import { expFixed } from "./probability";
import type { SpringSettings } from "./types";

export type { SpringSettings };

/** One game: a pass-1 spring from the loser up to the winner. */
export interface Spring {
  winner: number;
  loser: number;
  /** Winner's points minus loser's points (always > 0). */
  margin: number;
}

/** Points a 1-point win is worth in pass 1, and the most a game can move pass 2. */
export const WIN_POINTS = 7;

/**
 * How far above its loser a pass-1 spring wants the winner, in points:
 * WIN_POINTS × (1 + 1/2 + … + 1/margin). The first point is worth 7, the second
 * 3.5, the third 2.33: each extra point counts less than the one before.
 */
export function marginGap(margin: number) {
  if (!Number.isInteger(margin) || margin < 1)
    throw new Error("margin must be a positive whole number");
  let sum = 0;
  for (let i = 1; i <= margin; i++) sum += 1 / i;
  return WIN_POINTS * sum;
}

/** Chance a team at this pass-1 height beats an average (height 0) team. */
export const quality = (strength: number, scale: number) => {
  const e = expFixed(-Math.abs(strength) * scale);
  return strength >= 0 ? 1 / (1 + e) : e / (1 + e);
};

/** A team's quality points: WIN_POINTS × its chance of beating an average team (0–7). */
export const qualityPoints = (q: number) => WIN_POINTS * q;

/**
 * Pass-2 points for one game. The winner earns the loser's quality points; the loser
 * loses 7 minus the winner's quality points. Beating a good team or losing to a bad
 * one moves a team most; beating a bad team or losing to a good one barely does.
 */
export const gamePoints = (winnerQuality: number, loserQuality: number) => ({
  win: qualityPoints(loserQuality),
  loss: -(WIN_POINTS - qualityPoints(winnerQuality)),
});

/**
 * Pass-1 spring strength for one game: quality(loser) + (1 − quality(winner)), 0–2.
 * A surprising result (an upset, or a win over a good team) is a stiff spring; an
 * expected one (a good team beating a bad one) barely pulls either team.
 */
export const surprise = (winnerQuality: number, loserQuality: number) =>
  loserQuality + (1 - winnerQuality);

/** Pass 1 repeats until no strength moves more than this many points... */
export const SETTLE = 1e-9;
/** ...or this many rounds have run. */
export const MAX_ROUNDS = 200;

/**
 * Heights that minimise
 *
 *   ½ Σ_games stiffness · (h[winner] − h[loser] − gap)²  +  ½ shrink · Σ_teams h²
 *
 * One symmetric positive-definite system, solved by Cholesky with + − × / and sqrt
 * in a fixed order. Each team's height is the stiffness-weighted average of what its
 * games say (opponent + gap after a win, opponent − gap after a loss), with `shrink`
 * weight on 0.
 */
export function solveSprings(
  n: number,
  springs: readonly Spring[],
  stiffness: readonly number[],
  gaps: readonly number[],
  shrink: number,
): Float64Array {
  if (!(shrink > 0)) throw new Error("spring shrink must be > 0");
  const matrix = new Float64Array(n * n),
    rhs = new Float64Array(n);
  springs.forEach(({ winner: w, loser: l }, e) => {
    const k = stiffness[e]!;
    if (!(k >= 0) || !Number.isFinite(k))
      throw new Error("spring stiffness must be finite and >= 0");
    matrix[w * n + w]! += k;
    matrix[l * n + l]! += k;
    matrix[w * n + l]! -= k;
    matrix[l * n + w]! -= k;
    const g = gaps[e]!;
    if (!Number.isFinite(g)) throw new Error("spring gap must be finite");
    rhs[w]! += k * g;
    rhs[l]! -= k * g;
  });
  for (let i = 0; i < n; i++) matrix[i * n + i]! += shrink;
  return choleskySolve(matrix, rhs, n);
}

/**
 * Pass 1: margin SpringRank with springs weighted by surprise. Every game wants its
 * winner `marginGap(margin)` points above its loser. It starts with every spring at
 * strength 1, then sets each spring from the teams' qualities (see `surprise`) and
 * solves again, until the strengths settle.
 */
export function strengthPass(
  n: number,
  springs: readonly Spring[],
  settings: SpringSettings,
) {
  const gaps = springs.map((s) => marginGap(s.margin));
  let stiffness = springs.map(() => 1);
  let strength = solveSprings(
    n,
    springs,
    stiffness,
    gaps,
    settings.strengthShrink,
  );
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const q = Array.from(strength, (x) => quality(x, settings.qualityScale));
    stiffness = springs.map((s) => surprise(q[s.winner]!, q[s.loser]!));
    const next = solveSprings(
      n,
      springs,
      stiffness,
      gaps,
      settings.strengthShrink,
    );
    let moved = 0;
    for (let i = 0; i < n; i++)
      moved = Math.max(moved, Math.abs(next[i]! - strength[i]!));
    strength = next;
    if (moved < SETTLE) return { strength, stiffness };
  }
  throw new Error("pass 1 did not settle");
}

/**
 * The ranking. Pass 1 (see `strengthPass`) gives every team a strength in points
 * and from it a quality. Pass 2 averages each team's game points (see
 * `gamePoints`); the averages are the published ranking.
 */
export function twoPass(
  n: number,
  springs: readonly Spring[],
  settings: SpringSettings,
) {
  const { strength, stiffness } = strengthPass(n, springs, settings);
  const q = Array.from(strength, (s) => quality(s, settings.qualityScale));
  const points = springs.map((s) => gamePoints(q[s.winner]!, q[s.loser]!));
  const total = new Float64Array(n),
    games = new Float64Array(n);
  springs.forEach((s, e) => {
    total[s.winner]! += points[e]!.win;
    total[s.loser]! += points[e]!.loss;
    games[s.winner]!++;
    games[s.loser]!++;
  });
  const height = total.map((t, i) => (games[i]! > 0 ? t / games[i]! : 0));
  return { strength, quality: q, stiffness, points, height };
}
