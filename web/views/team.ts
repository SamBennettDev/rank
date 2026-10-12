import type { Edge, Ranking } from "../../src/engine/types";
import { type Ctx, type GameLine, METRIC_HINT, METRIC_LABEL, board, breakdown, fmtHeight, href, rankLabel, record, teamHref } from "../ctx";
import { h, svg } from "../dom";
import { arrowLeft } from "../icons";
import { logo, svgLogo, teamVars } from "../team";
import { loadRanking } from "../store";

export function teamView(ctx: Ctx, teamId: number): HTMLElement {
  const team = ctx.byId.get(teamId);
  const tl = ctx.teams.get(teamId);
  if (!team) return h("div", { class: "empty" }, h("h2", {}, "Team not found"), h("a", { class: "btn", href: href(ctx.entry.season, ctx.snapId, "list") }, "Back to rankings"));

  const games = ctx.edges
    .filter((e) => e.winner === teamId || e.loser === teamId)
    .sort((a, b) => (a.seasonType === b.seasonType ? 0 : a.seasonType === "regular" ? -1 : 1) || a.week - b.week || a.gameId - b.gameId);

  const stat = (label: string, value: Node | string) => h("div", { class: "tstat" }, h("b", {}, value), h("span", {}, label));
  const hero = h("section", { class: "thero tv", style: teamVars(tl?.color) },
    logo(tl, 520, { className: "wm" }),
    h("div", { class: "thero-inner" },
      h("a", { class: "back", href: href(ctx.entry.season, ctx.snapId, "list") }, arrowLeft(), "All teams"),
      h("div", { class: "tid" },
        logo(tl, 128),
        h("div", {},
          h("h1", {}, team.school),
          h("div", { class: "sub" },
            h("span", { class: "chip" }, h("b", {}, team.conference)),
            h("span", { class: "chip" }, team.classification.toUpperCase()),
            h("span", { class: "chip" }, `${ctx.entry.season} · ${ctx.ranking.snapshot.label}`)))),
      h("div", { class: "tstats" },
        stat("Rank", rankLabel(team.rank, team.tied)),
        stat("Record", record(team)),
        stat("Rating", fmtHeight(team.height)),
        stat("This week", team.change === null ? "New" : team.change === 0 ? "—" : h("span", { class: team.change > 0 ? "upc" : "downc" }, `${team.change > 0 ? "▲" : "▼"}${Math.abs(team.change)}`)))),
  );

  if (team.rank === null) {
    return h("div", {}, hero, h("div", { class: "tbody" }, h("div", { class: "panel" }, h("p", { class: "hint" }, "No counted games yet, so this team is unranked. It will appear once it plays an FBS or FCS opponent."))));
  }

  const history = h("div", { class: "panel tv", style: teamVars(tl?.color) }, h("h2", {}, "Rank by week"), h("p", { class: "hint" }, "Recomputed from scratch each week using only games played so far."), h("div", { class: "loading" }, h("span"), h("span"), h("span")));
  void loadHistory(ctx, teamId).then((pts) => history.lastElementChild!.replaceWith(historyChart(pts, ctx.snapId)));

  return h("div", {},
    hero,
    h("div", { class: "tbody" },
      unitsPanel(ctx, teamId),
      h("div", { class: "tgrid" },
        whyPanel(ctx, teamId),
        history),
      gameLog(ctx, teamId, games)),
  );
}

// ---------------------------------------------------------------------------
// Offense, defense and special teams from play-by-play.
function unitsPanel(ctx: Ctx, teamId: number): HTMLElement | "" {
  const me = ctx.byId.get(teamId)!;
  if (me.offense === null) {
    return ctx.ranked.some((t) => t.offense !== null)
      ? h("div", { class: "panel unitsp" }, h("h2", {}, "Offense · Defense · Special teams"), h("p", { class: "hint" }, "No play-by-play for this team’s games yet (the public play-by-play covers games with an FBS team), so it has no unit ratings."))
      : "";
  }
  const card = (m: "offense" | "defense" | "special") => {
    const b = board(ctx, m);
    const e = b.find((x) => x.team.id === teamId)!;
    return h("div", { class: "unit", title: METRIC_HINT[m] },
      h("div", { class: "k" }, METRIC_LABEL[m]),
      h("div", { class: "rk" }, `#${rankLabel(e.rank, e.tied)}`, h("small", {}, `of ${b.length}`)),
      h("div", { class: "v" }, h("b", {}, fmtHeight(e.value)), " points per game vs average"));
  };
  const total = me.offense + me.defense! + me.special!;
  return h("div", { class: "panel unitsp" },
    h("h2", {}, "Offense · Defense · Special teams"),
    h("p", { class: "hint" }, `From this season’s play-by-play: expected points per snap for and against (garbage time removed) and on kicks, adjusted for opponents and home field. Together they come to ${fmtHeight(total)} points per game; the overall rating (${fmtHeight(me.height)}) comes from final scores, which predicted games better in testing.`),
    h("div", { class: "units" }, card("offense"), card("defense"), card("special")));
}

