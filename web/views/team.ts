import type { Edge, Ranking } from "../../src/engine/types";
import { type Ctx, type Site, byMargin, clampNote, restLabel, restLength, expectedMargin, fmtHeight, fmtPoints, gridironParams, homeField, href, isGridiron, predictedMargin, rankLabel, record, siteFor, springPull, springWidth, teamHref } from "../ctx";
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
        stat(isGridiron(ctx) ? "Rating" : "Height", fmtHeight(team.height)),
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
      h("div", { class: "tgrid" },
        h("div", { class: "panel springs" },
          h("h2", {}, "Why it’s here"),
          h("p", { class: "hint" }, isGridiron(ctx)
            ? `Each game is a spring that wants the winner as many points above the loser as they won by, plus ${gridironParams(ctx)!.winBonus} for winning, after home field. Thinner lines are blowouts the ${gridironParams(ctx)!.blowoutLimit}-point limit stopped from pulling harder.`
            : byMargin(ctx)
            ? `Each game is a spring pulling the winner ${restLabel(ctx)} above the loser, as stiff as the winning margin${clampNote(ctx)} (thicker line = stiffer spring). This team rests where its springs balance.`
            : `Each win is a spring pulling the winner ${restLabel(ctx)} above the loser. The score doesn’t matter, only who won. This team rests where its springs balance.`),
          springs(ctx, teamId, games)),
        history),
      isGridiron(ctx) ? matchup(ctx, teamId) : "",
      isGridiron(ctx) ? gridironLog(ctx, teamId, games) : gameLog(ctx, teamId, games)),
  );
}

// ---------------------------------------------------------------------------
// Springs diagram: opponents at their real heights, wins on the left, losses right.
function springs(ctx: Ctx, teamId: number, games: Edge[]): SVGSVGElement {
  const W = 560;
  const H = 440;
  const pad = { t: 34, b: 24 };
  const me = ctx.byId.get(teamId)!;
  const opp = games.map((e) => ({ e, won: e.winner === teamId, o: ctx.byId.get(e.winner === teamId ? e.loser : e.winner)! }));
  const hs = [me.height!, ...opp.map((x) => x.o.height!)];
  let lo = Math.min(...hs);
  let hi = Math.max(...hs);
  const span = Math.max(hi - lo, 0.6);
  lo -= span * 0.08;
  hi += span * 0.08;
  const y = (v: number) => pad.t + ((hi - v) / (hi - lo)) * (H - pad.t - pad.b);
  const cx = W / 2;
  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Springs diagram of this team's games" });

  // height ticks
  // ~6 guide lines whatever the scale (points for Gridiron Springs, units for SpringRank)
  const step = [0.25, 0.5, 1, 2, 5, 10, 20, 50].find((st) => span / st <= 7) ?? 100;
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    root.appendChild(svg("line", { class: "tl", x1: 40, x2: W - 10, y1: y(v), y2: y(v) }));
    const t = svg("text", { class: "tk", x: 4, y: y(v) + 4 });
    t.textContent = (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(step < 1 ? 2 : 0);
    root.appendChild(t);
  }
  const head = (x: number, text: string, anchor: string) => {
    const t = svg("text", { class: "lbl", x, y: 14, "text-anchor": anchor });
    t.textContent = text;
    root.appendChild(t);
  };
  head(150, "Beat", "middle");
  head(W - 130, "Lost to", "middle");
  head(cx, "", "middle");

  const sz = 26;
  const place = (list: typeof opp, baseX: number, dir: 1 | -1) => {
    const placed: { x: number; y: number }[] = [];
    let lastLabelY = -99;
    for (const item of [...list].sort((a, b) => b.o.height! - a.o.height!)) {
      const oy = y(item.o.height!);
      let x = baseX;
      for (let k = 0; placed.some((p) => Math.hypot(p.x - x, p.y - oy) < sz + 2) && k < 12; k++) x = baseX + dir * (k + 1) * (sz + 4) * (k % 2 === 0 ? 1 : -1) * 0.5;
      placed.push({ x, y: oy });
      const upset = item.won ? me.height! < item.o.height! : item.o.height! < me.height!;
      const c1 = cx + (x - cx) * 0.55;
      root.appendChild(svg("path", { class: `s ${item.won ? "w" : "l"}${upset ? " up" : ""}`, d: `M${x},${oy} C${c1},${oy} ${c1},${y(me.height!)} ${cx},${y(me.height!)}`, style: `stroke-width:${springWidth(ctx, item.e)}` }));
      const a = svg("a", { href: teamHref(ctx, item.o.id) });
      a.appendChild(svg("circle", { cx: x, cy: oy, r: sz / 2 + 2, fill: "var(--surface)", stroke: "var(--line-2)" }));
      a.appendChild(badge(ctx, item.o.id, x, oy, sz - 4));
      const title = svg("title", {});
      title.textContent = `${item.o.school} (#${rankLabel(item.o.rank, item.o.tied)}), ${item.won ? "W" : "L"} ${item.won ? item.e.winnerPoints : item.e.loserPoints}–${item.won ? item.e.loserPoints : item.e.winnerPoints}`;
      a.appendChild(title);
      if (Math.abs(oy - lastLabelY) >= 14) {
        const lx = dir < 0 ? Math.min(...placed.filter((p) => Math.abs(p.y - oy) < 1).map((p) => p.x)) - sz / 2 - 6 : Math.max(...placed.filter((p) => Math.abs(p.y - oy) < 1).map((p) => p.x)) + sz / 2 + 6;
        const t = svg("text", { class: "on", x: lx, y: oy + 4, "text-anchor": dir < 0 ? "end" : "start" });
        t.textContent = `#${rankLabel(item.o.rank, item.o.tied)} ${item.o.abbreviation || item.o.school}`;
        a.appendChild(t);
        lastLabelY = oy;
      }
      root.appendChild(a);
    }
  };
  const wins = opp.filter((x) => x.won);
  const losses = opp.filter((x) => !x.won);
  place(wins, 170, -1);
  place(losses, W - 150, 1);
  const none = (x: number, text: string) => {
    const t = svg("text", { class: "none", x, y: H / 2, "text-anchor": "middle" });
    t.textContent = text;
    root.appendChild(t);
  };
  if (losses.length === 0) none(W - 130, "Undefeated");
  if (wins.length === 0) none(150, "No wins yet");

  // the team itself, on top
  const my = y(me.height!);
  root.appendChild(svg("circle", { cx, cy: my, r: 25, fill: "var(--surface)", stroke: "var(--ta)", "stroke-width": 3 }));
  root.appendChild(badge(ctx, teamId, cx, my, 40));
  return root;
}

