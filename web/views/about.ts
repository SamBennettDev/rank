import { computeSeason } from "../../src/engine/season";
import type { Ctx } from "../ctx";
import { h } from "../dom";
import { fetchText, rankingPath, seasonFiles } from "../store";

export function aboutView(ctx: Ctx): HTMLElement {
  const m = ctx.ranking.manifest,
    season = ctx.entry.season,
    files = seasonFiles(season),
    result = h("div");
  const button = h(
    "button",
    {
      class: "btn primary",
      onclick: async () => {
        button.disabled = true;
        result.className = "result run";
        result.textContent = "Downloading raw data and recomputing…";
        try {
          const out = await computeSeason(
            {
              season,
              teamsCsv: await fetchText(files.teamsCsv),
              gamesCsv: await fetchText(files.gamesCsv),
              configJson: await fetchText(files.configJson),
              ...(m.playsSha256
                ? { playsCsv: await fetchText(files.playsCsv) }
                : {}),
            },
            async (done, total) => {
              result.textContent = `Recomputing ${done} of ${total} snapshots…`;
              await new Promise((r) => setTimeout(r, 0));
            },
          );
          const bad = [];
          for (const f of out.files)
            if ((await fetchText(rankingPath(season, f.id))) !== f.json)
              bad.push(f.id);
          result.className = bad.length ? "result bad" : "result ok";
          result.textContent = bad.length
            ? `Mismatch in ${bad.join(", ")}. Please open an issue.`
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
  const rows: [string, string][] = [
    ["Engine", m.engine],
    ["Algorithm", m.algorithmVersion],
    ["Calibration", m.calibrationId],
    ["Loss deduction", `${m.lossPenalty} earned point`],
    ["Prediction win premium", `${m.winBonus} score points`],
    ["Team shrink", String(m.shrink)],
    ["Home-field shrink", String(m.homeFieldShrink)],
    [
      "Home field",
      `${m.homeField.toFixed(2)} points; model SE ${m.homeFieldError.toFixed(2)}`,
    ],
    ["Probability scale", String(m.probabilityScale)],
    ["Residual scale", String(m.residualScale)],
    ["Season projection", `${m.projectionSamples} fixed-seed samples`],
    ["Connected groups", String(m.connectedComponents)],
    ["Games counted", String(m.counts.included)],
    ["Out of scope", String(m.counts.outOfScope)],
    ["Incomplete", String(m.counts.incomplete)],
  ];
  const file = (path: string) =>
    h("a", { href: `./data/${path}`, target: "_blank", rel: "noopener" }, path);
  return h(
    "div",
    { class: "method" },
    h(
      "section",
      { class: "hero" },
      h("div", { class: "eyebrow" }, "Methodology"),
      h("h1", {}, "Computed,", h("br"), h("em", {}, "not voted.")),
    ),
    h("h2", {}, "Current standing"),
    h(
      "p",
      {},
      "A win earns 0–1 point: how likely its opponent would be to beat an average team at that venue. Opponent quality is estimated before the calendar week and that credit stays fixed. Every loss subtracts exactly 1 point, whatever the opponent or margin. The single rating is total earned points; rank is its descending order. No preseason, recruiting, brand, poll or conference bonuses.",
    ),
    h("h2", {}, "One rating, projected forward"),
    h(
      "p",
      {},
      "The season forecast simulates each known remaining matchup, then adds estimated win credits and deducts 1 point for every simulated loss. Average final rank, median, an 80% model range, and top-25 probability describe the resulting distribution. Final rank means the order of this same earned-standing rating.",
    ),
    h("h2", {}, "Remaining schedule and uncertainty"),
    h(
      "p",
      {},
      `The projection uses ${m.projectionSamples} seeded stratified simulations. Each simulation draws one uncertain team-strength profile, shared across the remaining games, and a result for each game. Future win credits use today’s opponent evidence; the current calendar week keeps its pre-week credits. Repeating the same inputs produces identical results. Unassigned postseason matchups and future roster changes are excluded.`,
    ),
    h("h2", {}, "Uncertainty"),
    h(
      "p",
      {},
      "Current earned points are fixed. Projected ranges account for future results and uncertainty in opponent strength and home field, calibrated on 2014–2019. Coverage is conditional on the model. Teams with fewer than three games or a disconnected schedule graph are marked provisional.",
    ),
    h("h2", {}, "Matchup probabilities"),
    h(
      "p",
      {},
      "An internal opponent-adjusted score model predicts game outcomes; its strength estimates are not another published standing. Margin plus a 3-point win premium, equal shrink toward zero and fitted home field determine the expected edge. A calibrated logistic scale converts it to win probability, with uncertainty bringing it toward 50%. Later scores never enter an earlier forecast.",
    ),
    h("h2", {}, "Evaluation"),
    h(
      "p",
      {},
      "The date-based walk-forward benchmark forecasts at Monday noon UTC, using only games whose kickoffs were at least six hours earlier. Earlier playoff rounds count; later regular-season games cannot leak into playoff predictions. It reports accuracy, Brier score, log loss, reliability bins, season results and FBS-only results. The fixed-loss standing rule and projection methods were selected on 2014–2019. Correlated simulations had the lowest final-rank RMSE of the tested simulations and covered 78.5% of ranks in their 80% ranges. Historical 2021–2026 results are development evidence, since they have already been inspected. Future untouched results are needed to confirm improvements.",
    ),
    h(
      "p",
      {},
      h(
        "a",
        {
          href: "https://github.com/SamBennettDev/rank/tree/main/research",
          target: "_blank",
          rel: "noopener",
        },
        "Calibration and evaluation reports ↗",
      ),
    ),
    h("h2", {}, "Unit ratings and scope"),
    h(
      "p",
      {},
      "Offense, defense and special teams come from opponent-adjusted public play-by-play, with garbage time removed. They explain performance and leave overall standing unchanged. Only completed, untied games between configured FBS/FCS teams count; teams without counted games are unranked.",
    ),
    h("h2", {}, "Check it yourself"),
    h(
      "div",
      { class: "verify" },
      h(
        "p",
        {},
        "The published CSVs, settings and engine reproduce every snapshot. Input hashes below record the exact bytes.",
      ),
      button,
      result,
    ),
    h("h2", {}, `Receipt: ${ctx.ranking.snapshot.label}`),
    h(
      "table",
      { class: "mf" },
      h(
        "tbody",
        {},
        ...rows.map(([key, value]) =>
          h("tr", {}, h("th", {}, key), h("td", {}, value)),
        ),
        ...(
          [
            ["teams.csv", m.teamsSha256],
            ["games.csv", m.gamesSha256],
            ["plays.csv", m.playsSha256],
          ] as const
        )
          .filter(([, hash]) => hash)
          .map(([name, hash]) =>
            h(
              "tr",
              {},
              h("th", {}, `${name} SHA-256`),
              h("td", {}, h("code", {}, hash)),
            ),
          ),
      ),
    ),
    h(
      "div",
      { class: "files" },
      file(files.teamsCsv),
      file(files.gamesCsv),
      file(files.configJson),
      m.playsSha256 ? file(files.playsCsv) : "",
      file(rankingPath(season, ctx.snapId)),
      h(
        "a",
        {
          href: "https://github.com/SamBennettDev/rank/blob/main/docs/METHODOLOGY.md",
          target: "_blank",
          rel: "noopener",
        },
        "METHODOLOGY.md ↗",
      ),
    ),
  );
}
