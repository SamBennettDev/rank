import { choleskySolve } from "./linalg";

/** One counted game seen from the home side (for a neutral site, "home" is just the listed first team). */
export interface FieldGame {
  home: number; // index into the team array
  away: number;
  homePoints: number;
  awayPoints: number;
  neutral: boolean;
}

export interface GridironParams {
  /** Points added to every winner's margin: a win is worth this much on its own. */
  winBonus: number;
  /** Residual (points beyond what the ratings expect) after which a spring stops pulling harder. */
  blowoutLimit: number;
  /** Solve a home-field advantage (in points) jointly with the ratings. */
  fitHomeField: boolean;
  /** Safety cap on reweighting rounds; the solver normally stops earlier on convergence. */
  maxIterations: number;
}

export interface GridironResult {
  /** Rating of each team in points; the gap between two teams is the predicted margin on a neutral field. */
  heights: Float64Array;
  /** Fitted home-field advantage in points (0 when not fitted). */
  homeField: number;
  /** Final pull of each game's spring, 1 = full; below 1 the blowout limit kicked in. */
  pull: Float64Array;
  /** Reweighting rounds used. */
  iterations: number;
}

/** What the spring for a game wants: home minus away, including the win bonus. */
export function gameTarget(g: Pick<FieldGame, "homePoints" | "awayPoints">, winBonus: number): number {
  const m = g.homePoints - g.awayPoints;
  return m > 0 ? m + winBonus : m - winBonus;
}

/**
 * Gridiron Springs. Every game is a spring between its two teams that wants
 *
 *   s_home - s_away + h * [not neutral]  =  margin + winBonus (toward the winner)
 *
 * where s are team ratings in points and h is the home-field advantage, solved
 * together. The energy is a Huber loss: quadratic while a game is within
 * `blowoutLimit` points of what the ratings expect, linear beyond it, so a spring
 * stops pulling harder once a result is far outside expectation. Minimised by
 * iteratively reweighted least squares; each round is one Cholesky solve in a
 * fixed order, and the stopping rule is exact arithmetic, so results are
 * bit-identical everywhere. alpha adds the same tiny pull toward 0 on every
 * unknown, which makes the answer unique; the mean team rating is exactly 0.
 */
export function gridironSprings(n: number, games: readonly FieldGame[], alpha: number, p: GridironParams): GridironResult {
  if (!(alpha > 0)) throw new Error("alpha must be > 0");
  if (!(p.blowoutLimit > 0)) throw new Error("blowoutLimit must be > 0");
  if (!(p.winBonus >= 0)) throw new Error("winBonus must be >= 0");
  const size = n + (p.fitHomeField ? 1 : 0);
  const hIdx = n;
  const targets = games.map((g) => gameTarget(g, p.winBonus));
  const pull = new Float64Array(games.length).fill(1);
  let x: Float64Array = new Float64Array(size);
  let iterations = 0;

  for (let it = 0; it < p.maxIterations; it++) {
    iterations = it + 1;
    const m = new Float64Array(size * size);
    const b = new Float64Array(size);
    for (let gi = 0; gi < games.length; gi++) {
      const g = games[gi]!;
      const k = pull[gi]!;
      const t = targets[gi]!;
      const h = g.home;
      const a = g.away;
      m[h * size + h]! += k;
      m[a * size + a]! += k;
      m[h * size + a]! -= k;
      m[a * size + h]! -= k;
      b[h]! += k * t;
      b[a]! -= k * t;
      if (p.fitHomeField && !g.neutral) {
        m[hIdx * size + hIdx]! += k;
        m[h * size + hIdx]! += k;
        m[hIdx * size + h]! += k;
        m[a * size + hIdx]! -= k;
        m[hIdx * size + a]! -= k;
        b[hIdx]! += k * t;
      }
    }
    for (let i = 0; i < size; i++) m[i * size + i]! += alpha;
    const next = choleskySolve(m, b, size);

    let change = 0;
    for (let i = 0; i < size; i++) change = Math.max(change, Math.abs(next[i]! - x[i]!));
    x = next;
    // Huber reweighting: full pull within the limit, limit/|residual| beyond it.
    for (let gi = 0; gi < games.length; gi++) {
      const g = games[gi]!;
      const pred = x[g.home]! - x[g.away]! + (p.fitHomeField && !g.neutral ? x[hIdx]! : 0);
      const res = Math.abs(targets[gi]! - pred);
      pull[gi] = res <= p.blowoutLimit ? 1 : p.blowoutLimit / res;
    }
    if (it > 0 && change < 1e-9) break;
  }

  return { heights: x.subarray(0, n), homeField: p.fitHomeField ? x[hIdx]! : 0, pull, iterations };
}
