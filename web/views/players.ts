import { type Ctx, boardHref, playerHref, teamHref } from "../ctx";
import { h } from "../dom";
import { searchIcon } from "../icons";
import {
  GROUP_NAME,
  GROUP_ONE,
  GROUPS,
  type Group,
  isDefense,
  loadPlayers,
  type PlayersFile,
  type PlayerSummary,
  RATING_UNIT,
  STAT_COLS,
  fmtSigned,
  stat,
} from "../players";
import { logo, shortConf, teamVars } from "../team";

let remembered: { level: "all" | "fbs" | "fcs"; q: string } = { level: "all", q: "" };

export function playersView(ctx: Ctx, groupParam?: string): HTMLElement {
  const group: Group = GROUPS.includes(groupParam as Group) ? (groupParam as Group) : "QB";
  const body = h("div", { class: "loading pad" }, h("span"), h("span"), h("span"));
  const root = h(
    "div",
    { class: "pboard" },
    h(
      "header",
      { class: "page-head" },
      h("div", { class: "eyebrow" }, "Players · FBS + FCS"),
      h("h1", {}, GROUP_NAME[group]),
      h(
        "p",
        { class: "lede" },
        `Every ${GROUP_ONE[group]} in Division I on one scale. ${
          isDefense(group)
            ? "Each game's sacks, interceptions, pass breakups and tackles are credited at the expected points they save, then weighted by how good the opponent was."
            : group === "K"
              ? "Every field goal is judged against our model's chance of making a kick from that distance."
              : "Every play is judged against what an average player gains against that same defense, so production against weak defenses counts for less."
        }`,
      ),
      h(
        "nav",
        { class: "gtabs", "aria-label": "Position" },
        ...GROUPS.map((g) =>
          h("a", { href: boardHref(ctx, g), class: g === group ? "on" : "", "aria-current": g === group ? "page" : false }, g),
        ),
      ),
    ),
    body,
  );
  void loadPlayers(ctx.entry.season)
    .then((file) => body.replaceWith(board(ctx, file, group)))
    .catch((e: unknown) =>
      body.replaceWith(h("div", { class: "empty" }, h("h2", {}, "Player ratings unavailable"), h("p", { class: "muted" }, String(e)))),
    );
  return root;
}

function board(ctx: Ctx, file: PlayersFile, group: Group): HTMLElement {
  const cols = file.groupStats[group];
  const statCols = STAT_COLS[group];
  const list = file.boards[group];
  const top = list[0];
  const maxValue = Math.max(0.01, ...list.map((p) => Math.abs(p.valuePerGame)));

  const tbody = h("div", { class: "prows" });
  const count = h("span", { class: "muted" });
  const render = () => {
    const q = remembered.q.trim().toLowerCase();
    const rows = list.filter((p) => {
      const t = ctx.teams.get(p.teamId);
      if (remembered.level !== "all" && t?.classification !== remembered.level) return false;
      return !q || p.name.toLowerCase().includes(q) || (t?.school ?? "").toLowerCase().includes(q);
    });
    count.textContent = `${rows.length} of the top ${list.length} · ${file.counts[group].toLocaleString()} rated`;
    tbody.replaceChildren(...rows.map((p) => row(ctx, p, cols, statCols, maxValue)));
    if (!rows.length) tbody.append(h("p", { class: "hint pad" }, "No players match."));
  };
  const levelSeg = h(
    "div",
    { class: "seg", role: "group", "aria-label": "Division" },
    ...(["all", "fbs", "fcs"] as const).map((lv) =>
      h(
        "button",
        {
          class: remembered.level === lv ? "on" : "",
          onclick: (e: Event) => {
            remembered.level = lv;
            for (const b of levelSeg.children) b.classList.toggle("on", b === e.currentTarget);
            render();
          },
        },
        lv === "all" ? "All" : lv.toUpperCase(),
      ),
    ),
  );
  const search = h("input", {
    type: "search",
    placeholder: "Search players or teams",
    value: remembered.q,
    oninput: (e: Event) => {
      remembered.q = (e.target as HTMLInputElement).value;
      render();
    },
  });
  render();

  const head = h(
    "div",
    { class: `phead g-${group}` },
    h("div", { class: "c-rank" }, "#"),
    h("div", {}, "Player"),
    h("div", { class: "c-stats" }, ...statCols.map((c) => h("span", { title: c.title }, c.label))),
    h("div", { class: "r", title: `Rating: expected points over an average ${GROUP_ONE[group]}, ${RATING_UNIT[group]}, after the pull toward average` }, "Rating"),
    h("div", { class: "r", title: "Points added per game: rating × plays ÷ games. The board is ranked by this." }, "Pts / game"),
  );

  return h(
    "div",
    {},
    top ? leader(ctx, top, cols, group) : "",
    h(
      "div",
      { class: "ptools" },
      h("label", { class: "search" }, searchIcon(), search),
      levelSeg,
      count,
    ),
    h("section", { class: "ladder pladder" }, head, tbody),
    h(
      "p",
      { class: "hint foot-note" },
      isDefense(group)
        ? `Credits: sack ${file.settings.credit.sack}, interception ${file.settings.credit.interception}, pass breakup ${file.settings.credit.breakup} expected points, from the play-by-play; each game × (0.5 + opponent quality ÷ 100); divided by games + ${file.settings.shrink[group]}. Tackles are shown where box scores exist but not counted.`
        : group === "K"
          ? `Field-goal points over expected per try, with ${file.settings.shrink.K} average tries added. Ranked by points added per game.`
          : `Expected points added over an average player against the same defenses, divided by plays + ${file.settings.shrink[group]} (the pull toward average). Garbage time is left out.`,
    ),
  );
}

