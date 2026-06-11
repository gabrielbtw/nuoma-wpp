import { randomUUID } from "node:crypto";
import { getDb, withSqliteBusyRetry } from "../db/connection.js";

function nowIso() {
  return new Date().toISOString();
}

export function recordSystemEvent(processName: string, level: string, message: string, meta?: Record<string, unknown>) {
  const db = getDb();
  withSqliteBusyRetry(() => {
    db.prepare(
      `
        INSERT INTO system_logs (id, process_name, level, message, meta_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `
    ).run(randomUUID(), processName, level, message, JSON.stringify(meta ?? {}), nowIso());
  });
}

export function listSystemEvents(limit = 200, offset = 0) {
  const db = getDb();
  return db
    .prepare("SELECT * FROM system_logs ORDER BY datetime(created_at) DESC LIMIT ? OFFSET ?")
    .all(limit, offset) as Array<Record<string, unknown>>;
}

export function listSystemEventsByProcess(processName: string, limit = 200, offset = 0) {
  const db = getDb();
  return db
    .prepare("SELECT * FROM system_logs WHERE process_name = ? ORDER BY datetime(created_at) DESC LIMIT ? OFFSET ?")
    .all(processName, limit, offset) as Array<Record<string, unknown>>;
}

export function setSetting(key: string, value: unknown) {
  const db = getDb();
  const timestamp = nowIso();
  withSqliteBusyRetry(() => {
    db.prepare(
      `
        INSERT INTO app_settings (key, value_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
      `
    ).run(key, JSON.stringify(value), timestamp);
  });
}

export function setSettings(input: Record<string, unknown>) {
  const db = getDb();
  const transaction = db.transaction(() => {
    for (const [key, value] of Object.entries(input)) {
      setSetting(key, value);
    }
  });

  transaction();
}

export function getSettings() {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM app_settings ORDER BY key ASC").all() as Array<{ key: string; value_json: string; updated_at: string }>;
  return rows.map((row) => ({
    key: row.key,
    value: JSON.parse(row.value_json),
    updatedAt: row.updated_at
  }));
}

export function setWorkerState(key: string, value: unknown) {
  const db = getDb();
  const timestamp = nowIso();
  withSqliteBusyRetry(() => {
    db.prepare(
      `
        INSERT INTO worker_state (key, value_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
      `
    ).run(key, JSON.stringify(value), timestamp);
  });
}

export function getWorkerState(key: string) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM worker_state WHERE key = ?").get(key) as
    | { key: string; value_json: string; updated_at: string }
    | undefined;

  if (!row) {
    return null;
  }

  return {
    key: row.key,
    value: JSON.parse(row.value_json),
    updatedAt: row.updated_at
  };
}
