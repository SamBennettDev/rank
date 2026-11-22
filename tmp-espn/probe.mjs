// Temporary: run by .github/workflows/espn-probe.yml (GitHub Actions can reach ESPN; the dev
// sandbox cannot). Writes coverage and sample responses into tmp-espn/out/. Removed once the
// ESPN fetcher is built.
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = new URL("./out/", import.meta.url);
mkdirSync(OUT, { recursive: true });
const SITE = "https://site.api.espn.com/apis/site/v2/sports/football/college-football";
const log = [];
const say = (s) => {
  console.log(s);
  log.push(s);
  writeFileSync(new URL("log.txt", OUT), log.join("\n") + "\n"); // written as it goes, so a failed run still leaves a trace
};
say(`probe start ${new Date().toISOString()} node ${process.version}`);
process.on("uncaughtException", (e) => { say(`FATAL ${e?.stack ?? e}`); process.exit(1); });
process.on("unhandledRejection", (e) => { say(`FATAL ${e?.stack ?? e}`); process.exit(1); });

async function get(url, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "rank-data-fetch" } });
      if (r.ok) return await r.json();
      if (i >= tries || r.status === 404) throw new Error(`${r.status} ${url}`);
    } catch (e) {
      if (i >= tries) throw e;
    }
    await new Promise((res) => setTimeout(res, 800 * i));
  }
}
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < items.length) { const i = next++; try { out[i] = await fn(items[i], i); } catch (e) { out[i] = { error: String(e) }; } }
  }));
  return out;
}

// 1. Every scoreboard of the 2026 regular season and postseason, FBS (80) and FCS (81).
const events = new Map();
for (const group of [80, 81]) {
  for (const [seasontype, weeks] of [[2, 16], [3, 2]]) {
    for (let week = 1; week <= weeks; week++) {
      try {
        const j = await get(`${SITE}/scoreboard?groups=${group}&seasontype=${seasontype}&week=${week}&year=2026&limit=500`);
        for (const e of j.events ?? []) events.set(e.id, { e, group, seasontype, week });
        say(`scoreboard group ${group} type ${seasontype} week ${week}: ${(j.events ?? []).length} events`);
      } catch (err) { say(`scoreboard group ${group} type ${seasontype} week ${week}: ${err}`); }
    }
  }
}
// Also by date for last Saturday, to see what a date query returns.
try {
  const sat = await get(`${SITE}/scoreboard?groups=81&dates=20261121&limit=500`);
  writeFileSync(new URL("scoreboard_fcs_20261121.json", OUT), JSON.stringify(sat, null, 1));
} catch (e) { say(`date scoreboard: ${e}`); }

// 2. Coverage: for every completed game, does the summary have plays and a box score?
const done = [...events.values()].filter(({ e }) => e.competitions?.[0]?.status?.type?.completed);
say(`events ${events.size}, completed ${done.length}`);
const rows = await pool(done, 8, async ({ e, group, seasontype, week }) => {
  const s = await get(`${SITE}/summary?event=${e.id}`);
  const c = e.competitions[0];
  const comp = c.competitors ?? [];
  const home = comp.find((x) => x.homeAway === "home"), away = comp.find((x) => x.homeAway === "away");
  const drives = s.drives?.previous ?? [];
  const drivePlays = drives.reduce((a, d) => a + (d.plays?.length ?? 0), 0);
  const cats = [...new Set((s.boxscore?.players ?? []).flatMap((t) => (t.statistics ?? []).map((x) => x.name)))].sort().join("|");
  return {
    id: e.id, group, seasontype, week, date: e.date,
    home: home?.team?.id, homeName: home?.team?.displayName, homeScore: home?.score,
    away: away?.team?.id, awayName: away?.team?.displayName, awayScore: away?.score,
    neutral: c.neutralSite, plays: (s.plays ?? []).length, drives: drives.length, drivePlays,
    boxCats: cats,
  };
});
const cols = ["id", "group", "seasontype", "week", "date", "home", "homeName", "homeScore", "away", "awayName", "awayScore", "neutral", "plays", "drives", "drivePlays", "boxCats", "error"];
const q = (v) => (v === undefined || v === null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
writeFileSync(new URL("coverage.csv", OUT), [cols.join(","), ...rows.map((r) => cols.map((k) => q(r?.[k])).join(","))].join("\n") + "\n");

// 3. Full samples to build against: one FCS–FCS game and one FBS game from last week, a roster, the team list.
const pick = (g) => done.filter((x) => x.group === g && x.week >= 11).at(-1);
for (const [name, x] of [["fcs", pick(81)], ["fbs", pick(80)]]) {
  if (!x) continue;
  writeFileSync(new URL(`summary_${name}_${x.e.id}.json`, OUT), JSON.stringify(await get(`${SITE}/summary?event=${x.e.id}`), null, 1));
  const teamId = x.e.competitions[0].competitors[0].team.id;
  writeFileSync(new URL(`roster_${name}_${teamId}.json`, OUT), JSON.stringify(await get(`${SITE}/teams/${teamId}/roster`), null, 1));
}
for (const g of [80, 81]) writeFileSync(new URL(`teams_group${g}.json`, OUT), JSON.stringify(await get(`${SITE}/teams?groups=${g}&limit=400`), null, 1));
say(`probe done ${new Date().toISOString()}`);
