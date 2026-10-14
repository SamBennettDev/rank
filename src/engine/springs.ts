/** Equal, one-sided, unit-length springs. Only winner/loser endpoints enter the fit. */
export interface SpringGame {
  gameId: number;
  winner: number;
  loser: number;
}

export const SPRING_TOLERANCE = 1e-10;
export const SPRING_MAX_ITERATIONS = 2000000;

/**
 * Minimize E = 1/2 sum max(0, 1 - h[w] + h[l])^2.
 *
 * Start every node at zero. On each simultaneous relaxation, a compressed
 * spring pushes its winner up and loser down by equal amounts. A spring with
 * a gap >= 1 exerts no force. The component-local step 1/(2*maxDegree) is a
 * conservative inverse Lipschitz bound, so energy cannot increase. No tether,
 * margin, division prior, historical data, or extra loss term enters this fit.
 *
 * Absolute height is unidentifiable. Center each connected component at zero.
 * Slack springs can also leave several equilibria; this fixed zero-start
 * relaxation defines the reproducible solution, rather than claiming that the
 * energy always has a unique minimizer. Stop on net force, NOT movement or
 * energy change, and fail explicitly if the equilibrium has not converged.
 */
export function fitSprings(
  teamIds: readonly number[],
  games: readonly SpringGame[],
) {
  if (new Set(teamIds).size !== teamIds.length)
    throw new Error("duplicate spring node");
  const ids = [...teamIds].sort((a, b) => a - b);
  const index = new Map(ids.map((id, i) => [id, i]));
  const edges = [...games].sort((a, b) => a.gameId - b.gameId);
  if (new Set(edges.map((e) => e.gameId)).size !== edges.length)
    throw new Error("duplicate spring game");
  const n = ids.length,
    parent = ids.map((_, i) => i),
    degree = new Int32Array(n);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const pairs = edges.map((e) => {
    const w = index.get(e.winner),
      l = index.get(e.loser);
    if (w === undefined || l === undefined || w === l)
      throw new Error("invalid spring endpoints");
    degree[w]!++;
    degree[l]!++;
    const a = find(w),
      b = find(l);
    parent[Math.max(a, b)] = Math.min(a, b);
    return [w, l] as const;
  });
  const components = ids.map((_, i) => find(i));
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++)
    if (degree[i])
      (
        groups.get(components[i]!) ??
        groups.set(components[i]!, []).get(components[i]!)!
      ).push(i);
  const steps = new Map(
    [...groups].map(([c, members]) => [
      c,
      1 / (2 * Math.max(...members.map((i) => degree[i]!))),
    ]),
  );
  const heights = new Float64Array(n),
    force = new Float64Array(n);
  let iterations = 0,
    maxNetForce = Infinity;
  while (iterations <= SPRING_MAX_ITERATIONS) {
    force.fill(0);
    for (const [w, l] of pairs) {
      const compression = Math.max(0, 1 - heights[w]! + heights[l]!);
      force[w]! += compression;
      force[l]! -= compression;
    }
    maxNetForce = force.reduce((m, f) => Math.max(m, Math.abs(f)), 0);
    if (maxNetForce <= SPRING_TOLERANCE) break;
    if (iterations === SPRING_MAX_ITERATIONS)
      throw new Error(`spring equilibrium did not converge: ${maxNetForce}`);
    for (let i = 0; i < n; i++)
      if (degree[i]) heights[i]! += steps.get(components[i]!)! * force[i]!;
    iterations++;
  }
  // Forces conserve the component mean; remove only floating-point drift.
  for (const members of groups.values()) {
    const mean = members.reduce((s, i) => s + heights[i]!, 0) / members.length;
    for (const i of members) heights[i]! -= mean;
  }
  const springs = edges.map((e, i) => {
    const [w, l] = pairs[i]!,
      gap = heights[w]! - heights[l]!;
    const compression = Math.max(0, 1 - gap);
    return {
      gameId: e.gameId,
      winner: e.winner,
      loser: e.loser,
      gap,
      compression,
      energy: 0.5 * compression ** 2,
    };
  });
  return {
    heights: new Map(ids.map((id, i) => [id, degree[i] ? heights[i]! : null])),
    components: new Map(
      ids.map((id, i) => [id, degree[i] ? ids[components[i]!]! : null]),
    ),
    sizes: new Map(
      [...groups].map(([c, members]) => [ids[c]!, members.length]),
    ),
    springs,
    iterations,
    maxNetForce,
    energy: springs.reduce((s, e) => s + e.energy, 0),
  };
}