/** Team logo centred at (x, y); falls back to a monogram in team colours if no logo loads. */
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
  const sign = (v: number, d = 2) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d);
  const rows = games.map((e) => {
    const won = e.winner === teamId;
    const o = ctx.byId.get(won ? e.loser : e.winner)!;
    const gap = me.height! - o.height!;
    const tension = ctx.byId.get(e.winner)!.height! - ctx.byId.get(e.loser)!.height! - restLength(ctx);
    const upset = (won && gap < 0) || (!won && gap > 0);
    return h("a", { class: "grow2", href: teamHref(ctx, o.id) },
      h("span", { class: "wk" }, e.seasonType === "postseason" ? "Bowl" : `Wk ${e.week}`),
      logo(ctx.teams.get(o.id), 34, { lazy: true }),
      h("span", { class: "op" },
        h("span", { class: "n" }, e.neutralSite ? `vs ${o.school}` : (won ? e.winnerIsHome : !e.winnerIsHome) ? `vs ${o.school}` : `at ${o.school}`),
        h("span", { class: "c" }, `#${rankLabel(o.rank, o.tied)} · ${record(o)} · ${o.conference}`, upset ? " " : "", upset ? h("span", { class: "tag-up" }, "UPSET") : "")),
      h("span", { class: `pill ${won ? "w" : "l"}` }, h("i", {}, won ? "W" : "L"), `${won ? e.winnerPoints : e.loserPoints}–${won ? e.loserPoints : e.winnerPoints}`),
      h("span", { class: "r hide-sm" }, fmtHeight(o.height)),
      h("span", { class: `r ${gap >= 0 ? "pos" : "neg"}` }, sign(gap)),
      h("span", { class: "r hide-sm", title: `Winner height − loser height − ${restLength(ctx)}. Zero means the spring is at rest; negative means it is stretched pulling the winner up.` }, sign(tension)),
    );
  });
  return h("section", { class: "ladder games" },
    h("div", { class: "lhead" }, h("div", {}, "When"), h("div"), h("div", {}, "Opponent"), h("div", {}, "Result"), h("div", { class: "r hide-sm" }, "Opp. ht"), h("div", { class: "r" }, "Gap"), h("div", { class: "r hide-sm" }, "Spring")),
    ...rows);
}


