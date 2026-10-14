import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  neuralPredictor,
  validateNeuralBundle,
  consensusOrder,
} from "../src/engine/neural";
import { toCsv } from "../src/engine/csv";
import type { Ranking } from "../src/engine/types";

const year = process.argv[2] ?? "2026";
if (!/^\d{4}$/.test(year)) throw new Error("season must be a year");
const root = resolve(import.meta.dirname, "..");
const bundle = validateNeuralBundle(
  JSON.parse(
    readFileSync(resolve(root, `data/seasons/${year}/neural.json`), "utf8"),
  ),
);
const snapshot = bundle.snapshots.at(-1)!;
const ranking: Ranking = JSON.parse(
  readFileSync(
    resolve(root, `data/rankings/${year}/${snapshot.id}.json`),
    "utf8",
  ),
);
const byId = new Map(ranking.teams.map((t) => [t.id, t]));
const p = neuralPredictor(bundle, snapshot);
const eligible = bundle.teamIds.flatMap((id, i) =>
  byId.get(id)?.rank != null ? [i] : [],
);
const ordered = consensusOrder(p.matrix, bundle.teamIds, eligible);
const directory = resolve(root, "research/season_only/production");
mkdirSync(directory, { recursive: true });
const prefix = `${year}-${snapshot.id}`;
writeFileSync(
  resolve(directory, `${prefix}-rankings.csv`),
  toCsv(
    [
      "rank",
      "team_id",
      "team",
      "wins",
      "losses",
      "average_neutral_win_probability",
      "rich_probability",
      "graph_probability",
    ],
    ranking.teams
      .filter((t) => t.rank !== null)
      .map((t) => [
        t.rank,
        t.id,
        t.school,
        t.wins,
        t.losses,
        t.neural!.roundRobinWinProbability,
        t.neural!.richWinProbability,
        t.neural!.graphWinProbability,
      ]),
  ),
);
const pairs: (string | number | boolean | null)[][] = [];
for (let i = 0; i < ordered.order.length; i++)
  for (let j = i + 1; j < ordered.order.length; j++) {
    const a = ordered.order[i]!,
      b = ordered.order[j]!,
      upper = byId.get(bundle.teamIds[a]!)!,
      lower = byId.get(bundle.teamIds[b]!)!;
    pairs.push([
      upper.rank,
      upper.school,
      lower.rank,
      lower.school,
      p.matrix[a]![b]!,
      p.matrix[a]![b]! >= 0.5,
    ]);
  }
writeFileSync(
  resolve(directory, `${prefix}-head-to-head.csv`),
  toCsv(
    [
      "higher_rank",
      "higher_team",
      "lower_rank",
      "lower_team",
      "higher_team_neutral_win_probability",
      "ordering_agrees_with_favorite",
    ],
    pairs,
  ),
);
const audit = {
  model: ranking.manifest.neural,
  asOf: snapshot.asOf,
  teams: eligible.length,
  pairs: pairs.length,
  diagnostic:
    "Ordering agreement is not winner-prediction accuracy. Greedy insertion reaches a local optimum, not a certified global optimum.",
  orderingMoves: ordered.moves,
  initialObjective: ordered.initialObjective,
  objective: ordered.objective,
  disagreements: ordered.disagreements,
  conflictingPairs: pairs
    .filter((r) => r[5] === false)
    .map((r) => ({
      higherRank: r[0],
      higherTeam: r[1],
      lowerRank: r[2],
      lowerTeam: r[3],
      higherWinProbability: r[4],
    })),
};
writeFileSync(
  resolve(directory, `${prefix}-audit.json`),
  JSON.stringify(audit, null, 2) + "\n",
);
console.log(
  `neural audit: ${eligible.length} teams, ${pairs.length} head-to-head pairs, ${ordered.disagreements} pairwise disagreements`,
);
