import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "../src/engine/csv";
import { buildEdges, listSnapshots } from "../src/engine/graph";
import {
  gamesToCsv,
  parseGames,
  parseTeams,
  playsToCsv,
  teamsToCsv,
} from "../src/engine/data";
import { computeSeason, ENGINE_VERSION } from "../src/engine/season";
import { DEFAULT_SETTINGS } from "../src/engine/defaults";
import { marginGap, quality, surprise } from "../src/engine/springs";

const dir = join(import.meta.dirname, "fixtures/demo");
const read = (f: string) => readFileSync(join(dir, f), "utf8");
const input = {
  season: "demo",
  teamsCsv: read("teams.csv"),
  gamesCsv: read("games.csv"),
  configJson: read("config.json"),
};

describe("determinism", () => {
  it("two runs produce identical bytes", async () => {
    const a = await computeSeason(input);
    const b = await computeSeason(input);
    expect(b).toEqual(a);
  });

  it("row order in the CSVs does not matter", async () => {
    const shuffle = (csv: string) => {
      const [header, ...rows] = parseCsv(csv);
      return toCsv(header!, rows.reverse());
    };
    const a = await computeSeason(input);
    const b = await computeSeason({
      ...input,
      gamesCsv: shuffle(input.gamesCsv),
      teamsCsv: shuffle(input.teamsCsv),
    });
    // hashes of the input bytes differ by design; everything else must match
    const strip = (s: string) =>
      s.replace(/"(teams|games)Sha256": "[0-9a-f]+",?\n\s*/g, "");
    expect(b.files.map((f) => strip(f.json))).toEqual(
      a.files.map((f) => strip(f.json)),
    );
  });

  it("ranks by the two spring passes while keeping the prediction model private", async () => {
    const base = parseGames(input.gamesCsv)[0]!;
    const gamesCsv = gamesToCsv([
      {
        ...base,
        id: 1,
        week: 1,
        homePoints: 3,
        awayPoints: 24,
        neutralSite: true,
      },
    ]);
    const out = await computeSeason({ ...input, gamesCsv });
    const teams = JSON.parse(out.files[0]!.json).teams;
    const home = teams.find((t: { id: number }) => t.id === base.homeId);
    const away = teams.find((t: { id: number }) => t.id === base.awayId);
    expect([away.rank, home.rank]).toEqual([1, 2]);
    // Two teams, one spring of strength k and pull toward 0 of `shrink` each:
    // the winner sits k·gap / (2k + shrink) above 0 and the loser the same below.
    // The solve settles where k is the game's surprise at those strengths.
    const sp = DEFAULT_SETTINGS.springs;
    const strength = away.strength;
    expect(home.strength).toBeCloseTo(-strength, 6);
    const k = surprise(
      quality(strength, sp.qualityScale),
      quality(-strength, sp.qualityScale),
    );
    expect(strength).toBeCloseTo(
      (k * marginGap(21)) / (2 * k + sp.strengthShrink),
      5,
    );
    const qAway = quality(strength, sp.qualityScale),
      qHome = quality(-strength, sp.qualityScale);
    expect(JSON.parse(out.files[0]!.json).springs).toEqual([
      {
        gameId: 1,
        winner: base.awayId,
        loser: base.homeId,
        margin: 21,
        spring: expect.any(Number),
        win: expect.any(Number),
        loss: expect.any(Number),
      },
    ]);
    // Quality is the ranking. Résumé: the winner earns the loser's quality, the
    // loser loses 7 minus the winner's. Schedule: the opponent's quality.
    expect(away.height).toBeCloseTo(7 * qAway, 5);
    expect(home.height).toBeCloseTo(7 * qHome, 5);
    expect(away.resume).toBeCloseTo(7 * qHome, 5);
    expect(home.resume).toBeCloseTo(-(7 - 7 * qAway), 5);
    expect(away.schedule).toBeCloseTo(7 * qHome, 5);
    expect(home.schedule).toBeCloseTo(7 * qAway, 5);
    expect([away.resumeRank, home.resumeRank]).toEqual([1, 2]);
    expect([away.scheduleRank, home.scheduleRank]).toEqual([2, 1]);
  });
});

