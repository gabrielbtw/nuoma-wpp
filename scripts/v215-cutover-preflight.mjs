#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const result = spawnSync(process.execPath, ["./node_modules/tsx/dist/cli.mjs", "apps/migration/src/index.ts", "preflight"], {
  cwd: repoRoot,
  env: process.env,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
