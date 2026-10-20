import { computeSeason } from "../../src/engine/season";
import type { Ctx } from "../ctx";
import { h, type Child } from "../dom";
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
    ["Pass 1 pull toward average", String(m.springs.strengthShrink)],
    ["Quality scale", String(m.springs.qualityScale)],
    ["Pass 2 pull toward average", String(m.springs.rankShrink)],
    ["Matchup calibration", m.matchup.calibrationId],
    ["Matchup win premium", `${m.matchup.winBonus} points`],
    ["Matchup FBS–FCS starting gap", `${m.matchup.divisionGap} points`],
    ["Matchup team shrink", String(m.matchup.shrink)],
    ["Matchup home-field shrink", String(m.matchup.homeFieldShrink)],
    [
      "Matchup home field",
      `${m.homeField.toFixed(2)}; SE ${m.homeFieldError.toFixed(2)}`,
    ],
    ["Probability scale", String(m.matchup.probabilityScale)],
    ["Residual scale", String(m.matchup.residualScale)],
    ["Ranked field", m.classifications.map((c) => c.toUpperCase()).join(" + ")],
    ["Connected groups", String(m.connectedComponents)],
    ["Games counted", String(m.counts.included)],
    ["Matchup-model games", String(m.counts.modeled)],
    ["Lower-division results", String(m.counts.unmodeled)],
    ["Out of scope", String(m.counts.outOfScope)],
    ["Incomplete", String(m.counts.incomplete)],
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
        h("h1", {}, "How Rank works"),
      ),
    ),
    h(
      "div",
      { class: "section-heading" },
      h("h2", {}, "Two passes of springs."),
    ),
    h(
      "div",
      { class: "rating-recipe" },
      h(
        "div",
        { class: "recipe-block win" },
        h("b", {}, "Strength"),
        h("span", {}, "Pass 1: SpringRank"),
      ),
      h("span", { class: "recipe-symbol", "aria-hidden": "true" }, "→"),
      h(
        "div",
        { class: "recipe-block loss" },
        h("b", {}, "Pull"),
        h("span", {}, "Pass 2 spring"),
      ),
      h("span", { class: "recipe-symbol", "aria-hidden": "true" }, "="),
      h(
        "div",
        { class: "recipe-block" },
        h("b", {}, "Height"),
        h("span", {}, "The ranking"),
      ),
    ),
    h(
      "p",
      { class: "method-caption" },
      "Every game is a spring holding its winner one step above its loser; the score doesn’t matter. Beat a good team or lose to a bad one: a hard pull. Beat a bad team or lose to a good one: barely a tug.",
    ),
    details(
      "The two passes",
      h(
        "p",
        {},
        h("b", {}, "Pass 1, strength. "),
        `Plain SpringRank: every game is a spring of strength 1 that wants its winner one step above its loser. Solving the whole graph at once gives every team a strength. Each strength becomes a quality, the chance of beating an average team (scale ${m.springs.qualityScale}, the value that predicted 2014–2019 games best).`,
      ),
      h(
        "p",
        {},
        h("b", {}, "Pass 2, the ranking. "),
        "The same graph is solved again with new spring strengths: pull = quality of the loser + (1 − quality of the winner). A win over a good team and a loss to a bad team make stiff springs; a win over a bad team and a loss to a good team make weak ones. Two average teams make a spring of 1. Every spring still wants one step. The heights of this second graph are the ranking.",
      ),
      h(
        "p",
        {},
        `In both passes a team’s height is the pull-weighted average of what its games say (the opponent’s height plus 1 for a win, minus 1 for a loss), with a small weight (${m.springs.strengthShrink} in pass 1, ${m.springs.rankShrink} in pass 2) on 0, an average team. Scores, home field and head-to-head play no part. Every team starts the season at 0. No polls, preseason, recruiting or conference bonus. FBS and FCS share one graph, and results against lower-division teams count too.`,
      ),
      h(
        "p",
        { class: "muted" },
        "On 2014–2019, the final ranking has the winner above the loser in 84.2% of games and picks 68.5% of next week’s winners; on 2021–2026, 83.5% and 66.9%. The matchup odds come from a separate, calibrated margin model.",
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
        "Settings were chosen on 2014–2019 and frozen; 2021–2026 are a check, not an untouched holdout.",
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
