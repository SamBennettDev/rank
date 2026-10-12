import { choleskySolve } from "./linalg";

/** One counted game, from the home team's side. Team fields are indices into the team array. */
export interface RatedGame {
  home: number;
  away: number;
  /** Home points minus away points (never 0: tied games are not counted). */
  margin: number;
  neutral: boolean;
}

export interface FitOptions {
  /** Points added to the winner's margin for winning at all. */
  winBonus: number;
  /** Each team's starting rating (the prior), one per team. */
  prior: Float64Array;
  /** How many games' worth of evidence the prior counts for. Must be > 0. */
  priorWeight: number;
}

/** Tiny pull of the home-field estimate toward 0, so it is defined before any home game is played. */
export const HOME_FIELD_RIDGE = 1e-4;

/**
 * The rating model. A game's result is its margin plus `winBonus` points to the winner:
 *
 *   result = margin + winBonus * sign(margin)            (home team's side)
 *
 * Ratings r and a home-field edge H minimise
 *
 *   sum_games (result - (r_home - r_away + H * home))^2
 *     + priorWeight * sum_teams (r_i - prior_i)^2
 *     + HOME_FIELD_RIDGE * H^2
 *
 * where home is 1 for a true home game and 0 at a neutral site. Setting the
 * gradient to zero gives one symmetric positive-definite linear system, solved
 * exactly with a Cholesky decomposition. Only + - * / and sqrt are used, in a
 * fixed order, so the answer is bit-identical on every IEEE-754 machine.
 *
 * At the solution each team's rating is exactly the weighted average
 *
 *   r_i = (sum over its games of game value + priorWeight * prior_i) / (games + priorWeight)
 *
 * where a game's value is the opponent's rating plus this team's result, minus H
 * at home or plus H away (see `gameValue`). That is the explanation the site shows.
 * `games` must already be in a canonical order; summation order follows it.
 */
export function fitRatings(n: number, games: readonly RatedGame[], { winBonus, prior, priorWeight }: FitOptions): { ratings: Float64Array; homeField: number } {
  if (!(priorWeight > 0)) throw new Error("priorWeight must be > 0");
  const N = n + 1; // last unknown is the home-field edge
  const m = new Float64Array(N * N);
  const rhs = new Float64Array(N);
  for (const g of games) {
    const y = result(g.margin, winBonus);
    const x = g.neutral ? 0 : 1;
    const h = g.home, a = g.away;
    m[h * N + h]! += 1;
    m[a * N + a]! += 1;
    m[h * N + a]! -= 1;
    m[a * N + h]! -= 1;
    m[h * N + n]! += x;
    m[a * N + n]! -= x;
    m[n * N + h]! += x;
    m[n * N + a]! -= x;
    m[n * N + n]! += x * x;
    rhs[h]! += y;
    rhs[a]! -= y;
    rhs[n]! += x * y;
  }
  for (let i = 0; i < n; i++) {
    m[i * N + i]! += priorWeight;
    rhs[i]! += priorWeight * prior[i]!;
  }
  m[n * N + n]! += HOME_FIELD_RIDGE;
  const x = choleskySolve(m, rhs, N);
  return { ratings: x.slice(0, n), homeField: x[n]! };
}

/** A game's result for the team that scored `margin` more points than its opponent. */
export const result = (margin: number, winBonus: number) => margin + (margin > 0 ? winBonus : margin < 0 ? -winBonus : 0);

/**
 * What one game says a team's rating is: the opponent's rating plus the team's
 * result, adjusted for home field (`where` is +1 at home, -1 away, 0 neutral).
 */
export const gameValue = (opponentRating: number, margin: number, where: -1 | 0 | 1, homeField: number, winBonus: number) =>
  opponentRating + result(margin, winBonus) - where * homeField;
