#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const requiredTables = [
  "users",
  "contacts",
  "conversations",
  "messages",
  "campaigns",
  "jobs",
  "system_events",
];

async function main() {
  const mode = argValue("--mode") ?? process.env.V214_MODE ?? "verify";
  const dbPath = resolvePath(process.env.V214_DB_PATH ?? "data/nuoma-v2.db");
  const backupDir = resolvePath(process.env.V214_BACKUP_DIR ?? "data/backups");
  const profileDir = resolvePath(process.env.V214_PROFILE_DIR ?? "data/chromium-profile/whatsapp");
  const includeProfile = envFlag(process.env.V214_INCLUDE_PROFILE, true);

  if (mode === "backup") {
    const dbBackup = await createDbBackup(dbPath, backupDir, "v214");
    const profileBackup = includeProfile
      ? createProfileBackup(profileDir, backupDir, "v214")
      : { path: null, status: "skipped" };
    const verified = validateSqliteBackup(dbBackup.path);
    printSummary({
      mode,
      dbBackup: dbBackup.path,
      profileBackup: profileBackup.path ?? profileBackup.status,
      verified: verified.ok ? "ok" : "failed",
      restoreRehearsal: "not_run",
      status: verified.ok ? "closed" : "blocked",
    });
    if (!verified.ok) process.exitCode = 1;
    return;
  }

  if (mode === "restore-dry-run") {
    const source = resolveRestoreSource(backupDir);
    const verified = validateSqliteBackup(source);
    printSummary({
      mode,
      dbBackup: source,
      profileBackup: "not_applicable",
      verified: verified.ok ? "ok" : "failed",
      restoreRehearsal: verified.ok ? rehearseRestore(source).status : "skipped",
      status: verified.ok ? "closed" : "blocked",
    });
    if (!verified.ok) process.exitCode = 1;
    return;
  }

  if (mode === "restore") {
    if (process.env.V214_CONFIRM_RESTORE !== "SIM") {
      throw new Error("V2.14 restore requires V214_CONFIRM_RESTORE=SIM");
    }
    const source = resolveRestoreSource(backupDir);
    const verified = validateSqliteBackup(source);
    if (!verified.ok) {
      throw new Error(`Restore source is not a valid V2 backup: ${source}`);
    }
    const preRestore = fs.existsSync(dbPath)
      ? (await createDbBackup(dbPath, backupDir, "pre-v214-restore")).path
      : null;
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    fs.copyFileSync(source, dbPath);
    const restored = validateSqliteBackup(dbPath);
    printSummary({
      mode,
      dbBackup: source,
      profileBackup: "not_applicable",
      verified: restored.ok ? "ok" : "failed",
      restoreRehearsal: "applied",
      preRestoreBackup: preRestore ?? "none",
      status: restored.ok ? "closed" : "blocked",
    });
    if (!restored.ok) process.exitCode = 1;
    return;
  }

  if (mode !== "verify") {
    throw new Error(`Unsupported V2.14 mode: ${mode}`);
  }

  const latest = findLatestDbBackup(backupDir);
  if (!latest) {
    printSummary({
      mode,
      dbBackup: "missing",
      profileBackup: includeProfile && fs.existsSync(profileDir) ? "available" : "skipped",
      verified: "missing",
      restoreRehearsal: "skipped",
      status: "blocked",
    });
    process.exitCode = 1;
    return;
  }
  const verified = validateSqliteBackup(latest.path);
  const rehearsal = verified.ok ? rehearseRestore(latest.path) : { status: "skipped" };
  printSummary({
    mode,
    dbBackup: latest.path,
    profileBackup: includeProfile && fs.existsSync(profileDir) ? "available" : "skipped",
    verified: verified.ok ? "ok" : "failed",
    restoreRehearsal: rehearsal.status,
    status: verified.ok && rehearsal.status === "ok" ? "closed" : "blocked",
  });
  if (!verified.ok || rehearsal.status !== "ok") process.exitCode = 1;
}

async function createDbBackup(dbPath, backupDir, prefix) {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`V2 database not found: ${dbPath}`);
  }
  fs.mkdirSync(backupDir, { recursive: true });
  const targetPath = path.join(backupDir, `${prefix}-${timestamp()}.db`);
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    await db.backup(targetPath);
  } finally {
    db.close();
  }
  return { path: targetPath };
}

function createProfileBackup(profileDir, backupDir, prefix) {
  if (!fs.existsSync(profileDir)) {
    return { path: null, status: "skipped" };
  }
  fs.mkdirSync(backupDir, { recursive: true });
  const targetPath = path.join(backupDir, `${prefix}-chromium-profile-${timestamp()}.tar.gz`);
  const result = spawnSync("tar", ["-czf", targetPath, "-C", path.dirname(profileDir), path.basename(profileDir)], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`Profile backup failed: ${result.stderr || result.stdout}`);
  }
  return { path: targetPath, status: "ok" };
}

function validateSqliteBackup(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { ok: false, reason: "missing" };
  }
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size === 0) {
    return { ok: false, reason: "empty" };
  }
  const db = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    const quick = db.prepare("PRAGMA quick_check").get();
    const quickValue = String(Object.values(quick ?? {})[0] ?? "");
    if (quickValue !== "ok") {
      return { ok: false, reason: `quick_check:${quickValue}` };
    }
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name);
    const missing = requiredTables.filter((table) => !tables.includes(table));
    if (missing.length > 0) {
      return { ok: false, reason: `missing_tables:${missing.join(",")}` };
    }
    return { ok: true };
  } finally {
    db.close();
  }
}

function rehearseRestore(sourcePath) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nuoma-v214-restore-"));
  const target = path.join(tempDir, "restore.db");
  try {
    fs.copyFileSync(sourcePath, target);
    const verified = validateSqliteBackup(target);
    return { status: verified.ok ? "ok" : "failed" };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function resolveRestoreSource(backupDir) {
  const explicit = process.env.V214_RESTORE_SOURCE;
  if (explicit) return resolvePath(explicit);
  const latest = findLatestDbBackup(backupDir);
  if (!latest) {
    throw new Error(`No V2 DB backup found in ${backupDir}`);
  }
  return latest.path;
}

function findLatestDbBackup(backupDir) {
  if (!fs.existsSync(backupDir)) return null;
  return fs
    .readdirSync(backupDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".db"))
    .map((entry) => {
      const fullPath = path.join(backupDir, entry.name);
      const stat = fs.statSync(fullPath);
      return { path: fullPath, mtimeMs: stat.mtimeMs, sizeBytes: stat.size };
    })
    .filter((entry) => entry.sizeBytes > 0)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0] ?? null;
}

function printSummary(input) {
  console.log(
    [
      "v214-backup-restore",
      `mode=${input.mode}`,
      `dbBackup=${input.dbBackup}`,
      `profileBackup=${input.profileBackup}`,
      `verified=${input.verified}`,
      `restoreRehearsal=${input.restoreRehearsal}`,
      input.preRestoreBackup ? `preRestoreBackup=${input.preRestoreBackup}` : null,
      `status=${input.status}`,
    ]
      .filter(Boolean)
      .join("|"),
  );
}

function timestamp() {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

function resolvePath(input) {
  return path.isAbsolute(input) ? input : path.resolve(repoRoot, input);
}

function envFlag(value, fallback) {
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "sim", "SIM"].includes(value);
}

function argValue(name) {
  const prefix = `${name}=`;
  const found = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
