import { computeSeason } from "../../src/engine/season";
import type { Ctx } from "../ctx";
import { h } from "../dom";
import { fetchText, rankingPath, seasonFiles } from "../store";

export function neuralMethodView(ctx: Ctx) {
  const m = ctx.ranking.manifest,
    n = m.neural!,
    files = seasonFiles(ctx.entry.season);
  const result = h("p", {
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
        result.textContent = "Loading numeric snapshots and trained weights…";
        try {
          const [
            teamsCsv,
            gamesCsv,
            configJson,
            playsCsv,
            neuralJson,
            richCsv,
          ] = await Promise.all([
            fetchText(files.teamsCsv),
            fetchText(files.gamesCsv),
            fetchText(files.configJson),
            fetchText(files.playsCsv),
            fetchText(files.neuralJson),
            fetchText(files.richCsv),
          ]);
          const out = await computeSeason(
            {
              season: ctx.entry.season,
              teamsCsv,
              gamesCsv,
              configJson,
              playsCsv,
              neuralJson,
              richCsv,
            },
            async (done, total) => {
              result.textContent = `Recomputing ${done} of ${total} neural rankings…`;
              await new Promise((r) => setTimeout(r, 0));
            },
          );
          const bad = [];
          for (const file of out.files)
            if (
              (await fetchText(rankingPath(ctx.entry.season, file.id))) !==
              file.json
            )
              bad.push(file.id);
          result.className = bad.length ? "result bad" : "result ok";
          result.textContent = bad.length
            ? `Mismatch: ${bad.join(", ")}.`
            : `Exact match. Your browser rebuilt all ${out.files.length} neural rankings and matchup forecasts byte for byte.`;
        } catch (error) {
          result.className = "result bad";
          result.textContent =
            error instanceof Error ? error.message : String(error);
        }
        button.disabled = false;
      },
    },
    "Recompute neural rankings",
  );
  const link = (path: string, label: string) =>
    h(
      "a",
      { href: `./data/${path}`, target: "_blank", rel: "noopener" },
      label,
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
        h("div", { class: "eyebrow" }, "The neural model"),
        h("h1", {}, "Predict every matchup. Order the teams."),
      ),
    ),
    h(
      "p",
      { class: "method-caption" },
      "The ranking is built from who the neural network expects to beat whom on a neutral field.",
    ),
    h(
      "ol",
      {},
      h(
        "li",
        {},
        `Learn shared weights from ${n.trainingYears[0]}–${n.trainingYears.at(-1)} pregame statistics and eventual outcomes.`,
      ),
      h(
        "li",
        {},
        "Build each team’s inputs from the current season’s scores, margins, efficiency and opponent statistics. Every team starts equal.",
      ),
      h(
        "li",
        {},
        n.policy ? `Start with the robust schedule rating divided by ${n.policy.anchorScale}. Three neural fits add a correction bounded to ±${n.policy.residualLimit}. Shrink that performance estimate by games / (games + ${n.policy.evidencePrior}), then subtract ${n.policy.lossPenalty} × losses / (games + ${n.policy.lossPrior}). Predict every neutral-site matchup among ${n.referenceTeams} FBS/FCS teams from the resulting strength difference.`
          : `Predict every neutral-site matchup among ${n.referenceTeams} modeled FBS/FCS teams, using three rich-stat networks and three opponent-graph networks.`,
      ),
      h(
        "li",
        {},
        "Start with expected round-robin wins, then improve the ordering to maximize the sum of predicted win probabilities for teams placed above their opponents.",
      ),
    ),
    h(
      "p",
      {},
      n.policy ? "All three networks use the same team-strength architecture. Averaging their strength differences gives a consistent neutral-field order: every higher-ranked team is favored over every lower-ranked team, and tied strengths predict 50%. Venue can change the favorite in an actual game."
        : "Some matchup predictions form cycles. The ordering balances all pairs through deterministic improving moves. It is a locally optimized consensus; it does not guarantee an exact global optimum or that every higher-ranked team is favored in every matchup.",
    ),
    h(
      "p",
      {},
      "The average win chance shown beside a team summarizes its neutral probabilities against the full field. It can differ from its ordering position. Use the matchup tool to compare specific teams. Home advantage applies to game forecasts; the ranking uses neutral venues.",
    ),
    h(
      "details",
      { class: "method-accordion" },
      h("summary", {}, "Inputs and training"),
      h(
        "p",
        {},
        n.policy ? "Every game margin is capped at 35 before fitting all selected score-based ratings, including the robust Huber rating. Extra scoreboard margin beyond that cap supplies no additional credit. The neural correction uses 50 numeric inputs covering capped ratings, opponent-adjusted efficiency, special teams and evidence. Raw scoring averages, raw EPA averages, margin variation, Elo and record ratings are excluded. Inputs and the total neural correction are bounded. Losses enter a separate deduction after training; every loss counts, including losses to outside opponents. Team identity, conferences, divisions, recruiting, polls and live betting prices are excluded."
          : "Rich-stat networks receive 64 numeric inputs. Graph networks receive 152, including opponents’ and opponents’ opponents’ current-season statistics. Their probabilities are blended 75% / 25%. Team names, IDs, conferences, divisions, recruiting, preseason ratings and live betting prices are excluded from neural features. IDs only join records.",
      ),
      h(
        "p",
        {},
        "Only completed results assumed available six hours after kickoff can enter a snapshot. Shared weights and normalization were trained before the forecast season. Missing play-by-play produces incomplete-evidence flags. Historical design and development seasons have been inspected.",
      ),
      h(
        "p",
        {},
        n.policy ? "Three older validation periods selected the final capped model from 16 neural configurations and three positive post-training loss penalties, following two earlier design rounds. Probability calibration uses older validation forecasts and preserves picks and ranks. On 3,603 dated FBS games in 2020–2025, this model picked 70.16% of winners versus 70.86% for the previous blend. The stronger loss policy and score cap have a measured accuracy cost. These results do not establish a betting-market advantage. Historical seasons were already inspected."
          : "The saved blend picked 70.86% of winners in 3,603 dated FBS games from 2020–2025. Its published research includes matched sportsbook comparisons and the limits of that evaluation.",
      ),
    ),
    h(
      "details",
      { class: "method-accordion" },
      h("summary", {}, "Ordering and audit data"),
      h(
        "p",
        {},
        `This snapshot needed ${n.orderingMoves} improving moves. The weighted pair objective rose from ${n.initialObjective.toFixed(3)} to ${n.objective.toFixed(3)}. ${n.disagreements} pairwise favorites disagree with the resulting full order. These are ordering diagnostics, not game-prediction accuracy.`,
      ),
      h(
        "p",
        {},
        "Neural height in the JSON is an ordinal coordinate for the graph. Actual probabilities are stored in each team’s neural object and in matchup forecasts. Legacy earned-point credits and projections remain explicitly separate in downloadable data.",
      ),
      h(
        "div",
        { class: "files" },
        link(files.neuralJson, "Features and trained weights"),
        link(
          rankingPath(ctx.entry.season, ctx.snapId),
          "Current rankings and predictions",
        ),
        link(files.teamsCsv, "Teams"),
        link(files.gamesCsv, "Games"),
        link(files.playsCsv, "Play-by-play summary"),
      ),
      h("p", {}, h("code", {}, `Neural input SHA-256: ${n.bundleSha256}`)),
    ),
    h(
      "section",
      { class: "panel method-verification" },
      h("h2", {}, "Check the neural inference"),
      h(
        "p",
        { class: "hint" },
        "Run the published weights on the saved numeric snapshots in your browser. Raw feature extraction is reproducible with the repository’s Python exporter.",
      ),
      button,
      result,
    ),
    h(
      "p",
      {},
      h(
        "a",
        {
          href: "https://github.com/SamBennettDev/rank/tree/codex/season-only-neural-research/research/season_only",
          target: "_blank",
          rel: "noopener",
        },
        "Research, validation and reproduction ↗",
      ),
    ),
  );
}
