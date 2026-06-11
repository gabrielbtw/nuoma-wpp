#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import path from "node:path";
import Database from "better-sqlite3";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const dbArgIndex = process.argv.indexOf("--db");
const databasePath =
  dbArgIndex >= 0 && process.argv[dbArgIndex + 1]
    ? path.resolve(process.argv[dbArgIndex + 1])
    : path.join(rootDir, "data", "nuoma-v2.db");
const nowArgIndex = process.argv.indexOf("--now");
const nowIso =
  nowArgIndex >= 0 && process.argv[nowArgIndex + 1]
    ? new Date(process.argv[nowArgIndex + 1]).toISOString()
    : new Date().toISOString();
const nowMs = Date.parse(nowIso);
if (!Number.isFinite(nowMs)) {
  throw new Error(`Invalid --now value: ${process.argv[nowArgIndex + 1]}`);
}

function swappedFutureTimestamp(value, observedAtUtc) {
  const match = String(value ?? "").match(
    /^(\d{4})-(\d{2})-(\d{2})(T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2}))$/,
  );
  if (!match) {
    return null;
  }
  const [, year, month, day, suffix] = match;
  const originalMs = Date.parse(value);
  const observedMs = Date.parse(observedAtUtc);
  if (!Number.isFinite(originalMs) || !Number.isFinite(observedMs)) {
    return null;
  }
  if (originalMs <= nowMs + 24 * 60 * 60 * 1000) {
    return null;
  }
  const swappedMonth = Number(day);
  const swappedDay = Number(month);
  if (swappedMonth < 1 || swappedMonth > 12 || swappedDay < 1 || swappedDay > 31) {
    return null;
  }
  const candidate = `${year}-${day}-${month}${suffix}`;
  const candidateMs = Date.parse(candidate);
  if (!Number.isFinite(candidateMs)) {
    return null;
  }
  const parsed = new Date(candidateMs);
  if (parsed.getUTCFullYear() !== Number(year)) {
    return null;
  }
  if (candidateMs > observedMs + 36 * 60 * 60 * 1000) {
    return null;
  }
  return candidate;
}

function bestConversationLastMessageAt(db, conversationId) {
  const rows = db
    .prepare(
      `SELECT wa_displayed_at, observed_at_utc, created_at
       FROM messages
       WHERE conversation_id = ?
         AND deleted_at IS NULL`,
    )
    .all(conversationId);
  let best = null;
  for (const row of rows) {
    const timestamp = row.wa_displayed_at ?? row.observed_at_utc ?? row.created_at;
    const ms = Date.parse(timestamp);
    if (!Number.isFinite(ms)) {
      continue;
    }
    if (!best || ms > best.ms) {
      best = { ms, timestamp };
    }
  }
  return best?.timestamp ?? null;
}

const db = new Database(databasePath);
try {
  const rows = db
    .prepare(
      `SELECT m.id, m.conversation_id, m.wa_displayed_at, m.observed_at_utc
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.channel = 'whatsapp'
         AND m.wa_displayed_at IS NOT NULL
         AND m.deleted_at IS NULL`,
    )
    .all();
  const fixes = rows
    .map((row) => {
      const fixed = swappedFutureTimestamp(row.wa_displayed_at, row.observed_at_utc);
      return fixed
        ? {
            messageId: row.id,
            conversationId: row.conversation_id,
            from: row.wa_displayed_at,
            to: fixed,
          }
        : null;
    })
    .filter(Boolean);
  const affectedConversationIds = [...new Set(fixes.map((fix) => fix.conversationId))];

  if (apply && fixes.length > 0) {
    const updateMessage = db.prepare(
      `UPDATE messages
       SET wa_displayed_at = ?,
           updated_at = ?
       WHERE id = ?`,
    );
    const updateConversation = db.prepare(
      `UPDATE conversations
       SET last_message_at = ?,
           updated_at = ?
       WHERE id = ?`,
    );
    const tx = db.transaction(() => {
      const updatedAt = new Date().toISOString();
      for (const fix of fixes) {
        updateMessage.run(fix.to, updatedAt, fix.messageId);
      }
      for (const conversationId of affectedConversationIds) {
        const lastMessageAt = bestConversationLastMessageAt(db, conversationId);
        if (lastMessageAt) {
          updateConversation.run(lastMessageAt, updatedAt, conversationId);
        }
      }
    });
    tx();
  }

  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        databasePath,
        nowIso,
        messageFixes: fixes.length,
        affectedConversations: affectedConversationIds.length,
        sample: fixes.slice(0, 10),
      },
      null,
      2,
    ),
  );
} finally {
  db.close();
}
