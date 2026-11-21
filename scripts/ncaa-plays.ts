/**
 * plays.csv, players.csv and roster.csv for one season, from the NCAA stats mirror and our
 * expected-points model (data/models/ep.json). Called by scripts/fetch-ncaa.ts.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { toCsv } from "../src/engine/csv";
import { playsToCsv } from "../src/engine/data";
import { type EpModel, fieldGoalChance } from "../src/engine/ep";
import {
  PLAYER_COLUMNS,
  ROSTER_COLUMNS,
  type PlayerGame,
  type RosterPlayer,
} from "../src/engine/players-data";
import type { TeamGamePlays } from "../src/engine/types";
import { DATA_DIR } from "./lib";
import { mirror, num, text } from "./ncaa";
import { addEpa, garbage, seasonPlays } from "./ncaa-sequence";

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
/** "Jeffrey Overton Jr." and "Jeffrey Overton" are the same player within a team. */
export const nameKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "")
    .replace(/[^a-z]/g, "");

/** A stable id for a player missing from his team's roster (900,000,000 and up). */
const hashId = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return 900_000_000 + (h % 99_000_000);
};

export async function buildPlays(
  year: number,
  dir: string,
  ourId: (ncaaId: string) => number,
  ncaaName: Map<string, string>,
  _lines: unknown,
) {
  const model = JSON.parse(
    readFileSync(join(DATA_DIR, "models", "ep.json"), "utf8"),
  ) as EpModel;
  const plays = await seasonPlays(year);
  addEpa(plays, model);

  const byName = new Map<string, string>();
  for (const [id, name] of ncaaName) if (!byName.has(name)) byName.set(name, id);
  const missingNames = new Set<string>();
  const team = (name: string) => {
    const id = byName.get(name);
    if (!id) missingNames.add(name);
    return id;
  };

  // ---- rosters ---------------------------------------------------------------
  const rosterRows = await mirror("ncaa_mfb_rosters", year);
  /** our team id + name key -> roster entry */
  const roster = new Map<string, RosterPlayer>();
  const rosterByJersey = new Map<string, RosterPlayer>();
  for (const r of rosterRows) {
    const t = ourId(text(r.team_id));
    const p: RosterPlayer = {
      id: Number(text(r.player_id)) || hashId(`${t}:${text(r.player_name)}`),
      teamId: t,
      name: text(r.player_name),
      jersey: text(r.jersey),
      position: text(r.position),
      year: text(r.player_class),
      height: text(r.height),
      weight: num(r.weight) || 0,
      hometown: text(r.hometown),
      highSchool: text(r.high_school),
      gamesPlayed: num(r.games_played) || 0,
      gamesStarted: num(r.games_started) || 0,
    };
    roster.set(`${t}:${nameKey(p.name)}`, p);
    if (p.jersey) rosterByJersey.set(`${t}#${p.jersey}`, p);
  }
  /** Team rows ("TEAM", "Totals", or the school's own name) are not players. */
  const teamKeys = new Set([...ncaaName.values()].map(nameKey));
  const notPlayer = (name: string) => {
    const k = nameKey(name);
    return !k || k === "team" || k === "totals" || teamKeys.has(k);
  };
  const extra = new Map<string, RosterPlayer>();
  /** The player for a name on a team: his roster entry, or one made up from the name. */
  const player = (t: number, name: string, position = ""): RosterPlayer => {
    const key = `${t}:${nameKey(name)}`;
    const p = roster.get(key) ?? extra.get(key);
    if (p) return p;
    const made: RosterPlayer = {
      id: hashId(key),
      teamId: t,
      name,
      jersey: "",
      position,
      year: "",
      height: "",
      weight: 0,
      hometown: "",
      highSchool: "",
      gamesPlayed: 0,
      gamesStarted: 0,
    };
    extra.set(key, made);
    return made;
  };

  // ---- team-game EPA and player production from the plays ---------------------
  const teamGames = new Map<string, TeamGamePlays>();
  const tg = (game: number, t: number, o: number) => {
    const k = `${game}:${t}`;
    let r = teamGames.get(k);
    if (!r)
      teamGames.set(
        k,
        (r = { gameId: game, teamId: t, opponentId: o, snaps: 0, epa: 0, success: 0, specialEpa: 0 }),
      );
    return r;
  };
  const games = new Map<string, PlayerGame>();
  const pg = (game: number, p: RosterPlayer, opponent: number) => {
    const k = `${game}:${p.id}`;
    let r = games.get(k);
    if (!r) games.set(k, (r = emptyGame(game, p, opponent)));
    return r;
  };

  for (const p of plays) {
    const home = team(p.home),
      away = team(p.away);
    if (!home || !away) continue;
    const [h, a] = [ourId(home), ourId(away)];
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
      if (p.fieldGoal && !p.noPlay && p.kicker) {
        const k = pg(p.game, player(off, p.kicker, "K"), def);
        const chance = fieldGoalChance(model, p.ytg + 17);
        k.fga++;
        if (p.fieldGoalMade) k.fgm++;
        k.fgValue += 3 * ((p.fieldGoalMade ? 1 : 0) - chance);
      }
      continue;
    }
    if (!(p.rush || p.pass) || p.noPlay || garbage(p)) continue;
    const t = tg(p.game, off, def);
    t.snaps++;
    t.epa += p.epa;
    if (p.success) t.success++;
    const ok = p.success ? 1 : 0;
    if (notPlayer(p.passer)) p.passer = "";
    if (notPlayer(p.receiver)) p.receiver = "";
    if (notPlayer(p.rusher)) p.rusher = "";
    if (p.pass && p.passer) {
      const q = pg(p.game, player(off, p.passer, "QB"), def);
      q.dropbacks++;
      q.passEpa += p.epa;
      q.passSuccess += ok;
      if (p.sack) q.sacksTaken++;
      if (p.attempt && !p.sack) q.attempts++;
      if (p.completion) {
        q.completions++;
        q.passYards += p.gained;
      }
      if (p.passTd && p.scoredByOffense) q.passTd++;
      if (p.int) q.interceptions++;
    }
    if (p.pass && p.receiver && p.target && !p.sack) {
      const r = pg(p.game, player(off, p.receiver), def);
      r.targets++;
      r.targetEpa += p.epa;
      r.targetSuccess += ok;
      if (p.completion) {
        r.receptions++;
        r.recYards += p.gained;
        if (p.passTd && p.scoredByOffense) r.recTd++;
      }
    }
    if (p.rush && p.rusher) {
      const r = pg(p.game, player(off, p.rusher), def);
      r.rushes++;
      r.rushEpa += p.epa;
      r.rushSuccess += ok;
      r.rushYards += p.gained;
      if (p.rushTd && p.scoredByOffense) r.rushTd++;
    }
  }

  // ---- defense from the box scores -------------------------------------------
  const box = await mirror("ncaa_mfb_player_stats", year);
  const schedule = await mirror("ncaa_mfb_schedule", year, ["contest_id", "team_id", "opponent_id"]);
  const sides = new Map<string, string[]>();
  for (const r of schedule) {
    const c = text(r.contest_id);
    if (!c) continue;
    const s = sides.get(c) ?? [];
    for (const id of [text(r.team_id), text(r.opponent_id)])
      if (id && !s.includes(id)) s.push(id);
    sides.set(c, s);
  }
  // Each box score's team id is per game: match it to a side by roster names.
  const boxTeams = new Map<string, Map<string, string[]>>();
  for (const r of box) {
    const c = text(r.contest_id),
      t = text(r.team_id);
    const m = boxTeams.get(c) ?? new Map<string, string[]>();
    (m.get(t) ?? m.set(t, []).get(t)!).push(text(r.name));
    boxTeams.set(c, m);
  }
  const boxSide = new Map<string, number>();
  for (const [c, m] of boxTeams) {
    const cands = (sides.get(c) ?? []).map((id) => ourId(id));
    for (const [t, names] of m) {
      let best = 0,
        bestHits = 0;
      for (const cand of cands) {
        const hits = names.filter((n) => roster.has(`${cand}:${nameKey(n)}`)).length;
        if (hits > bestHits) [best, bestHits] = [cand, hits];
      }
      if (bestHits > 0) boxSide.set(`${c}:${t}`, best);
    }
  }
  for (const r of box) {
    const c = text(r.contest_id);
    const t = boxSide.get(`${c}:${text(r.team_id)}`);
    if (!t) continue;
    const opp = (sides.get(c) ?? []).map((id) => ourId(id)).find((x) => x !== t);
    if (opp === undefined) continue;
    const tackles = num(r.tackles) || 0,
      solo = num(r.solo_tack) || 0,
      assists = num(r.asst_tack) || 0,
      sacks = num(r.sacks) || 0,
      pbu = num(r.pbu) || 0,
      ints = num(r.int) || 0;
    if (!(tackles || solo || assists || sacks || pbu || ints)) continue;
    const name = text(r.name);
    if (notPlayer(name)) continue;
    const rp =
      roster.get(`${t}:${nameKey(name)}`) ??
      rosterByJersey.get(`${t}#${text(r.number)}`) ??
      player(t, name, text(r.position));
    const g = pg(Number(c), rp, opp);
    g.tackles += tackles || solo + assists;
    g.solo += solo;
    g.assists += assists;
    g.sacks += sacks;
    g.pbu += pbu;
    g.defInt += ints;
  }

  // ---- write ---------------------------------------------------------------------
  const teamRows = [...teamGames.values()].map((r) => ({
    ...r,
    epa: r6(r.epa),
    specialEpa: r6(r.specialEpa),
  }));
  writeFileSync(join(dir, "plays.csv"), playsToCsv(teamRows));
  const rows = [...games.values()]
    .sort((a, b) => a.gameId - b.gameId || a.playerId - b.playerId)
    .map((g) => PLAYER_COLUMNS.map((c) => {
      const v = (g as unknown as Record<string, number | string>)[COLUMN_FIELD[c]!];
      return typeof v === "number" ? r6(v) : (v ?? "");
    }));
  writeFileSync(join(dir, "players.csv"), toCsv(PLAYER_COLUMNS, rows));
  const used = new Set([...games.values()].map((g) => g.playerId));
  const people = [...roster.values(), ...extra.values()]
    .filter((p) => used.has(p.id) || p.gamesPlayed > 0)
    .sort((a, b) => a.id - b.id);
  const seen = new Set<number>();
  const uniquePeople = people.filter((p) => !seen.has(p.id) && seen.add(p.id));
  writeFileSync(
    join(dir, "roster.csv"),
    toCsv(
      ROSTER_COLUMNS,
      uniquePeople.map((p) => [
        p.id, p.teamId, p.name, p.jersey, p.position, p.year, p.height,
        p.weight || "", p.hometown, p.highSchool, p.gamesPlayed, p.gamesStarted,
      ]),
    ),
  );
  console.log(
    `fetch ${year}: ${plays.length} plays -> ${teamRows.length} team-games, ${rows.length} player-games, ${uniquePeople.length} players` +
      (missingNames.size ? `; play-by-play teams not matched: ${[...missingNames].sort().join(", ")}` : ""),
  );
}

const COLUMN_FIELD: Record<string, string> = Object.fromEntries(
  PLAYER_COLUMNS.map((c) => [c, c.replace(/_([a-z])/g, (_, x: string) => x.toUpperCase())]),
);
COLUMN_FIELD.game_id = "gameId";
COLUMN_FIELD.team_id = "teamId";
COLUMN_FIELD.opponent_id = "opponentId";
COLUMN_FIELD.player_id = "playerId";

function emptyGame(gameId: number, p: RosterPlayer, opponentId: number): PlayerGame {
  return {
    gameId, teamId: p.teamId, opponentId, playerId: p.id,
    dropbacks: 0, passEpa: 0, passSuccess: 0, attempts: 0, completions: 0, passYards: 0,
    passTd: 0, interceptions: 0, sacksTaken: 0,
    rushes: 0, rushEpa: 0, rushSuccess: 0, rushYards: 0, rushTd: 0,
    targets: 0, targetEpa: 0, targetSuccess: 0, receptions: 0, recYards: 0, recTd: 0,
    fga: 0, fgm: 0, fgValue: 0,
    tackles: 0, solo: 0, assists: 0, sacks: 0, pbu: 0, defInt: 0,
  };
}
