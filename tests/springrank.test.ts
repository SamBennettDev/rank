import { describe, expect, it } from "vitest";
import { type Beat, STOP_GAP, fewestUpsetsOrder, oneWaySprings, push, rankHeights } from "../src/engine/springrank";

const SETTINGS = { alpha: 0.01, softness: 7 };
const upsetsIn = (beats: Beat[], height: ArrayLike<number>) => beats.filter((b) => !(height[b.winner]! > height[b.loser]!)).length;
const upsetsInOrder = (beats: Beat[], order: number[]) => {
  const at = new Map(order.map((t, i) => [t, i]));
  return beats.filter((b) => at.get(b.winner)! > at.get(b.loser)!).length;
};

/** A fixed pseudo-random season: `n` teams, `m` games, winners biased toward lower ids. */
function season(n: number, m: number, seed: number): Beat[] {
  let x = seed;
  const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
  const out: Beat[] = [];
  while (out.length < m) {
    const a = Math.floor(rnd() * n), b = Math.floor(rnd() * n);
    if (a === b) continue;
    const favourite = Math.min(a, b), underdog = Math.max(a, b);
    const upset = rnd() < 0.25;
    out.push({ winner: upset ? underdog : favourite, loser: upset ? favourite : underdog, gap: 7 });
  }
  return out;
}

describe("push (one game's spring force)", () => {
  it("is 1/2 at the target gap, near 1 well short of it, near 0 well past it", () => {
    expect(push(7, 7, 7)).toBe(0.5);
    expect(push(-70, 7, 7)).toBeGreaterThan(0.99);
    expect(push(77, 7, 7)).toBeLessThan(0.01);
  });

  it("is never negative and only fades as the winner pulls ahead", () => {
    let last = 1;
    for (let d = -100; d <= 200; d += 0.5) {
      const f = push(d, 7, 7);
      expect(f).toBeGreaterThan(0);
      expect(f).toBeLessThanOrEqual(last);
      last = f;
    }
  });
});

describe("oneWaySprings", () => {
  it("never pulls a winner down or lifts a loser: removing any game never raises its winner or lowers its loser", () => {
    const beats = season(30, 150, 7);
    const full = oneWaySprings(30, beats, SETTINGS);
    beats.forEach((b, i) => {
      const without = oneWaySprings(30, beats.filter((_, j) => j !== i), SETTINGS);
      expect(without[b.winner]!).toBeLessThanOrEqual(full[b.winner]! + 1e-9);
      expect(without[b.loser]!).toBeGreaterThanOrEqual(full[b.loser]! - 1e-9);
    });
  });

  it("a win over even the weakest team still helps a little", () => {
    // 0 beat 1, 1 beat 2, 2 beat 3: team 3 is far below team 0.
    const chain: Beat[] = [{ winner: 0, loser: 1, gap: 7 }, { winner: 1, loser: 2, gap: 7 }, { winner: 2, loser: 3, gap: 7 }];
    const before = oneWaySprings(4, chain, SETTINGS);
    const after = oneWaySprings(4, [...chain, { winner: 0, loser: 3, gap: 7 }], SETTINGS);
    expect(after[0]!).toBeGreaterThan(before[0]!);
  });

  it("ranks more wins over the same opponents higher", () => {
    // Team 0 beat 2, 3 and 4; team 1 beat only 2.
    const beats: Beat[] = [2, 3, 4].map((l) => ({ winner: 0, loser: l, gap: 7 }));
    const s = oneWaySprings(5, [...beats, { winner: 1, loser: 2, gap: 7 }], SETTINGS);
    expect(s[0]!).toBeGreaterThan(s[1]!);
  });

  it("leaves teams with no games at exactly zero", () => {
    expect(oneWaySprings(3, [{ winner: 0, loser: 1, gap: 14 }], SETTINGS)[2]).toBe(0);
  });

  it("rejects non-positive settings", () => {
    expect(() => oneWaySprings(2, [], { alpha: 0, softness: 7 })).toThrow(/alpha/);
    expect(() => oneWaySprings(2, [], { alpha: 0.01, softness: 0 })).toThrow(/softness/);
  });
});

describe("fewestUpsetsOrder", () => {
  it("leaves no upsets when the results contain no cycle", () => {
    const beats: Beat[] = [{ winner: 2, loser: 0, gap: 7 }, { winner: 0, loser: 1, gap: 7 }, { winner: 2, loser: 1, gap: 7 }];
    expect(upsetsInOrder(beats, fewestUpsetsOrder(3, beats, [1, 0, 2]))).toBe(0);
  });

  it("accepts exactly one upset in a cycle", () => {
    const cycle: Beat[] = [0, 1, 2, 3, 4].map((i) => ({ winner: i, loser: (i + 1) % 5, gap: 7 }));
    expect(upsetsInOrder(cycle, fewestUpsetsOrder(5, cycle, [4, 3, 2, 1, 0]))).toBe(1);
  });

  it("stops where no single team can move to a place with fewer upsets", () => {
    const n = 25;
    const beats = season(n, 110, 11);
    const order = fewestUpsetsOrder(n, beats, [...Array(n).keys()].reverse());
    const count = upsetsInOrder(beats, order);
    for (let t = 0; t < n; t++) {
      const rest = order.filter((x) => x !== t);
      for (let p = 0; p <= rest.length; p++) expect(upsetsInOrder(beats, [...rest.slice(0, p), t, ...rest.slice(p)])).toBeGreaterThanOrEqual(count);
    }
  });
});

describe("rankHeights", () => {
  it("puts every winner above its loser except the accepted upsets", () => {
    const beats = season(40, 200, 5);
    const { heights, upset } = rankHeights(40, beats, SETTINGS);
    beats.forEach((b, i) => {
      if (!upset[i]) expect(heights[b.winner]! - heights[b.loser]!).toBeGreaterThan(STOP_GAP * 0.9);
    });
    expect(upsetsIn(beats, heights)).toBeLessThanOrEqual(upset.filter(Boolean).length);
  });

  it("leaves fewer upsets than the springs alone", () => {
    const beats = season(40, 200, 5);
    expect(upsetsIn(beats, rankHeights(40, beats, SETTINGS).heights)).toBeLessThan(upsetsIn(beats, oneWaySprings(40, beats, SETTINGS)));
  });

  it("puts a head-to-head winner above the loser when nothing contradicts it", () => {
    // Team 1 has the better record (beat 2, 3 and 4) but lost to team 0, its only loss.
    const beats: Beat[] = [
      { winner: 1, loser: 2, gap: 7 }, { winner: 1, loser: 3, gap: 7 }, { winner: 1, loser: 4, gap: 7 },
      { winner: 0, loser: 1, gap: 7 },
    ];
    const { heights } = rankHeights(5, beats, SETTINGS);
    expect(heights[0]!).toBeGreaterThan(heights[1]!);
  });

  it("is bit-identical across runs", () => {
    const beats = season(40, 200, 9);
    expect(rankHeights(40, beats, SETTINGS)).toEqual(rankHeights(40, beats, SETTINGS));
  });
});
