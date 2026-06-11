#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const phase2Doc = path.join(repoRoot, "docs/maintenance/PHASE_2_DEBT_CLOSURE.md");
assert(existsSync(phase2Doc), "PHASE_2_DEBT_CLOSURE.md must exist");

const packageJson = read("package.json");
const maintenanceReadme = read("docs/maintenance/README.md");
const phase2 = read("docs/maintenance/PHASE_2_DEBT_CLOSURE.md");
const gitignore = read(".gitignore");

includes(packageJson, '"format:check": "prettier --check ."', "format:check must remain public");
includes(
  packageJson,
  '"test:phase2-debt-closure": "node tests/phase2-debt-closure-smoke.mjs"',
  "package.json must expose the Phase 2 gate",
);
notIncludes(
  packageJson,
  "npm run hygiene",
  "package.json must not reference removed hygiene script",
);

includes(maintenanceReadme, "Phase 2 Debt Closure", "maintenance README must link Phase 2");
includes(phase2, "Sem validacao externa live", "Phase 2 must keep live external gates blocked");
includes(phase2, "AI_PROVIDER=none", "Phase 2 must keep no-cost AI validation as default");
includes(gitignore, "data/", "data/ must remain ignored");
includes(gitignore, "storage/", "storage/ must remain ignored");

const trackedArtifacts = gitLsFiles(["data", "storage", "**/dist/**", "**/.turbo/**"]);
assert(
  trackedArtifacts.length === 0,
  `generated/local artifacts must not be tracked:\n${trackedArtifacts.join("\n")}`,
);

const docDrift = rg([
  "npm run hygiene|`JWT_SECRET`|`WORKER_CDP_URL`",
  "README.md",
  "docs",
  "AGENTS.md",
  ".claude",
]);
assert(
  docDrift.length === 0,
  `obsolete docs references must be removed or rewritten:\n${docDrift.join("\n")}`,
);

console.log("phase2-debt-closure-smoke|status=ok");

function gitLsFiles(args) {
  const result = spawnSync("git", ["ls-files", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert(result.status === 0, result.stderr || result.stdout);
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function rg(args) {
  const result = spawnSync("rg", ["-n", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status === 1) {
    return [];
  }
  assert(result.status === 0, result.stderr || result.stdout);
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.includes("PHASE_2_DEBT_CLOSURE.md"));
}

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function includes(value, expected, message) {
  assert(value.includes(expected), message);
}

function notIncludes(value, expected, message) {
  assert(!value.includes(expected), message);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
