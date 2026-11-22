import { type Ctx, boardHref, href, teamHref } from "../ctx";
import { h, svg } from "../dom";
import { arrowLeft } from "../icons";
import {
  GROUP_NAME,
  GROUP_ONE,
  type Group,
  isDefense,
  loadPlayers,
  loadTeamPlayers,
  type PlayersFile,
  RATING_UNIT,
  STAT_COLS,
  type TeamPlayer,
  type TeamPlayersFile,
  fmtNum,
  fmtSigned,
  stat,
} from "../players";
import { logo, shortConf, teamVars } from "../team";

export function playerView(ctx: Ctx, teamId: number, playerId: number): HTMLElement {
  const holder = h("div", { class: "loading pad" }, h("span"), h("span"), h("span"));
  void Promise.all([loadTeamPlayers(ctx.entry.season, teamId), loadPlayers(ctx.entry.season)])
    .then(([tf, pf]) => {
      const p = tf.players.find((x) => x.id === playerId);
      holder.replaceWith(
        p
          ? page(ctx, tf, pf, p)
          : h("div", { class: "empty" }, h("h2", {}, "Player not found"), h("a", { class: "btn", href: teamHref(ctx, teamId) }, "Back to team")),
      );
    })
    .catch((e: unknown) => holder.replaceWith(h("div", { class: "empty" }, h("h2", {}, "Player ratings unavailable"), h("p", { class: "muted" }, String(e)))));
  return h("div", {}, holder);
}

const gameInfo = (ctx: Ctx, gameId: number, teamId: number) => {
  const g = ctx.games.find((x) => x.id === gameId);
  if (!g) return { label: "", score: "", won: null as boolean | null, where: "vs" };
  const home = g.homeId === teamId;
  const mine = home ? g.homePoints : g.awayPoints,
    theirs = home ? g.awayPoints : g.homePoints;
  return {
    label: g.seasonType === "postseason" ? "Bowl" : `Wk ${g.week}`,
    score: mine === null || theirs === null ? "" : `${mine}–${theirs}`,
    won: mine === null || theirs === null ? null : mine > theirs,
    where: g.neutralSite ? "vs" : home ? "vs" : "at",
  };
};

