import { describe, expect, it } from "vitest";
import { closeHeadToHead } from "../src/engine/headtohead";
import { type RatedGame, STOP_GAP, fitRatings } from "../src/engine/rating";

const opts = { winBonus: 3, shrink: 0.05 };

// Team 0 beat team 1 by 1, but team 1 crushed team 2 and team 0 only beat team 2 narrowly,
// so the plain rating puts team 1 a little above team 0.
const close: RatedGame[] = [
  { home: 0, away: 1, margin: 1, neutral: true },
  { home: 1, away: 2, margin: 20, neutral: true },
  { home: 0, away: 2, margin: 10, neutral: true },
];

describe("closeHeadToHead", () => {
  it("puts the head-to-head winner in front when the two are close", () => {
    const plain = fitRatings(3, close, opts).ratings;
    expect(plain[1]! - plain[0]!).toBeGreaterThan(0);
    expect(plain[1]! - plain[0]!).toBeLessThan(3);
    const { ratings, held } = closeHeadToHead(3, close, opts, 3);
    expect(held).toEqual([true, false, false]);
    expect(ratings[0]! - ratings[1]!).toBeGreaterThan(STOP_GAP * 0.9);
  });

  it("leaves teams alone when they are further apart than the window", () => {
    const plain = fitRatings(3, close, opts).ratings;
    const gap = plain[1]! - plain[0]!;
    const { ratings, held } = closeHeadToHead(3, close, opts, gap * 0.5);
    expect(held.every((h) => !h)).toBe(true);
    ratings.forEach((r, i) => expect(r).toBeCloseTo(plain[i]!, 12));
  });

  it("is off with a window of 0", () => {
    const { held } = closeHeadToHead(3, close, opts, 0);
    expect(held.every((h) => !h)).toBe(true);
  });

  it("never applies two holds that contradict each other in a cycle", () => {
    const cycle: RatedGame[] = [
      { home: 0, away: 1, margin: 1, neutral: true },
      { home: 1, away: 2, margin: 1, neutral: true },
      { home: 2, away: 0, margin: 1, neutral: true },
    ];
    const { ratings, held } = closeHeadToHead(3, cycle, opts, 3);
    expect(held.filter(Boolean).length).toBe(2);
    cycle.forEach((g, i) => {
      if (held[i]) expect(ratings[g.home]! - ratings[g.away]!).toBeGreaterThan(STOP_GAP * 0.9);
    });
  });
});
