import { randomUUID } from "node:crypto";
import { getDb } from "../db/connection.js";
import type { AttendantInput, AttendantRecord, AttendantStatus } from "../types/domain.js";

function nowIso() {
  return new Date().toISOString();
}

function parseVoiceSamples(input: string | null | undefined): string[] {
  if (!input) return [];
  try {
    const parsed = JSON.parse(input);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

function mapAttendant(row: Record<string, unknown>): AttendantRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    voiceSamples: parseVoiceSamples(row.voice_samples_json as string | null),
    xttsModelPath: (row.xtts_model_path as string | null) ?? null,
    status: String(row.status ?? "active") as AttendantStatus,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export function listAttendants(): AttendantRecord[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM attendants ORDER BY name ASC").all() as Array<Record<string, unknown>>;
  return rows.map(mapAttendant);
}

export function getAttendantById(id: string): AttendantRecord | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM attendants WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? mapAttendant(row) : null;
}

export function createAttendant(input: AttendantInput): AttendantRecord {
  const db = getDb();
  const id = randomUUID();
  const timestamp = nowIso();

  db.prepare(
    `INSERT INTO attendants (id, name, voice_samples_json, xtts_model_path, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.name,
    JSON.stringify(input.voiceSamples ?? []),
    input.xttsModelPath ?? null,
    input.status ?? "active",
    timestamp,
    timestamp
  );

  return getAttendantById(id)!;
}

export function updateAttendant(id: string, input: Partial<AttendantInput>): AttendantRecord | null {
  const existing = getAttendantById(id);
  if (!existing) return null;

  const db = getDb();
  const timestamp = nowIso();

  db.prepare(
    `UPDATE attendants SET name = ?, voice_samples_json = ?, xtts_model_path = ?, status = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    input.name ?? existing.name,
    JSON.stringify(input.voiceSamples ?? existing.voiceSamples),
    input.xttsModelPath !== undefined ? input.xttsModelPath : existing.xttsModelPath,
    input.status ?? existing.status,
    timestamp,
    id
  );

  return getAttendantById(id);
}

export function deleteAttendant(id: string): void {
  const db = getDb();
  db.prepare("DELETE FROM attendants WHERE id = ?").run(id);
}

export function setAttendantStatus(id: string, status: AttendantStatus): void {
  const db = getDb();
  db.prepare("UPDATE attendants SET status = ?, updated_at = ? WHERE id = ?").run(status, nowIso(), id);
}
