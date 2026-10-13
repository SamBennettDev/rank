import { type Ctx, fmtHeight, rankLabel, record, teamHref } from "../ctx";
import { h } from "../dom";
import { logo } from "../team";

export function projectionPanel(ctx: Ctx, teamId: number) {
  const t = ctx.byId.get(teamId)!,
    p = t.projection;
  return h(
    "div",
    { class: "panel" },
    h("h2", {}, "Current standing vs projected finish"),
    p
      ? h(
          "div",
          {},
          h(
            "p",
            {},
            `Current #${rankLabel(t.rank, t.tied)} → projected average #${p.expectedRank.toFixed(1)}; median #${p.medianRank}. 80% model range: #${p.rankLow}–#${p.rankHigh}.`,
          ),
          h(
            "p",
            {},
            `Top 25: ${(100 * p.top25Probability).toFixed(1)}%. Finish first: ${(100 * p.firstProbability).toFixed(1)}%. Expected final rating: ${fmtHeight(p.expectedRating)} points.`,
          ),
          h(
            "p",
            { class: "hint" },
            `Simulates ${ctx.ranking.projection.remainingGames} known remaining games across the season. Future wins use estimated opponent quality; every simulated loss costs 1 point. Unassigned postseason matchups are excluded until known.`,
          ),
        )
      : h("p", {}, "No counted results or scheduled games to project yet."),
    t.height === null
      ? ""
      : h(
          "p",
          { class: "hint" },
          `Current rating ${fmtHeight(t.height)} earned points. Each loss deducts exactly 1 point.${t.provisional ? " Provisional: limited or disconnected opponent evidence." : ""}`,
        ),
  );
}

export function projectionView(
  ctx: Ctx,
  initialSort: "current" | "projected" = "projected",
) {
  let query = "",
    division = "all",
    conference = "",
    sort = initialSort;
  const body = h("div"),
    count = h("span", { class: "count" }),
    sortButtons = h("div", {
      class: "seg",
      role: "group",
      "aria-label": "Sort standings",
    });
  const draw = () => {
    const teams = ctx.ranking.teams
      .filter(
        (t) =>
          (t.rank !== null || t.projection) &&
          (division === "all" || t.classification === division) &&
          (!conference || t.conference === conference) &&
          (!query ||
            t.school.toLowerCase().includes(query) ||
            t.abbreviation.toLowerCase() === query),
      )
      .sort((a, b) =>
        sort === "current"
          ? (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.id - b.id
          : (a.projection?.expectedRank ?? Infinity) -
              (b.projection?.expectedRank ?? Infinity) || a.id - b.id,
      );
    body.replaceChildren(
      ...teams.map((t) => {
        const p = t.projection;
        return h(
          "a",
          { class: "projection-row", href: teamHref(ctx, t.id) },
          h("b", {}, rankLabel(t.rank, t.tied)),
          logo(ctx.teams.get(t.id), 34),
          h(
            "div",
            { class: "forecast-team" },
            h("b", {}, t.school),
            h(
              "div",
              { class: "hint" },
              `${t.classification.toUpperCase()} · ${t.conference}${t.provisional ? " · Provisional" : ""}`,
              p
                ? h(
                    "span",
                    { class: "mobile-range" },
                    ` · 80% range #${p.rankLow}–#${p.rankHigh}`,
                  )
                : "",
            ),
          ),
          h("span", { class: "forecast-record" }, record(t)),
          h("span", { class: "forecast-rating" }, fmtHeight(t.height, 3)),
          h(
            "b",
            { class: "forecast-finish" },
            p ? `#${p.expectedRank.toFixed(1)}` : "—",
          ),
          h(
            "span",
            { class: "forecast-range" },
            p ? `#${p.rankLow}–#${p.rankHigh}` : "—",
          ),
          h("b", {}, p ? `${(100 * p.top25Probability).toFixed(1)}%` : "—"),
        );
      }),
    );
    if (!teams.length)
      body.append(h("p", { class: "empty" }, "No teams match."));
    count.textContent = `${teams.length} teams`;
    sortButtons.replaceChildren(
      ...(
        [
          ["Current standing", "current"],
          ["Projected finish", "projected"],
        ] as const
      ).map(([label, value]) =>
        h(
          "button",
          {
            type: "button",
            class: sort === value ? "on" : "",
            "aria-pressed": sort === value,
            onclick: () => {
              sort = value;
              draw();
            },
          },
          label,
        ),
      ),
    );
  };
  const root = h(
    "div",
    {},
    h(
      "section",
      { class: "hero" },
      h("div", { class: "eyebrow" }, "One rating · two points in time"),
      h("h1", {}, "Current vs projected"),
      h(
        "p",
        { class: "hint" },
        `Wins earn 0–1 point based on opponent quality; every loss costs exactly 1 point. Projected finish simulates ${ctx.ranking.projection.remainingGames} known remaining matchups${ctx.ranking.projection.horizon ? `, through ${ctx.ranking.projection.horizon.slice(0, 10)}` : ""} under the same ranking rule. Average finish can be fractional; ranges contain 80% of the model simulations.`,
      ),
      h(
        "p",
        { class: "hint" },
        "Unassigned postseason matchups and future roster changes are not modeled. Ranks and top-25 probabilities refer to the full FBS/FCS field.",
      ),
    ),
    sortButtons,
    h(
      "div",
      { class: "toolbar forecast-tools" },
      h(
        "label",
        { class: "search" },
        h("input", {
          type: "search",
          placeholder: "Find a team",
          "aria-label": "Filter standings",
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
          "aria-label": "Standings division",
          onchange: (e: Event) => {
            division = (e.target as HTMLSelectElement).value;
            draw();
          },
        },
        ...["all", "fbs", "fcs"].map((d) =>
          h(
            "option",
            { value: d },
            d === "all" ? "All teams" : d.toUpperCase(),
          ),
        ),
      ),
      h(
        "select",
        {
          "aria-label": "Standings conference",
          onchange: (e: Event) => {
            conference = (e.target as HTMLSelectElement).value;
            draw();
          },
        },
        h("option", { value: "" }, "All conferences"),
        ...[...new Set(ctx.ranking.teams.map((t) => t.conference))]
          .sort()
          .map((c) => h("option", { value: c }, c)),
      ),
    ),
    h(
      "div",
      { class: "panel projection-board" },
      h(
        "div",
        { class: "projection-row forecast-head" },
        h("span", {}, "Current"),
        h("span"),
        h("span", {}, "Team"),
        h("span", { class: "forecast-record" }, "W–L"),
        h("span", { class: "forecast-rating" }, "Rating"),
        h("span", {}, "Projected"),
        h("span", { class: "forecast-range" }, "80% rank range"),
        h("span", {}, "Top 25"),
      ),
      body,
    ),
  );
  draw();
  return root;
}
