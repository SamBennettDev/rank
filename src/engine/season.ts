import { parseConfig, parseGames, parseTeams } from "./data";
import { buildEdges, listSnapshots } from "./graph";
import { sha256Hex } from "./hash";
import { layoutX } from "./layout";
import { springRank } from "./springrank";
import type { Manifest, RankedTeam, Ranking, SeasonIndexEntry } from "./types";

/** Bump when anything that changes output bytes changes (formatting, rounding, layout). */
export const ENGINE_VERSION = "rank-engine-1";

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

export interface SeasonInput {
  season: string;
  teamsCsv: string;
  gamesCsv: string;
  configJson: string;
}

export interface SeasonOutput {
  /** Serialized ranking files, keyed by snapshot id (file name is `${id}.json`). */
  files: { id: string; json: string }[];
  index: SeasonIndexEntry;
}

/**
 * The whole pipeline: CSV bytes in, ranking JSON out. The Node scripts and the
 * in-browser "Recompute" button both call exactly this function.
 */
export async function computeSeason(input: SeasonInput): Promise<SeasonOutput> {
  const teams = parseTeams(input.teamsCsv).sort((a, b) => a.id - b.id);
  const games = parseGames(input.gamesCsv);
  const config = parseConfig(input.configJson);
  const teamsSha256 = await sha256Hex(input.teamsCsv);
  const gamesSha256 = await sha256Hex(input.gamesCsv);

  const index = new Map(teams.map((t, i) => [t.id, i]));
  const files: SeasonOutput["files"] = [];
  const snapshots = listSnapshots(games);
  let previous = new Map<number, number>();

  for (const snap of snapshots) {
    const { edges, counts } = buildEdges(games, teams, snap);
    const wins = new Map<number, number>();
    const losses = new Map<number, number>();
    for (const e of edges) {
      wins.set(e.winner, (wins.get(e.winner) ?? 0) + 1);
      losses.set(e.loser, (losses.get(e.loser) ?? 0) + 1);
    }
    const played = teams.filter((t) => wins.has(t.id) || losses.has(t.id));

    const s = springRank(
      teams.length,
      edges.map((e) => ({ winner: index.get(e.winner)!, loser: index.get(e.loser)! })),
      config.alpha,
    );
    const heights = new Map(played.map((t) => [t.id, round6(s[index.get(t.id)!]!)]));
    const xs = heights.size > 0 ? layoutX(heights, new Map(teams.map((t) => [t.id, t.conference]))) : new Map<number, number>();
    const sortedHeights = [...heights.values()].sort((a, b) => b - a);

    const ranked: RankedTeam[] = teams.map((t) => {
      const height = heights.get(t.id) ?? null;
      const rank = height === null ? null : sortedHeights.findIndex((h) => h === height) + 1;
      const prev = previous.get(t.id);
      return {
        id: t.id,
        school: t.school,
        abbreviation: t.abbreviation,
        conference: t.conference,
        classification: t.classification,
        rank,
        tied: height !== null && sortedHeights.filter((h) => h === height).length > 1,
        height,
        wins: wins.get(t.id) ?? 0,
        losses: losses.get(t.id) ?? 0,
        change: rank !== null && prev !== undefined ? prev - rank : null,
        x: xs.get(t.id) ?? null,
      };
    });
    ranked.sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.id - b.id);
    previous = new Map(ranked.filter((t) => t.rank !== null).map((t) => [t.id, t.rank!]));

    const manifest: Manifest = {
      engine: ENGINE_VERSION,
      algorithmVersion: config.algorithmVersion,
      alpha: config.alpha,
      classifications: config.classifications,
      teamsSha256,
      gamesSha256,
      counts,
    };
    files.push({ id: snap.id, json: formatRanking({ schema: 1, season: input.season, snapshot: snap, manifest, teams: ranked }) });
  }

  return {
    files,
    index: {
      season: input.season,
      label: config.label,
      demo: config.demo,
      snapshots: snapshots.map((s) => ({ id: s.id, label: s.label })),
    },
  };
}

/** Fixed key order, one team per line, so git diffs of published rankings stay readable. */
export function formatRanking(r: Ranking): string {
  const indent = (s: string) => s.split("\n").map((l, i) => (i === 0 ? l : "  " + l)).join("\n");
  const lines = [
    "{",
    `  "schema": ${r.schema},`,
    `  "season": ${JSON.stringify(r.season)},`,
    `  "snapshot": ${JSON.stringify(r.snapshot)},`,
    `  "manifest": ${indent(JSON.stringify(r.manifest, null, 2))},`,
    '  "teams": [',
    ...r.teams.map((t, i) => `    ${JSON.stringify(t)}${i < r.teams.length - 1 ? "," : ""}`),
    "  ]",
    "}",
  ];
  return lines.join("\n") + "\n";
}
