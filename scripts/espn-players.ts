/**
 * plays.csv, players.csv and roster.csv for one season from the ESPN-based releases and our
 * expected-points model (data/models/ep.json). Called by scripts/fetch-espn.ts.
 *
 * - Offense (passers, rushers, receivers) and kickers: every down-and-distance play of the
 *   cfbfastR play-by-play, by ESPN athlete id; garbage time is left out.
 * - Defense: sacks, interceptions and pass breakups credited in the same
 *   play-by-play (every FBS and FCS game); tackles, solo tackles, tackles for loss and QB
 *   hurries from espn_cfb_player_box, which covers games with an FBS team.
 * - Bios from espn_cfb_rosters; a player missing there gets the name and position his plays carry.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { toCsv } from "../src/engine/csv";
import { playsToCsv } from "../src/engine/data";
import { type EpModel, fieldGoalChance } from "../src/engine/ep";
import {
  PLAYER_COLUMNS,
  type PlayerGame,
  ROSTER_COLUMNS,
  type RosterPlayer,
} from "../src/engine/players-data";
import type { TeamGamePlays } from "../src/engine/types";
import { DATA_DIR } from "./lib";
import { num, release, text } from "./ncaa";
import { addEpa, espnSeasonPlays, garbage, type Who } from "./plays-sequence";

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
const CLASS: Record<string, string> = { FR: "Fr.", SO: "So.", JR: "Jr.", SR: "Sr.", GR: "Gr." };
/** ESPN's 6' 2" as 6-2. */
const height = (h: string) => {
  const m = /(\d+)'\s*(\d+)/.exec(h);
  return m ? `${m[1]}-${m[2]}` : "";
};

