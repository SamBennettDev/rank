import { forecastBatches } from "./chronology";
import { predictMatchup, rateTeams } from "./model";
import type { RatedGame } from "./rating";
import type { Game, SeasonConfig, Team } from "./types";

export function ratedGames(
  teams: readonly Team[],
  games: readonly Game[],
): RatedGame[] {
  const index = new Map(teams.map((t, i) => [t.id, i]));
  return games
    .filter(
      (g) =>
        index.has(g.homeId) &&
        index.has(g.awayId) &&
        g.completed &&
        g.homePoints !== null &&
        g.awayPoints !== null &&
        g.homePoints !== g.awayPoints,
    )
    .sort((a, b) => a.id - b.id)
    .map((g) => ({
      home: index.get(g.homeId)!,
      away: index.get(g.awayId)!,
      margin: g.homePoints! - g.awayPoints!,
      neutral: g.neutralSite,
    }));
}

export interface ForecastOutcome {
  gameId: number;
  season: string;
  cutoff: string;
  home: number;
  away: number;
  fbs: boolean;
  probability: number;
  won: boolean;
  provisional: boolean;
}
export function evaluateSeason(
  teams: readonly Team[],
  games: readonly Game[],
  config: SeasonConfig,
): ForecastOutcome[] {
  const index = new Map(teams.map((t, i) => [t.id, i])),
    out: ForecastOutcome[] = [];
  for (const batch of forecastBatches(games)) {
    const train = ratedGames(teams, batch.train);
    if (!train.length) continue;
    const model = rateTeams(teams.length, train, config);
    for (const g of [...batch.test].sort((a, b) => a.id - b.id)) {
      const h = index.get(g.homeId),
        a = index.get(g.awayId);
      if (
        h === undefined ||
        a === undefined ||
        model.heights[h] === null ||
        model.heights[a] === null
      )
        continue;
      const p = predictMatchup(model, h, a, g.neutralSite, config);
      out.push({
        gameId: g.id,
        season: g.season,
        cutoff: batch.cutoff,
        home: g.homeId,
        away: g.awayId,
        fbs:
          teams[h]!.classification === "fbs" &&
          teams[a]!.classification === "fbs",
        probability: p.homeProbability,
        won: g.homePoints! > g.awayPoints!,
        provisional: p.provisional,
      });
    }
  }
  return out;
}

export function forecastMetrics(out: readonly ForecastOutcome[]) {
  let correct = 0,
    brier = 0,
    logLoss = 0;
  const bins = Array.from({ length: 10 }, (_, i) => ({
    from: i / 10,
    to: (i + 1) / 10,
    n: 0,
    probability: 0,
    wins: 0,
  }));
  for (const row of out) {
    const p = Math.max(1e-12, Math.min(1 - 1e-12, row.probability)),
      y = Number(row.won);
    correct += p === 0.5 ? 0.5 : Number(p > 0.5 === row.won);
    brier += (p - y) ** 2;
    logLoss -= y * Math.log(p) + (1 - y) * Math.log(1 - p);
    const bin = bins[Math.min(9, Math.floor(p * 10))]!;
    bin.n++;
    bin.probability += p;
    bin.wins += y;
  }
  return {
    n: out.length,
    accuracy: out.length ? correct / out.length : null,
    brier: out.length ? brier / out.length : null,
    logLoss: out.length ? logLoss / out.length : null,
    calibration: bins.map((b) => ({
      from: b.from,
      to: b.to,
      n: b.n,
      meanProbability: b.n ? b.probability / b.n : null,
      observedWinRate: b.n ? b.wins / b.n : null,
    })),
  };
}
