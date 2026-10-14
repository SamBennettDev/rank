import { rankValues, round6 } from "./model";
import { expFixed } from "./probability";
import type { Edge, ResumeSettings, Team, TeamResume } from "./types";

export interface ResultGame {
  home: number;
  away: number;
  homeWon: boolean;
  neutral: boolean;
}

export const logistic = (edge: number) => 1 / (1 + expFixed(-edge));

/** Penalized Bradley–Terry. Every team has the same zero prior. The API accepts
 * results and venues only, so a score margin cannot enter the fit accidentally.
 * Newton steps use a matrix-free, diagonally preconditioned conjugate solve.
 */
export function fitResultRatings(
  n: number,
  games: readonly ResultGame[],
  settings: Pick<ResumeSettings, "ridge" | "homeAdvantage">,
  exclude = -1,
): Float64Array {
  if (
    !Number.isInteger(n) ||
    n < 1 ||
    !(settings.ridge > 0) ||
    !Number.isFinite(settings.ridge) ||
    !(settings.homeAdvantage >= 0) ||
    !Number.isFinite(settings.homeAdvantage)
  )
    throw new Error("invalid resume fit settings");
  const used = games.filter((g) => g.home !== exclude && g.away !== exclude);
  for (const g of used)
    if (
      !Number.isInteger(g.home) ||
      !Number.isInteger(g.away) ||
      g.home < 0 ||
      g.home >= n ||
      g.away < 0 ||
      g.away >= n ||
      g.home === g.away
    )
      throw new Error("invalid resume result");
  const r = new Float64Array(n);
  const dot = (a: Float64Array, b: Float64Array) => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += a[i]! * b[i]!;
    return sum;
  };
  for (let iteration = 0; iteration < 60; iteration++) {
    const gradient = Float64Array.from(r, (v) => settings.ridge * v);
    const diagonal = new Float64Array(n).fill(settings.ridge);
    const weights = new Float64Array(used.length);
    for (let j = 0; j < used.length; j++) {
      const g = used[j]!;
      const p = logistic(
        r[g.home]! - r[g.away]! + (g.neutral ? 0 : settings.homeAdvantage),
      );
      const residual = p - Number(g.homeWon),
        w = p * (1 - p);
      gradient[g.home]! += residual;
      gradient[g.away]! -= residual;
      diagonal[g.home]! += w;
      diagonal[g.away]! += w;
      weights[j] = w;
    }
    if (gradient.every((v) => Math.abs(v) < 1e-9)) return r;
    const step = new Float64Array(n),
      residual = gradient.slice();
    let z = Float64Array.from(residual, (v, i) => v / diagonal[i]!);
    let direction = z.slice(),
      rz = dot(residual, z);
    const tolerance = Math.max(1e-24, dot(gradient, gradient) * 1e-20);
    for (let iteration = 0; iteration < n * 2; iteration++) {
      const product = Float64Array.from(direction, (v) => settings.ridge * v);
      for (let j = 0; j < used.length; j++) {
        const g = used[j]!,
          v = weights[j]! * (direction[g.home]! - direction[g.away]!);
        product[g.home]! += v;
        product[g.away]! -= v;
      }
      const alpha = rz / dot(direction, product);
      for (let i = 0; i < n; i++) {
        step[i]! += alpha * direction[i]!;
        residual[i]! -= alpha * product[i]!;
      }
      if (dot(residual, residual) <= tolerance) break;
      z = Float64Array.from(residual, (v, i) => v / diagonal[i]!);
      const next = dot(residual, z),
        beta = next / rz;
      direction = Float64Array.from(z, (v, i) => v + beta * direction[i]!);
      rz = next;
    }
    const largest = Math.max(...step.map(Math.abs)),
      scale = Math.min(1, 2 / largest);
    for (let i = 0; i < n; i++) r[i]! -= scale * step[i]!;
  }
  throw new Error("resume result fit did not converge");
}

/** P(a benchmark team wins at least w games on this exact schedule).
 * Conditional independent-game diagnostic, not a posterior confidence level.
 */
