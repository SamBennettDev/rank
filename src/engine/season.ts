import { parseConfig, parseGames, parsePlays, parseTeams } from "./data";
import { buildEdges, listSnapshots } from "./graph";
import { sha256Hex } from "./hash";
import { predictMatchup, rateTeams, rankValues, round6 } from "./model";
import { calendarWeekStart, kickoff, RESULT_LAG_MS } from "./chronology";
import type { RatedGame } from "./rating";
import type {
  Edge,
  Manifest,
  RankedTeam,
  Ranking,
  SeasonIndexEntry,
  Team,
} from "./types";
import { fitUnits } from "./units";
import { projectSeason, PROJECTION_MODE } from "./projection";
import { aggregateCredits, indexedGames, scoreStandings } from "./standing";
import { makeWinQualityContext } from "./win-quality";
import {
  consensusOrder,
  neuralPredictor,
  validateNeuralBundle,
} from "./neural";

/** Bump when anything that changes output bytes changes (formatting, rounding, fields). */
export const ENGINE_VERSION = "rank-engine-18";

export interface SeasonFiles {
  season: string;
  teamsCsv: string;
  gamesCsv: string;
  /** Play-by-play summary (plays.csv); without it there are no unit ratings. */
  playsCsv?: string;
  /** Exported numeric snapshots and saved weights, bound to the raw input hashes. */
  neuralJson?: string;
  richCsv?: string;
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
  const modelClassifications = [
    ...new Set([
      ...config.classifications,
      ...(config.opponentClassifications ?? []),
    ]),
  ];
  const teams = parseTeams(input.teamsCsv)
    .filter((t) => modelClassifications.includes(t.classification))
    .sort((a, b) => a.id - b.id);
  if (!teams.length) throw new Error("no teams match config.classifications");
  const games = parseGames(input.gamesCsv);
  const teamsSha256 = await sha256Hex(input.teamsCsv);
  const gamesSha256 = await sha256Hex(input.gamesCsv);
  const playsSha256 =
    input.playsCsv === undefined ? null : await sha256Hex(input.playsCsv);
  const plays =
    input.playsCsv === undefined ? null : parsePlays(input.playsCsv);
  if (config.neural && !input.neuralJson)
    throw new Error("missing neural.json; run npm run neural:export");
  const neuralBundle = config.neural
    ? validateNeuralBundle(JSON.parse(input.neuralJson!))
    : null;
  const neuralSha256 = neuralBundle ? await sha256Hex(input.neuralJson!) : null;
  const richSha256 =
    input.richCsv === undefined ? null : await sha256Hex(input.richCsv);
  if (
    neuralBundle &&
    (neuralBundle.year !== Number(input.season) ||
      neuralBundle.source.teamsSha256 !== teamsSha256 ||
      neuralBundle.source.gamesSha256 !== gamesSha256 ||
      neuralBundle.source.playsSha256 !== playsSha256 ||
      neuralBundle.source.richSha256 !== richSha256 ||
      neuralBundle.teamIds.length !== teams.length ||
      neuralBundle.teamIds.some((id, i) => id !== teams[i]!.id))
  )
    throw new Error(
      "stale neural inputs; run npm run neural:export for these CSVs",
    );

