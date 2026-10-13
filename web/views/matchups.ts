import type { MatchupPrediction } from "../../src/engine/types";
import { type Ctx, fmtHeight, teamHref } from "../ctx";
import { h } from "../dom";
import { logo } from "../team";

export function matchupCard(ctx: Ctx, p: MatchupPrediction) {
  const home = ctx.byId.get(p.home)!,
    away = ctx.byId.get(p.away)!;
  const side = (id: number, name: string, probability: number) =>
    h(
      "a",
      { href: teamHref(ctx, id), class: "matchup-side" },
      logo(ctx.teams.get(id), 36),
      h("span", {}, name),
      h("b", {}, `${(100 * probability).toFixed(1)}%`),
    );
  return h(
    "article",
    { class: "panel matchup" },
    h(
      "p",
      { class: "hint" },
      new Date(p.startDate).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
      p.neutralSite ? " · Neutral field" : " · Home field included",
    ),
    h(
      "div",
      { class: "matchup-teams" },
      side(p.away, away.school, 1 - p.homeProbability),
      h("span", {}, "at"),
      side(p.home, home.school, p.homeProbability),
    ),
    h(
      "p",
      { class: "hint" },
      `${home.school} strength edge ${fmtHeight(p.strengthEdge)} points. `,
      p.provisional
        ? h(
            "span",
            { class: "tag-held" },
            "Provisional — limited schedule evidence",
          )
        : "Win probabilities include rating uncertainty.",
    ),
  );
}

export function matchupsView(ctx: Ctx) {
  let query = "",
    division = "all";
  const list = h("div", { class: "matchup-list" }),
    count = h("span", { class: "count" });
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
      list.append(
        h(
          "div",
          { class: "empty" },
          h(
            "p",
            {},
            "No scheduled matchups match. Forecasts require both teams to have played and a kickoff after this snapshot.",
          ),
        ),
      );
    count.textContent = `${predictions.length} games`;
  };
  const root = h(
    "div",
    {},
    h(
      "section",
      { class: "hero" },
      h("div", { class: "eyebrow" }, "Matchups"),
      h("h1", {}, "Who wins next?"),
      h(
        "p",
        { class: "hint" },
        `Forecasts from ${ctx.ranking.snapshot.asOf ?? ctx.ranking.snapshot.label}. Scores, opponents and fitted home field estimate win probabilities. The season forecast applies simulated results to the earned-standing score. Later scores are excluded.`,
      ),
    ),
    h(
      "div",
      { class: "toolbar forecast-tools" },
      h(
        "label",
        { class: "search" },
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
