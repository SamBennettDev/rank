import { describe, expect, it } from "vitest";
import { DEFAULT_MATCHUP, DEFAULT_SETTINGS } from "../src/engine/defaults";
import { parseConfig } from "../src/engine/data";
import { evaluateSeason } from "../src/engine/evaluation";
import { fitMatchup, makeMatchupContext } from "../src/engine/matchup";
import type { SeasonConfig, Team } from "../src/engine/types";

const config: SeasonConfig = { label: "Test", demo: true, ...DEFAULT_SETTINGS };
const teams: Team[] = ["fbs", "fbs", "fcs", "fcs"].map((classification, i) => ({
  id: i + 1,
  school: `Team ${i + 1}`,
  abbreviation: String(i + 1),
  conference: "Test",
  classification,
  color: "",
}));
const date = Date.UTC(2026, 8, 5, 18);

describe("matchup model", () => {
  it("starts FCS teams the division gap below FBS teams, centred on 0", () => {
    const { priorMeans } = makeMatchupContext(teams, config);
    expect(priorMeans[0]! - priorMeans[2]!).toBeCloseTo(
      DEFAULT_MATCHUP.divisionGap,
      9,
    );
    expect(priorMeans.reduce((s, v) => s + v, 0)).toBeCloseTo(0, 9);
    const { fit } = fitMatchup(
      4,
      [],
      config,
      makeMatchupContext(teams, config),
    );
    expect(fit.homeField).toBeCloseTo(DEFAULT_MATCHUP.homeField, 6);
  });

  it("predicts walk-forward without reading the upcoming score", () => {
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

  it("rejects invalid matchup settings", () => {
    const bad = (matchup: object) =>
      parseConfig(
        JSON.stringify({
          ...config,
          matchup: { ...DEFAULT_MATCHUP, ...matchup },
        }),
      );
    expect(() => bad({ shrink: 0 })).toThrow(/matchup\.shrink/);
    expect(() => bad({ residualScale: null })).toThrow(/residualScale/);
    expect(() => bad({ calibrationId: "" })).toThrow(/calibrationId/);
  });
});
