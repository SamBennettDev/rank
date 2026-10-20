import { describe, expect, it } from "vitest";
import { gamesToCsv, teamsToCsv } from "../src/engine/data";
import { DEFAULT_SETTINGS } from "../src/engine/defaults";
import { computeSeason } from "../src/engine/season";
import {
  marginGap,
  gamePoints,
  quality,
  solveSprings,
  twoPass,
  type Spring,
} from "../src/engine/springs";
import type { Team } from "../src/engine/types";

const S = DEFAULT_SETTINGS.springs;
const win = (winner: number, loser: number, margin = 7): Spring => ({
  winner,
  loser,
  margin,
});
const ones = (n: number) => Array.from({ length: n }, () => 1);

describe("solveSprings", () => {
  it("spaces a chain of equal springs evenly, winners on top", () => {
    const h = solveSprings(3, [win(0, 1), win(1, 2)], [1, 1], [1, 1], 1e-9);
    expect(h[0]! - h[1]!).toBeCloseTo(1, 6);
    expect(h[1]! - h[2]!).toBeCloseTo(1, 6);
    expect(h[0]! + h[1]! + h[2]!).toBeCloseTo(0, 6);
  });

  it("puts every team at the stiffness-weighted average of what its games say", () => {
    const springs = [win(0, 1), win(1, 2), win(2, 0), win(0, 3), win(3, 2)];
    const k = [3, 0.5, 1, 2, 0.25];
    const gap = [7, 3, 10, 1, 2];
    const h = solveSprings(4, springs, k, gap, 0.1);
    for (let i = 0; i < 4; i++) {
      let sum = 0,
        weight = 0.1;
      springs.forEach((s, e) => {
        if (s.winner === i) sum += k[e]! * (h[s.loser]! + gap[e]!);
        if (s.loser === i) sum += k[e]! * (h[s.winner]! - gap[e]!);
        if (s.winner === i || s.loser === i) weight += k[e]!;
      });
      expect(h[i]).toBeCloseTo(sum / weight, 9);
    }
  });

  it("leaves a team with no games at 0", () => {
    const h = solveSprings(3, [win(0, 1)], [5], [7], 1);
    expect(h[2]).toBe(0);
  });

  it("is bit-identical across runs", () => {
    const springs = [win(0, 1, 3), win(2, 1, 40), win(2, 0, 1)];
    expect(twoPass(3, springs, S)).toEqual(twoPass(3, springs, S));
  });
});

describe("pass 2 pull", () => {
  const good = quality(30, S.qualityScale),
    average = quality(0, S.qualityScale),
    bad = quality(-30, S.qualityScale);

  it("turns strength into a chance of beating an average team", () => {
    expect(average).toBe(0.5);
    expect(good).toBeGreaterThan(0.9);
    expect(good + bad).toBeCloseTo(1, 12);
  });

  it("earns the beaten team's quality and loses 7 minus the winner's", () => {
    expect(gamePoints(good, bad)).toEqual({
      win: 7 * bad,
      loss: -(7 - 7 * good),
    });
    const beatGood = gamePoints(average, good).win,
      beatBad = gamePoints(average, bad).win,
      loseToBad = gamePoints(bad, average).loss,
      loseToGood = gamePoints(good, average).loss;
    expect(beatGood).toBeGreaterThan(beatBad);
    expect(loseToBad).toBeLessThan(loseToGood);
    expect(gamePoints(average, average)).toEqual({ win: 3.5, loss: -3.5 });
  });

  it("costs more to lose to a bad team than to a good one", () => {
    // 0 is strong (beats 2 and 3 by a lot), 3 is weak (loses to everyone else).
    const base = [win(0, 2, 30), win(0, 3, 35), win(1, 3, 28), win(2, 3, 21)];
    const loseToGood = twoPass(5, [...base, win(0, 4)], S).height;
    const loseToBad = twoPass(5, [...base, win(3, 4)], S).height;
    expect(loseToBad[4]!).toBeLessThan(loseToGood[4]!);
  });

  it("rewards beating a good team more than beating a bad one", () => {
    const base = [win(0, 2, 30), win(0, 3, 35), win(1, 3, 28), win(2, 3, 21)];
    const beatGood = twoPass(5, [...base, win(4, 0)], S).height;
    const beatBad = twoPass(5, [...base, win(4, 3)], S).height;
    expect(beatGood[4]!).toBeGreaterThan(beatBad[4]!);
  });

  it("rejects a non-positive pull toward average", () => {
    expect(() => solveSprings(2, [win(0, 1)], [1], [1], 0)).toThrow(/shrink/);
  });
});

