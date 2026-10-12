import { type FitOptions, type RatedGame, STOP_GAP, fitRatings } from "./rating";

/**
 * Head-to-head as a tiebreaker between close teams.
 *
 * Teams are compared on their score: rating + `offset` (the record bonus). Start from the
 * plain rating. Any game whose winner scores below its loser by less than `window` points
 * (or above it by less than STOP_GAP) gets a hold: the winner's score must stay at least
 * STOP_GAP above the loser's. The whole ladder is then fitted again with
 * those holds, which can bring new close pairs into the window, so this repeats until
 * no new hold is added. Holds are only ever added, so it always stops.
 *
 * Candidates are taken closest first (then by game order). A hold that would contradict
 * holds already in place (the loser is already required, directly or through other
 * holds, to stay above the winner) is skipped, so cycles of close results never fight.
 * Games further apart than `window` are left to the rating alone.
 */
export function closeHeadToHead(n: number, games: readonly RatedGame[], options: Omit<FitOptions, "kept" | "need" | "from">, window: number, offset: Float64Array = new Float64Array(n)): { ratings: Float64Array; homeField: number; held: boolean[] } {
  let fit = fitRatings(n, games, options);
  const held = games.map(() => false);
  if (!(window > 0)) return { ...fit, held };
  const pairs = games.map((g) => (g.margin > 0 ? [g.home, g.away] : [g.away, g.home]) as [number, number]);
  // The rating gap a hold needs so that the score gap reaches STOP_GAP.
  const need = pairs.map(([w, l]) => STOP_GAP - (offset[w]! - offset[l]!));
  const above: number[][] = Array.from({ length: n }, () => []);
  const requiredAbove = (a: number, b: number) => {
    const stack = [a];
    const seen = new Uint8Array(n);
    while (stack.length > 0) {
      const x = stack.pop()!;
      if (x === b) return true;
      if (seen[x]) continue;
      seen[x] = 1;
      stack.push(...above[x]!);
    }
    return false;
  };
  for (let round = 0; round < 100; round++) {
    const r = fit.ratings;
    const candidates = pairs
      .map(([w, l], i) => ({ i, w, l, short: r[l]! + offset[l]! - (r[w]! + offset[w]!) }))
      .filter((c) => !held[c.i] && c.short > -STOP_GAP && c.short < window)
      .sort((a, b) => a.short - b.short || a.i - b.i);
    let added = false;
    for (const c of candidates) {
      if (requiredAbove(c.l, c.w)) continue;
      above[c.w]!.push(c.l);
      held[c.i] = true;
      added = true;
    }
    if (!added) return { ...fit, held };
    const from = new Float64Array(n + 1);
    from.set(fit.ratings);
    from[n] = fit.homeField;
    fit = fitRatings(n, games, { ...options, kept: held, need, from });
  }
  throw new Error("head-to-head holds did not settle");
}
