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

  it("accepts one game of a split series as an upset, the smaller win", async () => {
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
    const ranking = JSON.parse(out.files.find((f) => f.id === "margin/week-01")!.json);
    const teams = ranking.teams;
    const home = teams.find((t: { id: number }) => t.id === base.homeId);
    const away = teams.find((t: { id: number }) => t.id === base.awayId);
    expect(away.rank).toBe(1);
    expect(home.rank).toBe(2);
    // The teams split two games, so one must be an upset. The 81-point win pushes harder,
    // so its winner starts higher and the 1-point win is accepted as the upset.
    expect(ranking.upsets).toEqual([2]);
    expect(away.height).toBeGreaterThan(home.height);
    expect([home.wins, home.losses, away.wins, away.losses]).toEqual([1, 1, 1, 1]);
  });

});

describe("upsets", () => {
  it("publishes accepted upsets, and every other game's winner sits above its loser", async () => {
    const out = await computeSeason(input);
    const games = parseGames(input.gamesCsv);
    for (const f of out.files) {
      const r = JSON.parse(f.json);
      const height = new Map(r.teams.map((t: { id: number; height: number }) => [t.id, t.height]));
      const upsets = new Set(r.upsets);
      expect([...upsets]).toEqual([...upsets].sort((a: any, b: any) => a - b));
      const spec = out.index.snapshots.find((s) => `${r.manifest.method}/${s.id}` === f.id)!;
      const { edges } = buildEdges(games, parseTeams(input.teamsCsv), listSnapshots(games).find((s) => s.id === spec.id)!);
      for (const e of edges) if (!upsets.has(e.gameId)) expect(height.get(e.winner)).toBeGreaterThan(height.get(e.loser) as number);
    }
  });
});

describe("methods", () => {
  it("publishes win and margin rankings for every snapshot, win first", async () => {
    const out = await computeSeason(input);
    const ids = out.files.map((f) => f.id);
    const weeks = out.index.snapshots.map((s) => s.id);
    expect(ids).toEqual([...weeks.map((w) => `win/${w}`), ...weeks.map((w) => `margin/${w}`)]);
    expect(out.index.methods).toEqual(["win", "margin"]);
  });

  it("records each method's settings in its manifests", async () => {
    const out = await computeSeason(input);
    const win = JSON.parse(out.files.find((f) => f.id.startsWith("win/"))!.json).manifest;
    const margin = JSON.parse(out.files.find((f) => f.id.startsWith("margin/"))!.json).manifest;
    expect([win.engine, win.method, win.algorithmVersion, win.alpha, win.restLength]).toEqual(["rank-engine-4", "win", "win-springs-2", 0.01, 7]);
    expect([margin.method, margin.algorithmVersion]).toEqual(["margin", "margin-springs-2"]);
    expect(margin).not.toHaveProperty("restLength");
  });

  it("win springs ignore the score: only who won changes the ranking", async () => {
    const games = parseGames(input.gamesCsv);
    const blowouts = gamesToCsv(games.map((g) => (g.homePoints! > g.awayPoints! ? { ...g, homePoints: g.awayPoints! + 40 } : { ...g, awayPoints: g.homePoints! + 40 })));
    const a = await computeSeason(input);
    const b = await computeSeason({ ...input, gamesCsv: blowouts });
    const teamsOf = (out: typeof a) => out.files.filter((f) => f.id.startsWith("win/")).map((f) => JSON.parse(f.json).teams);
    expect(teamsOf(b)).toEqual(teamsOf(a));
  });

  it("publishes only the configured methods", async () => {
    const cfg = JSON.parse(input.configJson);
    const out = await computeSeason({ ...input, configJson: JSON.stringify({ ...cfg, methods: { win: cfg.methods.win } }) });
    expect(out.files.every((f) => f.id.startsWith("win/"))).toBe(true);
    expect(out.index.methods).toEqual(["win"]);
  });

  it("rejects invalid settings", async () => {
    const cfg = JSON.parse(input.configJson);
    const bad = (patch: object) => computeSeason({ ...input, configJson: JSON.stringify({ ...cfg, ...patch }) });
    await expect(bad({ alpha: 0 })).rejects.toThrow(/alpha/);
    await expect(bad({ softness: 0 })).rejects.toThrow(/softness/);
    await expect(bad({ classifications: [] })).rejects.toThrow(/classifications/);
    await expect(bad({ methods: {} })).rejects.toThrow(/methods/);
    await expect(bad({ methods: { points: { algorithmVersion: "x" } } })).rejects.toThrow(/unknown method/);
    await expect(bad({ methods: { win: { algorithmVersion: "x", restLength: 0 } } })).rejects.toThrow(/restLength/);
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
