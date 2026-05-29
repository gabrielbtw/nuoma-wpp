#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = await mkdtemp(path.join(tmpdir(), "nuoma-artifact-retention-"));

try {
  const oldTmp = path.join(fixtureRoot, "data/tmp/old.log");
  const freshTmp = path.join(fixtureRoot, "data/tmp/fresh.log");
  const oldBackup = path.join(fixtureRoot, "data/backups/old.sqlite");

  await mkdir(path.dirname(oldTmp), { recursive: true });
  await mkdir(path.dirname(oldBackup), { recursive: true });
  await writeFile(oldTmp, "old tmp artifact\n", "utf8");
  await writeFile(freshTmp, "fresh tmp artifact\n", "utf8");
  await writeFile(oldBackup, "old backup artifact\n", "utf8");

  const oldDate = new Date(Date.now() - 40 * 86_400_000);
  await utimes(oldTmp, oldDate, oldDate);
  await utimes(oldBackup, oldDate, oldDate);

  const audit = runRetention([
    "--root",
    fixtureRoot,
    "--tmp-days",
    "7",
    "--backup-days",
    "30",
    "--json",
  ]);
  assert(audit.status === 0, audit.stderr || audit.stdout);
  const auditReport = JSON.parse(audit.stdout);
  assert(
    hasCandidate(auditReport, "data/tmp/old.log", "tmp_retention"),
    "audit should report old tmp artifact",
  );
  assert(
    hasCandidate(auditReport, "data/backups/old.sqlite", "backup_retention"),
    "audit should report old backup artifact",
  );
  assert(
    !hasCandidate(auditReport, "data/tmp/fresh.log", "tmp_retention"),
    "audit should keep fresh tmp artifact out of delete candidates",
  );

  const unconfirmedApply = runRetention([
    "--root",
    fixtureRoot,
    "--tmp-days",
    "7",
    "--backup-days",
    "30",
    "--apply",
    "--json",
  ]);
  assert(unconfirmedApply.status === 2, unconfirmedApply.stderr || unconfirmedApply.stdout);
  assert(existsSync(oldTmp), "unconfirmed apply must not delete old tmp artifact");
  assert(existsSync(oldBackup), "unconfirmed apply must not delete old backup artifact");

  const confirmedApply = runRetention(
    ["--root", fixtureRoot, "--tmp-days", "7", "--backup-days", "30", "--apply", "--json"],
    { ARTIFACT_RETENTION_CONFIRM: "SIM" },
  );
  assert(confirmedApply.status === 0, confirmedApply.stderr || confirmedApply.stdout);
  assert(!existsSync(oldTmp), "confirmed apply should delete old tmp artifact");
  assert(!existsSync(oldBackup), "confirmed apply should delete old backup artifact");
  assert(existsSync(freshTmp), "confirmed apply should keep fresh tmp artifact");

  console.log("artifact-retention-policy-smoke|status=ok");
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}

function runRetention(args, env = {}) {
  return spawnSync(
    process.execPath,
    [path.join(repoRoot, "scripts/artifact-retention.mjs"), ...args],
    {
      cwd: repoRoot,
      env: { ...process.env, ...env },
      encoding: "utf8",
    },
  );
}

function hasCandidate(report, relativePath, reason) {
  return report.candidates.some(
    (candidate) => candidate.path === relativePath && candidate.reason === reason,
  );
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
