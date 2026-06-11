// Usage: npx tsx scripts/resync-history.ts
// Deletes all snapshot messages from WhatsApp conversations.
// Next sync cycle will re-read all conversations via Tier 2.
// Safe: automation, campaign, manual messages are NOT affected.

import Database from "better-sqlite3";
import path from "node:path";

const DB_PATH = process.env.DATABASE_PATH || "./storage/database/nuoma.db";
const db = new Database(path.resolve(DB_PATH));

// Count before deletion
const before = db.prepare(`
  SELECT
    COUNT(DISTINCT c.id) as conversations,
    COUNT(m.id) as messages
  FROM messages m
  JOIN conversations c ON c.id = m.conversation_id
  WHERE c.channel = 'whatsapp'
    AND m.external_id IS NULL
    AND json_extract(m.meta_json, '$.source') = 'snapshot'
`).get() as { conversations: number; messages: number };

if (before.messages === 0) {
  console.log("\nNo snapshot messages found. Nothing to delete.\n");
  db.close();
  process.exit(0);
}

console.log(`\nFound ${before.messages} snapshot messages across ${before.conversations} WhatsApp conversations.`);
console.log("Deleting...");

const result = db.prepare(`
  DELETE FROM messages
  WHERE id IN (
    SELECT m.id FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE c.channel = 'whatsapp'
      AND m.external_id IS NULL
      AND json_extract(m.meta_json, '$.source') = 'snapshot'
  )
`).run();

console.log(`Deleted ${result.changes} snapshot messages.`);

// Count remaining
const remaining = db.prepare(`
  SELECT COUNT(*) as cnt FROM messages m
  JOIN conversations c ON c.id = m.conversation_id
  WHERE c.channel = 'whatsapp'
`).get() as { cnt: number };

console.log(`Remaining WhatsApp messages (automation/campaign/manual): ${remaining.cnt}`);
console.log("Next sync cycle will re-read all conversations via Tier 2.\n");

db.close();
