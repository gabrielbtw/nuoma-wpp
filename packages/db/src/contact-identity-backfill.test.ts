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