  const index = new Map(teams.map((t, i) => [t.id, i]));
  const eligible = new Set(
    teams.flatMap((t, i) =>
      config.classifications.includes(t.classification) ? [i] : [],
    ),
  );
  if (!eligible.size) throw new Error("no teams match config.classifications");
  const quality = makeWinQualityContext(teams, config);
  // Keep lower-division results without inventing ratings for opponents absent
  // from the model. Their wins earn no quality credit; every loss still counts.
  const otherTeams = new Map<number, Team>();
  if (quality)
    for (const g of [...games].sort((a, b) => a.id - b.id)) {
      if (!index.has(g.homeId) && !index.has(g.awayId)) continue;
      for (const [id, school] of [
        [g.homeId, g.homeTeam],
        [g.awayId, g.awayTeam],
      ] as const)
        if (id > 0 && !index.has(id) && !otherTeams.has(id))
          otherTeams.set(id, {
            id,
            school,
            abbreviation: school
              .split(/\s+/)
              .map((word) => word[0] ?? "")
              .join("")
              .slice(0, 4),
            conference: "Other",
            classification: "other",
            color: "",
          });
    }
  const resultTeams = [
    ...teams,
    ...[...otherTeams.values()].sort((a, b) => a.id - b.id),
  ];
  const resultIndex = new Map(resultTeams.map((t, i) => [t.id, i]));
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
    quality,
  );
  let previous = new Map<number, number>();

  for (const snap of snapshots) {
    const { edges, counts: modelCounts } = buildEdges(games, teams, snap);
    const result = quality
      ? buildEdges(games, resultTeams, snap)
      : { edges, counts: modelCounts };
    const resultEdges = result.edges.filter(
      (e) => index.has(e.winner) || index.has(e.loser),
    );
    const externalEdges = resultEdges.filter(
      (e) => !index.has(e.winner) || !index.has(e.loser),
    );
    const counts = quality
      ? {
          ...result.counts,
          included: resultEdges.length,
          outOfScope:
            result.counts.outOfScope + result.edges.length - resultEdges.length,
          modeled: edges.length,
          unmodeled: externalEdges.length,
        }
      : modelCounts;
    const wins = new Map<number, number>();
    const losses = new Map<number, number>();
    for (const e of resultEdges) {
      wins.set(e.winner, (wins.get(e.winner) ?? 0) + 1);
      losses.set(e.loser, (losses.get(e.loser) ?? 0) + 1);
    }
    const played = teams.filter((t) => wins.has(t.id) || losses.has(t.id));

    const known = rated(edges, index);
    const model = rateTeams(teams.length, known, config, quality);
    const { homeField } = model.fit;
    const included = new Set(edges.map((e) => e.gameId));
    const knownDated = indexedGames(
      teams,
      games.filter((g) => included.has(g.id)),
    );
    const byGame = new Map(games.map((g) => [g.id, g]));
    const standing = aggregateCredits(
      resultTeams.length,
      [
        ...allStanding.credits.filter((c) => included.has(c.gameId)),
        ...externalEdges.map((e) => ({
          gameId: e.gameId,
          winner: resultIndex.get(e.winner)!,
          loser: resultIndex.get(e.loser)!,
          value: 0,
          unmodeled: true as const,
          cutoff: new Date(
            calendarWeekStart(kickoff(byGame.get(e.gameId)!)),
          ).toISOString(),
        })),
      ].sort((a, b) => a.gameId - b.gameId),
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
      PROJECTION_MODE,
      eligible,
      quality,
    );
    const projection = {
      ...(neuralBundle ? { target: "frozen-earned-points" as const } : {}),
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
    const neuralSnapshot = neuralBundle?.snapshots.find(
      (s) => s.id === snap.id,
    );
    if (
      neuralBundle &&
      (!neuralSnapshot ||
        neuralSnapshot.asOf !== snap.asOf ||
        neuralSnapshot.gameIds.length !== included.size ||
        neuralSnapshot.gameIds.some((id) => !included.has(id)))
    )
      throw new Error(
        `neural snapshot does not match causal game cutoff: ${snap.id}`,
      );
    const neural = neuralBundle
      ? neuralPredictor(neuralBundle, neuralSnapshot!)
      : null;
    const ordered = neural
      ? consensusOrder(
          neural.matrix,
          teams.map((t) => t.id),
          teams.flatMap((t, i) =>
            eligible.has(i) && (wins.has(t.id) || losses.has(t.id)) ? [i] : [],
          ),
        )
      : null;
    const predictions = futureGames
      .filter(
        (g) =>
          eligible.has(index.get(g.homeId)!) ||
          eligible.has(index.get(g.awayId)!),
      )
      .flatMap((g) => {
        const h = index.get(g.homeId)!,
          a = index.get(g.awayId)!;
        return !neural &&
          (model.heights[h] === null || model.heights[a] === null)
          ? []
          : [
              {
                gameId: g.id,
                home: g.homeId,
                away: g.awayId,
                startDate: g.startDate,
                neutralSite: g.neutralSite,
                ...(neural
                  ? {
                      homeProbability: round6(
                        neural.probability(h, a, g.neutralSite ? 0 : 1),
                      ),
                      strengthEdge: null,
                      provisional:
                        model.provisional[h]! || model.provisional[a]!,
                    }
                  : predictMatchup(model, h, a, g.neutralSite, config)),
              },
            ];
      });
    const units = plays
      ? fitUnits(teams.length, index, edges, plays, config.shrink)
      : null;
    const unit = (v: number | null | undefined) =>
      v === null || v === undefined ? null : round6(v);
    const heights = new Map(
      played.map((t) => {
        const i = index.get(t.id)!;
        return [
          t.id,
          ordered
            ? ordered.ranks[i] === null
              ? null
              : teams.length + 1 - ordered.ranks[i]!
            : standing.heights[i]!,
        ] as const;
      }),
    );

    const earnedRanks = rankValues(
      standing.heights.map((v, i) => (eligible.has(i) ? v : null)),
    );
    const standingRanks = ordered?.ranks ?? earnedRanks;
    const allTeams: RankedTeam[] = teams.map((t, i) => {
      const height = heights.get(t.id) ?? null;
      const rank = standingRanks[i] ?? null;
      const prev = previous.get(t.id);
      return {
        id: t.id,
        school: t.school,
        abbreviation: t.abbreviation,
        conference: t.conference,
        classification: t.classification,
        rank,
        tied:
          rank !== null &&
          standingRanks.filter((v, j) => eligible.has(j) && v === rank).length >
            1,
        height,
        ...(neural
          ? {
              neural: {
                roundRobinWinProbability: round6(neural.scores[i]!),
                richWinProbability: round6(neural.groupScores[0]![i]!),
                graphWinProbability: round6(neural.groupScores[1]![i]!),
              },
              earnedHeight: standing.heights[i]!,
              earnedRank: earnedRanks[i]!,
            }
          : {}),
        projection: projected.projections[i]!,
        component: height === null ? null : teams[model.components[i]!]!.id,
        componentSize: model.sizes.get(model.components[i]!) ?? 0,
        provisional:
          model.provisional[i]! ||
          (neuralSnapshot ? neuralSnapshot.features[i]![22]! < 0.5 : false),
        offense: unit(units?.offense[i]),
        defense: unit(units?.defense[i]),
        special: unit(units?.special[i]),
        wins: wins.get(t.id) ?? 0,
        losses: losses.get(t.id) ?? 0,
        change: rank !== null && prev !== undefined ? prev - rank : null,
      };
    });
    const ranked = allTeams.filter((t) =>
      config.classifications.includes(t.classification),
    );
    const opponents = allTeams.filter(
      (t) => !config.classifications.includes(t.classification),
    );
    for (const t of resultTeams.slice(teams.length))
      opponents.push({
        ...t,
        rank: null,
        tied: false,
        height: null,
        projection: null,
        component: null,
        componentSize: 0,
        provisional: true,
        offense: null,
        defense: null,
        special: null,
        wins: wins.get(t.id) ?? 0,
        losses: losses.get(t.id) ?? 0,
        change: null,
      });
    ranked.sort(
      (a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.id - b.id,
    );
    previous = new Map(
      ranked.filter((t) => t.rank !== null).map((t) => [t.id, t.rank!]),
    );

    const manifest: Manifest = {
      engine: ENGINE_VERSION,
      standingMethod: neuralBundle
        ? "season-only-neural-v1"
        : config.winQuality
          ? "frozen-fbs-quality-v2"
          : "frozen-win-quality-v1",
      lossPenalty: neuralBundle ? null : 1,
      algorithmVersion: config.algorithmVersion,
      winBonus: config.winBonus,
      shrink: config.shrink,
      projectionSamples: config.projectionSamples,
      projectionSeed: config.projectionSeed,
      homeFieldShrink: config.homeFieldShrink,
      probabilityScale: config.probabilityScale,
      residualScale: config.residualScale,
      calibrationId: config.calibrationId,
      ...(config.winQuality ? { winQuality: config.winQuality } : {}),
      ...(neuralBundle
        ? {
            neural: {
              model: neuralBundle.model,
              ordering: "weighted-pairwise-consensus" as const,
              bundleSha256: neuralSha256!,
              trainingYears: neuralBundle.trainingYears,
              referenceTeams: teams.length,
              orderingMoves: ordered!.moves,
              initialObjective: ordered!.initialObjective,
              objective: ordered!.objective,
              disagreements: ordered!.disagreements,
            },
          }
        : {}),
      homeField: round6(homeField),
      homeFieldError: round6(model.uncertainty.homeFieldError),
      connectedComponents: model.sizes.size,
      classifications: config.classifications,
      ...(config.opponentClassifications
        ? { opponentClassifications: modelClassifications }
        : {}),
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
          winner: resultTeams[c.winner]!.id,
          loser: resultTeams[c.loser]!.id,
        })),
        teams: ranked,
        ...(opponents.length ? { opponents } : {}),
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
  ];
  if (r.opponents?.length) {
    lines[lines.length - 1] = "  ],";
    lines.push(
      '  "opponents": [',
      ...r.opponents.map(
        (t, i) =>
          `    ${JSON.stringify(t)}${i < r.opponents!.length - 1 ? "," : ""}`,
      ),
      "  ]",
    );
  }
  lines.push("}");
  return lines.join("\n") + "\n";
}