// ---------------------------------------------------------------------------
// How the rating is built: every game's value and the starting rating, averaged.
function whyPanel(ctx: Ctx, teamId: number): HTMLElement {
  const me = ctx.byId.get(teamId)!;
  const b = breakdown(ctx, teamId);
  const order = (l: GameLine) => (l.edge.seasonType === "postseason" ? 99 : l.edge.week) * 1e9 + l.edge.gameId;
  const lines = [...b.lines].sort((x, y) => order(x) - order(y));
  const sum = lines.reduce((s, l) => s + l.value, 0);
  return h("div", { class: "panel why" },
    h("h2", {}, "Why it’s here"),
    h("p", { class: "hint" }, `Each game says what this team’s rating should be: the opponent’s rating plus this team’s margin (with 3 points for winning), adjusted for home field. The rating is the average of those. Every team starts level, so only this season’s games count. When two teams are rated within ${ctx.ranking.manifest.headToHeadWindow} points and one beat the other, head-to-head breaks the tie: the winner is held just above. Dots right of the line pull the rating up; dots left pull it down.`),
    breakdownChart(ctx, me.height!, lines),
    h("p", { class: "sum" },
      Math.abs(b.holds) > 0.05
        ? `(${lines.length} game${lines.length === 1 ? "" : "s"} totalling ${fmtHeight(sum)}, head-to-head ${fmtHeight(b.holds)}) ÷ ${lines.length + b.shrink} = `
        : `${lines.length} game${lines.length === 1 ? "" : "s"} totalling ${fmtHeight(sum)} ÷ ${lines.length + b.shrink} = `,
      h("b", {}, fmtHeight(b.average)),
      Math.abs(b.average - me.height!) > 0.05 ? ` (published ${fmtHeight(me.height)})` : ""));
}

function breakdownChart(ctx: Ctx, rating: number, lines: GameLine[]): SVGSVGElement {
  const W = 560;
  const row = 30;
  const pad = { l: 178, r: 24, t: 24, b: 28 };
  const H = pad.t + row * lines.length + pad.b;
  const vals = [rating, ...lines.map((l) => l.value)];
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const span = Math.max(hi - lo, 10);
  lo -= span * 0.06;
  hi += span * 0.06;
  const x = (v: number) => pad.l + ((v - lo) / (hi - lo)) * (W - pad.l - pad.r);
  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "How this team's rating is built from its games" });
  const step = [1, 2, 5, 10, 20, 25, 50].find((st) => span / st <= 6) ?? 100;
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    root.appendChild(svg("line", { class: "tl", x1: x(v), x2: x(v), y1: pad.t - 6, y2: H - pad.b }));
    const t = svg("text", { class: "tk", x: x(v), y: 12, "text-anchor": "middle" });
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
    const g = svg("g", { class: `brow ${v >= rating ? "up" : "down"}` });
    g.appendChild(svg("line", { class: "stem", x1: rx, x2: x(v), y1: y, y2: y }));
    g.appendChild(svg("circle", { class: "pt", cx: x(v), cy: y, r: 5 }));
    const tt = svg("title", {});
    tt.textContent = title;
    g.appendChild(tt);
    root.appendChild(g);
    if (logoId !== undefined) root.appendChild(badge(ctx, logoId, 18, y, 22));
  };
  const homeField = ctx.ranking.manifest.homeField;
  lines.forEach((l, i) => {
    const y = lineY(i);
    const o = l.opponent;
    const score = `${l.won ? "W" : "L"} ${l.won ? l.edge.winnerPoints : l.edge.loserPoints}–${l.won ? l.edge.loserPoints : l.edge.winnerPoints}`;
    label(y, `${l.where === 1 ? "vs" : l.where === -1 ? "at" : "vs"} ${o.abbreviation || o.school} · ${score}`);
    const site = l.where === 1 ? ` − ${homeField.toFixed(1)} home field` : l.where === -1 ? ` + ${homeField.toFixed(1)} away` : " (neutral site)";
    stem(y, l.value, `${o.school} rated ${fmtHeight(o.height)}; ${score} → ${l.result > 0 ? "+" : "−"}${Math.abs(l.result)} with the win bonus${site} = ${fmtHeight(l.value)}`, o.id);
  });
  root.appendChild(svg("line", { class: "rline", x1: rx, x2: rx, y1: pad.t - 6, y2: H - pad.b + 4 }));
  const rt = svg("text", { class: "rlab", x: Math.min(Math.max(rx, pad.l + 40), W - pad.r - 40), y: H - 6, "text-anchor": "middle" });
  rt.textContent = `Rating ${fmtHeight(rating)}`;
  root.appendChild(rt);
  return root;
}

