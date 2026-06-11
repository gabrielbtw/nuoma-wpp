// Usage: npx tsx scripts/verify-sync.ts

import Database from "better-sqlite3";
import path from "node:path";

const DB_PATH = process.env.DATABASE_PATH || "./storage/database/nuoma.db";
const db = new Database(path.resolve(DB_PATH));

interface Row {
  title: string;
  last_message_at: string | null;
  last_message_preview: string | null;
  msg_count: number;
  placeholder_count: number;
}

const rows = db.prepare(`
  SELECT
    c.title,
    c.last_message_at,
    c.last_message_preview,
    (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) as msg_count,
    (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND json_extract(m.meta_json, '$.placeholder') = 1) as placeholder_count
  FROM conversations c
  WHERE c.channel = 'whatsapp'
  ORDER BY datetime(COALESCE(c.last_message_at, c.updated_at)) DESC
  LIMIT 200
`).all() as Row[];

const now = new Date();
const today = now.toISOString().slice(0, 10);

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const dateStr = d.toISOString().slice(0, 10);
  const timeStr = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
  if (dateStr === today) return `${timeStr} hoje`;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (dateStr === yesterday.toISOString().slice(0, 10)) return `${timeStr} ontem`;
  return `${timeStr} ${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" })}`;
}

function truncate(s: string | null, max: number): string {
  if (!s) return "—";
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

console.log(`\nWhatsApp Sync Verification — ${now.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`);
console.log("─".repeat(90));
console.log(` ${"#".padStart(3)} │ ${"Contato".padEnd(22)} │ ${"Msgs".padStart(5)} │ ${"Última msg".padEnd(16)} │ Preview`);
console.log("─".repeat(90));

let withMsgs = 0, placeholders = 0, withoutMsgs = 0;

for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  const num = String(i + 1).padStart(3);
  const title = truncate(r.title, 22).padEnd(22);
  const msgs = String(r.msg_count).padStart(5);
  const time = formatTime(r.last_message_at).padEnd(16);
  const previewText = r.placeholder_count > 0 && r.msg_count === r.placeholder_count
    ? "(placeholder)"
    : truncate(r.last_message_preview, 25);

  console.log(` ${num} │ ${title} │ ${msgs} │ ${time} │ ${previewText}`);

  if (r.msg_count === 0) withoutMsgs++;
  else if (r.placeholder_count > 0 && r.msg_count === r.placeholder_count) placeholders++;
  else withMsgs++;
}

console.log("─".repeat(90));
console.log(`Total: ${rows.length} convs | Com msgs: ${withMsgs} | Placeholders: ${placeholders} | Sem msgs: ${withoutMsgs}`);
console.log();

db.close();