describe("two passes", () => {
  it("counts each extra point of margin less than the one before", () => {
    expect(marginGap(1)).toBe(7);
    expect(marginGap(2)).toBeCloseTo(7 + 7 / 2, 12);
    expect(marginGap(3)).toBeCloseTo(7 + 7 / 2 + 7 / 3, 12);
    const steps = [2, 3, 7, 14, 28].map((m) => marginGap(m) - marginGap(m - 1));
    for (let i = 1; i < steps.length; i++)
      expect(steps[i]!).toBeLessThan(steps[i - 1]!);
    expect(() => marginGap(0)).toThrow();
  });

  it("pass 1 is margin SpringRank: strength 1, gap from the margin", () => {
    const springs = [win(0, 1, 3), win(1, 2, 14), win(0, 2, 1), win(3, 2, 35)];
    const { strength } = twoPass(4, springs, S);
    const plain = solveSprings(
      4,
      springs,
      ones(4),
      springs.map((s) => marginGap(s.margin)),
      S.strengthShrink,
    );
    expect(Array.from(strength)).toEqual(Array.from(plain));
  });

  it("pass 2 adds up each team's game points", () => {
    const springs = [win(0, 1, 3), win(1, 2, 14), win(0, 2, 1), win(3, 2, 35)];
    const { quality: q, points, height } = twoPass(4, springs, S);
    const total = [0, 0, 0, 0];
    springs.forEach((s, e) => {
      expect(points[e]).toEqual(gamePoints(q[s.winner]!, q[s.loser]!));
      total[s.winner]! += points[e]!.win;
      total[s.loser]! += points[e]!.loss;
    });
    expect(Array.from(height)).toEqual(total);
  });
});

describe("pipeline springs", () => {
  it("keeps results against lower-division opponents on the graph", async () => {
    const teams: Team[] = [1, 2, 3].map((id) => ({
      id,
      school: `Team ${id}`,
      abbreviation: String(id),
      conference: "Test",
      classification: "fbs",
      color: "",
    }));
    const game = (
      id: number,
      homeId: number,
      awayId: number,
      homeWins: boolean,
    ) => ({
      id,
      season: "test",
      week: 1,
      seasonType: "regular" as const,
      startDate: "2026-09-05T18:00:00.000Z",
      neutralSite: true,
      completed: true,
      homeId,
      homeTeam: `Team ${homeId}`,
      homePoints: homeWins ? 24 : 10,
      awayId,
      awayTeam: `Team ${awayId}`,
      awayPoints: homeWins ? 10 : 24,
    });
    const config = JSON.stringify({
      label: "Test",
      demo: true,
      ...DEFAULT_SETTINGS,
      classifications: ["fbs"],
    });
    const run = async (games: ReturnType<typeof game>[]) =>
      JSON.parse(
        (
          await computeSeason({
            season: "test",
            teamsCsv: teamsToCsv(teams),
            gamesCsv: gamesToCsv(games),
            configJson: config,
          })
        ).files.at(-1)!.json,
      );
    const base = [game(1, 1, 2, true), game(2, 2, 3, true)];
    const without = await run(base);
    const withLoss = await run([...base, game(3, 99, 1, true)]);
    const team1 = (r: {
      teams: { id: number; height: number; losses: number }[];
    }) => r.teams.find((t) => t.id === 1)!;
    expect(team1(withLoss).losses).toBe(1);
    expect(team1(withLoss).height).toBeLessThan(team1(without).height);
    expect(withLoss.springs.map((s: { gameId: number }) => s.gameId)).toEqual([
      1, 2, 3,
    ]);
    expect(withLoss.opponents[0]).toMatchObject({ id: 99, rank: null });
  });
});