function badge(ctx: Ctx, id: number, x: number, y: number, size: number): SVGGElement {
  const t = ctx.teams.get(id);
  const g = svg("g", { class: "badge", style: teamVars(t?.color) });
  const mono = svg("g", { class: "bmono", style: "display:none" });
  mono.appendChild(svg("circle", { cx: x, cy: y, r: size / 2, fill: "var(--tc)" }));
  const txt = svg("text", { x, y, "text-anchor": "middle", "dominant-baseline": "central", fill: "var(--tc-ink)", style: `font:800 ${Math.round(size * 0.32)}px var(--display)` });
  txt.textContent = (t?.abbreviation ?? "?").slice(0, 4);
  mono.appendChild(txt);
  const img = svg("image", { x: x - size / 2, y: y - size / 2, width: size, height: size });
  g.append(mono, img);
  svgLogo(img, id, Math.ceil(size * 2.5), () => mono.setAttribute("style", ""));
  return g;
}

// ---------------------------------------------------------------------------
// Rank history across the season's snapshots, up to the one being viewed.
async function loadHistory(ctx: Ctx, teamId: number): Promise<{ id: string; label: string; rank: number | null }[]> {
  const upto = ctx.entry.snapshots.findIndex((s) => s.id === ctx.snapId);
  const snaps = ctx.entry.snapshots.slice(0, upto + 1);
  const rankings: Ranking[] = await Promise.all(snaps.map((s) => loadRanking(ctx.entry.season, s.id)));
  return snaps.map((s, i) => ({ id: s.id, label: s.label.replace("Week ", "W").replace("Postseason", "Post"), rank: rankings[i]!.teams.find((t) => t.id === teamId)?.rank ?? null }));
}

