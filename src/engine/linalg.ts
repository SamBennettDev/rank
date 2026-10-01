/**
 * Dense Cholesky solve for symmetric positive-definite systems.
 * Only + - * / and sqrt are used, all in a fixed loop order, so results are
 * bit-identical on every IEEE-754 platform (Node, browsers, CI).
 */

/** Solves M x = b. `m` is an n*n row-major matrix; only its lower triangle is read. */
export function choleskySolve(m: Float64Array, b: Float64Array, n: number): Float64Array {
  const l = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = m[i * n + j]!;
      for (let k = 0; k < j; k++) sum -= l[i * n + k]! * l[j * n + k]!;
      if (i === j) {
        if (!(sum > 0)) throw new Error(`matrix is not positive definite (pivot ${i} = ${sum})`);
        l[i * n + i] = Math.sqrt(sum);
      } else {
        l[i * n + j] = sum / l[j * n + j]!;
      }
    }
  }
  // Forward substitution: L y = b
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = b[i]!;
    for (let k = 0; k < i; k++) sum -= l[i * n + k]! * y[k]!;
    y[i] = sum / l[i * n + i]!;
  }
  // Back substitution: Lt x = y
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = y[i]!;
    for (let k = i + 1; k < n; k++) sum -= l[k * n + i]! * x[k]!;
    x[i] = sum / l[i * n + i]!;
  }
  return x;
}
