import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import {
  consensusOrder,
  neuralPredictor,
  validateNeuralBundle,
} from "../src/engine/neural";
import { computeSeason } from "../src/engine/season";
import { parseGames } from "../src/engine/data";
import { sha256Hex } from "../src/engine/hash";

const directory = "data/seasons/2026/";
const read = (name: string) => readFileSync(directory + name, "utf8");
const raw = read("neural.json"),
  bundle = validateNeuralBundle(JSON.parse(raw));
const parity = JSON.parse(read("neural-parity.json")) as {
  bundleSha256: string;
  snapshots: {
    id: string;
    neutralScores: number[];
    matchups: {
      home: number;
      away: number;
      venue: number;
      probability: number;
    }[];
  }[];
};
const outputs = new Map<string, ReturnType<typeof neuralPredictor>>();
beforeAll(() => {
  for (const snapshot of bundle.snapshots)
    outputs.set(snapshot.id, neuralPredictor(bundle, snapshot));
}, 60000);

describe("saved season-only neural inference", () => {
  it("binds every snapshot to completed games before its cutoff", () => {
    const games = new Map(parseGames(read("games.csv")).map((g) => [g.id, g]));
    for (const snapshot of bundle.snapshots)
      for (const id of snapshot.gameIds) {
        const game = games.get(id)!;
        expect(game.completed).toBe(true);
        expect(Date.parse(game.startDate) + 6 * 3600000).toBeLessThanOrEqual(
          Date.parse(snapshot.asOf),
        );
      }
    const original = JSON.parse(
      readFileSync(
        "research/season_only/robust/polished-results/annual-models/2026.json",
        "utf8",
      ),
    );
    expect(bundle.groups[0]!.components[0]!.networks).toEqual(
      original.models.map((m: object) => ({kind: "rank", ...m})),
    );
  });

  it("matches independent Python inference on every team and snapshot", async () => {
    expect(await sha256Hex(raw)).toBe(parity.bundleSha256);
    for (const expected of parity.snapshots) {
      const p = outputs.get(expected.id)!;
      for (let i = 0; i < expected.neutralScores.length; i++)
        expect(p.scores[i]).toBeCloseTo(expected.neutralScores[i]!, 10);
      for (const game of expected.matchups)
        expect(p.probability(game.home, game.away, game.venue)).toBeCloseTo(
          game.probability,
          10,
        );
    }
  });
  it("uses historical weights and contains only numeric team features", () => {
    expect(Math.max(...bundle.trainingYears)).toBeLessThan(bundle.year);
    for (const s of bundle.snapshots)
      for (const row of s.features)
        expect(row.every(Number.isFinite)).toBe(true);
    expect(bundle.groups.map((g) => [g.name, g.weight])).toEqual([
      ["robust", 1],
    ]);
  });
  it("has complementary neutral and venue-reversed matchup probabilities", () => {
    const predictor = outputs.get("week-06")!;
    expect(predictor.probability(10, 10, 0)).toBeCloseTo(0.5, 12);
    for (const venue of [-1, 0, 1])
      expect(
        predictor.probability(10, 20, venue) +
          predictor.probability(20, 10, -venue),
      ).toBeCloseTo(1, 12);
  });
  it("gives equal neutral probabilities to teams with equal numeric inputs", () => {
    const snap = structuredClone(bundle.snapshots[0]!);
    snap.features[1] = snap.features[0]!.slice();
    for (const key of ["gamesPlayed","losses","externalLosses","recordGamesPlayed"] as const) snap[key]![1] = snap[key]![0]!;
    const p = neuralPredictor(bundle, snap, false);
    expect(p.probability(0, 1, 0)).toBeCloseTo(0.5, 12);
    expect(p.probability(0, 10, 0)).toBeCloseTo(p.probability(1, 10, 0), 12);
  });
  it("cannot use renamed team identifiers as neural inputs", () => {
    const snap = bundle.snapshots[5]!;
    const renamed = neuralPredictor(
      { ...bundle, teamIds: bundle.teamIds.map((_, i) => 9999 - i) },
      snap,
      false,
    );
    expect(renamed.probability(0, 20, 0)).toBe(
      outputs.get(snap.id)!.probability(0, 20, 0),
    );
  });
  it("deducts a loss monotonically after the frozen network performance estimate", () => {
    const snap = structuredClone(bundle.snapshots[5]!);
    const i = bundle.teamIds.indexOf(154), j = bundle.teamIds.indexOf(2483);
    const before = neuralPredictor(bundle,snap,false);
    const original = [-1,0,1].map(v => before.probability(i,j,v));
    snap.losses![i]! += 1;
    const after = neuralPredictor(bundle,snap,false);
    const expected = bundle.groups[0]!.components[0]!.temperature * bundle.policy!.lossPenalty/(snap.gamesPlayed![i]!+bundle.policy!.lossPrior);
    for (let k=0;k<3;k++) {
      const p=original[k]!,q=after.probability(i,j,k-1);
      expect(q).toBeLessThan(p);
      expect(Math.log(p/(1-p))-Math.log(q/(1-q))).toBeCloseTo(expected,10);
    }
  });
  it("counts losses to opponents outside the modeled field", () => {
    const snap=structuredClone(bundle.snapshots[0]!);
    const i=snap.gamesPlayed!.findIndex(n => n===0);
    const j=snap.gamesPlayed!.findIndex((n,k) => n===0 && k!==i);
    for(const t of [i,j]) {snap.features[t]!.fill(0);snap.losses![t]=0;snap.externalLosses![t]=0;snap.recordGamesPlayed![t]=0;}
    snap.externalLosses![i]=1;snap.recordGamesPlayed![i]=1;
    const p=neuralPredictor(bundle,snap,false).probability(i,j,0);
    expect(Math.log(p/(1-p))).toBeCloseTo(-bundle.groups[0]!.components[0]!.temperature * bundle.policy!.lossPenalty/bundle.policy!.lossPrior,10);
  });
  it("has a consistent neutral ordering with no favorite cycles", () => {
    const p=outputs.get("week-06")!;
    const order=consensusOrder(p.matrix,bundle.teamIds,bundle.teamIds.map((_,i)=>i));
    expect(order.moves).toBe(0);
    expect(order.disagreements).toBe(0);
    for (const r of p.rankRanges) expect(r.low).toBeLessThanOrEqual(r.high);
  });
  it("rejects malformed dimensions, nonfinite features, and future training years", () => {
    expect(() =>
      validateNeuralBundle({ ...bundle, trainingYears: [2026] }),
    ).toThrow();
    expect(() =>
      validateNeuralBundle({
        ...bundle,
        snapshots: [{ ...bundle.snapshots[0], features: [[NaN]] }],
      }),
    ).toThrow();
    const broken = JSON.parse(raw);
    broken.groups[0].components[0].networks[0].theta.pop();
    expect(() =>
      neuralPredictor(validateNeuralBundle(broken), broken.snapshots[0], false),
    ).toThrow(/weights/);
  });
  it("rejects stale raw-data hashes and mismatched snapshot cutoffs", async () => {
    const input = {
      season: "2026",
      teamsCsv: read("teams.csv"),
      gamesCsv: read("games.csv"),
      playsCsv: read("plays.csv"),
      richCsv: read("rich.csv"),
      configJson: read("config.json"),
      neuralJson: raw,
    };
    await expect(
      computeSeason({ ...input, gamesCsv: input.gamesCsv + "\n" }),
    ).rejects.toThrow(/stale/);
    const changed = JSON.parse(raw);
    changed.snapshots[0].asOf = "2026-10-12T12:00:00.000Z";
    await expect(
      computeSeason({ ...input, neuralJson: JSON.stringify(changed) }),
    ).rejects.toThrow(/cutoff/);
    const wrongRecord=JSON.parse(raw);
    const ix=wrongRecord.snapshots[0].gamesPlayed.findIndex((n:number)=>n>0);
    wrongRecord.snapshots[0].losses[ix]=1-wrongRecord.snapshots[0].losses[ix];
    await expect(computeSeason({...input,neuralJson:JSON.stringify(wrongRecord)})).rejects.toThrow(/cutoff/);
  }, 20000);
  it("publishes consensus ranks and neural probabilities from the same model", () => {
    const ranking = JSON.parse(
      readFileSync("data/rankings/2026/week-06.json", "utf8"),
    );
    const p = outputs.get("week-06")!;
    const order = consensusOrder(
      p.matrix,
      bundle.teamIds,
      bundle.teamIds.map((_, i) => i),
    );
    expect(ranking.manifest.standingMethod).toBe("season-only-neural-v2");
    expect(ranking.manifest.neural.objective).toBe(order.objective);
    expect(ranking.projection.target).toBe("frozen-earned-points");
    for (const t of ranking.teams) {
      const i = bundle.teamIds.indexOf(t.id);
      expect(t.rank).toBe(order.ranks[i]);
      expect(t.neural.roundRobinWinProbability).toBeCloseTo(p.scores[i]!, 6);
    }
    for (const game of ranking.predictions.slice(0, 40)) {
      expect(game.homeProbability).toBeCloseTo(
        p.probability(
          bundle.teamIds.indexOf(game.home),
          bundle.teamIds.indexOf(game.away),
          game.neutralSite ? 0 : 1,
        ),
        6,
      );
      expect(game.strengthEdge).toBeNull();
    }
  });
});

