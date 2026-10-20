import { choleskySolve } from "./linalg";
import { expFixed } from "./probability";
import type { SpringSettings } from "./types";

export type { SpringSettings };

/** One game on the graph: a spring from the loser up to the winner. */
export interface Spring {
  winner: number;
  loser: number;
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
 * Heights that minimise
 *
 *   ½ Σ_games stiffness · (h[winner] − h[loser] − 1)²  +  ½ shrink · Σ_teams h²
 *
 * One symmetric positive-definite system, solved by Cholesky with + − × / and sqrt
 * in a fixed order. Each team's height is the stiffness-weighted average of what its
 * games say (opponent + 1 after a win, opponent − 1 after a loss), with `shrink`
 * weight on 0.
 */
export function solveSprings(
  n: number,
  springs: readonly Spring[],
  stiffness: readonly number[],
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
    rhs[w]! += k;
    rhs[l]! -= k;
  });
  for (let i = 0; i < n; i++) matrix[i * n + i]! += shrink;
  return choleskySolve(matrix, rhs, n);
}

/**
 * The ranking. Pass 1 is plain SpringRank: every game is a spring of strength 1,
 * which gives every team a strength. Pass 2 solves the same graph again with each
 * spring's strength set from those strengths (see `pullStrength`). Its heights are
 * the published ranking.
 */
export function twoPass(
  n: number,
  springs: readonly Spring[],
  settings: SpringSettings,
) {
  const strength = solveSprings(
    n,
    springs,
    springs.map(() => 1),
    settings.strengthShrink,
  );
  const q = Array.from(strength, (s) => quality(s, settings.qualityScale));
  const pull = springs.map((s) => pullStrength(q[s.winner]!, q[s.loser]!));
  const height = solveSprings(n, springs, pull, settings.rankShrink);
  return { strength, quality: q, pull, height };
}
