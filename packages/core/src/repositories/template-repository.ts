import { randomUUID } from "node:crypto";
import { getDb } from "../db/connection.js";
import type { TemplateRecord, TemplateInput } from "../types/domain.js";

function nowIso() {
  return new Date().toISOString();
}

function mapTemplate(row: Record<string, unknown>): TemplateRecord {
  return {
    id: row.id as string,
    name: row.name as string,
    contentType: row.content_type as TemplateRecord["contentType"],
    body: row.body as string,
    mediaPath: (row.media_path as string) ?? null,
    category: row.category as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  };
}

export function listTemplates(category?: string): TemplateRecord[] {
  const db = getDb();
  if (category) {
    const rows = db
      .prepare("SELECT * FROM message_templates WHERE category = ? ORDER BY name ASC")
      .all(category) as Array<Record<string, unknown>>;
    return rows.map(mapTemplate);
  }
  const rows = db
    .prepare("SELECT * FROM message_templates ORDER BY name ASC")
    .all() as Array<Record<string, unknown>>;
  return rows.map(mapTemplate);
}

export function getTemplate(templateId: string): TemplateRecord | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM message_templates WHERE id = ?")
    .get(templateId) as Record<string, unknown> | undefined;
  return row ? mapTemplate(row) : null;
}

export function createTemplate(input: TemplateInput): TemplateRecord {
  const db = getDb();
  const id = randomUUID();
  const now = nowIso();
  db.prepare(
    `INSERT INTO message_templates (id, name, content_type, body, media_path, category, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, input.name, input.contentType, input.body, input.mediaPath ?? null, input.category, now, now);
  return getTemplate(id)!;
}

export function updateTemplate(templateId: string, input: Partial<TemplateInput>): TemplateRecord | null {
  const db = getDb();
  const existing = getTemplate(templateId);
  if (!existing) return null;

  const fields: string[] = [];
  const values: unknown[] = [];

  if (input.name !== undefined) { fields.push("name = ?"); values.push(input.name); }
  if (input.contentType !== undefined) { fields.push("content_type = ?"); values.push(input.contentType); }
  if (input.body !== undefined) { fields.push("body = ?"); values.push(input.body); }
  if (input.mediaPath !== undefined) { fields.push("media_path = ?"); values.push(input.mediaPath); }
  if (input.category !== undefined) { fields.push("category = ?"); values.push(input.category); }

  if (fields.length === 0) return existing;

  fields.push("updated_at = ?");
  values.push(nowIso());
  values.push(templateId);

  db.prepare(`UPDATE message_templates SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getTemplate(templateId);
}

export function deleteTemplate(templateId: string): boolean {
  const db = getDb();
  const result = db.prepare("DELETE FROM message_templates WHERE id = ?").run(templateId);
  return result.changes > 0;
}