// ---------------------------------------------------------------------------
// Gridiron Springs: predicted vs actual for every game, and a matchup predictor.
function gridironLog(ctx: Ctx, teamId: number, games: Edge[]): HTMLElement {
  const me = ctx.byId.get(teamId)!;
  const rows = games.map((e) => {
    const won = e.winner === teamId;
    const o = ctx.byId.get(won ? e.loser : e.winner)!;
    const site = siteFor(e, teamId);
    const expected = predictedMargin(ctx, expectedMargin(ctx, teamId, o.id, site));
    const actual = won ? e.winnerPoints - e.loserPoints : e.loserPoints - e.winnerPoints;
    const diff = actual - expected;
    const pull = springPull(ctx, e);
    const upset = (won && me.height! < o.height!) || (!won && me.height! > o.height!);
    return h("a", { class: "grow2", href: teamHref(ctx, o.id) },
      h("span", { class: "wk" }, e.seasonType === "postseason" ? "Bowl" : `Wk ${e.week}`),
      logo(ctx.teams.get(o.id), 34, { lazy: true }),
      h("span", { class: "op" },
        h("span", { class: "n" }, site === "away" ? `at ${o.school}` : `vs ${o.school}`),
        h("span", { class: "c" }, `#${rankLabel(o.rank, o.tied)} · ${record(o)} · ${site === "neutral" ? "neutral site" : o.conference}`, upset ? " " : "", upset ? h("span", { class: "tag-up" }, "UPSET") : "")),
      h("span", { class: `pill ${won ? "w" : "l"}` }, h("i", {}, won ? "W" : "L"), `${won ? e.winnerPoints : e.loserPoints}–${won ? e.loserPoints : e.winnerPoints}`),
      h("span", { class: "r hide-sm", title: "Predicted margin from the final ratings, including home field" }, fmtPoints(expected)),
      h("span", { class: `r ${diff >= 0 ? "pos" : "neg"}`, title: "Actual margin minus predicted margin" }, fmtPoints(diff)),
      h("span", { class: "r hide-sm", title: pull < 1 ? "Blowout limit: this game pulls with reduced force" : "Full pull" }, pull < 1 ? `${Math.round(pull * 100)}%` : "100%"),
    );
  });
  return h("section", { class: "ladder games" },
    h("div", { class: "lhead" }, h("div", {}, "When"), h("div"), h("div", {}, "Opponent"), h("div", {}, "Result"), h("div", { class: "r hide-sm" }, "Expected"), h("div", { class: "r" }, "vs exp."), h("div", { class: "r hide-sm" }, "Pull")),
    ...rows);
}

function matchup(ctx: Ctx, teamId: number): HTMLElement {
  const me = ctx.byId.get(teamId)!;
  const others = ctx.ranked.filter((t) => t.id !== teamId);
  const near = others.find((t) => t.rank! > me.rank!) ?? others.at(-1)!;
  let oppId = near.id;
  let site: Site = "neutral";
  const out = h("div", { class: "mu-out" });
  const draw = () => {
    const o = ctx.byId.get(oppId)!;
    const gap = expectedMargin(ctx, teamId, oppId, site);
    const pm = predictedMargin(ctx, gap);
    const fav = gap >= 0 ? me : o;
    out.replaceChildren(
      h("div", { class: "mu-side" }, logo(ctx.teams.get(teamId), 56), h("b", {}, me.school), h("span", {}, fmtHeight(me.height))),
      h("div", { class: "mu-mid" },
        h("div", { class: "mu-big" }, gap === 0 ? "Dead even" : pm === 0 ? `Lean ${fav.school}` : `${fav.school} by ${Math.abs(pm).toFixed(1)}`),
        h("div", { class: "mu-sub" }, pm === 0
          ? `Rating gap ${fmtPoints(gap)}${site === "neutral" ? "" : ` incl. ${homeField(ctx).toFixed(1)} home field`}: under one touchdown, close to a coin flip.`
          : `Rating gap ${fmtPoints(gap)}${site === "neutral" ? "" : ` incl. ${homeField(ctx).toFixed(1)} home field`}, minus the ${gridironParams(ctx)!.winBonus}-point win credit.`)),
      h("div", { class: "mu-side" }, logo(ctx.teams.get(oppId), 56), h("b", {}, o.school), h("span", {}, fmtHeight(o.height))),
    );
  };
  const sel = h("select", { "aria-label": "Opponent", onchange: (e: Event) => { oppId = Number((e.target as HTMLSelectElement).value); draw(); } },
    ...others.map((t) => h("option", { value: t.id, selected: t.id === oppId }, `#${rankLabel(t.rank, t.tied)} ${t.school}`)));
  const seg = h("div", { class: "seg", role: "group", "aria-label": "Site" });
  const drawSeg = () => seg.replaceChildren(...(([["Home", "home"], ["Neutral", "neutral"], ["Away", "away"]] as [string, Site][]).map(([label, v]) =>
    h("button", { class: site === v ? "on" : "", "aria-pressed": site === v, onclick: () => { site = v; drawSeg(); draw(); } }, label))));
  drawSeg();
  draw();
  return h("section", { class: "panel matchup" },
    h("h2", {}, "Predict a matchup"),
    h("p", { class: "hint" }, "From this week’s ratings only. Not a forecast of injuries, weather or motivation."),
    h("div", { class: "mu-ctl" }, h("div", { class: "sel" }, sel), seg),
    out);
}
