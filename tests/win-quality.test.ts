import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../src/engine/defaults";
import { DEFAULT_WIN_QUALITY } from "../src/engine/win-quality-settings";
import {
  fitWinQuality,
  makeWinQualityContext,
} from "../src/engine/win-quality";
import {
  scoreStandings,
  winCredit,
  type DatedGame,
} from "../src/engine/standing";
import { projectSeason } from "../src/engine/projection";
import { rateTeams } from "../src/engine/model";
import { parseConfig, gamesToCsv, teamsToCsv } from "../src/engine/data";
import { computeSeason } from "../src/engine/season";
import { evaluateSeason } from "../src/engine/evaluation";
import type { SeasonConfig, Team } from "../src/engine/types";
import { readFileSync } from "node:fs";

const config: SeasonConfig = {
  label: "Test",
  demo: true,
  ...DEFAULT_SETTINGS,
  algorithmVersion: "earned-standing-2",
  winQuality: DEFAULT_WIN_QUALITY,
  projectionSamples: 512,
};
const teams: Team[] = ["fbs", "fbs", "fcs", "fcs"].map((classification, i) => ({
  id: i + 1,
  school: `Team ${i + 1}`,
  abbreviation: String(i + 1),
  conference: "Test",
  classification,
  color: "",
}));
const context = makeWinQualityContext(teams, config)!;
const date = Date.UTC(2026, 8, 5, 18);
const game = (
  id: number,
  home: number,
  away: number,
  margin: number,
  time = date,
): DatedGame => ({
  id,
  home,
  away,
  margin,
  time,
  neutral: true,
});

