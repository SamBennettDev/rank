import { describe, expect, it } from "vitest";
import { type Result, fewestUpsetsOrder } from "../src/engine/order";

const upsetsInOrder = (results: Result[], order: number[]) => {
  const at = new Map(order.map((t, i) => [t, i]));
  return results.filter((b) => at.get(b.winner)! > at.get(b.loser)!).length;
};

/** A fixed pseudo-random season: `n` teams, `m` games, winners biased toward lower ids. */
function season(n: number, m: number, seed: number): Result[] {
  let x = seed;
  const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
  const out: Result[] = [];
  while (out.length < m) {
    const a = Math.floor(rnd() * n), b = Math.floor(rnd() * n);
    if (a === b) continue;
    const upset = rnd() < 0.25;
    out.push({ winner: upset ? Math.max(a, b) : Math.min(a, b), loser: upset ? Math.min(a, b) : Math.max(a, b) });
  }
  return out;
}

describe("fewestUpsetsOrder", () => {
  it("leaves no upsets when the results contain no cycle", () => {
    const results: Result[] = [{ winner: 2, loser: 0 }, { winner: 0, loser: 1 }, { winner: 2, loser: 1 }];
    expect(upsetsInOrder(results, fewestUpsetsOrder(3, results, [1, 0, 2]))).toBe(0);
  });

  it("accepts exactly one upset in a cycle", () => {
    const cycle: Result[] = [0, 1, 2, 3, 4].map((i) => ({ winner: i, loser: (i + 1) % 5 }));
    expect(upsetsInOrder(cycle, fewestUpsetsOrder(5, cycle, [4, 3, 2, 1, 0]))).toBe(1);
  });

  it("stops where no single team can move to a place with fewer upsets", () => {
    const n = 25;
    const results = season(n, 110, 11);
    const order = fewestUpsetsOrder(n, results, [...Array(n).keys()].reverse());
    const count = upsetsInOrder(results, order);
    for (let t = 0; t < n; t++) {
      const rest = order.filter((x) => x !== t);
      for (let p = 0; p <= rest.length; p++) expect(upsetsInOrder(results, [...rest.slice(0, p), t, ...rest.slice(p)])).toBeGreaterThanOrEqual(count);
    }
  });
});
