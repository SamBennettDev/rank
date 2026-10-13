import { fitRatings, ratingUncertainty, type RatedGame } from "./rating";
import type { SeasonConfig, Team } from "./types";

export interface WinQualityContext {
  referenceIndices: number[];
  priorMeans: number[];
}

export function makeWinQualityContext(
  teams: readonly Team[],
  config: SeasonConfig,
): WinQualityContext | undefined {
  if (!config.winQuality) return undefined;
  const referenceIndices = teams.flatMap((t, i) =>
    t.classification === "fbs" ? [i] : [],
  );
  if (!referenceIndices.length)
    throw new Error(
      "FBS win quality requires FBS reference teams in model inputs",
    );
  const priorMeans = teams.map((t) =>
    t.classification === "fcs" ? -config.winQuality!.divisionGap : 0,
  );
  const mean = priorMeans.reduce((sum, v) => sum + v, 0) / teams.length;
  return { referenceIndices, priorMeans: priorMeans.map((v) => v - mean) };
}

/** One stable quality fit; team/conference reputation never enters this model. */
export function fitWinQuality(
  n: number,
  games: readonly RatedGame[],
  config: SeasonConfig,
  context?: WinQualityContext,
) {
  if (config.winQuality && !context)
    throw new Error("win-quality context is required");
  const q = config.winQuality;
  const fit = fitRatings(
    n,
    games,
    q
      ? {
          winBonus: config.winBonus,
          shrink: q.shrink,
          homeFieldShrink: q.homeFieldShrink,
          homeFieldPrior: q.homeField,
          priorMeans: context!.priorMeans,
        }
      : config,
  );
  const uncertainty = ratingUncertainty(
    fit,
    config.residualScale,
    context?.referenceIndices,
  );
  return { fit, uncertainty };
}

export function referenceStrength(
  fit: ReturnType<typeof fitRatings>,
  context?: WinQualityContext,
) {
  return context
    ? context.referenceIndices.reduce((sum, i) => sum + fit.ratings[i]!, 0) /
        context.referenceIndices.length
    : 0;
}
