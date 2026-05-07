import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

import { createRepositories, openDb, runMigrations } from "@nuoma/db";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(repoRoot, "scripts", "v215-cutover-preflight.mjs");

async function main() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nuoma-v215-cutover-"));
  const v1DbPath = path.join(tempDir, "v1.db");
  const v2DbPath = path.join(tempDir, "v2.db");
  const backupDir = path.join(tempDir, "backups");
  const proofRoot = path.join(tempDir, "proof");

  try {
    createV1Fixture(v1DbPath, { activeJob: false });
    await createV2Fixture(v2DbPath);
    await fs.mkdir(backupDir, { recursive: true });
    await fs.copyFile(v2DbPath, path.join(backupDir, "nuoma-v2-before-v215-smoke.db"));
    await fs.mkdir(path.join(proofRoot, "m303-wpp-24-send-90-proof-smoke"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(proofRoot, "m303-wpp-24-send-90-proof-smoke", "evidence.json"),
      JSON.stringify({ completed: 5, failed: 0, activeJobs: 0, ig: "nao_aplicavel" }),
    );

    const readyOutput = runPreflight({
      v1DbPath,
      v2DbPath,
      backupDir,
      proofRoot,
    });
    assert(
      readyOutput.includes(
        "v215-cutover-preflight|v1Contacts=2|v1Conversations=2|v1Messages=2|v2Contacts=0|v2ActiveJobs=0|blockers=0",
      ),
      `ready output mismatch: ${readyOutput}`,
    );
    assert(readyOutput.includes("status=ready"), `ready status missing: ${readyOutput}`);

    const blockedV1DbPath = path.join(tempDir, "v1-blocked.db");
    createV1Fixture(blockedV1DbPath, { activeJob: true });
    const blockedOutput = runPreflight({
      v1DbPath: blockedV1DbPath,
      v2DbPath,
      backupDir,
      proofRoot,
      allowFailure: true,
    });
    assert(blockedOutput.includes("blockers=1"), `blocked output mismatch: ${blockedOutput}`);
    assert(blockedOutput.includes("status=blocked"), `blocked status missing: ${blockedOutput}`);

    console.log("v215-cutover-preflight-smoke|ready=ok|blocker=ok|status=closed");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function runPreflight(input: {
  v1DbPath: string;
  v2DbPath: string;
  backupDir: string;
  proofRoot: string;
  allowFailure?: boolean;
}) {
  try {
    return execFileSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        V215_V1_DB_PATH: input.v1DbPath,
        V215_V2_DB_PATH: input.v2DbPath,
        V215_BACKUP_DIR: input.backupDir,
        V215_M303_PROOF_ROOT: input.proofRoot,
        V215_TARGET_USER_ID: "1",
      },
    }).trim();
  } catch (error) {
    if (!input.allowFailure) {
      throw error;
    }
    const execError = error as { stdout?: Buffer | string };
    return Buffer.isBuffer(execError.stdout)
      ? execError.stdout.toString("utf8").trim()
      : String(execError.stdout ?? "").trim();
  }
}

