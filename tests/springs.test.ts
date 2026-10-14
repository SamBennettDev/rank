import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fitSprings, SPRING_TOLERANCE } from "../src/engine/springs";
import { computeSeason } from "../src/engine/season";
import { gamesToCsv, parseGames, parseTeams } from "../src/engine/data";
import { buildEdges } from "../src/engine/graph";
import type { Ranking } from "../src/engine/types";

const edges = (...pairs: [number, number][]) =>
  pairs.map(([winner, loser], i) => ({ gameId: i + 1, winner, loser }));
describe("raw one-sided spring equilibrium", () => {
  it("separates one winner and loser by one unit, centered on zero", () => {
    const r = fitSprings([1, 2, 3], edges([1, 2]));
    expect([...r.heights.values()]).toEqual([0.5, -0.5, null]);
    expect(r.energy).toBe(0);
    expect(r.components.get(3)).toBeNull();
  });
  it("separates a chain and leaves an already-separated shortcut slack", () => {
    const r = fitSprings([1, 2, 3], edges([1, 2], [2, 3], [1, 3]));
    expect(r.heights.get(1)).toBeCloseTo(1, 8);
    expect(r.heights.get(2)).toBeCloseTo(0, 8);
    expect(r.heights.get(3)).toBeCloseTo(-1, 8);
    expect(r.springs[2]!.compression).toBe(0);
    expect(r.energy).toBeLessThan(1e-16);
    expect(r.maxNetForce).toBeLessThanOrEqual(SPRING_TOLERANCE);
  });
  it("balances a symmetric cycle at a genuine tie", () => {
    const r = fitSprings([1, 2, 3], edges([1, 2], [2, 3], [3, 1]));
    expect([...r.heights.values()]).toEqual([0, 0, 0]);
    expect(r.energy).toBe(1.5);
    expect(r.maxNetForce).toBe(0);
  });
  it("counts repeated meetings individually in a conflicting cycle", () => {
    const r = fitSprings([1, 2], edges([1, 2], [1, 2], [2, 1]));
    expect(r.heights.get(1)).toBeCloseTo(1 / 6, 8);
    expect(r.heights.get(2)).toBeCloseTo(-1 / 6, 8);
    expect(r.energy).toBeCloseTo(4 / 3, 10);
    const forces = [0, 0];
    for (const e of r.springs) {
      forces[e.winner - 1]! += e.compression;
      forces[e.loser - 1]! -= e.compression;
    }
    expect(Math.max(...forces.map(Math.abs))).toBeLessThanOrEqual(
      SPRING_TOLERANCE,
    );
  });
  it("normalizes disconnected groups separately, without changing an existing group", () => {
    const a = fitSprings([1, 2], edges([1, 2]));
    const b = fitSprings([1, 2, 3, 4, 5], edges([1, 2], [3, 4], [3, 5]));
    expect(b.heights.get(1)).toBe(a.heights.get(1));
    expect(b.heights.get(2)).toBe(a.heights.get(2));
    expect(b.sizes.size).toBe(2);
    expect(
      b.heights.get(3)! + b.heights.get(4)! + b.heights.get(5)!,
    ).toBeCloseTo(0, 12);
  });
  it("is independent of input order, node names and identifiers", () => {
    const e = edges([1, 2], [2, 3], [3, 1], [1, 4]);
    const a = fitSprings([1, 2, 3, 4], e);
    expect(fitSprings([4, 2, 1, 3], [...e].reverse())).toEqual(a);
    const map = new Map([
      [1, 80],
      [2, 99],
      [3, 7],
      [4, 24],
    ]);
    const b = fitSprings(
      [...map.values()],
      e.map((g) => ({
        ...g,
        winner: map.get(g.winner)!,
        loser: map.get(g.loser)!,
      })),
    );
    for (const [i, id] of map)
      expect(b.heights.get(id)).toBeCloseTo(a.heights.get(i)!, 9);
  });
  it("rejects malformed edges instead of duplicating teams or games", () => {
    expect(() => fitSprings([1, 1], [])).toThrow(/duplicate/);
    expect(() => fitSprings([1, 2], edges([1, 1]))).toThrow(/endpoints/);
    expect(() => fitSprings([1], edges([1, 2]))).toThrow(/endpoints/);
    const e = edges([1, 2])[0]!;
    expect(() => fitSprings([1, 2], [e, e])).toThrow(/duplicate/);
  });
});