describe("pipeline", () => {
  it("keeps published forecasts independent of later final scores", async () => {
    const games = parseGames(input.gamesCsv);
    const baseline = await computeSeason(input);
    const changed = await computeSeason({
      ...input,
      gamesCsv: gamesToCsv(
        games.map((g) =>
          g.week === 12 ? { ...g, homePoints: 99, awayPoints: 0 } : g,
        ),
      ),
    });
    const a = JSON.parse(baseline.files[0]!.json),
      b = JSON.parse(changed.files[0]!.json);
    expect(b.teams).toEqual(a.teams);
    expect(b.predictions).toEqual(a.predictions);
    expect(a.predictions.length).toBeGreaterThan(0);
    expect(
      a.teams
        .filter((t: { rank: number | null }) => t.rank !== null)
        .every((t: { provisional: boolean }) => t.provisional),
    ).toBe(true);
  });
  it("applies classifications inside the engine and rejects corrupt rows", async () => {
    const teams = parseTeams(input.teamsCsv),
      games = parseGames(input.gamesCsv),
      g = games[0]!;
    const teamsCsv = teamsToCsv(
      teams.map((t) =>
        t.id === g.homeId ? { ...t, classification: "fcs" } : t,
      ),
    );
    const out = await computeSeason({ ...input, teamsCsv });
    expect(
      JSON.parse(out.files[0]!.json).teams.some(
        (t: { id: number }) => t.id === g.homeId,
      ),
    ).toBe(false);
    expect(() => parseGames(gamesToCsv([g, g]))).toThrow(/duplicate/);
    expect(() => parseGames(gamesToCsv([{ ...g, homePoints: NaN }]))).toThrow(
      /score/,
    );
  });
  it("publishes one ranking file per snapshot", async () => {
    const out = await computeSeason(input);
    expect(out.files.map((f) => f.id)).toEqual(
      out.index.snapshots.map((s) => s.id),
    );
  });

  it("records the settings, home field and inputs in every manifest", async () => {
    const out = await computeSeason(input);
    const m = JSON.parse(out.files[0]!.json).manifest;
    expect(m).toMatchObject({
      engine: ENGINE_VERSION,
      ...DEFAULT_SETTINGS,
      classifications: ["fbs"],
    });
    expect(m).not.toHaveProperty("priorSeason");
    expect(JSON.parse(out.files[0]!.json).teams[0]).not.toHaveProperty("prior");
    expect(typeof m.homeField).toBe("number");
  });

  it("adds offense, defense and special teams from a play-by-play summary without moving the overall rating", async () => {
    const plays = parseGames(input.gamesCsv)
      .filter((g) => g.completed && g.homePoints !== null)
      .flatMap((g) => [
        {
          gameId: g.id,
          teamId: g.homeId,
          opponentId: g.awayId,
          snaps: 60,
          epa: g.homePoints! / 2,
          success: 25,
          specialEpa: 1,
        },
        {
          gameId: g.id,
          teamId: g.awayId,
          opponentId: g.homeId,
          snaps: 60,
          epa: g.awayPoints! / 2,
          success: 25,
          specialEpa: -1,
        },
      ]);
    const without = await computeSeason(input);
    const withPlays = await computeSeason({
      ...input,
      playsCsv: playsToCsv(plays),
    });
    const a = JSON.parse(without.files.at(-1)!.json),
      b = JSON.parse(withPlays.files.at(-1)!.json);
    expect(b.teams.map((t: { height: number }) => t.height)).toEqual(
      a.teams.map((t: { height: number }) => t.height),
    );
    expect(
      a.teams.every((t: { offense: number | null }) => t.offense === null),
    ).toBe(true);
    expect(
      b.teams
        .filter((t: { rank: number | null }) => t.rank !== null)
        .every(
          (t: {
            offense: number | null;
            defense: number | null;
            special: number | null;
          }) => t.offense !== null && t.defense !== null && t.special !== null,
        ),
    ).toBe(true);
    expect(b.manifest.playsSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(b.manifest.snapsPerGame).toBe(60);
    expect(a.manifest.playsSha256).toBeNull();
  });

  it("rejects invalid settings", async () => {
    const cfg = JSON.parse(input.configJson);
    const bad = (patch: object) =>
      computeSeason({
        ...input,
        configJson: JSON.stringify({ ...cfg, ...patch }),
      });
    await expect(bad({ algorithmVersion: "" })).rejects.toThrow(
      /algorithmVersion/,
    );
    await expect(bad({ classifications: [] })).rejects.toThrow(
      /classifications/,
    );
    await expect(bad({ opponentClassifications: "fcs" })).rejects.toThrow(
      /opponentClassifications/,
    );
    await expect(bad({ opponentClassifications: [] })).rejects.toThrow(
      /opponentClassifications/,
    );
    const springs = (patch: object) =>
      bad({ springs: { ...cfg.springs, ...patch } });
    await expect(springs({ strengthShrink: 0 })).rejects.toThrow(
      /strengthShrink/,
    );
    await expect(springs({ qualityScale: null })).rejects.toThrow(
      /qualityScale/,
    );
    await expect(
      bad({ matchup: { ...cfg.matchup, winBonus: -1 } }),
    ).rejects.toThrow(/winBonus/);
    await expect(bad({ unitShrink: 0 })).rejects.toThrow(/unitShrink/);
  });
});

describe("FBS publication scope", () => {
  it("ranks only FBS teams while keeping FCS opponents on the same spring graph", async () => {
    const [opponent, first, second] = parseTeams(input.teamsCsv);
    const teamsCsv = teamsToCsv([
      { ...opponent!, classification: "fcs" },
      first!,
      second!,
    ]);
    const base = parseGames(input.gamesCsv)[0]!;
    const game = (id: number, homeId: number, awayId: number) => ({
      ...base,
      id,
      week: 1,
      homeId,
      awayId,
      homePoints: 14,
      awayPoints: 0,
      neutralSite: true,
      completed: true,
    });
    const gamesCsv = gamesToCsv([
      game(1, opponent!.id, first!.id),
      game(2, opponent!.id, second!.id),
      game(3, second!.id, first!.id),
    ]);
    const cfg = JSON.parse(input.configJson);
    const compute = async (
      classifications: string[],
      opponentClassifications?: string[],
    ) =>
      JSON.parse(
        (
          await computeSeason({
            ...input,
            teamsCsv,
            gamesCsv,
            configJson: JSON.stringify({
              ...cfg,
              classifications,
              opponentClassifications,
            }),
          })
        ).files[0]!.json,
      );
    const full = await compute(["fbs", "fcs"]);
    const fbs = await compute(["fbs"], ["fbs", "fcs"]);
    expect(fbs.teams.map((t: { id: number }) => t.id)).toEqual([
      second!.id,
      first!.id,
    ]);
    expect(
      fbs.teams.map((t: { rank: number; tied: boolean }) => [t.rank, t.tied]),
    ).toEqual([
      [1, false],
      [2, false],
    ]);
    expect(fbs.teams[0]).toMatchObject({ wins: 1, losses: 1 });
    expect(fbs.teams[1]).toMatchObject({ wins: 0, losses: 2 });
    expect(fbs.teams[0].height).toBeGreaterThan(fbs.teams[1].height);
    expect(fbs.opponents[0]).toMatchObject({
      id: opponent!.id,
      rank: null,
      tied: false,
    });
    expect(fbs.opponents[0].height).toBeGreaterThan(fbs.teams[0].height);
    expect(fbs.manifest).toMatchObject({
      classifications: ["fbs"],
      opponentClassifications: ["fbs", "fcs"],
      counts: { included: 3 },
    });
    expect(fbs.springs).toEqual(full.springs);
    for (const t of fbs.teams) {
      const previous = full.teams.find((p: { id: number }) => p.id === t.id);
      expect([t.height, t.wins, t.losses]).toEqual([
        previous.height,
        previous.wins,
        previous.losses,
      ]);
    }
  });
});

describe("snapshots", () => {
  const teams = parseTeams(input.teamsCsv);
  const games = parseGames(input.gamesCsv);

  it("week N only counts games through week N", () => {
    const specs = listSnapshots(games);
    const early = buildEdges(games, teams, specs[2]!);
    expect(early.edges.every((e) => e.week <= 3)).toBe(true);
    expect(buildEdges(games, teams, specs.at(-1)!).counts.included).toBe(
      games.length,
    );
  });

  it("drops out-of-scope, incomplete and tied games and counts them", () => {
    const base = games[0]!;
    const extra = [
      { ...base, id: 1, homeId: 1 }, // unknown team
      { ...base, id: 2, completed: false },
      { ...base, id: 3, homePoints: 7, awayPoints: 7 },
    ];
    const { counts, edges } = buildEdges(extra, teams, {
      id: "week-01",
      label: "Week 1",
      throughWeek: 99,
      includePostseason: true,
    });
    expect(counts).toMatchObject({
      inWindow: 3,
      included: 0,
      outOfScope: 1,
      incomplete: 1,
      tied: 1,
    });
    expect(edges).toHaveLength(0);
  });
});
