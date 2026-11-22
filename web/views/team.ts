import type { Edge, Ranking } from "../../src/engine/types";
import {
  type Ctx,
  type GameLine,
  METRIC_HINT,
  METRIC_LABEL,
  board,
  breakdown,
  fmtHeight,
  fmtScore,
  href,
  rankLabel,
  record,
  seasonLabel,
  teamHref,
} from "../ctx";
import { h, svg } from "../dom";
import { arrowLeft } from "../icons";
import { logo, shortConf, svgLogo, teamVars } from "../team";
import { loadRanking } from "../store";
import { matchupCard } from "./matchups";
import { marginGap, strengthOfRecord } from "../../src/engine/springs";
import type { RankedTeam } from "../../src/engine/types";
import {
  GROUPS,
  GROUP_NAME,
  STAT_COLS,
  loadTeamPlayers,
  type TeamPlayersFile,
  fmtSigned,
  stat,
} from "../players";
import { boardHref, dataThrough, playerHref } from "../ctx";

export function teamView(ctx: Ctx, teamId: number): HTMLElement {
  const team = ctx.byId.get(teamId);
  const tl = ctx.teams.get(teamId);
  if (!team || !ctx.ranking.teams.some((t) => t.id === team.id))
    return h(
      "div",
      { class: "empty" },
      h("h2", {}, "Team not found"),
      h(
        "a",
        { class: "btn", href: href(ctx.entry.season, ctx.snapId, "list") },
        "Back to rankings",
      ),
    );

  const games = ctx.edges
    .filter((e) => e.winner === teamId || e.loser === teamId)
    .sort(
      (a, b) =>
        (a.seasonType === b.seasonType
          ? 0
          : a.seasonType === "regular"
            ? -1
            : 1) ||
        a.week - b.week ||
        a.gameId - b.gameId,
    );

  const stat = (label: string, value: Node | string, note?: string) =>
    h("div", { class: "tstat" }, h("b", {}, value), h("span", {}, label), note ? h("small", {}, note) : "");
  const of = `of ${ctx.ranked.length}`;
  const div = team.classification.toUpperCase();
  const ofDivision = `of ${ctx.ranked.filter((t) => t.classification === team.classification).length} ${div}`;
  const hero = h(
    "section",
    { class: "thero tv", style: teamVars(tl?.color) },
    logo(tl, 520, { className: "wm" }),
    h(
      "div",
      { class: "thero-inner" },
      h(
        "a",
        { class: "back", href: href(ctx.entry.season, ctx.snapId, "list") },
        arrowLeft(),
        "All teams",
      ),
      h(
        "div",
        { class: "tid" },
        logo(tl, 96),
        h(
          "div",
          {},
          h("h1", { title: team.school }, team.school),
          h(
            "div",
            { class: "team-hero-meta" },
            `${shortConf(team.conference)} · ${team.classification.toUpperCase()} · ${seasonLabel(ctx.entry)}${((t) => (t ? ` · through ${t.short}` : ""))(dataThrough(ctx))}`,
          ),
        ),
      ),
      h(
        "div",
        { class: "tstats" },
        stat(
          "Rank",
          team.resumeRank === null ? "—" : `#${team.resumeRank}`,
          `${ofDivision} · by résumé`,
        ),
        stat("Record", record(team)),
        stat("Résumé", fmtScore(team.resume), team.resumeRank === null ? "" : `#${team.resumeRank} ${ofDivision}`),
        stat(
          "Quality",
          team.height === null ? "—" : team.height.toFixed(2),
          team.rank === null ? "" : `#${rankLabel(team.rank, team.tied)} ${of}`,
        ),
        stat(
          "Schedule",
          fmtScore(team.schedule),
          team.scheduleRank === null ? "" : `#${team.scheduleRank} ${of}`,
        ),
        stat(
          "This week",
          team.resumeChange === null
            ? "New"
            : team.resumeChange === 0
              ? "—"
              : h(
                  "span",
                  { class: team.resumeChange > 0 ? "upc" : "downc" },
                  `${team.resumeChange > 0 ? "▲" : "▼"}${Math.abs(team.resumeChange)}`,
                ),
        ),
      ),
    ),
  );

  if (team.rank === null) {
    return h(
      "div",
      {},
      hero,
      h(
        "div",
        { class: "tbody" },
        h(
          "div",
          { class: "panel" },
          h("p", { class: "hint" }, "Awaiting the first counted result."),
        ),
      ),
    );
  }

  const history = h(
    "div",
    { class: "panel tv", style: teamVars(tl?.color) },
    h(
      "div",
      { class: "section-heading" },
      h("h2", {}, "Rank by week"),
      h("span", { class: "scope-label" }, ctx.ranking.snapshot.label),
    ),
    h("div", { class: "loading" }, h("span"), h("span"), h("span")),
  );
  void loadHistory(ctx, teamId).then((pts) =>
    history.lastElementChild!.replaceWith(historyChart(pts, ctx.snapId)),
  );

  const nextGames = ctx.ranking.predictions
    .filter((p) => p.home === teamId || p.away === teamId)
    .slice(0, 2);
  return h(
    "div",
    {},
    hero,
    h(
      "div",
      { class: "tbody" },
      nextGames.length
        ? h(
            "section",
            { class: "next-games" },
            h("div", { class: "section-heading" }, h("h2", {}, "Up next")),
            h(
              "div",
              { class: "matchup-list" },
              ...nextGames.map((p) => matchupCard(ctx, p)),
            ),
          )
        : "",
      calcPanel(ctx, teamId),
      h("div", { class: "tgrid" }, whyPanel(ctx, teamId), history),
      unitsPanel(ctx, teamId),
      ...(ctx.entry.players ? [playersPanel(ctx, teamId)] : []),
      gameLog(ctx, teamId, games),
    ),
  );
}

