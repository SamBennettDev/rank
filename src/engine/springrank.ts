import { choleskySolve } from "./linalg";

export interface Beat {
  winner: number; // index into the team array
  loser: number;
  gap: number; // the gap this game's spring pushes for between winner and loser
}

/** Settings shared by every step. */
export interface SpringSettings {
  /** Small equal pull toward zero; makes the answer unique and keeps unbeaten teams finite. */
  alpha: number;
  /** How gradually a spring lets go once its winner passes the target gap (score points). */
  softness: number;
}

/** A kept game's stop engages when its winner is less than this far above its loser... */
export const STOP_GAP = 0.5;
/** ...and pushes back this stiffly, so kept winners always finish above their losers. */
export const STOP_STIFFNESS = 1000;

/**
 * The ranking, in three steps.
 *
 * 1. One-way springs on every game (`oneWaySprings`) give a starting order.
 * 2. Fewest upsets: teams are moved one at a time to the place that leaves the
 *    fewest upsets, until no single move removes another (`fewestUpsetsOrder`).
 *    The games still upside down are accepted as upsets.
 * 3. One-way springs again, now with a stop on every other game that keeps its
 *    winner above its loser. Where they settle is each team's height.
 *
 * `beats` must already be in a canonical order; summation order follows it.
 */
export function rankHeights(n: number, beats: readonly Beat[], settings: SpringSettings): { heights: Float64Array; upset: boolean[] } {
  const first = oneWaySprings(n, beats, settings);
  // Team index (= team id order) only breaks exact height ties in the starting order.
  const start = Array.from({ length: n }, (_, i) => i).sort((a, b) => first[b]! - first[a]! || a - b);
  const place = new Int32Array(n);
  fewestUpsetsOrder(n, beats, start).forEach((t, i) => (place[t] = i));
  const upset = beats.map((b) => place[b.winner]! > place[b.loser]!);
  return { heights: oneWaySprings(n, beats, settings, upset.map((u) => !u), first), upset };
}

/**
 * How hard a game's spring pushes its winner up (and its loser down), from 0 to 1.
 * With u = (winner height − loser height − gap) / softness:
 *
 *   push(u) = (1 − u / sqrt(1 + u²)) / 2
 *
 * Nearly 1 while the winner is well short of the gap (or below the loser), exactly
 * 1/2 at the gap, fading toward 0 as the winner pulls further ahead. Never negative:
 * a win never pulls its winner down and a loss never lifts its loser.
 */
export function push(heightGap: number, gap: number, softness: number): number {
  const u = (heightGap - gap) / softness;
  return (1 - u / Math.sqrt(1 + u * u)) / 2;
}

/**
 * Heights where every game's one-way spring (`push`), the stops on `kept` games and
 * the pull toward zero balance. They minimise
 *
 *   H(s) = sum_games softness/2 * (sqrt(1 + u²) − u)
 *        + STOP_STIFFNESS/2 * sum_kept max(0, STOP_GAP − (s_w − s_l))²
 *        + alpha/2 * sum_i s_i²
 *
 * (the push is −dH/d(s_w − s_l)). H is strictly convex, so the minimum is unique.
 * It is found with Newton's method: each step solves (Hessian) step = −gradient with
 * an exact Cholesky decomposition, halving the step while it does not lower H, and
 * stops when a step moves no height by more than 1e-9. Only + − × / and sqrt are
 * used, in a fixed order, so the result is bit-identical everywhere.
 */
