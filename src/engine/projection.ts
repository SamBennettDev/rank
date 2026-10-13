import { solveFactor } from "./linalg";
import { calendarWeekStart, RESULT_LAG_MS } from "./chronology";
import { normalQuantile, winProbability } from "./probability";
import { fitRatings, ratingUncertainty } from "./rating";
import { type rateTeams, round6, rankValues } from "./model";
import { type DatedGame, type scoreStandings, winCredit } from "./standing";
import type { SeasonConfig, TeamProjection } from "./types";

export type ProjectionMode = "independent" | "correlated" | "adaptive";
export const PROJECTION_MODE: ProjectionMode = "correlated";
/** Range reduction and a fixed convergent series preserve cross-runtime bytes. */
export function logFixed(value: number) {
  if (!(value > 0) || !Number.isFinite(value))
    throw new Error("log requires a positive finite value");
  let x = value,
    exponent = 0;
  while (x < 1) {
    x *= 2;
    exponent--;
  }
  while (x >= 2) {
    x /= 2;
    exponent++;
  }
  const z = (x - 1) / (x + 1),
    square = z * z;
  let power = z,
    sum = 0;
  for (let k = 0; k < 24; k++) {
    sum += power / (2 * k + 1);
    power *= square;
  }
  return 2 * sum + exponent * 0.6931471805599453;
}
const ordersCache = new Map<string, Uint16Array>();
/** Each marginal visits every probability stratum once, in seeded random order. */
function stratifiedOrder(dimensions: number, samples: number, seed: number) {
  const key = `${dimensions}/${samples}/${seed}`,
    cached = ordersCache.get(key);
  if (cached) return cached;
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let x = Math.imul(state ^ (state >>> 15), 1 | state);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return (x ^ (x >>> 14)) >>> 0;
  };
  const out = new Uint16Array(dimensions * samples);
  for (let d = 0; d < dimensions; d++) {
    const order = Array.from({ length: samples }, (_, i) => i);
    for (let i = samples - 1; i > 0; i--) {
      const j = next() % (i + 1);
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    for (let s = 0; s < samples; s++) out[s * dimensions + d] = order[s]!;
  }
  if (ordersCache.size >= 2)
    ordersCache.delete(ordersCache.keys().next().value!);
  ordersCache.set(key, out);
  return out;
}

