import { computeSeason } from "../../src/engine/season";
import type { Ctx } from "../ctx";
import { h } from "../dom";
import { pillarIcons } from "../icons";
import { fetchText, rankingPath, seasonFiles } from "../store";

/** Held-out test, 2021–2025 plus 2026 through week 6 (research/). [name, next-week picks, winner above loser at season end] */
const ACCURACY: [string, number, number][] = [
  ["This rating", 70.3, 86.5],
  ["Same rating without the tiebreaker", 70.5, 80.9],
  ["Massey with home field", 70.2, 80.4],
  ["Elo carried over from last season", 69.7, 80.3],
  ["Massey", 69.7, 80.2],
  ["LRMC", 69.5, 80.7],
  ["Elo", 68.5, 81.8],
  ["Bradley–Terry", 67.3, 83.2],
  ["Colley", 67.0, 82.5],
  ["Win percentage", 66.2, 78.9],
];

export function aboutView(ctx: Ctx): HTMLElement {
  const m = ctx.ranking.manifest;
  const season = ctx.entry.season;
  const files = seasonFiles(season);

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
        ...(m.playsSha256 ? { playsCsv: await fetchText(files.playsCsv) } : {}),
      }, async (done, total) => {
        result.textContent = `Recomputing ${season} from the raw CSVs in your browser: ${done} of ${total} ranking files…`;
        await new Promise((r) => setTimeout(r, 0));
      });
      const bad: string[] = [];
      for (const f of out.files) if ((await fetchText(rankingPath(season, f.id))) !== f.json) bad.push(f.id);
      const ms = Math.round(performance.now() - t0);
      if (bad.length === 0) {
        result.className = "result ok";
        result.replaceChildren(h("b", {}, "✓"), h("span", {}, `Exact match. Your browser rebuilt all ${out.files.length} ${season} rankings from the raw data in ${(ms / 1000).toFixed(1)} s and produced the published files byte for byte.`));
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
    ["Win bonus", `${m.winBonus} points`], ["Pull toward average", `${m.shrink} games’ worth, the same for every team`], ["Head-to-head window", `${m.headToHeadWindow} points`],
    ["Home field (fitted)", `${m.homeField.toFixed(2)} points`], ["Divisions", m.classifications.map((c) => c.toUpperCase()).join(" + ")],
    ["Games counted", String(m.counts.included)], ["Outside FBS/FCS", String(m.counts.outOfScope)], ["Not yet played", String(m.counts.incomplete)], ["Tied scores", String(m.counts.tied)],
  ];
  const bars = (k: 1 | 2, lo: number) => {
    const best = Math.max(...ACCURACY.map((r) => r[k]));
    return h("div", { class: "acc" }, ...[...ACCURACY].sort((a, b) => b[k] - a[k]).map((r) =>
      h("div", { class: `accrow${r[0] === "This rating" ? " me" : ""}` },
        h("span", { class: "n" }, r[0]),
        h("span", { class: "bar" }, h("i", { style: `width:${((r[k] - lo) / (best - lo)) * 100}%` })),
        h("span", { class: "v" }, `${r[k].toFixed(1)}%`))));
  };

  return h("div", { class: "method" },
    h("section", { class: "hero" },
      h("div", { class: "eyebrow" }, "Methodology"),
      h("h1", {}, "Computed,", h("br"), h("em", {}, "not voted.")),
      h("p", { class: "lede" }, "Polls ask people what they think. This asks the scoreboard. Every FBS and FCS team gets a ", h("b", {}, "rating"), ": how many points better it is than an average FBS or FCS team, judged by every score this season and who it came against. The higher the rating, the higher the rank.")),
    h("div", { class: "pillars" },
      pillar(pillarIcons.deterministic(), "Deterministic", "Same scores in, identical bytes out. One exact calculation, no randomness, no judgement calls."),
      pillar(pillarIcons.auditable(), "Auditable", "Every score, line of code and published result is public. Recompute any week yourself below."),
      pillar(pillarIcons.transparent(), "Transparent", "One formula and one config file. Every team page shows exactly which games put it where it is."),
      pillar(pillarIcons.unbiased(), "Unbiased", "No votes, no preseason, no brand, no conference bonus. Every team starts the season level, and every input is a final score from this season.")),

    h("h2", {}, "What each game says"),
    h("p", {}, "Every game is evidence about both teams. If you beat a team rated +10 by 14 points on a neutral field, that game says you are about ", h("b", {}, `+10 + 14 + ${m.winBonus} = +${24 + m.winBonus}`), ": the opponent’s rating, plus your margin, plus ", h("b", {}, `${m.winBonus} points for winning`), ` (a loss takes ${m.winBonus} off instead). Home teams have to win by more: a home game’s value is reduced by the home-field edge, which the data sets each week (`, h("b", {}, `${m.homeField.toFixed(1)} points`), " right now), and an away game’s is raised by it."),
    h("p", {}, "A team’s rating is the ", h("b", {}, "average of what all its games say"), " (plus any head-to-head holds, below). Because every opponent’s rating depends on its own games, all teams are solved together, in one exact system of equations. Every rating is also nudged very slightly toward average, as if each team had played ", h("b", {}, `${m.shrink} of a game`), " against an average opponent, so one game can’t send a team to an extreme. The nudge is the same for every team."),
    h("pre", { class: "formula" }, `minimise   Σ games (result − (r[home] − r[away] + H · home))²\n         + ${m.shrink} · Σ teams r[i]²\n\n`,
      h("span", { class: "c" }, `result   home margin, plus ${m.winBonus} if home won, minus ${m.winBonus} if home lost\nr[i]     rating of team i (the y-axis of the graph), in points\nH        home-field edge in points; home is 1 for a true home game, 0 at a neutral site\n${m.shrink}     the same small pull toward 0 (average) for every team`)),
    h("p", {}, "Setting the slope to zero gives one symmetric linear system, solved exactly with a Cholesky decomposition using only + − × / and √ in a fixed order. No iterations, no random starts. The same scores give the same answer, to the last bit, on any computer."),

    h("h2", {}, "Head-to-head breaks close calls"),
    h("p", {}, "If two teams are rated within ", h("b", {}, `${m.headToHeadWindow} points`), " (a field goal) and the lower one beat the higher one, head-to-head decides: the winner is held at least ½ point above the loser, and the whole ladder is worked out again with that hold, so everyone around them adjusts consistently. New close pairs that appear are checked the same way until nothing changes. Teams further apart keep their places: one upset doesn’t outweigh a season of results."),
    h("p", {}, "When close results contradict each other (A beat B, B beat C, C beat A), the closest calls are applied first and a hold that would contradict them is skipped. ", `This week ${ctx.ranking.held.length} games were decided this way; team pages tag them H2H.`),

    h("h2", {}, "Every team starts level"),
    h("p", {}, "There is no preseason ranking, no carry-over from last season and no recruiting or reputation input. In week 1 every team is equal, and only this season’s games move anyone. Early-season rankings are therefore volatile: until teams have played a few connected games, one blowout can move a team a long way."),
    h("p", { class: "muted" }, "That choice costs some accuracy. Starting each team from 90% of last season’s rating picked 71.9% of next-week winners in the held-out test, against 70.5% without it. We leave it out so the ranking judges this season only."),

    h("h2", {}, "Offense, defense and special teams"),
    h("p", {}, "Separate rankings come from play-by-play (public cfbfastR data from the sportsdataverse project, which covers games with an FBS team). Every snap carries an expected-points value: how much it changed the points the offense could expect to score. For each team and game we add up its offense’s expected points per snap, leaving out garbage time (a lead of more than 38 points in the second quarter, 28 in the third or 22 in the fourth), and its net expected points on kickoffs, punts and field goals."),
    h("p", {}, "Then the same kind of fit as the overall rating: a team’s offense is judged against the defenses it faced, its defense against the offenses, both adjusted for home field, with every team starting level. Ratings are shown as points per game better than average."),
    h("p", { class: "muted" }, "Why doesn’t play-by-play drive the overall ranking? We tested it. Unit ratings on their own, mixes of them with the score rating, and expected points or success rate folded into each game’s result all picked next week’s winners slightly worse than final scores did on 2015–2019 (best 73.0% vs 73.1%). Per game, expected-points margin and the final margin correlate at 0.93, so scores already carry most of what the plays say."),

    h("h2", {}, "How accurate it is"),
    h("p", {}, "Two tests on seasons the model never saw while it was designed (2021–2025 plus 2026 so far). First: every week from week 4, each method ranks teams using only the games already played and predicts the next week’s games (6,287 games)."),
    bars(1, 60),
    h("p", {}, "Second: at the end of each season, how often the final ranking has the winner of a game above the loser."),
    bars(2, 70),
    h("p", { class: "muted" }, "The tiebreaker costs a fifth of a point of prediction (70.3% against 70.5%) and puts the winner above the loser in 86.5% of games instead of 80.9%. With it, the rating is still level with the best known predictor (Massey with home field) and ahead of the rest, including Elo carried over from last season. A window of 3 points was chosen on 2014–2019: wider windows let head-to-head pull teams too far and made both measures worse. The full benchmark is in the repository’s research folder. Systems built on recruiting, returning players or betting markets were not tested."),

    h("h2", {}, "What counts"),
    h("ul", {},
      h("li", {}, h("b", {}, "The final score of each completed game"), " between two FBS or FCS teams, regular season and postseason, and whether it was at home or on a neutral field."),
      h("li", {}, "Brand, conference, polls and opinions are ignored. Conference strength comes only from games between conferences."),
      h("li", {}, "Games against teams outside FBS/FCS are left out, and the count is published below."),
      h("li", {}, "A team with no counted games yet is ", h("b", {}, "unranked"), " rather than guessed."),
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
      h("p", { class: "muted" }, `This downloads the exact CSV files the ${season} rankings were built from, runs the same engine in your browser, and compares the result with every published file.`),
      button, result),

    h("h2", {}, `Receipt: ${ctx.ranking.snapshot.label}, ${season}`),
    h("table", { class: "mf" }, h("tbody", {},
      ...rows.map(([k, v]) => h("tr", {}, h("th", {}, k), h("td", {}, v))),
      h("tr", {}, h("th", {}, "teams.csv SHA-256"), h("td", {}, h("code", {}, m.teamsSha256))),
      h("tr", {}, h("th", {}, "games.csv SHA-256"), h("td", {}, h("code", {}, m.gamesSha256))),
      ...(m.playsSha256 ? [h("tr", {}, h("th", {}, "plays.csv SHA-256"), h("td", {}, h("code", {}, m.playsSha256)))] : []),
      )),
    h("div", { class: "files" }, file(files.teamsCsv), file(files.gamesCsv), file(files.configJson), ...(m.playsSha256 ? [file(files.playsCsv)] : []),
      file(rankingPath(season, ctx.snapId)),
      h("a", { href: "https://github.com/sambennettdev/rank/blob/main/docs/METHODOLOGY.md", target: "_blank", rel: "noopener" }, "METHODOLOGY.md ↗")),
  );
}
