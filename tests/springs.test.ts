import { describe, expect, it } from "vitest";
import { gamesToCsv, teamsToCsv } from "../src/engine/data";
import { DEFAULT_SETTINGS } from "../src/engine/defaults";
import { computeSeason } from "../src/engine/season";
import {
  marginGap,
  strengthOfRecord,
  quality,
  solveSprings,
  rankByQuality,
  solveStrength,
  type Spring,
} from "../src/engine/springs";
import type { Team } from "../src/engine/types";

const S = DEFAULT_SETTINGS.springs;
const win = (winner: number, loser: number, margin = 7): Spring => ({
  winner,
  loser,
  margin,
});

describe("solveSprings", () => {
  it("spaces a chain of equal springs evenly, winners on top", () => {
    const h = solveSprings(3, [win(0, 1), win(1, 2)], [1, 1], 1e-9);
    expect(h[0]! - h[1]!).toBeCloseTo(1, 6);
    expect(h[1]! - h[2]!).toBeCloseTo(1, 6);
    expect(h[0]! + h[1]! + h[2]!).toBeCloseTo(0, 6);
  });

  it("puts every team at the average of what its games say", () => {
    const springs = [win(0, 1), win(1, 2), win(2, 0), win(0, 3), win(3, 2)];
    const gap = [7, 3, 10, 1, 2];
    const h = solveSprings(4, springs, gap, 0.1);
    for (let i = 0; i < 4; i++) {
      let sum = 0,
        weight = 0.1;
      springs.forEach((s, e) => {
        if (s.winner === i) sum += h[s.loser]! + gap[e]!;
        if (s.loser === i) sum += h[s.winner]! - gap[e]!;
        if (s.winner === i || s.loser === i) weight += 1;
      });
      expect(h[i]).toBeCloseTo(sum / weight, 9);
    }
  });

  it("leaves a team with no games at 0", () => {
    const h = solveSprings(3, [win(0, 1)], [7], 1);
    expect(h[2]).toBe(0);
  });

  it("is bit-identical across runs", () => {
    const springs = [win(0, 1, 3), win(2, 1, 40), win(2, 0, 1)];
    expect(rankByQuality(3, springs, S)).toEqual(rankByQuality(3, springs, S));
  });
});

describe("quality", () => {
  const good = quality(1200, S.qualityScale),
    average = quality(0, S.qualityScale),
    bad = quality(-1200, S.qualityScale);

  it("turns strength into a chance of beating an average team", () => {
    expect(average).toBe(0.5);
    expect(good).toBeGreaterThan(0.9);
    expect(good + bad).toBeCloseTo(1, 12);
  });

  it("counts each extra point of margin less than the one before", () => {
    expect(marginGap(1)).toBe(100);
    expect(marginGap(16)).toBe(800);
    expect(marginGap(81)).toBe(2700);
    for (const m of [2, 3, 7, 14, 28, 56])
      expect(marginGap(m)).toBeCloseTo(100 * m ** 0.75, 9);
    const steps = [2, 3, 7, 14, 28].map((m) => marginGap(m) - marginGap(m - 1));
    for (let i = 1; i < steps.length; i++)
      expect(steps[i]!).toBeLessThan(steps[i - 1]!);
    expect(() => marginGap(0)).toThrow();
  });

  it("is one solve of the margin springs", () => {
    const springs = [win(0, 1, 3), win(1, 2, 14), win(0, 2, 1), win(3, 2, 35)];
    const strength = solveStrength(4, springs, S);
    const again = solveSprings(
      4,
      springs,
      springs.map((s) => marginGap(s.margin)),
      S.strengthShrink,
    );
    expect(Array.from(strength)).toEqual(Array.from(again));
  });

  it("is 100 × the chance of beating an average team, in strength order", () => {
    const springs = [win(0, 1, 3), win(1, 2, 14), win(0, 2, 1), win(3, 2, 35)];
    const r = rankByQuality(4, springs, S);
    for (let i = 0; i < 4; i++)
      expect(r.quality[i]).toBe(100 * quality(r.strength[i]!, S.qualityScale));
  });

  it("never lets a blowout of a weak team pull the winner down", () => {
    // 0 and 1 are strong and close; 2 is weak. 0 also crushes 2 by 56.
    const base = [
      win(0, 1, 4),
      win(1, 2, 30),
      win(0, 2, 30),
      win(1, 3, 20),
      win(3, 2, 21),
    ];
    const without = solveStrength(4, base, S);
    const withBlowout = solveStrength(4, [...base, win(0, 2, 56)], S);
    expect(withBlowout[0]!).toBeGreaterThan(without[0]!);
  });

  it("lifts the winner more the bigger the margin", () => {
    const base = [win(1, 2, 10), win(2, 3, 10)];
    const heights = [1, 7, 21, 42].map(
      (m) => solveStrength(4, [...base, win(0, 2, m)], S)[0]!,
    );
    for (let i = 1; i < heights.length; i++)
      expect(heights[i]!).toBeGreaterThan(heights[i - 1]!);
  });

  it("rejects a non-positive pull toward average", () => {
    expect(() => solveSprings(2, [win(0, 1)], [1], 0)).toThrow(/shrink/);
  });
});