describe("pairwise consensus ordering", () => {
  it("recovers a consistent head-to-head ordering", () => {
    const matrix = Array.from({ length: 4 }, (_, i) =>
      Float64Array.from({ length: 4 }, (_, j) =>
        i === j ? 0.5 : i < j ? 0.8 : 0.2,
      ),
    );
    expect(consensusOrder(matrix, [4, 3, 2, 1], [0, 1, 2, 3]).order).toEqual([
      0, 1, 2, 3,
    ]);
  });
  it("improves round-robin order when weighted head-to-head evidence supports a move", () => {
    const matrix = [
      [0.5, 0.9, 0.45],
      [0.1, 0.5, 0.6],
      [0.55, 0.4, 0.5],
    ].map((r) => Float64Array.from(r));
    const result = consensusOrder(matrix, [1, 2, 3], [0, 1, 2]);
    expect(result.order).toEqual([0, 1, 2]);
    expect(result.objective).toBeGreaterThan(result.initialObjective);
  });
  it("handles cycles deterministically and preserves exact evidence ties", () => {
    const matrix = [
      [0.5, 0.9, 0.1],
      [0.1, 0.5, 0.9],
      [0.9, 0.1, 0.5],
    ].map((r) => Float64Array.from(r));
    const a = consensusOrder(matrix, [1, 2, 3], [0, 1, 2]);
    expect(consensusOrder(matrix, [1, 2, 3], [0, 1, 2])).toEqual(a);
    expect(a.disagreements).toBe(1);
    const tied = consensusOrder(
      [new Float64Array([0.5, 0.5]), new Float64Array([0.5, 0.5])],
      [5, 9],
      [0, 1],
    );
    expect(tied.ranks).toEqual([1, 1]);
  });
  it("has no remaining improving insertion in the published 266-team order", () => {
    const matrix = outputs.get("week-06")!.matrix;
    const result = consensusOrder(
      matrix,
      bundle.teamIds,
      bundle.teamIds.map((_, i) => i),
    );
    expect(result.objective).toBeGreaterThanOrEqual(result.initialObjective);
    for (let i = 0; i < result.order.length; i++) {
      let gain = 0;
      for (let j = i - 1; j >= 0; j--) {
        gain += 2 * matrix[result.order[i]!]![result.order[j]!]! - 1;
        expect(gain).toBeLessThan(1e-8);
      }
      gain = 0;
      for (let j = i + 1; j < result.order.length; j++) {
        gain += 1 - 2 * matrix[result.order[i]!]![result.order[j]!]!;
        expect(gain).toBeLessThan(1e-8);
      }
    }
  });
});
