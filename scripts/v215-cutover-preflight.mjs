#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const DEFAULT_V1_DB_PATH = "/Users/gabrielbraga/Projetos/nuoma-wpp/storage/database/nuoma.db";
const DEFAULT_V2_DB_PATH = "data/nuoma-v2.db";

const requiredV1Tables = [
  "contacts",
  "tags",
  "contact_tags",
  "conversations",
  "messages",
  "media_assets",
  "campaigns",
  "campaign_steps",
  "campaign_recipients",
  "jobs",
];

const requiredV2Tables = [
  "users",
  "contacts",
  "conversations",
  "messages",
  "media_assets",
  "campaigns",
  "campaign_recipients",
  "jobs",
  "jobs_dead",
  "system_events",
];

const requiredV1Columns = {
  contacts: ["id", "name", "phone", "email", "instagram", "status", "created_at", "updated_at"],
  conversations: [
    "id",
    "contact_id",
    "wa_chat_id",
    "title",
    "unread_count",
    "last_message_preview",
    "last_message_at",
    "created_at",
    "updated_at",
  ],
  messages: [
    "id",
    "conversation_id",
    "contact_id",
    "direction",
    "content_type",
    "body",
    "external_id",
    "status",
    "sent_at",
    "created_at",
  ],
  media_assets: [
    "id",
    "sha256",
    "original_name",
    "mime_type",
    "size_bytes",
    "category",
    "storage_path",
    "created_at",
  ],
};

const messageTypeMap = {
  text: "text",
  audio: "audio",
  image: "image",
  video: "video",
  file: "document",
  summary: "system",
};

const directionMap = {
  incoming: "inbound",
  outgoing: "outbound",
  system: "system",
};

function main() {
  const startedAt = new Date().toISOString();
  const env = process.env;
  const v1DbPath = resolveInputPath(env.V215_V1_DB_PATH ?? DEFAULT_V1_DB_PATH);
  const v2DbPath = resolveInputPath(env.V215_V2_DB_PATH ?? DEFAULT_V2_DB_PATH);
  const targetUserId = parsePositiveInt(env.V215_TARGET_USER_ID, 1);
  const backupDir = resolveInputPath(env.V215_BACKUP_DIR ?? "data/backups");
  const proofRoot = resolveInputPath(env.V215_M303_PROOF_ROOT ?? "data");

  const report = {
    mode: "v215-cutover-preflight",
    status: "blocked",
    startedAt,
    checkedAt: new Date().toISOString(),
    paths: {
      v1DbPath,
      v2DbPath,
      backupDir,
      proofRoot,
    },
    targetUserId,
    gates: {
      requireBackup: envFlag(env.V215_REQUIRE_BACKUP, true),
      requireM303Proof: envFlag(env.V215_REQUIRE_M303_PROOF, true),
      requireV1CleanJobs: envFlag(env.V215_REQUIRE_V1_CLEAN_JOBS, true),
    },
    blockers: [],
    warnings: [],
    v1: null,
    v2: null,
    mappings: {
      contactStatus: {
        novo: "lead",
        aguardando_resposta: "lead",
        em_atendimento: "active",
        cliente: "active",
        sem_retorno: "inactive",
        perdido: "inactive",
      },
      messageDirection: directionMap,
      messageContentType: messageTypeMap,
      campaignStatus: {
        draft: "draft",
        ready: "draft",
        active: "running",
        paused: "paused",
        completed: "completed",
        cancelled: "cancelled",
        failed: "failed",
      },
    },
    migrationPlan: null,
  };

  const v1Exists = assertReadableSqlite(v1DbPath, "V1", report.blockers);
  const v2Exists = assertReadableSqlite(v2DbPath, "V2", report.blockers);

  let v1Db = null;
  let v2Db = null;
  try {
    if (v1Exists) {
      v1Db = new Database(v1DbPath, { readonly: true, fileMustExist: true });
      report.v1 = inspectV1(v1Db, report);
    }
    if (v2Exists) {
      v2Db = new Database(v2DbPath, { readonly: true, fileMustExist: true });
      report.v2 = inspectV2(v2Db, targetUserId, report);
    }

    if (report.gates.requireBackup) {
      const backup = findLatestBackup(backupDir);
      if (!backup) {
        report.blockers.push(`missing_v2_backup:${backupDir}`);
      } else {
        report.v2 = {
          ...(report.v2 ?? {}),
          latestBackup: backup,
        };
      }
    }

    if (report.gates.requireM303Proof) {
      const proof = findM303Proof(proofRoot);
      if (!proof) {
        report.blockers.push(`missing_m303_wpp_24_send_90_proof:${proofRoot}`);
      } else {
        report.v2 = {
          ...(report.v2 ?? {}),
          m303Proof: proof,
        };
      }
    }

    report.migrationPlan = buildMigrationPlan(report);
    report.status = report.blockers.length === 0 ? "ready" : "blocked";
    maybeWriteReport(report, env.V215_REPORT_PATH);
    printSummary(report);

    if (report.blockers.length > 0 && !envFlag(env.V215_ALLOW_BLOCKERS, false)) {
      process.exitCode = 1;
    }
  } finally {
    v1Db?.close();
    v2Db?.close();
  }
}

