import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nuoma-m303-campaign-proof-"));
const dbPath = path.join(tempDir, "proof.db");

try {
  seedFixture(dbPath, ["navigated", "reused-open-chat", "reused-open-chat"]);
  const passing = runProof(dbPath);
  assert(passing.status === 0, passing.stderr || passing.stdout);
  assert(
    passing.stdout.includes("m303-campaign-retry-performance-proof|status=passed"),
    "proof should pass when follow-up steps reuse the open chat",
  );

  seedFixture(dbPath, ["navigated", "navigated", "reused-open-chat"]);
  const failing = runProof(dbPath);
  assert(failing.status !== 0, "proof should fail when a follow-up step navigates again");
  assert(
    failing.stderr.includes("did not reuse the open WhatsApp chat after the first step"),
    failing.stderr || failing.stdout,
  );

  console.log("m303-campaign-retry-performance-proof-smoke|status=ok");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

function seedFixture(databasePath, navigationModes) {
  fs.rmSync(databasePath, { force: true });
  const db = new Database(databasePath);
  try {
    db.exec(`
      CREATE TABLE jobs (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        max_attempts INTEGER NOT NULL,
        scheduled_at TEXT NOT NULL,
        claimed_at TEXT,
        completed_at TEXT,
        last_error TEXT,
        payload_json TEXT NOT NULL
      );
      CREATE TABLE system_events (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        severity TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE campaigns (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        channel TEXT NOT NULL
      );
    `);
    db.prepare(
      "INSERT INTO campaigns (id, user_id, name, status, channel) VALUES (10, 1, 'Fixture Campaign', 'active', 'whatsapp')",
    ).run();
    const insertJob = db.prepare(`
      INSERT INTO jobs (
        id, user_id, type, status, attempts, max_attempts, scheduled_at,
        claimed_at, completed_at, last_error, payload_json
      ) VALUES (?, 1, 'campaign_step', 'completed', 1, 1, ?, ?, ?, NULL, ?)
    `);
    const insertEvent = db.prepare(`
      INSERT INTO system_events (id, user_id, type, severity, payload_json, created_at)
      VALUES (?, 1, ?, 'info', ?, ?)
    `);
    for (let index = 0; index < navigationModes.length; index += 1) {
      const id = index + 1;
      const at = `2026-05-27T10:00:0${index}.000Z`;
      const payload = {
        phone: "5531982066263",
        campaignId: 10,
        campaignBatchId: "batch-ok",
        stepId: `step-${id}`,
      };
      insertJob.run(id, at, at, at, JSON.stringify(payload));
      insertEvent.run(
        100 + id,
        "sender.campaign_step.started",
        JSON.stringify({ ...payload, jobId: id }),
        at,
      );
      insertEvent.run(
        200 + id,
        "sender.campaign_step.completed",
        JSON.stringify({ ...payload, jobId: id, navigationMode: navigationModes[index] }),
        at,
      );
    }
  } finally {
    db.close();
  }
}

function runProof(databasePath) {
  return spawnSync(
    process.execPath,
    [path.join(repoRoot, "tests/m303-campaign-retry-performance-proof.mjs")],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        DATABASE_URL: databasePath,
        M303_USER_ID: "1",
        M303_EXPECTED_ROUNDS: "1",
        M303_CAMPAIGN_BATCH_IDS: "batch-ok",
        M303_PHONE: "31982066263",
        M303_REQUIRE_NEFERPEEL_BH: "false",
        M303_REQUIRE_TEMPORARY_MESSAGES: "false",
      },
      encoding: "utf8",
    },
  );
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
