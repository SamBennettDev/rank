/**
 * Puts the mirror's play-by-play (ncaa_mfb_pbp_cfbfastr) in game order and works out,
 * for every play, the score before and after it, who scored on it, the next score in
 * the half, and (given a model) its expected points added.
 */
import {
  type EpModel,
  expectedPoints,
  isState,
  isSuccess,
} from "../src/engine/ep";
import { flag, mirror, num, type Row, text } from "./ncaa";

export const PBP_COLUMNS = [
  "game_id",
  "id_play",
  "period",
  "half",
  "pos_team",
  "home",
  "away",
  "pos_team_score",
  "def_pos_team_score",
  "down",
  "distance",
  "yards_to_goal",
  "yards_gained",
  "play_type",
  "rush",
  "pass",
  "sack",
  "int",
  "completion",
  "pass_attempt",
  "target",
  "pass_td",
  "rush_td",
  "touchdown",
  "punt_play",
  "fg_inds",
  "fg_made",
  "kickoff_play",
  "penalty_no_play",
  "rusher_player_name",
  "passer_player_name",
  "receiver_player_name",
  "fg_kicker_player_name",
  "yds_rushed",
  "yds_receiving",
  "yds_sacked",
];

export interface Play {
  game: number;
  half: number;
  period: number;
  offense: string;
  home: string;
  away: string;
  offenseIsHome: boolean;
  /** Score before and after the play (home, away). */
  before: [number, number];
  after: [number, number];
  /** Points scored on this play, and by which side (true = the offense). */
  scored: number;
  scoredByOffense: boolean;
  down: number;
  togo: number;
  ytg: number;
  state: boolean;
  gained: number;
  rush: boolean;
  pass: boolean;
  sack: boolean;
  int: boolean;
  completion: boolean;
  attempt: boolean;
  target: boolean;
  touchdown: boolean;
  passTd: boolean;
  rushTd: boolean;
  punt: boolean;
  fieldGoal: boolean;
  fieldGoalMade: boolean;
  kickoff: boolean;
  noPlay: boolean;
  rusher: string;
  passer: string;
  receiver: string;
  kicker: string;
  /** Next score in the half from the offense's side (TD 7, FG 3, safety 2), 0 if none. */
  nextScore: number;
  /** Set by addEpa. On a kickoff, the kicking team (the side without the ball next). */
  kicking: string;
  ep: number;
  epa: number;
  success: boolean;
}

/** Points a scoring change of `delta` stands for: TD (with its try) 7, FG 3, safety 2; 0 for tries. */
const scoreValue = (delta: number, afterTd: boolean) =>
  delta >= 6 ? 7 : delta === 3 ? 3 : delta === 2 && !afterTd ? 2 : 0;

export async function seasonPlays(year: number): Promise<Play[]> {
  const rows = await mirror("ncaa_mfb_pbp_cfbfastr", year, PBP_COLUMNS);
  return sequence(rows);
}

