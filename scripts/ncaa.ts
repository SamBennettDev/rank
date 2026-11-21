/**
 * Reading the NCAA stats mirror: the sportsdataverse `ncaa_mfb_*` releases, a scrape of
 * stats.ncaa.org published as one parquet file per season (FBS and FCS, 2013 on).
 * https://github.com/sportsdataverse/sportsdataverse-data/releases
 */
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asyncBufferFromFile, parquetReadObjects } from "hyparquet";
import { compressors } from "hyparquet-compressors";

export type Row = Record<string, unknown>;

const RELEASES =
  "https://github.com/sportsdataverse/sportsdataverse-data/releases/download";
export const CACHE = join(tmpdir(), "rank-ncaa");

/** Downloads (once, or again with REFRESH=1) and reads one mirror table for a season. */
export async function mirror(
  table: string,
  year: number | string,
  columns?: string[],
): Promise<Row[]> {
  mkdirSync(CACHE, { recursive: true });
  const name = `${table}_${year}.parquet`;
  const file = join(CACHE, name);
  if (!existsSync(file) || process.env.REFRESH) {
    const url = `${RELEASES}/${table}/${name}`;
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(url);
      if (res.ok) {
        const part = `${file}.${process.pid}.part`;
        writeFileSync(part, Buffer.from(await res.arrayBuffer()));
        renameSync(part, file);
        break;
      }
      if (res.status === 404) throw new Error(`no ${table} for ${year}`);
      if (attempt >= 4) throw new Error(`${res.status} downloading ${url}`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  return (await parquetReadObjects({
    file: await asyncBufferFromFile(file),
    compressors,
    ...(columns ? { columns } : {}),
  })) as Row[];
}

export const text = (v: unknown) =>
  v === null || v === undefined ? "" : String(v).trim();
export const num = (v: unknown) =>
  v === null || v === undefined || v === "" ? NaN : Number(v);
export const flag = (v: unknown) => v === true || v === 1 || v === "TRUE";

/**
 * A stats.ncaa.org date ("11/21/2026", "11/21/2026 02:00 PM" or "… TBA") as an ISO
 * instant. Times are the stat crew's local clock without a zone; they are read as US
 * Eastern (daylight time from the second Sunday of March to the first Sunday of
 * November), and a missing or TBA time as noon.
 */
export function kickoffIso(value: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*([AP]M))?/.exec(
    value.trim(),
  );
  if (!m) return null;
  const [, mo, d, y] = m;
  let hour = 12,
    minute = 0;
  if (m[4]) {
    hour = (Number(m[4]) % 12) + (m[6] === "PM" ? 12 : 0);
    minute = Number(m[5]);
  }
  const year = Number(y),
    month = Number(mo),
    day = Number(d);
  const nthSunday = (mon: number, n: number) => {
    const first = new Date(Date.UTC(year, mon - 1, 1)).getUTCDay();
    return 1 + ((7 - first) % 7) + 7 * (n - 1);
  };
  const key = month * 100 + day;
  const dst = key >= 300 + nthSunday(3, 2) && key < 1100 + nthSunday(11, 1);
  const utc = Date.UTC(year, month - 1, day, hour + (dst ? 4 : 5), minute);
  return new Date(utc).toISOString();
}

/** The local calendar date (YYYY-MM-DD) of a stats.ncaa.org date string. */
export function localDate(value: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(value.trim());
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
}

const dayMs = 86_400_000;
const utcDay = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/** Labor Day (first Monday of September) of a season, as YYYY-MM-DD. */
export function laborDay(year: number) {
  const first = new Date(Date.UTC(year, 8, 1)).getUTCDay();
  const day = 1 + ((8 - first) % 7);
  return `${year}-09-${String(day).padStart(2, "0")}`;
}

/**
 * Week label for a game played on a local date: week 1 runs through Labor Day
 * (opening-weekend and earlier games included), then each week runs Tuesday to Monday.
 */
export function weekOf(date: string, year: number) {
  const days = Math.round((utcDay(date) - utcDay(laborDay(year))) / dayMs);
  return 1 + Math.max(0, Math.ceil(days / 7));
}

/**
 * Bowls, the playoffs and later games: from the Tuesday after the second Saturday of
 * December. (Earlier FCS playoff rounds keep regular-season week labels.)
 */
export function isPostseason(date: string, year: number) {
  const first = new Date(Date.UTC(year, 11, 1)).getUTCDay();
  const secondSaturday = 1 + ((6 - first + 7) % 7) + 7;
  return utcDay(date) > Date.UTC(year, 11, secondSaturday + 2);
}
