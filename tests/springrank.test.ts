import { describe, expect, it } from "vitest";
import { springRank } from "../src/engine/springrank";

const TINY = 1e-9;

describe("springRank", () => {
  it("spaces a chain A > B > C one unit apart, centred on zero", () => {
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

  it("weight 1 on every game is identical to the unweighted model", () => {
    const games = [{ winner: 0, loser: 1 }, { winner: 1, loser: 2 }, { winner: 2, loser: 0 }, { winner: 0, loser: 2 }];
    const plain = springRank(3, games, 0.01);
    const weighted = springRank(3, games.map((g) => ({ ...g, weight: 1 })), 0.01);
    expect(Array.from(weighted)).toEqual(Array.from(plain));
  });

  it("stiffness does not change the one-unit rest length of a lone game", () => {
    const close = springRank(2, [{ winner: 0, loser: 1, weight: 1 }], 1e-9);
    const blowout = springRank(2, [{ winner: 0, loser: 1, weight: 40 }], 1e-9);
    expect(close[0]! - close[1]!).toBeCloseTo(1, 6);
    expect(blowout[0]! - blowout[1]!).toBeCloseTo(1, 6);
  });

  it("in a cycle, the stiffest spring wins", () => {
    // 0 beat 1 by 3, 1 beat 2 by 3, 2 beat 0 by 30: the blowout should put 2 above 0.
    const s = springRank(3, [
      { winner: 0, loser: 1, weight: 3 },
      { winner: 1, loser: 2, weight: 3 },
      { winner: 2, loser: 0, weight: 30 },
    ], 0.01);
    expect(s[2]!).toBeGreaterThan(s[0]!);
    // Without weights the same cycle is a three-way tie.
    const flat = springRank(3, [{ winner: 0, loser: 1 }, { winner: 1, loser: 2 }, { winner: 2, loser: 0 }], 0.01);
    expect(flat[2]).toBeCloseTo(flat[0]!, 12);
  });

  it("rejects non-positive game weights", () => {
    expect(() => springRank(2, [{ winner: 0, loser: 1, weight: 0 }], 0.1)).toThrow(/weight/);
  });

  it("rejects non-positive alpha", () => {
    expect(() => springRank(2, [], 0)).toThrow();
  });
});
