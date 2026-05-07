import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

import { createRepositories, openDb, runMigrations } from "@nuoma/db";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(repoRoot, "scripts", "v214-backup-restore.mjs");

async function main() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nuoma-v214-backup-"));
  const dbPath = path.join(tempDir, "nuoma-v2.db");
  const backupDir = path.join(tempDir, "backups");

  try {
    await createV2Fixture(dbPath);

    const backupOutput = runScript({
      dbPath,
      backupDir,
      mode: "backup",
    });
    assert(backupOutput.includes("v214-backup-restore|mode=backup"), backupOutput);
    assert(backupOutput.includes("verified=ok"), backupOutput);
    assert(backupOutput.includes("status=closed"), backupOutput);
    const backupPath = field(backupOutput, "dbBackup");
    assert(backupPath && backupPath.endsWith(".db"), backupOutput);

    const verifyOutput = runScript({
      dbPath,
      backupDir,
      mode: "verify",
    });
    assert(verifyOutput.includes("restoreRehearsal=ok"), verifyOutput);
    assert(verifyOutput.includes("status=closed"), verifyOutput);

    const dryRunOutput = runScript({
      dbPath,
      backupDir,
      mode: "restore-dry-run",
      restoreSource: backupPath,
    });
    assert(dryRunOutput.includes("verified=ok"), dryRunOutput);
    assert(dryRunOutput.includes("restoreRehearsal=ok"), dryRunOutput);

    addSecondUser(dbPath);
    assert(countUsers(dbPath) === 2, "fixture mutation failed before restore");
    const restoreOutput = runScript({
      dbPath,
      backupDir,
      mode: "restore",
      restoreSource: backupPath,
      confirmRestore: true,
    });
    assert(restoreOutput.includes("restoreRehearsal=applied"), restoreOutput);
    assert(restoreOutput.includes("status=closed"), restoreOutput);
    assert(countUsers(dbPath) === 1, "restore did not return DB to backed-up state");

    console.log("v214-backup-restore-smoke|backup=ok|verify=ok|restore=ok|status=closed");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function runScript(input: {
  dbPath: string;
  backupDir: string;
  mode: string;
  restoreSource?: string;
  confirmRestore?: boolean;
}) {
  return execFileSync(process.execPath, [scriptPath, `--mode=${input.mode}`], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      V214_DB_PATH: input.dbPath,
      V214_BACKUP_DIR: input.backupDir,
      V214_INCLUDE_PROFILE: "0",
      ...(input.restoreSource ? { V214_RESTORE_SOURCE: input.restoreSource } : {}),
      ...(input.confirmRestore ? { V214_CONFIRM_RESTORE: "SIM" } : {}),
    },
  }).trim();
}

async function createV2Fixture(dbPath: string) {
  const handle = openDb(dbPath);
  try {
    await runMigrations(handle);
    const repos = createRepositories(handle);
    await repos.users.create({
      email: "admin@nuoma.local",
      passwordHash: "hash",
      role: "admin",
      displayName: "Admin",
    });
    await repos.systemEvents.create({
      userId: 1,
      type: "v214.fixture",
      severity: "info",
      payload: JSON.stringify({ ok: true }),
    });
  } finally {
    handle.close();
  }
}

function addSecondUser(dbPath: string) {
  const db = new Database(dbPath);
  try {
    db.prepare(
      `INSERT INTO users (email, password_hash, role, display_name, is_active)
       VALUES ('second@nuoma.local', 'hash', 'viewer', 'Second', 1)`,
    ).run();
  } finally {
    db.close();
  }
}

function countUsers(dbPath: string) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db.prepare("SELECT count(*) AS total FROM users").get() as { total: number };
    return Number(row.total);
  } finally {
    db.close();
  }
}

function field(output: string, name: string) {
  const part = output.split("|").find((item) => item.startsWith(`${name}=`));
  return part?.slice(name.length + 1) ?? null;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`V2.14 backup/restore smoke failed: ${message}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
