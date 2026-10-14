import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  calculateResumes,
  fitResultRatings,
  recordProbability,
} from "../src/engine/resume";
import { computeSeason } from "../src/engine/season";
import {
  gamesToCsv,
  parseConfig,
  parseGames,
  parseTeams,
  teamsToCsv,
} from "../src/engine/data";
import { buildEdges, listSnapshots } from "../src/engine/graph";
import type { Edge, ResumeSettings, Team } from "../src/engine/types";

const settings: ResumeSettings = {
  method: "opponent-independent-resume-v1",
  ridge: 0.5,
  homeAdvantage: 0.3,
  benchmarkRank: 3,
  reference: "fbs",
  leaveTeamOut: true,
};
const teams: Team[] = Array.from({ length: 8 }, (_, i) => ({
  id: i + 1,
  school: `Team ${i + 1}`,
  abbreviation: String(i + 1),
  conference: "Test",
  classification: "fbs",
  color: "",
}));
const edge = (
  gameId: number,
  winner: number,
  loser: number,
  home = winner,
  neutralSite = true,
): Edge => ({
  gameId,
  winner,
  loser,
  week: 1,
  seasonType: "regular",
  winnerPoints: 14,
  loserPoints: 7,
  winnerIsHome: home === winner,
  neutralSite,
});
const schedule = [
  edge(1, 1, 2),
  edge(2, 2, 3),
  edge(3, 2, 4),
  edge(4, 3, 5),
  edge(5, 4, 6),
  edge(6, 5, 6),
  edge(7, 7, 8),
  edge(8, 3, 8),
  edge(9, 7, 4),
  edge(10, 1, 7),
];
const resume = (edges: Edge[], field = teams) =>
  calculateResumes(field, edges, settings);

