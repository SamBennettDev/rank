import type { MatchupPrediction } from "../../src/engine/types";
import { type Ctx, fmtHeight, rankLabel, teamHref } from "../ctx";
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
          published
            ? fmtHeight(team.height, 3)
            : team.classification.toUpperCase(),
        ),
        h(
          "span",
          { class: "matchup-rank" },
          published
            ? `#${rankLabel(team.rank, team.tied)} · Score`
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
        "Current scores",
      ),
    ),
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
