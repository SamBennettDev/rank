import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "../src/engine/csv";
import { buildEdges, listSnapshots } from "../src/engine/graph";
import { parseGames, parseTeams } from "../src/engine/data";
import { computeSeason, edgeWeight } from "../src/engine/season";

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

});

describe("margin weighting", () => {
  const marginConfig = JSON.stringify({ ...JSON.parse(input.configJson), edgeWeight: "margin" });

  it("is deterministic and recorded in the manifest", async () => {
    const a = await computeSeason({ ...input, configJson: marginConfig });
    const b = await computeSeason({ ...input, configJson: marginConfig });
    expect(b).toEqual(a);
    expect(JSON.parse(a.files.at(-1)!.json).manifest.edgeWeight).toBe("margin");
  });

  it("changes heights relative to win/loss weighting", async () => {
    const win = JSON.parse((await computeSeason(input)).files.at(-1)!.json);
    const margin = JSON.parse((await computeSeason({ ...input, configJson: marginConfig })).files.at(-1)!.json);
    expect(win.manifest.edgeWeight).toBe("win");
    expect(margin.teams.map((t: { height: number }) => t.height)).not.toEqual(win.teams.map((t: { height: number }) => t.height));
  });

  it("rejects an unknown weighting", async () => {
    await expect(computeSeason({ ...input, configJson: JSON.stringify({ ...JSON.parse(input.configJson), edgeWeight: "points" }) })).rejects.toThrow(/edgeWeight/);
  });
});

describe("margin clamp", () => {
  it("clamps each win's stiffness to [minMargin, maxMargin]", () => {
    const g = (w: number, l: number) => ({ winnerPoints: w, loserPoints: l });
    const bounds = { minMargin: 7, maxMargin: 24 };
    expect(edgeWeight(g(24, 21), "margin", bounds)).toBe(7);
    expect(edgeWeight(g(31, 14), "margin", bounds)).toBe(17);
    expect(edgeWeight(g(59, 3), "margin", bounds)).toBe(24);
    expect(edgeWeight(g(59, 3), "margin")).toBe(56);
    expect(edgeWeight(g(59, 3), "win", bounds)).toBe(1);
  });

  it("records the clamp in the manifest and validates it", async () => {
    const clamped = JSON.stringify({ ...JSON.parse(input.configJson), edgeWeight: "margin", minMargin: 7, maxMargin: 24 });
    const m = JSON.parse((await computeSeason({ ...input, configJson: clamped })).files.at(-1)!.json).manifest;
    expect([m.minMargin, m.maxMargin]).toEqual([7, 24]);
    const bad = JSON.stringify({ ...JSON.parse(input.configJson), edgeWeight: "margin", minMargin: 30, maxMargin: 24 });
    await expect(computeSeason({ ...input, configJson: bad })).rejects.toThrow(/minMargin/);
  });
});

describe("gridiron method", () => {
  const gridiron = JSON.stringify({
    ...JSON.parse(input.configJson),
    method: "gridiron",
    gridiron: { winBonus: 7, blowoutLimit: 21, fitHomeField: true, maxIterations: 100 },
  });

  it("is deterministic, row-order independent and records what it found", async () => {
    const a = await computeSeason({ ...input, configJson: gridiron });
    const b = await computeSeason({ ...input, configJson: gridiron });
    expect(b).toEqual(a);
    const m = JSON.parse(a.files.at(-1)!.json).manifest;
    expect(m.method).toBe("gridiron");
    expect(typeof m.gridiron.homeFieldPoints).toBe("number");
    expect(m.gridiron.iterations).toBeLessThan(100);
    const reversed = (csv: string) => { const [h, ...rows] = parseCsv(csv); return toCsv(h!, rows.reverse()); };
    const c = await computeSeason({ ...input, configJson: gridiron, gamesCsv: reversed(input.gamesCsv) });
    const strip = (s: string) => s.replace(/"gamesSha256": "[0-9a-f]+",?\n\s*/g, "");
    expect(c.files.map((f) => strip(f.json))).toEqual(a.files.map((f) => strip(f.json)));
  });

  it("rejects incomplete gridiron settings", async () => {
    await expect(computeSeason({ ...input, configJson: JSON.stringify({ ...JSON.parse(input.configJson), method: "gridiron" }) })).rejects.toThrow(/gridiron/);
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
