import { type Ctx, fmtHeight, href, rankLabel, record, teamHref } from "../ctx";
import { h } from "../dom";
import { searchIcon } from "../icons";
import { logo, shortConf, teamVars } from "../team";
import {
  chanceMeter,
  movement,
  probabilityRing,
  provisionalFlag,
  rankRange,
} from "../visuals";
import type { RankedTeam } from "../../src/engine/types";

const forecastTied = (ctx: Ctx, t: RankedTeam) =>
  !!t.projection &&
  ctx.ranking.teams.filter(
    (other) => other.projection?.rank === t.projection!.rank,
  ).length > 1;
const finishLabel = (ctx: Ctx, t: RankedTeam) =>
  t.projection ? rankLabel(t.projection.rank, forecastTied(ctx, t)) : "—";

export function projectionPanel(ctx: Ctx, teamId: number) {
  const t = ctx.byId.get(teamId)!,
    p = t.projection;
  if (!p)
    return h(
      "section",
      { class: "panel season-outlook" },
      h("h2", {}, "Season outlook"),
      h("p", { class: "hint" }, "Awaiting a result or scheduled matchup."),
    );
  return h(
    "section",
    { class: "panel season-outlook" },
    h(
      "div",
      { class: "section-heading" },
      h("h2", {}, "Season outlook"),
      t.provisional
        ? h("span", { class: "scope-label" }, provisionalFlag(), "Limited data")
        : h("span", { class: "scope-label" }, "Known schedule"),
    ),
    h(
      "div",
      { class: "outlook-layout" },
      h(
        "div",
        {},
        h(
          "div",
          { class: "rank-journey" },
          h(
            "div",
            {},
            h("span", { class: "stat-label" }, "Current"),
            h("b", {}, t.rank === null ? "—" : `#${rankLabel(t.rank, t.tied)}`),
          ),
          h("span", { class: "journey-arrow", "aria-hidden": "true" }, "→"),
          h(
            "div",
            {},
            h("span", { class: "stat-label" }, "Projected"),
            h("b", { class: "projected-position" }, `#${finishLabel(ctx, t)}`),
            movement(t.rank, p.rank),
          ),
        ),
        rankRange(t.rank, p, ctx.ranking.projection.teams, true),
        h(
          "div",
          { class: "range-key" },
          h("span", {}, h("i", { class: "key-current" }), "Current"),
          h("span", {}, h("i", { class: "key-projected" }), "Projected"),
          h(
            "span",
            {},
            h("i", { class: "key-range" }),
            `80% range: #${p.rankLow}–#${p.rankHigh}`,
          ),
        ),
      ),
      h(
        "div",
        { class: "outlook-chances" },
        probabilityRing(p.top25Probability, "Top 25"),
        probabilityRing(p.firstProbability, "No. 1"),
      ),
    ),
    h(
      "details",
      { class: "quiet-details" },
      h("summary", {}, "Forecast details"),
      h(
        "p",
        {},
        "Projected ranks order teams by average simulated finish. Ranges show 80% of simulated results. Unassigned postseason matchups are excluded.",
      ),
      h(
        "div",
        { class: "detail-stats" },
        h("span", {}, "Average finish ", h("b", {}, p.expectedRank.toFixed(1))),
        h("span", {}, "Median finish ", h("b", {}, `#${p.medianRank}`)),
        h(
          "span",
          {},
          "Projected rating ",
          h("b", {}, fmtHeight(p.expectedRating, 3)),
        ),
      ),
    ),
  );
}

