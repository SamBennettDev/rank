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
  /** Games' worth of pull toward an average rating (0), the same for every team. Must be > 0. */
  shrink: number;
  /** Per game: true where a head-to-head hold must keep the winner above the loser. */
  kept?: readonly boolean[];
  /** Per game: how far above the loser a held winner's rating must be (default STOP_GAP). */
  need?: readonly number[];
  /** Where to start the search (ratings then home field); speeds up the constrained fit. */
  from?: Float64Array;
}

/** A held game's stop engages when its winner is less than this far above its loser... */
export const STOP_GAP = 0.5;
/** ...and pushes back this stiffly, so held winners finish above their losers. */
export const STOP_STIFFNESS = 1000;

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
 *     + shrink * sum_teams r_i^2
 *     + HOME_FIELD_RIDGE * H^2
 *
 * where home is 1 for a true home game and 0 at a neutral site. Every team starts
 * level: the shrink term pulls every rating equally toward 0 (an average team), so a
 * team with few games is not pushed around by one result. Setting the
 * gradient to zero gives one symmetric positive-definite linear system, solved
 * exactly with a Cholesky decomposition. Only + - * / and sqrt are used, in a
 * fixed order, so the answer is bit-identical on every IEEE-754 machine.
 *
 * Without stops, each team's rating is exactly
 *
 *   r_i = (sum over its games of game value) / (games + shrink)
 *
 * With stops (see `kept`), add each engaged stop's push to the sum: +STOP_STIFFNESS ×
 * (STOP_GAP − (r_w − r_l)) for its winner, the same amount subtracted for its loser.
 *
 * where a game's value is the opponent's rating plus this team's result, minus H
 * at home or plus H away (see `gameValue`). That is the explanation the site shows.
 * `games` must already be in a canonical order; summation order follows it.
 */
export function fitRatings(n: number, games: readonly RatedGame[], { winBonus, shrink, kept, need, from }: FitOptions): { ratings: Float64Array; homeField: number } {
  if (!(shrink > 0)) throw new Error("shrink must be > 0");
  const N = n + 1; // last unknown is the home-field edge
  const ys = games.map((g) => result(g.margin, winBonus));
  // The least-squares part is the same every step.
  const base = new Float64Array(N * N);
  const rhs = new Float64Array(N);
  games.forEach((g, i) => {
    const y = ys[i]!;
    const x = g.neutral ? 0 : 1;
    const h = g.home, a = g.away;
    base[h * N + h]! += 1;
    base[a * N + a]! += 1;
    base[h * N + a]! -= 1;
    base[a * N + h]! -= 1;
    base[h * N + n]! += x;
    base[a * N + n]! -= x;
    base[n * N + h]! += x;
    base[n * N + a]! -= x;
    base[n * N + n]! += x * x;
    rhs[h]! += y;
    rhs[a]! -= y;
    rhs[n]! += x * y;
  });
  for (let i = 0; i < n; i++) base[i * N + i]! += shrink;
  base[n * N + n]! += HOME_FIELD_RIDGE;
  const split = (x: Float64Array) => ({ ratings: x.slice(0, n), homeField: x[n]! });
  if (!kept) return split(choleskySolve(base, rhs, N));

  // With stops: minimise the same sum plus STOP_STIFFNESS * (STOP_GAP - (r_w - r_l))^2 on every
  // kept game whose winner is less than STOP_GAP above its loser. Each step solves the linear
  // system for the stops currently engaged; when the engaged set repeats, the answer is exact.
  const pairs = games.map((g) => (g.margin > 0 ? [g.home, g.away] : [g.away, g.home]) as [number, number]);
  const gapOf = (i: number) => need?.[i] ?? STOP_GAP;
  const engaged = (x: Float64Array) => pairs.map(([w, l], i) => kept[i]! && x[w]! - x[l]! < gapOf(i));
  const objective = (x: Float64Array) => {
    let e = 0;
    games.forEach((g, i) => {
      const r = ys[i]! - (x[g.home]! - x[g.away]! + (g.neutral ? 0 : x[n]!));
      e += r * r;
      const [w, l] = pairs[i]!;
      const short = gapOf(i) - (x[w]! - x[l]!);
      if (kept[i] && short > 0) e += STOP_STIFFNESS * short * short;
    });
    for (let i = 0; i < n; i++) e += shrink * x[i]! * x[i]!;
    return e + HOME_FIELD_RIDGE * x[n]! * x[n]!;
  };
  let x: Float64Array = from ? Float64Array.from(from) : choleskySolve(base, rhs, N);
  let active = engaged(x);
  for (let iter = 0; iter < 200; iter++) {
    const m = Float64Array.from(base);
    const b = Float64Array.from(rhs);
    pairs.forEach(([w, l], i) => {
      if (!active[i]) return;
      m[w * N + w]! += STOP_STIFFNESS;
      m[l * N + l]! += STOP_STIFFNESS;
      m[w * N + l]! -= STOP_STIFFNESS;
      m[l * N + w]! -= STOP_STIFFNESS;
      b[w]! += STOP_STIFFNESS * gapOf(i);
      b[l]! -= STOP_STIFFNESS * gapOf(i);
    });
    const next = choleskySolve(m, b, N);
    const now = engaged(next);
    if (now.every((v, i) => v === active[i])) return split(next);
    // Move toward the step's answer, halving until the objective drops.
    const e0 = objective(x);
    let t = 1;
    let y: Float64Array = next;
    while (objective(y) >= e0 && t > 1e-10) {
      t /= 2;
      y = x.map((v, i) => v + t * (next[i]! - v));
    }
    x = y;
    active = engaged(x);
  }
  throw new Error("head-to-head stops did not settle");
}

/** A game's result for the team that scored `margin` more points than its opponent. */
export const result = (margin: number, winBonus: number) => margin + (margin > 0 ? winBonus : margin < 0 ? -winBonus : 0);

/**
 * What one game says a team's rating is: the opponent's rating plus the team's
 * result, adjusted for home field (`where` is +1 at home, -1 away, 0 neutral).
 */
export const gameValue = (opponentRating: number, margin: number, where: -1 | 0 | 1, homeField: number, winBonus: number) =>
  opponentRating + result(margin, winBonus) - where * homeField;