function historyChart(pts: { id: string; label: string; rank: number | null }[], current: string): SVGSVGElement {
  const W = 480;
  const H = 300;
  const pad = { l: 40, r: 20, t: 26, b: 30 };
  const ranks = pts.map((p) => p.rank).filter((r): r is number => r !== null);
  const best = Math.max(1, Math.min(...ranks) - 5);
  const worst = Math.max(...ranks) + 5;
  const x = (i: number) => pad.l + (pts.length === 1 ? (W - pad.l - pad.r) / 2 : (i / (pts.length - 1)) * (W - pad.l - pad.r));
  const y = (r: number) => pad.t + ((r - best) / Math.max(1, worst - best)) * (H - pad.t - pad.b);
  const root = svg("svg", { class: "hist", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Rank by week" });
  const defs = svg("defs");
  defs.innerHTML = `<linearGradient id="histfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--ta);stop-opacity:.3"/><stop offset="1" style="stop-color:var(--ta);stop-opacity:0"/></linearGradient>`;
  root.appendChild(defs);
  const nice: number[] = [];
  for (const r of [1, 5, 10, 25, 50, 75, 100, 150, 200, 250]) {
    if (r >= best && r <= worst && (nice.length === 0 || y(r) - y(nice.at(-1)!) >= 22)) nice.push(r);
  }
  for (const r of nice) {
    root.appendChild(svg("line", { class: "grid", x1: pad.l, x2: W - pad.r, y1: y(r), y2: y(r) }));
    const t = svg("text", { class: "gl", x: pad.l - 8, y: y(r) + 4, "text-anchor": "end" });
    t.textContent = `#${r}`;
    root.appendChild(t);
  }
  pts.forEach((p, i) => {
    const t = svg("text", { class: "gl", x: x(i), y: H - 8, "text-anchor": "middle" });
    t.textContent = p.label;
    if (p.id === current) t.setAttribute("style", "fill:var(--text)");
    root.appendChild(t);
  });
  const valid = pts.map((p, i) => ({ ...p, i })).filter((p) => p.rank !== null);
  if (valid.length > 1) {
    const d = valid.map((p, k) => `${k ? "L" : "M"}${x(p.i)},${y(p.rank!)}`).join(" ");
    root.appendChild(svg("path", { class: "area", d: `${d} L${x(valid.at(-1)!.i)},${H - pad.b} L${x(valid[0]!.i)},${H - pad.b} Z` }));
    root.appendChild(svg("path", { class: "line", d }));
  }
  for (const p of valid) {
    root.appendChild(svg("circle", { class: "pt", cx: x(p.i), cy: y(p.rank!), r: 5 }));
    const t = svg("text", { class: "pv", x: x(p.i), y: y(p.rank!) - 11 });
    t.textContent = String(p.rank);
    root.appendChild(t);
  }
  return root;
}

// ---------------------------------------------------------------------------
function gameLog(ctx: Ctx, teamId: number, games: Edge[]): HTMLElement {
  const me = ctx.byId.get(teamId)!;
  const byGame = new Map(breakdown(ctx, teamId).lines.map((l) => [l.edge.gameId, l]));
  const rows = games.map((e) => {
    const l = byGame.get(e.gameId)!;
    const o = l.opponent;
    const upset = (l.won && me.height! < o.height!) || (!l.won && o.height! < me.height!);
    const pull = l.value - me.height!;
    return h("a", { class: "grow2", href: teamHref(ctx, o.id) },
      h("span", { class: "wk" }, e.seasonType === "postseason" ? "Bowl" : `Wk ${e.week}`),
      logo(ctx.teams.get(o.id), 34, { lazy: true }),
      h("span", { class: "op" },
        h("span", { class: "n" }, `${l.where === -1 ? "at" : "vs"} ${o.school}`),
        h("span", { class: "c" }, `#${rankLabel(o.rank, o.tied)} · ${record(o)} · ${o.conference}`, upset || l.held ? " " : "", upset ? h("span", { class: "tag-up" }, "UPSET") : "", l.held ? h("span", { class: "tag-held", title: l.won ? `Rated within ${ctx.ranking.manifest.headToHeadWindow} points of ${o.school}, and this team won, so it is held just above them.` : `Rated within ${ctx.ranking.manifest.headToHeadWindow} points of ${o.school}, who won, so this team is held just below them.` }, "H2H") : "")),
      h("span", { class: `pill ${l.won ? "w" : "l"}` }, h("i", {}, l.won ? "W" : "L"), `${l.won ? e.winnerPoints : e.loserPoints}–${l.won ? e.loserPoints : e.winnerPoints}`),
      h("span", { class: "r hide-sm" }, fmtHeight(o.height)),
      h("span", { class: "r hide-sm", title: "What this game alone says this team's rating is: opponent rating + margin (±3 for the result), adjusted for home field" }, fmtHeight(l.value)),
      h("span", { class: `r ${pull >= 0 ? "pos" : "neg"}`, title: "How far this game pulls the rating up (+) or down (−)" }, fmtHeight(pull)),
    );
  });
  return h("section", { class: "ladder games" },
    h("div", { class: "lhead" }, h("div", {}, "When"), h("div"), h("div", {}, "Opponent"), h("div", {}, "Result"), h("div", { class: "r hide-sm" }, "Opp. rating"), h("div", { class: "r hide-sm" }, "Game says"), h("div", { class: "r" }, "Pull")),
    ...rows);
}
