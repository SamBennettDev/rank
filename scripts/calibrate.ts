/** Design years only. Later seasons are deliberately unavailable to this command. */
import { writeFileSync } from "node:fs";
import { forecastBatches } from "../src/engine/chronology";
import { DEFAULT_SETTINGS } from "../src/engine/defaults";
import { ratedGames } from "../src/engine/evaluation";
import { sha256Hex } from "../src/engine/hash";
import { winProbability } from "../src/engine/probability";
import { fitRatings, ratingUncertainty, result } from "../src/engine/rating";
import { historySeason, HISTORY_REVISION } from "./history";

const years = [2014, 2015, 2016, 2017, 2018, 2019],
  ridges = [0.0001, 0.05, 0.5, 2, 10, 50],
  scales = [4, 6, 8, 10, 12, 14, 16, 18, 20];
const inputs = [];
for (const year of years) inputs.push({ year, ...(await historySeason(year)) });
const candidates = [];
for (const homeFieldShrink of ridges) {
  const samples: {
    edge: number;
    variance: number;
    residual: number;
    won: boolean;
  }[] = [];
  for (const input of inputs) {
    const index = new Map(input.teams.map((t, i) => [t.id, i]));
    for (const batch of forecastBatches(input.games, 2)) {
      const train = ratedGames(input.teams, batch.train);
      if (!train.length) continue;
      const fit = fitRatings(input.teams.length, train, {
          ...DEFAULT_SETTINGS,
          homeFieldShrink,
        }),
        uncertainty = ratingUncertainty(fit, 1);
      const played = new Set(train.flatMap((g) => [g.home, g.away]));
      for (const g of batch.test) {
        const h = index.get(g.homeId)!,
          a = index.get(g.awayId)!;
        if (!played.has(h) || !played.has(a)) continue;
        const edge =
            fit.ratings[h]! -
            fit.ratings[a]! +
            (g.neutralSite ? 0 : fit.homeField),
          margin = g.homePoints! - g.awayPoints!;
        samples.push({
          edge,
          variance: uncertainty.matchupVariance(h, a, g.neutralSite),
          residual: result(margin, DEFAULT_SETTINGS.winBonus) - edge,
          won: margin > 0,
        });
      }
    }
  }
  const residualScale = Number(
    Math.sqrt(
      samples.reduce(
        (s, r) => s + (r.residual * r.residual) / (1 + r.variance),
        0,
      ) / samples.length,
    ).toFixed(6),
  );
  for (const probabilityScale of scales) {
    let loss = 0,
      brier = 0;
    for (const row of samples) {
      const p = Math.max(
          1e-12,
          Math.min(
            1 - 1e-12,
            winProbability(
              row.edge,
              probabilityScale,
              row.variance * residualScale * residualScale,
            ),
          ),
        ),
        y = Number(row.won);
      loss -= y * Math.log(p) + (1 - y) * Math.log(1 - p);
      brier += (p - y) ** 2;
    }
    candidates.push({
      homeFieldShrink,
      probabilityScale,
      residualScale: Number(residualScale.toFixed(6)),
      n: samples.length,
      logLoss: loss / samples.length,
      brier: brier / samples.length,
    });
  }
  console.log(`calibrated home-field shrink ${homeFieldShrink}`);
}
candidates.sort(
  (a, b) =>
    a.logLoss - b.logLoss ||
    a.homeFieldShrink - b.homeFieldShrink ||
    a.probabilityScale - b.probabilityScale,
);
const best = candidates[0]!;
const report = {
  id: "calendar-2014-2019-v1",
  sourceRevision: HISTORY_REVISION,
  status:
    "training calibration; 2021–2026 are development evaluation, not untouched holdout",
  years,
  startWeek: 2,
  protocol:
    "Monday 12:00 UTC forecast cutoff; scores eligible six hours after kickoff",
  selection:
    "minimum pooled walk-forward log loss; probability variance includes conditional rating uncertainty",
  inputs: await Promise.all(
    inputs.map(async (i) => ({ year: i.year, sha256: await sha256Hex(i.raw) })),
  ),
  selected: best,
  candidates,
};
writeFileSync(
  new URL("../research/calibration.json", import.meta.url),
  JSON.stringify(report, null, 2) + "\n",
);
const settings = {
  ...DEFAULT_SETTINGS,
  homeFieldShrink: best.homeFieldShrink,
  probabilityScale: best.probabilityScale,
  residualScale: best.residualScale,
};
writeFileSync(
  new URL("../src/engine/defaults.ts", import.meta.url),
  `/** Frozen settings from research/calibration.json; never tuned at runtime. */\nexport const DEFAULT_SETTINGS = ${JSON.stringify(settings, null, 2)};\n`,
);
console.log(JSON.stringify(best));
