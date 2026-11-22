/**
 * Fits our expected-points and field-goal models on the NCAA stats mirror's play-by-play
 * and writes data/models/ep.json.
 *
 *   npm run fit-ep            # seasons 2014–2025 (2020 left out)
 *
 * Every down-and-distance play of regulation is a row: its features are the model's hat
 * weights (src/engine/ep.ts) and its target is the next score in the half from the
 * offense's side. Least squares with a tiny ridge (1 play's worth) gives the curves; the
 * 2025 season is held out first to check calibration, then the model is refitted on all.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  EP_PARAMS,
  type EpModel,
  epFeatures,
  expectedPoints,
  FIELD_KNOTS,
  TOGO_KNOTS,
  TOGO_REFERENCE,
} from "../src/engine/ep";
import { choleskySolve } from "../src/engine/linalg";
import { DATA_DIR } from "./lib";
import { addEpa, nextState, type Play, seasonPlays } from "./plays-sequence";

const SEASONS = [2014, 2015, 2016, 2017, 2018, 2019, 2021, 2022, 2023, 2024, 2025];
const HOLDOUT = 2025;
const round = (x: number, d = 6) => Math.round(x * 10 ** d) / 10 ** d;

const bySeason = new Map<number, Play[]>();
for (const y of SEASONS) {
  bySeason.set(y, await seasonPlays(y));
  process.stdout.write(`${y} `);
}
console.log();

function fitCurves(seasons: number[]) {
  const n = EP_PARAMS;
  const xtx = new Float64Array(n * n),
    xty = new Float64Array(n);
  let rows = 0;
  for (const y of seasons)
    for (const p of bySeason.get(y)!) {
      if (!p.state) continue;
      const x = epFeatures(p.down, p.togo, p.ytg);
      const nz: number[] = [];
      x.forEach((v, i) => v !== 0 && nz.push(i));
      for (const i of nz) {
        xty[i]! += x[i]! * p.nextScore;
        for (const j of nz) xtx[i * n + j]! += x[i]! * x[j]!;
      }
      rows++;
    }
  for (let i = 0; i < n; i++) xtx[i * n + i]! += 1;
  const beta = choleskySolve(xtx, xty, n);
  const per = FIELD_KNOTS.length + TOGO_KNOTS.length;
  const field: number[][] = [],
    togo: number[][] = [],
    goalToGo: number[] = [];
  for (let d = 0; d < 4; d++) {
    field.push(FIELD_KNOTS.map((_, k) => round(beta[d * per + k]!)));
    const t: number[] = [];
    let j = FIELD_KNOTS.length;
    TOGO_KNOTS.forEach((_, k) =>
      t.push(k === TOGO_REFERENCE ? 0 : round(beta[d * per + j++]!)),
    );
    togo.push(t);
    goalToGo.push(round(beta[d * per + per - 1]!));
  }
  return { field, togo, goalToGo, rows };
}

const base = {
  version: "ep-1",
  kickoff: 0,
  fgIntercept: 0,
  fgSlope: 0,
  touchdown: 7,
  fieldGoal: 3,
  safety: 2,
};

/** Root-mean-square miss and a calibration table (mean next score by EP bin) on some seasons. */
function check(m: EpModel, seasons: number[]) {
  let se = 0,
    seMean = 0,
    n = 0,
    sum = 0;
  const bins = new Map<number, { n: number; ep: number; actual: number }>();
  for (const y of seasons)
    for (const p of bySeason.get(y)!)
      if (p.state) {
        sum += p.nextScore;
        n++;
      }
  const mean = sum / n;
  for (const y of seasons)
    for (const p of bySeason.get(y)!) {
      if (!p.state) continue;
      const ep = expectedPoints(m, p.down, p.togo, p.ytg);
      se += (p.nextScore - ep) ** 2;
      seMean += (p.nextScore - mean) ** 2;
      const b = Math.max(-2, Math.min(6, Math.round(ep)));
      const e = bins.get(b) ?? { n: 0, ep: 0, actual: 0 };
      e.n++;
      e.ep += ep;
      e.actual += p.nextScore;
      bins.set(b, e);
    }
  return {
    plays: n,
    rmse: round(Math.sqrt(se / n), 4),
    rmseConstant: round(Math.sqrt(seMean / n), 4),
    calibration: [...bins.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([bin, e]) => ({
        bin,
        plays: e.n,
        predicted: round(e.ep / e.n, 3),
        actual: round(e.actual / e.n, 3),
      })),
  };
}

const train = SEASONS.filter((y) => y !== HOLDOUT);
const trial = { ...base, ...fitCurves(train) } as EpModel;
const holdout = check(trial, [HOLDOUT]);
console.log(
  `holdout ${HOLDOUT}: RMSE ${holdout.rmse} vs ${holdout.rmseConstant} for a constant`,
);

const final = fitCurves(SEASONS);
const model: EpModel = { ...base, field: final.field, togo: final.togo, goalToGo: final.goalToGo };

// Kickoffs: the average value for the kicking team (− the receiver's first-play EP).
let kSum = 0,
  kN = 0;
for (const y of SEASONS) {
  const plays = bySeason.get(y)!;
  addEpa(plays, model);
  plays.forEach((p, i) => {
    if (!p.kickoff || p.scored > 0) return;
    const q = nextState(plays, i);
    if (q) {
      kSum += -q.ep;
      kN++;
    }
  });
}
model.kickoff = round(kSum / kN);

// Field goals: logistic regression of made on kick distance (yards to goal + 17), by Newton steps.
const kicks: { d: number; made: number }[] = [];
for (const y of SEASONS)
  for (const p of bySeason.get(y)!)
    if (p.fieldGoal && p.state && !p.noPlay)
      kicks.push({ d: p.ytg + 17, made: p.fieldGoalMade ? 1 : 0 });
let a = 0,
  b = 0;
for (let it = 0; it < 50; it++) {
  let g0 = 0,
    g1 = 0,
    h00 = 0,
    h01 = 0,
    h11 = 0;
  for (const k of kicks) {
    const p = 1 / (1 + Math.exp(-(a + b * k.d)));
    const r = k.made - p,
      w = p * (1 - p);
    g0 += r;
    g1 += r * k.d;
    h00 += w;
    h01 += w * k.d;
    h11 += w * k.d * k.d;
  }
  const det = h00 * h11 - h01 * h01;
  const da = (h11 * g0 - h01 * g1) / det,
    db = (h00 * g1 - h01 * g0) / det;
  a += da;
  b += db;
  if (Math.abs(da) + Math.abs(db) < 1e-12) break;
}
model.fgIntercept = round(a);
model.fgSlope = round(b);

const out = {
  ...model,
  trainedOn: SEASONS.join(","),
  plays: final.rows,
  fieldGoals: kicks.length,
  kickoffs: kN,
  holdout: { season: HOLDOUT, ...holdout },
};
mkdirSync(join(DATA_DIR, "models"), { recursive: true });
writeFileSync(
  join(DATA_DIR, "models", "ep.json"),
  JSON.stringify(out, null, 2) + "\n",
);
console.log(
  `fit-ep: ${final.rows} plays; kickoff ${model.kickoff}; FG ${model.fgIntercept} + ${model.fgSlope}·d over ${kicks.length} kicks`,
);
for (let d = 0; d < 4; d++)
  console.log(`down ${d + 1}: ${model.field[d]!.map((v) => v.toFixed(2)).join(" ")}`);