// ---------------------------------------------------------------------------
// Offense, defense and special teams from play-by-play.
function unitsPanel(ctx: Ctx, teamId: number): HTMLElement | "" {
  const me = ctx.byId.get(teamId)!;
  if (me.offense === null) {
    return ctx.ranked.some((t) => t.offense !== null)
      ? h(
          "div",
          { class: "panel unitsp" },
          h("h2", {}, "Performance"),
          h("p", { class: "hint" }, "Play-by-play unavailable."),
        )
      : "";
  }
  const card = (m: "offense" | "defense" | "special") => {
    const b = board(ctx, m);
    const e = b.find((x) => x.team.id === teamId)!;
    const bound = Math.max(1, ...b.map((x) => Math.abs(x.value)));
    const width = (Math.abs(e.value) / bound) * 50;
    return h(
      "div",
      { class: "unit", title: METRIC_HINT[m] },
      h("div", { class: "k" }, METRIC_LABEL[m]),
      h(
        "div",
        { class: "rk" },
        `#${rankLabel(e.rank, e.tied)}`,
        h("small", {}, `of ${b.length}`),
      ),
      h("div", { class: "v" }, h("b", {}, fmtHeight(e.value)), " vs avg"),
      h(
        "div",
        { class: "unit-meter", "aria-hidden": "true" },
        h("i", {
          class: e.value < 0 ? "negative" : "",
          style: `left:${e.value < 0 ? 50 - width : 50}%;width:${width}%`,
        }),
      ),
    );
  };
  return h(
    "div",
    { class: "panel unitsp" },
    h("h2", {}, "Performance"),
    h(
      "p",
      { class: "hint" },
      "Opponent-adjusted play-by-play · points per game",
    ),
    h(
      "div",
      { class: "units" },
      card("offense"),
      card("defense"),
      card("special"),
    ),
  );
}

