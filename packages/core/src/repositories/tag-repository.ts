import { randomUUID } from "node:crypto";
import { getDb } from "../db/connection.js";
import { InputError } from "../errors/app-error.js";
import type { TagInput, TagRecord, TagType } from "../types/domain.js";

function nowIso() {
  return new Date().toISOString();
}

export function normalizeTagName(tagName: string) {
  return tagName.trim().replace(/\s+/g, " ").toLowerCase();
}

function mapTag(row: Record<string, unknown>): TagRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    normalizedName: String(row.normalized_name ?? normalizeTagName(String(row.name))),
    color: String(row.color ?? "#3ddc97"),
    type: String(row.type ?? "manual") as TagType,
    active: Boolean(row.active ?? 1),
    contactCount: Number(row.contact_count ?? 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function assertUniqueNameConflict(input: TagInput, existingId?: string) {
  const existing = getTagByName(input.name);
  if (existing && existing.id !== existingId) {
    throw new InputError("Já existe uma tag com esse nome");
  }
}

export function listTags() {
  const db = getDb();
  const rows = db
    .prepare(
      `
        SELECT
          t.*,
          COUNT(ct.contact_id) AS contact_count
        FROM tags t
        LEFT JOIN contact_tags ct ON ct.tag_id = t.id
        GROUP BY t.id
        ORDER BY t.active DESC, t.type ASC, t.name ASC
      `
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map(mapTag);
}

export function getTagById(tagId: string) {
  const db = getDb();
  const row = db
    .prepare(
      `
        SELECT
          t.*,
          COUNT(ct.contact_id) AS contact_count
        FROM tags t
        LEFT JOIN contact_tags ct ON ct.tag_id = t.id
        WHERE t.id = ?
        GROUP BY t.id
      `
    )
    .get(tagId) as Record<string, unknown> | undefined;
  return row ? mapTag(row) : null;
}

export function getTagByName(tagName: string) {
  const db = getDb();
  const row = db
    .prepare(
      `
        SELECT
          t.*,
          COUNT(ct.contact_id) AS contact_count
        FROM tags t
        LEFT JOIN contact_tags ct ON ct.tag_id = t.id
        WHERE t.normalized_name = ?
        GROUP BY t.id
      `
    )
    .get(normalizeTagName(tagName)) as Record<string, unknown> | undefined;
  return row ? mapTag(row) : null;
}

export function createTag(input: TagInput) {
  const db = getDb();
  const timestamp = nowIso();
  const id = randomUUID();
  assertUniqueNameConflict(input);

  db.prepare("INSERT INTO tags (id, name, normalized_name, color, type, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    id,
    input.name.trim().replace(/\s+/g, " "),
    normalizeTagName(input.name),
    input.color,
    input.type,
    input.active ? 1 : 0,
    timestamp,
    timestamp
  );

  return getTagById(id);
}

export function updateTag(tagId: string, input: TagInput) {
  const db = getDb();
  const timestamp = nowIso();
  assertUniqueNameConflict(input, tagId);

  db.prepare("UPDATE tags SET name = ?, normalized_name = ?, color = ?, type = ?, active = ?, updated_at = ? WHERE id = ?").run(
    input.name.trim().replace(/\s+/g, " "),
    normalizeTagName(input.name),
    input.color,
    input.type,
    input.active ? 1 : 0,
    timestamp,
    tagId
  );

  return getTagById(tagId);
}

export function deleteTag(tagId: string) {
  const db = getDb();
  db.prepare("DELETE FROM tags WHERE id = ?").run(tagId);
}

export function ensureTag(tagName: string, options?: { color?: string; type?: TagType; active?: boolean }) {
  const existing = getTagByName(tagName);
  if (existing) {
    if (options?.active === true && !existing.active) {
      return (
        updateTag(existing.id, {
          name: existing.name,
          color: options.color ?? existing.color,
          type: options.type ?? existing.type,
          active: true
        }) ?? existing
      );
    }

    return existing;
  }

  const created = createTag({
    name: tagName,
    color: options?.color ?? "#3ddc97",
    type: options?.type ?? "manual",
    active: options?.active ?? true
  });

  if (!created) {
    throw new Error(`Failed to ensure tag: ${tagName}`);
  }

  return created;
}
