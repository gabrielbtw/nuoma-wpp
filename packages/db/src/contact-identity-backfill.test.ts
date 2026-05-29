import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createRepositories, openDb, runMigrations, type DbHandle } from "./index.js";

let tempDir: string;
let handle: DbHandle;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nuoma-v2-identity-"));
  handle = openDb(path.join(tempDir, "test.db"));
  await runMigrations(handle, path.resolve(import.meta.dirname, "./migrations"));
});

afterEach(async () => {
  handle.close();
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("contact identity backfill", () => {
  it("persists phone_e164 and wa_jid for raw SQL contact inserts and phone updates", async () => {
    const repos = createRepositories(handle);
    const user = await repos.users.create({
      email: "identity-backfill@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const now = new Date().toISOString();

    const cases = [
      { raw: "31982066263", e164: "+5531982066263", jid: "5531982066263@s.whatsapp.net" },
      { raw: "5531982066263", e164: "+5531982066263", jid: "5531982066263@s.whatsapp.net" },
      {
        raw: "+55 31 9 8206-6263",
        e164: "+5531982066263",
        jid: "5531982066263@s.whatsapp.net",
      },
    ];

    for (const [index, testCase] of cases.entries()) {
      const result = handle.raw
        .prepare(
          `INSERT INTO contacts
           (user_id, name, phone, primary_channel, status, created_at, updated_at)
           VALUES (?, ?, ?, 'whatsapp', 'active', ?, ?)`,
        )
        .run(user.id, `Raw SQL ${index}`, testCase.raw, now, now);

      const rawRow = handle.raw
        .prepare("SELECT phone, phone_e164, wa_jid FROM contacts WHERE id = ?")
        .get(result.lastInsertRowid) as
        | { phone: string; phone_e164: string | null; wa_jid: string | null }
        | undefined;

      expect(rawRow).toEqual({
        phone: testCase.raw,
        phone_e164: testCase.e164,
        wa_jid: testCase.jid,
      });
    }

    const updatedId = handle.raw
      .prepare("SELECT id FROM contacts WHERE phone = ?")
      .get("31982066263") as { id: number };
    handle.raw
      .prepare("UPDATE contacts SET phone = ?, updated_at = ? WHERE id = ?")
      .run("+55 31 9 8206-6264", now, updatedId.id);

    const updatedRow = handle.raw
      .prepare("SELECT phone_e164, wa_jid FROM contacts WHERE id = ?")
      .get(updatedId.id) as { phone_e164: string | null; wa_jid: string | null } | undefined;
    expect(updatedRow).toEqual({
      phone_e164: "+5531982066264",
      wa_jid: "5531982066264@s.whatsapp.net",
    });
  });
});

describe("conversation identity backfill", () => {
  it("persists wa_jid for raw SQL WhatsApp conversation inserts and thread updates", async () => {
    const repos = createRepositories(handle);
    const user = await repos.users.create({
      email: "conversation-identity@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const now = new Date().toISOString();

    const cases = [
      { raw: "31982066263", jid: "5531982066263@s.whatsapp.net" },
      { raw: "5531982066263", jid: "5531982066263@s.whatsapp.net" },
      { raw: "+55 31 9 8206-6263", jid: "5531982066263@s.whatsapp.net" },
      { raw: "5531982066263@c.us", jid: "5531982066263@s.whatsapp.net" },
      { raw: "5531982066263@s.whatsapp.net", jid: "5531982066263@s.whatsapp.net" },
    ];

    for (const [index, testCase] of cases.entries()) {
      const caseUser = await repos.users.create({
        email: `conversation-identity-${index}@nuoma.local`,
        passwordHash: "hash",
        role: "admin",
      });
      const result = handle.raw
        .prepare(
          `INSERT INTO conversations
           (user_id, channel, external_thread_id, title, created_at, updated_at)
           VALUES (?, 'whatsapp', ?, ?, ?, ?)`,
        )
        .run(caseUser.id, testCase.raw, `Raw SQL conversation ${index}`, now, now);

      const rawRow = handle.raw
        .prepare("SELECT external_thread_id, wa_jid FROM conversations WHERE id = ?")
        .get(result.lastInsertRowid) as
        | { external_thread_id: string; wa_jid: string | null }
        | undefined;

      expect(rawRow).toEqual({
        external_thread_id: testCase.raw,
        wa_jid: testCase.jid,
      });
    }

    const result = handle.raw
      .prepare(
        `INSERT INTO conversations
         (user_id, channel, external_thread_id, title, created_at, updated_at)
         VALUES (?, 'whatsapp', ?, 'Raw SQL update target', ?, ?)`,
      )
      .run(user.id, "31982066264", now, now);
    handle.raw
      .prepare("UPDATE conversations SET external_thread_id = ?, updated_at = ? WHERE id = ?")
      .run("+55 31 9 8206-6265", now, result.lastInsertRowid);

    const updatedRow = handle.raw
      .prepare("SELECT wa_jid FROM conversations WHERE id = ?")
      .get(result.lastInsertRowid) as { wa_jid: string | null } | undefined;
    expect(updatedRow).toEqual({
      wa_jid: "5531982066265@s.whatsapp.net",
    });
  });

  it("backfills legacy conversation wa_jid when migration 0014 runs", async () => {
    const before0014Migrations = await copyMigrationsThrough(13);
    const legacyHandle = openDb(path.join(tempDir, "legacy-conversation.db"));
    try {
      await runMigrations(legacyHandle, before0014Migrations);
      const repos = createRepositories(legacyHandle);
      const user = await repos.users.create({
        email: "legacy-conversation-identity@nuoma.local",
        passwordHash: "hash",
        role: "admin",
      });
      const now = new Date().toISOString();
      const result = legacyHandle.raw
        .prepare(
          `INSERT INTO conversations
           (user_id, channel, external_thread_id, title, created_at, updated_at)
           VALUES (?, 'whatsapp', ?, ?, ?, ?)`,
        )
        .run(user.id, "5531982066263@c.us", "Legacy WA thread", now, now);

      const before = legacyHandle.raw
        .prepare("SELECT wa_jid FROM conversations WHERE id = ?")
        .get(result.lastInsertRowid) as { wa_jid: string | null } | undefined;
      expect(before).toEqual({ wa_jid: null });

      await runMigrations(legacyHandle, path.resolve(import.meta.dirname, "./migrations"));

      const after = legacyHandle.raw
        .prepare("SELECT external_thread_id, wa_jid FROM conversations WHERE id = ?")
        .get(result.lastInsertRowid) as
        | { external_thread_id: string; wa_jid: string | null }
        | undefined;
      expect(after).toEqual({
        external_thread_id: "5531982066263@c.us",
        wa_jid: "5531982066263@s.whatsapp.net",
      });
    } finally {
      legacyHandle.close();
    }
  });

  it("archives duplicate active WhatsApp conversations before enforcing wa_jid uniqueness", async () => {
    const before0015Migrations = await copyMigrationsThrough(14);
    const legacyHandle = openDb(path.join(tempDir, "duplicate-conversation.db"));
    try {
      await runMigrations(legacyHandle, before0015Migrations);
      const repos = createRepositories(legacyHandle);
      const user = await repos.users.create({
        email: "duplicate-conversation-identity@nuoma.local",
        passwordHash: "hash",
        role: "admin",
      });
      const now = new Date().toISOString();
      const older = legacyHandle.raw
        .prepare(
          `INSERT INTO conversations
           (user_id, channel, external_thread_id, title, last_message_at, created_at, updated_at)
           VALUES (?, 'whatsapp', ?, ?, ?, ?, ?)`,
        )
        .run(
          user.id,
          "5531982066263@c.us",
          "Older duplicate",
          "2026-04-30T12:00:00.000Z",
          now,
          now,
        );
      const newer = legacyHandle.raw
        .prepare(
          `INSERT INTO conversations
           (user_id, channel, external_thread_id, title, last_message_at, created_at, updated_at)
           VALUES (?, 'whatsapp', ?, ?, ?, ?, ?)`,
        )
        .run(
          user.id,
          "5531982066263@s.whatsapp.net",
          "Newer duplicate",
          "2026-04-30T12:05:00.000Z",
          now,
          now,
        );

      await runMigrations(legacyHandle, path.resolve(import.meta.dirname, "./migrations"));

      const rows = legacyHandle.raw
        .prepare(
          `SELECT id, wa_jid, is_archived
           FROM conversations
           WHERE id IN (?, ?)
           ORDER BY id`,
        )
        .all(older.lastInsertRowid, newer.lastInsertRowid) as Array<{
        id: number;
        wa_jid: string | null;
        is_archived: number;
      }>;

      expect(rows).toEqual([
        {
          id: Number(older.lastInsertRowid),
          wa_jid: "5531982066263@s.whatsapp.net",
          is_archived: 1,
        },
        {
          id: Number(newer.lastInsertRowid),
          wa_jid: "5531982066263@s.whatsapp.net",
          is_archived: 0,
        },
      ]);
      expect(() =>
        legacyHandle.raw
          .prepare(
            `INSERT INTO conversations
             (user_id, channel, external_thread_id, title, created_at, updated_at)
             VALUES (?, 'whatsapp', ?, 'Third active duplicate', ?, ?)`,
          )
          .run(user.id, "5531982066263", now, now),
      ).toThrow(/UNIQUE constraint failed/i);

      expect(() =>
        legacyHandle.raw
          .prepare(
            `INSERT INTO conversations
             (user_id, channel, external_thread_id, wa_jid, title, is_archived, created_at, updated_at)
             VALUES (?, 'whatsapp', ?, ?, 'Archived duplicate', 1, ?, ?)`,
          )
          .run(user.id, "legacy-archived-thread", "5531982066263@s.whatsapp.net", now, now),
      ).not.toThrow();
    } finally {
      legacyHandle.close();
    }
  });
});

async function copyMigrationsThrough(maxIdx: number): Promise<string> {
  const source = path.resolve(import.meta.dirname, "./migrations");
  const target = path.join(tempDir, `migrations-through-${maxIdx}`);
  await fs.mkdir(path.join(target, "meta"), { recursive: true });

  const files = await fs.readdir(source);
  await Promise.all(
    files
      .filter((file) => {
        const match = /^(\d{4})_.*\.sql$/.exec(file);
        return match ? Number(match[1]) <= maxIdx : false;
      })
      .map((file) => fs.copyFile(path.join(source, file), path.join(target, file))),
  );

  for (const snapshot of ["0000_snapshot.json", "0001_snapshot.json"]) {
    await fs.copyFile(path.join(source, "meta", snapshot), path.join(target, "meta", snapshot));
  }

  const journalPath = path.join(source, "meta", "_journal.json");
  const journal = JSON.parse(await fs.readFile(journalPath, "utf8")) as {
    entries: Array<{ idx: number }>;
  };
  journal.entries = journal.entries.filter((entry) => entry.idx <= maxIdx);
  await fs.writeFile(path.join(target, "meta", "_journal.json"), `${JSON.stringify(journal, null, 2)}\n`);

  return target;
}
