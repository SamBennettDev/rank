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
    ["Pull toward average", String(m.springs.strengthShrink)],
    ["Quality scale", String(m.springs.qualityScale)],
    ["Matchup calibration", m.matchup.calibrationId],
    ["Matchup win premium", `${m.matchup.winBonus} points`],
    ...(ctx.entry.league
      ? []
      : ([
          ["Matchup FBS–FCS starting gap", `${m.matchup.divisionGap} points`],
        ] as [string, string][])),
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
    h("div", { class: "section-heading" }, h("h2", {}, "One spring graph.")),
    h(
      "div",
      { class: "rating-recipe" },
      h(
        "div",
        { class: "recipe-block win" },
        h("b", {}, "Quality"),
        h("span", {}, "The ranking, 0–100"),
      ),
      h("span", { class: "recipe-symbol", "aria-hidden": "true" }, "→"),
      h(
        "div",
        { class: "recipe-block loss" },
        h("b", {}, "Résumé"),
        h("span", {}, "Points per game"),
      ),
      h("span", { class: "recipe-symbol", "aria-hidden": "true" }, "+"),
      h(
        "div",
        { class: "recipe-block" },
        h("b", {}, "Schedule"),
        h("span", {}, "Opponents’ quality"),
      ),
    ),
    h(
      "p",
      { class: "method-caption" },
      "Every game is a spring holding its winner above its loser by the margin, each extra point counting less than the last. Upsets and wins over good teams pull hard; a good team beating a bad one barely pulls. The result is every team’s quality, and quality is the ranking. Résumé and schedule are built from it.",
    ),
    details(
      "Quality, résumé and schedule",
      h(
        "p",
        {},
        h("b", {}, "Quality, the ranking. "),
        `SpringRank with margins: every game is a spring that wants its winner 100 × (1 + 1/2 + … + 1/margin) points above its loser. A 1-point win is worth 100, a 2-point win 150, a 3-point win 183.3, a 14-point win 325.2 and a 35-point win 414.7, so each extra point counts less than the one before. Each spring is as strong as its result was surprising: the loser’s chance of beating an average team + (1 − the winner’s). An upset or a win over a good team pulls hard; a good team beating a bad one barely pulls, so a blowout of a weak team doesn’t drag the winner down. Solving the whole graph, and repeating until the spring strengths settle, gives every team a strength in points: the spring-weighted average of what its games say, with a small weight (${m.springs.strengthShrink}) on 0, an average team. Quality is 100 × the chance of beating an average team, from 0 to 100 (scale ${m.springs.qualityScale}, the value that predicted 2014–2019 games best).`,
      ),
      h(
        "p",
        {},
        h("b", {}, "Résumé. "),
        "Each team averages its games. A win earns the beaten team’s quality; a loss costs 100 minus the winning team’s quality. Beating a 90 team earns +90 and losing to it costs only −10; beating a 10 team earns +10 and losing to it costs −90.",
      ),
      h(
        "p",
        {},
        h("b", {}, "Schedule. "),
        "The average quality of the opponents a team has played, from 0 to 100.",
      ),
      h(
        "p",
        {},
        ctx.entry.league
          ? "Home field and head-to-head play no part. Every team starts the season at 0. No polls, preseason or reputation: only the games played."
          : "Home field and head-to-head play no part. Every team starts the season at 0. No polls, preseason, recruiting or conference bonus. FBS and FCS share one graph, and results against lower-division teams count too.",
      ),
      h(
        "p",
        { class: "muted" },
        ctx.entry.league
          ? "The settings were chosen on college football (2014–2019) and are reused for the NFL unchanged; they have not been tuned or backtested on NFL games. The matchup odds come from a separate margin model that is likewise uncalibrated for the NFL."
          : "On 2014–2019, the quality ranking picks 70.4% of next week’s winners and the final ranking has the winner above the loser in 83.1% of games; on 2021–2026, 69.2% and 82.7%. The matchup odds come from a separate, calibrated margin model.",
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
