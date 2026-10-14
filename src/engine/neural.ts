import { expFixed } from "./probability";
import { round6 } from "./model";

export interface NeuralNetwork {
  kind: "rank" | "matchup";
  width: number;
  scale: number[];
  theta: number[];
}
export interface NeuralGroup {
  name: "rich" | "graph" | "robust";
  weight: number;
  featureCount: number;
  components: { temperature: number; networks: NeuralNetwork[] }[];
}
export interface NeuralSnapshot {
  id: string;
  asOf: string;
  gameIds: number[];
  features: number[][];
  gamesPlayed?: number[];
  losses?: number[];
  externalLosses?: number[];
  recordGamesPlayed?: number[];
}
export interface NeuralPolicy {
  evidencePrior: number;
  lossPenalty: number;
  lossPrior: number;
  inputClip: number;
  anchorScale: number;
  residualLimit: number;
  scoreMarginCap: number;
}
export interface NeuralBundle {
  schema: 1 | 2;
  model: "season-only-rich-graph-v1" | "season-only-robust-loss-v2";
  policy?: NeuralPolicy;
  year: number;
  trainingYears: number[];
  teamIds: number[];
  source: {
    teamsSha256: string;
    gamesSha256: string;
    playsSha256: string;
    richSha256: string;
    richModelSha256?: string;
    graphModelSha256?: string;
    robustModelSha256?: string;
    calibrationSha256?: string;
    featureCode: Record<string, string>;
  };
  featureNames: string[];
  groups: NeuralGroup[];
  snapshots: NeuralSnapshot[];
}

const sigmoid = (x: number) => 1 / (1 + expFixed(-x));
const tanh = (x: number) => {
  const e = expFixed(-2 * Math.abs(x));
  return ((x < 0 ? -1 : 1) * (1 - e)) / (1 + e);
};

/** Compile shared per-team transforms once. For a matchup network, factor its
 * difference/context projection into two team projections. Every pair then
 * needs only the hidden activations, instead of another feature-matrix product.
 */
function compile(
  net: NeuralNetwork,
  rows: readonly number[][],
  featureCount: number,
  policy?: NeuralPolicy,
  snapshot?: NeuralSnapshot,
) {
  const d = net.scale.length,
    k = net.width,
    dim = net.kind === "matchup" ? 2 * d : d;
  if (
    !["rank", "matchup"].includes(net.kind) ||
    d !== featureCount ||
    !Number.isInteger(k) ||
    k < 1 ||
    net.theta.length !== dim + dim * k + 2 * k + 1 ||
    net.scale.some((v) => !Number.isFinite(v) || v <= 0) ||
    net.theta.some((v) => !Number.isFinite(v))
  )
    throw new Error("invalid neural weights");
  const b0 = dim + dim * k,
    out0 = b0 + k,
    home = net.theta.at(-1)!;
  const linear = new Float64Array(rows.length);
  const positive = rows.map(() => new Float64Array(k));
  const negative = rows.map(() => new Float64Array(k));
  for (let t = 0; t < rows.length; t++) {
    const clip = policy?.inputClip ?? 8;
    const x = rows[t]!.slice(0, d).map((v, j) =>
      Math.max(-clip, Math.min(clip, v / net.scale[j]!)),
    );
    if (net.kind === "rank") {
      let score = 0;
      for (let j = 0; j < d; j++) score += x[j]! * net.theta[j]!;
      for (let h = 0; h < k; h++) {
        let z = net.theta[b0 + h]!;
        for (let j = 0; j < d; j++) z += x[j]! * net.theta[dim + j * k + h]!;
        score += (policy ? 1 : x[20]! * net.scale[20]!) * tanh(z) * net.theta[out0 + h]!;
      }
      if (policy) {
        const games = snapshot!.gamesPlayed![t]!, losses = snapshot!.losses![t]! + snapshot!.externalLosses![t]!;
        score = (games / (games + policy.evidencePrior)) *
          (rows[t]![1]! / policy.anchorScale + policy.residualLimit * tanh(score)) -
          policy.lossPenalty * losses / (games + policy.lossPrior);
      }
      linear[t] = score;
    } else {
      for (let j = 0; j < d; j++) {
        linear[t]! += x[j]! * net.theta[j]!;
        for (let h = 0; h < k; h++) {
          const diff = net.theta[dim + j * k + h]!,
            context = net.theta[dim + (d + j) * k + h]!;
          positive[t]![h]! += x[j]! * (diff + 0.5 * context);
          negative[t]![h]! += x[j]! * (-diff + 0.5 * context);
        }
      }
    }
  }
  const predict = (h: number, a: number, venue: number) => {
    let z = linear[h]! - linear[a]! + home * venue;
    if (net.kind === "matchup")
      for (let j = 0; j < k; j++)
        z +=
          0.5 *
          net.theta[out0 + j]! *
          (tanh(positive[h]![j]! + negative[a]![j]! + net.theta[b0 + j]!) -
            tanh(positive[a]![j]! + negative[h]![j]! + net.theta[b0 + j]!));
    return z;
  };
  return Object.assign(predict, { strengths: linear });
}

