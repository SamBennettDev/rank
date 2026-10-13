import { calendarWeekStart, kickoff, RESULT_LAG_MS } from "./chronology";
import { rankValues, round6 } from "./model";
import { winProbability } from "./probability";
import { fitRatings, ratingUncertainty, type RatedGame } from "./rating";
import type { Game, SeasonConfig, StandingCredit, Team } from "./types";

export interface DatedGame extends RatedGame {
  id: number;
  time: number;
}
/** Future scores may be present in archival files. Never use their margin. */
export function indexedGames(
  teams: readonly Team[],
  games: readonly Game[],
): DatedGame[] {
  const index = new Map(teams.map((t, i) => [t.id, i]));
  return games
    .filter((g) => index.has(g.homeId) && index.has(g.awayId))
    .sort((a, b) => a.id - b.id)
    .map((g) => ({
      id: g.id,
      time: kickoff(g),
      home: index.get(g.homeId)!,
      away: index.get(g.awayId)!,
      margin: (g.homePoints ?? 0) - (g.awayPoints ?? 0),
      neutral: g.neutralSite,
    }));
}
export function winCredit(
  opponent: number,
  site: number,
  fit: ReturnType<typeof fitRatings>,
  uncertainty: ReturnType<typeof ratingUncertainty>,
  config: SeasonConfig,
) {
  return winProbability(
    fit.ratings[opponent]! - site * fit.homeField,
    config.probabilityScale,
    uncertainty.referenceVariance(opponent, site),
  );
}
/** Immutable weekly win credits; each loss always subtracts exactly one point. */
export function scoreStandings(
  n: number,
  games: readonly DatedGame[],
  config: SeasonConfig,
) {
  const credits: StandingCredit[] = [];
  const ordered = [...games].sort((a, b) => a.id - b.id);
  const cutoffs = [
    ...new Set(ordered.map((g) => calendarWeekStart(g.time))),
  ].sort((a, b) => a - b);
  for (const cutoff of cutoffs) {
    const earlier = ordered.filter((g) => g.time + RESULT_LAG_MS <= cutoff);
    const fit = fitRatings(n, earlier, config),
      uncertainty = ratingUncertainty(fit, config.residualScale);
    for (const g of ordered.filter(
      (g) => calendarWeekStart(g.time) === cutoff,
    )) {
      if (g.margin === 0) continue;
      const winner = g.margin > 0 ? g.home : g.away,
        loser = g.margin > 0 ? g.away : g.home;
      const site = g.neutral ? 0 : winner === g.home ? 1 : -1;
      const value = round6(winCredit(loser, site, fit, uncertainty, config));
      credits.push({
        gameId: g.id,
        winner,
        loser,
        value,
        cutoff: new Date(cutoff).toISOString(),
      });
    }
  }
  credits.sort((a, b) => a.gameId - b.gameId);
  return aggregateCredits(n, credits);
}
export function aggregateCredits(n: number, credits: StandingCredit[]) {
  const scores = new Float64Array(n),
    played = new Uint32Array(n);
  for (const c of credits) {
    scores[c.winner]! += c.value;
    scores[c.loser]!--;
    played[c.winner]!++;
    played[c.loser]!++;
  }
  const heights = Array.from(scores, (v, i) => (played[i] ? round6(v) : null));
  return { scores, played, heights, ranks: rankValues(heights), credits };
}
