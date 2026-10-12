import { describe, expect, it } from "vitest";
import type { Edge, TeamGamePlays } from "../src/engine/types";
import { fitUnits } from "../src/engine/units";

const edge = (gameId: number, home: number, away: number, neutral = false): Edge => ({ gameId, winner: home, loser: away, week: 1, seasonType: "regular", winnerPoints: 21, loserPoints: 14, neutralSite: neutral, winnerIsHome: true });

/** Round robin, home and away, where offense[t] - defense[u] sets EPA per snap exactly. */
function league(off: number[], def: number[], homeEdge = 0, special: number[] = off.map(() => 0)) {
  const n = off.length, edges: Edge[] = [], rows: TeamGamePlays[] = [];
  let id = 1;
  for (let h = 0; h < n; h++) for (let a = 0; a < n; a++) {
    if (h === a) continue;
    edges.push(edge(id, h + 1, a + 1));
    for (const [t, u, x] of [[h, a, 1], [a, h, -1]] as const) {
      rows.push({ gameId: id, teamId: t + 1, opponentId: u + 1, snaps: 60, epa: 60 * (off[t]! - def[u]! + homeEdge * x), success: 25, specialEpa: special[t]! - special[u]! });
    }
    id++;
  }
  return { n, edges, rows, index: new Map(off.map((_, i) => [i + 1, i])) };
}

describe("fitUnits", () => {
  it("separates offense from defense and reports them in points per game", () => {
    const off = [0.2, 0.1, 0, -0.1, -0.2], def = [-0.1, 0.2, 0, 0.1, -0.2];
    const L = league(off, def);
    const u = fitUnits(L.n, L.index, L.edges, L.rows, 0.01);
    expect(u.snapsPerGame).toBe(60);
    const o = u.offense.map((v) => v!), d = u.defense.map((v) => v!);
    // Each unit is recovered up to a shared shift, scaled by 60 snaps per game.
    for (let i = 1; i < L.n; i++) {
      expect(o[i]! - o[0]!).toBeCloseTo(60 * (off[i]! - off[0]!), 1);
      expect(d[i]! - d[0]!).toBeCloseTo(60 * (def[i]! - def[0]!), 1);
    }
  });

  it("does not credit home field to the offense", () => {
    const off = [0.1, 0, -0.1, 0], def = [0, 0, 0, 0];
    const flat = fitUnits(4, league(off, def).index, league(off, def).edges, league(off, def).rows, 0.01);
    const L = league(off, def, 0.05);
    const homey = fitUnits(4, L.index, L.edges, L.rows, 0.01);
    for (let i = 0; i < 4; i++) expect(homey.offense[i]!).toBeCloseTo(flat.offense[i]!, 3);
  });

  it("rates special teams from each game's net special-teams EPA", () => {
    const L = league([0, 0, 0], [0, 0, 0], 0, [2, 0, -2]);
    const s = fitUnits(3, L.index, L.edges, L.rows, 0.01).special.map((v) => v!);
    expect(s[0]! - s[2]!).toBeCloseTo(4, 1);
    expect(s[0]! + s[1]! + s[2]!).toBeCloseTo(0, 6);
  });

  it("leaves teams without play-by-play unrated", () => {
    const L = league([0.1, -0.1], [0, 0]);
    const index = new Map([...L.index, [99, 2]]);
    const u = fitUnits(3, index, L.edges, L.rows, 2);
    expect([u.offense[2], u.defense[2], u.special[2]]).toEqual([null, null, null]);
  });

  it("ignores rows for games that are not counted", () => {
    const L = league([0.1, -0.1], [0, 0]);
    const extra = { gameId: 999, teamId: 1, opponentId: 2, snaps: 60, epa: 600, success: 60, specialEpa: 50 };
    const a = fitUnits(2, L.index, L.edges, L.rows, 2);
    const b = fitUnits(2, L.index, L.edges, [...L.rows, extra], 2);
    expect(b).toEqual(a);
  });
});
