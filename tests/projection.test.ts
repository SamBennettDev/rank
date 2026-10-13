import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../src/engine/defaults";
import { projectSeason, logFixed } from "../src/engine/projection";
import { rateTeams } from "../src/engine/model";
import { scoreStandings, type DatedGame } from "../src/engine/standing";
import type { SeasonConfig } from "../src/engine/types";
const config: SeasonConfig = {
  label: "Test",
  demo: true,
  ...DEFAULT_SETTINGS,
  projectionSamples: 512,
};
const date = Date.UTC(2026, 8, 5, 18);
const game = (
  id: number,
  home: number,
  away: number,
  margin: number,
  time = date,
): DatedGame => ({ id, home, away, margin, time, neutral: true });
function forecast(n: number, known: DatedGame[], future: DatedGame[]) {
  return projectSeason(
    rateTeams(n, known, config),
    scoreStandings(n, known, config),
    known,
    future,
    config,
  );
}
describe("earned standings", () => {
  it("deducts exactly one point even when the loser strongly outperforms expectations", () => {
    const known = [
      game(1, 0, 1, 90),
      game(2, 2, 3, 90),
      game(3, 0, 2, 90, date + 7 * 86400000),
    ];
    const before = scoreStandings(4, known, config),
      after = scoreStandings(
        4,
        [...known, game(4, 0, 3, -1, date + 14 * 86400000)],
        config,
      );
    expect(after.heights[0]).toBeCloseTo(before.heights[0]! - 1, 6);
    expect(after.credits.slice(0, 3)).toEqual(before.credits);
    expect(after.credits.at(-1)).toMatchObject({ winner: 3, loser: 0 });
  });
  it("uses result and pre-week opponent quality, without extra points for running up a score", () => {
    const a = scoreStandings(2, [game(1, 0, 1, 1)], config),
      b = scoreStandings(2, [game(1, 0, 1, 90)], config);
    expect(a.heights).toEqual([0.5, -1]);
    expect(b).toEqual(a);
  });
  it("rewards beating a proven stronger opponent more than a weaker one", () => {
    const earlier = [game(1, 1, 2, 30), game(2, 1, 3, 30)];
    const next = scoreStandings(
      4,
      [
        ...earlier,
        game(3, 0, 1, 1, date + 7 * 86400000),
        game(4, 0, 2, 1, date + 7 * 86400000),
      ],
      config,
    );
    const strong = next.credits.find((c) => c.gameId === 3)!,
      weak = next.credits.find((c) => c.gameId === 4)!;
    expect(strong.value).toBeGreaterThan(weak.value);
    expect(strong.value).toBeLessThanOrEqual(1);
    expect(weak.value).toBeGreaterThanOrEqual(0);
  });
});
describe("final earned-standing projections", () => {
  const known = [game(1, 0, 1, 10)];
  it("returns exact standing scores and ranks when the schedule is finished", () => {
    expect(forecast(2, known, []).projections[0]).toMatchObject({
      expectedRating: 0.5,
      rank: 1,
      expectedRank: 1,
      medianRank: 1,
      rankLow: 1,
      rankHigh: 1,
      ratingLow: 0.5,
      ratingHigh: 0.5,
      firstProbability: 1,
    });
    expect(forecast(2, known, []).projections[1]!.firstProbability).toBe(0);
  });
  it("ignores future result fields and repeats with exactly the same seed", () => {
    const future = [game(2, 0, 1, 0, date + 7 * 86400000)],
      a = forecast(2, known, future);
    expect(forecast(2, known, [{ ...future[0]!, margin: -999 }])).toEqual(a);
    expect(forecast(2, known, future)).toEqual(a);
    expect(a.projections[0]!.expectedRating).not.toBe(0.5);
  });
  it("uses who plays whom and keeps equal unscheduled teams tied", () => {
    const gs = [game(1, 0, 1, 1), game(2, 2, 3, 1), game(3, 4, 5, 1)];
    const a = forecast(6, gs, [game(4, 0, 1, 0, date + 7 * 86400000)]),
      b = forecast(6, gs, [game(4, 2, 1, 0, date + 7 * 86400000)]);
    expect(a.projections[0]!.expectedRating).not.toBe(
      b.projections[0]!.expectedRating,
    );
    expect(a.projections[2]).toEqual(a.projections[4]);
  });
  it("publishes a whole-number projected leaderboard even when all average finishes exceed one", () => {
    const p = forecast(
      6,
      [game(1, 0, 1, 1), game(2, 2, 3, 1), game(3, 4, 5, 1)],
      [game(4, 0, 1, 0, date + 7 * 86400000)],
    ).projections.filter((p) => p !== null);
    expect(Math.min(...p.map((p) => p.expectedRank))).toBeGreaterThan(1);
    expect(Math.min(...p.map((p) => p.rank))).toBe(1);
    expect(
      p.every((p) => Number.isInteger(p.rank) && p.rank >= 1 && p.rank <= 6),
    ).toBe(true);
    const ordered = [...p].sort((a, b) => a.rank - b.rank);
    expect(ordered.map((p) => p.expectedRank)).toEqual(
      [...p].map((p) => p.expectedRank).sort((a, b) => a - b),
    );
  });
  it("keeps the pre-week win credit for future games in a partially completed week", () => {
    const p = forecast(2, known, [game(2, 0, 1, 0, date + 86400000)])
      .projections[0]!;
    expect(p.ratingHigh).toBe(1);
    expect(p.ratingLow).toBe(-0.5);
  });
  it("projects scheduled unplayed teams without inventing current standings", () => {
    const model = rateTeams(3, known, config),
      standing = scoreStandings(3, known, config);
    const p = projectSeason(
      model,
      standing,
      known,
      [game(2, 0, 2, 0, date + 7 * 86400000)],
      config,
    );
    expect(standing.heights[2]).toBeNull();
    expect(p.projections[2]).not.toBeNull();
    expect(p.teams).toBe(3);
  });
  it("computes deterministic logistic quantiles accurately", () => {
    for (const x of [1e-12, 0.001, 0.25, 1, 2, 123.4, 1e12])
      expect(logFixed(x)).toBeCloseTo(Math.log(x), 12);
  });
});
