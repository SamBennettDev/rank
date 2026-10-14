import { computeSeason } from "../../src/engine/season";
import type { Ctx } from "../ctx";
import { h } from "../dom";
import { fetchText, rankingPath, seasonFiles } from "../store";

export function springMethodView(ctx: Ctx): HTMLElement {
  const m = ctx.ranking.manifest,
    s = m.springs!,
    season = ctx.entry.season,
    files = seasonFiles(season);
  const result = h("p", {
    role: "status",
    class: "result",
    "aria-live": "polite",
  });
  const button = h(
    "button",
    {
      class: "btn primary",
      onclick: async () => {
        button.disabled = true;
        result.textContent = "Rebuilding the game graphs…";
        try {
          const [teamsCsv, gamesCsv, configJson] = await Promise.all([
            fetchText(files.teamsCsv),
            fetchText(files.gamesCsv),
            fetchText(files.configJson),
          ]);
          const out = await computeSeason(
            { season, teamsCsv, gamesCsv, configJson },
            async (done, total) => {
              result.textContent = `Recomputing ${done} of ${total} graphs…`;
              await new Promise((r) => setTimeout(r, 0));
            },
          );
          const bad: string[] = [];
          for (const f of out.files)
            if ((await fetchText(rankingPath(season, f.id))) !== f.json)
              bad.push(f.id);
          result.className = bad.length ? "result bad" : "result ok";
          result.textContent = bad.length
            ? `Mismatch: ${bad.join(", ")}.`
            : `Exact match. Your browser rebuilt all ${out.files.length} rankings byte for byte.`;
        } catch (err) {
          result.className = "result bad";
          result.textContent = err instanceof Error ? err.message : String(err);
        }
        button.disabled = false;
      },
    },
    "Recompute in my browser",
  );
  const rows = [
    ["Counted game springs", String(m.counts.included)],
    ["Connected groups", String(m.connectedComponents)],
    ["Compressed springs", String(s.compressedGames)],
    ["Winners below their losers", String(s.reversedGames)],
    ["Winners level with their losers", String(s.tiedGames)],
    ["Settled energy", s.energy.toFixed(6)],
    ["Largest remaining net force", s.maxNetForce.toExponential(3)],
    ["Force tolerance", s.forceTolerance.toExponential(0)],
    ["Relaxation steps", String(s.iterations)],
    ["Engine", m.engine],
    ["Algorithm", m.algorithmVersion],
    ["teams.csv SHA-256", m.teamsSha256],
    ["games.csv SHA-256", m.gamesSha256],
  ];
  return h(
    "div",
    { class: "method method-page" },
    h(
      "section",
      { class: "page-heading" },
      h(
        "div",
        {},
        h("div", { class: "eyebrow" }, "The method"),
        h("h1", {}, "A graph of one-sided springs"),
      ),
    ),
    h("h2", {}, "Every game pushes its winner above its loser."),
    h(
      "p",
      {},
      "Each team is a node. Each completed, non-tied game is an equal spring pointing from the loser to the winner. Every node starts at zero. A spring pushes the winner upward and the loser downward until the winner is one unit higher; after that, it stops pushing.",
    ),
    h(
      "p",
      {},
      "The graph settles when the forces on every team balance. Heights are centered to an average of zero within each connected group, then sorted from highest to lowest. Teams with equal published heights share a rank.",
    ),
    h("h2", {}, "Circular results need a compromise."),
    h(
      "p",
      {},
      "If A beats B, B beats C, and C beats A, it is impossible to put every winner above its loser. The graph finds the lowest total squared compression. A symmetric three-team cycle settles at a tie; other cycles can leave a winner below a loser. Highlighted edges show compressed springs.",
    ),
    h(
      "p",
      {},
      "Unbeaten teams can tie, and repeated wins do not keep pushing once their springs are separated. A long chain of results can create a large height difference. Height measures the game graph, not a calibrated chance of winning a future game.",
    ),
    h("h2", {}, "Only this season’s results."),
    h(
      "p",
      {},
      "Scores identify the winner; score margin, venue, polls, team reputation, division strength, historical seasons and neural predictions do not change the springs. Actual outside opponents are included as ordinary nodes. Only the configured FBS/FCS field receives published ranks. Tied games create no winner edge; unplayed teams remain unranked.",
    ),
    h(
      "p",
      {},
      "Disconnected groups are each centered at zero. Games cannot establish their relative position; those ranks are provisional. The same zero-start relaxation is used for every snapshot because slack springs can admit several equally valid equilibria.",
    ),
    h(
      "details",
      { class: "method-accordion" },
      h("summary", {}, "Math and reproducibility"),
      h(
        "p",
        {},
        "For a game with winner w and loser l: compression = max(0, 1 − height[w] + height[l]). Minimize energy = ½ × sum(compression²). Each simultaneous step moves every team along its net force, with step size 1 / (2 × the largest game count in its connected group).",
      ),
      h(
        "p",
        {},
        "Stop when every net force is at most 10⁻¹⁰. The solver fails explicitly if it cannot converge. Publication rounds heights to six decimals; this also determines ties. Repeated meetings stay separate springs. Scores are assumed available six hours after kickoff.",
      ),
      h(
        "table",
        { class: "mf" },
        h(
          "tbody",
          {},
          ...rows.map(([k, v]) =>
            h("tr", {}, h("th", {}, k!), h("td", {}, v!)),
          ),
        ),
      ),
    ),
    h(
      "div",
      { class: "files" },
      ...[
        files.teamsCsv,
        files.gamesCsv,
        files.configJson,
        rankingPath(season, ctx.snapId),
      ].map((path) =>
        h(
          "a",
          { href: `./data/${path}`, target: "_blank", rel: "noopener" },
          path.split("/").at(-1)!,
        ),
      ),
    ),
    h(
      "section",
      { class: "panel method-verification" },
      h(
        "div",
        {},
        h("h2", {}, "Check the graph"),
        h(
          "p",
          { class: "hint" },
          "Rebuild every published snapshot from the same teams and games.",
        ),
      ),
      button,
      result,
    ),
  );
}
