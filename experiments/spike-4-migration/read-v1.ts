import Database from "better-sqlite3";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const EXPERIMENT_ROOT = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(EXPERIMENT_ROOT, "../..");
export const REPORTS_DIR = path.join(EXPERIMENT_ROOT, "reports");
export const SNAPSHOTS_DIR = path.join(EXPERIMENT_ROOT, "snapshots");

export type TablePlan = {
  name: string;
  required: boolean;
  migrationMode: "mirror" | "inject-user" | "live-only" | "legacy-review";
  notes?: string;
};

export type ColumnInfo = {
  cid: number;
  name: string;
  type: string;
  notnull: 0 | 1;
  dflt_value: string | null;
  pk: number;
};

type ForeignKeyInfo = {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string | null;
  on_update: string;
  on_delete: string;
  match: string;
};

export type ForeignKeySummary = {
  childTable: string;
  parentTable: string;
  columns: Array<{ from: string; to: string }>;
  orphanCount: number;
  sample: Array<Record<string, unknown>>;
};

export type TableSummary = {
  name: string;
  exists: boolean;
  required: boolean;
  migrationMode: TablePlan["migrationMode"];
  rowCount: number;
  columns: ColumnInfo[];
  sample: Array<Record<string, unknown>>;
  sampleTypeErrors: Array<{ column: string; declaredType: string; observedType: string }>;
  jsonValidation: Array<{ column: string; invalidCount: number; sampleInvalidValue: string | null }>;
  foreignKeys: ForeignKeySummary[];
  notes?: string;
};

export type ReadSummary = {
  createdAt: string;
  sourceDbPath: string;
  snapshotPath: string;
  snapshotMethod: string;
  dbSizeBytes: number;
  walSizeBytes: number;
  tableNames: string[];
  tables: TableSummary[];
};

export const OPERATIONAL_TABLES: TablePlan[] = [
  { name: "contacts", required: true, migrationMode: "inject-user" },
  { name: "conversations", required: true, migrationMode: "inject-user" },
  { name: "messages", required: true, migrationMode: "mirror" },
  { name: "jobs", required: true, migrationMode: "live-only", notes: "Importar pending/processing; done/failed ficam no V1 histórico." },
  { name: "campaigns", required: true, migrationMode: "inject-user" },
  { name: "campaign_steps", required: false, migrationMode: "mirror" },
  { name: "campaign_recipients", required: false, migrationMode: "mirror" },
  { name: "campaign_executions", required: false, migrationMode: "legacy-review" },
  { name: "automations", required: true, migrationMode: "inject-user" },
  { name: "automation_actions", required: false, migrationMode: "mirror" },
  { name: "automation_contact_state", required: false, migrationMode: "mirror" },
  { name: "automation_runs", required: false, migrationMode: "mirror" },
  { name: "tags", required: true, migrationMode: "inject-user" },
  { name: "contact_tags", required: true, migrationMode: "mirror" },
  { name: "contact_channels", required: false, migrationMode: "inject-user" },
  { name: "contact_history", required: false, migrationMode: "mirror" },
  { name: "attendants", required: true, migrationMode: "mirror" },
  { name: "chatbots", required: true, migrationMode: "inject-user" },
  { name: "chatbot_rules", required: true, migrationMode: "mirror" },
  { name: "media_assets", required: true, migrationMode: "inject-user" },
  { name: "audit_logs", required: true, migrationMode: "mirror" },
  { name: "system_logs", required: false, migrationMode: "mirror" },
  { name: "reminders", required: false, migrationMode: "inject-user" }
];

const REDACT_COLUMNS = new Set([
  "phone",
  "name",
  "email",
  "cpf",
  "instagram",
  "title",
  "body",
  "notes",
  "content",
  "caption",
  "last_message_preview",
  "payload_json",
  "meta_json",
  "extra_json",
  "before_json",
  "after_json",
  "value_json"
]);

