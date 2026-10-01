import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { DATA_DIR, expectedOutputs } from "./lib";

/** Recomputes every published ranking from the raw CSVs and fails on any byte difference. */
const outputs = await expectedOutputs();
const problems: string[] = [];

for (const [rel, expected] of outputs) {
  const file = join(DATA_DIR, rel);
  if (!existsSync(file)) problems.push(`missing:   ${rel}`);
  else if (readFileSync(file, "utf8") !== expected) problems.push(`differs:   ${rel}`);
}

const walk = (dir: string) => {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (!outputs.has(relative(DATA_DIR, p).split("\\").join("/"))) problems.push(`unexpected: ${relative(DATA_DIR, p)}`);
  }
};
walk(join(DATA_DIR, "rankings"));

if (problems.length > 0) {
  console.error(problems.join("\n"));
  console.error(`\nverify FAILED: ${problems.length} problem(s). Run \`npm run compute\` and commit the result.`);
  process.exit(1);
}
console.log(`verify: OK, ${outputs.size} files reproduce byte-for-byte from the raw data`);
