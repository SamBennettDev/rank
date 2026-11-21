import { computeSeason } from "../../src/engine/season";
import type { Ctx } from "../ctx";
import { h, svg, type Child } from "../dom";
import { loadEpModel } from "../players";
import { expectedPoints } from "../../src/engine/ep";
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
        h("span", {}, "Team strength, 0–100"),
      ),
      h("span", { class: "recipe-symbol", "aria-hidden": "true" }, "→"),
      h(
        "div",
        { class: "recipe-block loss" },
        h("b", {}, "Résumé"),
        h("span", {}, "The ranking, 0–100"),
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
      "Every game is a spring holding its winner above its loser by the margin, each extra point counting a little less than the last. The result is every team’s quality. Résumé, the ranking, and schedule are built from it: a team’s résumé is the average of what its games earned.",
    ),
    details(
      "Résumé, quality and schedule",
      h(
        "p",
        {},
        h("b", {}, "Quality, team strength. "),
        `SpringRank with margins: every game is a spring that wants its winner 100 × margin^0.75 points above its loser. A 1-point win is worth 100, a 2-point win 168.2, a 3-point win 228.0, a 7-point win 430.4, a 14-point win 723.8 and a 35-point win 1439, so each extra point counts a little less than the one before. Every spring is equally strong. Solving the whole graph once gives every team a strength in points: the average of what its games say (the opponent’s strength plus the gap after a win, minus it after a loss), with a small weight (${m.springs.strengthShrink} games) on 0, an average team. Quality is 100 × the chance of beating an average team, from 0 to 100 (scale ${m.springs.qualityScale}, the value that predicted 2014–2019 games best).`,
      ),
      h(
        "p",
        {},
        h("b", {}, "Résumé, the ranking. "),
        "Each team averages its games on a 0–100 scale. A win earns 50 plus half the beaten team’s quality; a loss earns half the winning team’s quality. Beating a 90 team earns 95 and losing to it still earns 45; beating a 10 team earns 55 and losing to it earns only 5.",
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
          : "On 2014–2019, the résumé ranking picks 68.5% of next week’s winners and the final ranking has the winner above the loser in 83.6% of games; on 2021–2026, 67.2% and 82.5%. Ordering by quality instead picks more next-week winners (71.7% and 70.0%) with lower season-end agreement (81.5% and 80.6%): quality measures strength, résumé what was won. The matchup odds come from a separate, calibrated margin model.",
      ),
    ),
    epDetails(),
    ctx.entry.players ? playerDetails() : "",
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
        ctx.entry.players ? file(`seasons/${season}/players.csv`) : "",
        ctx.entry.players ? file(`seasons/${season}/roster.csv`) : "",
        ctx.entry.players ? file(`rankings/${season}/players.json`) : "",
        ctx.entry.players ? file("models/ep.json") : "",
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

// ---------------------------------------------------------------------------
// Our expected-points model: curves by down and its out-of-sample calibration.
type LoadedEp = Awaited<ReturnType<typeof loadEpModel>>;
function epDetails(): HTMLElement {
  const body = h("div", {}, h("div", { class: "loading" }, h("span"), h("span"), h("span")));
  const el = h(
    "details",
    { class: "method-accordion" },
    h("summary", {}, "Expected points (our model)"),
    h(
      "p",
      {},
      "Every snap is worth the points the offense can expect from its down, distance and field position: the next score in the half, a touchdown 7, a field goal 3, a safety 2, the opponent's scores negative, 0 if nobody scores again. We fit those averages ourselves on every FBS and FCS play from 2014 to 2025 (2020 left out) in the NCAA stats mirror: for each down, a piecewise-linear curve in yards to goal plus an adjustment for yards to go. A play's EPA is the expected points after it minus before it, or the points if it scored. Offense, defense and every player rating are built from EPA.",
    ),
    body,
  );
  let loaded = false;
  el.addEventListener("toggle", () => {
    if (loaded || !el.open) return;
    loaded = true;
    void loadEpModel().then((m) => body.replaceChildren(epChart(m), calibration(m)));
  });
  return el;
}

