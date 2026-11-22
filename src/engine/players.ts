/**
 * Player ratings on one scale for FBS and FCS: every play is judged against what an
 * average offense gains against that opponent's defense.
 *
 * 1. Defenses. From every team-game's passing and rushing (players.csv), fit
 *      EPA per pass  ≈  μ_pass + passO[offense] − passD[defense]
 *      EPA per rush  ≈  μ_rush + rushO[offense] − rushD[defense]
 *    weighted by plays, each rating pulled toward 0 with `unitPlays` plays' worth of
 *    evidence (one symmetric positive-definite system per play type, solved by Cholesky).
 *    An average offense expects μ − D[defense] per play against that defense.
 * 2. Ball carriers, passers and receivers. A player's EPA over expected is, game by game,
 *    his EPA minus his plays × (μ − D[opponent]) for each play type. His rating is that
 *    total divided by (plays + `shrink` for his position): small samples are pulled
 *    toward average (0). Value per game = rating × plays ÷ games.
 * 3. Kickers: field-goal points over the model's make chance, per try (+ shrink).
 * 4. Defenders: each game's credits (sacks, interceptions and pass breakups credited in the
 *    play-by-play, at the EPA they save in our model) × an opponent factor
 *    0.5 + opponent quality / 100, divided by (games + shrink). Tackles are left out: box
 *    scores exist only for games with an FBS team, so they would not treat FCS players alike.
 * Boards rank FBS and FCS players together by value per game.
 */
import { choleskySolve } from "./linalg";
import type { PlayerGame, RosterPlayer } from "./players-data";

export type Group = "QB" | "RB" | "WR" | "TE" | "K" | "DL" | "LB" | "DB";
export const GROUPS: Group[] = ["QB", "RB", "WR", "TE", "K", "DL", "LB", "DB"];

export interface PlayerSettings {
  /** Plays of evidence pulling each team pass/rush rating toward 0. */
  unitPlays: number;
  /** Plays (tries for kickers, games for defenders) of average performance added to each player. */
  shrink: Record<Group, number>;
  /** EPA a defender's play saves: sack, interception, pass breakup. */
  credit: { sack: number; interception: number; breakup: number };
}

export const DEFAULT_PLAYER_SETTINGS: PlayerSettings = {
  unitPlays: 200,
  shrink: { QB: 100, RB: 60, WR: 40, TE: 40, K: 8, DL: 2, LB: 2, DB: 2 },
  credit: { sack: 1.83, interception: 3.96, breakup: 1.12 },
};

const POSITION_GROUP: Record<string, Group> = {
  QB: "QB",
  RB: "RB", FB: "RB", HB: "RB", TB: "RB",
  WR: "WR", SB: "WR",
  TE: "TE",
  K: "K", PK: "K",
  DL: "DL", DE: "DL", DT: "DL", NT: "DL", EDGE: "DL", NG: "DL",
  LB: "LB", ILB: "LB", OLB: "LB", MLB: "LB",
  DB: "DB", CB: "DB", S: "DB", FS: "DB", SS: "DB", NB: "DB",
};

export interface UnitFit {
  mu: number;
  offense: Map<number, number>;
  defense: Map<number, number>;
}

/** Pass or rush ratings: per-play EPA ≈ μ + O[team] − D[opponent], weighted by plays. */
export function fitUnit(
  rows: readonly { team: number; opponent: number; plays: number; epa: number }[],
  shrink: number,
): UnitFit {
  const ids = [...new Set(rows.flatMap((r) => [r.team, r.opponent]))].sort((a, b) => a - b);
  const ix = new Map(ids.map((id, i) => [id, i]));
  const n = ids.length,
    size = 2 * n + 1;
  const A = new Float64Array(size * size),
    b = new Float64Array(size);
  const add = (i: number, j: number, v: number) => (A[i * size + j]! += v);
  for (const r of rows) {
    if (r.plays <= 0) continue;
    const o = ix.get(r.team)!,
      d = n + ix.get(r.opponent)!,
      mu = 2 * n;
    const w = r.plays,
      y = r.epa / r.plays;
    // unknowns x: O (+1), D (−1), μ (+1)
    const terms: [number, number][] = [
      [o, 1],
      [d, -1],
      [mu, 1],
    ];
    for (const [i, si] of terms) {
      b[i]! += w * si * y;
      for (const [j, sj] of terms) add(i, j, w * si * sj);
    }
  }
  for (let i = 0; i < 2 * n; i++) add(i, i, shrink);
  add(2 * n, 2 * n, 1e-6);
  const x = choleskySolve(A, b, size);
  return {
    mu: x[2 * n]!,
    offense: new Map(ids.map((id, i) => [id, x[i]!])),
    defense: new Map(ids.map((id, i) => [id, x[n + i]!])),
  };
}

export interface GameLine {
  gameId: number;
  opponentId: number;
  plays: number;
  epa: number;
  /** What an average player would have added on those plays against that defense. */
  expected: number;
  /** Defender credits before and after the opponent factor. */
  credits: number;
  factor: number;
  g: PlayerGame;
}

export interface PlayerRating {
  player: RosterPlayer;
  group: Group | null;
  games: number;
  plays: number;
  epa: number;
  expected: number;
  /** EPA over expected (or adjusted credits / kicking points) before shrinking. */
  over: number;
  shrinkWith: number;
  /** Per play (try, game for defenders) after shrinking. */
  rating: number;
  valuePerGame: number;
  rank: number | null;
  lines: GameLine[];
  totals: PlayerGame;
}

