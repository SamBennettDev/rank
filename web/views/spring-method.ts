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
    ["Spring rest gap", String(s.restGap)],
    ["Spring direction", s.direction],
    ["Pull weighting", s.pullPolicy ?? "Equal stiffness"],
    ["Smallest pull stiffness", `${(100 * s.minPullStiffness).toFixed(1)}%`],
    ["Counted game springs", String(m.counts.included)],
    ["Connected groups", String(m.connectedComponents)],
    ["Compressed springs", String(s.compressedGames)],
    ["Stretched springs", String(s.stretchedGames)],
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
        h(
          "h1",
          {},
          `A graph of ${s.restGap}-point ${s.direction === "two-sided" ? "two-way" : "one-sided"} springs`,
        ),
      ),
    ),
    h("h2", {}, `Every game prefers a ${s.restGap}-point winner–loser gap.`),
    s.pullPolicy
      ? h(
          "p",
          {},
          "Strong wins support a team’s height. First fit the current-season graph with equal springs. For each winner, find the strongest opponent it has beaten. Pull stiffness halves for each seven reference-height points by which another beaten opponent is weaker. Freeze those weights, then settle the graph again. Compressed springs keep full stiffness; only stretched, downward pulls are softened.",
        )
      : "",
    h(
      "p",
      {},
      `Each team is a node. Each completed, non-tied game is a spring pointing from the loser to the winner. Every node starts at zero. A spring pushes a pair apart when the winner is less than ${s.restGap} points above the loser${s.direction === "two-sided" ? ` and pulls them together when the gap exceeds ${s.restGap}` : ""}.`,
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
      "If A beats B, B beats C, and C beats A, it is impossible to put every winner above its loser. The graph minimizes the total squared gap error. A symmetric three-team cycle settles at a tie; other conflicts can leave a winner below a loser. Highlighted edges show springs with remaining force.",
    ),
    h(
      "p",
      {},
      "Every meeting counts separately. Two-way springs keep both overly small and overly large gaps in check. A common positive rest gap sets the scale: seven gives seven times the heights of an otherwise identical one-point, two-way model, with the same unrounded ordering. Height is not a calibrated win probability or predicted scoring margin.",
    ),
    h(
      "p",
      {},
      "Head-to-head order is a preference, not a hard constraint. Softening weak-opponent pulls can help preserve strong wins, but it does not guarantee every winner ranks above its loser. The chosen weighting is a transparent ranking policy, not a historically optimized prediction model.",
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
      "Disconnected groups are each centered at zero. Games cannot establish their relative position; those ranks are provisional. With two-way springs the centered equilibrium within each connected group is unique.",
    ),
    h(
      "details",
      { class: "method-accordion" },
      h("summary", {}, "Math and reproducibility"),
      h(
        "p",
        {},
        `Let gap = height[w] − height[l], compression = max(0, ${s.restGap} − gap), extension = max(0, gap − ${s.restGap}). Force on winner = compression − k × extension; the loser receives the opposite force. Energy = ½ × sum(compression² + k × extension²). Each simultaneous step uses step size 1 / (2 × maximum game count).`,
      ),
      s.pullPolicy
        ? h(
            "p",
            {},
            `Using equal-spring reference strengths, k = 2 ^ (−max(0, strongest beaten opponent − this beaten opponent) / ${s.restGap}). The strongest reference win has k = 1. A weaker opponent has a smaller positive k. Weights do not update during the final relaxation, keeping the objective convex.`,
          )
        : "",
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