function epChart(m: LoadedEp): HTMLElement {
  const W = 640, H = 260, pad = { l: 40, r: 14, t: 12, b: 34 };
  const x = (ytg: number) => pad.l + ((100 - ytg) / 99) * (W - pad.l - pad.r);
  const lo = -3.5, hi = 6.5;
  const y = (v: number) => pad.t + ((hi - v) / (hi - lo)) * (H - pad.t - pad.b);
  const root = svg("svg", { class: "epchart", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Expected points by field position for each down" });
  for (let v = -3; v <= 6; v += 3) {
    root.appendChild(svg("line", { class: "grid", x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v) }));
    const t = svg("text", { class: "gl", x: pad.l - 6, y: y(v) + 4, "text-anchor": "end" });
    t.textContent = String(v);
    root.appendChild(t);
  }
  for (const ytg of [99, 75, 50, 25, 1]) {
    const t = svg("text", { class: "gl", x: x(ytg), y: H - 12, "text-anchor": "middle" });
    t.textContent = ytg === 99 ? "Own 1" : ytg === 1 ? "Opp 1" : ytg === 50 ? "50" : ytg > 50 ? `Own ${100 - ytg}` : `Opp ${ytg}`;
    root.appendChild(t);
  }
  for (let d = 1; d <= 4; d++) {
    const pts: string[] = [];
    for (let ytg = 99; ytg >= 1; ytg--)
      pts.push(`${pts.length ? "L" : "M"}${x(ytg).toFixed(1)},${y(expectedPoints(m, d, Math.min(d === 1 ? 10 : 5, ytg), ytg)).toFixed(1)}`);
    root.appendChild(svg("path", { class: `ln d${d}`, d: pts.join(" ") }));
  }
  const colors = ["var(--brand)", "#3b82f6", "#a855f7", "var(--loss)"];
  const legend = h(
    "div",
    { class: "eplegend" },
    ...["1st & 10", "2nd & 5", "3rd & 5", "4th & 5"].map((l, i) => h("span", {}, h("i", { style: `background:${colors[i]}` }), l)),
  );
  return h(
    "div",
    {},
    legend,
    root,
    h("p", { class: "hint" }, `Fitted on ${m.plays.toLocaleString()} plays. A field goal's make chance is logistic(${m.fgIntercept} + ${m.fgSlope} × distance in yards); an average kickoff is worth ${m.kickoff} expected points to the kicking team.`),
  );
}

function calibration(m: LoadedEp): HTMLElement {
  const c = m.holdout;
  return h(
    "div",
    {},
    h("p", {}, `Checked on ${c.season}, which was held out of the fit: plays the model put at each value went on to score, on average, close to what it said. Its typical miss is ${c.rmse} points per play, against ${c.rmseConstant} for a flat guess.`),
    h(
      "table",
      { class: "mf" },
      h("thead", {}, h("tr", {}, h("th", {}, "Predicted"), h("th", {}, "Plays"), h("th", {}, "Model"), h("th", {}, "Actual next score"))),
      h("tbody", {}, ...c.calibration.map((r) => h("tr", {}, h("td", {}, `${r.bin > 0 ? "+" : ""}${r.bin}`), h("td", {}, r.plays.toLocaleString()), h("td", {}, r.predicted.toFixed(2)), h("td", {}, r.actual.toFixed(2))))),
    ),
  );
}

function playerDetails(): HTMLElement {
  return h(
    "details",
    { class: "method-accordion" },
    h("summary", {}, "Player ratings"),
    h("p", {}, "Every FBS and FCS player is rated on one scale: how many more expected points he added than an average player would have against the same opponents."),
    h(
      "ol",
      {},
      h("li", {}, "Defenses: from every game's passing and rushing, fit each team's pass and rush offense and defense in EPA per play. An average offense expects the league average minus the defense's rating. Each rating is pulled toward average with 200 plays of evidence."),
      h("li", {}, "Quarterbacks, running backs, receivers and tight ends: game by game, his EPA minus what an average player would gain on the same number of dropbacks, targets and rushes against that defense. Garbage time is left out."),
      h("li", {}, "Kickers: field-goal points over the model's make chance for each kick's distance."),
      h("li", {}, "Defenders: sacks, interceptions and pass breakups at the expected points they save in our model, tackles at a small fixed credit, each game weighted by 0.5 + the opponent's quality ÷ 100."),
      h("li", {}, "Every total is divided by the player's plays (tries, games) plus a fixed number of average ones, so small samples are pulled toward average, then turned into points per game. Boards rank by points per game."),
    ),
    h("p", { class: "hint" }, "Each player's page shows every step with his own numbers. Offensive linemen are not rated: public play-by-play has no per-player blocking data."),
  );
}
