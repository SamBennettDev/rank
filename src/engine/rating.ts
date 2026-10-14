import { choleskyFactor, inverseFactor, solveFactor } from "./linalg";

export interface RatedGame {
  home: number;
  away: number;
  margin: number;
  neutral: boolean;
}
export interface FitOptions {
  winBonus: number;
  shrink: number;
  homeFieldShrink?: number;
  priorMeans?: readonly number[];
  homeFieldPrior?: number;
}
export const HOME_FIELD_RIDGE = 1e-4;

/**
 * The matchup model: least squares on each game's margin plus `winBonus` for the
 * winner, with a home-field edge and a pull toward each team's starting point.
 */
export function fitRatings(
  n: number,
  games: readonly RatedGame[],
  {
    winBonus,
    shrink,
    homeFieldShrink = HOME_FIELD_RIDGE,
    priorMeans,
    homeFieldPrior = 0,
  }: FitOptions,
) {
  if (!(shrink > 0) || !(homeFieldShrink > 0))
    throw new Error("shrink and homeFieldShrink must be > 0");
  if (
    (priorMeans &&
      (priorMeans.length !== n ||
        priorMeans.some((v) => !Number.isFinite(v)))) ||
    !Number.isFinite(homeFieldPrior)
  )
    throw new Error("invalid rating priors");
  const N = n + 1,
    matrix = new Float64Array(N * N),
    rhs = new Float64Array(N);
  for (const g of games) {
    const y = result(g.margin, winBonus),
      x = g.neutral ? 0 : 1,
      h = g.home,
      a = g.away;
    matrix[h * N + h]!++;
    matrix[a * N + a]!++;
    matrix[h * N + a]!--;
    matrix[a * N + h]!--;
    matrix[h * N + n]! += x;
    matrix[a * N + n]! -= x;
    matrix[n * N + h]! += x;
    matrix[n * N + a]! -= x;
    matrix[n * N + n]! += x;
    rhs[h]! += y;
    rhs[a]! -= y;
    rhs[n]! += x * y;
  }
  for (let i = 0; i < n; i++) {
    matrix[i * N + i]! += shrink;
    if (priorMeans) rhs[i]! += shrink * priorMeans[i]!;
  }
  matrix[n * N + n]! += homeFieldShrink;
  rhs[n]! += homeFieldShrink * homeFieldPrior;
  const factor = choleskyFactor(matrix, N),
    answer = solveFactor(factor, rhs, N);
  return {
    ratings: answer.slice(0, n),
    homeField: answer[n]!,
    factor,
    rhs,
    shrink,
  };
}

export const result = (margin: number, winBonus: number) =>
  margin + (margin > 0 ? winBonus : margin < 0 ? -winBonus : 0);
export const gameValue = (
  opponentRating: number,
  margin: number,
  where: -1 | 0 | 1,
  homeField: number,
  winBonus: number,
) => opponentRating + result(margin, winBonus) - where * homeField;

/** Rating uncertainty: residualScale² × the inverse of the penalized information matrix. */
export function ratingUncertainty(
  fit: ReturnType<typeof fitRatings>,
  residualScale: number,
) {
  const n = fit.ratings.length,
    N = n + 1,
    inverse = inverseFactor(fit.factor, N);
  const errors = new Float64Array(N);
  for (let col = 0; col < N; col++) {
    let variance = 0;
    for (let row = col; row < N; row++)
      variance += inverse[row * N + col]! ** 2;
    errors[col] = residualScale * Math.sqrt(variance);
  }
  const matchupVariance = (home: number, away: number, neutral: boolean) => {
    let variance = 0;
    for (let row = 0; row < N; row++) {
      const v =
        inverse[row * N + home]! -
        inverse[row * N + away]! +
        (neutral ? 0 : inverse[row * N + n]!);
      variance += v * v;
    }
    return variance * residualScale * residualScale;
  };
  return {
    standardErrors: errors.slice(0, n),
    homeFieldError: errors[n]!,
    matchupVariance,
  };
}
