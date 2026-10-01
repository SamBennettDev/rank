import { describe, expect, it } from "vitest";
import { springRank } from "../src/engine/springrank";

const TINY = 1e-9;

describe("springRank (equal win springs)", () => {
  it("spaces a chain A > B > C one rest length apart, centred on zero", () => {
    // 0 beats 1, 1 beats 2
    const s = springRank(3, [{ winner: 0, loser: 1 }, { winner: 1, loser: 2 }], TINY);
    expect(s[0]! - s[1]!).toBeCloseTo(1, 6);
    expect(s[1]! - s[2]!).toBeCloseTo(1, 6);
    expect(s[0]! + s[1]! + s[2]!).toBeCloseTo(0, 6);
  });

  it("puts a 3-cycle at equal heights", () => {
    const s = springRank(3, [
      { winner: 0, loser: 1 },
      { winner: 1, loser: 2 },
      { winner: 2, loser: 0 },
    ], 0.01);
    expect(s[0]).toBeCloseTo(s[1]!, 12);
    expect(s[1]).toBeCloseTo(s[2]!, 12);
  });

  it("a repeated win pulls the pair further apart than a single win", () => {
    const once = springRank(2, [{ winner: 0, loser: 1 }], 0.1);
    const twice = springRank(2, [{ winner: 0, loser: 1 }, { winner: 0, loser: 1 }], 0.1);
    expect(twice[0]! - twice[1]!).toBeGreaterThan(once[0]! - once[1]!);
  });

  it("leaves teams with no games at exactly zero", () => {
    const s = springRank(3, [{ winner: 0, loser: 1 }], 0.01);
    expect(s[2]).toBe(0);
  });

  it("a win over a stronger opponent lifts a team higher than a win over a weaker one", () => {
    // 0 beats 1; 2 beats 3; 1 beats 3 => 1 is stronger than 3, so beating 1 > beating 3
    const s = springRank(4, [
      { winner: 1, loser: 3 },
      { winner: 0, loser: 1 },
      { winner: 2, loser: 3 },
    ], 0.01);
    expect(s[0]!).toBeGreaterThan(s[2]!);
  });

  it("a rest length of 7 scales every height by exactly 7 and keeps the order", () => {
    const games = [{ winner: 0, loser: 1 }, { winner: 1, loser: 2 }, { winner: 2, loser: 3 }, { winner: 0, loser: 2 }];
    const one = springRank(4, games, 0.01);
    const seven = springRank(4, games, 0.01, 7);
    one.forEach((v, i) => expect(seven[i]).toBeCloseTo(7 * v, 9));
    const order = (h: Float64Array) => [...h.keys()].sort((a, b) => h[b]! - h[a]!);
    expect(order(seven)).toEqual(order(one));
  });

  it("a lone win puts the winner one rest length above the loser", () => {
    const s = springRank(2, [{ winner: 0, loser: 1 }], TINY, 7);
    expect(s[0]! - s[1]!).toBeCloseTo(7, 6);
  });

  it("rejects non-positive alpha or rest length", () => {
    expect(() => springRank(2, [], 0)).toThrow(/alpha/);
    expect(() => springRank(2, [], 0.1, 0)).toThrow(/restLength/);
  });
});
