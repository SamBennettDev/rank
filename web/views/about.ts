import { computeSeason } from "../../src/engine/season";
import { type Ctx, byMargin, gridironParams, homeField } from "../ctx";
import { h, svg } from "../dom";
import { pillarIcons } from "../icons";
import { fetchText, seasonFiles } from "../store";

export function aboutView(ctx: Ctx): HTMLElement {
  const m = ctx.ranking.manifest;
  const season = ctx.entry.season;
  const files = seasonFiles(season);
  const margin = byMargin(ctx);
  const g = gridironParams(ctx);

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
      });
      const bad: string[] = [];
      for (const f of out.files) if ((await fetchText(`rankings/${season}/${f.id}.json`)) !== f.json) bad.push(f.id);
      const ms = Math.round(performance.now() - t0);
      if (bad.length === 0) {
        result.className = "result ok";
        result.replaceChildren(h("b", {}, "✓"), h("span", {}, `Exact match. Your browser rebuilt all ${out.files.length} ${season} snapshots from the raw data in ${ms} ms and produced the published files byte for byte.`));
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

  return h("div", { class: "method" },
    h("section", { class: "hero" },
      h("div", { class: "eyebrow" }, "Methodology"),
      h("h1", {}, "Computed,", h("br"), h("em", {}, "not voted.")),
      h("p", { class: "lede" }, "Polls ask people what they think. This asks the games. Every FBS and FCS team is a point in a graph, every game is a spring between two teams, and a team’s rank is simply ", h("b", {}, "how high it sits"), " once the springs settle.")),
    h("div", { class: "pillars" },
      pillar(pillarIcons.deterministic(), "Deterministic", "Same games in, identical bytes out. No randomness and no judgement calls; every constant is published."),
      pillar(pillarIcons.auditable(), "Auditable", "Every input, line of code and published result is public. Check any week yourself below."),
      pillar(pillarIcons.transparent(), "Transparent", "One short formula and one config file. Every team page shows the exact games behind its rank."),
      pillar(pillarIcons.unbiased(), "Unbiased", g
        ? "No preseason poll, brand, conference or opinions. Only final scores, who played whom, and where."
        : margin
        ? "No preseason poll, brand, conference or home field. Only who won and by how much."
        : "No preseason poll, brand, conference or margin of victory. Only who beat whom.")),

    ...(g ? gridironSections(ctx) : springRankSections(margin)),

    h("h2", {}, "How data flows"),
    h("div", { class: "pipeline" },
      h("div", { class: "pipe" }, h("div", { class: "n" }, "01"), h("b", {}, "Fetch"), "Scores pulled weekly from CollegeFootballData."),
      h("div", { class: "pipe" }, h("div", { class: "n" }, "02"), h("b", {}, "Commit"), "Saved as plain CSV in git, so every change is on the record."),
      h("div", { class: "pipe" }, h("div", { class: "n" }, "03"), h("b", {}, "Compute"), "Open-source engine turns games into heights."),
      h("div", { class: "pipe" }, h("div", { class: "n" }, "04"), h("b", {}, "Verify"), "CI and your browser recompute and compare byte for byte.")),

    h("h2", {}, "Check it yourself"),
    h("div", { class: "verify" },
      h("h3", {}, "Don’t trust us. Recompute it."),
      h("p", { class: "muted" }, `This downloads the exact CSV files the ${season} rankings were built from, runs the same engine in your browser, and compares the result with every published file.`),
      button, result),

    h("h2", {}, `Receipt: ${ctx.ranking.snapshot.label}, ${season}`),
    h("table", { class: "mf" }, h("tbody", {},
      ...([
        ["Engine", m.engine], ["Algorithm", m.algorithmVersion],
        ...((g
          ? [["Win bonus", `${g.winBonus} points`], ["Blowout limit", `${g.blowoutLimit} points`], ["Home field (fitted)", `${g.homeFieldPoints.toFixed(3)} points`], ["Solver rounds", String(g.iterations)]]
          : [["Spring strength", margin ? "Point differential" : "1 per game"]]) as [string, string][]),
        ["α (alpha)", String(m.alpha)], ["Divisions", m.classifications.map((c) => c.toUpperCase()).join(" + ")],
        ["Games counted", String(m.counts.included)], ["Outside FBS/FCS", String(m.counts.outOfScope)], ["Not yet played", String(m.counts.incomplete)], ["Tied scores", String(m.counts.tied)],
      ] as const).map(([k, v]) => h("tr", {}, h("th", {}, k), h("td", {}, v))),
      h("tr", {}, h("th", {}, "teams.csv SHA-256"), h("td", {}, h("code", {}, m.teamsSha256))),
      h("tr", {}, h("th", {}, "games.csv SHA-256"), h("td", {}, h("code", {}, m.gamesSha256))))),
    h("div", { class: "files" }, file(files.teamsCsv), file(files.gamesCsv), file(files.configJson), file(`rankings/${season}/${ctx.snapId}.json`),
      h("a", { href: "https://github.com/sambennettdev/rank/blob/main/docs/METHODOLOGY.md", target: "_blank", rel: "noopener" }, "METHODOLOGY.md ↗")),
  );
}

