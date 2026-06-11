import { randomUUID } from "node:crypto";
import { getDb } from "../db/connection.js";

function nowIso() {
  return new Date().toISOString();
}

export function createReminder(input: {
  contactId?: string | null;
  conversationId?: string | null;
  automationId?: string | null;
  title: string;
  dueAt: string;
  notes?: string | null;
}) {
  const db = getDb();
  const id = randomUUID();
  const timestamp = nowIso();
  db.prepare(
    `
      INSERT INTO reminders (id, contact_id, conversation_id, automation_id, title, due_at, status, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)
    `
  ).run(id, input.contactId ?? null, input.conversationId ?? null, input.automationId ?? null, input.title, input.dueAt, input.notes ?? null, timestamp, timestamp);

  return id;
}
