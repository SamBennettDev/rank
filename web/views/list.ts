import {
  type Ctx,
  fmtTeamScore,
  scoreLabel,
  href,
  rankLabel,
  record,
  teamHref,
} from "../ctx";
import type { RankedTeam } from "../../src/engine/types";
import { h } from "../dom";
import { searchIcon } from "../icons";
import { logo, shortConf, teamVars } from "../team";
import { provisionalFlag } from "../visuals";

function leaderCard(ctx: Ctx, t: RankedTeam, index: number, total: number) {
  return h(
    "a",
    {
      class: "leader-card tv",
      href: teamHref(ctx, t.id),
      style: teamVars(ctx.teams.get(t.id)?.color),
      "aria-roledescription": "slide",
      "aria-label": `${index + 1} of ${total}. ${t.school}. Rank ${rankLabel(t.rank, t.tied)}. Score ${fmtTeamScore(ctx, t)}.`,
    },
    h(
      "div",
      { class: "leader-identity" },
      logo(ctx.teams.get(t.id), 44),
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
      { class: "leader-standing" },
      h("b", { class: "leader-rank" }, `#${rankLabel(t.rank, t.tied)}`),
      h(
        "div",
        { class: "leader-score" },
        h("span", { class: "stat-label" }, scoreLabel(ctx)),
        h("b", {}, fmtTeamScore(ctx, t)),
      ),
    ),
  );
}

function leadersCarousel(ctx: Ctx, onCleanup: (fn: () => void) => void) {
  const top = ctx.ranked.slice(0, 10);
  if (!top.length) return "";
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const previous = h(
    "button",
    {
      type: "button",
      class: "carousel-step",
      disabled: true,
      "aria-label": "Previous top teams",
      "aria-controls": "top-teams-track",
      onclick: () => step(-1),
    },
    "‹",
  );
  const next = h(
    "button",
    {
      type: "button",
      class: "carousel-step",
      "aria-label": "Next top teams",
      "aria-controls": "top-teams-track",
      onclick: () => step(1),
    },
    "›",
  );
  const progress = h("i");
  const update = () => {
    const max = track.scrollWidth - track.clientWidth;
    previous.disabled = track.scrollLeft <= 1;
    next.disabled = track.scrollLeft >= max - 1;
    const visible = Math.min(1, track.clientWidth / track.scrollWidth);
    progress.style.width = `${visible * 100}%`;
    progress.style.left = `${max > 0 ? (track.scrollLeft / max) * (1 - visible) * 100 : 0}%`;
  };
  const track = h(
    "div",
    {
      id: "top-teams-track",
      class: "leader-track",
      tabindex: 0,
      "aria-label": "Top teams. Use left and right arrow keys to scroll.",
      onscroll: update,
      onkeydown: (event: KeyboardEvent) => {
        if (event.target !== track) return;
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          step(event.key === "ArrowLeft" ? -1 : 1);
        } else if (event.key === "Home" || event.key === "End") {
          event.preventDefault();
          track.scrollTo({
            left: event.key === "Home" ? 0 : track.scrollWidth,
            behavior: reducedMotion ? "instant" : "smooth",
          });
        }
      },
    },
    ...top.map((t, i) => leaderCard(ctx, t, i, top.length)),
  );
  function step(direction: number) {
    const card = track.firstElementChild as HTMLElement;
    track.scrollBy({
      left: direction * (card.getBoundingClientRect().width + 12),
      behavior: reducedMotion ? "instant" : "smooth",
    });
  }
  // The route inserts the returned element synchronously before this frame.
  const frame = requestAnimationFrame(update);
  const observer = new ResizeObserver(update);
  observer.observe(track);
  onCleanup(() => {
    cancelAnimationFrame(frame);
    observer.disconnect();
  });
  return h(
    "section",
    {
      class: "leaders-section",
      role: "region",
      "aria-roledescription": "carousel",
      "aria-label": "Top teams",
    },
    h(
      "div",
      { class: "section-heading" },
      h("h2", {}, "Top teams"),
      h(
        "div",
        { class: "carousel-controls" },
        h("span", { class: "scope-label" }, `Top ${top.length}`),
        previous,
        next,
      ),
    ),
    track,
    h("div", { class: "carousel-progress", "aria-hidden": "true" }, progress),
  );
}