export async function buildEspnPlayers(year: number, dir: string, model: ReadonlySet<number>) {
  const ep = JSON.parse(readFileSync(join(DATA_DIR, "models", "ep.json"), "utf8")) as EpModel;
  const plays = await espnSeasonPlays(year);
  addEpa(plays, ep);

  // ---- bios ---------------------------------------------------------------------
  const people = new Map<number, RosterPlayer>();
  for (const r of await release("espn_cfb_rosters", `cfb_rosters_${year}.parquet`)) {
    const id = num(r.athlete_id),
      team = num(r.team_id);
    if (!Number.isSafeInteger(id) || !model.has(team) || people.has(id)) continue;
    const city = text(r.birth_place_city),
      state = text(r.birth_place_state);
    people.set(id, {
      id,
      teamId: team,
      name: text(r.full_name) || text(r.display_name),
      jersey: text(r.jersey),
      position: text(r.position_abbreviation),
      year: CLASS[text(r.experience_abbreviation).toUpperCase()] ?? text(r.experience_abbreviation),
      height: height(text(r.display_height)),
      weight: num(r.weight) || 0,
      hometown: [city, state].filter(Boolean).join(", "),
      highSchool: "",
      gamesPlayed: 0,
      gamesStarted: 0,
    });
  }
  /** The player behind an id seen on a team's play, adding him from the play if he has no bio. */
  const person = (w: Who, team: number): RosterPlayer | undefined => {
    const id = Number(w.id);
    if (!Number.isSafeInteger(id) || id <= 0 || !model.has(team)) return undefined;
    let p = people.get(id);
    if (!p) {
      p = { id, teamId: team, name: w.name || `Player ${id}`, jersey: "", position: w.position, year: "", height: "", weight: 0, hometown: "", highSchool: "", gamesPlayed: 0, gamesStarted: 0 };
      people.set(id, p);
    } else {
      if (!p.position && w.position) p.position = w.position;
      if (p.name.startsWith("Player ") && w.name) p.name = w.name;
    }
    return p;
  };

  // ---- team-game EPA and player production ------------------------------------------
  const teamGames = new Map<string, TeamGamePlays>();
  const tg = (game: number, t: number, o: number) => {
    const k = `${game}:${t}`;
    let r = teamGames.get(k);
    if (!r) teamGames.set(k, (r = { gameId: game, teamId: t, opponentId: o, snaps: 0, epa: 0, success: 0, specialEpa: 0 }));
    return r;
  };
  const lines = new Map<string, PlayerGame>();
  const pg = (game: number, p: RosterPlayer, opponent: number) => {
    const k = `${game}:${p.id}`;
    let r = lines.get(k);
    if (!r) lines.set(k, (r = emptyGame(game, p.teamId, opponent, p.id)));
    return r;
  };

  for (const p of plays) {
    const h = Number(p.homeId),
      a = Number(p.awayId);
    if (!Number.isSafeInteger(h) || !Number.isSafeInteger(a)) continue;
    if (p.offense !== p.home && p.offense !== p.away) continue;
    const off = p.offense === p.home ? h : a,
      def = off === h ? a : h;
    if (p.kickoff) {
      if (!p.kicking) continue;
      const kick = p.kicking === p.home ? h : a,
        recv = kick === h ? a : h;
      tg(p.game, kick, recv).specialEpa += p.epa;
      tg(p.game, recv, kick).specialEpa -= p.epa;
      continue;
    }
    if (!p.state) continue;
    if (p.punt || p.fieldGoal) {
      tg(p.game, off, def).specialEpa += p.epa;
      tg(p.game, def, off).specialEpa -= p.epa;
      const k = p.who.kicker && person(p.who.kicker, off);
      if (p.fieldGoal && !p.noPlay && k) {
        const g = pg(p.game, k, def);
        g.fga++;
        if (p.fieldGoalMade) g.fgm++;
        g.fgValue += 3 * ((p.fieldGoalMade ? 1 : 0) - fieldGoalChance(ep, p.ytg + 17));
      }
      continue;
    }
    if (!(p.rush || p.pass) || p.noPlay || garbage(p)) continue;
    const t = tg(p.game, off, def);
    t.snaps++;
    t.epa += p.epa;
    if (p.success) t.success++;
    const ok = p.success ? 1 : 0;
    const qb = p.pass && p.who.passer && person(p.who.passer, off);
    if (qb) {
      const g = pg(p.game, qb, def);
      g.dropbacks++;
      g.passEpa += p.epa;
      g.passSuccess += ok;
      if (p.sack) g.sacksTaken++;
      else if (p.attempt || p.completion || p.int) g.attempts++;
      if (p.completion) {
        g.completions++;
        g.passYards += p.gained;
      }
      if (p.passTd && p.scoredByOffense) g.passTd++;
      if (p.int) g.interceptions++;
    }
    const wr = p.pass && !p.sack && p.who.receiver && person(p.who.receiver, off);
    if (wr) {
      const g = pg(p.game, wr, def);
      g.targets++;
      g.targetEpa += p.epa;
      g.targetSuccess += ok;
      if (p.completion) {
        g.receptions++;
        g.recYards += p.gained;
        if (p.passTd && p.scoredByOffense) g.recTd++;
      }
    }
    const rb = p.rush && p.who.rusher && person(p.who.rusher, off);
    if (rb) {
      const g = pg(p.game, rb, def);
      g.rushes++;
      g.rushEpa += p.epa;
      g.rushSuccess += ok;
      g.rushYards += p.gained;
      if (p.rushTd && p.scoredByOffense) g.rushTd++;
    }
    // Defensive credits (the defense is the other side).
    const credit = (w: Who | undefined, field: "sacks" | "defInt" | "pbu") => {
      const d = w && person(w, def);
      if (d) pg(p.game, d, off)[field]++;
    };
    if (p.sack) credit(p.who.sacker, "sacks");
    if (p.int) credit(p.who.interceptor, "defInt");
    credit(p.who.breakup, "pbu");
  }

  // ---- tackles from the box scores (games with an FBS team) ---------------------------
  const sides = new Map<number, [number, number]>();
  for (const p of plays) if (!sides.has(p.game)) sides.set(p.game, [Number(p.homeId), Number(p.awayId)]);
  for (const r of await release("espn_cfb_player_box", `player_box_${year}.parquet`)) {
    if (text(r.category) !== "defensive") continue;
    const game = num(r.game_id),
      team = num(r.team_id),
      id = num(r.athlete_id);
    const s = sides.get(game);
    if (!s || !model.has(team) || !Number.isSafeInteger(id)) continue;
    const opp = s[0] === team ? s[1] : s[0];
    const who = { id: String(id), name: text(r.athlete_name), position: "" };
    const pl = person(who, team);
    if (!pl) continue;
    const tackles = num(r.totalTackles) || 0,
      solo = num(r.soloTackles) || 0,
      tfl = num(r.tacklesForLoss) || 0,
      hurries = num(r.hurries) || 0;
    if (!(tackles || solo || tfl || hurries)) continue;
    const g = pg(game, pl, opp);
    g.tackles += tackles;
    g.solo += solo;
    g.tfl += tfl;
    g.hurries += hurries;
    if (!pl.jersey && text(r.jersey)) pl.jersey = text(r.jersey);
  }

  // ---- write ------------------------------------------------------------------------
  const teamRows = [...teamGames.values()]
    .filter((r) => model.has(r.teamId) || model.has(r.opponentId))
    .map((r) => ({ ...r, epa: r6(r.epa), specialEpa: r6(r.specialEpa) }));
  writeFileSync(join(dir, "plays.csv"), playsToCsv(teamRows));
  const rows = [...lines.values()].sort((a, b) => a.gameId - b.gameId || a.playerId - b.playerId);
  const camel = (c: string) => c.replace(/_([a-z])/g, (_, x: string) => x.toUpperCase());
  writeFileSync(
    join(dir, "players.csv"),
    toCsv(PLAYER_COLUMNS, rows.map((g) => PLAYER_COLUMNS.map((c) => r6((g as unknown as Record<string, number>)[camel(c)]!)))),
  );
  const used = new Set(rows.map((g) => g.playerId));
  const roster = [...people.values()].filter((p) => used.has(p.id)).sort((a, b) => a.id - b.id);
  writeFileSync(
    join(dir, "roster.csv"),
    toCsv(
      ROSTER_COLUMNS,
      roster.map((p) => [p.id, p.teamId, p.name, p.jersey, p.position, p.year, p.height, p.weight || "", p.hometown, p.highSchool, p.gamesPlayed, p.gamesStarted]),
    ),
  );
  console.log(`fetch ${year}: ${plays.length} plays -> ${teamRows.length} team-games, ${rows.length} player-games, ${roster.length} players`);
}

function emptyGame(gameId: number, teamId: number, opponentId: number, playerId: number): PlayerGame {
  return {
    gameId, teamId, opponentId, playerId,
    dropbacks: 0, passEpa: 0, passSuccess: 0, attempts: 0, completions: 0, passYards: 0,
    passTd: 0, interceptions: 0, sacksTaken: 0,
    rushes: 0, rushEpa: 0, rushSuccess: 0, rushYards: 0, rushTd: 0,
    targets: 0, targetEpa: 0, targetSuccess: 0, receptions: 0, recYards: 0, recTd: 0,
    fga: 0, fgm: 0, fgValue: 0,
    tackles: 0, solo: 0, tfl: 0, hurries: 0, sacks: 0, pbu: 0, defInt: 0,
  };
}