/** Simulate coherent game outcomes, then apply the same earned-standing rule. */
export function projectSeason(
  model: ReturnType<typeof rateTeams>,
  standing: ReturnType<typeof scoreStandings>,
  known: readonly DatedGame[],
  remaining: readonly DatedGame[],
  config: SeasonConfig,
  mode: ProjectionMode = PROJECTION_MODE,
) {
  const n = model.fit.ratings.length,
    N = n + 1;
  const future = [...remaining].sort((a, b) => a.time - b.time || a.id - b.id);
  const active = Array.from({ length: n }, (_, i) => i).filter(
    (i) =>
      standing.heights[i] !== null ||
      future.some((g) => g.home === i || g.away === i),
  );
  const projections: (TeamProjection | null)[] = Array(n).fill(null);
  if (!future.length) {
    for (const i of active) {
      const value = standing.heights[i]!,
        rank = standing.ranks[i]!;
      projections[i] = {
        expectedRating: value,
        expectedRank: rank,
        medianRank: rank,
        rankLow: rank,
        rankHigh: rank,
        ratingLow: value,
        ratingHigh: value,
        top25Probability: Number(rank <= 25),
        firstProbability: Number(rank === 1),
      };
    }
    return { projections, teams: active.length };
  }
  const S = config.projectionSamples,
    dimensions = N + future.length;
  const order = stratifiedOrder(dimensions, S, config.projectionSeed);
  const normals = Array.from({ length: S }, (_, i) =>
    normalQuantile((i + 0.5) / S),
  );
  const logits = Array.from(
    { length: S },
    (_, i) => config.probabilityScale * logFixed((i + 0.5) / (S - i - 0.5)),
  );
  const creditModels = new Map<
    number,
    { fit: typeof model.fit; uncertainty: typeof model.uncertainty }
  >();
  const latestResult = Math.max(...known.map((g) => g.time + RESULT_LAG_MS));
  const fixedCredits = future.map((g) => {
    const cutoff = calendarWeekStart(g.time);
    let creditModel = creditModels.get(cutoff);
    if (!creditModel) {
      if (cutoff >= latestResult) creditModel = model;
      else {
        const fit = fitRatings(
          n,
          known.filter((k) => k.time + RESULT_LAG_MS <= cutoff),
          config,
        );
        creditModel = {
          fit,
          uncertainty: ratingUncertainty(fit, config.residualScale),
        };
      }
      creditModels.set(cutoff, creditModel);
    }
    return [
      winCredit(
        g.away,
        g.neutral ? 0 : 1,
        creditModel.fit,
        creditModel.uncertainty,
        config,
      ),
      winCredit(
        g.home,
        g.neutral ? 0 : -1,
        creditModel.fit,
        creditModel.uncertainty,
        config,
      ),
    ];
  });
  const probabilities = future.map((g) =>
    winProbability(
      model.fit.ratings[g.home]! -
        model.fit.ratings[g.away]! +
        (g.neutral ? 0 : model.fit.homeField),
      config.probabilityScale,
      model.uncertainty.matchupVariance(g.home, g.away, g.neutral),
    ),
  );
  const weeks = (
    mode === "adaptive"
      ? [...new Set(future.map((g) => calendarWeekStart(g.time)))]
      : []
  )
    .sort((a, b) => a - b)
    .map((cutoff) => {
      const past = future
        .map((g, i) => ({ g, i }))
        .filter(({ g }) => g.time + RESULT_LAG_MS <= cutoff);
      const fit = fitRatings(
        n,
        [
          ...known.filter((g) => g.time + RESULT_LAG_MS <= cutoff),
          ...past.map(({ g }) => ({ ...g, margin: 0 })),
        ].sort((a, b) => a.id - b.id),
        config,
      );
      const uncertainty = ratingUncertainty(fit, config.residualScale);
      const games = future
        .map((g, i) => ({ g, i }))
        .filter(({ g }) => calendarWeekStart(g.time) === cutoff);
      return { fit, past, games, uncertainty };
    });
  const values = active.map(() => new Float64Array(S)),
    ranks = active.map(() => new Uint16Array(S));
  for (let sample = 0; sample < S; sample++) {
    const latent = new Float64Array(N),
      z = Array.from(
        { length: N },
        (_, i) => normals[order[sample * dimensions + i]!]!,
      );
    for (let i = 0; i < N; i++) {
      let delta = 0;
      for (let row = i; row < N; row++)
        delta += model.uncertainty.inverse[row * N + i]! * z[row]!;
      latent[i] =
        (i === n ? model.fit.homeField : model.fit.ratings[i]!) +
        config.residualScale * delta;
    }
    const mean = latent.slice(0, n).reduce((sum, v) => sum + v, 0) / n;
    for (let i = 0; i < n; i++) latent[i]! -= mean;
    const outcomes = new Float64Array(future.length);
    for (let k = 0; k < future.length; k++) {
      const g = future[k]!,
        stratum = order[sample * dimensions + N + k]!;
      outcomes[k] =
        mode === "independent"
          ? (stratum + 0.5) / S < probabilities[k]!
            ? 1
            : -1
          : latent[g.home]! -
            latent[g.away]! +
            (g.neutral ? 0 : latent[n]!) +
            logits[stratum]!;
    }
    const scores = standing.scores.slice();
    if (mode === "adaptive") {
      for (const week of weeks) {
        const rhs = week.fit.rhs.slice();
        for (const { g, i } of week.past) {
          const y = outcomes[i]!;
          rhs[g.home]! += y;
          rhs[g.away]! -= y;
          if (!g.neutral) rhs[n]! += y;
        }
        const estimate = solveFactor(week.fit.factor, rhs, N);
        const fit = {
          ...week.fit,
          ratings: estimate.slice(0, n),
          homeField: estimate[n]!,
        };
        for (const { g, i } of week.games) {
          const homeWins = outcomes[i]! > 0,
            winner = homeWins ? g.home : g.away,
            loser = homeWins ? g.away : g.home;
          scores[winner]! += round6(
            winCredit(
              loser,
              g.neutral ? 0 : homeWins ? 1 : -1,
              fit,
              week.uncertainty,
              config,
            ),
          );
          scores[loser]!--;
        }
      }
    } else {
      future.forEach((g, i) => {
        const homeWins = outcomes[i]! > 0,
          winner = homeWins ? g.home : g.away,
          loser = homeWins ? g.away : g.home;
        scores[winner]! += round6(fixedCredits[i]![homeWins ? 0 : 1]!);
        scores[loser]!--;
      });
    }
    const rounded = active.map((i) => round6(scores[i]!)),
      ranked = rankValues(rounded);
    for (let j = 0; j < active.length; j++) {
      values[j]![sample] = rounded[j]!;
      ranks[j]![sample] = ranked[j]!;
    }
  }
  const quantile = (arr: ArrayLike<number>, p: number) =>
    arr[Math.floor((S - 1) * p)]!;
  active.forEach((i, j) => {
    const v = values[j]!,
      r = ranks[j]!;
    let expectedRating = 0,
      expectedRank = 0,
      top = 0,
      first = 0;
    for (let s = 0; s < S; s++) {
      expectedRating += v[s]!;
      expectedRank += r[s]!;
      top += Number(r[s]! <= 25);
      first += Number(r[s] === 1);
    }
    v.sort();
    r.sort();
    projections[i] = {
      expectedRating: round6(expectedRating / S),
      expectedRank: round6(expectedRank / S),
      medianRank: quantile(r, 0.5),
      rankLow: quantile(r, 0.1),
      rankHigh: quantile(r, 0.9),
      ratingLow: quantile(v, 0.1),
      ratingHigh: quantile(v, 0.9),
      top25Probability: round6(top / S),
      firstProbability: round6(first / S),
    };
  });
  return { projections, teams: active.length };
}