function q(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function defaultDbPath() {
  return path.join(REPO_ROOT, "storage/database/nuoma.db");
}

function resolvePath(value: string | undefined, fallback: string) {
  const target = value?.trim() || fallback;
  return path.isAbsolute(target) ? target : path.resolve(REPO_ROOT, target);
}

function parseCli(argv: string[]) {
  let dbPath = process.env.DATABASE_PATH ?? defaultDbPath();
  let snapshotPath = path.join(SNAPSHOTS_DIR, "v1-snapshot.db");
  let noSnapshot = false;

  for (const arg of argv) {
    if (arg === "--no-snapshot") noSnapshot = true;
    else if (arg.startsWith("--db=")) dbPath = arg.slice("--db=".length);
    else if (arg.startsWith("--snapshot=")) snapshotPath = arg.slice("--snapshot=".length);
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    dbPath: resolvePath(dbPath, defaultDbPath()),
    snapshotPath: resolvePath(snapshotPath, path.join(SNAPSHOTS_DIR, "v1-snapshot.db")),
    noSnapshot
  };
}

async function fileSize(filePath: string) {
  try {
    const stat = await fs.stat(filePath);
    return stat.size;
  } catch {
    return 0;
  }
}

async function copyIfExists(source: string, target: string) {
  try {
    await fs.copyFile(source, target);
    return true;
  } catch {
    return false;
  }
}

export async function createSnapshot(sourceDbPath: string, snapshotPath: string) {
  await fs.mkdir(path.dirname(snapshotPath), { recursive: true });
  await fs.rm(snapshotPath, { force: true });
  await fs.rm(`${snapshotPath}-wal`, { force: true });
  await fs.rm(`${snapshotPath}-shm`, { force: true });

  let method = "sqlite-backup";
  try {
    const source = new Database(sourceDbPath, {
      readonly: true,
      fileMustExist: true,
      timeout: 10_000
    });
    source.pragma("busy_timeout = 10000");
    await source.backup(snapshotPath);
    source.close();
  } catch (error) {
    method = "file-copy-with-wal-fallback";
    await fs.copyFile(sourceDbPath, snapshotPath);
    await copyIfExists(`${sourceDbPath}-wal`, `${snapshotPath}-wal`);
    await copyIfExists(`${sourceDbPath}-shm`, `${snapshotPath}-shm`);
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`sqlite backup failed; used file copy fallback: ${message}`);
  }

  return { snapshotPath, method };
}

export function openReadOnly(dbPath: string) {
  const db = new Database(dbPath, {
    readonly: true,
    fileMustExist: true,
    timeout: 10_000
  });
  db.pragma("query_only = ON");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 10000");
  return db;
}

function getTableNames(db: Database.Database) {
  return db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
    )
    .all()
    .map((row) => (row as { name: string }).name);
}

function getColumns(db: Database.Database, tableName: string) {
  return db.prepare(`PRAGMA table_info(${q(tableName)})`).all() as ColumnInfo[];
}

function getForeignKeys(db: Database.Database, tableName: string) {
  return db.prepare(`PRAGMA foreign_key_list(${q(tableName)})`).all() as ForeignKeyInfo[];
}

function countRows(db: Database.Database, tableName: string) {
  return Number((db.prepare(`SELECT COUNT(*) AS count FROM ${q(tableName)}`).get() as { count: number }).count);
}

function valueType(value: unknown) {
  if (value === null) return "null";
  if (Buffer.isBuffer(value)) return "buffer";
  return typeof value;
}

function expectedType(declaredType: string) {
  const type = declaredType.toUpperCase();
  if (type.includes("INT")) return "number";
  if (type.includes("REAL") || type.includes("FLOA") || type.includes("DOUB")) return "number";
  if (type.includes("BLOB")) return "buffer";
  return "string";
}

function redactValue(column: string, value: unknown) {
  if (value === null) return null;
  if (Buffer.isBuffer(value)) return `<buffer:${value.length}>`;

  const raw = String(value);
  if (REDACT_COLUMNS.has(column) || column.endsWith("_json")) {
    return raw ? `<redacted:${raw.length}>` : "";
  }
  if (raw.length > 120) return `${raw.slice(0, 117)}...`;
  return value;
}

