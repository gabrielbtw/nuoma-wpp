import { spawnSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { createRepositories, openDb, runMigrations, type DbHandle } from "@nuoma/db";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nuoma-send-audit-retention-"));
const dbPath = path.join(tempDir, "retention.db");
let handle: DbHandle | null = null;

try {
  handle = openDb(dbPath);
  await runMigrations(handle);
  const repos = createRepositories(handle);
  const user = await repos.users.create({
    email: "send-audit-retention-smoke@nuoma.local",
    passwordHash: "hash",
    role: "admin",
  });
  await repos.sendAuditEvents.create({
    occurredAt: "2026-02-01T00:00:00.000Z",
    userId: user.id,
    channel: "whatsapp",
    phase: "dispatching",
    metadata: { source: "old" },
  });
  await repos.sendAuditEvents.create({
    occurredAt: "2026-05-20T00:00:00.000Z",
    userId: user.id,
    channel: "whatsapp",
    phase: "sent",
    metadata: { source: "fresh" },
  });
  await repos.sendAuditEvents.create({
    occurredAt: "2026-03-03T00:00:00.000Z",
    userId: user.id,
    channel: "whatsapp",
    phase: "read",
    metadata: { source: "boundary" },
  });
  handle.close();
  handle = null;

  const audit = runRetention([
    "--db",
    dbPath,
    "--days",
    "90",
    "--now",
    "2026-06-01T00:00:00.000Z",
    "--json",
  ]);
  assert(audit.status === 0, audit.stderr || audit.stdout);
  const auditReport = JSON.parse(audit.stdout);
  assert(auditReport.mode === "audit", "send audit retention must default to audit mode");
  assert(auditReport.candidates === 1, "audit should report one old send_audit_event");
  assert(auditReport.deleted === 0, "audit mode must not delete send_audit_events");

  const unconfirmedApply = runRetention([
    "--db",
    dbPath,
    "--days",
    "90",
    "--now",
    "2026-06-01T00:00:00.000Z",
    "--apply",
    "--json",
  ]);
  assert(unconfirmedApply.status === 2, unconfirmedApply.stderr || unconfirmedApply.stdout);
  const unconfirmedReport = JSON.parse(unconfirmedApply.stdout);
  assert(unconfirmedReport.deleted === 0, "unconfirmed apply must not delete send_audit_events");

  const confirmedApply = runRetention(
    ["--db", dbPath, "--days", "90", "--now", "2026-06-01T00:00:00.000Z", "--apply", "--json"],
    { SEND_AUDIT_RETENTION_CONFIRM: "SIM" },
  );
  assert(confirmedApply.status === 0, confirmedApply.stderr || confirmedApply.stdout);
  const confirmedReport = JSON.parse(confirmedApply.stdout);
  assert(confirmedReport.deleted === 1, "confirmed apply should delete one old send_audit_event");

  handle = openDb(dbPath);
  const remaining = await createRepositories(handle).sendAuditEvents.list({ userId: user.id });
  assert(remaining.length === 2, "fresh and cutoff-boundary send_audit_events should remain");
  assert(remaining[0]?.metadata.source === "fresh", "fresh send_audit_event must be preserved");
  assert(
    remaining[1]?.metadata.source === "boundary",
    "cutoff-boundary send_audit_event must be preserved",
  );

  console.log("send-audit-retention-smoke|status=ok");
} finally {
  handle?.close();
  await fs.rm(tempDir, { recursive: true, force: true });
}

function runRetention(args: string[], env: Record<string, string> = {}) {
  return spawnSync(
    process.execPath,
    [
      path.join(repoRoot, "node_modules/tsx/dist/cli.mjs"),
      path.join(repoRoot, "scripts/send-audit-retention.mts"),
      ...args,
    ],
    {
      cwd: repoRoot,
      env: { ...process.env, ...env },
      encoding: "utf8",
    },
  );
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