function leaderCard(ctx: Ctx, t: RankedTeam) {
  const p = t.projection!;
  return h(
    "a",
    {
      class: "leader-card tv",
      href: teamHref(ctx, t.id),
      style: teamVars(ctx.teams.get(t.id)?.color),
    },
    h(
      "div",
      { class: "leader-identity" },
      logo(ctx.teams.get(t.id), 42),
      h(
        "div",
        {},
        h(
          "b",
          {},
          h("span", { class: "school-label" }, t.school),
          t.provisional ? provisionalFlag() : "",
        ),
        h("span", {}, `${record(t)} · ${shortConf(t.conference)}`),
      ),
    ),
    h(
      "div",
      { class: "leader-outlook" },
      h(
        "div",
        {},
        h("span", { class: "stat-label" }, "Projected"),
        h("b", { class: "leader-rank" }, `#${finishLabel(ctx, t)}`),
        h(
          "div",
          { class: "leader-current" },
          t.rank === null
            ? "Unranked now"
            : `#${rankLabel(t.rank, t.tied)} now`,
          movement(t.rank, p.rank),
        ),
      ),
      probabilityRing(p.top25Probability, "Top 25"),
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
    count = h("span", { class: "count", "aria-live": "polite" }),
    leaders = h("section", { class: "leaders-section" }),
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
          : (a.projection?.rank ?? Infinity) -
              (b.projection?.rank ?? Infinity) || a.id - b.id,
      );
    const frontRunners = teams
      .filter((t) => t.projection)
      .sort((a, b) => a.projection!.rank - b.projection!.rank || a.id - b.id)
      .slice(0, 3);
    leaders.hidden = !!query || !frontRunners.length;
    leaders.replaceChildren(
      h(
        "div",
        { class: "section-heading" },
        h("h2", {}, "Projected leaders"),
        h(
          "span",
          { class: "scope-label" },
          `${ctx.ranking.projection.remainingGames} games left`,
        ),
      ),
      h(
        "div",
        { class: "leader-grid" },
        ...frontRunners.map((t) => leaderCard(ctx, t)),
      ),
    );
    body.replaceChildren(
      ...teams.map((t) => {
        const p = t.projection;
        return h(
          "a",
          {
            class: "projection-row",
            href: teamHref(ctx, t.id),
            title: t.school,
            "aria-label": `${t.school}. Current rank ${rankLabel(t.rank, t.tied)}. Projected rank ${finishLabel(ctx, t)}.${p ? ` 80% finish range ${p.rankLow} to ${p.rankHigh}. Top 25 chance ${(100 * p.top25Probability).toFixed(1)}%.` : ""}`,
          },
          h("b", { class: "current-position" }, rankLabel(t.rank, t.tied)),
          h(
            "div",
            { class: "row-identity" },
            logo(ctx.teams.get(t.id), 36, { lazy: true }),
            h(
              "div",
              { class: "forecast-team" },
              h(
                "b",
                {},
                h("span", { class: "school-label" }, t.school),
                t.provisional ? provisionalFlag() : "",
              ),
              h(
                "div",
                { class: "team-meta" },
                h("span", { class: "record-mini" }, record(t)),
                h("span", {}, shortConf(t.conference)),
              ),
            ),
          ),
          h("span", { class: "forecast-rating" }, fmtHeight(t.height, 3)),
          h(
            "div",
            { class: "forecast-cell" },
            h(
              "div",
              { class: "forecast-number" },
              h(
                "b",
                { class: "forecast-finish" },
                p ? `#${finishLabel(ctx, t)}` : "—",
              ),
              movement(t.rank, p?.rank ?? null),
            ),
            p
              ? h(
                  "div",
                  { class: "row-range" },
                  rankRange(t.rank, p, ctx.ranking.projection.teams),
                  h(
                    "span",
                    {
                      class: "range-caption",
                      title: "80% simulated finish range",
                    },
                    `#${p.rankLow}–#${p.rankHigh}`,
                  ),
                )
              : "",
          ),
          p ? chanceMeter(p.top25Probability) : h("span", {}, "—"),
        );
      }),
    );
    if (!teams.length)
      body.append(h("div", { class: "empty" }, "No teams found."));
    count.textContent = `${teams.length} teams`;
    sortButtons.replaceChildren(
      ...(
        [
          ["Current", "Current standing", "current"],
          ["Projected", "Projected finish", "projected"],
        ] as const
      ).map(([label, accessible, value]) =>
        h(
          "button",
          {
            type: "button",
            class: sort === value ? "on" : "",
            "aria-label": accessible,
            "aria-pressed": String(sort === value),
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
    { class: "standings-page" },
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
        h("h1", {}, "Current vs projected"),
      ),
      h(
        "a",
        {
          class: "scope-pill",
          href: href(ctx.entry.season, ctx.snapId, "about"),
        },
        h("span", { class: "status-dot" }),
        "Known schedule",
      ),
    ),
    leaders,
    h(
      "div",
      { class: "toolbar forecast-tools standings-tools" },
      sortButtons,
      h(
        "label",
        { class: "search" },
        searchIcon(),
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
      { class: "board-key" },
      h("span", {}, h("i", { class: "key-range" }), "80% range"),
      h("span", {}, provisionalFlag(), "Limited data"),
      h("span", {}, "FBS + FCS"),
      h("a", { href: href(ctx.entry.season, ctx.snapId, "about") }, "Method"),
    ),
    h(
      "section",
      {
        class: "panel projection-board",
        "aria-label": "Current and projected standings",
      },
      h(
        "div",
        { class: "projection-row forecast-head", "aria-hidden": "true" },
        h("span", {}, "Current"),
        h("span", {}, "Team"),
        h("span", { class: "forecast-rating" }, "Rating"),
        h("span", {}, "Projected"),
        h("span", {}, "Top 25"),
      ),
      body,
    ),
  );
  draw();
  return root;
}
