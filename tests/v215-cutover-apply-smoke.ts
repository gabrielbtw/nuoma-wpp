import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

import { createRepositories, openDb, runMigrations } from "@nuoma/db";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(repoRoot, "scripts", "v215-cutover-apply.mjs");

async function main() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nuoma-v215-apply-"));
  const v1DbPath = path.join(tempDir, "v1.db");
  const v2DbPath = path.join(tempDir, "v2.db");
  const backupDir = path.join(tempDir, "backups");

  try {
    createV1Fixture(v1DbPath);
    await createV2Fixture(v2DbPath);

    const dryRun = runScript({ v1DbPath, v2DbPath, backupDir, mode: "dry-run" });
    assert(dryRun.includes("v215-cutover-apply|mode=dry-run"), dryRun);
    assert(dryRun.includes("contacts=2"), dryRun);
    assert(dryRun.includes("conversations=2"), dryRun);
    assert(dryRun.includes("messages=2"), dryRun);
    assert(dryRun.includes("status=ready"), dryRun);

    const apply = runScript({ v1DbPath, v2DbPath, backupDir, mode: "apply", confirm: true });
    assert(apply.includes("v215-cutover-apply|mode=apply"), apply);
    assert(apply.includes("status=applied"), apply);
    assert(apply.includes("backup="), apply);

    const counts = readV2Counts(v2DbPath);
    assert(counts.contacts === 2, `contacts mismatch ${JSON.stringify(counts)}`);
    assert(counts.conversations === 2, `conversations mismatch ${JSON.stringify(counts)}`);
    assert(counts.messages === 2, `messages mismatch ${JSON.stringify(counts)}`);
    assert(counts.campaigns === 1, `campaigns mismatch ${JSON.stringify(counts)}`);
    assert(counts.recipients === 1, `recipients mismatch ${JSON.stringify(counts)}`);
    assert(counts.events === 1, `event mismatch ${JSON.stringify(counts)}`);

    const applyAgain = runScript({ v1DbPath, v2DbPath, backupDir, mode: "apply", confirm: true });
    assert(applyAgain.includes("status=applied"), applyAgain);
    const afterSecondApply = readV2Counts(v2DbPath);
    assert(afterSecondApply.contacts === 2, `contacts not idempotent ${JSON.stringify(afterSecondApply)}`);
    assert(afterSecondApply.conversations === 2, `conversations not idempotent ${JSON.stringify(afterSecondApply)}`);
    assert(afterSecondApply.messages === 2, `messages not idempotent ${JSON.stringify(afterSecondApply)}`);
    assert(afterSecondApply.campaigns === 1, `campaigns not idempotent ${JSON.stringify(afterSecondApply)}`);
    assert(afterSecondApply.recipients === 1, `recipients not idempotent ${JSON.stringify(afterSecondApply)}`);

    console.log("v215-cutover-apply-smoke|dryRun=ok|apply=ok|idempotent=ok|status=closed");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function runScript(input: {
  v1DbPath: string;
  v2DbPath: string;
  backupDir: string;
  mode: "dry-run" | "apply";
  confirm?: boolean;
}) {
  return execFileSync(process.execPath, [scriptPath, `--mode=${input.mode}`], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      V215_V1_DB_PATH: input.v1DbPath,
      V215_V2_DB_PATH: input.v2DbPath,
      V215_BACKUP_DIR: input.backupDir,
      V215_TARGET_USER_ID: "1",
      ...(input.confirm ? { V215_CONFIRM_CUTOVER: "SIM" } : {}),
    },
  }).trim();
}

