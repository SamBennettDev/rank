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
        h("b", {}, "Quality"),
        h("span", {}, "0 to 7 points"),
      ),
      h("span", { class: "recipe-symbol", "aria-hidden": "true" }, "="),
      h(
        "div",
        { class: "recipe-block" },
        h("b", {}, "Points"),
        h("span", {}, "Per game: the ranking"),
      ),
    ),
    h(
      "p",
      { class: "method-caption" },
      "Pass 1 is a spring graph that counts the margin, each extra point less than the last, to judge how good every team is. Pass 2 averages points per game: a win earns the beaten team’s quality, a loss costs 7 minus the winner’s. Beat a good team or lose to a bad one and it counts most.",
    ),
    details(
      "The two passes",
      h(
        "p",
        {},
        h("b", {}, "Pass 1, strength. "),
        `SpringRank with margins: every game is a spring of strength 1 that wants its winner 7 × (1 + 1/2 + … + 1/margin) points above its loser. A 1-point win is worth 7, a 2-point win 10.5, a 3-point win 12.8, a 14-point win 22.8 and a 35-point win 29.0, so each extra point counts less than the one before. Solving the whole graph at once gives every team a strength. Each strength becomes a quality: 7 × the chance of beating an average team, from 0 to 7 (scale ${m.springs.qualityScale}, the value that predicted 2014–2019 games best). A team’s height in this pass is the average of what its games say (the opponent’s height plus the gap for a win, minus it for a loss), with a small weight (${m.springs.strengthShrink}) on 0, an average team.`,
      ),
      h(
        "p",
        {},
        h("b", {}, "Pass 2, the ranking. "),
        "Each team averages its games. A win earns the beaten team’s quality; a loss costs 7 minus the winning team’s quality. Beating a 6.5 team earns +6.5 and losing to it costs only −0.5; beating a 0.5 team earns +0.5 and losing to it costs −6.5. Points per game played is the ranking, so playing an extra game is no advantage by itself.",
      ),
      h(
        "p",
        {},
        "Home field and head-to-head play no part. Every team starts the season at 0. No polls, preseason, recruiting or conference bonus. FBS and FCS share one graph, and results against lower-division teams count too.",
      ),
      h(
        "p",
        { class: "muted" },
        "On 2014–2019, the final ranking has the winner above the loser in 83.4% of games and picks 68.6% of next week’s winners; on 2021–2026, 82.9% and 67.2%. The matchup odds come from a separate, calibrated margin model.",
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
