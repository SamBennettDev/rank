import type { Edge, Game, GameCounts, SnapshotSpec } from "./types";

const pad2 = (n: number) => String(n).padStart(2, "0");

/** One snapshot per regular-season week that has a completed game, plus "postseason". */
export function listSnapshots(games: readonly Game[]): SnapshotSpec[] {
  const weeks = new Set<number>();
  let postseason = false;
  let lastWeek = 0;
  for (const g of games) {
    if (!g.completed) continue;
    if (g.seasonType === "regular") {
      weeks.add(g.week);
      lastWeek = Math.max(lastWeek, g.week);
    } else postseason = true;
  }
  const specs: SnapshotSpec[] = [...weeks]
    .sort((a, b) => a - b)
    .map((w) => ({ id: `week-${pad2(w)}`, label: `Week ${w}`, throughWeek: w, includePostseason: false }));
  if (postseason) specs.push({ id: "postseason", label: "Postseason", throughWeek: lastWeek, includePostseason: true });
  return specs;
}

function inWindow(g: Game, snap: SnapshotSpec): boolean {
  return g.seasonType === "regular" ? g.week <= snap.throughWeek : snap.includePostseason;
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
  const counts: GameCounts = { inWindow: 0, included: 0, outOfScope: 0, incomplete: 0, tied: 0 };
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
