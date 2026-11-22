// Temporary research probe, run by .github/workflows/espn-probe.yml from GitHub Actions:
// can ncaa.com's game data and CFBD be reached from Actions, and how complete and fresh is
// their FBS/FCS coverage? Writes small summaries and samples to tmp-espn/out2/.
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = new URL("./out2/", import.meta.url);
mkdirSync(OUT, { recursive: true });
const log = [];
const say = (s) => { console.log(s); log.push(s); writeFileSync(new URL("log.txt", OUT), log.join("\n") + "\n"); };
const save = (name, v) => writeFileSync(new URL(name, OUT), typeof v === "string" ? v : JSON.stringify(v, null, 1));
process.on("unhandledRejection", (e) => { say(`FATAL ${e?.stack ?? e}`); process.exit(1); });
say(`probe2 start ${new Date().toISOString()}`);

async function get(url, headers = {}, tries = 3) {
  for (let i = 1; ; i++) {
    const r = await fetch(url, { headers: { "User-Agent": "rank-data-fetch", ...headers } }).catch((e) => ({ ok: false, status: String(e) }));
    if (r.ok) return { status: 200, json: await r.json() };
    if (i >= tries || r.status === 401 || r.status === 403 || r.status === 404) return { status: r.status, json: null };
    await new Promise((res) => setTimeout(res, 1000 * i));
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- ncaa.com (sdataprod GraphQL persisted queries, as used by henrygd/ncaa-api) ----------
const GQL = "https://sdataprod.ncaa.com/";
const q = (hash, vars) => `${GQL}?extensions=${encodeURIComponent(JSON.stringify({ persistedQuery: { version: 1, sha256Hash: hash } }))}&variables=${encodeURIComponent(JSON.stringify(vars))}`;
const SCOREBOARD = "7287cda610a9326931931080cb3a604828febe6fe3c9016a7e4a36db99efdb7c";
const BOX_FB = "babb939def47c602a6e81af7aa3f6b35197fb1f1b1a2f2b081f3a3e4924be82e";
const PBP_FB = "47928f2cabc7a164f0de0ed535a623bdf5a852cce7c30d6a6972a38609ba46a2";
const GAME = "93a02c7193c89d85bcdda8c1784925d9b64657f73ef584382e2297af555acd4b";

const ncaa = {};
for (const [div, code] of [["fbs", 11], ["fcs", 12]]) {
  for (const week of [12, 13]) {
    const r = await get(q(SCOREBOARD, { sportCode: "MFB", division: code, seasonYear: 2026, week }));
    const contests = r.json?.data?.contests ?? [];
    const final = contests.filter((c) => /final/i.test(JSON.stringify(c.gameState ?? c.contestClock ?? c.finalMessage ?? "")) || c.gameState === "F");
    say(`ncaa scoreboard ${div} week ${week}: HTTP ${r.status}, ${contests.length} contests, ${final.length} look final`);
    ncaa[`${div}${week}`] = contests;
    if (week === 13 && div === "fcs") save("ncaa_scoreboard_fcs_w13.json", r.json);
    await sleep(400);
  }
}
// Box score and play-by-play coverage for FCS week 12 (and samples).
const fcs12 = ncaa.fcs12 ?? [];
let box = 0, pbp = 0, tried = 0;
for (const c of fcs12.slice(0, 40)) {
  const id = c.contestId ?? c.id;
  if (!id) continue;
  tried++;
  const b = await get(q(BOX_FB, { contestId: String(id), staticTestEnv: null }));
  const p = await get(q(PBP_FB, { contestId: String(id), staticTestEnv: null }));
  const hasBox = (b.json?.data?.boxscore?.teamBoxscore?.[0]?.playerStats ?? []).length > 0 || JSON.stringify(b.json?.data?.boxscore ?? {}).length > 2000;
  const plays = (p.json?.data?.playbyplay?.periods ?? []).reduce((a, x) => a + (x.playbyplayStats?.length ?? 0), 0);
  if (hasBox) box++;
  if (plays > 0) pbp++;
  if (tried === 1) {
    save(`ncaa_box_${id}.json`, b.json);
    save(`ncaa_pbp_${id}.json`, p.json);
    save(`ncaa_game_${id}.json`, (await get(q(GAME, { id: String(id), week: null, staticTestEnv: null }))).json);
  }
  await sleep(500);
}
say(`ncaa FCS week 12: ${tried} games tried, ${box} with a box score, ${pbp} with play-by-play`);

// ---- CFBD (official API, repository key) -------------------------------------------------
const KEY = process.env.CFBD_API_KEY;
const CFBD = "https://api.collegefootballdata.com";
const cf = (path) => get(`${CFBD}${path}`, { Authorization: `Bearer ${KEY}`, Accept: "application/json" });
if (!KEY) say("CFBD: no CFBD_API_KEY in this run");
else {
  const info = await cf("/info");
  say(`CFBD /info: HTTP ${info.status} ${JSON.stringify(info.json)}`);
  const summary = {};
  for (const [label, path] of [
    ["games_fcs_w12", "/games?year=2026&week=12&classification=fcs"],
    ["games_fcs_w13", "/games?year=2026&week=13&classification=fcs"],
    ["plays_fcs_w12", "/plays?year=2026&week=12&classification=fcs"],
    ["plays_fcs_w13", "/plays?year=2026&week=13&classification=fcs"],
    ["players_fcs_w12", "/games/players?year=2026&week=12&classification=fcs"],
    ["roster_fcs", "/roster?year=2026&classification=fcs"],
  ]) {
    const r = await cf(path);
    const arr = Array.isArray(r.json) ? r.json : [];
    const games = new Set(arr.map((x) => x.gameId ?? x.id));
    const completed = arr.filter((x) => x.completed).length;
    summary[label] = { status: r.status, rows: arr.length, games: games.size, completed };
    say(`CFBD ${label}: HTTP ${r.status}, ${arr.length} rows, ${games.size} distinct games${label.startsWith("games") ? `, ${completed} completed` : ""}`);
    save(`cfbd_${label}_sample.json`, arr.slice(0, 3));
    if (label === "plays_fcs_w12") {
      const byGame = {};
      for (const x of arr) byGame[x.gameId] = (byGame[x.gameId] ?? 0) + 1;
      save("cfbd_plays_fcs_w12_per_game.json", byGame);
    }
  }
  const after = await cf("/info");
  say(`CFBD /info after: ${JSON.stringify(after.json)}`);
  save("cfbd_summary.json", summary);
}
say(`probe2 done ${new Date().toISOString()}`);