export function recordProbability(
  probabilities: readonly number[],
  wins: number,
): number {
  if (
    !Number.isInteger(wins) ||
    wins < 0 ||
    wins > probabilities.length ||
    probabilities.some((p) => !Number.isFinite(p) || p < 0 || p > 1)
  )
    throw new Error("invalid record probability inputs");
  let mass = [1];
  for (const p of probabilities) {
    const next = new Array<number>(mass.length + 1).fill(0);
    for (let i = 0; i < mass.length; i++) {
      next[i]! += mass[i]! * (1 - p);
      next[i + 1]! += mass[i]! * p;
    }
    mass = next;
  }
  return Math.min(
    1,
    Math.max(
      0,
      mass.slice(wins).reduce((s, v) => s + v, 0),
    ),
  );
}

/** Current-season earned results relative to a top-25 FBS benchmark. Each team's
 * own games are removed before evaluating ALL opponents and the benchmark.
 * No self-credit, historical team/division prior, margin, recency, or poll input.
 */
export function calculateResumes(
  teams: readonly Team[],
  edges: readonly Edge[],
  settings: ResumeSettings,
): { teams: (TeamResume | null)[]; ranks: (number | null)[] } {
  if (
    settings.method !== "opponent-independent-resume-v1" ||
    settings.reference !== "fbs" ||
    settings.leaveTeamOut !== true ||
    !Number.isInteger(settings.benchmarkRank) ||
    settings.benchmarkRank < 1
  )
    throw new Error("invalid resume policy");
  const index = new Map(teams.map((t, i) => [t.id, i]));
  const fbs = teams.flatMap((t, i) => (t.classification === "fbs" ? [i] : []));
  if (!fbs.length)
    throw new Error("resume ranking requires FBS benchmark teams");
  const ordered = [...edges].sort((a, b) => a.gameId - b.gameId);
  const results = ordered
    .filter((e) => index.has(e.winner) && index.has(e.loser))
    .map((e) => ({
      home: index.get(e.winnerIsHome ? e.winner : e.loser)!,
      away: index.get(e.winnerIsHome ? e.loser : e.winner)!,
      homeWon: e.winnerIsHome,
      neutral: e.neutralSite,
    }));
  const resumes = teams.map((team, t): TeamResume | null => {
    const own = ordered.filter(
      (e) => e.winner === team.id || e.loser === team.id,
    );
    if (!own.length) return null;
    const fit = fitResultRatings(teams.length, results, settings, t);
    const reference = fbs
      .filter((i) => i !== t)
      .map((i) => fit[i]!)
      .sort((a, b) => b - a);
    // A one-team toy field has no independent FBS reference; use the equal prior.
    const benchmark =
      reference[Math.min(settings.benchmarkRank, reference.length) - 1] ?? 0;
    const games = own.map((e) => {
      const won = e.winner === team.id,
        opponentId = won ? e.loser : e.winner;
      const opponent = index.get(opponentId);
      const where: -1 | 0 | 1 = e.neutralSite
        ? 0
        : won === e.winnerIsHome
          ? 1
          : -1;
      const p =
        opponent === undefined
          ? 1
          : round6(
              logistic(
                benchmark - fit[opponent]! + where * settings.homeAdvantage,
              ),
            );
      const opponentGames =
        opponent === undefined
          ? 0
          : results.filter(
              (g) =>
                g.home !== t &&
                g.away !== t &&
                (g.home === opponent || g.away === opponent),
            ).length;
      return {
        gameId: e.gameId,
        opponentId,
        won,
        where,
        benchmarkWinProbability: p,
        value: round6(Number(won) - p),
        opponentGames,
        unmodeled: opponent === undefined,
      };
    });
    const probabilities = games.map((g) => g.benchmarkWinProbability);
    const wins = games.filter((g) => g.won).length;
    const expectedMicros = probabilities.reduce(
      (s, p) => s + Math.round(p * 1e6),
      0,
    );
    return {
      score: (wins * 1e6 - expectedMicros) / 1e6,
      expectedWins: expectedMicros / 1e6,
      scheduleDifficulty:
        Math.round((games.length * 1e6 - expectedMicros) / games.length) / 1e6,
      recordProbability: round6(recordProbability(probabilities, wins)),
      benchmarkStrength: round6(benchmark),
      limitedEvidence: games.some((g) => !g.unmodeled && g.opponentGames < 3),
      games,
    };
  });
  return {
    teams: resumes,
    ranks: rankValues(resumes.map((r) => r?.score ?? null)),
  };
}
