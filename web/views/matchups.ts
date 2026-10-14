import type { MatchupPrediction } from "../../src/engine/types";
import {
  type Ctx,
  fmtTeamScore,
  scoreLabel,
  rankLabel,
  teamHref,
} from "../ctx";
import { neuralPredictor, validateNeuralBundle } from "../../src/engine/neural";
import { fetchText, seasonFiles } from "../store";
import { sha256Hex } from "../../src/engine/hash";
import { h } from "../dom";
import { searchIcon } from "../icons";
import { logo, teamVars } from "../team";
import { provisionalFlag } from "../visuals";

export function matchupCard(ctx: Ctx, p: MatchupPrediction) {
  const home = ctx.byId.get(p.home)!,
    away = ctx.byId.get(p.away)!;
  const side = (id: number, name: string) => {
    const team = ctx.byId.get(id)!;
    const published = ctx.ranking.teams.some((t) => t.id === id);
    return h(
      published ? "a" : "div",
      {
        ...(published ? { href: teamHref(ctx, id) } : {}),
        class: "matchup-side tv",
        style: teamVars(ctx.teams.get(id)?.color),
      },
      logo(ctx.teams.get(id), 38, { lazy: true }),
      h(
        "div",
        {},
        h("span", { class: "school", title: name }, name),
        h(
          "b",
          { class: "matchup-score" },
          ctx.ranking.manifest.neural
            ? `${(100 * (id === p.home ? p.homeProbability : 1 - p.homeProbability)).toFixed(1)}%`
            : published
              ? fmtTeamScore(ctx, team)
              : team.classification.toUpperCase(),
        ),
        h(
          "span",
          { class: "matchup-rank" },
          published
            ? `#${rankLabel(team.rank, team.tied)} · ${ctx.ranking.manifest.neural ? "Win chance" : scoreLabel(ctx)}`
            : "Opponent",
        ),
      ),
    );
  };
  return h(
    "article",
    { class: "panel matchup" },
    h(
      "div",
      { class: "matchup-meta" },
      h(
        "time",
        { datetime: p.startDate },
        new Date(p.startDate).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        }),
      ),
      h(
        "span",
        { class: "scope-label" },
        p.neutralSite ? "Neutral" : "Home field",
        p.provisional ? provisionalFlag() : "",
      ),
    ),
    h(
      "div",
      { class: "matchup-contest" },
      side(p.away, away.school),
      h(
        "span",
        { class: "contest-divider", "aria-hidden": "true" },
        p.neutralSite ? "vs" : "at",
      ),
      side(p.home, home.school),
    ),
    ctx.ranking.manifest.neural
      ? h(
          "div",
          { class: "neural-game-probabilities" },
          h("span", {}, "Neural forecast"),
          h(
            "b",
            {},
            Math.abs(p.homeProbability - 0.5) < 1e-10
              ? "Even matchup"
              : `${p.homeProbability > 0.5 ? home.school : away.school} favored`,
          ),
        )
      : "",
  );
}

function comparisonTool(ctx: Ctx) {
  const result = h(
    "p",
    { class: "hint", role: "status", "aria-live": "polite" },
    "Loading neural predictor…",
  );
  const options = () =>
    ctx.ranking.teams.map((t) =>
      h("option", { value: String(t.id) }, t.school),
    );
  const first = h("select", { "aria-label": "First team" }, ...options());
  const second = h("select", { "aria-label": "Second team" }, ...options());
  first.value = String(ctx.ranked[0]?.id);
  second.value = String(ctx.ranked[1]?.id);
  const venue = h(
    "select",
    { "aria-label": "Comparison venue" },
    h("option", { value: "0" }, "Neutral field"),
    h("option", { value: "1" }, "First team at home"),
    h("option", { value: "-1" }, "Second team at home"),
  );
  const controls = h(
    "div",
    { class: "neural-compare-controls" },
    first,
    second,
    venue,
  );
  void fetchText(seasonFiles(ctx.entry.season).neuralJson)
    .then(async (raw) => {
      if ((await sha256Hex(raw)) !== ctx.ranking.manifest.neural!.bundleSha256)
        throw new Error(
          "Prediction inputs changed. Reload this page to use the latest ranking.",
        );
      const bundle = validateNeuralBundle(JSON.parse(raw));
      const snapshot = bundle.snapshots.find((s) => s.id === ctx.snapId);
      if (!snapshot || snapshot.asOf !== ctx.ranking.snapshot.asOf)
        throw new Error("Neural snapshot unavailable");
      const predictor = neuralPredictor(bundle, snapshot, false);
      const indices = new Map(bundle.teamIds.map((id, i) => [id, i]));
      const draw = () => {
        const a = Number(first.value),
          b = Number(second.value);
        if (a === b) {
          result.textContent = "Choose two different teams.";
          return;
        }
        const p = predictor.probability(
          indices.get(a)!,
          indices.get(b)!,
          Number(venue.value),
        );
        const one = ctx.byId.get(a)!.school,
          two = ctx.byId.get(b)!.school;
        result.textContent = `${one}: ${(100 * p).toFixed(1)}% · ${two}: ${(100 * (1 - p)).toFixed(1)}%. ${Math.abs(p - 0.5) < 1e-10 ? "Even matchup." : `${p > 0.5 ? one : two} favored.`}`;
      };
      for (const select of [first, second, venue]) select.onchange = draw;
      draw();
    })
    .catch((error) => {
      result.textContent =
        error instanceof Error ? error.message : String(error);
    });
  return h(
    "section",
    { class: "panel neural-compare" },
    h("h2", {}, "Who is more likely to win?"),
    controls,
    result,
    h(
      "p",
      { class: "hint" },
      "Predictions use statistics available at the selected week. Change the venue to include the network’s learned home advantage.",
    ),
  );
}

export function matchupsView(ctx: Ctx) {
  let query = "";
  const list = h("div", { class: "matchup-list" }),
    count = h("span", { class: "count", "aria-live": "polite" });
  const draw = () => {
    const predictions = ctx.ranking.predictions.filter((p) => {
      const home = ctx.byId.get(p.home)!,
        away = ctx.byId.get(p.away)!;
      return (
        !query ||
        home.school.toLowerCase().includes(query) ||
        away.school.toLowerCase().includes(query)
      );
    });
    list.replaceChildren(...predictions.map((p) => matchupCard(ctx, p)));
    if (!predictions.length)
      list.append(h("div", { class: "empty" }, "No scheduled matchups match."));
    count.textContent = `${predictions.length} games`;
  };
  const root = h(
    "div",
    { class: "matchups-page" },
    h(
      "section",
      { class: "page-heading" },
      h(
        "div",
        {},
        h(
          "div",
          { class: "eyebrow" },
          `${ctx.entry.season} · ${ctx.ranking.snapshot.label}`,
        ),
        h("h1", {}, "Up next"),
      ),
      h(
        "span",
        { class: "scope-pill" },
        h("span", { class: "status-dot" }),
        ctx.ranking.manifest.neural ? "Neural predictions" : "Current scores",
      ),
    ),
    ctx.ranking.manifest.neural ? comparisonTool(ctx) : "",
    h(
      "div",
      { class: "toolbar schedule-tools" },
      h(
        "label",
        { class: "search" },
        searchIcon(),
        h("input", {
          type: "search",
          placeholder: "Find a team",
          "aria-label": "Filter matchups by team",
          oninput: (e: Event) => {
            query = (e.target as HTMLInputElement).value.trim().toLowerCase();
            draw();
          },
        }),
        count,
      ),
    ),
    list,
  );
  draw();
  return root;
}