describe("FBS-referenced balanced win credits", () => {
  it("uses the exact settings recorded by the historical design report", () => {
    const report = JSON.parse(
      readFileSync(
        new URL("../research/win-quality-calibration.json", import.meta.url),
        "utf8",
      ),
    );
    expect(DEFAULT_WIN_QUALITY).toEqual(report.selected);
  });
  it("supports v2 walk-forward evaluation without reading the upcoming score", () => {
    const g = (
      id: number,
      week: number,
      homePoints: number,
      awayPoints: number,
    ) => ({
      id,
      season: "test",
      week,
      seasonType: "regular" as const,
      startDate: new Date(date + (week - 1) * 7 * 86400000).toISOString(),
      neutralSite: true,
      completed: true,
      homeId: 1,
      homeTeam: "Team 1",
      homePoints,
      awayId: 2,
      awayTeam: "Team 2",
      awayPoints,
    });
    const earlier = g(1, 1, 14, 7),
      future = g(2, 4, 21, 7);
    const a = evaluateSeason(teams, [earlier, future], config),
      b = evaluateSeason(
        teams,
        [earlier, { ...future, homePoints: 7, awayPoints: 42 }],
        config,
      );
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0]!.probability).toBe(b[0]!.probability);
    expect(a[0]!.won).not.toBe(b[0]!.won);
  });
  it("counts lower-division losses and records while awarding zero for unsupported wins", async () => {
    const csvGame = (
      id: number,
      homeId: number,
      awayId: number,
      margin: number,
      week: number,
    ) => ({
      id,
      season: "test",
      week,
      seasonType: "regular" as const,
      startDate: new Date(date + (week - 1) * 7 * 86400000).toISOString(),
      neutralSite: true,
      completed: true,
      homeId,
      homeTeam: `Team ${homeId}`,
      homePoints: margin > 0 ? 10 : 3,
      awayId,
      awayTeam: `Team ${awayId}`,
      awayPoints: margin > 0 ? 3 : 10,
    });
    const out = await computeSeason({
      season: "test",
      teamsCsv: teamsToCsv(teams),
      gamesCsv: gamesToCsv([
        csvGame(1, 1, 99, 7, 1),
        csvGame(2, 3, 99, -7, 2),
        csvGame(3, 3, 1, 7, 3),
      ]),
      configJson: JSON.stringify(config),
    });
    const first = JSON.parse(out.files[0]!.json),
      last = JSON.parse(out.files.at(-1)!.json);
    expect(first.teams.find((t: { id: number }) => t.id === 1)).toMatchObject({
      height: 0,
      wins: 1,
      losses: 0,
      rank: 1,
    });
    expect(last.teams.find((t: { id: number }) => t.id === 1)).toMatchObject({
      height: -1,
      wins: 1,
      losses: 1,
    });
    expect(last.teams.find((t: { id: number }) => t.id === 3)).toMatchObject({
      height: 0,
      wins: 1,
      losses: 1,
    });
    expect(last.credits[0]).toMatchObject({ value: 0, unmodeled: true });
    expect(last.credits[1]).toMatchObject({
      winner: 99,
      loser: 3,
      value: 0,
      unmodeled: true,
    });
    expect(last.opponents[0]).toMatchObject({
      id: 99,
      rank: null,
      projection: null,
      classification: "other",
    });
    expect(last.manifest.counts).toMatchObject({
      included: 3,
      modeled: 1,
      unmodeled: 2,
    });
  });
  it("values an average neutral-site win at one point and a lower-division win substantially less", () => {
    const { fit, uncertainty } = fitWinQuality(
      teams.length,
      [],
      config,
      context,
    );
    expect(winCredit(0, 0, fit, uncertainty, config, context)).toBe(1);
    expect(winCredit(2, 0, fit, uncertainty, config, context)).toBeGreaterThan(
      0,
    );
    expect(winCredit(2, 0, fit, uncertainty, config, context)).toBeLessThan(
      0.3,
    );
    const standing = scoreStandings(
      4,
      [game(1, 0, 2, 20), game(2, 3, 1, 1)],
      config,
      context,
    );
    expect(standing.heights[3]).toBe(1);
    expect(standing.ranks[3]).toBe(1); // A genuine FCS upset can earn the top rank.
    expect(standing.heights[2]).toBe(-1);
    expect(standing.heights[1]).toBe(-1);
    expect(standing.credits[0]!.value).toBe(
      2 * standing.credits[0]!.quality!.probability,
    );
  });
  it("includes covariance with the FBS reference, instead of treating its mean as fixed", () => {
    const { uncertainty } = fitWinQuality(4, [], config, context);
    const variance = config.residualScale ** 2 / config.winQuality!.shrink;
    expect(uncertainty.referenceVariance(0, 0)).toBeCloseTo(variance / 2, 8);
    expect(uncertainty.referenceVariance(2, 0)).toBeCloseTo(variance * 1.5, 8);
  });
  it("does not change credit when every modeled strength has the same arbitrary offset", () => {
    const a = fitWinQuality(4, [game(1, 0, 2, 20)], config, context);
    const shifted = {
      ...context,
      priorMeans: context.priorMeans.map((v) => v + 100),
    };
    const b = fitWinQuality(4, [game(1, 0, 2, 20)], config, shifted);
    for (let i = 0; i < 4; i++)
      expect(winCredit(i, 1, a.fit, a.uncertainty, config, context)).toBe(
        winCredit(i, 1, b.fit, b.uncertainty, config, shifted),
      );
  });
  it("allows a proven FCS opponent to earn more credit than an average FBS opponent", () => {
    const evidence = Array.from({ length: 20 }, (_, i) =>
      game(i + 1, 2, i % 2, 35, date + i * 86400000),
    );
    const { fit, uncertainty } = fitWinQuality(4, evidence, config, context);
    expect(winCredit(2, 0, fit, uncertainty, config, context)).toBeGreaterThan(
      1,
    );
    expect(winCredit(2, 0, fit, uncertainty, config, context)).toBeGreaterThan(
      winCredit(0, 0, fit, uncertainty, config, context),
    );
  });
  it("awards identical credit for beating the same opponent, regardless of the winner's division or name", () => {
    const standing = scoreStandings(
      4,
      [game(1, 0, 1, 3), game(2, 2, 1, 30)],
      config,
      context,
    );
    expect(standing.credits.map((c) => c.value)).toEqual([1, 1]);
  });
  it("deducts exactly one for a later loss and never revalues earlier credits", () => {
    const gs = [game(1, 0, 2, 30), game(2, 0, 1, 30, date + 7 * 86400000)];
    const before = scoreStandings(4, gs, config, context);
    const after = scoreStandings(
      4,
      [...gs, game(3, 0, 3, -1, date + 14 * 86400000)],
      config,
      context,
    );
    expect(after.heights[0]).toBeCloseTo(before.heights[0]! - 1, 6);
    expect(after.credits.slice(0, 2)).toEqual(before.credits);
  });
  it("uses the corrected frozen credit and fixed deduction in remaining-game simulations", () => {
    const gs = [game(1, 0, 1, 10)],
      standing = scoreStandings(4, gs, config, context);
    const p = projectSeason(
      rateTeams(4, gs, config, context),
      standing,
      gs,
      [game(2, 0, 1, 0, date + 86400000)],
      config,
      "correlated",
      new Set([0, 1]),
      context,
    );
    expect(p.projections[0]!.ratingHigh).toBe(2);
    expect(p.projections[0]!.ratingLow).toBe(0);
    const done = projectSeason(
      rateTeams(4, gs, config, context),
      standing,
      gs,
      [],
      config,
      "correlated",
      new Set([0, 1]),
      context,
    );
    expect(done.projections[0]).toMatchObject({
      expectedRating: 1,
      rank: 1,
      rankLow: 1,
      rankHigh: 1,
    });
  });
  it("requires calibrated settings and an actual FBS reference", () => {
    expect(() =>
      parseConfig(JSON.stringify({ ...config, winQuality: undefined })),
    ).toThrow(/winQuality/);
    expect(() =>
      parseConfig(
        JSON.stringify({
          ...config,
          winQuality: { ...DEFAULT_WIN_QUALITY, shrink: 0 },
        }),
      ),
    ).toThrow(/winQuality/);
    expect(() =>
      parseConfig(
        JSON.stringify({
          ...config,
          winQuality: { ...DEFAULT_WIN_QUALITY, winScale: 8 },
        }),
      ),
    ).toThrow(/winQuality/);
    expect(() =>
      makeWinQualityContext(
        teams.map((t) => ({ ...t, classification: "fcs" })),
        config,
      ),
    ).toThrow(/FBS reference/);
  });
});