function sampleRows(db: Database.Database, tableName: string) {
  const rows = db.prepare(`SELECT * FROM ${q(tableName)} LIMIT 5`).all() as Array<Record<string, unknown>>;
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([column, value]) => [
        column,
        {
          type: valueType(value),
          value: redactValue(column, value)
        }
      ])
    )
  );
}

function sampleTypeErrors(columns: ColumnInfo[], sample: Array<Record<string, unknown>>) {
  const columnByName = new Map(columns.map((column) => [column.name, column]));
  const errors: Array<{ column: string; declaredType: string; observedType: string }> = [];

  for (const row of sample) {
    for (const [columnName, typedValue] of Object.entries(row)) {
      const column = columnByName.get(columnName);
      if (!column) continue;

      const observedType = (typedValue as { type: string }).type;
      if (observedType === "null") continue;
      const expected = expectedType(column.type);
      if (expected !== observedType) {
        errors.push({ column: columnName, declaredType: column.type, observedType });
      }
    }
  }

  return errors;
}

function jsonColumns(columns: ColumnInfo[]) {
  return columns
    .map((column) => column.name)
    .filter((name) => name.endsWith("_json") || ["payload_json", "meta_json", "value_json", "config_json"].includes(name));
}

function validateJsonColumns(db: Database.Database, tableName: string, columns: ColumnInfo[]) {
  const result: Array<{ column: string; invalidCount: number; sampleInvalidValue: string | null }> = [];
  for (const column of jsonColumns(columns)) {
    let invalidCount = 0;
    let sampleInvalidValue: string | null = null;
    const iterator = db.prepare(`SELECT ${q(column)} AS value FROM ${q(tableName)} WHERE ${q(column)} IS NOT NULL`).iterate();
    for (const row of iterator as Iterable<{ value: unknown }>) {
      if (typeof row.value !== "string" || row.value.trim() === "") continue;
      try {
        JSON.parse(row.value);
      } catch {
        invalidCount += 1;
        sampleInvalidValue ??= row.value.slice(0, 120);
      }
    }
    result.push({ column, invalidCount, sampleInvalidValue });
  }
  return result;
}

function primaryKeyColumns(db: Database.Database, tableName: string) {
  return getColumns(db, tableName)
    .filter((column) => column.pk > 0)
    .sort((left, right) => left.pk - right.pk)
    .map((column) => column.name);
}

function groupForeignKeys(rows: ForeignKeyInfo[]) {
  const groups = new Map<number, ForeignKeyInfo[]>();
  for (const row of rows) {
    const group = groups.get(row.id) ?? [];
    group.push(row);
    groups.set(row.id, group);
  }
  return [...groups.values()].map((group) => group.sort((left, right) => left.seq - right.seq));
}

function summarizeForeignKeys(db: Database.Database, tableName: string, allTables: Set<string>): ForeignKeySummary[] {
  const summaries: ForeignKeySummary[] = [];
  for (const group of groupForeignKeys(getForeignKeys(db, tableName))) {
    const first = group[0];
    if (!first) continue;

    const parentTable = first.table;
    const parentPk = allTables.has(parentTable) ? primaryKeyColumns(db, parentTable) : [];
    const columns = group.map((item, index) => ({
      from: item.from,
      to: item.to || parentPk[index] || "id"
    }));

    const childAlias = "c";
    const parentAlias = "p";
    const childNotNull = columns.map((column) => `${childAlias}.${q(column.from)} IS NOT NULL`).join(" AND ");

    let orphanCount = 0;
    let sample: Array<Record<string, unknown>> = [];
    if (!allTables.has(parentTable)) {
      orphanCount = Number(
        (db.prepare(`SELECT COUNT(*) AS count FROM ${q(tableName)} ${childAlias} WHERE ${childNotNull}`).get() as { count: number }).count
      );
    } else {
      const joinCondition = columns
        .map((column) => `${childAlias}.${q(column.from)} = ${parentAlias}.${q(column.to)}`)
        .join(" AND ");
      const parentMissingCheck = `${parentAlias}.${q(columns[0]?.to ?? "id")} IS NULL`;
      const whereClause = `${childNotNull} AND ${parentMissingCheck}`;

      orphanCount = Number(
        (
          db
            .prepare(
              `SELECT COUNT(*) AS count FROM ${q(tableName)} ${childAlias} LEFT JOIN ${q(parentTable)} ${parentAlias} ON ${joinCondition} WHERE ${whereClause}`
            )
            .get() as { count: number }
        ).count
      );

      if (orphanCount > 0) {
        const projectedColumns = columns.map((column) => `${childAlias}.${q(column.from)} AS ${q(column.from)}`).join(", ");
        sample = db
          .prepare(
            `SELECT ${childAlias}.rowid AS rowid, ${projectedColumns} FROM ${q(tableName)} ${childAlias} LEFT JOIN ${q(parentTable)} ${parentAlias} ON ${joinCondition} WHERE ${whereClause} LIMIT 5`
          )
          .all() as Array<Record<string, unknown>>;
      }
    }

    summaries.push({
      childTable: tableName,
      parentTable,
      columns,
      orphanCount,
      sample: sample.map((row) => Object.fromEntries(Object.entries(row).map(([column, value]) => [column, redactValue(column, value)])))
    });
  }

  return summaries;
}

