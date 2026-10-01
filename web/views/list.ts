import { h } from "../dom";
import { type Ctx, controls, conferenceColors, demoBanner, fmtHeight, href, rankLabel } from "../ctx";

export function listView(ctx: Ctx): HTMLElement {
  const colors = conferenceColors(ctx.ranking);
  let worstFirst = false;
  let query = "";
  let conference = "";

  const tbody = h("tbody");
  const count = h("span", { class: "muted" });

  const render = () => {
    const ranked = ctx.ranking.teams.filter((t) => t.rank !== null);
    const unranked = ctx.ranking.teams.filter((t) => t.rank === null);
    const ordered = [...(worstFirst ? ranked.reverse() : ranked), ...unranked].filter(
      (t) => (!conference || t.conference === conference) && t.school.toLowerCase().includes(query),
    );
    tbody.replaceChildren(
      ...ordered.map((t) =>
        h(
          "tr",
          {},
          h("td", { class: "rank" }, rankLabel(t.rank, t.tied)),
          h("td", {}, h("span", { class: "dot", style: `background:${colors.get(t.conference)}` }), h("a", { href: href(ctx.entry.season, ctx.snapId, "team", t.id) }, t.school)),
          h("td", { class: "hide-sm muted" }, t.conference),
          h("td", { class: "num" }, t.rank === null ? "0-0" : `${t.wins}-${t.losses}`),
          h("td", { class: "num" }, fmtHeight(t.height)),
          h("td", { class: "num hide-sm" }, t.change === null || t.change === 0 ? h("span", { class: "muted" }, "–") : h("span", { class: t.change > 0 ? "up" : "down" }, `${t.change > 0 ? "▲" : "▼"} ${Math.abs(t.change)}`)),
        ),
      ),
    );
    count.textContent = `${ordered.length} teams`;
  };

  const order = h(
    "div",
    { class: "seg", role: "group", "aria-label": "Order" },
    ...[["Best first", false], ["Worst first", true]].map(([label, worst]) => {
      const b = h("button", { class: worst === worstFirst ? "on" : "", onclick: () => { worstFirst = worst as boolean; order.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); render(); } }, label as string);
      return b;
    }),
  );
  const search = h("input", { type: "search", placeholder: "Search teams", "aria-label": "Search teams", oninput: (e: Event) => { query = (e.target as HTMLInputElement).value.trim().toLowerCase(); render(); } });
  const confSel = h("select", { "aria-label": "Conference", onchange: (e: Event) => { conference = (e.target as HTMLSelectElement).value; render(); } },
    h("option", { value: "" }, "All conferences"),
    ...[...colors.keys()].map((c) => h("option", { value: c }, c)));

  render();
  const { counts } = ctx.ranking.manifest;
  return h(
    "div",
    {},
    demoBanner(ctx),
    h("h1", {}, "Every team, ranked"),
    h("p", { class: "sub" }, `${ctx.entry.label} · ${ctx.ranking.snapshot.label} · ${counts.included} games counted. Position is the team's height in the game graph. `, h("a", { href: href(ctx.entry.season, ctx.snapId, "about") }, "How is this calculated?")),
    controls(ctx, "list", [order, search, confSel, h("span", { class: "spacer" }), count]),
    h("div", { class: "table-wrap" },
      h("table", {},
        h("thead", {}, h("tr", {}, h("th", {}, "Rank"), h("th", {}, "Team"), h("th", { class: "hide-sm" }, "Conference"), h("th", { class: "num" }, "Record"), h("th", { class: "num" }, "Height"), h("th", { class: "num hide-sm" }, "Change"))),
        tbody)),
  );
}
