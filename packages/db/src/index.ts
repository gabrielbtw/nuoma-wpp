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