export function validateNeuralBundle(value: unknown): NeuralBundle {
  const b = value as NeuralBundle;
  if (
    !b ||
    !((b.schema === 1 && b.model === "season-only-rich-graph-v1" && b.policy === undefined) ||
      (b.schema === 2 && b.model === "season-only-robust-loss-v2")) ||
    !Number.isInteger(b.year) ||
    !Array.isArray(b.trainingYears) ||
    !b.trainingYears.length ||
    b.trainingYears.some((y) => !Number.isInteger(y) || y >= b.year) ||
    !Array.isArray(b.teamIds) ||
    new Set(b.teamIds).size !== b.teamIds.length ||
    b.teamIds.some((id) => !Number.isInteger(id) || id <= 0) ||
    !Array.isArray(b.featureNames) ||
    b.featureNames.length !== (b.schema === 2 ? 50 : 152) ||
    !Array.isArray(b.groups) ||
    (b.schema === 1 ?
      (b.groups.length !== 2 || b.groups[0]?.name !== "rich" ||
       b.groups[0]?.weight !== 0.75 || b.groups[0]?.featureCount !== 64 ||
       b.groups[1]?.name !== "graph" || b.groups[1]?.weight !== 0.25 ||
       b.groups[1]?.featureCount !== 152) :
      (b.groups.length !== 1 || b.groups[0]?.name !== "robust" ||
       b.groups[0]?.weight !== 1 || b.groups[0]?.featureCount !== 50 ||
       !b.policy || b.policy.scoreMarginCap !== 35 || ![b.policy.evidencePrior,b.policy.lossPenalty,b.policy.lossPrior,b.policy.inputClip,b.policy.anchorScale,b.policy.residualLimit].every(v => Number.isFinite(v) && v > 0))) ||
    !Array.isArray(b.snapshots) ||
    new Set(b.snapshots.map((s) => s.id)).size !== b.snapshots.length
  )
    throw new Error("invalid neural bundle");
  for (const group of b.groups) {
    if (!Array.isArray(group.components) || !group.components.length)
      throw new Error("missing neural components");
    for (const c of group.components)
      if (
        !(c.temperature > 0) ||
        !Number.isFinite(c.temperature) ||
        !Array.isArray(c.networks) ||
        !c.networks.length
      )
        throw new Error("invalid neural calibration");
    if (b.schema === 2 && (group.components.length !== 1 || group.components.some(c => c.networks.length !== 3 || c.networks.some(n => n.kind !== "rank"))))
      throw new Error("invalid robust neural architecture");
  }
  for (const s of b.snapshots)
    if (
      !Number.isFinite(Date.parse(s.asOf)) ||
      !Array.isArray(s.features) ||
      s.features.length !== b.teamIds.length ||
      s.features.some(
        (r) =>
          !Array.isArray(r) ||
          r.length !== b.featureNames.length ||
          r.some((v) => !Number.isFinite(v)),
      ) ||
      !Array.isArray(s.gameIds) ||
      new Set(s.gameIds).size !== s.gameIds.length ||
      (b.schema === 2 && (!Array.isArray(s.gamesPlayed) || !Array.isArray(s.losses) ||
       s.gamesPlayed.length !== b.teamIds.length || s.losses.length !== b.teamIds.length ||
       !Array.isArray(s.externalLosses) || s.externalLosses.length !== b.teamIds.length ||
       !Array.isArray(s.recordGamesPlayed) || s.recordGamesPlayed.length !== b.teamIds.length ||
       s.gamesPlayed.some((v,i) => !Number.isInteger(v) || v < 0 ||
         !Number.isInteger(s.losses![i]) || s.losses![i]! < 0 || s.losses![i]! > v ||
         !Number.isInteger(s.externalLosses![i]) || s.externalLosses![i]! < 0 ||
         !Number.isInteger(s.recordGamesPlayed![i]) || s.recordGamesPlayed![i]! < v ||
         s.losses![i]! + s.externalLosses![i]! > s.recordGamesPlayed![i]!)))
    )
      throw new Error("invalid neural snapshot");
  return b;
}

