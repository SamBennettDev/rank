import { winProbability } from "./probability";
import type { RatedGame } from "./rating";
import type { SeasonConfig } from "./types";
import { fitMatchup, type MatchupContext } from "./matchup";

export const round6 = (v: number) => Math.round(v * 1e6) / 1e6;
export function rankValues(values: readonly (number | null)[]) {
  const sorted = values
    .filter((x): x is number => x !== null)
    .sort((a, b) => b - a);
  return values.map((v) => (v === null ? null : sorted.indexOf(v) + 1));
}

export function rateTeams(
  n: number,
  games: readonly RatedGame[],
  config: SeasonConfig,
  context: MatchupContext,
) {
  const { fit, uncertainty } = fitMatchup(n, games, config, context);
  const wins = new Float64Array(n),
    losses = new Float64Array(n);
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number) => {
    while (parent[i] !== i) i = parent[i]!;
    return i;
  };
  for (const g of games) {
    if (g.margin > 0) {
      wins[g.home]!++;
      losses[g.away]!++;
    } else {
      wins[g.away]!++;
      losses[g.home]!++;
    }
    const a = find(g.home),
      b = find(g.away);
    parent[Math.max(a, b)] = Math.min(a, b);
  }
  const components = parent.map((_, i) => find(i)),
    sizes = new Map<number, number>();
  for (let i = 0; i < n; i++)
    if (wins[i]! + losses[i]! > 0)
      sizes.set(components[i]!, (sizes.get(components[i]!) ?? 0) + 1);
  const heights = Array.from(fit.ratings, (v, i) =>
    wins[i]! + losses[i]! > 0 ? round6(v) : null,
  );
  const provisional = heights.map(
    (_, i) => wins[i]! + losses[i]! < 3 || sizes.size > 1,
  );
  return {
    fit,
    uncertainty,
    wins,
    losses,
    heights,
    components,
    sizes,
    provisional,
    ranks: rankValues(heights),
  };
}

export function predictMatchup(
  model: ReturnType<typeof rateTeams>,
  home: number,
  away: number,
  neutral: boolean,
  config: SeasonConfig,
) {
  const edge =
    model.fit.ratings[home]! -
    model.fit.ratings[away]! +
    (neutral ? 0 : model.fit.homeField);
  const variance = model.uncertainty.matchupVariance(home, away, neutral);
  return {
    strengthEdge: round6(edge),
    homeProbability: round6(
      winProbability(edge, config.matchup.probabilityScale, variance),
    ),
    provisional: model.provisional[home]! || model.provisional[away]!,
  };
}
