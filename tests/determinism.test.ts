import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "../src/engine/csv";
import { buildEdges, listSnapshots } from "../src/engine/graph";
import { gamesToCsv, parseGames, parseTeams } from "../src/engine/data";
import { computeSeason } from "../src/engine/season";

const dir = join(import.meta.dirname, "fixtures/demo");
const read = (f: string) => readFileSync(join(dir, f), "utf8");
const input = { season: "demo", teamsCsv: read("teams.csv"), gamesCsv: read("games.csv"), configJson: read("config.json") };

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
    const b = await computeSeason({ ...input, gamesCsv: shuffle(input.gamesCsv), teamsCsv: shuffle(input.teamsCsv) });
    // hashes of the input bytes differ by design; everything else must match
    const strip = (s: string) => s.replace(/"(teams|games)Sha256": "[0-9a-f]+",?\n\s*/g, "");
    expect(b.files.map((f) => strip(f.json))).toEqual(a.files.map((f) => strip(f.json)));
  });

  it("uses home and away wins' raw score differences throughout the pipeline", async () => {
    const base = parseGames(input.gamesCsv)[0]!;
    const gamesCsv = gamesToCsv([
      { ...base, id: 1, week: 1, homePoints: 3, awayPoints: 84 },
      { ...base, id: 2, week: 1, homePoints: 4, awayPoints: 3 },
    ]);
    const out = await computeSeason({
      ...input,
      gamesCsv,
      configJson: JSON.stringify({ ...JSON.parse(input.configJson), alpha: 2 }),
    });
    const teams = JSON.parse(out.files[0]!.json).teams;
    const home = teams.find((t: { id: number }) => t.id === base.homeId);
    const away = teams.find((t: { id: number }) => t.id === base.awayId);
    expect(away.rank).toBe(1);
    expect(home.rank).toBe(2);
    expect(away.height - home.height).toBeCloseTo((81 - 1) / (2 + 1), 5);
    expect([home.wins, home.losses, away.wins, away.losses]).toEqual([1, 1, 1, 1]);
  });

});

describe("config", () => {
  it("records the model settings in every manifest", async () => {
    const m = JSON.parse((await computeSeason(input)).files.at(-1)!.json).manifest;
    expect([m.engine, m.algorithmVersion, m.alpha]).toEqual(["rank-engine-2", "margin-springs-1", 0.01]);
    expect(m).not.toHaveProperty("restLength");
  });

  it("rejects invalid settings", async () => {
    const bad = (patch: object) => computeSeason({ ...input, configJson: JSON.stringify({ ...JSON.parse(input.configJson), ...patch }) });
    await expect(bad({ alpha: 0 })).rejects.toThrow(/alpha/);
    await expect(bad({ classifications: [] })).rejects.toThrow(/classifications/);
  });
});

describe("snapshots", () => {
  const teams = parseTeams(input.teamsCsv);
  const games = parseGames(input.gamesCsv);

  it("week N only counts games through week N", () => {
    const specs = listSnapshots(games);
    const early = buildEdges(games, teams, specs[2]!);
    expect(early.edges.every((e) => e.week <= 3)).toBe(true);
    expect(buildEdges(games, teams, specs.at(-1)!).counts.included).toBe(games.length);
  });

  it("drops out-of-scope, incomplete and tied games and counts them", () => {
    const base = games[0]!;
    const extra = [
      { ...base, id: 1, homeId: 1 }, // unknown team
      { ...base, id: 2, completed: false },
      { ...base, id: 3, homePoints: 7, awayPoints: 7 },
    ];
    const { counts, edges } = buildEdges(extra, teams, { id: "week-01", label: "Week 1", throughWeek: 99, includePostseason: true });
    expect(counts).toMatchObject({ inWindow: 3, included: 0, outOfScope: 1, incomplete: 1, tied: 1 });
    expect(edges).toHaveLength(0);
  });
});
