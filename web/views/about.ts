import { computeSeason } from "../../src/engine/season";
import type { Ctx } from "../ctx";
import { h, type Child } from "../dom";
import { navIcons, pillarIcons } from "../icons";
import { fetchText, rankingPath, seasonFiles } from "../store";

export function aboutView(ctx: Ctx): HTMLElement {
  const m = ctx.ranking.manifest,
    season = ctx.entry.season,
    files = seasonFiles(season),
    result = h("div", {
      class: "result",
      role: "status",
      "aria-live": "polite",
    });
  const button = h(
    "button",
    {
      class: "btn primary",
      onclick: async () => {
        button.disabled = true;
        result.className = "result run";
        result.textContent = "Downloading data…";
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
  const details = (label: string, ...children: Child[]) =>
    h(
      "details",
      { class: "method-accordion" },
      h("summary", {}, label),
      ...children,
    );
  const file = (path: string) =>
    h(
      "a",
      { href: `./data/${path}`, target: "_blank", rel: "noopener" },
      path.split("/").at(-1)!,
    );
  const rows: [string, string][] = [
    ["Engine", m.engine],
    ["Algorithm", m.algorithmVersion],
    ["Calibration", m.calibrationId],
    ["Loss deduction", String(m.lossPenalty)],
    ["Prediction win premium", String(m.winBonus)],
    ["Team shrink", String(m.shrink)],
    ["Home-field shrink", String(m.homeFieldShrink)],
    [
      "Home field",
      `${m.homeField.toFixed(2)}; SE ${m.homeFieldError.toFixed(2)}`,
    ],
    ["Probability scale", String(m.probabilityScale)],
    ["Residual scale", String(m.residualScale)],
    ["Simulations", String(ctx.ranking.projection.samples)],
    ["Connected groups", String(m.connectedComponents)],
    ["Games counted", String(m.counts.included)],
    ["Out of scope", String(m.counts.outOfScope)],
    ["Incomplete", String(m.counts.incomplete)],
  ];
  const step = (icon: Node, value: string, label: string) =>
    h(
      "div",
      { class: "forecast-step" },
      h("div", { class: "step-icon" }, icon),
      h("b", {}, value),
      h("span", {}, label),
    );
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
        h("h1", {}, "How Rank works"),
      ),
    ),
    h(
      "div",
      { class: "section-heading" },
      h("h2", {}, "Add wins. Subtract losses."),
    ),
    h(
      "div",
      { class: "rating-recipe" },
      h(
        "div",
        { class: "recipe-block win" },
        h("b", {}, "0–1"),
        h("span", {}, "Each win"),
      ),
      h("span", { class: "recipe-symbol", "aria-hidden": "true" }, "−"),
      h(
        "div",
        { class: "recipe-block loss" },
        h("b", {}, "1"),
        h("span", {}, "Each loss"),
      ),
      h("span", { class: "recipe-symbol", "aria-hidden": "true" }, "="),
      h(
        "div",
        { class: "recipe-block" },
        h("b", {}, "Rating"),
        h("span", {}, "Earned points"),
      ),
    ),
    h(
      "p",
      { class: "method-caption" },
      "Stronger opponents earn more win credit. Every loss costs exactly 1 point.",
    ),
    h(
      "section",
      { class: "panel" },
      h("div", { class: "section-heading" }, h("h2", {}, "Project the finish")),
      h(
        "div",
        { class: "forecast-steps" },
        step(
          navIcons.matchups(),
          String(ctx.ranking.projection.remainingGames),
          "Games left",
        ),
        h("span", { class: "recipe-symbol", "aria-hidden": "true" }, "→"),
        step(
          pillarIcons.deterministic(),
          ctx.ranking.projection.samples.toLocaleString(),
          "Scenarios",
        ),
        h("span", { class: "recipe-symbol", "aria-hidden": "true" }, "→"),
        step(navIcons.list(), "#1, #2…", "Projected ranks"),
      ),
      h(
        "p",
        { class: "method-caption" },
        "Known schedule only. Unassigned postseason matchups are excluded.",
      ),
    ),
    details(
      "Scoring & scope",
      h(
        "p",
        {},
        "Win quality estimates how likely the opponent is to beat an average team at that venue. Credits are fixed before the game's calendar week; later results cannot revalue past wins.",
      ),
      h(
        "p",
        {},
        "Only completed, untied games between configured FBS/FCS teams count. Every team starts at zero. No preseason, poll or conference bonuses. Limited opponent evidence is marked with an amber dot.",
      ),
    ),
    details(
      "Reading the forecast",
      h(
        "p",
        {},
        "Projected standings are whole-number ranks ordered by average simulated finish. An average like 6.4 is a simulation statistic, not a standings position; it remains in team forecast details.",
      ),
      h(
        "p",
        {},
        "Range bars contain 80% of simulated finishes. Top 25 and No. 1 are probabilities within the full FBS/FCS field. Exact ties share a rank. Future win credits use current evidence; strengths, venues and remaining opponents drive the simulations.",
      ),
      h(
        "p",
        {},
        "Injuries, roster changes and unassigned postseason matchups are not modeled. The predicted order is an estimate; its ranges can span several positions.",
      ),
    ),
    details(
      "Data & receipts",
      h(
        "p",
        {},
        `${ctx.ranking.snapshot.label} · ${m.counts.included} counted games. Scores are assumed available six hours after kickoff.`,
      ),
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
      ),
    ),
    details(
      "Research & full methodology",
      h(
        "p",
        {},
        "Design and calibration: 2014–2019. Later seasons are development evaluation, not an untouched holdout.",
      ),
      h(
        "div",
        { class: "files" },
        h(
          "a",
          {
            href: "https://github.com/SamBennettDev/rank/tree/main/research",
            target: "_blank",
            rel: "noopener",
          },
          "Research ↗",
        ),
        h(
          "a",
          {
            href: "https://github.com/SamBennettDev/rank/blob/main/docs/METHODOLOGY.md",
            target: "_blank",
            rel: "noopener",
          },
          "Methodology ↗",
        ),
      ),
    ),
    h(
      "section",
      { class: "panel method-verification" },
      h(
        "div",
        {},
        h(
          "div",
          { class: "section-heading" },
          h("h2", {}, "Check the numbers"),
        ),
        h(
          "p",
          { class: "hint" },
          "Rebuild the published rankings on your device.",
        ),
      ),
      button,
      result,
    ),
  );
}
