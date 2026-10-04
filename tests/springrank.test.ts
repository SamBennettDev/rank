import { describe, expect, it } from "vitest";
import { springRank } from "../src/engine/springrank";

const TINY = 1e-9;

describe("springRank (raw margin springs)", () => {
  it("spaces a chain A > B > C by its raw score margins, centred on zero", () => {
    // 0 beats 1, 1 beats 2
    const s = springRank(3, [{ winner: 0, loser: 1, margin: 3 }, { winner: 1, loser: 2, margin: 21 }], TINY);
    expect(s[0]! - s[1]!).toBeCloseTo(3, 6);
    expect(s[1]! - s[2]!).toBeCloseTo(21, 6);
    expect(s[0]! + s[1]! + s[2]!).toBeCloseTo(0, 6);
  });

  it("puts a 3-cycle at equal heights", () => {
    const s = springRank(3, [
      { winner: 0, loser: 1, margin: 7 },
      { winner: 1, loser: 2, margin: 7 },
      { winner: 2, loser: 0, margin: 7 },
    ], 0.01);
    expect(s[0]).toBeCloseTo(s[1]!, 12);
    expect(s[1]).toBeCloseTo(s[2]!, 12);
  });

  it("a repeated win pulls the pair further apart than a single win", () => {
    const once = springRank(2, [{ winner: 0, loser: 1, margin: 1 }], 0.1);
    const twice = springRank(2, [{ winner: 0, loser: 1, margin: 1 }, { winner: 0, loser: 1, margin: 1 }], 0.1);
    expect(twice[0]! - twice[1]!).toBeGreaterThan(once[0]! - once[1]!);
  });

  it("leaves teams with no games at exactly zero", () => {
    const s = springRank(3, [{ winner: 0, loser: 1, margin: 14 }], 0.01);
    expect(s[2]).toBe(0);
  });

  it("a win over a stronger opponent lifts a team higher than a win over a weaker one", () => {
    // 0 beats 1; 2 beats 3; 1 beats 3 => 1 is stronger than 3, so beating 1 > beating 3
    const s = springRank(4, [
      { winner: 1, loser: 3, margin: 7 },
      { winner: 0, loser: 1, margin: 7 },
      { winner: 2, loser: 3, margin: 7 },
    ], 0.01);
    expect(s[0]!).toBeGreaterThan(s[2]!);
  });

  it("changing every margin by the same factor changes every height by that factor", () => {
    const games = [{ winner: 0, loser: 1, margin: 3 }, { winner: 1, loser: 2, margin: 14 }, { winner: 2, loser: 3, margin: 28 }, { winner: 0, loser: 2, margin: 1 }];
    const one = springRank(4, games, 0.01);
    const seven = springRank(4, games.map((g) => ({ ...g, margin: 7 * g.margin })), 0.01);
    one.forEach((v, i) => expect(seven[i]).toBeCloseTo(7 * v, 9));
    const order = (h: Float64Array) => [...h.keys()].sort((a, b) => h[b]! - h[a]!);
    expect(order(seven)).toEqual(order(one));
  });

  it("a lone win puts the winner its score margin above the loser", () => {
    const s = springRank(2, [{ winner: 0, loser: 1, margin: 35 }], TINY);
    expect(s[0]! - s[1]!).toBeCloseTo(35, 6);
  });

  it("uses the full raw margin, including margins above typical caps", () => {
    // With alpha = 2, a lone game's solved gap is exactly half its margin.
    for (const margin of [1, 3, 28, 60, 1000]) {
      const s = springRank(2, [
        { winner: 0, loser: 1, margin },
      ], 2);
      expect(s[0]! - s[1]!).toBeCloseTo(margin / 2, 10);
      expect(s[0]! + s[1]!).toBeCloseTo(0, 10);
    }
  });

  it("lets a larger margin outweigh the opposite result", () => {
    const s = springRank(2, [
      { winner: 0, loser: 1, margin: 1 },
      { winner: 1, loser: 0, margin: 50 },
    ], 0.01);
    expect(s[1]!).toBeGreaterThan(s[0]!);
    expect(s[1]! - s[0]!).toBeCloseTo((50 - 1) / (2 + 0.01 / 2), 8);
  });

  it("rejects non-positive alpha", () => {
    expect(() => springRank(2, [], 0)).toThrow(/alpha/);
  });
});
