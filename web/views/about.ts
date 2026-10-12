import { computeSeason } from "../../src/engine/season";
import type { Ctx } from "../ctx";
import { h } from "../dom";
import { pillarIcons } from "../icons";
import { fetchText, rankingPath, seasonFiles } from "../store";

/** Held-out test, 2021–2025 plus 2026 through week 6 (research/holdout-results.txt). */
const ACCURACY: [string, number][] = [
  ["This rating", 71.9],
  ["Massey with home field", 70.2],
  ["Elo carried over from last season", 69.7],
  ["LRMC", 69.5],
  ["Elo", 68.5],
  ["Keener", 68.2],
  ["Bradley–Terry", 67.3],
  ["Colley", 67.0],
  ["Win percentage", 66.2],
];

export function aboutView(ctx: Ctx): HTMLElement {
  const m = ctx.ranking.manifest;
  const season = ctx.entry.season;
  const files = seasonFiles(season);
  const prior = ctx.entry.priorSeason;
  const priorFiles = prior ? seasonFiles(prior) : null;

  const result = h("div");
  const button = h("button", { class: "btn primary", onclick: async () => {
    button.disabled = true;
    result.className = "result run";
    result.textContent = "Downloading the raw CSVs and recomputing every snapshot in your browser…";
    try {
      const t0 = performance.now();
      const out = await computeSeason({
        season,
        teamsCsv: await fetchText(files.teamsCsv),
        gamesCsv: await fetchText(files.gamesCsv),
        configJson: await fetchText(files.configJson),
        previous: prior && priorFiles ? { season: prior, teamsCsv: await fetchText(priorFiles.teamsCsv), gamesCsv: await fetchText(priorFiles.gamesCsv) } : undefined,
      }, async (done, total) => {
        result.textContent = `Recomputing ${season} from the raw CSVs in your browser: ${done} of ${total} ranking files…`;
        await new Promise((r) => setTimeout(r, 0));
      });
      const bad: string[] = [];
      for (const f of out.files) if ((await fetchText(rankingPath(season, f.id))) !== f.json) bad.push(f.id);
      const ms = Math.round(performance.now() - t0);
      if (bad.length === 0) {
        result.className = "result ok";
        result.replaceChildren(h("b", {}, "✓"), h("span", {}, `Exact match. Your browser rebuilt all ${out.files.length} ${season} rankings from the raw data${prior ? ` (and ${prior}’s for the starting points)` : ""} in ${(ms / 1000).toFixed(1)} s and produced the published files byte for byte.`));
      } else {
        result.className = "result bad";
        result.replaceChildren(h("b", {}, "✗"), h("span", {}, `Mismatch in ${bad.join(", ")}. The published rankings do not follow from the published data. Please open an issue.`));
      }
    } catch (err) {
      result.className = "result bad";
      result.textContent = `Could not recompute: ${err instanceof Error ? err.message : String(err)}`;
    }
    button.disabled = false;
  } }, "Recompute in my browser");

  const pillar = (icon: SVGSVGElement, title: string, text: string) => h("div", { class: "pillar" }, h("div", { class: "ic" }, icon), h("b", {}, title), h("p", {}, text));
  const file = (path: string) => h("a", { href: `./data/${path}`, target: "_blank", rel: "noopener" }, path.split("/").slice(-2).join("/"));
  const rows: [string, string][] = [
    ["Engine", m.engine], ["Algorithm", m.algorithmVersion],
    ["Win bonus", `${m.winBonus} points`], ["Starting point", `${Math.round(m.carryover * 100)}% of last season’s final rating, counted as ${m.priorWeight} games`],
    ["Home field (fitted)", `${m.homeField.toFixed(2)} points`], ["Divisions", m.classifications.map((c) => c.toUpperCase()).join(" + ")],
    ["Games counted", String(m.counts.included)], ["Outside FBS/FCS", String(m.counts.outOfScope)], ["Not yet played", String(m.counts.incomplete)], ["Tied scores", String(m.counts.tied)],
  ];
  const best = ACCURACY[0]![1];

  return h("div", { class: "method" },
    h("section", { class: "hero" },
      h("div", { class: "eyebrow" }, "Methodology"),
      h("h1", {}, "Computed,", h("br"), h("em", {}, "not voted.")),
      h("p", { class: "lede" }, "Polls ask people what they think. This asks the scoreboard. Every FBS and FCS team gets a ", h("b", {}, "rating"), ": how many points better it is than an average FBS team, judged by every score this season and who it came against. The higher the rating, the higher the rank.")),
    h("div", { class: "pillars" },
      pillar(pillarIcons.deterministic(), "Deterministic", "Same scores in, identical bytes out. One exact calculation, no randomness, no judgement calls."),
      pillar(pillarIcons.auditable(), "Auditable", "Every score, line of code and published result is public. Recompute any week yourself below."),
      pillar(pillarIcons.transparent(), "Transparent", "One formula and one config file. Every team page shows exactly which games put it where it is."),
      pillar(pillarIcons.unbiased(), "Unbiased", "No votes, no brand, no conference bonus. Every input is a final score. Last season counts only as a starting point that this season’s games quickly outweigh.")),

    h("h2", {}, "What each game says"),
    h("p", {}, "Every game is evidence about both teams. If you beat a team rated +10 by 14 points on a neutral field, that game says you are about ", h("b", {}, `+10 + 14 + ${m.winBonus} = +${24 + m.winBonus}`), ": the opponent’s rating, plus your margin, plus ", h("b", {}, `${m.winBonus} points for winning`), ` (a loss takes ${m.winBonus} off instead). Home teams have to win by more: a home game’s value is reduced by the home-field edge, which the data sets each week (`, h("b", {}, `${m.homeField.toFixed(1)} points`), " right now), and an away game’s is raised by it."),
    h("p", {}, "A team’s rating is the ", h("b", {}, "average of what all its games say"), ", together with its starting point counted as ", h("b", {}, `${m.priorWeight} games`), ". Because every opponent’s rating depends on its own games, all teams are solved together, in one exact system of equations."),
    h("pre", { class: "formula" }, `minimise   Σ games (result − (r[home] − r[away] + H · home))²\n         + ${m.priorWeight} · Σ teams (r[i] − start[i])²\n\n`,
      h("span", { class: "c" }, `result   home margin, plus ${m.winBonus} if home won, minus ${m.winBonus} if home lost\nr[i]     rating of team i (the y-axis of the graph), in points\nH        home-field edge in points; home is 1 for a true home game, 0 at a neutral site\nstart[i] ${m.carryover} × team i's final rating last season`)),
    h("p", {}, "Setting the slope to zero gives one symmetric linear system, solved exactly with a Cholesky decomposition using only + − × / and √ in a fixed order. No iterations, no random starts. The same scores give the same answer, to the last bit, on any computer."),

    h("h2", {}, "The starting point"),
    h("p", {}, `Each team starts the season at ${Math.round(m.carryover * 100)}% of its final rating from last season, worked out from last season’s games alone (average FBS team = 0). A team that wasn’t in last season’s data starts at its division’s average. The starting point counts as ${m.priorWeight} games, so it matters most in September; by midseason a team’s own games outweigh it several times over. No polls, recruiting rankings or opinions go into it: it is last season’s scores.`),
    prior ? h("p", { class: "muted" }, `This season starts from ${prior}.`) : "",

    h("h2", {}, "How accurate it is"),
    h("p", {}, "The test: every week from week 4, each method ranks teams using only the games already played and predicts the next week’s games (the higher-ranked team wins). Settings were chosen on 2014–2019 and then frozen. These numbers are from 2021–2025 plus 2026 so far, which the model never saw while it was designed: 6,287 games."),
    h("div", { class: "acc" }, ...ACCURACY.map(([name, pct], i) =>
      h("div", { class: `accrow${i === 0 ? " me" : ""}` },
        h("span", { class: "n" }, name),
        h("span", { class: "bar" }, h("i", { style: `width:${((pct - 60) / (best - 60)) * 100}%` })),
        h("span", { class: "v" }, `${pct.toFixed(1)}%`)))),
    h("p", { class: "muted" }, "It beat the best known method in each of those six seasons, by 1.6 points overall (95% confidence interval +0.9 to +2.4). On FBS-vs-FBS games it also beats CollegeFootballData’s own Elo rating by 0.7 points. The full benchmark is in the repository’s research folder. Systems built on recruiting, returning players or betting markets were not tested."),

    h("h2", {}, "What counts"),
    h("ul", {},
      h("li", {}, h("b", {}, "The final score of each completed game"), " between two FBS or FCS teams, regular season and postseason, and whether it was at home or on a neutral field."),
      h("li", {}, "Brand, conference, polls and opinions are ignored. Conference strength comes only from games between conferences."),
      h("li", {}, "Games against teams outside FBS/FCS are left out, and the count is published below."),
      h("li", {}, "A team with no counted games yet is ", h("b", {}, "unranked"), " rather than placed by its starting point alone."),
      h("li", {}, "Equal ratings share a rank (shown T-n). Ties are never broken by name or reputation."),
      h("li", {}, "Week N uses only games through week N, recomputed from scratch.")),

    h("h2", {}, "How data flows"),
    h("div", { class: "pipeline" },
      h("div", { class: "pipe" }, h("div", { class: "n" }, "01"), h("b", {}, "Fetch"), "Scores pulled weekly from CollegeFootballData."),
      h("div", { class: "pipe" }, h("div", { class: "n" }, "02"), h("b", {}, "Commit"), "Saved as plain CSV in git, so every change is on the record."),
      h("div", { class: "pipe" }, h("div", { class: "n" }, "03"), h("b", {}, "Compute"), "Open-source engine turns scores into ratings."),
      h("div", { class: "pipe" }, h("div", { class: "n" }, "04"), h("b", {}, "Verify"), "CI and your browser recompute and compare byte for byte.")),

    h("h2", {}, "Check it yourself"),
    h("div", { class: "verify" },
      h("h3", {}, "Don’t trust us. Recompute it."),
      h("p", { class: "muted" }, `This downloads the exact CSV files the ${season} rankings were built from${prior ? `, plus ${prior}’s for the starting points` : ""}, runs the same engine in your browser, and compares the result with every published file.`),
      button, result),

    h("h2", {}, `Receipt: ${ctx.ranking.snapshot.label}, ${season}`),
    h("table", { class: "mf" }, h("tbody", {},
      ...rows.map(([k, v]) => h("tr", {}, h("th", {}, k), h("td", {}, v))),
      h("tr", {}, h("th", {}, "teams.csv SHA-256"), h("td", {}, h("code", {}, m.teamsSha256))),
      h("tr", {}, h("th", {}, "games.csv SHA-256"), h("td", {}, h("code", {}, m.gamesSha256))),
      ...(m.priorSeason ? [
        h("tr", {}, h("th", {}, `${m.priorSeason.season} teams.csv SHA-256`), h("td", {}, h("code", {}, m.priorSeason.teamsSha256))),
        h("tr", {}, h("th", {}, `${m.priorSeason.season} games.csv SHA-256`), h("td", {}, h("code", {}, m.priorSeason.gamesSha256))),
      ] : []))),
    h("div", { class: "files" }, file(files.teamsCsv), file(files.gamesCsv), file(files.configJson),
      ...(priorFiles ? [file(priorFiles.teamsCsv), file(priorFiles.gamesCsv)] : []),
      file(rankingPath(season, ctx.snapId)),
      h("a", { href: "https://github.com/sambennettdev/rank/blob/main/docs/METHODOLOGY.md", target: "_blank", rel: "noopener" }, "METHODOLOGY.md ↗")),
  );
}
