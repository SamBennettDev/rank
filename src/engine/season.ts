import { parseConfig, parseGames, parsePlays, parseTeams } from "./data";
import { buildEdges, listSnapshots } from "./graph";
import { sha256Hex } from "./hash";
import { closeHeadToHead } from "./headtohead";
import type { RatedGame } from "./rating";
import type { Edge, Manifest, RankedTeam, Ranking, SeasonIndexEntry } from "./types";
import { fitUnits } from "./units";

/** Bump when anything that changes output bytes changes (formatting, rounding, fields). */
export const ENGINE_VERSION = "rank-engine-9";

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

export interface SeasonFiles {
  season: string;
  teamsCsv: string;
  gamesCsv: string;
  /** Play-by-play summary (plays.csv); without it there are no unit ratings. */
  playsCsv?: string;
}

export interface SeasonInput extends SeasonFiles {
  configJson: string;
}

export interface SeasonOutput {
  /** Serialized ranking files, keyed by snapshot id (file name is `${id}.json`). */
  files: { id: string; json: string }[];
  index: SeasonIndexEntry;
}

/** Edges as rated games, from the home team's side. */
function rated(edges: readonly Edge[], index: Map<number, number>): RatedGame[] {
  return edges.map((e) => {
    const home = e.winnerIsHome ? e.winner : e.loser;
    const away = e.winnerIsHome ? e.loser : e.winner;
    const diff = e.winnerPoints - e.loserPoints;
    return { home: index.get(home)!, away: index.get(away)!, margin: e.winnerIsHome ? diff : -diff, neutral: e.neutralSite };
  });
}

/**
 * The whole pipeline: CSV bytes in, ranking JSON out. The Node scripts and the
 * in-browser "Recompute" button both call exactly this function.
 */
export async function computeSeason(
  input: SeasonInput,
  /** Called after each ranking file; the browser uses it to show progress and stay responsive. */
  onProgress?: (done: number, total: number) => void | Promise<void>,
): Promise<SeasonOutput> {
  const teams = parseTeams(input.teamsCsv).sort((a, b) => a.id - b.id);
  const games = parseGames(input.gamesCsv);
  const config = parseConfig(input.configJson);
  const teamsSha256 = await sha256Hex(input.teamsCsv);
  const gamesSha256 = await sha256Hex(input.gamesCsv);
  const playsSha256 = input.playsCsv === undefined ? null : await sha256Hex(input.playsCsv);
  const plays = input.playsCsv === undefined ? null : parsePlays(input.playsCsv);

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

    const { ratings, homeField, held: isHeld } = closeHeadToHead(teams.length, rated(edges, index), { winBonus: config.winBonus, shrink: config.shrink }, config.headToHeadWindow);
    const held = edges.filter((_, i) => isHeld[i]).map((e) => e.gameId);
    const units = plays ? fitUnits(teams.length, index, edges, plays, config.shrink) : null;
    const unit = (v: number | null | undefined) => (v === null || v === undefined ? null : round6(v));
    const heights = new Map(played.map((t) => [t.id, round6(ratings[index.get(t.id)!]!)]));
    const sortedHeights = [...heights.values()].sort((a, b) => b - a);

    const ranked: RankedTeam[] = teams.map((t, i) => {
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
        offense: unit(units?.offense[i]),
        defense: unit(units?.defense[i]),
        special: unit(units?.special[i]),
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
      winBonus: config.winBonus,
      shrink: config.shrink,
      headToHeadWindow: config.headToHeadWindow,
      homeField: round6(homeField),
      classifications: config.classifications,
      teamsSha256,
      gamesSha256,
      playsSha256,
      snapsPerGame: units ? round6(units.snapsPerGame) : null,
      counts,
    };
    files.push({ id: snap.id, json: formatRanking({ schema: 1, season: input.season, snapshot: snap, manifest, held, teams: ranked }) });
    await onProgress?.(files.length, snapshots.length);
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
    `  "held": ${JSON.stringify(r.held)},`,
    '  "teams": [',
    ...r.teams.map((t, i) => `    ${JSON.stringify(t)}${i < r.teams.length - 1 ? "," : ""}`),
    "  ]",
    "}",
  ];
  return lines.join("\n") + "\n";
}
