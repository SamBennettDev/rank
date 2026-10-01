import { computeSeason } from "../../src/engine/season";
import { type Ctx, byMargin } from "../ctx";
import { h, svg } from "../dom";
import { pillarIcons } from "../icons";
import { fetchText, seasonFiles } from "../store";

export function aboutView(ctx: Ctx): HTMLElement {
  const m = ctx.ranking.manifest;
  const season = ctx.entry.season;
  const files = seasonFiles(season);
  const margin = byMargin(ctx);

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
      h("p", { class: "lede" }, "Polls ask people what they think. This asks the games. Every FBS and FCS team is a point in a graph, every game is a line from the loser to the winner, and a team’s rank is simply ", h("b", {}, "how high it sits"), ".")),
    h("div", { class: "pillars" },
      pillar(pillarIcons.deterministic(), "Deterministic", "Same games in, identical bytes out. No randomness, no tuning, no judgement calls."),
      pillar(pillarIcons.auditable(), "Auditable", "Every input, line of code and published result is public. Check any week yourself below."),
      pillar(pillarIcons.transparent(), "Transparent", "One short formula and one config file. Every team page shows the exact games behind its rank."),
      pillar(pillarIcons.unbiased(), "Unbiased", margin
        ? "No preseason poll, brand, conference or home field. Only who won and by how much."
        : "No preseason poll, brand, conference or margin of victory. Only who beat whom.")),

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
        ["Engine", m.engine], ["Algorithm", m.algorithmVersion], ["Spring strength", margin ? "Point differential" : "1 per game"], ["α (alpha)", String(m.alpha)], ["Divisions", m.classifications.map((c) => c.toUpperCase()).join(" + ")],
        ["Games counted", String(m.counts.included)], ["Outside FBS/FCS", String(m.counts.outOfScope)], ["Not yet played", String(m.counts.incomplete)], ["Tied scores", String(m.counts.tied)],
      ] as const).map(([k, v]) => h("tr", {}, h("th", {}, k), h("td", {}, v))),
      h("tr", {}, h("th", {}, "teams.csv SHA-256"), h("td", {}, h("code", {}, m.teamsSha256))),
      h("tr", {}, h("th", {}, "games.csv SHA-256"), h("td", {}, h("code", {}, m.gamesSha256))))),
    h("div", { class: "files" }, file(files.teamsCsv), file(files.gamesCsv), file(files.configJson), file(`rankings/${season}/${ctx.snapId}.json`),
      h("a", { href: "https://github.com/sambennettdev/rank/blob/main/docs/METHODOLOGY.md", target: "_blank", rel: "noopener" }, "METHODOLOGY.md ↗")),
  );
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
