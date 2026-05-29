#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const root = path.resolve(String(args.root ?? defaultRoot));
const apply = Boolean(args.apply);
const json = Boolean(args.json);
const tmpDays = positiveNumber(args["tmp-days"], 7);
const backupDays = positiveNumber(args["backup-days"], 30);
const now = Date.now();

const policy = {
  tmpDays,
  backupDays,
  apply,
  confirmRequired: "ARTIFACT_RETENTION_CONFIRM=SIM",
  deleteRules: ["data/tmp files older than tmpDays", "data/backups files older than backupDays"],
  reportOnlyRules: [
    "output/",
    ".playwright-mcp/",
    ".turbo/",
    "apps/*/dist/",
    "tracked files under data/",
  ],
  preserveRules: [
    "data/chromium-profile/whatsapp/**",
    "data/nuoma-v2.db*",
    "M30.3/M38/M39/M40 evidence directories under data/",
    "all git-tracked paths unless removed explicitly by a human",
  ],
};

const trackedPaths = new Set(gitTrackedPaths(root));
const report = {
  mode: apply ? "apply" : "audit",
  root,
  generatedAtUtc: new Date().toISOString(),
  policy,
  trackedDataFiles: [...trackedPaths].filter((entry) => entry.startsWith("data/")).sort(),
  candidates: [],
  reportOnly: [],
  deleted: [],
  skipped: [],
};

await collectRetentionReport();

if (apply) {
  if (process.env.ARTIFACT_RETENTION_CONFIRM !== "SIM") {
    report.skipped.push({
      path: ".",
      reason: "missing_ARTIFACT_RETENTION_CONFIRM_SIM",
    });
  } else {
    for (const candidate of report.candidates) {
      const absolute = path.join(root, candidate.path);
      try {
        await fs.rm(absolute, { force: true, recursive: false });
        report.deleted.push(candidate);
      } catch (error) {
        report.skipped.push({
          path: candidate.path,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
    await removeEmptyDirs(path.join(root, "data/tmp"));
    await removeEmptyDirs(path.join(root, "data/backups"));
  }
}

if (json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  printHumanReport(report);
}

if (
  apply &&
  report.skipped.some((item) => item.reason === "missing_ARTIFACT_RETENTION_CONFIRM_SIM")
) {
  process.exitCode = 2;
}

async function collectRetentionReport() {
  await collectOldFiles("data/tmp", tmpDays, "tmp_retention");
  await collectOldFiles("data/backups", backupDays, "backup_retention");
  await collectReportOnlyDirs(["output", ".playwright-mcp", ".turbo"]);
  await collectAppDistDirs();
}

async function collectOldFiles(relativeDir, maxAgeDays, reason) {
  const base = path.join(root, relativeDir);
  for await (const entry of walkFiles(base)) {
    const relative = normalizeRelative(path.relative(root, entry.path));
    const ageDays = Math.floor((now - entry.stat.mtimeMs) / 86_400_000);
    if (shouldPreserve(relative)) {
      report.skipped.push({ path: relative, reason: "preserved" });
      continue;
    }
    if (ageDays >= maxAgeDays) {
      report.candidates.push({
        path: relative,
        reason,
        ageDays,
        sizeBytes: entry.stat.size,
      });
    }
  }
}

async function collectReportOnlyDirs(relativeDirs) {
  for (const relativeDir of relativeDirs) {
    const absolute = path.join(root, relativeDir);
    const stat = await statIfExists(absolute);
    if (!stat?.isDirectory()) continue;
    const summary = await summarizeDir(absolute);
    report.reportOnly.push({
      path: normalizeRelative(relativeDir),
      reason: "generated_report_only",
      files: summary.files,
      sizeBytes: summary.sizeBytes,
    });
  }
}

async function collectAppDistDirs() {
  const appsDir = path.join(root, "apps");
  const apps = await safeReaddir(appsDir);
  for (const entry of apps) {
    if (!entry.isDirectory()) continue;
    const relative = path.join("apps", entry.name, "dist");
    const absolute = path.join(root, relative);
    const stat = await statIfExists(absolute);
    if (!stat?.isDirectory()) continue;
    const summary = await summarizeDir(absolute);
    report.reportOnly.push({
      path: normalizeRelative(relative),
      reason: "app_dist_report_only",
      files: summary.files,
      sizeBytes: summary.sizeBytes,
    });
  }
}

async function* walkFiles(dir) {
  const entries = await safeReaddir(dir);
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    const stat = await statIfExists(absolute);
    if (!stat) continue;
    if (stat.isDirectory()) {
      yield* walkFiles(absolute);
    } else if (stat.isFile()) {
      yield { path: absolute, stat };
    }
  }
}

async function summarizeDir(dir) {
  let files = 0;
  let sizeBytes = 0;
  for await (const entry of walkFiles(dir)) {
    files += 1;
    sizeBytes += entry.stat.size;
  }
  return { files, sizeBytes };
}

async function removeEmptyDirs(dir) {
  const entries = await safeReaddir(dir);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    await removeEmptyDirs(path.join(dir, entry.name));
  }
  try {
    await fs.rmdir(dir);
  } catch {
    // Non-empty or absent directories are fine.
  }
}

function shouldPreserve(relativePath) {
  if (trackedPaths.has(relativePath)) return true;
  if (relativePath.startsWith("data/chromium-profile/whatsapp/")) return true;
  if (/^data\/nuoma-v2\.db/.test(relativePath)) return true;
  if (/^data\/m303[-/]/i.test(relativePath)) return true;
  if (/^data\/m38[-/]/i.test(relativePath)) return true;
  if (/^data\/m39[-/]/i.test(relativePath)) return true;
  if (/^data\/m40[-/]/i.test(relativePath)) return true;
  return false;
}

function gitTrackedPaths(cwd) {
  const result = spawnSync("git", ["ls-files", "-z"], {
    cwd,
    encoding: "utf8",
  });
  if (result.status !== 0 || result.error) {
    return [];
  }
  return result.stdout.split("\0").filter(Boolean).map(normalizeRelative);
}

async function safeReaddir(dir) {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function statIfExists(filePath) {
  try {
    return await fs.stat(filePath);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function parseArgs(input) {
  const parsed = {};
  for (let index = 0; index < input.length; index += 1) {
    const value = input[index];
    if (!value?.startsWith("--")) continue;
    const key = value.slice(2);
    if (key === "apply" || key === "json") {
      parsed[key] = true;
      continue;
    }
    parsed[key] = input[index + 1];
    index += 1;
  }
  return parsed;
}

function positiveNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
}

function normalizeRelative(value) {
  return value.split(path.sep).join("/");
}

function printHumanReport(input) {
  console.log(`artifact-retention|mode=${input.mode}|root=${input.root}`);
  console.log(
    `artifact-retention|candidates=${input.candidates.length}|deleted=${input.deleted.length}`,
  );
  console.log(`artifact-retention|trackedDataFiles=${input.trackedDataFiles.length}`);
  for (const candidate of input.candidates.slice(0, 25)) {
    console.log(
      `delete-candidate|path=${candidate.path}|reason=${candidate.reason}|ageDays=${candidate.ageDays}|sizeBytes=${candidate.sizeBytes}`,
    );
  }
  for (const item of input.reportOnly.slice(0, 25)) {
    console.log(
      `report-only|path=${item.path}|reason=${item.reason}|files=${item.files}|sizeBytes=${item.sizeBytes}`,
    );
  }
  for (const item of input.skipped.slice(0, 25)) {
    console.log(`skipped|path=${item.path}|reason=${item.reason}`);
  }
}