const read = (path: string) =>
  readFileSync(`data/seasons/2026/${path}`, "utf8");
const input = {
  season: "2026",
  teamsCsv: read("teams.csv"),
  gamesCsv: read("games.csv"),
  configJson: read("config.json"),
};
describe("spring season publication", () => {
  it("uses no neural export, play data, score margin, venue or division weights", async () => {
    const games = parseGames(input.gamesCsv).slice(0, 30);
    const base = { ...input, gamesCsv: gamesToCsv(games) };
    const a = await computeSeason(base);
    const b = await computeSeason({
      ...base,
      neuralJson: "invalid unused neural file",
      playsCsv: "invalid unused play file",
      gamesCsv: gamesToCsv(
        games.map((g) => ({
          ...g,
          neutralSite: !g.neutralSite,
          homePoints:
            g.homePoints === null
              ? null
              : g.homePoints > g.awayPoints!
                ? 100
                : 0,
          awayPoints:
            g.awayPoints === null
              ? null
              : g.awayPoints > g.homePoints!
                ? 100
                : 0,
        })),
      ),
    });
    for (let i = 0; i < a.files.length; i++) {
      const x = JSON.parse(a.files[i]!.json),
        y = JSON.parse(b.files[i]!.json);
      expect(y.teams).toEqual(x.teams);
      expect(y.springs).toEqual(x.springs);
      expect(x.predictions).toEqual([]);
      expect(x.credits).toEqual([]);
    }
  });
  it("preserves earlier graph heights when later results change", async () => {
    const games = parseGames(input.gamesCsv),
      selected = games.filter((g) => g.week <= 2);
    const a = await computeSeason({ ...input, gamesCsv: gamesToCsv(selected) });
    const b = await computeSeason({
      ...input,
      gamesCsv: gamesToCsv(
        selected.map((g) =>
          g.week === 2
            ? { ...g, homePoints: g.awayPoints, awayPoints: g.homePoints }
            : g,
        ),
      ),
    });
    const first = JSON.parse(a.files[0]!.json),
      changed = JSON.parse(b.files[0]!.json);
    expect(changed.teams).toEqual(first.teams);
    expect(changed.springs).toEqual(first.springs);
  });
  it("publishes every completed edge, reconciles records and ties, and has no duplicate nodes", () => {
    const r: Ranking = JSON.parse(
      readFileSync("data/rankings/2026/week-06.json", "utf8"),
    );
    const all = [...r.teams, ...r.opponents!],
      ids = new Set(all.map((t) => t.id));
    expect(ids.size).toBe(all.length);
    const { edges: e } = buildEdges(
      parseGames(input.gamesCsv),
      all,
      r.snapshot,
    );
    expect(r.springs!.map((s) => s.gameId)).toEqual(e.map((g) => g.gameId));
    expect(r.manifest.springs!.maxNetForce).toBeLessThanOrEqual(
      SPRING_TOLERANCE,
    );
    expect(r.manifest.neural).toBeUndefined();
    expect(r.predictions).toEqual([]);
    expect(r.springs).toHaveLength(r.manifest.counts.included);
    expect(r.teams).toHaveLength(parseTeams(input.teamsCsv).length);
    for (const t of all) {
      expect(t.wins).toBe(e.filter((g) => g.winner === t.id).length);
      expect(t.losses).toBe(e.filter((g) => g.loser === t.id).length);
      if (t.rank !== null)
        expect(t.rank).toBe(
          1 +
            r.teams.filter((o) => o.height !== null && o.height > t.height!)
              .length,
        );
    }
    const forces = new Map(all.map((t) => [t.id, 0]));
    for (const s of r.springs!) {
      const gap =
        all.find((t) => t.id === s.winner)!.height! -
        all.find((t) => t.id === s.loser)!.height!;
      expect(s.gap).toBeCloseTo(gap, 5);
      expect(s.compression).toBeCloseTo(Math.max(0, 1 - gap), 5);
      forces.set(s.winner, forces.get(s.winner)! + s.compression);
      forces.set(s.loser, forces.get(s.loser)! - s.compression);
    }
    expect(Math.max(...[...forces.values()].map(Math.abs))).toBeLessThan(1e-5);
  });
});