describe("résumé: strength of record", () => {
  // Strengths for: 0 strong, 1 strong, 2 weak, 3 weak, plus team 4 whose schedule varies.
  const strength = [800, 700, -600, -700, 0];
  const scale = S.qualityScale;

  it("counts an unbeaten record against strong teams for more than against weak ones", () => {
    const tough = strengthOfRecord([{ opponent: 0, won: true }, { opponent: 1, won: true }], 500, strength, scale);
    const soft = strengthOfRecord([{ opponent: 2, won: true }, { opponent: 3, won: true }], 500, strength, scale);
    expect(tough.score).toBeGreaterThan(soft.score);
    expect(soft.expectedWins).toBeGreaterThan(tough.expectedWins);
  });

  it("costs less to lose to a strong team than to a weak one", () => {
    const toStrong = strengthOfRecord([{ opponent: 0, won: false }, { opponent: 2, won: true }], 500, strength, scale);
    const toWeak = strengthOfRecord([{ opponent: 3, won: false }, { opponent: 2, won: true }], 500, strength, scale);
    expect(toStrong.score).toBeGreaterThan(toWeak.score);
  });

  it("is 100 × (P(fewer wins) + ½ P(as many)) for the benchmark", () => {
    const p0 = quality(500 - 800, scale),
      p2 = quality(500 + 600, scale);
    // One win in two games: P(0 wins) + ½ P(1 win).
    const zero = (1 - p0) * (1 - p2),
      one = p0 * (1 - p2) + (1 - p0) * p2;
    const r = strengthOfRecord([{ opponent: 0, won: false }, { opponent: 2, won: true }], 500, strength, scale);
    expect(r.score).toBeCloseTo(100 * (zero + one / 2), 12);
    expect(r.expectedWins).toBeCloseTo(p0 + p2, 12);
  });

  it("averages the benchmarks, strongest teams first, then an average team", () => {
    const springs = [win(0, 1, 3), win(1, 2, 14), win(0, 2, 1), win(3, 2, 35)];
    const r = rankByQuality(4, springs, S);
    expect(r.benchmarks.at(-1)).toBe(0);
    for (let i = 0; i < 4; i++) {
      const parts = r.resumeParts[i]!;
      expect(parts).toHaveLength(5);
      expect(r.resume[i]).toBeCloseTo(parts.reduce((a, b) => a + b, 0) / 5, 12);
    }
    expect(r.resume[0]!).toBeGreaterThan(r.resume[2]!);
  });

  it("averages opponents' quality per game played as the schedule", () => {
    const springs = [win(0, 1, 3), win(1, 2, 14), win(0, 2, 1), win(3, 2, 35)];
    const { quality: q, schedule } = rankByQuality(4, springs, S);
    expect(schedule[3]).toBe(q[2]);
    expect(schedule[0]).toBeCloseTo((q[1]! + q[2]!) / 2, 12);
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