export function neuralPredictor(
  bundle: NeuralBundle,
  snapshot: NeuralSnapshot,
  includeMatrix = true,
) {
  const groups = bundle.groups.map((g) => ({
    ...g,
    compiled: g.components.map((c) => ({
      temperature: c.temperature,
      nets: c.networks.map((n) =>
        compile(n, snapshot.features, g.featureCount, bundle.policy, snapshot),
      ),
    })),
  }));
  const components = (home: number, away: number, venue = 0) => {
    if (
      !Number.isInteger(home) ||
      !Number.isInteger(away) ||
      home < 0 ||
      away < 0 ||
      home >= bundle.teamIds.length ||
      away >= bundle.teamIds.length ||
      ![-1, 0, 1].includes(venue)
    )
      throw new Error("invalid neural matchup");
    return groups.map((g) => {
      let z = 0;
      for (const c of g.compiled)
        z +=
          (c.temperature *
            c.nets.reduce((s, net) => s + net(home, away, venue), 0)) /
          c.nets.length;
      return sigmoid(z / g.compiled.length);
    });
  };
  const probability = (home: number, away: number, venue = 0) =>
    components(home, away, venue).reduce(
      (s, p, j) => s + p * groups[j]!.weight,
      0,
    );
  if (!includeMatrix)
    return { probability, matrix: [], groupScores: [], scores: [], rankRanges: [] as { low: number; high: number }[] };
  const n = bundle.teamIds.length,
    matrix = Array.from({ length: n }, () => new Float64Array(n));
  const groupScores = groups.map(() => new Float64Array(n).fill(0.5));
  for (let i = 0; i < n; i++) {
    matrix[i]![i] = 0.5;
    for (let j = i + 1; j < n; j++) {
      const ps = components(i, j),
        p = ps.reduce((sum, p, k) => sum + p * groups[k]!.weight, 0);
      matrix[i]![j] = p;
      matrix[j]![i] = 1 - p;
      for (let k = 0; k < ps.length; k++) {
        groupScores[k]![i]! += ps[k]!;
        groupScores[k]![j]! += 1 - ps[k]!;
      }
    }
  }
  const rankRanges = bundle.policy ? bundle.teamIds.map(() => ({low: n, high: 1})) : [];
  if (bundle.policy) {
    for (const net of groups[0]!.compiled[0]!.nets) {
      const played = bundle.teamIds.map((_,i) => i).filter(i => snapshot.recordGamesPlayed![i]! > 0);
      for (const i of played) {
        const rank = 1 + played.filter(j => net.strengths[j]! > net.strengths[i]! + 1e-10).length;
        rankRanges[i]!.low = Math.min(rankRanges[i]!.low, rank);
        rankRanges[i]!.high = Math.max(rankRanges[i]!.high, rank);
      }
    }
  }
  return {
    probability,
    matrix,
    groupScores: groupScores.map((r) => Array.from(r, (v) => v / n)),
    scores: matrix.map((r) => r.reduce((s, p) => s + p, 0) / n),
    rankRanges,
  };
}

/** Weighted tournament ordering: maximize sum P(upper-ranked beats lower-ranked).
 * Start with expected round-robin wins, then apply deterministic best improving
 * insertion moves. This is a local optimum, not a claim of an exact global solve.
 */
export function consensusOrder(
  matrix: readonly Float64Array[],
  ids: readonly number[],
  eligible: readonly number[],
) {
  const order = [...eligible].sort(
    (a, b) =>
      matrix[b]!.reduce((s, p) => s + p, 0) -
        matrix[a]!.reduce((s, p) => s + p, 0) || ids[a]! - ids[b]!,
  );
  const objective = (list: number[]) => {
    let sum = 0;
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++)
        sum += matrix[list[i]!]![list[j]!]!;
    return sum;
  };
  const initialObjective = objective(order);
  let moves = 0;
  for (;;) {
    let best = 1e-10,
      from = -1,
      to = -1;
    for (let i = 0; i < order.length; i++) {
      const team = order[i]!;
      let gain = 0;
      for (let j = i - 1; j >= 0; j--) {
        gain += 2 * matrix[team]![order[j]!]! - 1;
        if (gain > best + 1e-12) {
          best = gain;
          from = i;
          to = j;
        }
      }
      gain = 0;
      for (let j = i + 1; j < order.length; j++) {
        gain += 1 - 2 * matrix[team]![order[j]!]!;
        if (gain > best + 1e-12) {
          best = gain;
          from = i;
          to = j;
        }
      }
    }
    if (from < 0) break;
    const [team] = order.splice(from, 1);
    order.splice(to, 0, team!);
    moves++;
  }
  const ranks = new Array<number | null>(ids.length).fill(null);
  let previous = -1,
    rank = 0,
    disagreements = 0;
  for (let i = 0; i < order.length; i++) {
    const t = order[i]!;
    const identical =
      previous >= 0 &&
      matrix[t]!.every((p, j) => Math.abs(p - matrix[previous]![j]!) < 1e-10);
    if (!identical) rank = i + 1;
    ranks[t] = rank;
    previous = t;
    for (let j = i + 1; j < order.length; j++)
      if (matrix[t]![order[j]!]! < 0.5 - 1e-10) disagreements++;
  }
  return {
    order,
    ranks,
    moves,
    initialObjective: round6(initialObjective),
    objective: round6(objective(order)),
    disagreements,
  };
}
