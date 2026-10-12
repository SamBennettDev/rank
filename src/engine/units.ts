import { choleskySolve } from "./linalg";
import type { Edge, TeamGamePlays } from "./types";

/** Unit ratings in points per game better than an average team; null for teams with no play-by-play. */
export interface UnitRatings {
  offense: (number | null)[];
  defense: (number | null)[];
  special: (number | null)[];
  /** Average scrimmage snaps per team per game in the data (converts EPA per snap to points per game). */
  snapsPerGame: number;
}

/** Starting points for the three units, per team: offense and defense in EPA per snap, special teams in points per game. */
export interface UnitStart {
  offense: Float64Array;
  defense: Float64Array;
  special: Float64Array;
}

/** Used when there is no play-by-play yet to measure snaps per game. */
export const DEFAULT_SNAPS = 65;

/**
 * Opponent- and site-adjusted offense, defense and special teams from play-by-play.
 *
 * Offense and defense: each team-game row says the team's offense gained `epa / snaps`
 * per snap against that opponent's defense. With site x = +1 at home, -1 away, 0 neutral:
 *
 *   epa / snaps  ≈  mu + O[team] - D[opponent] + h * x            (weighted by snaps)
 *
 * Special teams: each game's net special-teams EPA for one side ≈ S[team] - S[opponent].
 * Each unit is pulled toward its starting point with `priorWeight` games' worth of
 * evidence (snaps for offense and defense). Both systems are symmetric positive
 * definite and solved exactly by Cholesky. Results are converted to points per game:
 * offense = O × snapsPerGame, defense = D × snapsPerGame, special = S.
 * `rows` and `edges` must already be in a canonical order; summation follows it.
 */
export function fitUnits(n: number, index: Map<number, number>, edges: readonly Edge[], rows: readonly TeamGamePlays[], start: UnitStart, priorWeight: number): UnitRatings {
  const site = new Map<number, { home: number; neutral: boolean }>();
  for (const e of edges) site.set(e.gameId, { home: e.winnerIsHome ? e.winner : e.loser, neutral: e.neutralSite });
  const used = rows.filter((r) => site.has(r.gameId) && index.has(r.teamId) && index.has(r.opponentId) && r.snaps > 0);
  const has = new Array<boolean>(n).fill(false);
  let snapTotal = 0;
  for (const r of used) {
    has[index.get(r.teamId)!] = true;
    snapTotal += r.snaps;
  }
  const snapsPerGame = used.length > 0 ? snapTotal / used.length : DEFAULT_SNAPS;

  // Offense and defense: unknowns [O (n), D (n), mu, h]
  const N = 2 * n + 2;
  const m = new Float64Array(N * N);
  const rhs = new Float64Array(N);
  const add = (i: number, j: number, v: number) => (m[i * N + j]! += v);
  for (const r of used) {
    const t = index.get(r.teamId)!, u = n + index.get(r.opponentId)!, mu = 2 * n, h = 2 * n + 1;
    const s = site.get(r.gameId)!;
    const x = s.neutral ? 0 : s.home === r.teamId ? 1 : -1;
    const w = r.snaps, y = r.epa / r.snaps;
    const cols = [t, u, mu, h], coef = [1, -1, 1, x];
    for (let a = 0; a < 4; a++) {
      if (coef[a] === 0) continue;
      rhs[cols[a]!]! += w * y * coef[a]!;
      for (let b = 0; b < 4; b++) if (coef[b] !== 0) add(cols[a]!, cols[b]!, w * coef[a]! * coef[b]!);
    }
  }
  const lam = priorWeight * snapsPerGame;
  for (let i = 0; i < n; i++) {
    add(i, i, lam);
    rhs[i]! += lam * start.offense[i]!;
    add(n + i, n + i, lam);
    rhs[n + i]! += lam * start.defense[i]!;
  }
  add(2 * n, 2 * n, 1e-6);
  add(2 * n + 1, 2 * n + 1, 1e-6);
  const od = choleskySolve(m, rhs, N);

  // Special teams: one observation per game, from the home side (neutral: lower team id)
  const ms = new Float64Array(n * n);
  const rs = new Float64Array(n);
  const seen = new Set<number>();
  const byTeamGame = new Map(used.map((r) => [`${r.gameId}:${r.teamId}`, r]));
  for (const r of used) {
    if (seen.has(r.gameId)) continue;
    const s = site.get(r.gameId)!;
    const mine = s.neutral ? Math.min(r.teamId, r.opponentId) : s.home;
    const row = byTeamGame.get(`${r.gameId}:${mine}`);
    if (!row) continue;
    seen.add(r.gameId);
    const t = index.get(row.teamId)!, u = index.get(row.opponentId)!;
    ms[t * n + t]! += 1;
    ms[u * n + u]! += 1;
    ms[t * n + u]! -= 1;
    ms[u * n + t]! -= 1;
    rs[t]! += row.specialEpa;
    rs[u]! -= row.specialEpa;
  }
  for (let i = 0; i < n; i++) {
    ms[i * n + i]! += priorWeight;
    rs[i]! += priorWeight * start.special[i]!;
  }
  const st = choleskySolve(ms, rs, n);

  return {
    offense: has.map((h, i) => (h ? od[i]! * snapsPerGame : null)),
    defense: has.map((h, i) => (h ? od[n + i]! * snapsPerGame : null)),
    special: has.map((h, i) => (h ? st[i]! : null)),
    snapsPerGame,
  };
}
