/**
 * Reading sportsdataverse release files (https://github.com/sportsdataverse/sportsdataverse-data/releases):
 * the ESPN-based college football releases the site is built from (scripts/fetch-espn.ts), and the
 * NCAA stats mirror (`ncaa_mfb_*`, a stats.ncaa.org scrape) whose history fits the expected-points model.
 */
import { existsSync, mkdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asyncBufferFromFile, parquetReadObjects } from "hyparquet";
import { compressors } from "hyparquet-compressors";

export type Row = Record<string, unknown>;

const RELEASES =
  "https://github.com/sportsdataverse/sportsdataverse-data/releases/download";
export const CACHE = join(tmpdir(), "rank-ncaa");

/**
 * Downloads and reads one NCAA-mirror table for a season. Used only for fixed past seasons (the
 * expected-points history), so a cached copy is kept until REFRESH=1.
 */
export const mirror = (table: string, year: number | string, columns?: string[]) =>
  release(table, `${table}_${year}.parquet`, columns, Infinity);

/** How long a downloaded current-season file is reused before it is fetched again. */
export const FRESH_MS = 30 * 60 * 1000;

/**
 * Downloads and reads one release file. A cached copy is reused while it is younger than
 * `maxAgeMs` (30 minutes by default, so a rerun picks up a newly published file); REFRESH=1
 * always downloads again.
 */
export async function release(
  tag: string,
  name: string,
  columns?: string[],
  maxAgeMs = FRESH_MS,
): Promise<Row[]> {
  mkdirSync(CACHE, { recursive: true });
  const file = join(CACHE, name);
  const table = tag;
  const year = name;
  const stale = !existsSync(file) || Date.now() - statSync(file).mtimeMs > maxAgeMs;
  if (stale || process.env.REFRESH) {
    const url = `${RELEASES}/${tag}/${name}`;
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