export function listView(ctx: Ctx, onCleanup: (fn: () => void) => void) {
  let query = "",
    division = "all",
    conference = "";
  const field = ctx.ranking.teams;
  const body = h("div"),
    count = h("span", { class: "count", "aria-live": "polite" });
  const draw = () => {
    const teams = field.filter(
      (t) =>
        (division === "all" || t.classification === division) &&
        (!conference || t.conference === conference) &&
        (!query ||
          t.school.toLowerCase().includes(query) ||
          t.abbreviation.toLowerCase() === query),
    );
    body.replaceChildren(
      ...teams.map((t) =>
        h(
          "a",
          {
            class: "standing-row",
            href: teamHref(ctx, t.id),
            title: t.school,
            "aria-label": `${t.school}. Rank ${rankLabel(t.rank, t.tied)}. Current score ${fmtTeamScore(ctx, t)}.`,
          },
          h(
            "b",
            { class: `current-position${t.tied ? " tied" : ""}` },
            rankLabel(t.rank, t.tied),
          ),
          h(
            "div",
            { class: "row-identity" },
            logo(ctx.teams.get(t.id), 36, { lazy: true }),
            h(
              "div",
              { class: "standing-team" },
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
          h("b", { class: "standing-score" }, fmtTeamScore(ctx, t)),
        ),
      ),
    );
    if (!teams.length)
      body.append(h("div", { class: "empty" }, "No teams found."));
    count.textContent = `${teams.length} teams`;
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
        h("h1", {}, "Rankings"),
        ctx.ranking.manifest.springs
          ? h(
              "p",
              { class: "hint" },
              `Game graph · ${ctx.ranking.manifest.springs.restGap}-point springs${ctx.ranking.manifest.springs.pullPolicy ? " with strong-win support" : ` · ${ctx.ranking.manifest.springs.direction}`}. Equal heights share a rank.`,
            )
          : ctx.ranking.manifest.neural
            ? h(
                "p",
                { class: "hint" },
                "Neural predictions · ordered by who is more likely to beat whom on a neutral field",
              )
            : "",
      ),
    ),
    leadersCarousel(ctx, onCleanup),
    h(
      "div",
      { class: "toolbar current-tools" },
      h(
        "label",
        { class: "search" },
        searchIcon(),
        h("input", {
          type: "search",
          placeholder: "Find a team",
          "aria-label": "Filter standings",
          oninput: (event: Event) => {
            query = (event.target as HTMLInputElement).value
              .trim()
              .toLowerCase();
            draw();
          },
        }),
        count,
      ),
      h(
        "select",
        {
          "aria-label": "Standings division",
          onchange: (event: Event) => {
            division = (event.target as HTMLSelectElement).value;
            draw();
          },
        },
        h("option", { value: "all" }, "All teams"),
        h("option", { value: "fbs" }, "FBS"),
        h("option", { value: "fcs" }, "FCS"),
      ),
      h(
        "select",
        {
          "aria-label": "Standings conference",
          onchange: (event: Event) => {
            conference = (event.target as HTMLSelectElement).value;
            draw();
          },
        },
        h("option", { value: "" }, "All conferences"),
        ...[...new Set(field.map((t) => t.conference))]
          .sort()
          .map((c) => h("option", { value: c }, c)),
      ),
    ),
    h(
      "div",
      { class: "board-key" },
      h("span", {}, provisionalFlag(), "Limited data"),
      h("a", { href: href(ctx.entry.season, ctx.snapId, "about") }, "Scoring"),
    ),
    h(
      "section",
      { class: "panel standings-board", "aria-label": "Current standings" },
      h(
        "div",
        { class: "standing-row standing-head", "aria-hidden": "true" },
        h("span", {}, "Rank"),
        h("span", {}, "Team"),
        h("span", {}, scoreLabel(ctx)),
      ),
      body,
    ),
  );
  draw();
  return root;
}
