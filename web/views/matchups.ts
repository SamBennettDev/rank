import type { MatchupPrediction } from "../../src/engine/types";
import { type Ctx, teamHref } from "../ctx";
import { h } from "../dom";
import { searchIcon } from "../icons";
import { logo, teamVars } from "../team";
import { percent, provisionalFlag } from "../visuals";

export function matchupCard(ctx: Ctx, p: MatchupPrediction) {
  const home = ctx.byId.get(p.home)!,
    away = ctx.byId.get(p.away)!;
  const side = (id: number, name: string, probability: number) =>
    h(
      "a",
      {
        href: teamHref(ctx, id),
        class: "matchup-side tv",
        style: teamVars(ctx.teams.get(id)?.color),
      },
      logo(ctx.teams.get(id), 38, { lazy: true }),
      h(
        "div",
        {},
        h("span", { class: "school", title: name }, name),
        h("b", { class: "win-chance" }, percent(probability)),
      ),
    );
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
      side(p.away, away.school, 1 - p.homeProbability),
      h(
        "span",
        { class: "contest-divider", "aria-hidden": "true" },
        p.neutralSite ? "vs" : "at",
      ),
      side(p.home, home.school, p.homeProbability),
    ),
    h(
      "div",
      {
        class: "matchup-probabilities",
        role: "img",
        "aria-label": `${away.school} win chance ${percent(1 - p.homeProbability)}, ${home.school} ${percent(p.homeProbability)}`,
      },
      h("i", {
        class: "tv",
        style: `${teamVars(ctx.teams.get(p.away)?.color)};width:${100 * (1 - p.homeProbability)}%`,
      }),
      h("i", {
        class: "tv",
        style: `${teamVars(ctx.teams.get(p.home)?.color)};width:${100 * p.homeProbability}%`,
      }),
    ),
    h(
      "div",
      { class: "matchup-footer" },
      h("span", {}, p.neutralSite ? "Win probability" : "Away"),
      h("span", {}, p.neutralSite ? "Neutral site" : "Home"),
    ),
  );
}

export function matchupsView(ctx: Ctx) {
  let query = "",
    division = "all";
  const list = h("div", { class: "matchup-list" }),
    count = h("span", { class: "count", "aria-live": "polite" });
  const draw = () => {
    const predictions = ctx.ranking.predictions.filter((p) => {
      const home = ctx.byId.get(p.home)!,
        away = ctx.byId.get(p.away)!;
      return (
        (division === "all" ||
          (home.classification === division &&
            away.classification === division)) &&
        (!query ||
          home.school.toLowerCase().includes(query) ||
          away.school.toLowerCase().includes(query))
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
        "Win probability",
      ),
    ),
    h(
      "div",
      { class: "toolbar forecast-tools" },
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
      h(
        "select",
        {
          "aria-label": "Matchup division",
          onchange: (e: Event) => {
            division = (e.target as HTMLSelectElement).value;
            draw();
          },
        },
        ...["all", "fbs", "fcs"].map((d) =>
          h(
            "option",
            { value: d },
            d === "all"
              ? "All games"
              : `${d.toUpperCase()} vs ${d.toUpperCase()}`,
          ),
        ),
      ),
    ),
    list,
  );
  draw();
  return root;
}
