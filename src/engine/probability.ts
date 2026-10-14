/** Fixed arithmetic avoids platform-dependent Math.exp in published bytes. */
export function expFixed(x: number): number {
  const v = Math.max(-40, Math.min(40, x)) / 64;
  let sum = 1,
    term = 1;
  for (let i = 1; i <= 20; i++) {
    term *= v / i;
    sum += term;
  }
  for (let i = 0; i < 6; i++) sum *= sum;
  return sum;
}

/** Fixed arithmetic normal CDF approximation (absolute error below 8e-8). */
export function normalCdf(x: number): number {
  if (x === 0) return 0.5;
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const tail =
    0.3989422804014327 *
    expFixed((-x * x) / 2) *
    t *
    (0.31938153 +
      t *
        (-0.356563782 +
          t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x > 0 ? 1 - tail : tail;
}

export function normalQuantile(p: number): number {
  let lo = -9,
    hi = 9;
  for (let i = 0; i < 36; i++) {
    const mid = (lo + hi) / 2;
    if (normalCdf(mid) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function winProbability(
  edge: number,
  scale: number,
  ratingVariance = 0,
): number {
  if (
    !(scale > 0) ||
    !Number.isFinite(scale) ||
    !Number.isFinite(edge) ||
    !(ratingVariance >= 0) ||
    !Number.isFinite(ratingVariance)
  )
    throw new Error("invalid probability inputs");
  const effective = Math.sqrt(
    scale * scale + (3 * ratingVariance) / (Math.PI * Math.PI),
  );
  const e = expFixed(-Math.abs(edge) / effective);
  return edge >= 0 ? 1 / (1 + e) : e / (1 + e);
}