/** Orders plays by game and play id and annotates scores and next scores. */
export function sequence(rows: Row[]): Play[] {
  const sorted = rows
    .map((r) => ({ r, game: num(r.game_id), id: num(r.id_play) }))
    .filter((x) => Number.isFinite(x.game) && Number.isFinite(x.id))
    .sort((a, b) => a.game - b.game || a.id - b.id);
  const plays: Play[] = [];
  let prevGame = NaN,
    score: [number, number] = [0, 0],
    lastTd = -9;
  for (const { r, game } of sorted) {
    if (game !== prevGame) {
      prevGame = game;
      score = [0, 0];
      lastTd = -9;
    }
    const offense = text(r.pos_team),
      home = text(r.home),
      away = text(r.away);
    const offenseIsHome = offense === home;
    const ps = num(r.pos_team_score),
      ds = num(r.def_pos_team_score);
    const before: [number, number] = [score[0], score[1]];
    let after: [number, number] = before;
    if (Number.isFinite(ps) && Number.isFinite(ds) && (offense === home || offense === away))
      after = offenseIsHome ? [ps, ds] : [ds, ps];
    // Scores only go up; a dip is a feed error, so keep the previous score.
    if (after[0] < before[0] || after[1] < before[1]) after = before;
    const dh = after[0] - before[0],
      da = after[1] - before[1];
    const idx = plays.length;
    const value = scoreValue(Math.max(dh, da), idx - lastTd <= 2);
    if (Math.max(dh, da) >= 6) lastTd = idx;
    const homeScored = dh > da;
    const down = num(r.down),
      togo = num(r.distance),
      ytg = num(r.yards_to_goal);
    const kickoff = flag(r.kickoff_play);
    const type = text(r.play_type);
    const tryPlay = /extra point|two point|conversion/i.test(type);
    plays.push({
      game,
      half: num(r.half),
      period: num(r.period),
      offense,
      home,
      away,
      offenseIsHome,
      before,
      after,
      scored: value,
      scoredByOffense: value > 0 && homeScored === offenseIsHome,
      down,
      togo,
      ytg,
      state:
        !kickoff && !tryPlay && num(r.period) <= 4 && isState(down, togo, ytg),
      gained: num(r.yards_gained) || 0,
      rush: flag(r.rush),
      pass: flag(r.pass),
      sack: flag(r.sack),
      int: flag(r.int),
      completion: flag(r.completion),
      attempt: flag(r.pass_attempt),
      target: flag(r.target),
      touchdown: flag(r.touchdown),
      passTd: flag(r.pass_td),
      rushTd: flag(r.rush_td),
      punt: flag(r.punt_play),
      fieldGoal: flag(r.fg_inds),
      fieldGoalMade: flag(r.fg_made),
      kickoff,
      noPlay: flag(r.penalty_no_play),
      rusher: text(r.rusher_player_name),
      passer: text(r.passer_player_name),
      receiver: text(r.receiver_player_name),
      kicker: text(r.fg_kicker_player_name),
      nextScore: 0,
      kicking: "",
      ep: 0,
      epa: 0,
      success: false,
    });
    score = after;
  }
  // Next score in the half, scanning backwards.
  let pending: { game: number; half: number; value: number; homeScored: boolean } | null = null;
  for (let i = plays.length - 1; i >= 0; i--) {
    const p = plays[i]!;
    if (pending && (pending.game !== p.game || pending.half !== p.half)) pending = null;
    if (p.scored > 0)
      pending = {
        game: p.game,
        half: p.half,
        value: p.scored,
        homeScored: p.scoredByOffense === p.offenseIsHome,
      };
    if (pending)
      p.nextScore =
        pending.homeScored === p.offenseIsHome ? pending.value : -pending.value;
  }
  return plays;
}

/**
 * Expected points before each play and expected points added by it:
 *   a score on the play:  ± its points (the offense's side) − EP before
 *   otherwise:            EP of the next play's state (negated if the other team has the
 *                         ball) − EP before; 0 − EP before at the end of the half
 * Kickoffs, from the kicking team's side: − the receiving team's EP on its first play,
 * minus the model's average kickoff (kickoffs with a score on them are left at 0).
 */
export function addEpa(plays: Play[], m: EpModel) {
  for (const p of plays)
    if (p.state) {
      p.ep = expectedPoints(m, p.down, p.togo, p.ytg);
      p.success = isSuccess(p.down, p.togo, p.gained, p.touchdown && p.scoredByOffense);
    }
  for (let i = 0; i < plays.length; i++) {
    const p = plays[i]!;
    if (p.kickoff) {
      const q = nextState(plays, i);
      if (q && p.scored === 0) {
        p.kicking = q.offense === p.home ? p.away : p.home;
        p.epa = -q.ep - m.kickoff;
      }
      continue;
    }
    if (!p.state) continue;
    let value: number;
    if (p.scored > 0) value = p.scoredByOffense ? p.scored : -p.scored;
    else {
      value = 0;
      for (let j = i + 1; j < plays.length; j++) {
        const q = plays[j]!;
        if (q.game !== p.game || q.half !== p.half) break;
        if (q.scored > 0 && !q.state) break;
        if (q.state) {
          value = q.offense === p.offense ? q.ep : -q.ep;
          break;
        }
      }
    }
    p.epa = value - p.ep;
  }
}

/** The next play in the same half with a down-and-distance state, if any. */
export function nextState(plays: Play[], i: number): Play | undefined {
  const p = plays[i]!;
  for (let j = i + 1; j < plays.length; j++) {
    const q = plays[j]!;
    if (q.game !== p.game || q.half !== p.half) return undefined;
    if (q.state) return q;
  }
  return undefined;
}

/** Garbage time: a score gap above 38 in the 2nd quarter, 28 in the 3rd, 22 in the 4th. */
export function garbage(p: Play) {
  const gap = Math.abs(p.before[0] - p.before[1]);
  return (
    (p.period === 2 && gap > 38) ||
    (p.period === 3 && gap > 28) ||
    (p.period >= 4 && gap > 22)
  );
}
