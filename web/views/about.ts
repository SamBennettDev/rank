import { computeSeason } from "../../src/engine/season";
import { h } from "../dom";
import { type Ctx, demoBanner } from "../ctx";
import { fetchText, seasonFiles } from "../store";

export function aboutView(ctx: Ctx): HTMLElement {
  const m = ctx.ranking.manifest;
  const season = ctx.entry.season;
  const files = seasonFiles(season);
  const result = h("div");
  const button = h("button", { onclick: async () => {
    button.disabled = true;
    result.className = "result";
    result.textContent = "Recomputing in your browser…";
    try {
      const out = await computeSeason({
        season,
        teamsCsv: await fetchText(files.teamsCsv),
        gamesCsv: await fetchText(files.gamesCsv),
        configJson: await fetchText(files.configJson),
      });
      const bad: string[] = [];
      for (const f of out.files) if ((await fetchText(`rankings/${season}/${f.id}.json`)) !== f.json) bad.push(f.id);
      if (bad.length === 0) {
        result.className = "result ok";
        result.textContent = `✓ Match. Your browser recomputed all ${out.files.length} snapshots for ${ctx.entry.label} from the raw CSVs and got exactly the published bytes.`;
      } else {
        result.className = "result bad";
        result.textContent = `✗ Mismatch in: ${bad.join(", ")}. The published rankings do not follow from the published data.`;
      }
    } catch (err) {
      result.className = "result bad";
      result.textContent = `Could not recompute: ${err instanceof Error ? err.message : String(err)}`;
    }
    button.disabled = false;
  } }, "Recompute in your browser");

  const link = (path: string) => h("a", { href: `./data/${path}` }, path);
  return h(
    "div",
    { class: "prose" },
    demoBanner(ctx),
    h("h1", {}, "How these rankings work"),
    h("p", {}, "The AP Poll is a vote. This is a calculation. Every FBS and FCS team is a node in a graph, and every completed game between two of them is an edge from the loser to the winner. A team's rank is its vertical position in that graph."),
    h("h2", {}, "The method: SpringRank"),
    h("p", {}, "Each game acts as a spring that wants the winner exactly one unit above the loser. The final heights are the ones that put the least total strain on all the springs:"),
    h("pre", {}, "H(s) = ½ Σ A[i][j] · (s[i] − s[j] − 1)² + ½ · α · Σ s[i]²\n\nA[i][j] = number of times team i beat team j\nα       = tiny shrinkage so a unique answer always exists"),
    h("p", {}, "Setting the derivative to zero gives one linear system, solved exactly with a Cholesky decomposition. There is no randomness, no tuning per team and no iteration to converge. Method: De Bacco, Larremore & Moore, ", h("em", {}, "A physical model for efficient ranking in networks"), " (Science Advances, 2018)."),
    h("h2", {}, "What goes in, and what does not"),
    h("ul", {},
      h("li", {}, "Only final scores of completed games between two ranked-division teams."),
      h("li", {}, "A win is a win: margin of victory, home field, brand, conference, preseason rank and human opinion are all ignored."),
      h("li", {}, "Games against teams outside FBS/FCS are not counted. The count of those is published below."),
      h("li", {}, "Teams with no counted games are unranked rather than guessed."),
      h("li", {}, "Equal heights share a rank (shown as T-n). Ties are never broken by name or reputation.")),
    h("h2", {}, "Verify it yourself"),
    h("p", {}, "Everything is published: the raw game data, the code, and the output. The button below downloads the CSVs, runs the exact same engine in your browser and compares the result with the published file byte for byte. The repository's CI does the same on every change."),
    h("p", {}, button),
    result,
    h("h2", {}, `This snapshot: ${ctx.entry.label}, ${ctx.ranking.snapshot.label}`),
    h("table", {},
      h("tbody", {},
        ...([
          ["Engine", m.engine], ["Algorithm", m.algorithmVersion], ["α (alpha)", String(m.alpha)], ["Divisions", m.classifications.join(", ")],
          ["Games in window", String(m.counts.inWindow)], ["Counted", String(m.counts.included)], ["Outside FBS/FCS", String(m.counts.outOfScope)],
          ["Not completed", String(m.counts.incomplete)], ["Tied scores skipped", String(m.counts.tied)],
          ["teams.csv SHA-256", m.teamsSha256], ["games.csv SHA-256", m.gamesSha256],
        ] as const).map(([k, v]) => h("tr", {}, h("th", {}, k), h("td", { style: "white-space:normal;word-break:break-all" }, v))))),
    h("p", {}, "Raw files: ", link(files.teamsCsv), " · ", link(files.gamesCsv), " · ", link(files.configJson), " · ", link(`rankings/${season}/${ctx.snapId}.json`)),
  );
}
