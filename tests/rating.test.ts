import { describe, expect, it } from "vitest";
import { type RatedGame, fitRatings, gameValue, result } from "../src/engine/rating";

const zeros = (n: number) => new Float64Array(n);
const opts = (n: number, over: Partial<{ winBonus: number; prior: Float64Array; priorWeight: number }> = {}) => ({ winBonus: 3, prior: zeros(n), priorWeight: 2, ...over });

/** A fixed pseudo-random season: `n` teams, `m` games, stronger teams (lower ids) usually win. */
function season(n: number, m: number, seed: number): RatedGame[] {
  let x = seed;
  const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
  const out: RatedGame[] = [];
  while (out.length < m) {
    const home = Math.floor(rnd() * n), away = Math.floor(rnd() * n);
    if (home === away) continue;
    const margin = Math.round((away - home) * 1.5 + 3 + (rnd() - 0.5) * 30) || 1;
    out.push({ home, away, margin, neutral: rnd() < 0.1 });
  }
  return out;
}

describe("result", () => {
  it("adds the win bonus to the winner's margin", () => {
    expect(result(10, 3)).toBe(13);
    expect(result(-10, 3)).toBe(-13);
    expect(result(1, 0)).toBe(1);
  });
});

describe("fitRatings", () => {
  it("splits a lone neutral-site result between the two teams", () => {
    // Minimise (13 - (a - b))^2 + 2 (a^2 + b^2): a = -b and a - b = 13 / 2.
    const { ratings } = fitRatings(2, [{ home: 0, away: 1, margin: 10, neutral: true }], opts(2));
    expect(ratings[0]! - ratings[1]!).toBeCloseTo(13 / 2, 10);
    expect(ratings[0]! + ratings[1]!).toBeCloseTo(0, 10);
  });

  it("leaves a team with no games at its starting rating", () => {
    const prior = Float64Array.from([0, 0, 12.5]);
    const { ratings } = fitRatings(3, [{ home: 0, away: 1, margin: 7, neutral: false }], opts(3, { prior }));
    expect(ratings[2]).toBeCloseTo(12.5, 12);
  });

  it("each rating is exactly the weighted average of its game values and its starting rating", () => {
    const n = 20;
    const games = season(n, 90, 4);
    const prior = Float64Array.from({ length: n }, (_, i) => 10 - i);
    const { ratings, homeField } = fitRatings(n, games, opts(n, { prior }));
    for (let t = 0; t < n; t++) {
      let sum = 2 * prior[t]!, count = 2;
      for (const g of games) {
        if (g.home !== t && g.away !== t) continue;
        const home = g.home === t;
        sum += gameValue(ratings[home ? g.away : g.home]!, home ? g.margin : -g.margin, g.neutral ? 0 : home ? 1 : -1, homeField, 3);
        count++;
      }
      expect(ratings[t]!).toBeCloseTo(sum / count, 9);
    }
  });

  it("estimates home field from the results", () => {
    // Equal teams in a round robin, home and away; the home side always wins by 4.
    const games: RatedGame[] = [];
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) if (i !== j) games.push({ home: i, away: j, margin: 4, neutral: false });
    const { ratings, homeField } = fitRatings(6, games, opts(6, { winBonus: 0 }));
    expect(homeField).toBeCloseTo(4, 3);
    for (const r of ratings) expect(r).toBeCloseTo(0, 6);
  });

  it("the starting rating fades as games accumulate", () => {
    const prior = Float64Array.from([20, 0]);
    const one = fitRatings(2, [{ home: 1, away: 0, margin: 14, neutral: true }], opts(2, { prior })).ratings;
    const many = fitRatings(2, Array.from({ length: 12 }, () => ({ home: 1, away: 0, margin: 14, neutral: true })), opts(2, { prior })).ratings;
    // Team 1 keeps beating team 0 by 14 (+3): with more games its edge approaches 17.
    expect(many[1]! - many[0]!).toBeGreaterThan(one[1]! - one[0]!);
    expect(many[1]! - many[0]!).toBeGreaterThan(12);
  });

  it("is bit-identical across runs", () => {
    const games = season(30, 140, 9);
    expect(fitRatings(30, games, opts(30))).toEqual(fitRatings(30, games, opts(30)));
  });

  it("rejects a non-positive prior weight", () => {
    expect(() => fitRatings(2, [], opts(2, { priorWeight: 0 }))).toThrow(/priorWeight/);
  });
});
