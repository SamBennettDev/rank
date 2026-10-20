import { type Ctx, fmtHeight, rankLabel, record, teamHref } from "../ctx";
import type { RankedTeam } from "../../src/engine/types";
import { h } from "../dom";
import { searchIcon } from "../icons";
import { logo, shortConf } from "../team";
import { provisionalFlag } from "../visuals";

type Board = "quality" | "resume" | "schedule";
type Division = "all" | "fbs" | "fcs";

const BOARDS: [Board, string][] = [
  ["quality", "Quality"],
  ["resume", "Résumé"],
  ["schedule", "Schedule"],
];
const DIVISIONS: [Division, string][] = [
  ["all", "All"],
  ["fbs", "FBS"],
  ["fcs", "FCS"],
];

const fmt2 = (v: number | null) => (v === null ? "—" : v.toFixed(2));
const place = (t: RankedTeam, b: Board) =>
  b === "resume" ? t.resumeRank : b === "schedule" ? t.scheduleRank : t.rank;
const placeLabel = (t: RankedTeam, b: Board) =>
  b === "quality"
    ? rankLabel(t.rank, t.tied)
    : place(t, b) === null
      ? "—"
      : String(place(t, b));
const value = (t: RankedTeam, b: Board) =>
  b === "resume"
    ? fmtHeight(t.resume, 2)
    : fmt2(b === "schedule" ? t.schedule : t.height);

const change = (t: RankedTeam, b: Board) =>
  b === "resume"
    ? t.resumeChange
    : b === "schedule"
      ? t.scheduleChange
      : t.change;

function moveCell(t: RankedTeam, b: Board) {
  const c = change(t, b);
  if (!c) return h("span", { class: "hr-move" }, c === 0 ? "–" : "");
  return h(
    "span",
    {
      class: `hr-move ${c > 0 ? "up" : "down"}`,
      "aria-label": `${c > 0 ? "Up" : "Down"} ${Math.abs(c)}`,
    },
    `${c > 0 ? "▲" : "▼"}${Math.abs(c)}`,
  );
}

function segment<T extends string>(
  label: string,
  options: [T, string][],
  current: () => T,
  pick: (v: T) => void,
  className = "",
) {
  const group = h("div", {
    class: `home-seg ${className}`.trim(),
    role: "group",
    "aria-label": label,
  });
  const paint = () => {
    for (const b of group.children) {
      const on = (b as HTMLElement).dataset.value === current();
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
    }
  };
  group.append(
    ...options.map(([v, text]) =>
      h(
        "button",
        {
          type: "button",
          "data-value": v,
          onclick: () => {
            pick(v);
            paint();
          },
        },
        text,
      ),
    ),
  );
  paint();
  return group;
}

/** Conferences ordered by the average quality of their ranked teams, strongest first. */
function conferencesByStrength(teams: RankedTeam[]) {
  const sums = new Map<string, { total: number; n: number }>();
  for (const t of teams) {
    if (t.height === null) continue;
    const s = sums.get(t.conference) ?? { total: 0, n: 0 };
    s.total += t.height;
    s.n++;
    sums.set(t.conference, s);
  }
  return [...sums]
    .map(([name, s]) => ({ name, avg: s.total / s.n }))
    .sort((a, b) => b.avg - a.avg || a.name.localeCompare(b.name));
}

export function listView(ctx: Ctx, _onCleanup: (fn: () => void) => void) {
  let query = "",
    board: Board = "quality",
    division: Division = "all",
    conference = "";
  const field = ctx.ranking.teams;
  const body = h("div", { class: "home-rows" });
  const root = h("div", { class: "home", "data-board": board });

  const row = (t: RankedTeam) =>
    h(
      "a",
      {
        class: "hrow",
        href: teamHref(ctx, t.id),
        "aria-label": `${placeLabel(t, board)}. ${t.school}, ${record(t)}, ${value(t, board)}`,
      },
      h("b", { class: "hr-rank" }, placeLabel(t, board)),
      logo(ctx.teams.get(t.id), 32, { lazy: true }),
      h(
        "span",
        { class: "hr-name" },
        h("b", {}, t.school),
        t.provisional ? provisionalFlag() : "",
        h("span", { class: "hr-rec" }, record(t)),
      ),
      h("span", { class: "hr-conf" }, shortConf(t.conference)),
      h(
        "span",
        { class: `hr-col${board === "quality" ? " on" : ""}` },
        fmt2(t.height),
        h("small", {}, rankLabel(t.rank, t.tied)),
      ),
      h(
        "span",
        { class: `hr-col${board === "resume" ? " on" : ""}` },
        fmtHeight(t.resume, 2),
        h("small", {}, t.resumeRank ?? "—"),
      ),
      h(
        "span",
        { class: `hr-col${board === "schedule" ? " on" : ""}` },
        fmt2(t.schedule),
        h("small", {}, t.scheduleRank ?? "—"),
      ),
      h("span", { class: "hr-val" }, value(t, board)),
      moveCell(t, board),
    );

  const draw = () => {
    root.dataset.board = board;
    const teams = field
      .filter(
        (t) =>
          (division === "all" || t.classification === division) &&
          (!conference || t.conference === conference) &&
          (!query ||
            t.school.toLowerCase().includes(query) ||
            t.abbreviation.toLowerCase() === query),
      )
      .sort(
        (a, b) =>
          (place(a, board) ?? Infinity) - (place(b, board) ?? Infinity) ||
          (a.rank ?? Infinity) - (b.rank ?? Infinity) ||
          a.id - b.id,
      );
    body.replaceChildren(...teams.map(row));
    if (!teams.length)
      body.append(
        h(
          "div",
          { class: "home-empty", role: "status" },
          searchIcon(),
          "No teams",
        ),
      );
  };

  root.append(
    h(
      "div",
      { class: "home-tools" },
      h(
        "label",
        { class: "home-search" },
        searchIcon(),
        h("input", {
          type: "search",
          placeholder: "Search",
          "aria-label": "Search teams",
          oninput: (event: Event) => {
            query = (event.target as HTMLInputElement).value
              .trim()
              .toLowerCase();
            draw();
          },
        }),
      ),
      h(
        "label",
        { class: "sel home-conf" },
        h(
          "select",
          {
            "aria-label": "Conference, strongest first",
            onchange: (event: Event) => {
              conference = (event.target as HTMLSelectElement).value;
              draw();
            },
          },
          h("option", { value: "" }, "All conferences"),
          ...conferencesByStrength(field).map((c) =>
            h("option", { value: c.name }, `${c.name} · ${c.avg.toFixed(2)}`),
          ),
        ),
      ),
      segment(
        "Division",
        DIVISIONS,
        () => division,
        (v) => {
          division = v;
          draw();
        },
        "division",
      ),
      segment(
        "Ranking board",
        BOARDS,
        () => board,
        (v) => {
          board = v;
          draw();
        },
        "boards",
      ),
    ),
    h(
      "div",
      { class: "home-scroll", tabindex: "0", "aria-label": "Teams" },
      h(
        "div",
        { class: "hrow hhead", "aria-hidden": "true" },
        h("span", {}, "#"),
        h("span", {}),
        h("span", {}, "Team"),
        h("span", { class: "hr-conf" }, "Conf"),
        h("span", { class: "hr-col" }, "Quality"),
        h("span", { class: "hr-col" }, "Résumé"),
        h("span", { class: "hr-col" }, "Schedule"),
        h("span", { class: "hr-val" }),
        h("span", { class: "hr-move" }, "Move"),
      ),
      body,
    ),
  );
  draw();
  return root;
}
