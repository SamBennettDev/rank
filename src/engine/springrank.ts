import { choleskySolve } from "./linalg";

export interface Beat {
  winner: number; // index into the team array
  loser: number;
}

/**
 * Win springs: SpringRank (De Bacco, Larremore & Moore, 2018, "A physical model
 * for efficient ranking in networks") with every game weighted equally. Each win
 * is a spring that wants the winner exactly `restLength` above the loser. Heights
 * minimise
 *
 *   H(s) = 1/2 * sum_ij A_ij (s_i - s_j - r)^2 + 1/2 * alpha * sum_i s_i^2
 *
 * where A_ij is the number of times i beat j. Setting the gradient to zero gives
 *
 *   (D_out + D_in - (A + A^T) + alpha*I) s = r * (d_out - d_in)
 *
 * with d_out = wins and d_in = losses. The matrix is symmetric positive definite
 * for alpha > 0, so the answer is unique. r only scales every height by the same
 * factor; the order never depends on it. `beats` must already be in a canonical
 * order; summation order follows it.
 */
export function springRank(n: number, beats: readonly Beat[], alpha: number, restLength = 1): Float64Array {
  if (!(alpha > 0)) throw new Error("alpha must be > 0");
  if (!(restLength > 0)) throw new Error("restLength must be > 0");
  const m = new Float64Array(n * n);
  const rhs = new Float64Array(n);
  for (const { winner: w, loser: l } of beats) {
    m[w * n + w]! += 1;
    m[l * n + l]! += 1;
    m[w * n + l]! -= 1;
    m[l * n + w]! -= 1;
    rhs[w]! += restLength;
    rhs[l]! -= restLength;
  }
  for (let i = 0; i < n; i++) m[i * n + i]! += alpha;
  return choleskySolve(m, rhs, n);
}
