/**
 * Player files (rankings/<season>/players.json and teams/<id>.json) on the client:
 * types, loaders and how each position's numbers are labelled.
 */
import type { Group, PlayerSettings } from "../src/engine/players";
import type {
  PlayerFileLine,
  PlayerSummary,
  TeamUnits,
} from "../src/engine/player-output";
import type { EpModel } from "../src/engine/ep";
import { fetchText } from "./store";

export type { Group, PlayerSummary, PlayerFileLine, TeamUnits };
export const GROUPS: Group[] = ["QB", "RB", "WR", "TE", "K", "DL", "LB", "DB"];
export const GROUP_NAME: Record<Group, string> = {
  QB: "Quarterbacks",
  RB: "Running backs",
  WR: "Wide receivers",
  TE: "Tight ends",
  K: "Kickers",
  DL: "Defensive line",
  LB: "Linebackers",
  DB: "Defensive backs",
};
export const GROUP_ONE: Record<Group, string> = {
  QB: "quarterback",
  RB: "running back",
  WR: "wide receiver",
  TE: "tight end",
  K: "kicker",
  DL: "defensive lineman",
  LB: "linebacker",
  DB: "defensive back",
};
export const isDefense = (g: Group) => g === "DL" || g === "LB" || g === "DB";

export interface PlayersFile {
  schema: number;
  season: string;
  snapshot: string;
  settings: PlayerSettings;
  passMu: number;
  rushMu: number;
  groupStats: Record<Group, string[]>;
  counts: Record<Group, number>;
  boards: Record<Group, PlayerSummary[]>;
}

export interface TeamPlayer extends PlayerSummary {
  lines: PlayerFileLine[];
}

export interface TeamPlayersFile {
  schema: number;
  season: string;
  teamId: number;
  passMu: number;
  rushMu: number;
  units: TeamUnits;
  groupStats: Record<Group, string[]>;
  players: TeamPlayer[];
  opponents: { id: number; passDefense: number; rushDefense: number; quality: number }[];
}

export async function loadPlayers(season: string): Promise<PlayersFile> {
  return JSON.parse(await fetchText(`rankings/${season}/players.json`)) as PlayersFile;
}
export async function loadTeamPlayers(season: string, teamId: number): Promise<TeamPlayersFile> {
  return JSON.parse(await fetchText(`rankings/${season}/teams/${teamId}.json`)) as TeamPlayersFile;
}
export async function loadEpModel(): Promise<EpModel & { holdout: { season: number; rmse: number; rmseConstant: number; calibration: { bin: number; plays: number; predicted: number; actual: number }[] }; plays: number; trainedOn: string }> {
  return JSON.parse(await fetchText("models/ep.json"));
}

/** A stat value by column name from a stats array in groupStats order. */
export const stat = (cols: string[], values: number[], name: string) => {
  const i = cols.indexOf(name);
  return i < 0 ? 0 : values[i]!;
};

export interface StatCol {
  key: string;
  label: string;
  title: string;
  value: (s: (name: string) => number) => string;
}
const n0 = (v: number) => (Math.round(v * 10) / 10).toLocaleString("en-US", { maximumFractionDigits: 1 });
const pct = (a: number, b: number) => (b > 0 ? `${((100 * a) / b).toFixed(1)}%` : "—");
const per = (a: number, b: number, d = 2) => (b > 0 ? (a / b).toFixed(d) : "—");
const signed = (v: number, d = 2) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d);

