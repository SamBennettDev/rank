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
    ["Forecast calibration", m.calibrationId],
    ["Standing", m.resume ? "Current-season résumé" : "Frozen earned points"],
    [
      "Loss deduction",
      m.resume
        ? "Benchmark win probability at that venue"
        : String(m.lossPenalty),
    ],
    ["Prediction win premium", String(m.winBonus)],
    ["Forecast team shrink", String(m.shrink)],
    ["Forecast home-field shrink", String(m.homeFieldShrink)],
    [
      "Forecast home field",
      `${m.homeField.toFixed(2)}; SE ${m.homeFieldError.toFixed(2)}`,
    ],
    ["Forecast probability scale", String(m.probabilityScale)],
    ["Forecast residual scale", String(m.residualScale)],
    ["Ranked field", m.classifications.map((c) => c.toUpperCase()).join(" + ")],
    [
      "Win benchmark",
      m.resume
        ? `Results-only FBS #${m.resume.benchmarkRank}`
        : m.winQuality
          ? "Average FBS"
          : "Pooled average",
    ],
    [
      "Maximum win credit",
      m.resume ? "1 win above benchmark" : String(m.winQuality?.winScale ?? 1),
    ],
    ...(m.resume
      ? ([
          ["Résumé regularization", String(m.resume.ridge)],
          ["Résumé home advantage", `${m.resume.homeAdvantage} log odds`],
          ["Opponent evidence", "All focal-team games excluded"],
        ] as [string, string][])
      : []),
    ["Connected groups", String(m.connectedComponents)],
    ["Games counted", String(m.counts.included)],
    ["Strength-model games", String(m.counts.modeled ?? m.counts.included)],
    ["Unmodeled opponents", String(m.counts.unmodeled ?? 0)],
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
      h(
        "h2",
        {},
        m.resume
          ? "What did this team earn against its schedule?"
          : "Add wins. Subtract losses.",
      ),
    ),
    h(
      "div",
      { class: "rating-recipe" },
      h(
        "div",
        { class: "recipe-block win" },
        h("b", {}, m.resume ? "Wins" : m.winQuality ? "0–2" : "0–1"),
        h("span", {}, m.resume ? "Actual results" : "Each win"),
      ),
      h("span", { class: "recipe-symbol", "aria-hidden": "true" }, "−"),
      h(
        "div",
        { class: "recipe-block loss" },
        h("b", {}, m.resume ? "Expected" : "1"),
        h("span", {}, m.resume ? "Top-25 benchmark wins" : "Each loss"),
      ),
      h("span", { class: "recipe-symbol", "aria-hidden": "true" }, "="),
      h(
        "div",
        { class: "recipe-block" },
        h("b", {}, "Score"),
        h("span", {}, m.resume ? "Wins above benchmark" : "Earned points"),
      ),
    ),
    h(
      "p",
      { class: "method-caption" },
      m.resume
        ? "Quality wins earn more. Bad losses cost more. Road results account for venue."
        : m.winQuality
          ? "Average-quality win: +1. Every loss: −1."
          : "Stronger opponents earn more win credit. Every loss costs exactly 1 point.",
    ),
    details(
      "Scoring & scope",
      h(
        "p",
        {},
        m.resume
          ? "For every completed game, estimate a top-25 benchmark’s chance of winning against that opponent at that venue. A win earns 1 minus that probability; a loss deducts that probability. Add the contributions to rank the résumés. A score of +1 means one more win than the benchmark would expect against the same schedule."
          : m.winQuality
            ? "Win points = 2 × the opponent’s chance of beating an average FBS team at that venue. Weak opponents earn less; strong opponents earn more. Credits freeze before the game's calendar week."
            : "Win quality estimates how likely the opponent is to beat an average team at that venue. Credits are fixed before the game's calendar week; later results cannot revalue past wins.",
      ),
      h(
        "p",
        {},
        m.resume
          ? "Opponent quality uses current-season wins, losses and venues. Every team starts equal. When assessing a team, remove all its games before estimating its opponents and the benchmark. Opponent results can revalue earlier wins. No margin, team reputation, poll, conference, recruiting or division-strength prior enters the résumé. An amber dot marks an opponent with fewer than three independent results."
          : "FBS and FCS share one standing. All scores start at zero. Division-level strength estimates come from 2014–2019 results and update with current-season games. No team, poll or conference bonus; strong FCS teams can earn full credit. An amber dot marks limited evidence.",
      ),
      h(
        "p",
        {},
        "Wins over unmodeled opponents earn zero quality points. Losses against those opponents cost 1 point, and those results stay in records and game receipts.",
      ),
      m.resume
        ? h(
            "p",
            {},
            "A team’s record-probability diagnostic is the chance that the benchmark matches or exceeds its win total on that schedule, assuming independent games. It is not the ranking score or a confidence level. Matchup predictions and archived earned-point projections use a separate strength model.",
          )
        : "",
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
        m.resume
          ? "Résumé probability calibration: 2014–2019. The top-25 reference and wins-above-benchmark rule are explicit ranking policies. Historical comparisons cover 2002–2025 and are retrospective development, with no objective ground-truth résumé or claim of universal superiority."
          : "Design and calibration: 2014–2019. Later seasons are development evaluation, not an untouched holdout.",
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