/** The position group a player is rated in: his listed position, else what he did most. */
export function groupOf(position: string, t: PlayerGame): Group | null {
  const g = POSITION_GROUP[position.toUpperCase()];
  if (g) return g;
  if (position.toUpperCase() === "OL" || position === "LS" || position === "P") return null;
  if (t.dropbacks >= 20) return "QB";
  if (t.fga > 0) return "K";
  if (t.rushes + t.targets > 0) return t.rushes > t.targets ? "RB" : "WR";
  if (t.sacks + t.hurries > t.pbu + t.defInt) return "DL";
  if (t.pbu + t.defInt > 0) return "DB";
  if (t.tackles > 0) return "LB";
  return null;
}

const sumGames = (gs: readonly PlayerGame[]): PlayerGame => {
  const t = { ...gs[0]! };
  for (const k of Object.keys(t) as (keyof PlayerGame)[])
    if (k !== "gameId" && k !== "teamId" && k !== "opponentId" && k !== "playerId")
      t[k] = gs.reduce((s, g) => s + g[k], 0);
  return t;
};

export function ratePlayers(
  games: readonly PlayerGame[],
  roster: readonly RosterPlayer[],
  eligibleTeams: ReadonlySet<number>,
  quality: ReadonlyMap<number, number>,
  s: PlayerSettings = DEFAULT_PLAYER_SETTINGS,
) {
  // 1. Team pass and rush units from every team-game.
  const passRows = new Map<string, { team: number; opponent: number; plays: number; epa: number }>();
  const rushRows = new Map<string, { team: number; opponent: number; plays: number; epa: number }>();
  for (const g of games) {
    const k = `${g.gameId}:${g.teamId}`;
    const p = passRows.get(k) ?? { team: g.teamId, opponent: g.opponentId, plays: 0, epa: 0 };
    p.plays += g.dropbacks;
    p.epa += g.passEpa;
    passRows.set(k, p);
    const r = rushRows.get(k) ?? { team: g.teamId, opponent: g.opponentId, plays: 0, epa: 0 };
    r.plays += g.rushes;
    r.epa += g.rushEpa;
    rushRows.set(k, r);
  }
  const order = (m: Map<string, { team: number; opponent: number; plays: number; epa: number }>) =>
    [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map((e) => e[1]);
  const pass = fitUnit(order(passRows), s.unitPlays);
  const rush = fitUnit(order(rushRows), s.unitPlays);
  const expPass = (opp: number) => pass.mu - (pass.defense.get(opp) ?? 0);
  const expRush = (opp: number) => rush.mu - (rush.defense.get(opp) ?? 0);

  // 2–4. Players.
  const byPlayer = new Map<number, PlayerGame[]>();
  for (const g of games) (byPlayer.get(g.playerId) ?? byPlayer.set(g.playerId, []).get(g.playerId)!).push(g);
  const people = new Map(roster.map((p) => [p.id, p]));
  const ratings: PlayerRating[] = [];
  for (const [id, gs] of [...byPlayer.entries()].sort((a, b) => a[0] - b[0])) {
    const player = people.get(id);
    if (!player || !eligibleTeams.has(player.teamId)) continue;
    gs.sort((a, b) => a.gameId - b.gameId);
    const totals = sumGames(gs);
    const group = groupOf(player.position, totals);
    if (!group) continue;
    const lines: GameLine[] = gs.map((g) => {
      const line: GameLine = { gameId: g.gameId, opponentId: g.opponentId, plays: 0, epa: 0, expected: 0, credits: 0, factor: 1, g };
      if (group === "K") {
        line.plays = g.fga;
        line.epa = g.fgValue;
      } else if (group === "DL" || group === "LB" || group === "DB") {
        const c = s.credit;
        line.credits =
          c.sack * g.sacks + c.interception * g.defInt + c.breakup * g.pbu;
        line.factor = 0.5 + (quality.get(g.opponentId) ?? 0) / 100;
        line.plays = 1;
        line.epa = line.credits * line.factor;
      } else {
        const passPlays = group === "QB" ? g.dropbacks : g.targets;
        const passEpa = group === "QB" ? g.passEpa : g.targetEpa;
        line.plays = passPlays + g.rushes;
        line.epa = passEpa + g.rushEpa;
        line.expected = passPlays * expPass(g.opponentId) + g.rushes * expRush(g.opponentId);
      }
      return line;
    });
    const plays = lines.reduce((a, l) => a + l.plays, 0);
    if (plays === 0) continue;
    const epa = lines.reduce((a, l) => a + l.epa, 0);
    const expected = lines.reduce((a, l) => a + l.expected, 0);
    const over = epa - expected;
    const shrinkWith = s.shrink[group];
    const rating = over / (plays + shrinkWith);
    const valuePerGame = (rating * plays) / gs.length;
    ratings.push({ player, group, games: gs.length, plays, epa, expected, over, shrinkWith, rating, valuePerGame, rank: null, lines, totals });
  }
  for (const group of GROUPS) {
    const list = ratings
      .filter((r) => r.group === group)
      .sort((a, b) => b.valuePerGame - a.valuePerGame || a.player.id - b.player.id);
    list.forEach((r, i) => (r.rank = i + 1));
  }
  return { pass, rush, ratings };
}
