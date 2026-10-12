import { parseConfig, parseGames, parsePlays, parseTeams } from "./data";
import { buildEdges, listSnapshots } from "./graph";
import { sha256Hex } from "./hash";
import { type RatedGame, fitRatings } from "./rating";
import type { Edge, Manifest, RankedTeam, Ranking, SeasonConfig, SeasonIndexEntry, Team } from "./types";
import { type UnitStart, fitUnits } from "./units";

/** Bump when anything that changes output bytes changes (formatting, rounding, fields). */
export const ENGINE_VERSION = "rank-engine-6";

/**
 * Last season's final ratings are fitted with no prior, only this tiny pull toward 0
 * (in games' worth) so the answer is unique even for teams with few links.
 */
export const LAST_SEASON_RIDGE = 0.01;

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
  /** Last season's CSVs, for the starting ratings. Without them every team starts at 0. */
  previous?: SeasonFiles;
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
 * Each team's starting rating: carryover × its final rating last season (all of last
 * season's games, centred so the average FBS team is 0). A team that was not in last
 * season's data starts at the average for its classification.
 */
function startingRatings(teams: readonly Team[], config: SeasonConfig, previous: SeasonFiles | undefined): Float64Array {
  const prior = new Float64Array(teams.length);
  if (!previous) return prior;
  const prevTeams = parseTeams(previous.teamsCsv).filter((t) => config.classifications.includes(t.classification)).sort((a, b) => a.id - b.id);
  const prevIndex = new Map(prevTeams.map((t, i) => [t.id, i]));
  const prevGames = parseGames(previous.gamesCsv);
  const { edges } = buildEdges(prevGames, prevTeams, { id: "final", label: "Final", throughWeek: Number.MAX_SAFE_INTEGER, includePostseason: true });
  const { ratings } = fitRatings(prevTeams.length, rated(edges, prevIndex), {
    winBonus: config.winBonus,
    prior: new Float64Array(prevTeams.length),
    priorWeight: LAST_SEASON_RIDGE,
  });
  const fbs = prevTeams.map((t, i) => (t.classification === "fbs" ? ratings[i]! : NaN)).filter((v) => !Number.isNaN(v));
  const centre = fbs.length > 0 ? fbs.reduce((a, b) => a + b, 0) / fbs.length : 0;
  const last = teams.map((t) => (prevIndex.has(t.id) ? ratings[prevIndex.get(t.id)!]! - centre : null));
  for (const cls of [...new Set(teams.map((t) => t.classification))].sort()) {
    const known = teams.flatMap((t, i) => (t.classification === cls && last[i] !== null ? [last[i]!] : []));
    const fill = known.length > 0 ? known.reduce((a, b) => a + b, 0) / known.length : 0;
    teams.forEach((t, i) => {
      if (t.classification === cls) prior[i] = config.carryover * (last[i] ?? fill);
    });
  }
  return prior;
}

/** Last season's final unit ratings (offense and defense per snap), centred on the FBS average, times carryover. */
function startingUnits(teams: readonly Team[], config: SeasonConfig, previous: SeasonFiles | undefined): UnitStart {
  const zero = () => new Float64Array(teams.length);
  const start: UnitStart = { offense: zero(), defense: zero(), special: zero() };
  if (!previous?.playsCsv) return start;
  const prevTeams = parseTeams(previous.teamsCsv).filter((t) => config.classifications.includes(t.classification)).sort((a, b) => a.id - b.id);
  const prevIndex = new Map(prevTeams.map((t, i) => [t.id, i]));
  const { edges } = buildEdges(parseGames(previous.gamesCsv), prevTeams, { id: "final", label: "Final", throughWeek: Number.MAX_SAFE_INTEGER, includePostseason: true });
  const z = () => new Float64Array(prevTeams.length);
  const u = fitUnits(prevTeams.length, prevIndex, edges, parsePlays(previous.playsCsv), { offense: z(), defense: z(), special: z() }, LAST_SEASON_RIDGE);
  const units = [[u.offense, start.offense, u.snapsPerGame], [u.defense, start.defense, u.snapsPerGame], [u.special, start.special, 1]] as const;
  for (const [values, into, perSnap] of units) {
    const fbs = prevTeams.flatMap((t, i) => (t.classification === "fbs" && values[i] !== null ? [values[i]!] : []));
    const centre = fbs.length > 0 ? fbs.reduce((a, b) => a + b, 0) / fbs.length : 0;
    const last = teams.map((t) => {
      const v = prevIndex.has(t.id) ? values[prevIndex.get(t.id)!] : null;
      return v === null || v === undefined ? null : (v - centre) / perSnap;
    });
    for (const cls of [...new Set(teams.map((t) => t.classification))].sort()) {
      const known = teams.flatMap((t, i) => (t.classification === cls && last[i] !== null ? [last[i]!] : []));
      const fill = known.length > 0 ? known.reduce((a, b) => a + b, 0) / known.length : 0;
      teams.forEach((t, i) => {
        if (t.classification === cls) into[i] = config.carryover * (last[i] ?? fill);
      });
    }
  }
  return start;
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
  const priorSeason = input.previous
    ? {
        season: input.previous.season,
        teamsSha256: await sha256Hex(input.previous.teamsCsv),
        gamesSha256: await sha256Hex(input.previous.gamesCsv),
        playsSha256: input.previous.playsCsv === undefined ? null : await sha256Hex(input.previous.playsCsv),
      }
    : null;
  const plays = input.playsCsv === undefined ? null : parsePlays(input.playsCsv);
  const unitStart = startingUnits(teams, config, input.previous);

  const index = new Map(teams.map((t, i) => [t.id, i]));
  const prior = startingRatings(teams, config, input.previous);
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

    const { ratings, homeField } = fitRatings(teams.length, rated(edges, index), { winBonus: config.winBonus, prior, priorWeight: config.priorWeight });
    const units = plays ? fitUnits(teams.length, index, edges, plays, unitStart, config.priorWeight) : null;
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
        prior: round6(prior[i]!),
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
      carryover: config.carryover,
      priorWeight: config.priorWeight,
      homeField: round6(homeField),
      classifications: config.classifications,
      teamsSha256,
      gamesSha256,
      playsSha256,
      snapsPerGame: units ? round6(units.snapsPerGame) : null,
      priorSeason,
      counts,
    };
    files.push({ id: snap.id, json: formatRanking({ schema: 1, season: input.season, snapshot: snap, manifest, teams: ranked }) });
    await onProgress?.(files.length, snapshots.length);
  }

  return {
    files,
    index: {
      season: input.season,
      label: config.label,
      demo: config.demo,
      snapshots: snapshots.map((s) => ({ id: s.id, label: s.label })),
      priorSeason: priorSeason?.season ?? null,
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
