/**
 * Our expected-points model (fitted by scripts/fit-ep.ts on the NCAA stats mirror's
 * play-by-play). Expected points (EP) are the points of the next score in the half from
 * the offense's side: a touchdown 7, a field goal 3, a safety 2, the opponent's scores
 * negative, 0 when nobody scores again in the half.
 *
 * For each down, EP is a piecewise-linear curve in yards to goal plus a piecewise-linear
 * adjustment for yards to go:
 *
 *   EP(down, togo, ytg) = Σ_k field[down][k] · hat_k(ytg)  +  Σ_j togo[down][j] · hat_j(togo)
 *
 * where hat_k is 1 at knot k, falling linearly to 0 at the neighbouring knots (values are
 * clamped to the first and last knot). The yards-to-go terms are measured against 10 to go,
 * whose coefficient is fixed at 0. Evaluating needs only + − × /.
 */
import { expFixed } from "./probability";

/** Yards-to-goal knots of the field curves. */
export const FIELD_KNOTS = [1, 5, 10, 20, 35, 50, 65, 80, 90, 99] as const;
/** Yards-to-go knots; 10 to go is the reference (coefficient 0). */
export const TOGO_KNOTS = [1, 3, 6, 10, 15, 25] as const;
export const TOGO_REFERENCE = 3;

export interface EpModel {
  version: string;
  /** field[down - 1][k]: EP at yards-to-goal knot k with 10 to go. */
  field: number[][];
  /** togo[down - 1][j]: points added at yards-to-go knot j (0 at the reference). */
  togo: number[][];
  /** Average value of a kickoff for the kicking team, before it happens. */
  kickoff: number;
  /** Field-goal make chance: logistic(fgIntercept + fgSlope × kick distance in yards). */
  fgIntercept: number;
  fgSlope: number;
  /** Points a touchdown is worth (with its try), a field goal, a safety. */
  touchdown: number;
  fieldGoal: number;
  safety: number;
}

/** Weights of the hat functions on `knots` at `x` (clamped): at most two are non-zero. */
export function hats(knots: readonly number[], x: number): number[] {
  const w = new Array<number>(knots.length).fill(0);
  if (x <= knots[0]!) w[0] = 1;
  else if (x >= knots[knots.length - 1]!) w[knots.length - 1] = 1;
  else
    for (let k = 1; k < knots.length; k++)
      if (x <= knots[k]!) {
        const t = (x - knots[k - 1]!) / (knots[k]! - knots[k - 1]!);
        w[k - 1] = 1 - t;
        w[k] = t;
        break;
      }
  return w;
}

/** Number of model coefficients: per down, the field knots and the non-reference to-go knots. */
export const EP_PARAMS = 4 * (FIELD_KNOTS.length + TOGO_KNOTS.length - 1);

/** The model's feature row for a state (used to fit and to evaluate). */
export function epFeatures(down: number, togo: number, ytg: number): number[] {
  const x = new Array<number>(EP_PARAMS).fill(0);
  const per = FIELD_KNOTS.length + TOGO_KNOTS.length - 1;
  const base = (down - 1) * per;
  hats(FIELD_KNOTS, ytg).forEach((v, k) => (x[base + k] = v));
  let j = FIELD_KNOTS.length;
  hats(TOGO_KNOTS, togo).forEach((v, k) => {
    if (k === TOGO_REFERENCE) return;
    x[base + j++] = v;
  });
  return x;
}

export const isState = (down: number, togo: number, ytg: number) =>
  Number.isInteger(down) &&
  down >= 1 &&
  down <= 4 &&
  togo >= 1 &&
  ytg >= 1 &&
  ytg <= 99;

/** Expected points of a down, yards to go and yards to goal for the team with the ball. */
export function expectedPoints(
  m: EpModel,
  down: number,
  togo: number,
  ytg: number,
): number {
  const field = m.field[down - 1]!,
    adj = m.togo[down - 1]!;
  let ep = 0;
  hats(FIELD_KNOTS, ytg).forEach((v, k) => (ep += v * field[k]!));
  hats(TOGO_KNOTS, togo).forEach((v, k) => (ep += v * adj[k]!));
  return ep;
}

/** Chance a field goal from `distance` yards is good. */
export function fieldGoalChance(m: EpModel, distance: number) {
  const z = m.fgIntercept + m.fgSlope * distance;
  const e = expFixed(-Math.abs(z));
  return z >= 0 ? 1 / (1 + e) : e / (1 + e);
}

/**
 * A successful play: at least half the yards to go on first down, 70% on second, all of
 * them on third and fourth (or a touchdown).
 */
export function isSuccess(
  down: number,
  togo: number,
  gained: number,
  touchdown: boolean,
) {
  if (touchdown) return true;
  const need = down === 1 ? 0.5 : down === 2 ? 0.7 : 1;
  return gained >= need * togo;
}
