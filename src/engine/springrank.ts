import { choleskySolve } from "./linalg";

export interface Beat {
  winner: number; // index into the team array
  loser: number;
  gap: number; // the gap this game's spring wants between winner and loser
}

/**
 * Each game is a spring that wants the winner `gap` above the loser: a fixed rest
 * length for win springs, the raw score difference for margin springs. Every
 * spring has the same stiffness. Heights minimise
 *
 *   H(s) = 1/2 * sum_games (s_w - s_l - gap)^2 + 1/2 * alpha * sum_i s_i^2
 *
 * Setting the gradient to zero gives
 *
 *   (L + alpha*I) s = (sum of gaps a team won by) - (sum of gaps it lost by)
 *
 * where L is the game-count graph Laplacian. The matrix is symmetric positive
 * definite for alpha > 0, so the answer is unique. `beats` must already be in a
 * canonical order; summation order follows it.
 */
export function springRank(n: number, beats: readonly Beat[], alpha: number): Float64Array {
  if (!(alpha > 0)) throw new Error("alpha must be > 0");
  const m = new Float64Array(n * n);
  const rhs = new Float64Array(n);
  for (const { winner: w, loser: l, gap } of beats) {
    m[w * n + w]! += 1;
    m[l * n + l]! += 1;
    m[w * n + l]! -= 1;
    m[l * n + w]! -= 1;
    rhs[w]! += gap;
    rhs[l]! -= gap;
  }
  for (let i = 0; i < n; i++) m[i * n + i]! += alpha;
  return choleskySolve(m, rhs, n);
}