function springRankSections(margin: boolean): Node[] {
  return [
    h("h2", {}, "The idea: springs"),
    h("div", { class: "springdemo" }, springDemo(),
      h("p", {}, "Imagine every game as a spring that wants the ", h("b", {}, "winner exactly one step above the loser"), ".", margin ? h("span", {}, " The spring is as ", h("b", {}, "stiff as the point differential"), ": a 35-point win pulls 35 times harder than a 1-point win.") : "", " Beat a team that’s high up and you get pulled higher. Lose to a team that’s low and you get dragged down. Let all the springs settle at once and each team comes to rest at its height. That height is the ranking.")),
    h("p", {}, "This is ", h("b", {}, "SpringRank"), " (De Bacco, Larremore & Moore, ", h("i", {}, "Science Advances"), ", 2018). The resting heights are the ones that put the least total strain on all the springs:"),
    h("pre", { class: "formula" }, "H(s) = ½ · Σ  A[i][j] · (s[i] − s[j] − 1)²  +  ½ · α · Σ s[i]²\n\n", h("span", { class: "c" }, margin ? "A[i][j]  total point differential of team i’s wins over team j\n" : "A[i][j]  times team i beat team j\ns[i]     height of team i  (the y-axis of the graph)\nα        tiny equal pull toward 0, so there is always one exact answer")),
    h("p", {}, "Minimising that gives a single system of linear equations, solved exactly with a Cholesky decomposition. No iterations to converge, no random starts. Same input, same answer, on any computer."),

    h("h2", {}, "What counts"),
    h("ul", {},
      h("li", {}, h("b", {}, "Final scores of completed games"), " between two FBS or FCS teams. Regular season and postseason."),
      margin
        ? h("li", {}, h("b", {}, "Margin matters."), " Each game counts with a weight equal to its point differential. Home field, brand, conference, preseason polls and opinions are all ignored.")
        : h("li", {}, h("b", {}, "A win is a win."), " Margin, home field, brand, conference, preseason polls and opinions are all ignored."),
      h("li", {}, "Games against teams outside FBS/FCS are left out, and the count is published below."),
      h("li", {}, "A team with no counted games is ", h("b", {}, "unranked"), " rather than guessed."),
      h("li", {}, "Equal heights share a rank (shown T-n). Ties are never broken by name or reputation."),
      h("li", {}, "Week N uses only games through week N, recomputed from scratch.")),
  ];
}

