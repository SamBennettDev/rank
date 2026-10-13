import type { Edge, Game, GameCounts, SnapshotSpec } from "./types";
import { calendarWeekEnd, kickoff, RESULT_LAG_MS } from "./chronology";

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Calendar cutoffs include overlapping playoffs; postseason rounds get separate snapshots. */
export function listSnapshots(games: readonly Game[]): SnapshotSpec[] {
  const complete = games.filter(
    (g) => g.completed && g.homePoints !== null && g.awayPoints !== null,
  );
  if (!complete.length) return [];
  const latest = Math.max(...complete.map((g) => kickoff(g) + RESULT_LAG_MS));
  const regular = new Map<number, number>();
  for (const g of complete)
    if (g.seasonType === "regular")
      regular.set(
        g.week,
        Math.min(regular.get(g.week) ?? Infinity, calendarWeekEnd(kickoff(g))),
      );
  const specs: SnapshotSpec[] = [...regular]
    .sort((a, b) => a[0] - b[0])
    .map(([w, end]) => ({
      id: `week-${pad2(w)}`,
      label: `Week ${w}`,
      throughWeek: w,
      includePostseason: true,
      asOf: new Date(Math.min(end, latest)).toISOString(),
    }));
  const lastRegular = Math.max(-Infinity, ...regular.values()),
    lastWeek = Math.max(0, ...regular.keys());
  const postEnds = [
    ...new Set(
      complete
        .filter((g) => g.seasonType === "postseason")
        .map((g) => calendarWeekEnd(kickoff(g))),
    ),
  ]
    .filter((end) => end > lastRegular)
    .sort((a, b) => a - b);
  postEnds.forEach((end, i) => {
    const asOf = new Date(Math.min(end, latest)).toISOString(),
      last = i === postEnds.length - 1;
    specs.push({
      id: last ? "postseason" : `postseason-${asOf.slice(0, 10)}`,
      label: last ? "Postseason" : `Postseason · ${asOf.slice(0, 10)}`,
      throughWeek: lastWeek,
      includePostseason: true,
      asOf,
    });
  });
  specs.sort(
    (a, b) =>
      Date.parse(a.asOf!) - Date.parse(b.asOf!) ||
      a.throughWeek - b.throughWeek ||
      a.id.localeCompare(b.id),
  );
  // A rescheduled game or its six-hour result lag can cross the last nominal
  // week boundary. The current snapshot must still include every known result.
  const current = specs.at(-1);
  if (current && Date.parse(current.asOf!) < latest)
    current.asOf = new Date(latest).toISOString();
  return specs;
}

function inWindow(g: Game, snap: SnapshotSpec): boolean {
  if (snap.asOf && !g.completed && !Number.isFinite(Date.parse(g.startDate)))
    return false;
  if (snap.asOf) return kickoff(g) + RESULT_LAG_MS <= Date.parse(snap.asOf);
  return g.seasonType === "regular"
    ? g.week <= snap.throughWeek
    : snap.includePostseason;
}

/**
 * Turns the games in a snapshot's window into loser -> winner edges.
 * Edges come out in ascending game-id order, which fixes the matrix summation order.
 */
export function buildEdges(
  games: readonly Game[],
  teams: readonly { id: number }[],
  snap: SnapshotSpec,
): { edges: Edge[]; counts: GameCounts } {
  const known = new Set(teams.map((t) => t.id));
  const counts: GameCounts = {
    inWindow: 0,
    included: 0,
    outOfScope: 0,
    incomplete: 0,
    tied: 0,
  };
  const edges: Edge[] = [];
  for (const g of [...games].sort((a, b) => a.id - b.id)) {
    if (!inWindow(g, snap)) continue;
    counts.inWindow++;
    if (!known.has(g.homeId) || !known.has(g.awayId)) {
      counts.outOfScope++;
      continue;
    }
    if (!g.completed || g.homePoints === null || g.awayPoints === null) {
      counts.incomplete++;
      continue;
    }
    if (g.homePoints === g.awayPoints) {
      counts.tied++;
      continue;
    }
    const homeWon = g.homePoints > g.awayPoints;
    edges.push({
      gameId: g.id,
      winner: homeWon ? g.homeId : g.awayId,
      loser: homeWon ? g.awayId : g.homeId,
      week: g.week,
      seasonType: g.seasonType,
      winnerPoints: homeWon ? g.homePoints : g.awayPoints,
      loserPoints: homeWon ? g.awayPoints : g.homePoints,
      neutralSite: g.neutralSite,
      winnerIsHome: homeWon,
    });
    counts.included++;
  }
  return { edges, counts };
}
