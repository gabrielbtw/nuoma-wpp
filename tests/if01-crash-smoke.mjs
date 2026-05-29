#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const args = [
  "run",
  "test",
  "--workspace",
  "@nuoma/worker",
  "--",
  "src/job-loop.test.ts",
  "-t",
  "does not re-dispatch when a job retries after send but before completion",
];

const result = spawnSync("npm", args, {
  cwd: new URL("..", import.meta.url),
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_ENV: "test",
  },
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
