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
import { computeSeason } from "../src/engine/season";
import { DEFAULT_SETTINGS } from "../src/engine/defaults";

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

  it("publishes earned standing points while keeping the prediction model private", async () => {
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
    expect(away.height - home.height).toBeCloseTo(1.5, 5);
    expect(away).not.toHaveProperty("resume");
    expect(away.projection.expectedRating).toBe(away.height);
    expect(away).not.toHaveProperty("recordBonus");
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
      engine: "rank-engine-12",
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
    await expect(bad({ winBonus: -1 })).rejects.toThrow(/winBonus/);
    await expect(bad({ shrink: 0 })).rejects.toThrow(/shrink/);
    await expect(bad({ probabilityScale: 0 })).rejects.toThrow(
      /probabilityScale/,
    );
    await expect(bad({ homeFieldShrink: 0 })).rejects.toThrow(
      /homeFieldShrink/,
    );
    await expect(bad({ residualScale: null })).rejects.toThrow(/residualScale/);
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
