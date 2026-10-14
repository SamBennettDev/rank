import { describe, expect, it } from "vitest";
import { forecastBatches, RESULT_LAG_MS } from "../src/engine/chronology";
import { DEFAULT_SETTINGS } from "../src/engine/defaults";
import { evaluateSeason, forecastMetrics } from "../src/engine/evaluation";
import { predictMatchup, rateTeams } from "../src/engine/model";
import { winProbability } from "../src/engine/probability";
import { fitMatchup, makeMatchupContext } from "../src/engine/matchup";
import { buildEdges, listSnapshots } from "../src/engine/graph";
import type { Game, SeasonConfig, Team } from "../src/engine/types";
const config: SeasonConfig = { label: "Test", demo: true, ...DEFAULT_SETTINGS };
const teams: Team[] = [0, 1, 2].map((i) => ({
  id: i + 1,
  school: `Team ${i}`,
  abbreviation: "",
  conference: "",
  classification: "fbs",
  color: "",
}));
const game = (
  id: number,
  date: string,
  type: "regular" | "postseason",
  h: number,
  a: number,
  margin: number,
  week: number,
): Game => ({
  id,
  season: "2023",
  week,
  seasonType: type,
  startDate: date,
  neutralSite: true,
  completed: true,
  homeId: h,
  homeTeam: "",
  homePoints: 30 + margin,
  awayId: a,
  awayTeam: "",
  awayPoints: 30,
});

describe("date-based forecasts", () => {
  const games = [
    game(1, "2023-11-18T18:00:00Z", "regular", 1, 3, 10, 12),
    game(2, "2023-11-18T18:00:00Z", "regular", 2, 3, 5, 12),
    game(3, "2023-11-25T18:00:00Z", "postseason", 1, 2, 1, 1),
    game(4, "2023-12-09T18:00:00Z", "regular", 2, 3, 50, 15),
    game(5, "2023-12-02T18:00:00Z", "postseason", 1, 2, 2, 2),
  ];
  it("never uses later regular-season scores for early playoffs, and uses earlier playoff rounds", () => {
    const batches = forecastBatches(games);
    const early = batches.find((b) => b.test.some((g) => g.id === 3))!,
      later = batches.find((b) => b.test.some((g) => g.id === 5))!;
    expect(early.train.map((g) => g.id)).toEqual([1, 2]);
    expect(later.train.map((g) => g.id)).toContain(3);
    for (const b of batches)
      for (const g of b.train)
        expect(Date.parse(g.startDate) + RESULT_LAG_MS).toBeLessThanOrEqual(
          Date.parse(b.cutoff),
        );
    const baseline = evaluateSeason(teams, games, config).find(
      (o) => o.gameId === 3,
    )!;
    const changed = evaluateSeason(
      teams,
      games.map((g) =>
        g.id === 4 ? { ...g, homePoints: 0, awayPoints: 100 } : g,
      ),
      config,
    ).find((o) => o.gameId === 3)!;
    expect(changed).toEqual(baseline);
  });
  it("rejects undated completed games instead of guessing chronology", () => {
    expect(() => forecastBatches([{ ...games[0]!, startDate: "" }])).toThrow(
      /start_date/,
    );
  });
  it("includes the latest result when a rescheduled game's availability crosses the final weekly cutoff", () => {
    const delayed = [
      games[0]!,
      game(6, "2023-11-20T10:00:00Z", "regular", 2, 3, 3, 12),
    ];
    const current = listSnapshots(delayed).at(-1)!;
    expect(current.asOf).toBe("2023-11-20T16:00:00.000Z");
    expect(
      buildEdges(delayed, teams, current).edges.map((e) => e.gameId),
    ).toEqual([1, 6]);
  });
  it("includes early playoff scores in the next dated regular-season snapshot", () => {
    const snapshots = listSnapshots(games),
      late = snapshots.find((s) => s.id === "week-15")!;
    const edges = buildEdges(games, teams, late).edges;
    expect(edges.map((e) => e.gameId)).toContain(3);
    const early = snapshots.find((s) => s.id === "week-12")!;
    expect(
      buildEdges(games, teams, early).edges.map((e) => e.gameId),
    ).not.toContain(3);
  });
});

describe("probabilities and uncertainty", () => {
  it("is symmetric, monotone, and less certain with greater rating variance", () => {
    expect(winProbability(0, 12)).toBe(0.5);
    expect(winProbability(10, 12) + winProbability(-10, 12)).toBeCloseTo(1, 14);
    expect(winProbability(20, 12)).toBeGreaterThan(winProbability(10, 12));
    expect(winProbability(10, 12, 100)).toBeLessThan(winProbability(10, 12));
    for (const edge of [-500, -20, -1, 0, 1, 20, 500])
      expect(winProbability(edge, 12)).toBeCloseTo(
        1 / (1 + Math.exp(-edge / 12)),
        12,
      );
  });
  it("incorporates home field using the prediction model", () => {
    const games = [];
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        if (i !== j)
          games.push({ home: i, away: j, margin: 4, neutral: false });
    const m = rateTeams(3, games, config, makeMatchupContext(teams, config)),
      neutral = predictMatchup(m, 0, 1, true, config),
      home = predictMatchup(m, 0, 1, false, config);
    expect(neutral.homeProbability).toBe(0.5);
    expect(home.homeProbability).toBeGreaterThan(0.5);
    m.ranks[0] = 99;
    expect(predictMatchup(m, 0, 1, false, config)).toEqual(home);
  });
  it("shrinks matchup uncertainty as more evidence arrives", () => {
    const one = [{ home: 0, away: 1, margin: 10, neutral: true }];
    const context = { priorMeans: [0, 0] };
    const a = fitMatchup(2, one, config, context).uncertainty;
    const b = fitMatchup(
      2,
      Array.from({ length: 12 }, () => one[0]!),
      config,
      context,
    ).uncertainty;
    expect(b.matchupVariance(0, 1, true)).toBeLessThan(
      a.matchupVariance(0, 1, true),
    );
  });
  it("computes proper probability metrics and true division subsets", () => {
    const rows = [
      {
        gameId: 1,
        season: "2023",
        cutoff: "",
        home: 1,
        away: 2,
        fbs: true,
        probability: 0.8,
        won: true,
        provisional: false,
      },
      {
        gameId: 2,
        season: "2023",
        cutoff: "",
        home: 1,
        away: 2,
        fbs: false,
        probability: 0.2,
        won: false,
        provisional: false,
      },
    ];
    const metrics = forecastMetrics(rows);
    expect(metrics.accuracy).toBe(1);
    expect(metrics.brier).toBeCloseTo(0.04);
    expect(metrics.logLoss).toBeCloseTo(-Math.log(0.8));
    expect(metrics.calibration.reduce((s, b) => s + b.n, 0)).toBe(2);
  });
});
