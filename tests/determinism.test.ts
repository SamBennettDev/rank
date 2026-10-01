import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "../src/engine/csv";
import { buildEdges, listSnapshots } from "../src/engine/graph";
import { parseGames, parseTeams } from "../src/engine/data";
import { computeSeason } from "../src/engine/season";

const dir = join(import.meta.dirname, "../data/seasons/demo");
const read = (f: string) => readFileSync(join(dir, f), "utf8");
const input = { season: "demo", teamsCsv: read("teams.csv"), gamesCsv: read("games.csv"), configJson: read("config.json") };

describe("determinism", () => {
  it("two runs produce identical bytes", async () => {
    const a = await computeSeason(input);
    const b = await computeSeason(input);
    expect(b).toEqual(a);
  });

  it("row order in the CSVs does not matter", async () => {
    const shuffle = (csv: string) => {
      const [header, ...rows] = parseCsv(csv);
      return toCsv(header!, rows.reverse());
    };
    const a = await computeSeason(input);
    const b = await computeSeason({ ...input, gamesCsv: shuffle(input.gamesCsv), teamsCsv: shuffle(input.teamsCsv) });
    // hashes of the input bytes differ by design; everything else must match
    const strip = (s: string) => s.replace(/"(teams|games)Sha256": "[0-9a-f]+",?\n\s*/g, "");
    expect(b.files.map((f) => strip(f.json))).toEqual(a.files.map((f) => strip(f.json)));
  });

  it("the committed rankings match a fresh computation", async () => {
    const fresh = await computeSeason(input);
    for (const f of fresh.files) {
      expect(readFileSync(join(dir, `../../rankings/demo/${f.id}.json`), "utf8")).toBe(f.json);
    }
  });
});

describe("snapshots", () => {
  const teams = parseTeams(input.teamsCsv);
  const games = parseGames(input.gamesCsv);

  it("week N only counts games through week N", () => {
    const specs = listSnapshots(games);
    const early = buildEdges(games, teams, specs[2]!);
    expect(early.edges.every((e) => e.week <= 3)).toBe(true);
    expect(buildEdges(games, teams, specs.at(-1)!).counts.included).toBe(games.length);
  });

  it("drops out-of-scope, incomplete and tied games and counts them", () => {
    const base = games[0]!;
    const extra = [
      { ...base, id: 1, homeId: 1 }, // unknown team
      { ...base, id: 2, completed: false },
      { ...base, id: 3, homePoints: 7, awayPoints: 7 },
    ];
    const { counts, edges } = buildEdges(extra, teams, { id: "week-01", label: "Week 1", throughWeek: 99, includePostseason: true });
    expect(counts).toMatchObject({ inWindow: 3, included: 0, outOfScope: 1, incomplete: 1, tied: 1 });
    expect(edges).toHaveLength(0);
  });
});
