import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  type EpModel,
  expectedPoints,
  FIELD_KNOTS,
  fieldGoalChance,
  hats,
  isSuccess,
} from "../src/engine/ep";
import { fitUnit, groupOf, ratePlayers } from "../src/engine/players";
import type { PlayerGame, RosterPlayer } from "../src/engine/players-data";

const model = JSON.parse(
  readFileSync(new URL("../data/models/ep.json", import.meta.url), "utf8"),
) as EpModel;

describe("expected points", () => {
  it("interpolates between knots with weights that sum to 1", () => {
    for (const x of [0, 1, 3, 7.5, 20, 64, 99, 120]) {
      const w = hats(FIELD_KNOTS, x);
      expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
      expect(w.filter((v) => v > 0).length).toBeLessThanOrEqual(2);
    }
    expect(expectedPoints(model, 1, 10, 50)).toBeCloseTo(model.field[0]![5]!, 12);
  });

  it("is worth more closer to the goal and on earlier downs", () => {
    expect(expectedPoints(model, 1, 10, 25)).toBeGreaterThan(expectedPoints(model, 1, 10, 75));
    expect(expectedPoints(model, 1, 10, 50)).toBeGreaterThan(expectedPoints(model, 3, 10, 50));
    expect(expectedPoints(model, 1, 1, 1)).toBeGreaterThan(5);
  });

  it("makes long field goals less often", () => {
    expect(fieldGoalChance(model, 25)).toBeGreaterThan(fieldGoalChance(model, 50));
  });

  it("calls a play successful at 50/70/100% of the yards to go", () => {
    expect(isSuccess(1, 10, 5, false)).toBe(true);
    expect(isSuccess(1, 10, 4, false)).toBe(false);
    expect(isSuccess(2, 10, 7, false)).toBe(true);
    expect(isSuccess(3, 4, 3, false)).toBe(false);
    expect(isSuccess(3, 4, 0, true)).toBe(true);
  });
});

describe("team pass and rush units", () => {
  it("recovers offense and defense from per-play EPA", () => {
    const O = new Map([[1, 0.2], [2, 0], [3, -0.2]]);
    const D = new Map([[1, 0.1], [2, -0.1], [3, 0]]);
    const rows = [];
    for (const t of [1, 2, 3])
      for (const o of [1, 2, 3])
        if (t !== o)
          rows.push({ team: t, opponent: o, plays: 1000, epa: 1000 * (0.05 + O.get(t)! - D.get(o)!) });
    const fit = fitUnit(rows, 1e-6);
    for (const r of rows)
      expect(fit.mu + fit.offense.get(r.team)! - fit.defense.get(r.opponent)!).toBeCloseTo(r.epa / r.plays, 4);
    for (const [a, b] of [[1, 2], [2, 3]] as const)
      expect(fit.offense.get(a)! - fit.offense.get(b)!).toBeCloseTo(O.get(a)! - O.get(b)!, 4);
    expect(fit.defense.get(1)! - fit.defense.get(2)!).toBeCloseTo(0.2, 4);
  });
});

const game = (gameId: number, teamId: number, opponentId: number, playerId: number, over: Partial<PlayerGame>): PlayerGame => ({
  gameId, teamId, opponentId, playerId,
  dropbacks: 0, passEpa: 0, passSuccess: 0, attempts: 0, completions: 0, passYards: 0, passTd: 0,
  interceptions: 0, sacksTaken: 0, rushes: 0, rushEpa: 0, rushSuccess: 0, rushYards: 0, rushTd: 0,
  targets: 0, targetEpa: 0, targetSuccess: 0, receptions: 0, recYards: 0, recTd: 0,
  fga: 0, fgm: 0, fgValue: 0, tackles: 0, solo: 0, assists: 0, sacks: 0, pbu: 0, defInt: 0,
  ...over,
});
const person = (id: number, teamId: number, position: string): RosterPlayer => ({
  id, teamId, name: `P${id}`, jersey: "", position, year: "", height: "", weight: 0,
  hometown: "", highSchool: "", gamesPlayed: 0, gamesStarted: 0,
});

describe("player ratings", () => {
  it("credits the same production more against a better defense", () => {
    // Teams 10 and 20 each pass against 30 (strong defense) and 40 (weak defense).
    const games: PlayerGame[] = [];
    let id = 1;
    for (const [off, qb] of [[10, 1], [20, 2], [30, 3], [40, 4]] as const)
      for (const def of [10, 20, 30, 40])
        if (off !== def) {
          const allowed = def === 30 ? -0.2 : def === 40 ? 0.3 : 0;
          games.push(game(id++, off, def, qb, { dropbacks: 30, passEpa: 30 * allowed }));
        }
    // QB 5 (+0.1 against the strong defense) and QB 6 (+0.6 against the weak one).
    games.push(game(id++, 50, 30, 5, { dropbacks: 30, passEpa: 30 * 0.1 }));
    games.push(game(id++, 60, 40, 6, { dropbacks: 30, passEpa: 30 * 0.6 }));
    const roster = [1, 2, 3, 4, 5, 6].map((p) => person(p, p * 10, "QB"));
    const { ratings } = ratePlayers(games, roster, new Set([10, 20, 30, 40, 50, 60]), new Map());
    const r = (p: number) => ratings.find((x) => x.player.id === p)!;
    // Raw, QB 6 is 15 EPA ahead; against what each defense allows, the gap narrows.
    expect(r(5).over - r(6).over).toBeGreaterThan(3 - 18 + 5);
    expect(r(5).expected).toBeLessThan(r(6).expected);
    expect(r(5).rating).toBeCloseTo(r(5).over / (30 + 100), 12);
  });

  it("rates a player in his listed position, or by what he did", () => {
    const t = game(1, 1, 2, 1, { dropbacks: 40 });
    expect(groupOf("CB", t)).toBe("DB");
    expect(groupOf("", t)).toBe("QB");
    expect(groupOf("OL", t)).toBeNull();
  });
});
