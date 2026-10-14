import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { toCsv } from "../src/engine/csv";
import { parseGames } from "../src/engine/data";
import { buildEdges } from "../src/engine/graph";
import { SPRING_TOLERANCE } from "../src/engine/springs";
import type { Ranking } from "../src/engine/types";

const year = process.argv[2] ?? "2026";
if (!/^\d{4}$/.test(year)) throw new Error("season must be a year");
const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const games = parseGames(read(`data/seasons/${year}/games.csv`));
const entry = (
  JSON.parse(read("data/index.json")) as {
    seasons: { season: string; snapshots: { id: string }[] }[];
  }
).seasons.find((s) => s.season === year)!;
if (!entry) throw new Error("unpublished season");
const audits = [];
let latest: Ranking | undefined;
for (const snapshot of entry.snapshots) {
  const r: Ranking = JSON.parse(
    read(`data/rankings/${year}/${snapshot.id}.json`),
  );
  if (!r.manifest.springs || !r.springs)
    throw new Error("not a spring ranking");
  const all = [...r.teams, ...(r.opponents ?? [])],
    byId = new Map(all.map((t) => [t.id, t]));
  if (byId.size !== all.length) throw new Error("duplicate published node");
  const { edges } = buildEdges(games, all, r.snapshot);
  if (
    edges.length !== r.springs.length ||
    edges.some((e, i) => e.gameId !== r.springs![i]!.gameId)
  )
    throw new Error("missing or duplicated game springs");
  const force = new Map(all.map((t) => [t.id, 0])),
    groups = new Map<number, number[]>();
  let energy = 0;
  for (const e of edges) {
    const compression = Math.max(
      0,
      1 - byId.get(e.winner)!.height! + byId.get(e.loser)!.height!,
    );
    force.set(e.winner, force.get(e.winner)! + compression);
    force.set(e.loser, force.get(e.loser)! - compression);
    energy += 0.5 * compression ** 2;
  }
  for (const t of all) {
    if (
      t.wins !== edges.filter((e) => e.winner === t.id).length ||
      t.losses !== edges.filter((e) => e.loser === t.id).length
    )
      throw new Error(`record mismatch: ${t.school}`);
    if (
      t.rank !== null &&
      t.rank !==
        1 +
          r.teams.filter((o) => o.height !== null && o.height > t.height!)
            .length
    )
      throw new Error(`rank/tie mismatch: ${t.school}`);
    if (t.component !== null)
      (
        groups.get(t.component) ?? groups.set(t.component, []).get(t.component)!
      ).push(t.height!);
  }
  const maxNetForceFromRoundedHeights = Math.max(
    ...[...force.values()].map(Math.abs),
  );
  const largestAbsoluteComponentMean = Math.max(
    0,
    ...[...groups.values()].map((h) =>
      Math.abs(h.reduce((a, b) => a + b, 0) / h.length),
    ),
  );
  if (
    maxNetForceFromRoundedHeights > 2e-5 ||
    largestAbsoluteComponentMean > 1e-6 ||
    Math.abs(energy - r.manifest.springs.energy) > 1e-7 ||
    r.manifest.springs.maxNetForce > SPRING_TOLERANCE
  )
    throw new Error("spring equilibrium audit failed");
  audits.push({
    snapshot: r.snapshot,
    ranked: r.teams.filter((t) => t.rank !== null).length,
    supporting: all.length - r.teams.length,
    games: edges.length,
    ...r.manifest.springs,
    maxNetForceFromRoundedHeights,
    largestAbsoluteComponentMean,
    energyFromRoundedHeights: energy,
  });
  latest = r;
}
if (!latest) throw new Error("no snapshots");
const directory = resolve(root, `research/springs/${year}`);
mkdirSync(directory, { recursive: true });
writeFileSync(
  resolve(directory, "audit.json"),
  JSON.stringify({ method: "one-sided-springs-v1", audits }, null, 2) + "\n",
);
writeFileSync(
  resolve(directory, `${latest.snapshot.id}-rankings.csv`),
  toCsv(
    [
      "rank",
      "tied",
      "team_id",
      "team",
      "wins",
      "losses",
      "height",
      "component",
    ],
    latest.teams.map((t) => [
      t.rank,
      t.tied,
      t.id,
      t.school,
      t.wins,
      t.losses,
      t.height,
      t.component,
    ]),
  ),
);
writeFileSync(
  resolve(directory, "REPORT.md"),
  [
    `# ${year} raw one-sided spring graph`,
    "",
    `Through ${latest.snapshot.label}, cutoff ${latest.snapshot.asOf}. ${latest.manifest.counts.included} completed non-tied games connect ${latest.teams.length} published FBS/FCS teams and ${latest.opponents?.length ?? 0} supporting opponents.`,
    "",
    "Every game has equal weight and a desired winner–loser gap of one unit. Minimize half the sum of squared positive shortfalls. All nodes start at zero; simultaneous spring forces settle the graph. Every connected group is then centered at zero. Score margin, site, historical seasons, neural weights and division priors are unused.",
    "",
    `${latest.manifest.springs!.compressedGames} springs remain compressed: ${latest.manifest.springs!.reversedGames} winners are below their losers and ${latest.manifest.springs!.tiedGames} are level (1e-6 display tolerance). Cycles cannot all be satisfied. Equal published heights share a competition rank.`,
    "",
    "This is a results-constraint ranking. It does not supply calibrated probabilities or establish an accuracy advantage over a neural model or betting market. Slack springs can admit multiple equilibria; the documented zero-start relaxation fixes a reproducible solution. Disconnected groups cannot be compared from games alone. Long chains can create large heights, and no extra win reward applies once a spring is slack.",
    "",
    "| Rank | Team | Record | Height |",
    "| --- | --- | --- | --- |",
    ...latest.teams
      .filter((t) => t.rank !== null && t.rank <= 25)
      .map(
        (t) =>
          `| ${t.tied ? "T-" : ""}${t.rank} | ${t.school} | ${t.wins}–${t.losses} | ${t.height!.toFixed(6)} |`,
      ),
    "",
    "Full field: [CSV](./" +
      latest.snapshot.id +
      "-rankings.csv). [Every snapshot audit](./audit.json). [Math, normalization and limits](../../../docs/METHODOLOGY.md).",
    "",
    "The audit reconstructs each edge, record, rank, component mean, spring force and energy from the published heights. The full-precision stopping tolerance is 1e-10; rounding to six decimals introduces a small auditable residual. `npm run verify` separately recomputes the exact serialized files from raw input.",
    "",
  ].join("\n"),
);
console.log(
  `spring audit: ${audits.length} snapshots; ${latest.manifest.counts.included} game edges, unique nodes, records, ties, normalized heights and equilibrium checks passed`,
);