function createV1Fixture(dbPath: string) {
  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE contacts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        phone TEXT,
        email TEXT,
        instagram TEXT,
        status TEXT NOT NULL DEFAULT 'novo',
        last_message_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE TABLE tags (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT NOT NULL
      );
      CREATE TABLE contact_tags (
        contact_id TEXT NOT NULL,
        tag_id TEXT NOT NULL
      );
      CREATE TABLE media_assets (
        id TEXT PRIMARY KEY,
        sha256 TEXT NOT NULL,
        original_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        category TEXT NOT NULL,
        storage_path TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        contact_id TEXT,
        wa_chat_id TEXT NOT NULL,
        title TEXT NOT NULL,
        unread_count INTEGER NOT NULL DEFAULT 0,
        last_message_preview TEXT NOT NULL DEFAULT '',
        last_message_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        channel TEXT NOT NULL DEFAULT 'whatsapp',
        external_thread_id TEXT
      );
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        contact_id TEXT,
        media_asset_id TEXT,
        direction TEXT NOT NULL,
        content_type TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        external_id TEXT,
        status TEXT NOT NULL DEFAULT 'sent',
        sent_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE campaigns (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL
      );
      CREATE TABLE campaign_steps (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL,
        type TEXT NOT NULL,
        label TEXT
      );
      CREATE TABLE campaign_recipients (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL,
        contact_id TEXT,
        phone TEXT,
        status TEXT NOT NULL
      );
    `);
    const now = "2026-05-07T12:00:00.000Z";
    db.prepare(
      `INSERT INTO contacts
       (id, name, phone, email, instagram, status, last_message_at, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).run("c1", "Gabriel", "5531982066263", "gabriel@nuoma.local", null, "cliente", now, now, now);
    db.prepare(
      `INSERT INTO contacts
       (id, name, phone, email, instagram, status, last_message_at, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).run("c2", "Instagram Lead", null, null, "@nuoma", "novo", now, now, now);
    db.prepare("INSERT INTO tags (id, name, color) VALUES ('t1', 'lead', '#3ddc97')").run();
    db.prepare("INSERT INTO contact_tags (contact_id, tag_id) VALUES ('c1', 't1')").run();
    db.prepare(
      `INSERT INTO media_assets
       (id, sha256, original_name, mime_type, size_bytes, category, storage_path, created_at)
       VALUES ('media1', ?, 'doc.pdf', 'application/pdf', 10, 'file', 'storage/doc.pdf', ?)`,
    ).run("a".repeat(64), now);
    db.prepare(
      `INSERT INTO conversations
       (id, contact_id, wa_chat_id, title, unread_count, last_message_preview, last_message_at, created_at, updated_at, channel, external_thread_id)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
    ).run("conv1", "c1", "5531982066263", "Gabriel", "Oi", now, now, now, "whatsapp", "5531982066263");
    db.prepare(
      `INSERT INTO conversations
       (id, contact_id, wa_chat_id, title, unread_count, last_message_preview, last_message_at, created_at, updated_at, channel, external_thread_id)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
    ).run("conv2", "c2", "instagram:nuoma", "Instagram Lead", "DM", now, now, now, "instagram", "nuoma");
    db.prepare(
      `INSERT INTO messages
       (id, conversation_id, contact_id, media_asset_id, direction, content_type, body, external_id, status, sent_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("m1", "conv1", "c1", null, "incoming", "text", "Oi", "wa-1", "sent", now, now);
    db.prepare(
      `INSERT INTO messages
       (id, conversation_id, contact_id, media_asset_id, direction, content_type, body, external_id, status, sent_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("m2", "conv1", "c1", "media1", "outgoing", "file", "PDF", "wa-2", "sent", now, now);
    db.prepare("INSERT INTO campaigns (id, name, status) VALUES ('camp1', 'Smoke V1', 'completed')").run();
    db.prepare("INSERT INTO campaign_steps (id, campaign_id, type, label) VALUES ('step1', 'camp1', 'text', 'Intro')").run();
    db.prepare(
      "INSERT INTO campaign_recipients (id, campaign_id, contact_id, phone, status) VALUES ('rec1', 'camp1', 'c1', '5531982066263', 'sent')",
    ).run();
  } finally {
    db.close();
  }
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
  } finally {
    handle.close();
  }
}

function readV2Counts(dbPath: string) {
  const db = new Database(dbPath, { readonly: true });
  try {
    return {
      contacts: scalar(db, "SELECT count(*) FROM contacts"),
      conversations: scalar(db, "SELECT count(*) FROM conversations"),
      messages: scalar(db, "SELECT count(*) FROM messages"),
      campaigns: scalar(db, "SELECT count(*) FROM campaigns"),
      recipients: scalar(db, "SELECT count(*) FROM campaign_recipients"),
      events: scalar(db, "SELECT count(*) FROM system_events WHERE type = 'v215.cutover.applied'"),
    };
  } finally {
    db.close();
  }
}

function scalar(db: Database.Database, sql: string) {
  const row = db.prepare(sql).get() as Record<string, number>;
  return Number(Object.values(row)[0] ?? 0);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`V2.15 cutover apply smoke failed: ${message}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