export function oneWaySprings(n: number, beats: readonly Beat[], { alpha, softness }: SpringSettings, kept?: readonly boolean[], from?: Float64Array): Float64Array {
  if (!(alpha > 0)) throw new Error("alpha must be > 0");
  if (!(softness > 0)) throw new Error("softness must be > 0");
  const energy = (s: Float64Array) => {
    let e = 0;
    beats.forEach((b, i) => {
      const d = s[b.winner]! - s[b.loser]!;
      const u = (d - b.gap) / softness;
      e += (softness / 2) * (Math.sqrt(1 + u * u) - u);
      if (kept?.[i] && d < STOP_GAP) e += (STOP_STIFFNESS / 2) * (STOP_GAP - d) * (STOP_GAP - d);
    });
    for (let i = 0; i < n; i++) e += (alpha / 2) * s[i]! * s[i]!;
    return e;
  };
  let s: Float64Array = from ? Float64Array.from(from) : new Float64Array(n);
  for (let iter = 0; iter < 200; iter++) {
    const grad = new Float64Array(n);
    const hess = new Float64Array(n * n);
    for (let i = 0; i < n; i++) {
      grad[i] = alpha * s[i]!;
      hess[i * n + i] = alpha;
    }
    beats.forEach((b, i) => {
      const w = b.winner, l = b.loser;
      const d = s[w]! - s[l]!;
      const u = (d - b.gap) / softness;
      const r = Math.sqrt(1 + u * u);
      let f = (1 - u / r) / 2; // the push
      let k = 1 / (2 * softness * r * r * r); // how fast the push fades as the gap grows
      if (kept?.[i] && d < STOP_GAP) {
        f += STOP_STIFFNESS * (STOP_GAP - d);
        k += STOP_STIFFNESS;
      }
      grad[w]! -= f;
      grad[l]! += f;
      hess[w * n + w]! += k;
      hess[l * n + l]! += k;
      hess[w * n + l]! -= k;
      hess[l * n + w]! -= k;
    });
    const step = choleskySolve(hess, grad.map((v) => -v), n);
    let size = 0;
    for (let i = 0; i < n; i++) size = Math.max(size, Math.abs(step[i]!));
    const e0 = energy(s);
    let t = 1;
    let next: Float64Array = s.map((v, i) => v + step[i]!);
    while (energy(next) > e0 && t > 1e-12) {
      t /= 2;
      next = s.map((v, i) => v + t * step[i]!);
    }
    s = next;
    if (size * t < 1e-9) return s;
  }
  throw new Error("springs did not settle");
}

/**
 * Moves one team at a time to the place in the order that leaves the fewest upsets
 * (a game whose winner sits below its loser), until no single move lowers the count.
 * Ties between equally good places go to the one nearest the team's current place,
 * then the higher one. Every move removes at least one upset, so this always stops.
 */
export function fewestUpsetsOrder(n: number, beats: readonly Beat[], start: readonly number[]): number[] {
  const won: number[][] = Array.from({ length: n }, () => []);
  const lost: number[][] = Array.from({ length: n }, () => []);
  for (const b of beats) {
    won[b.winner]!.push(b.loser);
    lost[b.loser]!.push(b.winner);
  }
  let order = [...start];
  const pos = new Int32Array(n);
  for (;;) {
    let moved = false;
    for (let t = 0; t < n; t++) {
      if (won[t]!.length + lost[t]!.length === 0) continue;
      const cur = order.indexOf(t);
      const rest = order.slice(0, cur).concat(order.slice(cur + 1));
      rest.forEach((x, i) => (pos[x] = i));
      // Inserting t at place p puts it above rest[p..]. At p = 0 every loss is an
      // upset; stepping below a team that beat t removes one, below a team t beat adds one.
      const step = new Int32Array(rest.length + 1);
      for (const x of lost[t]!) step[pos[x]! + 1]! -= 1;
      for (const x of won[t]!) step[pos[x]! + 1]! += 1;
      let cost = lost[t]!.length;
      let best = cost, bestP = 0, curCost = cost;
      for (let p = 1; p <= rest.length; p++) {
        cost += step[p]!;
        if (p === cur) curCost = cost;
        if (cost < best || (cost === best && Math.abs(p - cur) < Math.abs(bestP - cur))) {
          best = cost;
          bestP = p;
        }
      }
      if (best < curCost) {
        rest.splice(bestP, 0, t);
        order = rest;
        moved = true;
      }
    }
    if (!moved) return order;
  }
}
