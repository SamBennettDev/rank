import { parseConfig, parseGames, parseTeams } from "./data";
import { buildEdges, listSnapshots } from "./graph";
import { sha256Hex } from "./hash";
import { gridironSprings } from "./gridiron";
import { springRank } from "./springrank";
import type { Edge, EdgeWeight, GridironConfig, Manifest, RankedTeam, Ranking, SeasonConfig, SeasonIndexEntry } from "./types";

/** Bump when anything that changes output bytes changes (formatting, rounding, fields). */
export const ENGINE_VERSION = "rank-engine-5";

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

/** Spring stiffness of one game under the season's weighting. */
export function edgeWeight(e: Pick<Edge, "winnerPoints" | "loserPoints">, weighting: EdgeWeight): number {
  return weighting === "margin" ? e.winnerPoints - e.loserPoints : 1;
}

export interface Solved {
  heights: Float64Array;
  /** gridiron only */
  homeField?: number;
  iterations?: number;
}

/** Ratings for one set of counted games under the season's configured method. */
export function solve(n: number, edges: readonly Edge[], index: ReadonlyMap<number, number>, config: SeasonConfig): Solved {
  if ((config.method ?? "springrank") === "gridiron") {
    const r = gridironSprings(n, edges.map((e) => toFieldGame(e, index)), config.alpha, config.gridiron!);
    return { heights: r.heights, homeField: r.homeField, iterations: r.iterations };
  }
  const weighting = config.edgeWeight ?? "win";
  return {
    heights: springRank(n, edges.map((e) => ({ winner: index.get(e.winner)!, loser: index.get(e.loser)!, weight: edgeWeight(e, weighting) })), config.alpha, config.restLength ?? 1),
  };
}

/** An edge seen from the home side, as the gridiron solver wants it. */
export function toFieldGame(e: Edge, index: ReadonlyMap<number, number>) {
  const home = e.winnerIsHome ? e.winner : e.loser;
  const away = e.winnerIsHome ? e.loser : e.winner;
  return {
    home: index.get(home)!,
    away: index.get(away)!,
    homePoints: e.winnerIsHome ? e.winnerPoints : e.loserPoints,
    awayPoints: e.winnerIsHome ? e.loserPoints : e.winnerPoints,
    neutral: e.neutralSite,
  };
}

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

  const method = config.method ?? "springrank";
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

    const solved = solve(teams.length, edges, index, config);
    const s = solved.heights;
    const heights = new Map(played.map((t) => [t.id, round6(s[index.get(t.id)!]!)]));
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
      };
    });
    ranked.sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.id - b.id);
    previous = new Map(ranked.filter((t) => t.rank !== null).map((t) => [t.id, t.rank!]));

    const manifest: Manifest = {
      engine: ENGINE_VERSION,
      algorithmVersion: config.algorithmVersion,
      method,
      alpha: config.alpha,
      ...(method === "gridiron"
        ? { gridiron: { ...pickGridiron(config.gridiron!), homeFieldPoints: round6(solved.homeField!), iterations: solved.iterations! } }
        : { edgeWeight: config.edgeWeight ?? "win", restLength: config.restLength ?? 1 }),
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

/** Copies the gridiron parameters in a fixed key order. */
function pickGridiron(g: GridironConfig): GridironConfig {
  return { winBonus: g.winBonus, blowoutLimit: g.blowoutLimit, fitHomeField: g.fitHomeField, maxIterations: g.maxIterations };
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
