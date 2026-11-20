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
 * Résumé points for one game, 0–100, from 0–100 quality points. A win earns 50 plus
 * half the loser's quality (50–100); a loss earns half the winner's quality (0–50).
 * Beating a good team or losing to a bad one moves a résumé most; beating a bad team
 * or losing to a good one barely does.
 */
export const gamePoints = (winnerQuality: number, loserQuality: number) => ({
  win: (QUALITY_POINTS + loserQuality) / 2,
  loss: winnerQuality / 2,
});

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
 * SpringRank. Résumé is a team's average game points
 * (see `gamePoints`); schedule is the average quality of the opponents it played.
 */
export function rankByQuality(
  n: number,
  springs: readonly Spring[],
  settings: SpringSettings,
) {
  const strength = solveStrength(n, springs, settings);
  const q = Array.from(strength, (s) =>
    qualityPoints(quality(s, settings.qualityScale)),
  );
  const points = springs.map((s) => gamePoints(q[s.winner]!, q[s.loser]!));
  const earned = new Float64Array(n),
    faced = new Float64Array(n),
    games = new Float64Array(n);
  springs.forEach((s, e) => {
    earned[s.winner]! += points[e]!.win;
    earned[s.loser]! += points[e]!.loss;
    faced[s.winner]! += q[s.loser]!;
    faced[s.loser]! += q[s.winner]!;
    games[s.winner]!++;
    games[s.loser]!++;
  });
  const perGame = (x: Float64Array) =>
    x.map((v, i) => (games[i]! > 0 ? v / games[i]! : 0));
  return {
    strength,
    quality: Float64Array.from(q),
    points,
    resume: perGame(earned),
    schedule: perGame(faced),
  };
}