function page(ctx: Ctx, tf: TeamPlayersFile, pf: PlayersFile, p: TeamPlayer): HTMLElement {
  // Contest ids are not in date order: show games by kickoff.
  const kickoff = new Map(ctx.games.map((g) => [g.id, g.startDate]));
  p = { ...p, lines: [...p.lines].sort((a, b) => (kickoff.get(a.gameId) ?? "").localeCompare(kickoff.get(b.gameId) ?? "") || a.gameId - b.gameId) };
  const t = ctx.teams.get(p.teamId);
  const group = p.group;
  const cols = tf.groupStats[group];
  const s = (n: string) => stat(cols, p.totals, n);
  const of = pf.counts[group];
  const pctile = of > 1 ? Math.round((100 * (of - p.rank)) / (of - 1)) : 100;
  const tile = (value: Node | string, label: string, extra?: string) =>
    h("div", { class: "tstat" }, h("b", {}, value), h("span", {}, label), extra ? h("small", {}, extra) : "");
  const bio = [
    p.jersey ? `#${p.jersey}` : "",
    p.position || group,
    p.year,
    p.height ? p.height.replace("-", "′") + "″" : "",
    p.weight ? `${p.weight} lb` : "",
  ].filter(Boolean);

  const hero = h(
    "section",
    { class: "thero phero tv", style: teamVars(t?.color) },
    logo(t, 520, { className: "wm" }),
    h(
      "div",
      { class: "thero-inner" },
      h("a", { class: "back", href: teamHref(ctx, p.teamId) }, arrowLeft(), t?.school ?? "Team"),
      h(
        "div",
        { class: "tid" },
        h("div", { class: "jersey" }, p.jersey || group),
        h(
          "div",
          {},
          h("h1", { title: p.name }, p.name),
          h("div", { class: "team-hero-meta" }, bio.join(" · ")),
          h(
            "div",
            { class: "team-hero-meta faint" },
            [p.hometown, p.highSchool].filter(Boolean).join(" · "),
          ),
        ),
      ),
      h(
        "div",
        { class: "tstats" },
        tile(`#${p.rank}`, `${group} rank`, `of ${of.toLocaleString()} · FBS + FCS`),
        tile(fmtSigned(p.valuePerGame), "Points / game", "added over average"),
        tile(fmtSigned(p.rating, 3), "Rating", RATING_UNIT[group]),
        tile(`${p.games}`, "Games", "with a counted play"),
      ),
      h("div", { class: "pctile", title: `Better than ${pctile}% of rated ${GROUP_NAME[group].toLowerCase()}` }, h("i", { style: `width:${pctile}%` }), h("span", {}, `${pctile}th percentile`)),
    ),
  );

  const line = h(
    "div",
    { class: "panel sline" },
    h("h2", {}, "Season"),
    h("div", { class: "chipline" }, ...STAT_COLS[group].map((c) => h("div", { class: "schip", title: c.title }, h("b", {}, c.value(s)), h("span", {}, c.label)))),
  );

  return h(
    "div",
    {},
    hero,
    h(
      "div",
      { class: "tbody" },
      line,
      steps(ctx, tf, pf, p),
      gameLog(ctx, tf, p),
      h(
        "p",
        { class: "hint foot-note" },
        h("a", { href: boardHref(ctx, group) }, `See all ${GROUP_NAME[group].toLowerCase()} →`),
        " · ",
        h("a", { href: href(ctx.entry.season, ctx.snapId, "about") }, "How expected points work →"),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
function steps(ctx: Ctx, tf: TeamPlayersFile, pf: PlayersFile, p: TeamPlayer): HTMLElement {
  const group = p.group;
  const cols = tf.groupStats[group];
  const s = (n: string) => stat(cols, p.totals, n);
  const step = (n: number, title: string, ...body: (Node | string)[]) =>
    h("li", { class: "cstep" }, h("div", { class: "cstep-n" }, String(n)), h("div", { class: "cstep-b" }, h("h3", {}, title), ...body));
  const eq = (...parts: (Node | string)[]) => h("div", { class: "eq" }, ...parts);
  const term = (v: string, label: string, cls = "") => h("span", { class: `term ${cls}` }, h("b", {}, v), h("small", {}, label));
  const op = (x: string) => h("span", { class: "eqop" }, x);
  const shrink = p.shrink;
  const of = pf.counts[group];

  let first: HTMLElement, second: HTMLElement, third: HTMLElement;
  if (isDefense(group)) {
    const c = pf.settings.credit;
    first = step(
      1,
      "Credit every play that saved points",
      h("p", {}, "Each sack, interception and pass breakup credited to him in the play-by-play is worth the expected points it takes away in our model, compared with an average play of that kind. Tackles are shown but not counted: box scores exist only for games with an FBS team, so counting them would not treat FCS players alike."),
      eq(
        term(fmtNum(s("sacks")), `sacks × ${c.sack}`),
        op("+"),
        term(fmtNum(s("def_int")), `INT × ${c.interception}`),
        op("+"),
        term(fmtNum(s("pbu")), `PBU × ${c.breakup}`),

      ),
    );
    const credits = p.lines.reduce((a, l) => a + l.credits, 0);
    second = step(
      2,
      "Weight each game by the opponent",
      h("p", {}, "A game's credits are multiplied by 0.5 + the opponent's quality ÷ 100: about 1.5 against the best teams, about 0.5 against the weakest. That puts FBS and FCS defenders on one scale."),
      adjustTable(ctx, tf, p, "defense"),
      eq(term(credits.toFixed(2), "credits"), op("→"), term(p.over.toFixed(2), "after opponent weights", "hl")),
    );
    third = step(
      3,
      "Pull toward average, then rank",
      h("p", {}, `Divide by games played plus ${shrink} average games, so a few big games don't outrank a full season.`),
      eq(term(p.over.toFixed(2), "adjusted credits"), op("÷"), term(`${p.games} + ${shrink}`, "games + pull"), op("="), term(fmtSigned(p.rating, 3), "per game", "hl")),
      h("p", { class: "rank-line" }, `#${p.rank} of ${of.toLocaleString()} ${GROUP_NAME[group].toLowerCase()}.`),
    );
  } else if (group === "K") {
    first = step(
      1,
      "Judge every kick against its distance",
      h("p", {}, "Our field-goal model gives each try a make chance from its distance. A make is worth 3 × (1 − chance), a miss −3 × chance."),
      eq(term(`${fmtNum(s("fgm"))}/${fmtNum(s("fga"))}`, "made / tried"), op("→"), term(fmtSigned(s("fg_value")), "points over expected", "hl")),
    );
    second = step(2, "Game by game", adjustTable(ctx, tf, p, "kick"));
    third = step(
      3,
      "Pull toward average, then rank",
      eq(term(fmtSigned(p.over), "points over expected"), op("÷"), term(`${fmtNum(p.plays)} + ${shrink}`, "tries + pull"), op("="), term(fmtSigned(p.rating, 3), "per try", "hl")),
      eq(term(fmtSigned(p.rating, 3), "per try"), op("×"), term(fmtNum(p.plays), "tries"), op("÷"), term(String(p.games), "games"), op("="), term(fmtSigned(p.valuePerGame), "points / game", "hl")),
      h("p", { class: "rank-line" }, `#${p.rank} of ${of.toLocaleString()} kickers.`),
    );
  } else {
    const passPlays = group === "QB" ? s("dropbacks") : s("targets");
    const passEpa = group === "QB" ? s("pass_epa") : s("target_epa");
    const passLabel = group === "QB" ? "dropbacks" : "targets";
    first = step(
      1,
      "Add up the expected points of his plays",
      h("p", {}, `Every snap starts with an expected-points value from down, distance and field position, and ends with another. The difference is the play's EPA (expected points added). Garbage time is left out.`),
      eq(
        term(fmtNum(passPlays), passLabel),
        op("+"),
        term(fmtNum(s("rushes")), "rushes"),
        op("="),
        term(fmtNum(p.plays), "plays"),
      ),
      eq(
        term(fmtSigned(passEpa), `EPA on ${passLabel}`),
        op("+"),
        term(fmtSigned(s("rush_epa")), "EPA on rushes"),
        op("="),
        term(fmtSigned(p.epa), `EPA · ${fmtSigned(p.epa / Math.max(1, p.plays), 3)} per play`, "hl"),
      ),
    );
    second = step(
      2,
      "Compare with an average player against the same defenses",
      h("p", {}, `An average offense gains ${fmtSigned(tf.passMu, 3)} EPA per pass and ${fmtSigned(tf.rushMu, 3)} per rush, minus how good each defense is against that play type. That is what an average ${GROUP_ONE[group]} would have added on his plays.`),
      adjustTable(ctx, tf, p, "offense"),
      eq(term(fmtSigned(p.epa), "his EPA"), op("−"), term(fmtSigned(p.expected), "average vs. these defenses"), op("="), term(fmtSigned(p.over), "EPA over expected", "hl")),
    );
    third = step(
      3,
      "Pull toward average, then rank",
      h("p", {}, `Divide by his plays plus ${shrink} average plays, so a hot stretch on a few snaps doesn't top the board. Then turn it back into points per game.`),
      eq(term(fmtSigned(p.over), "over expected"), op("÷"), term(`${fmtNum(p.plays)} + ${shrink}`, "plays + pull"), op("="), term(fmtSigned(p.rating, 3), RATING_UNIT[group], "hl")),
      eq(term(fmtSigned(p.rating, 3), "rating"), op("×"), term(fmtNum(p.plays), "plays"), op("÷"), term(String(p.games), "games"), op("="), term(fmtSigned(p.valuePerGame), "points / game", "hl")),
      h("p", { class: "rank-line" }, `#${p.rank} of ${of.toLocaleString()} ${GROUP_NAME[group].toLowerCase()} in FBS and FCS.`),
    );
  }
  return h(
    "section",
    { class: "panel calc" },
    h("div", { class: "section-heading" }, h("h2", {}, "How his rating is calculated"), h("span", { class: "scope-label" }, "Through the latest results")),
    h("ol", { class: "csteps" }, first, second, third),
  );
}

function adjustTable(ctx: Ctx, tf: TeamPlayersFile, p: TeamPlayer, kind: "offense" | "defense" | "kick"): HTMLElement {
  const opp = new Map(tf.opponents.map((o) => [o.id, o]));
  const maxAbs = Math.max(0.5, ...p.lines.map((l) => Math.abs(kind === "offense" ? l.epa - l.expected : l.epa)));
  const head =
    kind === "offense"
      ? ["When", "Opponent", "Plays", "EPA", "Avg vs D", "Over"]
      : kind === "defense"
        ? ["When", "Opponent", "Quality", "Credits", "× Weight", "Adjusted"]
        : ["When", "Opponent", "FG", "", "", "Pts over exp"];
  const rows = p.lines.map((l) => {
    const o = ctx.byId.get(l.opponentId);
    const info = gameInfo(ctx, l.gameId, p.teamId);
    const value = kind === "offense" ? l.epa - l.expected : l.epa;
    const w = (Math.abs(value) / maxAbs) * 50;
    const cells =
      kind === "offense"
        ? [fmtNum(l.plays), fmtSigned(l.epa), fmtSigned(l.expected)]
        : kind === "defense"
          ? [(opp.get(l.opponentId)?.quality ?? 0).toFixed(1), l.credits.toFixed(2), `× ${l.factor.toFixed(2)}`]
          : [`${fmtNum(stat(tf.groupStats.K, l.stats, "fgm"))}/${fmtNum(stat(tf.groupStats.K, l.stats, "fga"))}`, "", ""];
    return h(
      "div",
      { class: "arow" },
      h("span", { class: "wk" }, info.label),
      h(
        "span",
        { class: "aop" },
        logo(ctx.teams.get(l.opponentId), 22, { lazy: true }),
        h("span", {}, `${info.where} ${o?.school ?? "Opponent"}`),
        info.score ? h("span", { class: `res ${info.won ? "w" : "l"}` }, `${info.won ? "W" : "L"} ${info.score}`) : "",
      ),
      ...cells.map((c) => h("span", { class: "n" }, c)),
      h(
        "span",
        { class: "n over" },
        h("i", { class: `abar ${value < 0 ? "neg" : ""}`, style: `${value < 0 ? `right:50%` : `left:50%`};width:${w.toFixed(1)}%` }),
        h("b", {}, fmtSigned(value)),
      ),
    );
  });
  return h("div", { class: `atable k-${kind}` }, h("div", { class: "arow ahead" }, ...head.map((x, i) => h("span", { class: i >= 2 ? "n" : "" }, x))), ...rows);
}

// ---------------------------------------------------------------------------
function gameLog(ctx: Ctx, tf: TeamPlayersFile, p: TeamPlayer): HTMLElement {
  const group: Group = p.group;
  const cols = tf.groupStats[group];
  const statCols = STAT_COLS[group];
  const chart = valueChart(ctx, p);
  return h(
    "section",
    { class: "panel glog" },
    h("div", { class: "section-heading" }, h("h2", {}, "Game log")),
    chart,
    h(
      "div",
      { class: "gtable", style: `--cols:${statCols.length}` },
      h("div", { class: "grow ghead" }, h("span", {}, "When"), h("span", {}, "Opponent"), ...statCols.map((c) => h("span", { class: "n", title: c.title }, c.label))),
      ...p.lines.map((l) => {
        const info = gameInfo(ctx, l.gameId, p.teamId);
        const s = (n: string) => stat(cols, l.stats, n);
        const o = ctx.byId.get(l.opponentId);
        return h(
          "a",
          { class: "grow", href: ctx.ranking.teams.some((t) => t.id === l.opponentId) ? teamHref(ctx, l.opponentId) : undefined },
          h("span", { class: "wk" }, info.label),
          h("span", { class: "aop" }, logo(ctx.teams.get(l.opponentId), 22, { lazy: true }), h("span", {}, `${info.where} ${o?.school ?? ""}`), info.score ? h("span", { class: `res ${info.won ? "w" : "l"}` }, `${info.won ? "W" : "L"} ${info.score}`) : ""),
          ...statCols.map((c) => h("span", { class: "n" }, c.value(s))),
        );
      }),
    ),
  );
}

/** Bars of each game's value over expected (offense, kickers) or adjusted credits (defense). */
function valueChart(ctx: Ctx, p: TeamPlayer): SVGSVGElement {
  const defense = isDefense(p.group);
  const vals = p.lines.map((l) => (defense || p.group === "K" ? l.epa : l.epa - l.expected));
  const W = 720,
    H = 180,
    pad = { l: 36, r: 12, t: 16, b: 34 };
  const lo = Math.min(0, ...vals),
    hi = Math.max(0.5, ...vals);
  const y = (v: number) => pad.t + ((hi - v) / (hi - lo || 1)) * (H - pad.t - pad.b);
  const bw = Math.min(46, (W - pad.l - pad.r) / Math.max(1, vals.length) - 8);
  const x = (i: number) => pad.l + ((i + 0.5) * (W - pad.l - pad.r)) / Math.max(1, vals.length);
  const root = svg("svg", { class: "vchart", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": defense ? "Adjusted credits by game" : "Expected points over average by game" });
  root.appendChild(svg("line", { class: "zero", x1: pad.l, x2: W - pad.r, y1: y(0), y2: y(0) }));
  const tick = svg("text", { class: "gl", x: pad.l - 6, y: y(0) + 4, "text-anchor": "end" });
  tick.textContent = "0";
  root.appendChild(tick);
  vals.forEach((v, i) => {
    const l = p.lines[i]!;
    const o = ctx.byId.get(l.opponentId);
    const r = svg("rect", { class: `vb ${v < 0 ? "neg" : ""}`, x: x(i) - bw / 2, width: bw, y: Math.min(y(v), y(0)), height: Math.max(1.5, Math.abs(y(v) - y(0))), rx: 4 });
    const tt = svg("title", {});
    tt.textContent = `${o?.school ?? ""}: ${fmtSigned(v)}`;
    r.appendChild(tt);
    root.appendChild(r);
    const lab = svg("text", { class: "gl", x: x(i), y: H - 16, "text-anchor": "middle" });
    lab.textContent = (o?.abbreviation || o?.school || "").slice(0, 5);
    root.appendChild(lab);
    const val = svg("text", { class: "pv", x: x(i), y: v >= 0 ? y(v) - 5 : y(v) + 13, "text-anchor": "middle" });
    val.textContent = fmtSigned(v, 1);
    root.appendChild(val);
  });
  return root;
}

export { shortConf };
