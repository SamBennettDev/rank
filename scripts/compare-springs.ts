/** Current-snapshot policy comparison, not a historical accuracy backtest. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  fitSprings,
  fitSupportedSprings,
  type SpringGame,
} from "../src/engine/springs";
import type { Ranking } from "../src/engine/types";

const year = process.argv[2] ?? "2026";
if (!/^\d{4}$/.test(year)) throw new Error("season must be a year");
const root = resolve(import.meta.dirname, ".."),
  read = (p: string) => readFileSync(resolve(root, p), "utf8");
const index = JSON.parse(read("data/index.json")) as {
  seasons: { season: string; snapshots: { id: string }[] }[];
};
const snapshot = index.seasons
  .find((s) => s.season === year)
  ?.snapshots.at(-1)?.id;
if (!snapshot) throw new Error("no published snapshot");
const r: Ranking = JSON.parse(read(`data/rankings/${year}/${snapshot}.json`));
if (!r.springs) throw new Error("no spring graph");
const all = [...r.teams, ...(r.opponents ?? [])],
  ids = all.map((t) => t.id),
  published = new Set(r.teams.map((t) => t.id)),
  by = new Map(all.map((t) => [t.id, t]));
const games: SpringGame[] = r.springs.map(({ gameId, winner, loser }) => ({
  gameId,
  winner,
  loser,
}));
const gap = r.manifest.springs!.restGap;
const baseline = fitSprings(ids, games, { restGap: gap, oneSided: false });
const best = new Map<number, number>();
for (const e of games)
  best.set(
    e.winner,
    Math.max(best.get(e.winner) ?? -Infinity, baseline.heights.get(e.loser)!),
  );
const bestWinStiffness = (e: SpringGame) =>
  2 **
  (-Math.max(0, best.get(e.winner)! - baseline.heights.get(e.loser)!) / gap);
const variants: { name: string; k: (e: SpringGame) => number }[] = [
  { name: "Exact two-way", k: () => 1 },
  { name: "All stretched pulls at 25%", k: () => 0.25 },
  {
    name: "Opponent-strength pull",
    k: (e) => 0.1 + 0.9 / (1 + Math.exp(-baseline.heights.get(e.loser)! / gap)),
  },
  { name: "Best-win support", k: bestWinStiffness },
  {
    name: "Best-win support, minimum 25%",
    k: (e) => Math.max(0.25, bestWinStiffness(e)),
  },
];
const results = variants.map((v) => {
  const es = games.map((e) => ({ ...e, pullStiffness: v.k(e) }));
  const fit = fitSprings(ids, es, { restGap: gap, oneSided: false });
  const order = all
    .filter((t) => published.has(t.id) && fit.heights.get(t.id) !== null)
    .sort((a, b) => fit.heights.get(b.id)! - fit.heights.get(a.id)!);
  const ranks = new Map(order.map((t, i) => [t.id, i + 1]));
  const georgia = all.find((t) => t.school === "Georgia"),
    alabama = all.find((t) => t.school === "Alabama");
  return {
    name: v.name,
    iterations: fit.iterations,
    maxNetForce: fit.maxNetForce,
    reversed: fit.springs.filter((e) => e.gap < -1e-6).length,
    stiffnessRange: [
      Math.min(...es.map((e) => e.pullStiffness)),
      Math.max(...es.map((e) => e.pullStiffness)),
    ],
    georgiaRank: georgia ? ranks.get(georgia.id) : null,
    alabamaRank: alabama ? ranks.get(alabama.id) : null,
    georgiaWeakPull: georgia
      ? fit.springs
          .filter((e) => e.winner === georgia.id && e.force < 0)
          .map((e) => ({
            opponent: by.get(e.loser)!.school,
            force: e.force,
            k: e.pullStiffness,
          }))
      : [],
    rankings: order.map((t) => ({
      rank: ranks.get(t.id)!,
      team: t.school,
      teamId: t.id,
      wins: t.wins,
      losses: t.losses,
      height: fit.heights.get(t.id)!,
    })),
  };
});
const selected = fitSupportedSprings(ids, games, gap),
  comparison = results.find((v) => v.name === "Best-win support")!;
for (const t of comparison.rankings)
  if (Math.abs(selected.heights.get(t.teamId)! - t.height) > 1e-9)
    throw new Error("supported policy parity failed");
const dir = resolve(root, `research/springs/${year}`);
mkdirSync(dir, { recursive: true });
writeFileSync(
  resolve(dir, "stiffness-comparison.json"),
  JSON.stringify(
    {
      snapshot: r.snapshot,
      reference: "equal two-way springs",
      restGap: gap,
      selected: "Best-win support",
      results,
    },
    null,
    2,
  ) + "\n",
);
writeFileSync(
  resolve(dir, "STIFFNESS_COMPARISON.md"),
  [
    `# ${year} ${r.snapshot.label}: five spring policies`,
    "",
    "All policies use exactly the same current-season games, seven-point target and full compression stiffness. They differ only in stretched-spring pull stiffness. Every variant is reconstructed from raw winner/loser endpoints; weights are frozen before the final fit.",
    "",
    "| Policy | Georgia | Alabama | Reversed game edges | First five |",
    "| --- | --- | --- | --- | --- |",
    ...results.map(
      (v) =>
        `| ${v.name} | ${v.georgiaRank ?? "—"} | ${v.alabamaRank ?? "—"} | ${v.reversed} | ${v.rankings
          .slice(0, 5)
          .map((t) => t.team)
          .join(", ")} |`,
    ),
    "",
    "**Selected rule: best-win support.** If d is how much stronger a winner's best beaten opponent is than this beaten opponent, in the equal-spring reference graph, k = 2^(−max(0,d)/7). Strongest wins retain k = 1. Each seven-point difference halves downward pull stiffness. Compression retains k = 1 for every game, preserving full pressure when a winner is too low.",
    "",
    "A flat 25% pull weakens attraction even on the strongest wins. Absolute opponent-strength weighting depends on the arbitrary zero of a disconnected component. The selected rule directly implements the requested protection when stronger wins exist, and depends only on within-component strength differences. It adds no floor parameter. The 25% floor variant is shown as a sensitivity check.",
    "",
    "These are retrospective ranking-policy comparisons. The policies were inspected on these results; selection is a design judgment matching the request, not evidence of improved future-game accuracy. No neural training or market comparison was performed for these graph variants. The Georgia/Alabama order flips under the alternative 25% floor, so this remains a soft preference, not guaranteed head-to-head priority. Reversal counts cover all supplied games, including supporting opponents.",
    "",
    "[Every policy's full rankings and game-force diagnosis](./stiffness-comparison.json). [Active full Week 6 ranking](./REPORT.md).",
    "",
  ].join("\n"),
);
console.log(
  `spring comparison: ${results.length} policies; active supported fit matches the selected comparison exactly`,
);
