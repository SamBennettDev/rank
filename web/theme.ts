import type { Ctx } from "./ctx";
import { brandPalette } from "./team";

/** The current FBS leader sets the brand, independently of table filters. */
export function applyLeaderTheme(ctx: Ctx) {
  const leader = ctx.ranked.find((t) => t.rank === 1);
  const accent = brandPalette(
    leader ? ctx.teams.get(leader.id)?.color : "#d98a00",
  );
  const root = document.documentElement;
  root.style.setProperty("--brand-l", accent.light);
  root.style.setProperty("--brand-d", accent.dark);
  root.style.setProperty("--brand-ink-l", accent.lightInk);
  root.style.setProperty("--brand-ink-d", accent.darkInk);
  root.dataset.leaderTeam = leader?.school ?? "";
  const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (favicon)
    favicon.href = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#0b0d12"/><g fill="${accent.dark}"><rect x="7" y="19" width="5" height="7" rx="1.5" opacity=".55"/><rect x="13.5" y="12" width="5" height="14" rx="1.5" opacity=".8"/><rect x="20" y="6" width="5" height="20" rx="1.5"/></g></svg>`)}`;
  const brand = document.querySelector(".brand");
  if (leader) brand?.setAttribute("title", `Current #1: ${leader.school}`);
  else brand?.removeAttribute("title");
}
