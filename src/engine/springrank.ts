import { choleskySolve } from "./linalg";

export interface Beat {
  winner: number; // index into the team array
  loser: number;
  /** Spring stiffness for this game (default 1). */
  weight?: number;
}

/**
 * SpringRank (De Bacco, Larremore & Moore, 2018, "A physical model for efficient
 * ranking in networks"). Every game is a spring that wants the winner exactly one
 * unit above the loser. Heights minimise
 *
 *   H(s) = 1/2 * sum_ij A_ij (s_i - s_j - 1)^2 + 1/2 * alpha * sum_i s_i^2
 *
 * where A_ij is the total spring stiffness of i's wins over j (one per game, or
 * the game's point differential when weighting by margin). Stiffness changes how
 * hard a game pulls, never the one-unit rest length. Setting the gradient to zero gives
 *
 *   (D_out + D_in - (A + A^T) + alpha*I) s = d_out - d_in
 *
 * The matrix is symmetric positive definite for alpha > 0, so the answer is unique.
 * `beats` must already be in a canonical order; summation order follows it.
 */
export function springRank(n: number, beats: readonly Beat[], alpha: number): Float64Array {
  if (!(alpha > 0)) throw new Error("alpha must be > 0");
  const m = new Float64Array(n * n);
  const rhs = new Float64Array(n);
  for (const { winner: w, loser: l, weight = 1 } of beats) {
    if (!(weight > 0)) throw new Error(`game weight must be > 0 (got ${weight})`);
    m[w * n + w]! += weight;
    m[l * n + l]! += weight;
    m[w * n + l]! -= weight;
    m[l * n + w]! -= weight;
    rhs[w]! += weight;
    rhs[l]! -= weight;
  }
  for (let i = 0; i < n; i++) m[i * n + i]! += alpha;
  return choleskySolve(m, rhs, n);
}
