/**
 * @nuoma/db — Drizzle ORM wrapper for SQLite (better-sqlite3).
 *
 * V2.3 Persistence: schema, migrations, repository factory and backup helper.
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as path from "node:path";
import * as fs from "node:fs";

import * as schema from "./schema.js";

export type DatabaseUrl = string;
export type Db = ReturnType<typeof drizzle<typeof schema>>;
export const defaultMigrationsFolder = path.resolve(import.meta.dirname, "./migrations");

export interface DbHandle {
  db: Db;
  raw: Database.Database;
  url: DatabaseUrl;
  backupTo: (targetPath: string) => Promise<void>;
  close: () => void;
}

type TableInfoRow = {
  name: string;
  type: string;
};

function tableExists(raw: Database.Database, tableName: string): boolean {
  const row = raw
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName);
  return Boolean(row);
}

function tableInfo(raw: Database.Database, tableName: string): TableInfoRow[] {
  if (!tableExists(raw, tableName)) {
    return [];
  }

  return raw.prepare(`PRAGMA table_info(${tableName})`).all() as TableInfoRow[];
}

export function assertNoLegacySchema(raw: Database.Database, databaseUrl: string): void {
  const contactsColumns = tableInfo(raw, "contacts");
  const hasContacts = contactsColumns.length > 0;
  const contactIdColumn = contactsColumns.find((column) => column.name === "id");
  const hasUserId = contactsColumns.some((column) => column.name === "user_id");
  const hasLegacyMigrations = tableExists(raw, "_migrations");

  if (!hasContacts && !hasLegacyMigrations) {
    return;
  }

  const legacySignals = [
    hasLegacyMigrations ? "_migrations table" : null,
    contactIdColumn?.type.toUpperCase().includes("TEXT") ? "contacts.id TEXT" : null,
    hasContacts && !hasUserId ? "contacts.user_id missing" : null,
  ].filter(Boolean);

  if (legacySignals.length === 0) {
    return;
  }

  throw new Error(
    `NUOMA_DB_STACK_MISMATCH: DATABASE_URL points to a legacy-maintenance SQLite schema (${legacySignals.join(
      ", ",
    )}). Use the V2 Drizzle database for @nuoma/db or run the approved V2.15 migration/cutover first. DATABASE_URL=${databaseUrl}`,
  );
}

export function openDb(url: DatabaseUrl): DbHandle {
  const dir = path.dirname(url);
  if (dir && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const raw = new Database(url);
  raw.pragma("journal_mode = WAL");
  raw.pragma("synchronous = NORMAL");
  raw.pragma("foreign_keys = ON");
  raw.pragma("busy_timeout = 5000");

  try {
    assertNoLegacySchema(raw, url);
  } catch (error) {
    raw.close();
    throw error;
  }

  const db = drizzle(raw, { schema });

  return {
    db,
    raw,
    url,
    backupTo: async (targetPath: string) => {
      const targetDir = path.dirname(targetPath);
      if (targetDir && !fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      await raw.backup(targetPath);
    },
    close: () => raw.close(),
  };
}

export async function runMigrations(
  handle: DbHandle,
  migrationsFolder = defaultMigrationsFolder,
): Promise<void> {
  await migrate(handle.db, { migrationsFolder });
}

export { schema };
export * from "./repositories.js";
export * from "./schema.js";