/** The season line shown for each position group. */
export const STAT_COLS: Record<Group, StatCol[]> = {
  QB: [
    { key: "cmp", label: "Cmp/Att", title: "Completions / attempts", value: (s) => `${n0(s("completions"))}/${n0(s("attempts"))}` },
    { key: "yds", label: "Yds", title: "Passing yards", value: (s) => n0(s("pass_yards")) },
    { key: "td", label: "TD", title: "Passing touchdowns", value: (s) => n0(s("pass_td")) },
    { key: "int", label: "INT", title: "Interceptions thrown", value: (s) => n0(s("interceptions")) },
    { key: "sk", label: "Sk", title: "Sacks taken", value: (s) => n0(s("sacks_taken")) },
    { key: "epa", label: "EPA/DB", title: "Expected points added per dropback (raw)", value: (s) => per(s("pass_epa"), s("dropbacks")) },
    { key: "sr", label: "Succ", title: "Success rate on dropbacks", value: (s) => pct(s("pass_success"), s("dropbacks")) },
    { key: "ru", label: "Rush", title: "Rushing yards", value: (s) => n0(s("rush_yards")) },
  ],
  RB: [
    { key: "att", label: "Att", title: "Rushes", value: (s) => n0(s("rushes")) },
    { key: "yds", label: "Yds", title: "Rushing yards", value: (s) => n0(s("rush_yards")) },
    { key: "ypc", label: "Y/A", title: "Yards per rush", value: (s) => per(s("rush_yards"), s("rushes"), 1) },
    { key: "td", label: "TD", title: "Rushing touchdowns", value: (s) => n0(s("rush_td")) },
    { key: "epa", label: "EPA/Rush", title: "Expected points added per rush (raw)", value: (s) => per(s("rush_epa"), s("rushes")) },
    { key: "sr", label: "Succ", title: "Rushing success rate", value: (s) => pct(s("rush_success"), s("rushes")) },
    { key: "rec", label: "Rec", title: "Receptions", value: (s) => n0(s("receptions")) },
    { key: "ryds", label: "Rec yds", title: "Receiving yards", value: (s) => n0(s("rec_yards")) },
  ],
  WR: [
    { key: "tgt", label: "Tgt", title: "Targets", value: (s) => n0(s("targets")) },
    { key: "rec", label: "Rec", title: "Receptions", value: (s) => n0(s("receptions")) },
    { key: "yds", label: "Yds", title: "Receiving yards", value: (s) => n0(s("rec_yards")) },
    { key: "ypt", label: "Y/Tgt", title: "Yards per target", value: (s) => per(s("rec_yards"), s("targets"), 1) },
    { key: "td", label: "TD", title: "Receiving touchdowns", value: (s) => n0(s("rec_td")) },
    { key: "epa", label: "EPA/Tgt", title: "Expected points added per target (raw)", value: (s) => per(s("target_epa"), s("targets")) },
    { key: "sr", label: "Succ", title: "Success rate when targeted", value: (s) => pct(s("target_success"), s("targets")) },
  ],
  TE: [],
  K: [
    { key: "fg", label: "FG", title: "Field goals made / tried", value: (s) => `${n0(s("fgm"))}/${n0(s("fga"))}` },
    { key: "pct", label: "Pct", title: "Field-goal percentage", value: (s) => pct(s("fgm"), s("fga")) },
    { key: "poe", label: "Pts over exp", title: "Field-goal points over the model's expectation", value: (s) => signed(s("fg_value")) },
  ],
  DL: [
    { key: "tk", label: "Tkl", title: "Tackles", value: (s) => n0(s("tackles")) },
    { key: "solo", label: "Solo", title: "Solo tackles", value: (s) => n0(s("solo")) },
    { key: "sk", label: "Sacks", title: "Sacks", value: (s) => n0(s("sacks")) },
    { key: "pbu", label: "PBU", title: "Pass breakups", value: (s) => n0(s("pbu")) },
    { key: "int", label: "INT", title: "Interceptions", value: (s) => n0(s("def_int")) },
  ],
  LB: [],
  DB: [],
};
STAT_COLS.TE = STAT_COLS.WR;
STAT_COLS.LB = STAT_COLS.DL;
STAT_COLS.DB = STAT_COLS.DL;

/** The rating's unit, per group. */
export const RATING_UNIT: Record<Group, string> = {
  QB: "per play", RB: "per touch", WR: "per target", TE: "per target", K: "per try",
  DL: "per game", LB: "per game", DB: "per game",
};
export const fmtSigned = signed;
export const fmtNum = n0;
