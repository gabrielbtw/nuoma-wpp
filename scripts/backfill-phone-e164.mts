import * as fs from "node:fs/promises";
import * as path from "node:path";

import Database from "better-sqlite3";
import { normalizePhoneE164, normalizeWaJid } from "@nuoma/contracts";

interface ContactRow {
  id: number;
  user_id: number;
  name: string;
  phone: string | null;
  phone_e164: string | null;
  wa_jid: string | null;
  deleted_at: string | null;
}

interface BackfillReport {
  generatedAt: string;
  databasePath: string;
  mode: "dry-run" | "apply";
  wouldUpdate: number;
  updated: number;
  skipped: number;
  invalid: Array<{ id: number; userId: number; name: string; phone: string | null }>;
  duplicates: Array<{
    userId: number;
    phoneE164: string;
    contacts: Array<{
      id: number;
      name: string;
      phone: string | null;
      waJid: string | null;
      deletedAt: string | null;
    }>;
  }>;
}

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (!arg.startsWith("--")) continue;
  const next = process.argv[index + 1];
  if (next && !next.startsWith("--")) {
    args.set(arg.slice(2), next);
    index += 1;
  } else {
    args.set(arg.slice(2), "true");
  }
}

const databasePath = resolveDatabasePath(
  args.get("db") ?? process.env.DATABASE_URL ?? path.resolve("data/nuoma-v2.db"),
);
const outputPath = path.resolve(args.get("out") ?? "data/phone-merge-candidates.json");
const apply = args.has("apply");

const db = new Database(databasePath);
try {
  const columns = db.prepare("PRAGMA table_info(contacts)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "phone_e164")) {
    throw new Error("contacts.phone_e164 is missing; run DB migrations before backfill.");
  }
  const hasWaJid = columns.some((column) => column.name === "wa_jid");

  const rows = db
    .prepare(
      `
        SELECT id, user_id, name, phone, phone_e164, ${hasWaJid ? "wa_jid" : "NULL AS wa_jid"}, deleted_at
        FROM contacts
        ORDER BY user_id, id
      `,
    )
    .all() as ContactRow[];

  const update = db.prepare(
    hasWaJid
      ? "UPDATE contacts SET phone_e164 = ?, wa_jid = ?, updated_at = ? WHERE id = ?"
      : "UPDATE contacts SET phone_e164 = ?, updated_at = ? WHERE id = ?",
  );
  const invalid: BackfillReport["invalid"] = [];
  const byIdentity = new Map<string, ContactRow[]>();
  let wouldUpdate = 0;
  let updated = 0;
  let skipped = 0;
  const now = new Date().toISOString();

  const applyBackfill = db.transaction(() => {
    for (const row of rows) {
      const phoneE164 = normalizePhoneE164(row.phone);
      const waJid = normalizeWaJid(row.phone);
      if (!phoneE164) {
        if (row.phone) {
          invalid.push({ id: row.id, userId: row.user_id, name: row.name, phone: row.phone });
        }
        skipped += 1;
        continue;
      }

      const key = `${row.user_id}:${phoneE164}`;
      byIdentity.set(key, [...(byIdentity.get(key) ?? []), row]);

      if (row.phone_e164 === phoneE164 && (!hasWaJid || row.wa_jid === waJid)) {
        skipped += 1;
        continue;
      }

      wouldUpdate += 1;
      if (apply) {
        if (hasWaJid) {
          update.run(phoneE164, waJid, now, row.id);
        } else {
          update.run(phoneE164, now, row.id);
        }
        updated += 1;
      }
      row.phone_e164 = phoneE164;
      row.wa_jid = waJid;
    }
  });

  applyBackfill();

  const duplicates = [...byIdentity.entries()]
    .filter(([, contacts]) => contacts.length > 1)
    .map(([key, contacts]) => {
      const [userId, phoneE164] = key.split(":");
      return {
        userId: Number(userId),
        phoneE164,
        contacts: contacts.map((contact) => ({
          id: contact.id,
          name: contact.name,
          phone: contact.phone,
          waJid: contact.wa_jid,
          deletedAt: contact.deleted_at,
        })),
      };
    });

  const report: BackfillReport = {
    generatedAt: now,
    databasePath,
    mode: apply ? "apply" : "dry-run",
    wouldUpdate,
    updated,
    skipped,
    invalid,
    duplicates,
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(
    `phone_e164/wa_jid backfill complete: mode=${report.mode} wouldUpdate=${wouldUpdate} updated=${updated} skipped=${skipped} invalid=${invalid.length} duplicates=${duplicates.length} waJidColumn=${hasWaJid} report=${outputPath}`,
  );
} finally {
  db.close();
}

function resolveDatabasePath(value: string): string {
  if (value.startsWith("file:")) {
    return new URL(value).pathname;
  }
  return path.resolve(value);
}