function gridironSections(ctx: Ctx): Node[] {
  const g = gridironParams(ctx)!;
  const hf = homeField(ctx);
  const row = (cells: string[], best = false) => h("tr", { class: best ? "best" : "" }, ...cells.map((c, i) => (i === 0 ? h("th", {}, c) : h("td", {}, c))));
  return [
    h("h2", {}, "The idea: springs"),
    h("div", { class: "springdemo" }, springDemo(),
      h("p", {}, "Imagine every game as a spring between the two teams. Let every spring settle at once and each team comes to rest at a height. That height is its ", h("b", {}, "rating, in points"), ", and the ranking is just the teams sorted by height. Beat a team that sits high and you get pulled up; lose to a team that sits low and you get dragged down.")),
    h("h2", {}, "Gridiron Springs: four football rules"),
    h("ol", { class: "rules" },
      h("li", {}, h("b", {}, `A win is worth a touchdown.`), ` Each spring wants the winner as many points above the loser as they won by, plus ${g.winBonus}. Winning always matters, and a 3-point win still says something.`),
      h("li", {}, h("b", {}, "Home field is measured, not guessed."), ` The home edge is solved from the same games, at the same time as the ratings. This week it is worth `, h("b", {}, `${hf.toFixed(1)} points`), ". Neutral-site games get none."),
      h("li", {}, h("b", {}, `Blowouts have a limit.`), ` A spring pulls normally until a result is ${g.blowoutLimit} points (three touchdowns) beyond what the ratings expect; past that it stops pulling harder. Running up the score can’t buy a ranking, and favorites aren’t punished for beating weak teams soundly.`),
      h("li", {}, h("b", {}, "Every game counts the same."), " No recency weighting, no preseason priors, no conference or brand adjustments. Opponent strength isn’t a separate formula: it comes from where the opponent settles in the same graph.")),
    h("pre", { class: "formula" },
      `minimise  Σ games  huber( margin + ${g.winBonus}·win − (s_winner − s_loser ± h) ;  ${g.blowoutLimit} )  +  α · Σ s²\n\n`,
      h("span", { class: "c" }, `s        team rating in points (the height in the graph)\nh        home-field advantage, solved with the ratings (${hf.toFixed(2)} this week)\nhuber    squared error up to ${g.blowoutLimit} points, linear beyond it\nα        ${ctx.ranking.manifest.alpha}: tiny equal pull toward 0 so there is exactly one answer`)),
    h("p", {}, `Solved by repeating a single linear system (Cholesky) until the ratings stop moving. This week took ${g.iterations} rounds. Every round runs in a fixed order with plain arithmetic, so any computer gets the same bytes. Ratings average exactly 0, so a rating is points better or worse than an average FBS/FCS team.`),
    h("h2", {}, "Why this method"),
    h("p", {}, "It is built from what the best football ratings agree on: margin carries information (Massey, Sagarin, SRS), the value of a margin should flatten out (Sagarin, Massey), home field is worth a few points, and a résumé ranking must still reward winning. We tested it against the alternatives on ten seasons of results (2015–2025, 2020 skipped), predicting each week only from earlier games that season:"),
    h("table", { class: "mf bt" },
      h("thead", {}, h("tr", {}, h("th", {}, "Method"), h("td", {}, "Picks next week’s winner"), h("td", {}, "Final ranking agrees with results"))),
      h("tbody", {},
        row(["Win/loss only (SpringRank)", "67.6%", "83.6%"]),
        row(["Margin as spring stiffness (previous)", "68.3%", "81.1%"]),
        row(["Least squares on margin + home (Massey)", "71.6%", "80.2%"]),
        row(["Sports-Reference SRS (7–24 clamp)", "70.2%", "81.7%"]),
        row(["Gridiron Springs", "71.2%", "81.9%"], true))),
    h("p", { class: "muted" }, "11,593 predicted games. “Agrees with results” is the share of all games where the final ranking puts the winner above the loser. Details and the script to reproduce it: ", h("a", { href: "https://github.com/sambennettdev/rank/blob/main/docs/BACKTEST.md", target: "_blank", rel: "noopener" }, "BACKTEST.md ↗")),
    h("h2", {}, "What counts"),
    h("ul", {},
      h("li", {}, h("b", {}, "Final scores, location and opponent"), " of completed games between two FBS or FCS teams, regular season and postseason. Nothing else: no stats, injuries, recruiting or opinions."),
      h("li", {}, "Games against teams outside FBS/FCS are left out, and the count is published below."),
      h("li", {}, "A team with no counted games is ", h("b", {}, "unranked"), " rather than guessed."),
      h("li", {}, "Equal ratings share a rank (shown T-n). Ties are never broken by name or reputation."),
      h("li", {}, "Week N uses only games through week N, recomputed from scratch.")),
  ];
}

/** Three teams, three springs: A beat B and C, B beat C, so they settle A > B > C. */
function springDemo(): SVGSVGElement {
  const s = svg("svg", { viewBox: "0 0 220 170", "aria-hidden": "true" });
  s.innerHTML = `
    <line x1="30" y1="10" x2="30" y2="160" stroke="var(--line-2)"/>
    <text x="26" y="18" text-anchor="end" fill="var(--faint)" font-size="10" font-family="var(--display)">HIGH</text>
    <text x="26" y="160" text-anchor="end" fill="var(--faint)" font-size="10" font-family="var(--display)">LOW</text>
    <path d="M110 30 Q90 60 70 85" fill="none" stroke="var(--win)" stroke-width="2.5" stroke-dasharray="4 3"/>
    <path d="M70 85 Q110 115 150 140" fill="none" stroke="var(--win)" stroke-width="2.5" stroke-dasharray="4 3"/>
    <path d="M110 30 Q160 80 150 140" fill="none" stroke="var(--win)" stroke-width="2.5" stroke-dasharray="4 3"/>
    <g font-family="var(--display)" font-weight="800" font-size="13" text-anchor="middle">
      <circle cx="110" cy="30" r="16" fill="var(--brand)"/><text x="110" y="35" fill="#111">A</text>
      <circle cx="70" cy="85" r="16" fill="var(--surface-3)" stroke="var(--line-2)"/><text x="70" y="90" fill="var(--text)">B</text>
      <circle cx="150" cy="140" r="16" fill="var(--surface-3)" stroke="var(--line-2)"/><text x="150" y="145" fill="var(--text)">C</text>
    </g>
    <text x="200" y="35" fill="var(--muted)" font-size="10" text-anchor="end">2–0</text>
    <text x="200" y="90" fill="var(--muted)" font-size="10" text-anchor="end">1–1</text>
    <text x="200" y="145" fill="var(--muted)" font-size="10" text-anchor="end">0–2</text>`;
  return s;
}
