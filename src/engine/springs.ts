import { choleskySolve } from "./linalg";
import { expFixed } from "./probability";
import type { SpringSettings } from "./types";

export type { SpringSettings };

/** One game: a spring from the loser up to the winner. */
export interface Spring {
  winner: number;
  loser: number;
  /** Winner's points minus loser's points (always > 0). */
  margin: number;
}

/** Points a 1-point win is worth: the scale of the springs' gaps. */
export const WIN_POINTS = 100;

/** The top of the 0–100 quality scale. */
export const QUALITY_POINTS = 100;

/**
 * How far above its loser a spring wants the winner, in points:
 * WIN_POINTS × margin^0.75, computed as √margin × √√margin so it uses only √.
 * A 1-point win is worth 100, 2 points 168.2, 3 points 228.0, 7 points 430.4,
 * 14 points 723.8, 28 points 1217.2: each extra point counts a little less.
 */
export function marginGap(margin: number) {
  if (!Number.isInteger(margin) || margin < 1)
    throw new Error("margin must be a positive whole number");
  const root = Math.sqrt(margin);
  return WIN_POINTS * root * Math.sqrt(root);
}

/** Chance a team at this strength beats an average (height 0) team. */
export const quality = (strength: number, scale: number) => {
  const e = expFixed(-Math.abs(strength) * scale);
  return strength >= 0 ? 1 / (1 + e) : e / (1 + e);
};

/** A team's quality points: QUALITY_POINTS × its chance of beating an average team (0–100). */
export const qualityPoints = (q: number) => QUALITY_POINTS * q;

/**
 * Résumé benchmarks within a team's division: the average strength of its 10, 25, 50 and 100
 * strongest teams, and its average team.
 */
export const RESUME_BENCHMARKS = [
  { label: "Top-10 team", top: 10 },
  { label: "Top-25 team", top: 25 },
  { label: "Top-50 team", top: 50 },
  { label: "Top-100 team", top: 100 },
  { label: "Average team", top: 0 },
] as const;

/** Benchmark strengths among the member teams (strongest first, summed in that order). */
export function benchmarkStrengths(strength: ArrayLike<number>, members: ArrayLike<boolean>): number[] {
  const order = Array.from(strength, (s, i) => ({ s, i }))
    .filter((x) => members[x.i])
    .sort((a, b) => b.s - a.s || a.i - b.i);
  return RESUME_BENCHMARKS.map(({ top }) => {
    if (order.length === 0) return 0;
    const k = top === 0 ? order.length : Math.min(top, order.length);
    let sum = 0;
    for (let j = 0; j < k; j++) sum += order[j]!.s;
    return sum / k;
  });
}

/**
 * How likely a team of strength `bench` would be to do worse than this record against this
 * schedule, half-counting an equal record: 100 × (P(fewer wins) + ½ P(as many)).
 * Each game's chance comes from the calibrated quality logistic; the benchmark's distribution
 * of wins is built game by game (Poisson-binomial), with only + − × /.
 */
export function strengthOfRecord(
  games: readonly { opponent: number; won: boolean }[],
  bench: number,
  strength: ArrayLike<number>,
  scale: number,
): { score: number; expectedWins: number; wins: number } {
  let dist = [1],
    expectedWins = 0,
    wins = 0;
  for (const g of games) {
    const p = quality(bench - strength[g.opponent]!, scale);
    expectedWins += p;
    if (g.won) wins++;
    const next = new Array<number>(dist.length + 1).fill(0);
    for (let k = 0; k < dist.length; k++) {
      next[k]! += dist[k]! * (1 - p);
      next[k + 1]! += dist[k]! * p;
    }
    dist = next;
  }
  let below = 0;
  for (let k = 0; k < wins; k++) below += dist[k]!;
  return { score: QUALITY_POINTS * (below + dist[wins]! / 2), expectedWins, wins };
}