// ---------------------------------------------------------------------------
// How the height is built: one spring per game.
function whyPanel(ctx: Ctx, teamId: number): HTMLElement {
  const me = ctx.byId.get(teamId)!;
  const b = breakdown(ctx, teamId);
  const order = (l: GameLine) =>
    (l.edge.seasonType === "postseason" ? 99 : l.edge.week) * 1e9 +
    l.edge.gameId;
  const lines = [...b.lines].sort((x, y) => order(x) - order(y));
  const above = b.wins - b.expected;
  return h(
    "div",
    { class: "panel why" },
    h("h2", {}, `Résumé: game by game against a top-25 ${me.classification.toUpperCase()} team`),
    h(
      "div",
      { class: "spring-equation" },
      h("div", {}, h("b", {}, String(b.wins)), h("small", {}, "Wins")),
      h("span", { "aria-hidden": "true" }, "−"),
      h("div", {}, h("b", {}, b.expected.toFixed(2)), h("small", {}, `A top-25 ${me.classification.toUpperCase()} team’s expected wins`)),
      h("span", { "aria-hidden": "true" }, "="),
      h(
        "div",
        { class: "total" },
        h("b", { class: above < 0 ? "neg" : "" }, `${above >= 0 ? "+" : "−"}${Math.abs(above).toFixed(2)}`),
        h("small", {}, `Résumé ${fmtScore(me.resume)}, #${me.resumeRank ?? "—"}`),
      ),
    ),
    breakdownChart(ctx, lines),
    h(
      "details",
      { class: "quiet-details" },
      h("summary", {}, "How résumé, quality and schedule work"),
      h(
        "p",
        {},
        `Résumé is the ranking. It asks how hard this record would be for a good team against the same schedule. Each bar is one game: a typical top-25 team’s chance of winning it, from the opponent’s strength, set against what this team did. A win over a strong opponent counts for a lot, a win over a weak one for little, and a loss to a strong team costs little. Quality measures team strength from margins: every game is a spring that wants the winner 100 × margin^0.75 points above the loser. Schedule is the average quality of the opponents played${me.schedule === null ? "" : ` (${me.schedule.toFixed(2)} here, #${me.scheduleRank ?? "—"})`}.`,
      ),
    ),
  );
}

/** Each game's result against a top-25 team: +(1 − chance) for a win, −chance for a loss. */
function breakdownChart(ctx: Ctx, lines: GameLine[]): SVGSVGElement {
  const W = 560;
  const row = 30;
  const pad = { l: 178, r: 24, t: 24, b: 28 };
  const H = pad.t + row * lines.length + pad.b;
  const x = (v: number) => pad.l + ((v + 1) / 2) * (W - pad.l - pad.r);
  const root = svg("svg", {
    viewBox: `0 0 ${W} ${H}`,
    role: "img",
    "aria-label": "Each game against a top-25 team: a win gains 1 minus that team's chance of winning it, a loss costs its chance",
  });
  for (const v of [-1, -0.5, 0, 0.5, 1]) {
    root.appendChild(svg("line", { class: v === 0 ? "rline" : "tl", x1: x(v), x2: x(v), y1: pad.t - 6, y2: H - pad.b }));
    const tk = svg("text", { class: "tk", x: x(v), y: 12, "text-anchor": "middle" });
    tk.textContent = v === 0 ? "0" : `${v > 0 ? "+" : "−"}${Math.abs(v)}`;
    root.appendChild(tk);
  }
  lines.forEach((l, i) => {
    const y = pad.t + row * i + row / 2;
    const o = l.opponent;
    const score = `${l.won ? "W" : "L"} ${l.won ? l.edge.winnerPoints : l.edge.loserPoints}–${l.won ? l.edge.loserPoints : l.edge.winnerPoints}`;
    const lab = svg("text", { class: "rl", x: 40, y: y + 4 });
    lab.textContent = `${l.where === -1 ? "at" : "vs"} ${o.abbreviation || o.school} · ${score}`;
    root.appendChild(lab);
    const g = svg("g", { class: `brow ${l.value >= 0 ? "up" : "down"}` });
    g.appendChild(svg("line", { class: "stem", x1: x(0), x2: x(l.value), y1: y, y2: y, style: "stroke-width:4px" }));
    g.appendChild(svg("circle", { class: "pt", cx: x(l.value), cy: y, r: 4 }));
    const tt = svg("title", {});
    tt.textContent = `A top-25 team beats ${o.school} ${(100 * l.chance).toFixed(0)}% of the time. ${l.won ? "Won" : "Lost"}: ${l.value >= 0 ? "+" : "−"}${Math.abs(l.value).toFixed(2)}`;
    g.appendChild(tt);
    root.appendChild(g);
    root.appendChild(badge(ctx, o.id, 18, y, 22));
  });
  const foot = svg("text", { class: "rlab", x: x(0), y: H - 6, "text-anchor": "middle" });
  foot.textContent = "← loss costs · win gains →";
  root.appendChild(foot);
  return root;
}

function badge(
  ctx: Ctx,
  id: number,
  x: number,
  y: number,
  size: number,
): SVGGElement {
  const t = ctx.teams.get(id);
  const g = svg("g", { class: "badge", style: teamVars(t?.color) });
  const mono = svg("g", { class: "bmono", style: "display:none" });
  mono.appendChild(
    svg("circle", { cx: x, cy: y, r: size / 2, fill: "var(--tc)" }),
  );
  const txt = svg("text", {
    x,
    y,
    "text-anchor": "middle",
    "dominant-baseline": "central",
    fill: "var(--tc-ink)",
    style: `font:800 ${Math.round(size * 0.32)}px var(--display)`,
  });
  txt.textContent = (t?.abbreviation ?? "?").slice(0, 4);
  mono.appendChild(txt);
  const img = svg("image", {
    x: x - size / 2,
    y: y - size / 2,
    width: size,
    height: size,
  });
  g.append(mono, img);
  svgLogo(img, id, Math.ceil(size * 2.5), () => mono.setAttribute("style", ""));
  return g;
}

// ---------------------------------------------------------------------------
// Rank history across the season's snapshots, up to the one being viewed.
async function loadHistory(
  ctx: Ctx,
  teamId: number,
): Promise<{ id: string; label: string; rank: number | null }[]> {
  const upto = ctx.entry.snapshots.findIndex((s) => s.id === ctx.snapId);
  const snaps = ctx.entry.snapshots.slice(0, upto + 1);
  const rankings: Ranking[] = await Promise.all(
    snaps.map((s) => loadRanking(ctx.entry.season, s.id)),
  );
  return snaps.map((s, i) => ({
    id: s.id,
    label: s.label.replace("Week ", "W").replace("Postseason", "Post"),
    rank: rankings[i]!.teams.find((t) => t.id === teamId)?.resumeRank ?? null,
  }));
}

function historyChart(
  pts: { id: string; label: string; rank: number | null }[],
  current: string,
): SVGSVGElement {
  const W = 480;
  const H = 300;
  const pad = { l: 40, r: 20, t: 26, b: 30 };
  const ranks = pts.map((p) => p.rank).filter((r): r is number => r !== null);
  const best = Math.max(1, Math.min(...ranks) - 5);
  const worst = Math.max(...ranks) + 5;
  const x = (i: number) =>
    pad.l +
    (pts.length === 1
      ? (W - pad.l - pad.r) / 2
      : (i / (pts.length - 1)) * (W - pad.l - pad.r));
  const y = (r: number) =>
    pad.t + ((r - best) / Math.max(1, worst - best)) * (H - pad.t - pad.b);
  const root = svg("svg", {
    class: "hist",
    viewBox: `0 0 ${W} ${H}`,
    role: "img",
    "aria-label": "Rank by week",
  });
  const defs = svg("defs");
  defs.innerHTML = `<linearGradient id="histfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--ta);stop-opacity:.3"/><stop offset="1" style="stop-color:var(--ta);stop-opacity:0"/></linearGradient>`;
  root.appendChild(defs);
  const nice: number[] = [];
  for (const r of [1, 5, 10, 25, 50, 75, 100, 150, 200, 250]) {
    if (
      r >= best &&
      r <= worst &&
      (nice.length === 0 || y(r) - y(nice.at(-1)!) >= 22)
    )
      nice.push(r);
  }
  for (const r of nice) {
    root.appendChild(
      svg("line", {
        class: "grid",
        x1: pad.l,
        x2: W - pad.r,
        y1: y(r),
        y2: y(r),
      }),
    );
    const t = svg("text", {
      class: "gl",
      x: pad.l - 8,
      y: y(r) + 4,
      "text-anchor": "end",
    });
    t.textContent = `#${r}`;
    root.appendChild(t);
  }
  pts.forEach((p, i) => {
    const t = svg("text", {
      class: "gl",
      x: x(i),
      y: H - 8,
      "text-anchor": "middle",
    });
    t.textContent = p.label;
    if (p.id === current) t.setAttribute("style", "fill:var(--text)");
    root.appendChild(t);
  });
  const valid = pts.map((p, i) => ({ ...p, i })).filter((p) => p.rank !== null);
  if (valid.length > 1) {
    const d = valid
      .map((p, k) => `${k ? "L" : "M"}${x(p.i)},${y(p.rank!)}`)
      .join(" ");
    root.appendChild(
      svg("path", {
        class: "area",
        d: `${d} L${x(valid.at(-1)!.i)},${H - pad.b} L${x(valid[0]!.i)},${H - pad.b} Z`,
      }),
    );
    root.appendChild(svg("path", { class: "line", d }));
  }
  for (const p of valid) {
    root.appendChild(
      svg("circle", { class: "pt", cx: x(p.i), cy: y(p.rank!), r: 5 }),
    );
    const t = svg("text", { class: "pv", x: x(p.i), y: y(p.rank!) - 11 });
    t.textContent = String(p.rank);
    root.appendChild(t);
  }
  return root;
}

// ---------------------------------------------------------------------------
function gameLog(ctx: Ctx, teamId: number, games: Edge[]): HTMLElement {
  const me = ctx.byId.get(teamId)!;
  const byGame = new Map(
    breakdown(ctx, teamId).lines.map((l) => [l.edge.gameId, l]),
  );
  const rows = games.map((e) => {
    const l = byGame.get(e.gameId)!;
    const o = l.opponent;
    const upset =
      o.height !== null &&
      ((l.won && me.height! < o.height) || (!l.won && o.height < me.height!));
    const published = ctx.ranking.teams.some((t) => t.id === o.id);
    return h(
      published ? "a" : "div",
      {
        class: "grow2",
        ...(published ? { href: teamHref(ctx, o.id) } : {}),
      },
      h(
        "span",
        { class: "wk" },
        e.seasonType === "postseason"
          ? ctx.entry.league
            ? "Playoff"
            : "Bowl"
          : `Wk ${e.week}`,
      ),
      logo(ctx.teams.get(o.id), 34, { lazy: true }),
      h(
        "span",
        { class: "op" },
        h(
          "span",
          { class: "n" },
          `${l.where === -1 ? "at" : "vs"} ${o.school}`,
        ),
        h(
          "span",
          { class: "c" },
          `${published ? `#${rankLabel(o.rank, o.tied)}` : o.classification.toUpperCase()} · ${shortConf(o.conference)}`,
          upset ? " " : "",
          upset ? h("span", { class: "tag-up" }, "UPSET") : "",
        ),
      ),
      h(
        "span",
        { class: `pill ${l.won ? "w" : "l"}` },
        h("i", {}, l.won ? "W" : "L"),
        `${l.won ? e.winnerPoints : e.loserPoints}–${l.won ? e.loserPoints : e.winnerPoints}`,
      ),
      h(
        "span",
        {
          class: `r ${l.won ? "pos" : "neg"}`,
          title: `A typical top-25 team beats ${o.school} ${(100 * l.chance).toFixed(0)}% of the time; ${l.won ? "winning gains" : "losing costs"} ${Math.abs(l.value).toFixed(2)}.`,
        },
        `${l.value >= 0 ? "+" : "−"}${Math.abs(l.value).toFixed(2)}`,
      ),
    );
  });
  return h(
    "section",
    { class: "ladder games" },
    h(
      "div",
      { class: "lhead" },
      h("div", {}, "When"),
      h("div"),
      h("div", {}, "Opponent"),
      h("div", {}, "Result"),
      h("div", { class: "r", title: "Result against a top-25 team: a win gains 1 − its chance of winning the game, a loss costs that chance" }, "vs Top 25"),
    ),
    ...rows,
  );
}

// ---------------------------------------------------------------------------
// How the rank and quality were calculated, step by step, with this team's numbers.
function calcPanel(ctx: Ctx, teamId: number): HTMLElement {
  const me = ctx.byId.get(teamId)!;
  const sp = ctx.ranking.manifest.springs;
  const b = breakdown(ctx, teamId);
  const lines = [...b.lines].sort(
    (x, y) =>
      (x.edge.seasonType === "postseason" ? 99 : x.edge.week) - (y.edge.seasonType === "postseason" ? 99 : y.edge.week) ||
      x.edge.gameId - y.edge.gameId,
  );
  const f1 = (v: number) => (v < 0 ? "−" : "") + Math.abs(v).toFixed(1);
  const rows = lines.map((l) => {
    const margin = l.edge.winnerPoints - l.edge.loserPoints;
    const gap = marginGap(margin);
    const os = l.opponent.strength ?? 0;
    const target = l.won ? os + gap : os - gap;
    return { l, margin, gap, os, target };
  });
  const sum = rows.reduce((a, r) => a + r.target, 0);
  const strength = me.strength ?? 0;
  const ranked = ctx.ranked.length;
  const step = (n: number, title: string, ...body: (Node | string)[]) =>
    h("li", { class: "cstep" }, h("div", { class: "cstep-n" }, String(n)), h("div", { class: "cstep-b" }, h("h3", {}, title), ...body));
  const term = (v: string, label: string, cls = "") => h("span", { class: `term ${cls}` }, h("b", {}, v), h("small", {}, label));
  const op = (x: string) => h("span", { class: "eqop" }, x);
  const eq = (...parts: (Node | string)[]) => h("div", { class: "eq" }, ...parts);

  const springTable = h(
    "div",
    { class: "atable k-spring" },
    h("div", { class: "arow ahead" }, ...["When", "Opponent", "Margin", "Gap", "Opp. strength", "Says"].map((x, i) => h("span", { class: i >= 2 ? "n" : "" }, x))),
    ...rows.map((r) =>
      h(
        "div",
        { class: "arow" },
        h("span", { class: "wk" }, r.l.edge.seasonType === "postseason" ? "Bowl" : `Wk ${r.l.edge.week}`),
        h(
          "span",
          { class: "aop" },
          logo(ctx.teams.get(r.l.opponent.id), 22, { lazy: true }),
          h("span", {}, `${r.l.where === -1 ? "at" : "vs"} ${r.l.opponent.school}`),
          h("span", { class: `res ${r.l.won ? "w" : "l"}` }, `${r.l.won ? "W" : "L"} ${r.l.won ? r.l.edge.winnerPoints : r.l.edge.loserPoints}–${r.l.won ? r.l.edge.loserPoints : r.l.edge.winnerPoints}`),
        ),
        h("span", { class: "n" }, `${r.l.won ? "+" : "−"}${r.margin}`),
        h("span", { class: "n", title: `100 × ${r.margin}^0.75` }, r.gap.toFixed(1)),
        h("span", { class: "n" }, f1(r.os)),
        h("span", { class: `n says ${r.l.won ? "pos" : "neg"}` }, h("b", {}, f1(r.target)), h("small", {}, r.l.won ? "opp + gap" : "opp − gap")),
      ),
    ),
  );

  return h(
    "section",
    { class: "panel calc" },
    h("div", { class: "section-heading" }, h("h2", {}, `How ${me.school}'s rank is calculated`), h("span", { class: "scope-label" }, ctx.ranking.snapshot.label)),
    h(
      "ol",
      { class: "csteps" },
      step(
        1,
        "Every game is a spring",
        h("p", {}, "Each game wants the winner 100 × margin^0.75 points above the loser: a 1-point win is worth 100, 7 points 430, 14 points 724. Each extra point counts a little less. So each game says where this team should sit: the opponent's strength plus the gap after a win, minus it after a loss."),
        springTable,
      ),
      step(
        2,
        "Solve every spring at once",
        h("p", {}, `All ${ctx.ranking.teams.length + (ctx.ranking.opponents?.length ?? 0)} teams' springs are solved together, so each team sits at the average of what its games say, with ${sp.strengthShrink} of a game's weight pulling toward 0 (an average team). At the answer this holds exactly:`),
        eq(term(f1(sum), "sum of what the games say"), op("÷"), term(`${rows.length} + ${sp.strengthShrink}`, "games + pull"), op("="), term(f1(strength), "strength", "hl")),
        h("p", { class: "hint" }, `Strength is points above an average team. Opponents' strengths come from the same solve, so beating a team that later wins a lot keeps paying off.`),
      ),
      step(
        3,
        "Turn strength into quality",
        h("p", {}, "Quality is 100 × the chance of beating an average team:"),
        eq(term("100 × logistic", ""), op("("), term(String(sp.qualityScale), "scale"), op("×"), term(f1(strength), "strength"), op(")"), op("="), term((me.height ?? 0).toFixed(2), `quality · #${rankLabel(me.rank, me.tied)} of ${ranked}`, "hl")),
      ),
      step(
        4,
        "Score the résumé: strength of record",
        h("p", {}, `The ranking asks how hard ${me.wins}-${me.losses} would be for a good ${me.classification.toUpperCase()} team against this exact schedule. For each benchmark, every game's chance comes from the opponent's strength (as in step 3); together they give the benchmark's whole range of possible records. The score is 100 × (the chance it does worse + half the chance it does exactly as well). The résumé averages five ${me.classification.toUpperCase()} benchmarks, from a top-10 team to an average team, and ranks ${me.classification.toUpperCase()} teams against each other.`),
        sorTable(ctx, me),
        eq(
          ...(me.resumeParts ?? []).flatMap((v, k) => [...(k ? [op("+")] : []), term(v.toFixed(1), benchmarksFor(ctx, me)[k]?.label ?? "")]),
          op("÷"),
          term(String(me.resumeParts?.length ?? 5), "benchmarks"),
          op("="),
          term(fmtScore(me.resume), `résumé · #${me.resumeRank ?? "—"} of ${ctx.ranked.filter((t) => t.classification === me.classification).length} ${me.classification.toUpperCase()}`, "hl"),
        ),
        h("p", { class: "hint" }, `Game by game against a top-25 ${me.classification.toUpperCase()} team: ${b.wins} wins against ${b.expected.toFixed(2)} expected, in the chart below.`),
      ),
    ),
  );
}

/** The team's division's résumé benchmarks, labelled with the division ("Top-25 FBS team"). */
function benchmarksFor(ctx: Ctx, me: RankedTeam) {
  const div = me.classification.toUpperCase();
  return ctx.ranking.manifest.resumeBenchmarks
    .filter((b) => b.classification === me.classification)
    .map((b) => ({ ...b, label: b.label.replace(/ team$/, ` ${div} team`) }));
}

/** Each benchmark's expected wins, chance of a worse or equal record, and score for this team. */
function sorTable(ctx: Ctx, me: RankedTeam): HTMLElement {
  const m = ctx.ranking.manifest;
  const games = ctx.edges
    .filter((e) => e.winner === me.id || e.loser === me.id)
    .map((e) => ({ opponent: e.winner === me.id ? e.loser : e.winner, won: e.winner === me.id }));
  const strength = new Map([...ctx.ranking.teams, ...(ctx.ranking.opponents ?? [])].map((t) => [t.id, t.strength ?? 0]));
  const ids = [...new Set(games.map((g) => g.opponent))];
  const s = ids.map((id) => strength.get(id) ?? 0);
  const local = games.map((g) => ({ opponent: ids.indexOf(g.opponent), won: g.won }));
  return h(
    "div",
    { class: "atable k-sor" },
    h("div", { class: "arow ahead" }, ...["Benchmark", "Strength", "Expected wins", `${me.wins} wins vs expected`, "Score"].map((x, i) => h("span", { class: i ? "n" : "" }, x))),
    ...benchmarksFor(ctx, me).map((bm, k) => {
      const r = strengthOfRecord(local, bm.strength, s, m.springs.qualityScale);
      return h(
        "div",
        { class: "arow" },
        h("span", {}, bm.label),
        h("span", { class: "n" }, bm.strength.toFixed(0)),
        h("span", { class: "n" }, r.expectedWins.toFixed(2)),
        h("span", { class: "n" }, `${r.wins - r.expectedWins >= 0 ? "+" : "−"}${Math.abs(r.wins - r.expectedWins).toFixed(2)}`),
        h("span", { class: "n" }, h("b", {}, (me.resumeParts?.[k] ?? r.score).toFixed(1))),
      );
    }),
  );
}

// ---------------------------------------------------------------------------
// Pass and rush units and the team's best players, from the player files.
function playersPanel(ctx: Ctx, teamId: number): HTMLElement {
  const box = h("section", { class: "tplayers" }, h("div", { class: "loading pad" }, h("span"), h("span"), h("span")));
  void loadTeamPlayers(ctx.entry.season, teamId)
    .then((tf) => box.replaceChildren(...teamPlayers(ctx, tf)))
    .catch(() => box.replaceChildren());
  return box;
}

function teamPlayers(ctx: Ctx, tf: TeamPlayersFile): HTMLElement[] {
  const u = tf.units;
  const of = ctx.ranked.length;
  const unit = (label: string, v: number, rank: number | null, hint: string) =>
    h(
      "div",
      { class: "unit", title: hint },
      h("div", { class: "k" }, label),
      h("div", { class: "rk" }, rank === null ? "—" : `#${rank}`, h("small", {}, `of ${of}`)),
      h("div", { class: "v" }, h("b", {}, fmtSigned(v, 3)), " EPA / play vs avg"),
    );
  const units = h(
    "div",
    { class: "panel unitsp" },
    h("h2", {}, "Passing and rushing"),
    h("p", { class: "hint" }, "Opponent-adjusted expected points per play from our model · higher is better on both sides of the ball"),
    h(
      "div",
      { class: "units four" },
      unit("Pass offense", u.passOffense, u.passOffenseRank, "EPA per dropback above average, adjusted for the defenses faced"),
      unit("Rush offense", u.rushOffense, u.rushOffenseRank, "EPA per rush above average, adjusted for the defenses faced"),
      unit("Pass defense", u.passDefense, u.passDefenseRank, "EPA per dropback prevented, adjusted for the offenses faced"),
      unit("Rush defense", u.rushDefense, u.rushDefenseRank, "EPA per rush prevented, adjusted for the offenses faced"),
    ),
  );
  const best = GROUPS.map((g) => tf.players.filter((p) => p.group === g).sort((a, b) => a.rank - b.rank)[0]).filter((p) => p !== undefined);
  const leaders = h(
    "div",
    { class: "panel leaders" },
    h("div", { class: "section-heading" }, h("h2", {}, "Team leaders"), h("span", { class: "scope-label" }, "Rank among all FBS + FCS players")),
    h(
      "div",
      { class: "lcards" },
      ...best.map((p) => {
        const s = (n: string) => stat(tf.groupStats[p.group], p.totals, n);
        return h(
          "a",
          { class: "lcard", href: playerHref(ctx, p.teamId, p.id) },
          h("div", { class: "lc-top" }, h("span", { class: "lc-g" }, p.group), h("span", { class: "lc-rk" }, `#${p.rank}`)),
          h("div", { class: "lc-name" }, p.name),
          h("div", { class: "lc-meta" }, [p.position, p.year].filter(Boolean).join(" · ")),
          h("div", { class: "lc-line" }, STAT_COLS[p.group].slice(0, 3).map((c) => `${c.value(s)} ${c.label}`).join(" · ")),
          h("div", { class: "lc-val" }, h("b", {}, fmtSigned(p.valuePerGame)), " pts / game"),
        );
      }),
    ),
  );
  const roster = h(
    "details",
    { class: "panel rosterp" },
    h("summary", {}, h("span", {}, "Every rated player"), h("span", { class: "muted" }, `${tf.players.length} players`)),
    ...GROUPS.filter((g) => tf.players.some((p) => p.group === g)).map((g) =>
      h(
        "div",
        { class: "rgroup" },
        h("h3", {}, h("a", { href: boardHref(ctx, g) }, GROUP_NAME[g])),
        ...tf.players
          .filter((p) => p.group === g)
          .sort((a, b) => a.rank - b.rank)
          .map((p) =>
            h(
              "a",
              { class: "rrow", href: playerHref(ctx, p.teamId, p.id) },
              h("span", { class: "nm" }, p.name, h("small", {}, ` ${[p.position, p.year].filter(Boolean).join(" · ")}`)),
              h("span", { class: "n" }, `#${p.rank}`),
              h("span", { class: "n" }, fmtSigned(p.valuePerGame)),
            ),
          ),
      ),
    ),
  );
  return [units, leaders, roster];
}