function inspectV1(db, report) {
  const tables = listTables(db);
  const missingTables = requiredV1Tables.filter((table) => !tables.includes(table));
  for (const table of missingTables) {
    report.blockers.push(`v1_missing_table:${table}`);
  }

  for (const [table, columns] of Object.entries(requiredV1Columns)) {
    if (!tables.includes(table)) continue;
    const existing = listColumns(db, table);
    for (const column of columns) {
      if (!existing.includes(column)) {
        report.blockers.push(`v1_missing_column:${table}.${column}`);
      }
    }
  }

  const counts = countTables(db, requiredV1Tables);
  const contactsWithoutReach = tables.includes("contacts")
    ? scalar(
        db,
        `SELECT count(*) FROM contacts
         WHERE deleted_at IS NULL
           AND IFNULL(TRIM(phone), '') = ''
           AND IFNULL(TRIM(instagram), '') = ''`,
      )
    : 0;
  const activeJobs = tables.includes("jobs")
    ? scalar(db, `SELECT count(*) FROM jobs WHERE status IN ('pending', 'processing')`)
    : 0;
  const messageTypes = tables.includes("messages")
    ? groupedCount(db, "messages", "content_type")
    : {};
  const messageDirections = tables.includes("messages")
    ? groupedCount(db, "messages", "direction")
    : {};
  const unsupportedMessageTypes = Object.keys(messageTypes).filter((type) => !messageTypeMap[type]);
  const unsupportedDirections = Object.keys(messageDirections).filter(
    (direction) => !directionMap[direction],
  );

  if (contactsWithoutReach > 0) {
    report.warnings.push(`v1_contacts_without_phone_or_instagram:${contactsWithoutReach}`);
  }
  if (unsupportedMessageTypes.length > 0) {
    report.warnings.push(`v1_unsupported_message_types:${unsupportedMessageTypes.join(",")}`);
  }
  if (unsupportedDirections.length > 0) {
    report.warnings.push(`v1_unsupported_message_directions:${unsupportedDirections.join(",")}`);
  }
  if (report.gates.requireV1CleanJobs && activeJobs > 0) {
    report.blockers.push(`v1_active_jobs:${activeJobs}`);
  }

  return {
    tables: requiredV1Tables.map((table) => ({
      table,
      exists: tables.includes(table),
      count: counts[table] ?? null,
    })),
    counts,
    activeJobs,
    contactsWithoutReach,
    messageTypes,
    messageDirections,
    unsupportedMessageTypes,
    unsupportedDirections,
  };
}

function inspectV2(db, targetUserId, report) {
  const tables = listTables(db);
  const missingTables = requiredV2Tables.filter((table) => !tables.includes(table));
  for (const table of missingTables) {
    report.blockers.push(`v2_missing_table:${table}`);
  }

  const counts = countTables(db, requiredV2Tables);
  const targetUserExists = tables.includes("users")
    ? scalar(db, "SELECT count(*) FROM users WHERE id = ?", [targetUserId]) > 0
    : false;
  const activeJobs = tables.includes("jobs")
    ? scalar(db, `SELECT count(*) FROM jobs WHERE status IN ('queued', 'claimed', 'running')`)
    : 0;

  if (!targetUserExists) {
    report.blockers.push(`v2_target_user_missing:${targetUserId}`);
  }
  if (activeJobs > 0) {
    report.blockers.push(`v2_active_jobs:${activeJobs}`);
  }
  if ((counts.contacts ?? 0) > 0 || (counts.conversations ?? 0) > 0 || (counts.messages ?? 0) > 0) {
    report.warnings.push(
      `v2_existing_data:contacts=${counts.contacts ?? 0},conversations=${counts.conversations ?? 0},messages=${counts.messages ?? 0}`,
    );
  }

  return {
    tables: requiredV2Tables.map((table) => ({
      table,
      exists: tables.includes(table),
      count: counts[table] ?? null,
    })),
    counts,
    targetUserExists,
    activeJobs,
  };
}