export async function inspectV1(options?: { dbPath?: string; snapshotPath?: string; noSnapshot?: boolean }): Promise<ReadSummary> {
  const sourceDbPath = resolvePath(options?.dbPath, defaultDbPath());
  const requestedSnapshotPath = resolvePath(options?.snapshotPath, path.join(SNAPSHOTS_DIR, "v1-snapshot.db"));
  const snapshot = options?.noSnapshot
    ? { snapshotPath: sourceDbPath, method: "read-source-directly" }
    : await createSnapshot(sourceDbPath, requestedSnapshotPath);

  const db = openReadOnly(snapshot.snapshotPath);
  const tableNames = getTableNames(db);
  const tableSet = new Set(tableNames);

  const tables = OPERATIONAL_TABLES.map((plan): TableSummary => {
    if (!tableSet.has(plan.name)) {
      return {
        name: plan.name,
        exists: false,
        required: plan.required,
        migrationMode: plan.migrationMode,
        rowCount: 0,
        columns: [],
        sample: [],
        sampleTypeErrors: [],
        jsonValidation: [],
        foreignKeys: [],
        notes: plan.notes
      };
    }

    const columns = getColumns(db, plan.name);
    const sample = sampleRows(db, plan.name);
    return {
      name: plan.name,
      exists: true,
      required: plan.required,
      migrationMode: plan.migrationMode,
      rowCount: countRows(db, plan.name),
      columns,
      sample,
      sampleTypeErrors: sampleTypeErrors(columns, sample),
      jsonValidation: validateJsonColumns(db, plan.name, columns),
      foreignKeys: summarizeForeignKeys(db, plan.name, tableSet),
      notes: plan.notes
    };
  });

  db.close();

  return {
    createdAt: new Date().toISOString(),
    sourceDbPath,
    snapshotPath: snapshot.snapshotPath,
    snapshotMethod: snapshot.method,
    dbSizeBytes: await fileSize(sourceDbPath),
    walSizeBytes: await fileSize(`${sourceDbPath}-wal`),
    tableNames,
    tables
  };
}

async function main() {
  const options = parseCli(process.argv.slice(2));
  const summary = await inspectV1(options);
  await fs.mkdir(REPORTS_DIR, { recursive: true });
  const reportPath = path.join(REPORTS_DIR, "read-v1.json");
  await fs.writeFile(reportPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  console.log(`snapshot=${summary.snapshotPath}`);
  console.log(`snapshotMethod=${summary.snapshotMethod}`);
  for (const table of summary.tables) {
    const orphanCount = table.foreignKeys.reduce((total, fk) => total + fk.orphanCount, 0);
    console.log(`${table.name} exists=${table.exists} rows=${table.rowCount} orphans=${orphanCount}`);
  }
  console.log(`report=${reportPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exitCode = 1;
  });
}
