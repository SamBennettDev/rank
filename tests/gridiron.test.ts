import { describe, expect, it } from "vitest";
import { type FieldGame, type GridironParams, gameTarget, gridironSprings } from "../src/engine/gridiron";

const P: GridironParams = { winBonus: 7, blowoutLimit: 21, fitHomeField: true, maxIterations: 100 };
const TINY = 1e-9;
const neutral = (home: number, away: number, hp: number, ap: number): FieldGame => ({ home, away, homePoints: hp, awayPoints: ap, neutral: true });
const atHome = (home: number, away: number, hp: number, ap: number): FieldGame => ({ ...neutral(home, away, hp, ap), neutral: false });

describe("gridironSprings", () => {
  it("a win is worth the margin plus a touchdown", () => {
    expect(gameTarget({ homePoints: 24, awayPoints: 21 }, 7)).toBe(10);
    expect(gameTarget({ homePoints: 14, awayPoints: 35 }, 7)).toBe(-28);
    const r = gridironSprings(2, [neutral(0, 1, 27, 17)], TINY, P);
    expect(r.heights[0]! - r.heights[1]!).toBeCloseTo(17, 6);
  });

  it("solves home-field advantage from the data", () => {
    // Four equal teams; everyone hosts everyone once and the home team always wins by 3.
    const games: FieldGame[] = [];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if (i !== j) games.push(atHome(i, j, 24, 21));
    const r = gridironSprings(4, games, TINY, P);
    expect(r.homeField).toBeCloseTo(3 + 7, 6); // the home edge absorbs the whole (bonus-inclusive) target
    for (let i = 1; i < 4; i++) expect(r.heights[i]).toBeCloseTo(r.heights[0]!, 6);
  });

  it("ratings average exactly zero", () => {
    const r = gridironSprings(3, [atHome(0, 1, 30, 10), neutral(1, 2, 21, 20), atHome(2, 0, 17, 14)], 0.01, P);
    expect(r.heights[0]! + r.heights[1]! + r.heights[2]!).toBeCloseTo(0, 9);
  });

  it("the blowout limit bounds how far one lopsided result can drag the table", () => {
    // 0 beat 1 by 3, 1 beat 2 by 3, then 2 crushed 0 by 80.
    const games = [neutral(0, 1, 24, 21), neutral(1, 2, 24, 21), neutral(2, 0, 87, 7)];
    const limited = gridironSprings(3, games, TINY, P);
    const unlimited = gridironSprings(3, games, TINY, { ...P, blowoutLimit: 1e9 });
    expect(limited.heights[2]! - limited.heights[0]!).toBeLessThan(unlimited.heights[2]! - unlimited.heights[0]!);
    expect(limited.pull[2]).toBeLessThan(1); // the 80-point game is limited the most
    expect(limited.pull[2]).toBeLessThan(Math.min(limited.pull[0]!, limited.pull[1]!));
  });

  it("without any conflict the limit changes nothing", () => {
    const games = [neutral(0, 1, 70, 0), neutral(1, 2, 31, 30)];
    const a = gridironSprings(3, games, TINY, P);
    const b = gridironSprings(3, games, TINY, { ...P, blowoutLimit: 1e9 });
    for (let i = 0; i < 3; i++) expect(a.heights[i]).toBeCloseTo(b.heights[i]!, 5);
  });

  it("converges and is bit-for-bit repeatable", () => {
    const games: FieldGame[] = [];
    for (let i = 0; i < 40; i++) games.push(atHome(i % 9, (i * 4 + 1) % 9 === i % 9 ? (i + 1) % 9 : (i * 4 + 1) % 9, 10 + ((i * 7) % 45), (i * 13) % 31));
    const a = gridironSprings(9, games, 0.01, P);
    const b = gridironSprings(9, games, 0.01, P);
    expect(Array.from(b.heights)).toEqual(Array.from(a.heights));
    expect(b.homeField).toBe(a.homeField);
    expect(a.iterations).toBeLessThan(P.maxIterations);
  });

  it("validates parameters", () => {
    expect(() => gridironSprings(2, [], 0, P)).toThrow(/alpha/);
    expect(() => gridironSprings(2, [], 0.1, { ...P, blowoutLimit: 0 })).toThrow(/blowoutLimit/);
  });
});
