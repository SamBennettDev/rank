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

  it("rejects non-positive alpha", () => {
    expect(() => springRank(2, [], 0)).toThrow();
  });
});
