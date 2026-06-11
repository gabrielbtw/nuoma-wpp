---
name: nuoma-migration
description: Create a new SQLite migration for the Nuoma database. Generates proper migration entry in the migrations array.
user_invocable: true
---

# /nuoma-migration — Create Database Migration

You are creating a new SQLite migration for Nuoma WPP.

## Context
- Migrations live in `packages/core/src/db/migrations.ts`
- They are an array of `{ id: string, sql: string, transaction?: boolean }` objects
- Current migrations: 0001 through 0007
- SQLite dialect — no ALTER COLUMN, use table recreation if needed
- Use `transaction: false` only when recreating tables (dropping + creating)

## Steps

### 1. Read current migrations
Read `packages/core/src/db/migrations.ts` to understand the current schema and find the next migration ID.

### 2. Design the migration
- Ask the user what tables/columns to add/modify
- Generate the SQL following existing patterns:
  - `CREATE TABLE IF NOT EXISTS` for new tables
  - `ALTER TABLE ... ADD COLUMN` for new columns
  - `CREATE INDEX IF NOT EXISTS` for indexes
  - Use `TEXT` for strings, `INTEGER` for numbers/booleans, `REAL` for decimals
  - Always include `created_at TEXT NOT NULL DEFAULT (datetime('now'))` on new tables
  - Always include `updated_at TEXT NOT NULL DEFAULT (datetime('now'))` on new tables

### 3. Add the migration
Append the new migration to the `migrations` array in `packages/core/src/db/migrations.ts`.

### 4. Update types
If the migration adds new fields, update `packages/core/src/types/domain.ts`:
- Add to relevant Record interfaces
- Add to relevant input/patch schemas if user-facing
- Add new enum value arrays if needed

### 5. Validate
```bash
npm run typecheck --workspace @nuoma/core
npm run db:migrate
```

### 6. Summary
List: migration ID, tables/columns affected, new types added.
