import { buildEdges, listSnapshots } from "../../src/engine/graph";
import { h } from "../dom";
import { type Ctx, demoBanner, fmtHeight, href, rankLabel } from "../ctx";

export function teamView(ctx: Ctx, teamId: number): HTMLElement {
  const team = ctx.ranking.teams.find((t) => t.id === teamId);
  if (!team) return h("p", { class: "pad" }, "Team not found in this snapshot.");
  const byId = new Map(ctx.ranking.teams.map((t) => [t.id, t]));
  const spec = listSnapshots(ctx.games).find((s) => s.id === ctx.snapId)!;
  const mine = buildEdges(ctx.games, ctx.ranking.teams, spec).edges
    .filter((e) => e.winner === teamId || e.loser === teamId)
    .sort((a, b) => (a.seasonType === b.seasonType ? 0 : a.seasonType === "regular" ? -1 : 1) || a.week - b.week || a.gameId - b.gameId);

  const rows = mine.map((e) => {
    const won = e.winner === teamId;
    const opp = byId.get(won ? e.loser : e.winner)!;
    const gap = byId.get(e.winner)!.height! - byId.get(e.loser)!.height!;
    const upset = gap < 0;
    return h(
      "tr",
      {},
      h("td", {}, e.seasonType === "postseason" ? "Post" : `Wk ${e.week}`),
      h("td", {}, h("a", { href: href(ctx.entry.season, ctx.snapId, "team", opp.id) }, opp.school)),
      h("td", { class: won ? "up" : "down" }, `${won ? "W" : "L"} ${won ? e.winnerPoints : e.loserPoints}–${won ? e.loserPoints : e.winnerPoints}`),
      h("td", { class: "num" }, rankLabel(opp.rank, opp.tied)),
      h("td", { class: "num" }, fmtHeight(opp.height)),
      h("td", { class: "num" }, (gap > 0 ? "+" : "") + gap.toFixed(3)),
      h("td", { class: "num" }, (gap - 1 > 0 ? "+" : "") + (gap - 1).toFixed(3)),
      h("td", {}, upset ? h("span", { style: "color:var(--upset)" }, "upset") : ""),
    );
  });

  const card = (label: string, value: string) => h("div", { class: "card" }, h("b", {}, value), h("span", {}, label));
  return h(
    "div",
    {},
    demoBanner(ctx),
    h("p", {}, h("a", { href: href(ctx.entry.season, ctx.snapId, "list") }, "← All teams")),
    h("h1", {}, team.school),
    h("p", { class: "sub" }, `${team.conference} · ${team.classification.toUpperCase()} · ${ctx.entry.label}, ${ctx.ranking.snapshot.label}`),
    h("div", { class: "cards" },
      card("Rank", rankLabel(team.rank, team.tied)),
      card("Height", fmtHeight(team.height)),
      card("Record", `${team.wins}-${team.losses}`),
      card("Since last week", team.change === null ? "—" : team.change === 0 ? "0" : `${team.change > 0 ? "▲" : "▼"} ${Math.abs(team.change)}`)),
    h("h2", {}, "Why this team is here"),
    h("p", { class: "prose" }, "Each game is a spring that pulls the winner one unit above the loser. This team's height is where all of its springs, and its opponents' springs, balance out. ",
      "Gap is winner height minus loser height; tension is gap minus 1 (0 means the result is fully explained by the final heights). A negative gap is an upset: the winner finished below the loser."),
    mine.length === 0
      ? h("p", { class: "muted" }, "No counted games yet.")
      : h("div", { class: "table-wrap" }, h("table", {},
          h("thead", {}, h("tr", {}, ...["Week", "Opponent", "Result"].map((x) => h("th", {}, x)), ...["Opp. rank", "Opp. height", "Gap", "Tension"].map((x) => h("th", { class: "num" }, x)), h("th", {}, ""))),
          h("tbody", {}, ...rows))),
  );
}
