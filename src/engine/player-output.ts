/**
 * Published player files for a season (computed by scripts/lib.ts after the rankings):
 *
 *   rankings/<season>/players.json        settings, team pass/rush units, the position boards
 *   rankings/<season>/teams/<team>.json   a team's units and every rated player with game lines
 *
 * Fixed key order and six-decimal rounding, so reruns are byte-identical.
 */
import { parseTeams } from "./data";
import { parsePlayerGames, parseRoster, PLAYER_COLUMNS, type PlayerGame } from "./players-data";
import {
  DEFAULT_PLAYER_SETTINGS,
  GROUPS,
  type Group,
  type PlayerRating,
  type PlayerSettings,
  ratePlayers,
} from "./players";
import type { Ranking } from "./types";

export const PLAYERS_SCHEMA = 1;
export const BOARD_SIZE = 100;
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
const r3 = (x: number) => Math.round(x * 1e3) / 1e3;

/** players.csv columns kept for each position group, in this order. */
const PASSING = ["dropbacks", "attempts", "completions", "pass_yards", "pass_td", "interceptions", "sacks_taken", "pass_epa", "pass_success"];
const RUSHING = ["rushes", "rush_yards", "rush_td", "rush_epa", "rush_success"];
const RECEIVING = ["targets", "receptions", "rec_yards", "rec_td", "target_epa", "target_success"];
const DEFENSE = ["tackles", "solo", "assists", "sacks", "pbu", "def_int"];
export const GROUP_STATS: Record<Group, string[]> = {
  QB: [...PASSING, ...RUSHING],
  RB: [...RUSHING, ...RECEIVING],
  WR: [...RECEIVING, ...RUSHING],
  TE: [...RECEIVING, ...RUSHING],
  K: ["fga", "fgm", "fg_value"],
  DL: DEFENSE,
  LB: DEFENSE,
  DB: DEFENSE,
};
void PLAYER_COLUMNS;
const camel = (c: string) => c.replace(/_([a-z])/g, (_, x: string) => x.toUpperCase());

export interface PlayerSummary {
  id: number;
  name: string;
  teamId: number;
  position: string;
  group: Group;
  rank: number;
  jersey: string;
  year: string;
  height: string;
  weight: number;
  hometown: string;
  highSchool: string;
  gamesPlayed: number;
  gamesStarted: number;
  games: number;
  plays: number;
  epa: number;
  expected: number;
  over: number;
  shrink: number;
  rating: number;
  valuePerGame: number;
  /** Season totals in GROUP_STATS[group] order. */
  totals: number[];
}

export interface PlayerFileLine {
  gameId: number;
  opponentId: number;
  plays: number;
  epa: number;
  expected: number;
  credits: number;
  factor: number;
  /** In GROUP_STATS[group] order. */
  stats: number[];
}

export interface TeamUnits {
  passOffense: number;
  passDefense: number;
  rushOffense: number;
  rushDefense: number;
  passOffenseRank: number | null;
  passDefenseRank: number | null;
  rushOffenseRank: number | null;
  rushDefenseRank: number | null;
}

const stats = (g: PlayerGame, group: Group) =>
  GROUP_STATS[group].map((c) => r3((g as unknown as Record<string, number>)[camel(c)]!));

function summary(r: PlayerRating): PlayerSummary {
  const p = r.player;
  return {
    id: p.id,
    name: p.name,
    teamId: p.teamId,
    position: p.position,
    group: r.group!,
    rank: r.rank!,
    jersey: p.jersey,
    year: p.year,
    height: p.height,
    weight: p.weight,
    hometown: p.hometown,
    highSchool: p.highSchool,
    gamesPlayed: p.gamesPlayed,
    gamesStarted: p.gamesStarted,
    games: r.games,
    plays: r6(r.plays),
    epa: r6(r.epa),
    expected: r6(r.expected),
    over: r6(r.over),
    shrink: r.shrinkWith,
    rating: r6(r.rating),
    valuePerGame: r6(r.valuePerGame),
    totals: stats(r.totals, r.group!),
  };
}

const line = (l: PlayerRating["lines"][number], group: Group): PlayerFileLine => ({
  gameId: l.gameId,
  opponentId: l.opponentId,
  plays: r6(l.plays),
  epa: r6(l.epa),
  expected: r6(l.expected),
  credits: r6(l.credits),
  factor: r6(l.factor),
  stats: stats(l.g, group),
});

