import { choleskySolve } from "./linalg";

export interface Beat {
  winner: number; // index into the team array
  loser: number;
  margin: number; // winner's score minus loser's score, with no cap or scaling
}

/**
 * Each game is a spring whose target gap is the raw winning score minus the
 * losing score. There is no fixed rest length, margin cap or scaling. Heights minimise
 *
 *   H(s) = 1/2 * sum_games (s_w - s_l - margin)^2 + 1/2 * alpha * sum_i s_i^2
 *
 * Setting the gradient to zero gives
 *
 *   (L + alpha*I) s = winning_margins - losing_margins
 *
 * where L is the game-count graph Laplacian. The matrix is symmetric positive
 * definite for alpha > 0, so the answer is unique. `beats` must already be in a
 * canonical order; summation order follows it.
 */
export function springRank(n: number, beats: readonly Beat[], alpha: number): Float64Array {
  if (!(alpha > 0)) throw new Error("alpha must be > 0");
  const m = new Float64Array(n * n);
  const rhs = new Float64Array(n);
  for (const { winner: w, loser: l, margin } of beats) {
    m[w * n + w]! += 1;
    m[l * n + l]! += 1;
    m[w * n + l]! -= 1;
    m[l * n + w]! -= 1;
    rhs[w]! += margin;
    rhs[l]! -= margin;
  }
  for (let i = 0; i < n; i++) m[i * n + i]! += alpha;
  return choleskySolve(m, rhs, n);
}
