import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { DATA_DIR, expectedOutputs } from "./lib";

const outputs = await expectedOutputs();
let written = 0;
for (const [rel, content] of outputs) {
  const file = join(DATA_DIR, rel);
  if (existsSync(file) && readFileSync(file, "utf8") === content) continue;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  written++;
}

// Remove ranking files that no longer correspond to any snapshot.
const rankingsDir = join(DATA_DIR, "rankings");
let removed = 0;
const walk = (dir: string) => {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (!outputs.has(relative(DATA_DIR, p).split("\\").join("/"))) {
      rmSync(p);
      removed++;
    }
  }
};
walk(rankingsDir);

console.log(`compute: ${outputs.size} files up to date (${written} written, ${removed} removed)`);
