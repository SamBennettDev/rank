import { parseConfig, parseGames, parsePlays, parseTeams } from "./data";
import { buildEdges, listSnapshots } from "./graph";
import { sha256Hex } from "./hash";
import { predictMatchup, rateTeams, rankValues, round6 } from "./model";
import { kickoff, RESULT_LAG_MS } from "./chronology";
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
import { rankByQuality } from "./springs";
import { makeMatchupContext } from "./matchup";

/** Bump when anything that changes output bytes changes (formatting, rounding, fields). */
export const ENGINE_VERSION = "rank-engine-8";

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

  const index = new Map(teams.map((t, i) => [t.id, i]));
  const eligible = new Set(
    teams.flatMap((t, i) =>
      config.classifications.includes(t.classification) ? [i] : [],
    ),
  );
  if (!eligible.size) throw new Error("no teams match config.classifications");
  const context = makeMatchupContext(teams, config);
  // Results against lower-division opponents (absent from teams.csv) still count:
  // those opponents join the spring graph, but never the matchup model or the ranking.
  const otherTeams = new Map<number, Team>();
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
  // Each board's ranks in the previous snapshot, for week-to-week movement.
  let previous = new Map<number, number>(),
    previousResume = new Map<number, number>(),
    previousSchedule = new Map<number, number>();
  const moved = (now: number | null, before: number | undefined) =>
    now !== null && before !== undefined ? before - now : null;

  for (const snap of snapshots) {
    const { edges } = buildEdges(games, teams, snap);
    const result = buildEdges(games, resultTeams, snap);
    const resultEdges = result.edges.filter(
      (e) => index.has(e.winner) || index.has(e.loser),
    );
    const externalEdges = resultEdges.filter(
      (e) => !index.has(e.winner) || !index.has(e.loser),
    );
    const counts = {
      ...result.counts,
      included: resultEdges.length,
      outOfScope:
        result.counts.outOfScope + result.edges.length - resultEdges.length,
      modeled: edges.length,
      unmodeled: externalEdges.length,
    };
    const wins = new Map<number, number>();
    const losses = new Map<number, number>();
    for (const e of resultEdges) {
      wins.set(e.winner, (wins.get(e.winner) ?? 0) + 1);
      losses.set(e.loser, (losses.get(e.loser) ?? 0) + 1);
    }

    const known = rated(edges, index);
    const model = rateTeams(teams.length, known, config, context);
    const { homeField } = model.fit;
    const included = new Set(edges.map((e) => e.gameId));
    // The ranking: every counted result, including lower-division opponents, is a spring.
    const graph = rankByQuality(
      resultTeams.length,
      resultEdges.map((e) => ({
        winner: resultIndex.get(e.winner)!,
        loser: resultIndex.get(e.loser)!,
        margin: e.winnerPoints - e.loserPoints,
      })),
      config.springs,
    );
    const onGraph = (id: number) => wins.has(id) || losses.has(id);
    const at = (values: ArrayLike<number>, id: number) =>
      onGraph(id) ? round6(values[resultIndex.get(id)!]!) : null;
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
    const predictions = futureGames
      .filter(
        (g) =>
          eligible.has(index.get(g.homeId)!) ||
          eligible.has(index.get(g.awayId)!),
      )
      .flatMap((g) => {
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
      ? fitUnits(teams.length, index, edges, plays, config.unitShrink)
      : null;
    const unit = (v: number | null | undefined) =>
      v === null || v === undefined ? null : round6(v);
    const eligibleHeights = teams.map((t, i) =>
      eligible.has(i) ? at(graph.quality, t.id) : null,
    );
    const ranks = rankValues(eligibleHeights);
    const rankBy = (values: ArrayLike<number>) =>
      rankValues(
        teams.map((t, i) => (eligible.has(i) ? at(values, t.id) : null)),
      );
    const resumeRanks = rankBy(graph.resume),
      scheduleRanks = rankBy(graph.schedule);
    const allTeams: RankedTeam[] = teams.map((t, i) => {
      const height = at(graph.quality, t.id);
      const rank = ranks[i] ?? null;
      return {
        id: t.id,
        school: t.school,
        abbreviation: t.abbreviation,
        conference: t.conference,
        classification: t.classification,
        rank,
        tied:
          rank !== null &&
          eligibleHeights.filter((v) => v === height).length > 1,
        height,
        strength: at(graph.strength, t.id),
        resume: at(graph.resume, t.id),
        resumeRank: resumeRanks[i] ?? null,
        schedule: at(graph.schedule, t.id),
        scheduleRank: scheduleRanks[i] ?? null,
        component: height === null ? null : teams[model.components[i]!]!.id,
        componentSize: model.sizes.get(model.components[i]!) ?? 0,
        provisional: model.provisional[i]!,
        offense: unit(units?.offense[i]),
        defense: unit(units?.defense[i]),
        special: unit(units?.special[i]),
        wins: wins.get(t.id) ?? 0,
        losses: losses.get(t.id) ?? 0,
        change: moved(rank, previous.get(t.id)),
        resumeChange: moved(resumeRanks[i] ?? null, previousResume.get(t.id)),
        scheduleChange: moved(
          scheduleRanks[i] ?? null,
          previousSchedule.get(t.id),
        ),
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
        height: at(graph.quality, t.id),
        strength: at(graph.strength, t.id),
        resume: at(graph.resume, t.id),
        resumeRank: null,
        schedule: at(graph.schedule, t.id),
        scheduleRank: null,
        component: null,
        componentSize: 0,
        provisional: true,
        offense: null,
        defense: null,
        special: null,
        wins: wins.get(t.id) ?? 0,
        losses: losses.get(t.id) ?? 0,
        change: null,
        resumeChange: null,
        scheduleChange: null,
      });
    ranked.sort(
      (a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.id - b.id,
    );
    const ranksOf = (pick: (t: RankedTeam) => number | null) =>
      new Map(
        ranked.flatMap((t) => (pick(t) === null ? [] : [[t.id, pick(t)!]])),
      );
    previous = ranksOf((t) => t.rank);
    previousResume = ranksOf((t) => t.resumeRank);
    previousSchedule = ranksOf((t) => t.scheduleRank);

    const manifest: Manifest = {
      engine: ENGINE_VERSION,
      algorithmVersion: config.algorithmVersion,
      springs: config.springs,
      matchup: config.matchup,
      unitShrink: config.unitShrink,
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
        schema: 1,
        season: input.season,
        snapshot: snap,
        manifest,
        predictions,
        springs: resultEdges.map((e, k) => ({
          gameId: e.gameId,
          winner: e.winner,
          loser: e.loser,
          margin: e.winnerPoints - e.loserPoints,
          spring: round6(graph.stiffness[k]!),
          win: round6(graph.points[k]!.win),
          loss: round6(graph.points[k]!.loss),
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
    '  "predictions": [',
    ...r.predictions.map(
      (p, i) =>
        `    ${JSON.stringify(p)}${i < r.predictions.length - 1 ? "," : ""}`,
    ),
    "  ],",
    '  "springs": [',
    ...r.springs.map(
      (c, i) =>
        `    ${JSON.stringify(c)}${i < r.springs.length - 1 ? "," : ""}`,
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