function leader(ctx: Ctx, p: PlayerSummary, cols: string[], group: Group): HTMLElement {
  const t = ctx.teams.get(p.teamId);
  const s = (n: string) => stat(cols, p.totals, n);
  return h(
    "a",
    { class: "pleader tv", href: playerHref(ctx, p.teamId, p.id), style: teamVars(t?.color) },
    logo(t, 260, { className: "wm" }),
    h("div", { class: "pl-rank" }, h("small", {}, `No. 1 ${group}`), h("b", {}, "1")),
    h(
      "div",
      { class: "pl-id" },
      h("div", { class: "pl-name" }, p.name),
      h("div", { class: "pl-meta" }, [p.position, p.year, t?.school].filter(Boolean).join(" · ")),
      h(
        "div",
        { class: "pl-line" },
        ...STAT_COLS[group].slice(0, 5).map((c) => h("span", {}, h("b", {}, c.value(s)), c.label)),
      ),
    ),
    h("div", { class: "pl-value" }, h("b", {}, fmtSigned(p.valuePerGame)), h("small", {}, "points added per game")),
  );
}

function row(ctx: Ctx, p: PlayerSummary, cols: string[], statCols: (typeof STAT_COLS)[Group], maxValue: number): HTMLElement {
  const t = ctx.teams.get(p.teamId);
  const s = (n: string) => stat(cols, p.totals, n);
  const w = (Math.abs(p.valuePerGame) / maxValue) * 100;
  return h(
    "a",
    { class: `prow g-${p.group}`, href: playerHref(ctx, p.teamId, p.id) },
    h("div", { class: "c-rank" }, String(p.rank)),
    h(
      "div",
      { class: "c-player" },
      logo(t, 30, { lazy: true }),
      h(
        "div",
        {},
        h("div", { class: "nm" }, p.name),
        h(
          "div",
          { class: "sub" },
          h("span", { class: "tlink", "data-href": teamHref(ctx, p.teamId) }, t?.school ?? ""),
          ` · ${[p.position, p.year].filter(Boolean).join(" ")} · ${t ? `${t.classification.toUpperCase()}${t.conference ? ` ${shortConf(t.conference)}` : ""}` : ""}`,
        ),
      ),
    ),
    h("div", { class: "c-stats" }, ...statCols.map((c) => h("span", { title: c.title }, c.value(s)))),
    h("div", { class: "r c-rating" }, fmtSigned(p.rating, 3)),
    h(
      "div",
      { class: "r c-value" },
      h("b", {}, fmtSigned(p.valuePerGame)),
      h("i", { class: `vbar ${p.valuePerGame < 0 ? "neg" : ""}`, style: `width:${w.toFixed(1)}%` }),
    ),
  );
}