/** One JSON object per line inside arrays, like the ranking files. */
function format(obj: Record<string, unknown>): string {
  const parts = Object.entries(obj).map(([k, v]) => {
    if (Array.isArray(v) && v.length && typeof v[0] === "object")
      return `  ${JSON.stringify(k)}: [\n${v.map((x) => `    ${JSON.stringify(x)}`).join(",\n")}\n  ]`;
    if (v && typeof v === "object" && !Array.isArray(v) && Object.values(v).some((x) => Array.isArray(x) && x.length && typeof x[0] === "object"))
      return `  ${JSON.stringify(k)}: {\n${Object.entries(v)
        .map(([kk, vv]) => `    ${JSON.stringify(kk)}: [\n${(vv as unknown[]).map((x) => `      ${JSON.stringify(x)}`).join(",\n")}\n    ]`)
        .join(",\n")}\n  }`;
    return `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`;
  });
  return `{\n${parts.join(",\n")}\n}\n`;
}

export function computePlayers(input: {
  season: string;
  teamsCsv: string;
  playersCsv: string;
  rosterCsv: string;
  /** The season's latest ranking: eligible teams and opponent qualities. */
  ranking: Ranking;
  settings?: PlayerSettings;
}): { id: string; json: string }[] {
  const settings = input.settings ?? DEFAULT_PLAYER_SETTINGS;
  const teams = parseTeams(input.teamsCsv);
  const eligible = new Set(teams.map((t) => t.id));
  const quality = new Map<number, number>();
  for (const t of [...input.ranking.teams, ...(input.ranking.opponents ?? [])])
    quality.set(t.id, t.height ?? 0);
  const games = parsePlayerGames(input.playersCsv);
  const roster = parseRoster(input.rosterCsv);
  const { pass, rush, ratings } = ratePlayers(games, roster, eligible, quality, settings);

  // Team units with ranks among the ranked teams (higher is better for both sides).
  const rankOf = (m: Map<number, number>, id: number) => {
    if (!m.has(id)) return null;
    const v = m.get(id)!;
    return 1 + [...eligible].filter((t) => m.has(t) && m.get(t)! > v).length;
  };
  const units = new Map<number, TeamUnits>();
  for (const t of [...eligible].sort((a, b) => a - b))
    units.set(t, {
      passOffense: r6(pass.offense.get(t) ?? 0),
      passDefense: r6(pass.defense.get(t) ?? 0),
      rushOffense: r6(rush.offense.get(t) ?? 0),
      rushDefense: r6(rush.defense.get(t) ?? 0),
      passOffenseRank: rankOf(pass.offense, t),
      passDefenseRank: rankOf(pass.defense, t),
      rushOffenseRank: rankOf(rush.offense, t),
      rushDefenseRank: rankOf(rush.defense, t),
    });

  const boards: Record<string, PlayerSummary[]> = {};
  for (const g of GROUPS)
    boards[g] = ratings
      .filter((r) => r.group === g && r.rank! <= BOARD_SIZE)
      .sort((a, b) => a.rank! - b.rank!)
      .map(summary);
  const counts = Object.fromEntries(GROUPS.map((g) => [g, ratings.filter((r) => r.group === g).length]));

  const files = [
    {
      id: "players",
      json: format({
        schema: PLAYERS_SCHEMA,
        season: input.season,
        snapshot: input.ranking.snapshot.id,
        settings,
        passMu: r6(pass.mu),
        rushMu: r6(rush.mu),
        groupStats: GROUP_STATS,
        counts,
        boards,
      }),
    },
  ];
  for (const [t, u] of units) {
    const mine = ratings
      .filter((r) => r.player.teamId === t)
      .sort((a, b) => GROUPS.indexOf(a.group!) - GROUPS.indexOf(b.group!) || a.rank! - b.rank!);
    files.push({
      id: `teams/${t}`,
      json: format({
        schema: PLAYERS_SCHEMA,
        season: input.season,
        teamId: t,
        passMu: r6(pass.mu),
        rushMu: r6(rush.mu),
        units: u,
        groupStats: GROUP_STATS,
        players: mine.map((r) => ({ ...summary(r), lines: r.lines.map((l) => line(l, r.group!)) })),
        opponents: [...new Set(mine.flatMap((r) => r.lines.map((l) => l.opponentId)))]
          .sort((a, b) => a - b)
          .map((o) => ({
            id: o,
            passDefense: r6(pass.defense.get(o) ?? 0),
            rushDefense: r6(rush.defense.get(o) ?? 0),
            quality: r6(quality.get(o) ?? 0),
          })),
      }),
    });
  }
  return files;
}
