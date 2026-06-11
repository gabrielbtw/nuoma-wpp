import Database from "better-sqlite3";
import { loadEnv } from "../config/env.js";
import { migrations } from "./migrations.js";
import { ensureRuntimeDirectories } from "../utils/fs.js";

let dbInstance: Database.Database | null = null;
const SQLITE_BUSY_CODES = new Set(["SQLITE_BUSY", "SQLITE_BUSY_RECOVERY", "SQLITE_BUSY_SNAPSHOT"]);

type TableInfoRow = {
  name: string;
  type: string;
};

function nowIso() {
  return new Date().toISOString();
}

function sleepSync(ms: number) {
  if (ms <= 0) {
    return;
  }

  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function isSqliteBusyError(error: unknown) {
  const code =
    typeof error === "object" && error && "code" in error ? String(error.code ?? "") : "";
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return SQLITE_BUSY_CODES.has(code) || message.includes("database is locked");
}

export function withSqliteBusyRetry<T>(
  operation: () => T,
  options?: {
    maxAttempts?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
  },
) {
  const maxAttempts = Math.max(1, options?.maxAttempts ?? 5);
  const initialDelayMs = Math.max(1, options?.initialDelayMs ?? 25);
  const maxDelayMs = Math.max(initialDelayMs, options?.maxDelayMs ?? 250);

  let attempt = 0;
  while (true) {
    try {
      return operation();
    } catch (error) {
      attempt += 1;
      if (!isSqliteBusyError(error) || attempt >= maxAttempts) {
        throw error;
      }

      const delay = Math.min(maxDelayMs, initialDelayMs * 2 ** (attempt - 1));
      sleepSync(delay);
    }
  }
}

function runMigrations(db: Database.Database) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);",
  );
  const applied = db.prepare("SELECT id FROM _migrations").all() as Array<{ id: string }>;
  const appliedIds = new Set(applied.map((entry) => entry.id));
  const markApplied = db.prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)");

  for (const migration of migrations) {
    if (appliedIds.has(migration.id)) {
      continue;
    }

    if ("transaction" in migration && migration.transaction === false) {
      db.exec(migration.sql);
      markApplied.run(migration.id, nowIso());
      continue;
    }

    const transaction = db.transaction(() => {
      db.exec(migration.sql);
      markApplied.run(migration.id, nowIso());
    });

    transaction();
  }
}

function tableExists(db: Database.Database, tableName: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName);
  return Boolean(row);
}

function tableInfo(db: Database.Database, tableName: string): TableInfoRow[] {
  if (!tableExists(db, tableName)) {
    return [];
  }

  return db.prepare(`PRAGMA table_info(${tableName})`).all() as TableInfoRow[];
}

export function assertNoV2Schema(db: Database.Database, databasePath: string): void {
  const contactsColumns = tableInfo(db, "contacts");
  const hasContacts = contactsColumns.length > 0;
  const contactIdColumn = contactsColumns.find((column) => column.name === "id");
  const hasUserId = contactsColumns.some((column) => column.name === "user_id");
  const hasDrizzleMigrations = tableExists(db, "__drizzle_migrations");

  if (!hasContacts && !hasDrizzleMigrations) {
    return;
  }

  const v2Signals = [
    hasDrizzleMigrations ? "__drizzle_migrations table" : null,
    contactIdColumn?.type.toUpperCase().includes("INT") ? "contacts.id INTEGER" : null,
    hasUserId ? "contacts.user_id present" : null,
  ].filter(Boolean);

  if (v2Signals.length === 0) {
    return;
  }

  throw new Error(
    `NUOMA_DB_STACK_MISMATCH: DATABASE_PATH points to the runtime-v2-active-candidate SQLite schema (${v2Signals.join(
      ", ",
    )}). Use the legacy-maintenance database for @nuoma/core or run the approved V2.15 migration/cutover path. DATABASE_PATH=${databasePath}`,
  );
}

export function getDb() {
  if (dbInstance) {
    return dbInstance;
  }

  const env = loadEnv();
  ensureRuntimeDirectories();

  const db = new Database(env.DATABASE_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 5000");

  try {
    assertNoV2Schema(db, env.DATABASE_PATH);
    runMigrations(db);
  } catch (error) {
    db.close();
    throw error;
  }

  dbInstance = db;
  return db;
}

export function closeDb() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