function createV1Fixture(dbPath: string, input: { activeJob: boolean }) {
  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE contacts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        phone TEXT,
        cpf TEXT,
        email TEXT,
        instagram TEXT,
        procedure_status TEXT DEFAULT 'unknown',
        last_attendant TEXT,
        notes TEXT,
        status TEXT NOT NULL DEFAULT 'novo',
        last_interaction_at TEXT,
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
      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        contact_id TEXT,
        wa_chat_id TEXT NOT NULL,
        title TEXT NOT NULL,
        unread_count INTEGER NOT NULL DEFAULT 0,
        last_message_preview TEXT NOT NULL DEFAULT '',
        last_message_at TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        channel TEXT NOT NULL DEFAULT 'whatsapp',
        external_thread_id TEXT
      );
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        contact_id TEXT,
        direction TEXT NOT NULL,
        content_type TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        media_asset_id TEXT,
        external_id TEXT,
        status TEXT NOT NULL DEFAULT 'sent',
        sent_at TEXT,
        meta_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        channel TEXT NOT NULL DEFAULT 'whatsapp'
      );
      CREATE TABLE media_assets (
        id TEXT PRIMARY KEY,
        sha256 TEXT NOT NULL,
        original_name TEXT NOT NULL,
        safe_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        category TEXT NOT NULL,
        storage_path TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE campaigns (id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL);
      CREATE TABLE campaign_steps (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, type TEXT NOT NULL);
      CREATE TABLE campaign_recipients (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, status TEXT NOT NULL);
      CREATE TABLE jobs (id TEXT PRIMARY KEY, type TEXT NOT NULL, status TEXT NOT NULL);
    `);
    const now = "2026-05-07T12:00:00.000Z";
    db.prepare(
      `INSERT INTO contacts
       (id, name, phone, email, instagram, status, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).run("c1", "Gabriel", "5531982066263", "gabriel@nuoma.local", null, "cliente", now, now);
    db.prepare(
      `INSERT INTO contacts
       (id, name, phone, email, instagram, status, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).run("c2", "Instagram Lead", null, null, "@nuoma", "novo", now, now);
    db.prepare("INSERT INTO tags (id, name, color) VALUES ('t1', 'whatsapp', '#3ddc97')").run();
    db.prepare("INSERT INTO contact_tags (contact_id, tag_id) VALUES ('c1', 't1')").run();
    db.prepare(
      `INSERT INTO conversations
       (id, contact_id, wa_chat_id, title, unread_count, last_message_preview, last_message_at, status, created_at, updated_at, channel, external_thread_id)
       VALUES (?, ?, ?, ?, 0, ?, ?, 'open', ?, ?, ?, ?)`,
    ).run("v1conv1", "c1", "5531982066263", "Gabriel", "Oi", now, now, now, "whatsapp", "5531982066263");
    db.prepare(
      `INSERT INTO conversations
       (id, contact_id, wa_chat_id, title, unread_count, last_message_preview, last_message_at, status, created_at, updated_at, channel, external_thread_id)
       VALUES (?, ?, ?, ?, 0, ?, ?, 'open', ?, ?, ?, ?)`,
    ).run("v1conv2", "c2", "instagram:nuoma", "Instagram Lead", "DM", now, now, now, "instagram", "nuoma");
    db.prepare(
      `INSERT INTO messages
       (id, conversation_id, contact_id, direction, content_type, body, external_id, status, sent_at, created_at, channel)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("m1", "v1conv1", "c1", "incoming", "text", "Oi", "wa-1", "sent", now, now, "whatsapp");
    db.prepare(
      `INSERT INTO messages
       (id, conversation_id, contact_id, direction, content_type, body, external_id, status, sent_at, created_at, channel)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("m2", "v1conv1", "c1", "outgoing", "file", "PDF", "wa-2", "sent", now, now, "whatsapp");
    db.prepare(
      `INSERT INTO media_assets
       (id, sha256, original_name, safe_name, mime_type, size_bytes, category, storage_path, created_at)
       VALUES ('media1', ?, 'doc.pdf', 'doc.pdf', 'application/pdf', 10, 'document', '/tmp/doc.pdf', ?)`,
    ).run("a".repeat(64), now);
    db.prepare("INSERT INTO campaigns (id, name, status) VALUES ('camp1', 'Smoke', 'completed')").run();
    db.prepare("INSERT INTO campaign_steps (id, campaign_id, type) VALUES ('step1', 'camp1', 'text')").run();
    db.prepare(
      "INSERT INTO campaign_recipients (id, campaign_id, status) VALUES ('rec1', 'camp1', 'sent')",
    ).run();
    db.prepare("INSERT INTO jobs (id, type, status) VALUES ('job1', 'send-message', ?)").run(
      input.activeJob ? "pending" : "done",
    );
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

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`V2.15 cutover preflight smoke failed: ${message}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
