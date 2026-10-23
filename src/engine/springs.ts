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
export const WIN_POINTS = 7;

/** The top of the 0–100 quality scale. */
export const QUALITY_POINTS = 100;

/**
 * How far above its loser a spring wants the winner, in points:
 * WIN_POINTS × (1 + 1/2 + … + 1/margin). The first point is worth 7, the second
 * 3.5, the third 2.33: each extra point counts less than the one before.
 */
export function marginGap(margin: number) {
  if (!Number.isInteger(margin) || margin < 1)
    throw new Error("margin must be a positive whole number");
  let sum = 0;
  for (let i = 1; i <= margin; i++) sum += 1 / i;
  return WIN_POINTS * sum;
}

/** Chance a team at this strength beats an average (height 0) team. */
export const quality = (strength: number, scale: number) => {
  const e = expFixed(-Math.abs(strength) * scale);
  return strength >= 0 ? 1 / (1 + e) : e / (1 + e);
};

/** A team's quality points: QUALITY_POINTS × its chance of beating an average team (0–100). */
export const qualityPoints = (q: number) => QUALITY_POINTS * q;

/**
 * Résumé points for one game, from 0–100 quality points. The winner earns the loser's
 * quality; the loser loses 100 minus the winner's quality. Beating a good team or
 * losing to a bad one moves a résumé most; beating a bad team or losing to a good
 * one barely does.
 */
export const gamePoints = (winnerQuality: number, loserQuality: number) => ({
  win: loserQuality,
  loss: -(QUALITY_POINTS - winnerQuality),
});

/**
 * Spring strength for one game: chance(loser) + (1 − chance(winner)), 0–2, where
 * chance is each team's chance of beating an average team.
 * A surprising result (an upset, or a win over a good team) is a stiff spring; an
 * expected one (a good team beating a bad one) barely pulls either team.
 */
export const surprise = (winnerQuality: number, loserQuality: number) =>
  loserQuality + (1 - winnerQuality);

/** The solve repeats until no strength moves more than this many points... */
export const SETTLE = 1e-9;
/** ...or this many rounds have run. */
export const MAX_ROUNDS = 200;

/**
 * Heights that minimise
 *
 *   ½ Σ_games stiffness · (h[winner] − h[loser] − gap)²  +  ½ shrink · Σ_teams h²
 *
 * One symmetric positive-definite system, solved by Cholesky with + − × / and sqrt
 * in a fixed order. Each team's height is the stiffness-weighted average of what its
 * games say (opponent + gap after a win, opponent − gap after a loss), with `shrink`
 * weight on 0.
 */
export function solveSprings(
  n: number,
  springs: readonly Spring[],
  stiffness: readonly number[],
  gaps: readonly number[],
  shrink: number,
): Float64Array {
  if (!(shrink > 0)) throw new Error("spring shrink must be > 0");
  const matrix = new Float64Array(n * n),
    rhs = new Float64Array(n);
  springs.forEach(({ winner: w, loser: l }, e) => {
    const k = stiffness[e]!;
    if (!(k >= 0) || !Number.isFinite(k))
      throw new Error("spring stiffness must be finite and >= 0");
    matrix[w * n + w]! += k;
    matrix[l * n + l]! += k;
    matrix[w * n + l]! -= k;
    matrix[l * n + w]! -= k;
    const g = gaps[e]!;
    if (!Number.isFinite(g)) throw new Error("spring gap must be finite");
    rhs[w]! += k * g;
    rhs[l]! -= k * g;
  });
  for (let i = 0; i < n; i++) matrix[i * n + i]! += shrink;
  return choleskySolve(matrix, rhs, n);
}

/**
 * Margin SpringRank with springs weighted by surprise. Every game wants its winner
 * `marginGap(margin)` points above its loser. It starts with every spring at
 * strength 1, then sets each spring from the teams' chances (see `surprise`) and
 * solves again, until the strengths settle.
 */
export function solveStrength(
  n: number,
  springs: readonly Spring[],
  settings: SpringSettings,
) {
  const gaps = springs.map((s) => marginGap(s.margin));
  let stiffness = springs.map(() => 1);
  let strength = solveSprings(
    n,
    springs,
    stiffness,
    gaps,
    settings.strengthShrink,
  );
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const p = Array.from(strength, (x) => quality(x, settings.qualityScale));
    stiffness = springs.map((s) => surprise(p[s.winner]!, p[s.loser]!));
    const next = solveSprings(
      n,
      springs,
      stiffness,
      gaps,
      settings.strengthShrink,
    );
    let moved = 0;
    for (let i = 0; i < n; i++)
      moved = Math.max(moved, Math.abs(next[i]! - strength[i]!));
    strength = next;
    if (moved < SETTLE) return { strength, stiffness };
  }
  throw new Error("strengths did not settle");
}

/**
 * The ranking and its two companions. Quality (0–100 points, the ranking) comes from
 * one surprise-weighted margin SpringRank. Résumé is a team's average game points
 * (see `gamePoints`); schedule is the average quality of the opponents it played.
 */
export function rankByQuality(
  n: number,
  springs: readonly Spring[],
  settings: SpringSettings,
) {
  const { strength, stiffness } = solveStrength(n, springs, settings);
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
    stiffness,
    points,
    resume: perGame(earned),
    schedule: perGame(faced),
  };
}
