import type { Edge, Ranking } from "../../src/engine/types";
import {
  type Ctx,
  type GameLine,
  METRIC_HINT,
  METRIC_LABEL,
  board,
  breakdown,
  fmtHeight,
  fmtTeamScore,
  scoreLabel,
  href,
  rankLabel,
  record,
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
            `${shortConf(team.conference)} · ${team.classification.toUpperCase()} · ${ctx.entry.season}`,
          ),
        ),
      ),
      h(
        "div",
        { class: "tstats" },
        stat("Current rank", rankLabel(team.rank, team.tied)),
        stat("Record", record(team)),
        stat(scoreLabel(ctx), fmtTeamScore(ctx, team)),
        stat(
          "This week",
          team.change === null
            ? "New"
            : team.change === 0
              ? "—"
              : h(
                  "span",
                  { class: team.change > 0 ? "upc" : "downc" },
                  `${team.change > 0 ? "▲" : "▼"}${Math.abs(team.change)}`,
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
// How the rating is built: immutable win credits and fixed loss deductions.
function whyPanel(ctx: Ctx, teamId: number): HTMLElement {
  const me = ctx.byId.get(teamId)!;
  if (me.neural)
    return h(
      "div",
      { class: "panel why" },
      h("h2", {}, "Neural prediction"),
      h(
        "p",
        {},
        `Average neutral-site win chance: ${fmtTeamScore(ctx, me)} across the full ${ctx.ranking.manifest.neural!.referenceTeams}-team field.`,
      ),
      h(
        "p",
        { class: "hint" },
        ctx.ranking.manifest.neural!.policy
          ? "Neural performance estimates are reduced for limited evidence and losses. The displayed average includes FCS opponents; it does not measure confidence in this rank."
          : "The ranking orders teams using all head-to-head neural win probabilities. The average is a summary; individual matchups can favor a different team.",
      ),
      h(
        "div",
        { class: "credit-equation" },
        ...(ctx.ranking.manifest.neural!.policy ? [
          h("div", {}, h("b", {}, me.wins + me.losses), h("small", {}, "Completed games")),
          h("div", {}, h("b", {}, me.losses), h("small", {}, "Losses · explicit deduction")),
          h("div", {}, h("b", {}, `${(100 * me.neural.evidenceReliability!).toFixed(0)}%`), h("small", {}, "Evidence retained")),
        ] : [h(
          "div",
          {},
          h("b", {}, `${(100 * me.neural.richWinProbability!).toFixed(1)}%`),
          h("small", {}, "Rich-stat networks · 75%"),
        ),
        h(
          "div",
          {},
          h("b", {}, `${(100 * me.neural.graphWinProbability!).toFixed(1)}%`),
          h("small", {}, "Opponent-graph networks · 25%"),
        )]),
      ),
      h(
        "p",
        { class: "hint" },
        ctx.ranking.manifest.neural!.policy
          ? `The model retains ${(100 * me.neural.evidenceReliability!).toFixed(0)}% of its unshrunk performance estimate from games against rated opponents. More games reduce that shrinkage. A bounded neural adjustment refines the robust schedule rating; losses are deducted after training. Evidence retained is a model weight, not confidence in the rank. Shared weights learn from prior seasons; team reputation is excluded.`
          : "Both groups use this season’s scores, efficiency and opponent statistics. Shared weights were trained on prior seasons. Team names, recruiting and preseason ratings are excluded.",
      ),
      h(
        "a",
        { class: "btn", href: href(ctx.entry.season, ctx.snapId, "matchups") },
        "Compare any two teams",
      ),
    );
  const b = breakdown(ctx, teamId);
  const order = (l: GameLine) =>
    (l.edge.seasonType === "postseason" ? 99 : l.edge.week) * 1e9 +
    l.edge.gameId;
  const lines = [...b.lines].sort((x, y) => order(x) - order(y));
  const earned = lines
    .filter((l) => l.won)
    .reduce((sum, l) => sum + l.value, 0);
  return h(
    "div",
    { class: "panel why" },
    h("h2", {}, "Score breakdown"),
    h(
      "div",
      { class: "credit-equation" },
      h(
        "div",
        { class: "earned" },
        h("b", {}, fmtHeight(earned, 3)),
        h("small", {}, "Win credits"),
      ),
      h("span", { "aria-hidden": "true" }, "−"),
      h(
        "div",
        { class: "deducted" },
        h("b", {}, me.losses),
        h("small", {}, "Losses × 1"),
      ),
      h("span", { "aria-hidden": "true" }, "="),
      h(
        "div",
        {},
        h("b", {}, fmtHeight(b.average, 3)),
        h("small", {}, "Score"),
      ),
    ),
    breakdownChart(ctx, b.fromGames, lines),
    h(
      "details",
      { class: "quiet-details" },
      h("summary", {}, "Scoring details"),
      h(
        "p",
        {},
        ctx.ranking.manifest.winQuality
          ? "A win earns twice the opponent’s pre-week chance of beating an average FBS team. Average-quality win: +1. Every loss: −1. Credits stay fixed. Division-level starting estimates come from 2014–2019 results, then current games update them."
          : "Wins earn 0–1 point based on pre-week opponent quality. Credits stay fixed. Every loss deducts exactly 1 point.",
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
  const vals = [0, rating, ...lines.map((l) => l.value)];
  let lo = Math.min(...vals),
    hi = Math.max(...vals);
  const span = Math.max(hi - lo, 2);
  lo -= span * 0.06;
  hi += span * 0.06;
  const x = (v: number) => pad.l + ((v - lo) / (hi - lo)) * (W - pad.l - pad.r);
  const root = svg("svg", {
    viewBox: `0 0 ${W} ${H}`,
    role: "img",
    "aria-label": "How this team's score is built from its games",
  });
  const step =
    [0.25, 0.5, 1, 2, 5, 10, 20, 25, 50].find((st) => span / st <= 6) ?? 100;
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
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
    t.textContent = (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v);
    root.appendChild(t);
  }
  const rx = x(rating);
  const lineY = (i: number) => pad.t + row * i + row / 2;
  const label = (y: number, text: string, cls = "rl") => {
    const t = svg("text", { class: cls, x: 40, y: y + 4 });
    t.textContent = text;
    root.appendChild(t);
  };
  const stem = (y: number, v: number, title: string, logoId?: number) => {
    const g = svg("g", { class: `brow ${v >= 0 ? "up" : "down"}` });
    g.appendChild(
      svg("line", { class: "stem", x1: x(0), x2: x(v), y1: y, y2: y }),
    );
    g.appendChild(svg("circle", { class: "pt", cx: x(v), cy: y, r: 5 }));
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
      `${score} against ${o.school}: ${l.won ? "pre-week win credit" : "fixed loss deduction"} ${fmtHeight(l.value, 3)}`,
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
  rt.textContent = `Total earned points ${fmtHeight(rating, 3)}`;
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
    rank: rankings[i]!.teams.find((t) => t.id === teamId)?.rank ?? null,
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
    const pull = l.value;
    const published = ctx.ranking.teams.some((t) => t.id === o.id);
    const credit = ctx.ranking.credits.find((c) => c.gameId === e.gameId);
    return h(
      published ? "a" : "div",
      {
        class: "grow2",
        ...(published ? { href: teamHref(ctx, o.id) } : {}),
      },
      h(
        "span",
        { class: "wk" },
        e.seasonType === "postseason" ? "Bowl" : `Wk ${e.week}`,
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
      ctx.ranking.manifest.neural
        ? ""
        : h(
            "span",
            {
              class: `r ${pull >= 0 ? "pos" : "neg"}`,
              title:
                l.won && credit?.unmodeled
                  ? "Unmodeled opponent: no quality points awarded. Losses against these opponents still cost exactly 1 point."
                  : l.won && credit?.quality
                    ? `2 × ${(credit.quality.probability * 100).toFixed(1)}% pre-week opponent chance against an average FBS team. Opponent evidence: ${credit.quality.opponentGames} games.`
                    : "Points this result adds to or subtracts from the standing",
            },
            fmtHeight(pull, 3),
          ),
    );
  });
  return h(
    "section",
    {
      class: `ladder games${ctx.ranking.manifest.neural ? " neural-games" : ""}`,
    },
    h(
      "div",
      { class: "lhead" },
      h("div", {}, "When"),
      h("div"),
      h("div", {}, "Opponent"),
      h("div", {}, "Result"),
      ctx.ranking.manifest.neural ? "" : h("div", { class: "r" }, "Points"),
    ),
    ...rows,
  );
}
