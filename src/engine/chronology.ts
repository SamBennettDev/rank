import type { Game } from "./types";

export const RESULT_LAG_MS = 6 * 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MONDAY_NOON = Date.UTC(1970, 0, 5, 12);
export const calendarWeekStart = (time: number) =>
  MONDAY_NOON + Math.floor((time - MONDAY_NOON) / WEEK_MS) * WEEK_MS;
export const calendarWeekEnd = (time: number) =>
  calendarWeekStart(time) + WEEK_MS;

/** A conservative score-availability assumption, since the source has no result timestamps. */
export function kickoff(g: Game): number {
  const t = Date.parse(g.startDate);
  if (!Number.isFinite(t))
    throw new Error(`game ${g.id} has an invalid start_date`);
  return t;
}

/** Calendar forecasts include earlier playoff rounds and never later regular-season results. */
export function forecastBatches(games: readonly Game[], startWeek = 4) {
  const completed = games.filter(
    (g) =>
      g.completed &&
      g.homePoints !== null &&
      g.awayPoints !== null &&
      g.homePoints !== g.awayPoints,
  );
  const dated = completed.map((g) => ({ g, time: kickoff(g) }));
  const cutoffs = [
    ...new Set(dated.map(({ time }) => calendarWeekStart(time))),
  ].sort((a, b) => a - b);
  return cutoffs
    .map((cutoff) => ({
      cutoff: new Date(cutoff).toISOString(),
      train: dated
        .filter(({ time }) => time + RESULT_LAG_MS <= cutoff)
        .map(({ g }) => g),
      test: dated
        .filter(
          ({ g, time }) =>
            time >= cutoff &&
            time < cutoff + WEEK_MS &&
            (g.seasonType === "postseason" || g.week >= startWeek),
        )
        .map(({ g }) => g),
    }))
    .filter((b) => b.test.length > 0);
}