/**
 * Heights that minimise
 *
 *   ½ Σ_games (h[winner] − h[loser] − gap)²  +  ½ shrink · Σ_teams h²
 *
 * One symmetric positive-definite system, solved by Cholesky with + − × / and sqrt
 * in a fixed order. Each team's height is the average of what its games say
 * (opponent + gap after a win, opponent − gap after a loss), with `shrink` games'
 * weight on 0.
 */
export function solveSprings(
  n: number,
  springs: readonly Spring[],
  gaps: readonly number[],
  shrink: number,
): Float64Array {
  if (!(shrink > 0)) throw new Error("spring shrink must be > 0");
  const matrix = new Float64Array(n * n),
    rhs = new Float64Array(n);
  springs.forEach(({ winner: w, loser: l }, e) => {
    matrix[w * n + w]! += 1;
    matrix[l * n + l]! += 1;
    matrix[w * n + l]! -= 1;
    matrix[l * n + w]! -= 1;
    const g = gaps[e]!;
    if (!Number.isFinite(g)) throw new Error("spring gap must be finite");
    rhs[w]! += g;
    rhs[l]! -= g;
  });
  for (let i = 0; i < n; i++) matrix[i * n + i]! += shrink;
  return choleskySolve(matrix, rhs, n);
}

/**
 * Margin SpringRank: every game wants its winner `marginGap(margin)` points above its
 * loser, every spring equally strong, so one solve gives every team's strength.
 */
export function solveStrength(
  n: number,
  springs: readonly Spring[],
  settings: SpringSettings,
) {
  const gaps = springs.map((s) => marginGap(s.margin));
  return solveSprings(n, springs, gaps, settings.strengthShrink);
}

/**
 * The ranking and its two companions. Quality (0–100 points) comes from one margin
 * SpringRank. Résumé is strength of record averaged over the benchmarks of the team's own
 * division (`group[i]`, 0, 1, …; −1 or omitted: benchmarks from every team that played), see
 * `strengthOfRecord`; schedule is the average quality of the opponents it played.
 */
export function rankByQuality(
  n: number,
  springs: readonly Spring[],
  settings: SpringSettings,
  group?: ArrayLike<number>,
) {
  const strength = solveStrength(n, springs, settings);
  const q = Array.from(strength, (s) =>
    qualityPoints(quality(s, settings.qualityScale)),
  );
  const faced = new Float64Array(n),
    games = new Float64Array(n);
  const schedules: { opponent: number; won: boolean }[][] = Array.from({ length: n }, () => []);
  springs.forEach((s) => {
    faced[s.winner]! += q[s.loser]!;
    faced[s.loser]! += q[s.winner]!;
    games[s.winner]!++;
    games[s.loser]!++;
    schedules[s.winner]!.push({ opponent: s.loser, won: true });
    schedules[s.loser]!.push({ opponent: s.winner, won: false });
  });
  const groupOf = (i: number) => (group ? group[i]! : -1);
  const groups = [...new Set(Array.from({ length: n }, (_, i) => groupOf(i)))].sort((a, b) => a - b);
  const benchmarks = new Map<number, number[]>(
    groups.map((gr) => [
      gr,
      benchmarkStrengths(strength, Array.from(games, (count, i) => count > 0 && (gr < 0 || groupOf(i) === gr))),
    ]),
  );
  const resumeParts = schedules.map((g, i) => {
    const bench = benchmarks.get(groupOf(i))!;
    return g.length ? bench.map((b) => strengthOfRecord(g, b, strength, settings.qualityScale).score) : bench.map(() => 0);
  });
  const resume = Float64Array.from(resumeParts, (parts) => {
    let sum = 0;
    for (const v of parts) sum += v;
    return sum / parts.length;
  });
  return {
    strength,
    quality: Float64Array.from(q),
    benchmarks,
    resumeParts,
    resume,
    schedule: faced.map((v, i) => (games[i]! > 0 ? v / games[i]! : 0)),
  };
}
