/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from "vite";
import { cpSync, existsSync, readFileSync, statSync } from "node:fs";
import { resolve, extname } from "node:path";

const root = import.meta.dirname;
const dataDir = resolve(root, "data");

const MIME: Record<string, string> = {
  ".json": "application/json",
  ".csv": "text/csv; charset=utf-8",
};

/** Serves ./data at /data in dev and copies it verbatim into dist/data on build,
 *  so the raw CSVs the rankings were computed from are published beside the site. */
function publishData(): Plugin {
  return {
    name: "publish-data",
    configureServer(server) {
      server.middlewares.use("/data", (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");
        const file = resolve(dataDir, "." + rel);
        if (!file.startsWith(dataDir) || !existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader("Content-Type", MIME[extname(file)] ?? "application/octet-stream");
        res.end(readFileSync(file));
      });
    },
    closeBundle() {
      cpSync(dataDir, resolve(root, "dist/data"), { recursive: true });
    },
  };
}

export default defineConfig({
  root: "web",
  publicDir: resolve(root, "public"),
  base: "./",
  build: { outDir: resolve(root, "dist"), emptyOutDir: true, target: "es2022" },
  server: { fs: { allow: [root] } },
  plugins: [publishData()],
  test: { root, include: ["tests/**/*.test.ts"] },
});
