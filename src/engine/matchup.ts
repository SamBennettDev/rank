import { fitRatings, ratingUncertainty, type RatedGame } from "./rating";
import type { SeasonConfig, Team } from "./types";

export interface MatchupContext {
  /** Each team's starting point: 0 for FBS, −divisionGap for FCS, centred on 0. */
  priorMeans: number[];
}

/** Division starting points only; no team or conference reputation enters. */
export function makeMatchupContext(
  teams: readonly Team[],
  config: SeasonConfig,
): MatchupContext {
  const starts = teams.map((t) =>
    t.classification === "fcs" ? -config.matchup.divisionGap : 0,
  );
  const mean = starts.reduce((sum, v) => sum + v, 0) / (teams.length || 1);
  return { priorMeans: starts.map((v) => v - mean) };
}

/** The margin model behind matchup predictions, with its rating uncertainty. */
export function fitMatchup(
  n: number,
  games: readonly RatedGame[],
  config: SeasonConfig,
  context: MatchupContext,
) {
  const m = config.matchup;
  const fit = fitRatings(n, games, {
    winBonus: m.winBonus,
    shrink: m.shrink,
    homeFieldShrink: m.homeFieldShrink,
    homeFieldPrior: m.homeField,
    priorMeans: context.priorMeans,
  });
  return { fit, uncertainty: ratingUncertainty(fit, m.residualScale) };
}
