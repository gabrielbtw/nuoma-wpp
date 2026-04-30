---
name: v1-to-v2-migration-dryrun
description: Run Spike 4 — dryrun V1 SQLite → V2 schema mapping. Read storage/database/nuoma.db (read-only copy), validate Drizzle schema candidate compiles, count rows per table, detect FK orphans, report fields without V2 equivalent. Generates the migration script skeleton for actual cutover later.
user_invocable: true
---

# /v1-to-v2-migration-dryrun — Migration Spike 4

You are running **Spike 4** from [`docs/architecture/V2_SPIKES.md`](../../docs/architecture/V2_SPIKES.md). Goal: prove that data from V1 SQLite can be mapped cleanly to a V2 Drizzle schema candidate, with row counts matching, FK orphans <5%, and decisions documented for any V1 fields without obvious V2 equivalent.

## Boundaries

- **NEVER write to V1 DB**. Always work on a copy.
- **NEVER write to V2 (it doesn't exist yet)**. This is dryrun only.
- **Skip `data_lake_*` tables** (out of scope).
- **Report orphans, don't auto-fix**.

## Workflow

### 1. Setup

```bash
mkdir -p experiments/spike-4-migration
cp storage/database/nuoma.db experiments/spike-4-migration/v1-readonly.db
chmod 444 experiments/spike-4-migration/v1-readonly.db
```

Files to create:
- `package.json` — deps: `better-sqlite3`, `drizzle-orm`, `drizzle-kit`, `tsx`.
- `read-v1.ts` — reads tables, computes counts, samples 5 rows each.
- `schema-v2-candidate.ts` — Drizzle schema mirroring V1 with `user_id` injection.
- `dryrun.ts` — transforms V1 rows → V2 structures in memory, validates types, detects orphans.
- `REPORT.md` — final report.

### 2. read-v1.ts — inventory

For each operational table (skip `data_lake_*`):

```ts
import Database from "better-sqlite3";

const db = new Database("./v1-readonly.db", { readonly: true });

const TABLES = [
  "contacts", "conversations", "messages", "jobs",
  "campaigns", "campaign_recipients", "campaign_executions",
  "automations", "automation_runs", "automation_contact_state",
  "tags", "contact_tags", "attendants",
  "chatbots", "chatbot_rules",
  "media_assets", "audit_logs", "system_events",
  "reminders", "contact_channels"
];

for (const table of TABLES) {
  const count = db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get();
  const sample = db.prepare(`SELECT * FROM ${table} LIMIT 5`).all();
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();

  console.log(`\n=== ${table} ===`);
  console.log(`Rows: ${count.c}`);
  console.log(`Columns: ${cols.map(c => `${c.name}:${c.type}`).join(", ")}`);
  console.log(`Sample:`, sample[0]);
}
```

Reports inventory + flags any table with unexpected schema (e.g., new column added during V1 maintenance).

### 3. schema-v2-candidate.ts — Drizzle proposal

Mirror V1 tables with these transformations:

- Add `users` table.
- Add `user_id INTEGER NOT NULL DEFAULT 1` to all operational tables.
- Add `dedupe_expires_at INTEGER` to `jobs`.
- Add `error_json TEXT` to `jobs`.
- UNIQUE composite `(conversation_id, external_id)` on `messages`.
- Composite indexes `(user_id, hot_field)` for hot paths.
- FK `onDelete: cascade` where it makes sense.

```ts
// schema-v2-candidate.ts (excerpt)
import { sqliteTable, integer, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["admin", "attendant", "viewer"] }).notNull().default("admin"),
  displayName: text("display_name"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const contacts = sqliteTable("contacts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  phone: text("phone"),
  name: text("name"),
  // ... etc
}, (t) => ({
  userPhoneIdx: uniqueIndex("idx_contacts_user_phone").on(t.userId, t.phone)
    .where(sql`phone IS NOT NULL AND trim(phone) <> ''`),
}));

// Mirror outras tabelas...
```

Validate it compiles:

```bash
npx tsc --noEmit schema-v2-candidate.ts
```

If errors → schema is invalid → report failure.

### 4. dryrun.ts — transform + validate

For each V1 row:

1. Transform to V2 structure (inject `user_id=1`).
2. Validate types via Zod schema (use `packages/contracts/` from V2 candidate or inline).
3. Check FK targets exist (e.g., `messages.conversation_id` exists in `conversations`).
4. Collect orphans.

```ts
// dryrun.ts (excerpt)
const orphans = { messages: [], conversations: [], jobs: [], /* ... */ };
const transformed = { contacts: [], conversations: [], messages: [], /* ... */ };

const contactIds = new Set(db.prepare("SELECT id FROM contacts").all().map(r => r.id));
const conversationIds = new Set(db.prepare("SELECT id FROM conversations").all().map(r => r.id));

const conversations = db.prepare("SELECT * FROM conversations").all();
for (const conv of conversations) {
  if (conv.contact_id && !contactIds.has(conv.contact_id)) {
    orphans.conversations.push({ id: conv.id, missing_contact: conv.contact_id });
    continue;
  }
  transformed.conversations.push({
    ...conv,
    user_id: 1,
    external_thread_id: conv.external_thread_id ?? conv.wa_chat_id,
  });
}

// Similar for messages → conversations FK, etc.
```

### 5. REPORT.md

```md
# Spike 4 Report — V1 → V2 Migration Dryrun

## Summary
- Verde / Amarelo / Vermelho

## Schema validation
- schema-v2-candidate.ts compiles: ✓/✗
- All required tables defined: ✓/✗

## Row counts
| Table | V1 count | Transformed | Orphans | % loss |
|---|---|---|---|---|
| contacts | 5,432 | 5,432 | 0 | 0% |
| conversations | 8,213 | 8,210 | 3 | 0.04% |
| messages | 142,891 | 142,750 | 141 | 0.10% |
| ... | ... | ... | ... | ... |

## Orphans by table
- conversations.contact_id missing: 3 rows (ids: 2341, 6745, 9012)
- messages.conversation_id missing: 141 rows
- ...

## Fields without V2 equivalent
- `campaigns.legacy_field_xyz` (3 rows non-null) — decision pending
- ...

## Decisions pending
- [ ] How to handle campaign_executions vs campaign_recipients overlap
- [ ] Orphan strategy: skip / create ghost / bind to special "unknown" entity
- [ ] Dedupe key expiration for V1 jobs in pending status

## Performance
- Dryrun completed in: X seconds
- V1 DB size: X MB
- Transformed structures size in memory: X MB

## Decision
- Verde → ADR 0005 aprovada (Drizzle), V2.3 destravada.
- Amarelo → resolver decisões pendentes antes de avançar.
- Vermelho → recua pra SQL puro.
```

### 6. Skill output (no actual writes)

This skill **DOES NOT execute the real migration**. The real migration is item V2.15 in roadmap, executed only after V2 reaches feature parity.

## Anti-patterns

- DON'T write to `storage/database/nuoma.db`.
- DON'T silently fix orphans — report them.
- DON'T migrate `data_lake_*` tables.
- DON'T claim success without compiling schema-v2-candidate.ts.

## Reference files

- [`docs/architecture/V2_SPIKES.md`](../../docs/architecture/V2_SPIKES.md) (Spike 4 spec)
- [`docs/migration/V1_TO_V2_DATA_MAP.md`](../../docs/migration/V1_TO_V2_DATA_MAP.md) (mapping reference)
- [`docs/adr/0005-sqlite-drizzle-v2.md`](../../docs/adr/0005-sqlite-drizzle-v2.md) (gated by this spike)
- V1 schema: [`packages/core/src/db/migrations.ts`](../../packages/core/src/db/migrations.ts)

## When to invoke

User says: "rodar spike 4", "validar migração", "dryrun V1 V2", "Drizzle schema spike", "testar import migration".
