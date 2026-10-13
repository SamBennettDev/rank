import { parseConfig, parseGames, parsePlays, parseTeams } from "./data";
import { buildEdges, listSnapshots } from "./graph";
import { sha256Hex } from "./hash";
import { predictMatchup, rateTeams, round6 } from "./model";
import { kickoff, RESULT_LAG_MS } from "./chronology";
import type { RatedGame } from "./rating";
import type {
  Edge,
  Manifest,
  RankedTeam,
  Ranking,
  SeasonIndexEntry,
} from "./types";
import { fitUnits } from "./units";
import { projectSeason, PROJECTION_MODE } from "./projection";
import { aggregateCredits, indexedGames, scoreStandings } from "./standing";

/** Bump when anything that changes output bytes changes (formatting, rounding, fields). */
export const ENGINE_VERSION = "rank-engine-12";

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
function rated(
  edges: readonly Edge[],
  index: Map<number, number>,
): RatedGame[] {
  return edges.map((e) => {
    const home = e.winnerIsHome ? e.winner : e.loser;
    const away = e.winnerIsHome ? e.loser : e.winner;
    const diff = e.winnerPoints - e.loserPoints;
    return {
      home: index.get(home)!,
      away: index.get(away)!,
      margin: e.winnerIsHome ? diff : -diff,
      neutral: e.neutralSite,
    };
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
  const config = parseConfig(input.configJson);
  const teams = parseTeams(input.teamsCsv)
    .filter((t) => config.classifications.includes(t.classification))
    .sort((a, b) => a.id - b.id);
  if (!teams.length) throw new Error("no teams match config.classifications");
  const games = parseGames(input.gamesCsv);
  const teamsSha256 = await sha256Hex(input.teamsCsv);
  const gamesSha256 = await sha256Hex(input.gamesCsv);
  const playsSha256 =
    input.playsCsv === undefined ? null : await sha256Hex(input.playsCsv);
  const plays =
    input.playsCsv === undefined ? null : parsePlays(input.playsCsv);

  const index = new Map(teams.map((t, i) => [t.id, i]));
  const files: SeasonOutput["files"] = [];
  const snapshots = listSnapshots(games);
  const allIds = new Set(
    snapshots.length
      ? buildEdges(games, teams, snapshots.at(-1)!).edges.map((e) => e.gameId)
      : [],
  );
  const allStanding = scoreStandings(
    teams.length,
    indexedGames(
      teams,
      games.filter((g) => allIds.has(g.id)),
    ),
    config,
  );
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

    const known = rated(edges, index);
    const model = rateTeams(teams.length, known, config);
    const { homeField } = model.fit;
    const included = new Set(edges.map((e) => e.gameId));
    const knownDated = indexedGames(
      teams,
      games.filter((g) => included.has(g.id)),
    );
    const standing = aggregateCredits(
      teams.length,
      allStanding.credits.filter((c) => included.has(c.gameId)),
    );
    const lastTime = Math.max(
      ...games.filter((g) => included.has(g.id)).map(kickoff),
    );
    if (!snap.asOf && Number.isFinite(lastTime))
      snap.asOf = new Date(lastTime + RESULT_LAG_MS).toISOString();
    const futureGames = games
      .filter(
        (g) =>
          index.has(g.homeId) &&
          index.has(g.awayId) &&
          !included.has(g.id) &&
          snap.asOf &&
          Number.isFinite(Date.parse(g.startDate)) &&
          kickoff(g) > Date.parse(snap.asOf),
      )
      .sort((a, b) => kickoff(a) - kickoff(b) || a.id - b.id);
    const projected = projectSeason(
      model,
      standing,
      knownDated,
      indexedGames(teams, futureGames),
      config,
    );
    const projection = {
      method: `${PROJECTION_MODE}-results-v1` as const,
      samples: futureGames.length ? config.projectionSamples : 1,
      seed: config.projectionSeed,
      remainingGames: futureGames.length,
      horizon: futureGames.at(-1)?.startDate ?? null,
      unknownMatchups: games.filter(
        (g) =>
          Number.isFinite(Date.parse(g.startDate)) &&
          snap.asOf &&
          kickoff(g) > Date.parse(snap.asOf) &&
          (!g.homeId || !g.awayId),
      ).length,
      teams: projected.teams,
    };
    const predictions = futureGames.flatMap((g) => {
      const h = index.get(g.homeId)!,
        a = index.get(g.awayId)!;
      return model.heights[h] === null || model.heights[a] === null
        ? []
        : [
            {
              gameId: g.id,
              home: g.homeId,
              away: g.awayId,
              startDate: g.startDate,
              neutralSite: g.neutralSite,
              ...predictMatchup(model, h, a, g.neutralSite, config),
            },
          ];
    });
    const units = plays
      ? fitUnits(teams.length, index, edges, plays, config.shrink)
      : null;
    const unit = (v: number | null | undefined) =>
      v === null || v === undefined ? null : round6(v);
    const heights = new Map(
      played.map((t) => [t.id, standing.heights[index.get(t.id)!]!]),
    );

    const ranked: RankedTeam[] = teams.map((t, i) => {
      const height = heights.get(t.id) ?? null;
      const rank = standing.ranks[i] ?? null;
      const prev = previous.get(t.id);
      return {
        id: t.id,
        school: t.school,
        abbreviation: t.abbreviation,
        conference: t.conference,
        classification: t.classification,
        rank,
        tied:
          height !== null &&
          standing.heights.filter((v) => v === height).length > 1,
        height,
        projection: projected.projections[i]!,
        component: height === null ? null : teams[model.components[i]!]!.id,
        componentSize: model.sizes.get(model.components[i]!) ?? 0,
        provisional: model.provisional[i]!,
        offense: unit(units?.offense[i]),
        defense: unit(units?.defense[i]),
        special: unit(units?.special[i]),
        wins: wins.get(t.id) ?? 0,
        losses: losses.get(t.id) ?? 0,
        change: rank !== null && prev !== undefined ? prev - rank : null,
      };
    });
    ranked.sort(
      (a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.id - b.id,
    );
    previous = new Map(
      ranked.filter((t) => t.rank !== null).map((t) => [t.id, t.rank!]),
    );

    const manifest: Manifest = {
      engine: ENGINE_VERSION,
      standingMethod: "frozen-win-quality-v1",
      lossPenalty: 1,
      algorithmVersion: config.algorithmVersion,
      winBonus: config.winBonus,
      shrink: config.shrink,
      projectionSamples: config.projectionSamples,
      projectionSeed: config.projectionSeed,
      homeFieldShrink: config.homeFieldShrink,
      probabilityScale: config.probabilityScale,
      residualScale: config.residualScale,
      calibrationId: config.calibrationId,
      homeField: round6(homeField),
      homeFieldError: round6(model.uncertainty.homeFieldError),
      connectedComponents: model.sizes.size,
      classifications: config.classifications,
      teamsSha256,
      gamesSha256,
      playsSha256,
      snapsPerGame: units ? round6(units.snapsPerGame) : null,
      counts,
    };
    files.push({
      id: snap.id,
      json: formatRanking({
        schema: 2,
        season: input.season,
        snapshot: snap,
        manifest,
        projection,
        predictions,
        credits: standing.credits.map((c) => ({
          ...c,
          winner: teams[c.winner]!.id,
          loser: teams[c.loser]!.id,
        })),
        teams: ranked,
      }),
    });
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
  const indent = (s: string) =>
    s
      .split("\n")
      .map((l, i) => (i === 0 ? l : "  " + l))
      .join("\n");
  const lines = [
    "{",
    `  "schema": ${r.schema},`,
    `  "season": ${JSON.stringify(r.season)},`,
    `  "snapshot": ${JSON.stringify(r.snapshot)},`,
    `  "manifest": ${indent(JSON.stringify(r.manifest, null, 2))},`,
    `  "projection": ${JSON.stringify(r.projection)},`,
    '  "predictions": [',
    ...r.predictions.map(
      (p, i) =>
        `    ${JSON.stringify(p)}${i < r.predictions.length - 1 ? "," : ""}`,
    ),
    "  ],",
    '  "credits": [',
    ...r.credits.map(
      (c, i) =>
        `    ${JSON.stringify(c)}${i < r.credits.length - 1 ? "," : ""}`,
    ),
    "  ],",
    '  "teams": [',
    ...r.teams.map(
      (t, i) => `    ${JSON.stringify(t)}${i < r.teams.length - 1 ? "," : ""}`,
    ),
    "  ]",
    "}",
  ];
  return lines.join("\n") + "\n";
}