describe("results-only resume", () => {
  it("starts every team equal and leaves teams without results unranked", () => {
    expect(Array.from(fitResultRatings(8, [], settings))).toEqual(
      new Array(8).fill(0),
    );
    expect(resume([]).ranks).toEqual(new Array(8).fill(null));
  });
  it("does not use margins, team names, conferences, colors, or division priors", () => {
    const baseline = resume(schedule).teams;
    const changed = resume(
      schedule.map((e) => ({ ...e, winnerPoints: 99, loserPoints: 0 })),
      teams.map((t) => ({
        ...t,
        school: "Anonymous",
        conference: "Unrelated",
        color: "#fff",
      })),
    ).teams;
    expect(changed).toEqual(baseline);
    const results = [{ home: 0, away: 1, homeWon: true, neutral: true }];
    const r = fitResultRatings(2, results, settings);
    expect(r[0]).toBeCloseTo(-r[1]!, 10);
  });
  it("is invariant to input row order and identifier relabeling", () => {
    expect(
      resume([...schedule].reverse(), [...teams].reverse())
        .teams.slice()
        .reverse(),
    ).toEqual(resume(schedule).teams);
    const renamed = teams.map((t) => ({ ...t, id: 100 - t.id }));
    const altered = schedule.map((e) => ({
      ...e,
      winner: 100 - e.winner,
      loser: 100 - e.loser,
    }));
    const a = resume(schedule).teams,
      b = resume(altered, renamed).teams;
    expect(b.map((r) => r?.score)).toEqual(a.map((r) => r?.score));
  });
  it("removes all focal-team games from every opponent estimate", () => {
    const changed = schedule.map((e) =>
      e.gameId === 1
        ? {
            ...e,
            winner: e.loser,
            loser: e.winner,
            winnerIsHome: !e.winnerIsHome,
          }
        : e,
    );
    const a = resume(schedule).teams[0]!,
      b = resume(changed).teams[0]!;
    expect(b.games.map((g) => g.benchmarkWinProbability)).toEqual(
      a.games.map((g) => g.benchmarkWinProbability),
    );
    expect(b.score).toBeCloseTo(a.score - 1, 6);
    expect(b.benchmarkStrength).toBe(a.benchmarkStrength);
  });
  it("values a road win above the same home win", () => {
    const home = schedule.map((e) =>
      e.gameId === 1 ? { ...e, neutralSite: false, winnerIsHome: true } : e,
    );
    const road = home.map((e) =>
      e.gameId === 1 ? { ...e, winnerIsHome: false } : e,
    );
    expect(resume(road).teams[0]!.games[0]!.value).toBeGreaterThan(
      resume(home).teams[0]!.games[0]!.value,
    );
  });
  it("revalues an early win when its opponent earns additional wins", () => {
    const early = [edge(1, 1, 2), edge(2, 3, 4), edge(3, 5, 6), edge(4, 7, 8)];
    const later = [...early, edge(5, 2, 3), edge(6, 2, 5), edge(7, 2, 7)];
    expect(resume(later).teams[0]!.games[0]!.value).toBeGreaterThan(
      resume(early).teams[0]!.games[0]!.value,
    );
  });
  it("penalizes a loss to a weaker opponent more heavily", () => {
    const results = [edge(1, 2, 1), edge(2, 6, 1)];
    for (const opponent of [3, 4, 5, 7]) {
      results.push(edge(results.length + 1, 2, opponent));
      results.push(edge(results.length + 1, opponent, 6));
    }
    const games = resume(results).teams[0]!.games;
    expect(games.find((g) => g.opponentId === 6)!.value).toBeLessThan(
      games.find((g) => g.opponentId === 2)!.value,
    );
  });
  it("always gives wins nonnegative credit and losses nonpositive cost, with exact receipts", () => {
    for (const r of resume(schedule).teams)
      if (r) {
        expect(r.score).toBeCloseTo(
          r.games.reduce((s, g) => s + g.value, 0),
          6,
        );
        expect(r.score).toBeCloseTo(
          r.games.filter((g) => g.won).length - r.expectedWins,
          6,
        );
        for (const g of r.games)
          expect(g.won ? g.value >= 0 : g.value <= 0).toBe(true);
        expect(r.recordProbability).toBeGreaterThanOrEqual(0);
        expect(r.recordProbability).toBeLessThanOrEqual(1);
      }
  });
  it("counts external wins and losses without inventing quality for unknown opponents", () => {
    const r = resume([edge(1, 1, 99), edge(2, 99, 2)]).teams;
    expect(r[0]!.score).toBe(0);
    expect(r[1]!.score).toBe(-1);
    expect(r[0]!.games[0]).toMatchObject({ unmodeled: true, opponentGames: 0 });
  });
  it("computes exact Poisson-binomial record tails", () => {
    expect(recordProbability([0.5, 0.5], 2)).toBe(0.25);
    expect(recordProbability([0.5, 0.5], 1)).toBe(0.75);
    expect(recordProbability([0.1, 0.9], 0)).toBe(1);
    expect(recordProbability([1, 1], 2)).toBe(1);
    expect(recordProbability([0, 0], 1)).toBe(0);
    expect(() => recordProbability([NaN], 1)).toThrow();
  });
  it("rejects invalid policies and missing FBS references", () => {
    expect(() =>
      calculateResumes(teams, schedule, { ...settings, ridge: 0 }),
    ).toThrow();
    expect(() =>
      calculateResumes(teams, schedule, { ...settings, benchmarkRank: 0 }),
    ).toThrow();
    expect(() =>
      resume(
        schedule,
        teams.map((t) => ({ ...t, classification: "fcs" })),
      ),
    ).toThrow(/FBS/);
    expect(() =>
      parseConfig(
        JSON.stringify({
          ...JSON.parse(readFileSync("data/seasons/2026/config.json", "utf8")),
          resume: { ...settings, homeAdvantage: NaN },
        }),
      ),
    ).toThrow(/resume/);
  });
  it("publishes the resume score and labels legacy forecasts separately", async () => {
    const config = JSON.parse(
      readFileSync("data/seasons/2026/config.json", "utf8"),
    );
    const games = schedule.map((e, i) => ({
      id: e.gameId,
      season: "test",
      week: 1,
      seasonType: "regular" as const,
      startDate: new Date(Date.UTC(2026, 8, 5, 18, i)).toISOString(),
      neutralSite: e.neutralSite,
      completed: true,
      homeId: e.winnerIsHome ? e.winner : e.loser,
      awayId: e.winnerIsHome ? e.loser : e.winner,
      homeTeam: "Home",
      awayTeam: "Away",
      homePoints: e.winnerIsHome ? 14 : 7,
      awayPoints: e.winnerIsHome ? 7 : 14,
    }));
    const out = await computeSeason({
      season: "test",
      teamsCsv: teamsToCsv(teams),
      gamesCsv: gamesToCsv(games),
      configJson: JSON.stringify({
        ...config,
        resume: settings,
        projectionSamples: 128,
      }),
    });
    const snapshot = JSON.parse(out.files[0]!.json);
    expect(snapshot.manifest).toMatchObject({
      standingMethod: settings.method,
      lossPenalty: null,
    });
    expect(snapshot.projection.target).toBe("frozen-earned-points");
    for (const t of snapshot.teams) expect(t.height).toBe(t.resume.score);
  });
  it("keeps earlier rankings independent of future results", async () => {
    const teamsCsv = readFileSync("tests/fixtures/demo/teams.csv", "utf8");
    const games = parseGames(
      readFileSync("tests/fixtures/demo/games.csv", "utf8"),
    );
    const config = JSON.parse(
      readFileSync("tests/fixtures/demo/config.json", "utf8"),
    );
    const input = {
      season: "test",
      teamsCsv,
      gamesCsv: gamesToCsv(games),
      configJson: JSON.stringify({ ...config, resume: settings }),
    };
    const baseline = await computeSeason(input);
    const changed = await computeSeason({
      ...input,
      gamesCsv: gamesToCsv(
        games.map((g) =>
          g.week >= 6 ? { ...g, homePoints: 99, awayPoints: 0 } : g,
        ),
      ),
    });
    expect(JSON.parse(changed.files[0]!.json).teams).toEqual(
      JSON.parse(baseline.files[0]!.json).teams,
    );
  });
  it("reproduces published resume receipts from the current snapshot", () => {
    const field = parseTeams(
      readFileSync("data/seasons/2026/teams.csv", "utf8"),
    ).sort((a, b) => a.id - b.id);
    const games = parseGames(
      readFileSync("data/seasons/2026/games.csv", "utf8"),
    );
    const config = parseConfig(
      readFileSync("data/seasons/2026/config.json", "utf8"),
    );
    const snap = listSnapshots(games).at(-1)!;
    const unknown = new Map<number, Team>();
    const known = new Set(field.map((t) => t.id));
    for (const g of games)
      for (const [id, school] of [
        [g.homeId, g.homeTeam],
        [g.awayId, g.awayTeam],
      ] as const)
        if (!known.has(id))
          unknown.set(id, {
            id,
            school,
            abbreviation: "",
            conference: "Other",
            classification: "other",
            color: "",
          });
    const edges = buildEdges(
      games,
      [...field, ...unknown.values()],
      snap,
    ).edges;
    const result = calculateResumes(field, edges, config.resume!);
    const saved = JSON.parse(
      readFileSync("data/rankings/2026/week-06.json", "utf8"),
    );
    const independent = JSON.parse(
      readFileSync("research/resume/python-parity.json", "utf8"),
    );
    for (let i = 0; i < field.length; i++) {
      const row = saved.teams.find((t: Team) => t.id === field[i]!.id);
      expect(row.resume).toEqual(result.teams[i]);
      expect(row.rank).toEqual(result.ranks[i]);
      const expected = independent.rows.find((t: Team) => t.id === row.id);
      expect(row.resume.score).toEqual(expected.score);
      expect(row.resume.expectedWins).toEqual(expected.expectedWins);
      expect(row.resume.recordProbability).toEqual(expected.recordProbability);
    }
  });
});
