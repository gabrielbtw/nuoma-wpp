import { execFileSync } from "node:child_process";
import * as nodeFs from "node:fs";
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
  const mediaTargetRoot = path.join(tempDir, "v2-media");

  try {
    await fs.mkdir(path.join(tempDir, "storage"), { recursive: true });
    await fs.writeFile(path.join(tempDir, "storage", "doc.pdf"), "fixture-pdf");
    createV1Fixture(v1DbPath);
    await createV2Fixture(v2DbPath);

    const dryRun = runScript({
      v1DbPath,
      v2DbPath,
      backupDir,
      mode: "dry-run",
      v1StorageRoot: tempDir,
      mediaTargetRoot,
    });
    assert(dryRun.includes("v215-cutover-apply|mode=dry-run"), dryRun);
    assert(dryRun.includes("contacts=2"), dryRun);
    assert(dryRun.includes("conversations=2"), dryRun);
    assert(dryRun.includes("messages=2"), dryRun);
    assert(dryRun.includes("automations=1"), dryRun);
    assert(dryRun.includes("chatbots=1"), dryRun);
    assert(dryRun.includes("jobs=1"), dryRun);
    assert(dryRun.includes("status=ready"), dryRun);

    const apply = runScript({
      v1DbPath,
      v2DbPath,
      backupDir,
      mode: "apply",
      confirm: true,
      v1StorageRoot: tempDir,
      mediaTargetRoot,
    });
    assert(apply.includes("v215-cutover-apply|mode=apply"), apply);
    assert(apply.includes("status=applied"), apply);
    assert(apply.includes("backup="), apply);

    const counts = readV2Counts(v2DbPath);
    assert(counts.contacts === 2, `contacts mismatch ${JSON.stringify(counts)}`);
    assert(counts.conversations === 2, `conversations mismatch ${JSON.stringify(counts)}`);
    assert(counts.messages === 2, `messages mismatch ${JSON.stringify(counts)}`);
    assert(counts.campaigns === 1, `campaigns mismatch ${JSON.stringify(counts)}`);
    assert(counts.recipients === 1, `recipients mismatch ${JSON.stringify(counts)}`);
    assert(counts.automations === 1, `automations mismatch ${JSON.stringify(counts)}`);
    assert(counts.chatbots === 1, `chatbots mismatch ${JSON.stringify(counts)}`);
    assert(counts.chatbotRules === 1, `chatbotRules mismatch ${JSON.stringify(counts)}`);
    assert(counts.jobs === 1, `jobs mismatch ${JSON.stringify(counts)}`);
    assert(counts.reminders === 1, `reminders mismatch ${JSON.stringify(counts)}`);
    assert(counts.auditLogs === 1, `auditLogs mismatch ${JSON.stringify(counts)}`);
    assert(counts.events === 1, `cutover event mismatch ${JSON.stringify(counts)}`);
    assert(counts.allEvents >= 4, `event mismatch ${JSON.stringify(counts)}`);
    assertWhatsappIdentity(readWhatsappIdentity(v2DbPath), "first apply");
    assertMediaCopied(readMigratedMedia(v2DbPath), mediaTargetRoot);

    const applyAgain = runScript({
      v1DbPath,
      v2DbPath,
      backupDir,
      mode: "apply",
      confirm: true,
      v1StorageRoot: tempDir,
      mediaTargetRoot,
    });
    assert(applyAgain.includes("status=applied"), applyAgain);
    const afterSecondApply = readV2Counts(v2DbPath);
    assert(afterSecondApply.contacts === 2, `contacts not idempotent ${JSON.stringify(afterSecondApply)}`);
    assert(afterSecondApply.conversations === 2, `conversations not idempotent ${JSON.stringify(afterSecondApply)}`);
    assert(afterSecondApply.messages === 2, `messages not idempotent ${JSON.stringify(afterSecondApply)}`);
    assert(afterSecondApply.campaigns === 1, `campaigns not idempotent ${JSON.stringify(afterSecondApply)}`);
    assert(afterSecondApply.recipients === 1, `recipients not idempotent ${JSON.stringify(afterSecondApply)}`);
    assert(afterSecondApply.automations === 1, `automations not idempotent ${JSON.stringify(afterSecondApply)}`);
    assert(afterSecondApply.chatbots === 1, `chatbots not idempotent ${JSON.stringify(afterSecondApply)}`);
    assert(afterSecondApply.chatbotRules === 1, `chatbotRules not idempotent ${JSON.stringify(afterSecondApply)}`);
    assert(afterSecondApply.jobs === 1, `jobs not idempotent ${JSON.stringify(afterSecondApply)}`);
    assert(afterSecondApply.reminders === 1, `reminders not idempotent ${JSON.stringify(afterSecondApply)}`);
    assertWhatsappIdentity(readWhatsappIdentity(v2DbPath), "second apply");

    console.log("v215-cutover-apply-smoke|dryRun=ok|apply=ok|idempotent=ok|status=closed");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function runScript(input: {
  v1DbPath: string;
  v2DbPath: string;
  backupDir: string;
  v1StorageRoot: string;
  mediaTargetRoot: string;
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
        V215_V1_STORAGE_ROOT: input.v1StorageRoot,
        V215_MEDIA_TARGET_ROOT: input.mediaTargetRoot,
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
      CREATE TABLE jobs (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        dedupe_key TEXT,
        scheduled_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE automations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        category TEXT,
        trigger_json TEXT,
        condition_json TEXT,
        actions_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE automation_actions (
        id TEXT PRIMARY KEY,
        automation_id TEXT NOT NULL,
        type TEXT NOT NULL,
        payload_json TEXT
      );
      CREATE TABLE automation_runs (
        id TEXT PRIMARY KEY,
        automation_id TEXT NOT NULL,
        contact_id TEXT,
        conversation_id TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE automation_contact_state (
        id TEXT PRIMARY KEY,
        automation_id TEXT NOT NULL,
        contact_id TEXT NOT NULL,
        state_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE attendants (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT,
        role TEXT,
        is_active INTEGER
      );
      CREATE TABLE chatbots (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        channel TEXT,
        status TEXT NOT NULL,
        fallback_message TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE chatbot_rules (
        id TEXT PRIMARY KEY,
        chatbot_id TEXT NOT NULL,
        name TEXT NOT NULL,
        priority INTEGER,
        match_json TEXT,
        actions_json TEXT,
        is_active INTEGER,
        created_at TEXT NOT NULL
      );
      CREATE TABLE reminders (
        id TEXT PRIMARY KEY,
        contact_id TEXT,
        conversation_id TEXT,
        title TEXT NOT NULL,
        notes TEXT,
        due_at TEXT NOT NULL,
        status TEXT NOT NULL,
        completed_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE audit_logs (
        id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        target_table TEXT NOT NULL,
        target_id TEXT,
        before_json TEXT,
        after_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE system_logs (
        id TEXT PRIMARY KEY,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE data_lake_sources (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
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
    db.prepare(
      "INSERT INTO jobs (id, type, status, payload_json, dedupe_key, scheduled_at, created_at) VALUES ('job1', 'send-message', 'pending', ?, 'v1-job1', ?, ?)",
    ).run(JSON.stringify({ contactId: "c1", body: "Oi" }), now, now);
    db.prepare(
      `INSERT INTO automations
       (id, name, status, category, trigger_json, condition_json, actions_json, created_at)
       VALUES ('auto1', 'Auto V1', 'active', 'followup', ?, '{}', '[]', ?)`,
    ).run(JSON.stringify({ type: "message_received" }), now);
    db.prepare(
      "INSERT INTO automation_actions (id, automation_id, type, payload_json) VALUES ('act1', 'auto1', 'send_step', ?)",
    ).run(JSON.stringify({ body: "Resposta" }));
    db.prepare(
      "INSERT INTO automation_runs (id, automation_id, contact_id, conversation_id, status, created_at) VALUES ('run1', 'auto1', 'c1', 'conv1', 'completed', ?)",
    ).run(now);
    db.prepare(
      "INSERT INTO automation_contact_state (id, automation_id, contact_id, state_json, created_at) VALUES ('state1', 'auto1', 'c1', '{}', ?)",
    ).run(now);
    db.prepare(
      "INSERT INTO attendants (id, name, email, role, is_active) VALUES ('att1', 'Atendente', 'att@nuoma.local', 'attendant', 1)",
    ).run();
    db.prepare(
      "INSERT INTO chatbots (id, name, channel, status, fallback_message, created_at) VALUES ('bot1', 'Bot V1', 'whatsapp', 'active', 'Fallback', ?)",
    ).run(now);
    db.prepare(
      "INSERT INTO chatbot_rules (id, chatbot_id, name, priority, match_json, actions_json, is_active, created_at) VALUES ('rule1', 'bot1', 'Oi', 10, ?, ?, 1, ?)",
    ).run(JSON.stringify({ type: "keyword", keywords: ["oi"] }), JSON.stringify([{ type: "send_message", body: "Olá" }]), now);
    db.prepare(
      "INSERT INTO reminders (id, contact_id, conversation_id, title, notes, due_at, status, completed_at, created_at) VALUES ('rem1', 'c1', 'conv1', 'Retornar', 'Nota', ?, 'open', NULL, ?)",
    ).run(now, now);
    db.prepare(
      "INSERT INTO audit_logs (id, action, target_table, target_id, before_json, after_json, created_at) VALUES ('audit1', 'create', 'contacts', 'c1', '{}', '{}', ?)",
    ).run(now);
    db.prepare("INSERT INTO system_logs (id, level, message, created_at) VALUES ('log1', 'info', 'ok', ?)").run(now);
    db.prepare("INSERT INTO data_lake_sources (id, name) VALUES ('dl1', 'ignored')").run();
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
      automations: scalar(db, "SELECT count(*) FROM automations"),
      chatbots: scalar(db, "SELECT count(*) FROM chatbots"),
      chatbotRules: scalar(db, "SELECT count(*) FROM chatbot_rules"),
      jobs: scalar(db, "SELECT count(*) FROM jobs"),
      reminders: scalar(db, "SELECT count(*) FROM reminders"),
      auditLogs: scalar(db, "SELECT count(*) FROM audit_logs"),
      events: scalar(db, "SELECT count(*) FROM system_events WHERE type = 'v215.cutover.applied'"),
      allEvents: scalar(db, "SELECT count(*) FROM system_events"),
    };
  } finally {
    db.close();
  }
}

function readWhatsappIdentity(dbPath: string) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const contact = db
      .prepare(
        `SELECT phone, phone_e164 AS phoneE164, wa_jid AS waJid
         FROM contacts
         WHERE user_id = 1 AND name = 'Gabriel'`,
      )
      .get() as { phone: string | null; phoneE164: string | null; waJid: string | null } | undefined;
    const conversation = db
      .prepare(
        `SELECT external_thread_id AS externalThreadId, wa_jid AS waJid
         FROM conversations
         WHERE user_id = 1 AND channel = 'whatsapp' AND title = 'Gabriel'`,
      )
      .get() as { externalThreadId: string; waJid: string | null } | undefined;
    return { contact, conversation };
  } finally {
    db.close();
  }
}

function readMigratedMedia(dbPath: string) {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db
      .prepare(
        `SELECT storage_path AS storagePath
         FROM media_assets
         WHERE sha256 = ?`,
      )
      .get("a".repeat(64)) as { storagePath: string } | undefined;
  } finally {
    db.close();
  }
}

function assertMediaCopied(media: ReturnType<typeof readMigratedMedia>, mediaTargetRoot: string): void {
  assert(media?.storagePath, `media storage path missing ${JSON.stringify(media)}`);
  const absolutePath = path.resolve(repoRoot, media.storagePath);
  assert(absolutePath.startsWith(mediaTargetRoot), `media copied to wrong root ${absolutePath}`);
  assert(nodeFs.existsSync(absolutePath), `media file was not copied: ${absolutePath}`);
}

function assertWhatsappIdentity(
  proof: ReturnType<typeof readWhatsappIdentity>,
  phase: string,
): void {
  assert(
    proof.contact?.phone === "5531982066263",
    `${phase} contact phone mismatch ${JSON.stringify(proof)}`,
  );
  assert(
    proof.contact.phoneE164 === "+5531982066263",
    `${phase} contact phone_e164 mismatch ${JSON.stringify(proof)}`,
  );
  assert(
    proof.contact.waJid === "5531982066263@s.whatsapp.net",
    `${phase} contact wa_jid mismatch ${JSON.stringify(proof)}`,
  );
  assert(
    proof.conversation?.externalThreadId === "5531982066263",
    `${phase} conversation external_thread_id mismatch ${JSON.stringify(proof)}`,
  );
  assert(
    proof.conversation.waJid === "5531982066263@s.whatsapp.net",
    `${phase} conversation wa_jid mismatch ${JSON.stringify(proof)}`,
  );
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