function buildMigrationPlan(report) {
  const v1Counts = report.v1?.counts ?? {};
  return {
    dryRunOnly: true,
    applyRequires: "V215_CONFIRM_CUTOVER=SIM and an explicit migration importer review",
    importOrder: [
      "users: reuse existing V2 target user",
      "tags",
      "contacts",
      "contact_tags",
      "media_assets metadata",
      "conversations",
      "messages",
      "campaigns",
      "campaign_steps",
      "campaign_recipients",
    ],
    estimatedRows: {
      tags: v1Counts.tags ?? 0,
      contacts: v1Counts.contacts ?? 0,
      contactTags: v1Counts.contact_tags ?? 0,
      mediaAssets: v1Counts.media_assets ?? 0,
      conversations: v1Counts.conversations ?? 0,
      messages: v1Counts.messages ?? 0,
      campaigns: v1Counts.campaigns ?? 0,
      campaignSteps: v1Counts.campaign_steps ?? 0,
      campaignRecipients: v1Counts.campaign_recipients ?? 0,
    },
    blockedUntil: report.blockers.length > 0 ? [...report.blockers] : [],
  };
}

function assertReadableSqlite(filePath, label, blockers) {
  if (!fs.existsSync(filePath)) {
    blockers.push(`${label.toLowerCase()}_db_missing:${filePath}`);
    return false;
  }
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size === 0) {
    blockers.push(`${label.toLowerCase()}_db_empty_or_invalid:${filePath}`);
    return false;
  }
  return true;
}

function listTables(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => row.name);
}

function listColumns(db, table) {
  return db
    .prepare(`PRAGMA table_info(${quoteIdent(table)})`)
    .all()
    .map((row) => row.name);
}

function countTables(db, tables) {
  const result = {};
  for (const table of tables) {
    if (!listTables(db).includes(table)) {
      result[table] = null;
      continue;
    }
    result[table] = scalar(db, `SELECT count(*) FROM ${quoteIdent(table)}`);
  }
  return result;
}

function groupedCount(db, table, column) {
  const rows = db
    .prepare(
      `SELECT ${quoteIdent(column)} AS value, count(*) AS count
       FROM ${quoteIdent(table)}
       GROUP BY ${quoteIdent(column)}
       ORDER BY ${quoteIdent(column)}`,
    )
    .all();
  return Object.fromEntries(rows.map((row) => [String(row.value ?? ""), Number(row.count)]));
}

function scalar(db, sql, params = []) {
  const row = db.prepare(sql).get(...params);
  const value = row ? Object.values(row)[0] : 0;
  return Number(value ?? 0);
}

function findLatestBackup(backupDir) {
  if (!fs.existsSync(backupDir)) return null;
  const candidates = fs
    .readdirSync(backupDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".db"))
    .map((entry) => {
      const fullPath = path.join(backupDir, entry.name);
      const stat = fs.statSync(fullPath);
      return {
        path: fullPath,
        sizeBytes: stat.size,
        mtime: stat.mtime.toISOString(),
      };
    })
    .filter((entry) => entry.sizeBytes > 0)
    .sort((a, b) => Date.parse(b.mtime) - Date.parse(a.mtime));
  return candidates[0] ?? null;
}

function findM303Proof(proofRoot) {
  if (!fs.existsSync(proofRoot)) return null;
  const entries = fs.readdirSync(proofRoot, { withFileTypes: true });
  const proofs = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("m303-wpp-24-send-90-proof-"))
    .map((entry) => {
      const dir = path.join(proofRoot, entry.name);
      const evidencePath = path.join(dir, "evidence.json");
      if (!fs.existsSync(evidencePath)) return null;
      const stat = fs.statSync(evidencePath);
      return {
        path: evidencePath,
        mtime: stat.mtime.toISOString(),
      };
    })
    .filter(Boolean)
    .sort((a, b) => Date.parse(b.mtime) - Date.parse(a.mtime));
  return proofs[0] ?? null;
}

function maybeWriteReport(report, reportPathInput) {
  if (!reportPathInput) return;
  const reportPath = resolveInputPath(reportPathInput);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

function printSummary(report) {
  const v1Counts = report.v1?.counts ?? {};
  const v2Counts = report.v2?.counts ?? {};
  console.log(
    [
      "v215-cutover-preflight",
      `v1Contacts=${v1Counts.contacts ?? "na"}`,
      `v1Conversations=${v1Counts.conversations ?? "na"}`,
      `v1Messages=${v1Counts.messages ?? "na"}`,
      `v2Contacts=${v2Counts.contacts ?? "na"}`,
      `v2ActiveJobs=${report.v2?.activeJobs ?? "na"}`,
      `blockers=${report.blockers.length}`,
      `warnings=${report.warnings.length}`,
      `status=${report.status}`,
    ].join("|"),
  );
}

function quoteIdent(identifier) {
  return `"${String(identifier).replaceAll('"', '""')}"`;
}

function resolveInputPath(input) {
  return path.isAbsolute(input) ? input : path.resolve(repoRoot, input);
}

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function envFlag(value, fallback) {
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "sim", "SIM"].includes(value);
}

main();
