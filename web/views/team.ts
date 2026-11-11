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

  const stat = (label: string, value: Node | string) =>
    h("div", { class: "tstat" }, h("b", {}, value), h("span", {}, label));
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
            `${shortConf(team.conference)} · ${team.classification.toUpperCase()} · ${seasonLabel(ctx.entry)}`,
          ),
        ),
      ),
      h(
        "div",
        { class: "tstats" },
        stat(
          "Current rank",
          team.resumeRank === null ? "—" : String(team.resumeRank),
        ),
        stat("Record", record(team)),
        stat("Résumé", fmtScore(team.resume)),
        stat(
          "Quality",
          team.height === null
            ? "—"
            : `${team.height.toFixed(2)} · #${rankLabel(team.rank, team.tied)}`,
        ),
        stat(
          "Schedule",
          team.scheduleRank === null ? "—" : `#${team.scheduleRank}`,
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
      h("div", { class: "tgrid" }, whyPanel(ctx, teamId), history),
      unitsPanel(ctx, teamId),
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
  return h(
    "div",
    { class: "panel why" },
    h("h2", {}, "Résumé: where this team’s points come from"),
    h(
      "div",
      { class: "spring-equation" },
      h(
        "div",
        { class: "total" },
        h("b", {}, fmtScore(b.earned + b.lost)),
        h(
          "small",
          {},
          b.lost > 0
            ? `${fmtScore(b.earned)} from wins, ${fmtScore(b.lost)} from losses`
            : "From wins",
        ),
      ),
      h("span", { "aria-hidden": "true" }, "÷"),
      h("div", {}, h("b", {}, String(b.games)), h("small", {}, "Games")),
      h("span", { "aria-hidden": "true" }, "="),
      h(
        "div",
        {},
        h("b", {}, fmtScore(me.resume)),
        h("small", {}, `Résumé, #${me.resumeRank ?? "—"}`),
      ),
    ),
    breakdownChart(ctx, me.resume!, lines),
    h(
      "details",
      { class: "quiet-details" },
      h("summary", {}, "How résumé, quality and schedule work"),
      h(
        "p",
        {},
        `Résumé is the ranking. Quality measures team strength from margins: every game is a spring that wants the winner 100 × (1 + 1/2 + … + 1/margin) points above the loser, so the first point is worth 100, the second 50, the third 33.3, and each extra point counts less. Each spring is as strong as the result was surprising, so an upset or a win over a good team pulls hard and a good team beating a bad one barely pulls. That gives every team a strength in points, and from it a quality: 100 × its chance of beating an average team, from 0 to 100. Résumé, the ranking, averages the games: a win earns 50 plus half the beaten team’s quality and a loss earns half the winner’s, on a 0–100 scale, so beating a good team or losing to a bad one moves it most. Schedule is the average quality of the opponents played${me.schedule === null ? "" : ` (${me.schedule.toFixed(2)} here, #${me.scheduleRank ?? "—"})`}.`,
      ),
    ),
  );
}

function breakdownChart(
  ctx: Ctx,
  rating: number,
  lines: GameLine[],
): SVGSVGElement {
  const W = 560;
  const row = 30;
  const pad = { l: 178, r: 24, t: 24, b: 28 };
  const H = pad.t + row * lines.length + pad.b;
  const vals = [0, 100];
  let lo = Math.min(...vals),
    hi = Math.max(...vals);
  const span = Math.max(hi - lo, 2);
  lo -= span * 0.06;
  hi += span * 0.06;
  const x = (v: number) => pad.l + ((v - lo) / (hi - lo)) * (W - pad.l - pad.r);
  const root = svg("svg", {
    viewBox: `0 0 ${W} ${H}`,
    role: "img",
    "aria-label":
      "Points each game earned, 0 to 100: above 50 for a win, below 50 for a loss",
  });
  const step = 25;
  for (let v = 0; v <= 100; v += step) {
    root.appendChild(
      svg("line", {
        class: "tl",
        x1: x(v),
        x2: x(v),
        y1: pad.t - 6,
        y2: H - pad.b,
      }),
    );
    const t = svg("text", {
      class: "tk",
      x: x(v),
      y: 12,
      "text-anchor": "middle",
    });
    t.textContent = String(v);
    root.appendChild(t);
  }
  // Bars start at 50, the line between a win and a loss; the marker is the average.
  const rx = x(rating);
  const lineY = (i: number) => pad.t + row * i + row / 2;
  const label = (y: number, text: string, cls = "rl") => {
    const t = svg("text", { class: cls, x: 40, y: y + 4 });
    t.textContent = text;
    root.appendChild(t);
  };
  const stem = (y: number, v: number, title: string, logoId?: number) => {
    const g = svg("g", { class: `brow ${v >= 50 ? "up" : "down"}` });
    g.appendChild(
      svg("line", {
        class: "stem",
        x1: x(50),
        x2: x(v),
        y1: y,
        y2: y,
        style: "stroke-width:4px",
      }),
    );
    g.appendChild(svg("circle", { class: "pt", cx: x(v), cy: y, r: 4 }));
    const tt = svg("title", {});
    tt.textContent = title;
    g.appendChild(tt);
    root.appendChild(g);
    if (logoId !== undefined) root.appendChild(badge(ctx, logoId, 18, y, 22));
  };
  lines.forEach((l, i) => {
    const y = lineY(i);
    const o = l.opponent;
    const score = `${l.won ? "W" : "L"} ${l.won ? l.edge.winnerPoints : l.edge.loserPoints}–${l.won ? l.edge.loserPoints : l.edge.winnerPoints}`;
    label(
      y,
      `${l.where === 1 ? "vs" : l.where === -1 ? "at" : "vs"} ${o.abbreviation || o.school} · ${score}`,
    );
    stem(
      y,
      l.value,
      `${score} against ${o.school} (quality ${(o.height ?? 0).toFixed(2)} of 100): ${fmtScore(l.value)} points`,
      o.id,
    );
  });
  root.appendChild(
    svg("line", {
      class: "rline",
      x1: rx,
      x2: rx,
      y1: pad.t - 6,
      y2: H - pad.b + 4,
    }),
  );
  const rt = svg("text", {
    class: "rlab",
    x: Math.min(Math.max(rx, pad.l + 40), W - pad.r - 40),
    y: H - 6,
    "text-anchor": "middle",
  });
  rt.textContent = `Average ${fmtScore(rating)} per game`;
  root.appendChild(rt);
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
          title: `Points for ${l.won ? "beating" : "losing to"} ${o.school}, quality ${(o.height ?? 0).toFixed(2)} of 100: ${l.won ? "50 + half their quality" : "half their quality"}.`,
        },
        fmtScore(l.value),
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
      h("div", { class: "r" }, "Pull"),
    ),
    ...rows,
  );
}
