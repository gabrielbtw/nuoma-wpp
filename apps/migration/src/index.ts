#!/usr/bin/env node
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

type SqliteDatabase = Database.Database;
type Row = Record<string, unknown>;
type Command = "preflight" | "dry-run" | "apply" | "validate";
type Status = "blocked" | "ready" | "applied" | "valid" | "invalid";

type MigrationCounts = {
  users: number;
  tags: number;
  contacts: number;
  contactTags: number;
  attendants: number;
  mediaAssets: number;
  mediaFilesCopied: number;
  mediaFilesMissing: number;
  conversations: number;
  messages: number;
  campaigns: number;
  campaignRecipients: number;
  automations: number;
  automationEvents: number;
  chatbots: number;
  chatbotRules: number;
  jobs: number;
  reminders: number;
  auditLogs: number;
  systemEvents: number;
  dataLakeSkipped: number;
  rowsSkipped: number;
};

type MigrationReport = {
  mode: string;
  command: Command;
  status: Status;
  startedAt: string;
  finishedAt: string;
  paths: {
    v1DbPath: string;
    v2DbPath: string;
    backupDir: string;
    v1StorageRoot: string;
    mediaTargetRoot: string;
    proofRoot: string;
  };
  targetUserId: number;
  blockers: string[];
  warnings: string[];
  counts: MigrationCounts;
  v1: {
    counts: Record<string, number | null>;
    activeJobs: number;
    ignoredTables: Record<string, number>;
  } | null;
  v2: {
    counts: Record<string, number | null>;
    activeJobs: number;
    targetUserExists: boolean;
    latestBackup?: FileProof | null;
    m303Proof?: FileProof | null;
  } | null;
  validation?: ValidationSummary;
  backup?: string;
};

type FileProof = {
  path: string;
  sizeBytes?: number;
  mtime: string;
};

type Options = {
  command: Command;
  mode: "dry-run" | "apply";
  v1DbPath: string;
  v2DbPath: string;
  backupDir: string;
  v1StorageRoot: string;
  mediaTargetRoot: string;
  proofRoot: string;
  reportPath: string | null;
  targetUserId: number;
  requireBackup: boolean;
  requireM303Proof: boolean;
  requireV1CleanJobs: boolean;
  allowBlockers: boolean;
  confirmCutover: boolean;
};

type SourceData = {
  tables: Set<string>;
  ignoredTables: Record<string, number>;
  tags: Row[];
  contacts: Row[];
  contactTags: Row[];
  attendants: Row[];
  mediaAssets: Row[];
  conversations: Row[];
  messages: Row[];
  campaigns: Row[];
  campaignSteps: Row[];
  campaignRecipients: Row[];
  campaignExecutions: Row[];
  automations: Row[];
  automationActions: Row[];
  automationRuns: Row[];
  automationContactState: Row[];
  chatbots: Row[];
  chatbotRules: Row[];
  jobs: Row[];
  reminders: Row[];
  auditLogs: Row[];
  systemLogs: Row[];
  systemEvents: Row[];
  counts: Record<string, number | null>;
};

type IdMaps = {
  tags: Map<string, number>;
  contacts: Map<string, number>;
  attendants: Map<string, number>;
  mediaAssets: Map<string, number>;
  conversations: Map<string, number>;
  campaigns: Map<string, number>;
  automations: Map<string, number>;
  chatbots: Map<string, number>;
  chatbotRules: Map<string, number>;
  messages: Map<string, number>;
  jobs: Map<string, number>;
};

type ValidationSummary = {
  ok: boolean;
  checks: Record<string, boolean | number | string>;
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const defaultV1DbPath = "/Users/gabrielbraga/Projetos/nuoma-wpp/storage/database/nuoma.db";
const defaultV2DbPath = "data/nuoma-v2.db";

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

const optionalV1Tables = [
  "attendants",
  "campaign_executions",
  "automations",
  "automation_actions",
  "automation_runs",
  "automation_contact_state",
  "chatbots",
  "chatbot_rules",
  "reminders",
  "audit_logs",
  "system_logs",
  "system_events",
  "contact_channels",
  "contact_history",
];

const requiredV2Tables = [
  "users",
  "tags",
  "contacts",
  "contact_tags",
  "attendants",
  "media_assets",
  "conversations",
  "messages",
  "campaigns",
  "campaign_recipients",
  "automations",
  "chatbots",
  "chatbot_rules",
  "jobs",
  "jobs_dead",
  "reminders",
  "audit_logs",
  "system_events",
];

const requiredV1Columns: Record<string, string[]> = {
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
    "created_at",
  ],
  media_assets: ["id", "sha256", "mime_type", "size_bytes", "storage_path", "created_at"],
};

const statusMap: Record<string, string> = {
  novo: "lead",
  aguardando_resposta: "lead",
  em_atendimento: "active",
  cliente: "active",
  sem_retorno: "inactive",
  perdido: "inactive",
  lead: "lead",
  active: "active",
  inactive: "inactive",
  blocked: "blocked",
  archived: "archived",
};

const directionMap: Record<string, string> = {
  incoming: "inbound",
  inbound: "inbound",
  outgoing: "outbound",
  outbound: "outbound",
  system: "system",
};

const messageTypeMap: Record<string, string> = {
  text: "text",
  audio: "audio",
  voice: "voice",
  image: "image",
  video: "video",
  file: "document",
  document: "document",
  link: "link",
  sticker: "sticker",
  summary: "system",
  system: "system",
};

const campaignStatusMap: Record<string, string> = {
  draft: "draft",
  ready: "draft",
  active: "running",
  running: "running",
  paused: "paused",
  completed: "completed",
  cancelled: "archived",
  canceled: "archived",
  failed: "archived",
  archived: "archived",
};

const recipientStatusMap: Record<string, string> = {
  pending: "queued",
  queued: "queued",
  running: "running",
  processing: "running",
  sent: "completed",
  completed: "completed",
  failed: "failed",
  skipped: "skipped",
  cancelled: "cancelled",
  canceled: "cancelled",
};

const automationStatusMap: Record<string, string> = {
  active: "active",
  enabled: "active",
  running: "active",
  paused: "paused",
  draft: "draft",
  archived: "archived",
  disabled: "archived",
};

const jobStatusMap: Record<string, string> = {
  pending: "queued",
  processing: "running",
  queued: "queued",
  claimed: "claimed",
  running: "running",
};

const jobTypeMap: Record<string, string> = {
  "send-message": "send_message",
  send_message: "send_message",
  "send-instagram-message": "send_instagram_message",
  send_instagram_message: "send_instagram_message",
  "send-voice": "send_voice",
  send_voice: "send_voice",
  "send-document": "send_document",
  send_document: "send_document",
  "send-media": "send_media",
  send_media: "send_media",
  "validate-recipient": "validate_recipient",
  validate_recipient: "validate_recipient",
  "sync-inbox-force": "sync_inbox_force",
  sync_inbox_force: "sync_inbox_force",
  "restart-worker": "restart_worker",
  restart_worker: "restart_worker",
  campaign_step: "campaign_step",
  "campaign-step": "campaign_step",
};

async function main() {
  const options = parseOptions(process.argv.slice(2), process.env);
  if (options.command === "preflight") {
    const report = runPreflight(options);
    writeReport(options.reportPath, report);
    printPreflightSummary(report);
    exitForReport(report, options);
    return;
  }

  if (options.command === "validate") {
    const report = runValidation(options);
    writeReport(options.reportPath, report);
    printValidationSummary(report);
    exitForReport(report, options);
    return;
  }

  const report = await runMigration(options);
  writeReport(options.reportPath, report);
  printApplySummary(report);
  exitForReport(report, options);
}

function parseOptions(argv: string[], env: NodeJS.ProcessEnv): Options {
  const first = argv[0];
  let command: Command = "dry-run";
  let mode: "dry-run" | "apply" = "dry-run";

  if (first === "preflight" || first === "dry-run" || first === "apply" || first === "validate") {
    command = first;
    mode = first === "apply" ? "apply" : "dry-run";
  }

  const argMap = parseArgMap(argv);
  const modeArg = argMap.get("mode") ?? env.V215_MODE;
  if (modeArg === "apply" || modeArg === "dry-run") {
    mode = modeArg;
    if (command === "dry-run" && modeArg === "apply") command = "apply";
  }

  const v1DbPath = resolvePath(argMap.get("v1") ?? env.V215_V1_DB_PATH ?? defaultV1DbPath);
  const v2DbPath = resolvePath(argMap.get("v2") ?? env.V215_V2_DB_PATH ?? defaultV2DbPath);
  const backupDir = resolvePath(argMap.get("backup-dir") ?? env.V215_BACKUP_DIR ?? "data/backups");
  const defaultV1StorageRoot = path.resolve(path.dirname(v1DbPath), "..");
  const v1StorageRoot = resolvePath(
    argMap.get("v1-storage-root") ?? env.V215_V1_STORAGE_ROOT ?? defaultV1StorageRoot,
  );
  const mediaTargetRoot = resolvePath(
    argMap.get("media-target-root") ?? env.V215_MEDIA_TARGET_ROOT ?? "data/uploads/v1-migrated",
  );
  const proofRoot = resolvePath(argMap.get("proof-root") ?? env.V215_M303_PROOF_ROOT ?? "data");

  return {
    command,
    mode,
    v1DbPath,
    v2DbPath,
    backupDir,
    v1StorageRoot,
    mediaTargetRoot,
    proofRoot,
    reportPath: argMap.get("report") ?? env.V215_REPORT_PATH ?? null,
    targetUserId: positiveInt(argMap.get("target-user") ?? env.V215_TARGET_USER_ID, 1),
    requireBackup: envFlag(argMap.get("require-backup") ?? env.V215_REQUIRE_BACKUP, true),
    requireM303Proof: envFlag(argMap.get("require-m303-proof") ?? env.V215_REQUIRE_M303_PROOF, true),
    requireV1CleanJobs: envFlag(argMap.get("require-v1-clean-jobs") ?? env.V215_REQUIRE_V1_CLEAN_JOBS, true),
    allowBlockers: envFlag(argMap.get("allow-blockers") ?? env.V215_ALLOW_BLOCKERS, false),
    confirmCutover: env.V215_CONFIRM_CUTOVER === "SIM" || argMap.get("confirm") === "SIM",
  };
}

function parseArgMap(argv: string[]) {
  const result = new Map<string, string>();
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const [key, value = "true"] = arg.slice(2).split("=", 2);
    if (key) result.set(key, value);
  }
  return result;
}

function runPreflight(options: Options): MigrationReport {
  const report = createReport(options, "v215-cutover-preflight");
  const v1Exists = assertReadableSqlite(options.v1DbPath, "v1", report.blockers);
  const v2Exists = assertReadableSqlite(options.v2DbPath, "v2", report.blockers);
  let v1: SqliteDatabase | null = null;
  let v2: SqliteDatabase | null = null;

  try {
    if (v1Exists) {
      v1 = openReadonly(options.v1DbPath);
      report.v1 = inspectV1(v1, options, report);
    }
    if (v2Exists) {
      v2 = openReadonly(options.v2DbPath);
      report.v2 = inspectV2(v2, options, report);
    }
    applyOperationalGates(options, report);
    report.status = report.blockers.length === 0 ? "ready" : "blocked";
  } finally {
    v1?.close();
    v2?.close();
  }

  report.finishedAt = nowIso();
  return report;
}

function runValidation(options: Options): MigrationReport {
  const report = createReport(options, "v215-cutover-validate");
  const v1Exists = assertReadableSqlite(options.v1DbPath, "v1", report.blockers);
  const v2Exists = assertReadableSqlite(options.v2DbPath, "v2", report.blockers);
  let v1: SqliteDatabase | null = null;
  let v2: SqliteDatabase | null = null;

  try {
    if (v1Exists) {
      v1 = openReadonly(options.v1DbPath);
      report.v1 = inspectV1(v1, { ...options, requireV1CleanJobs: false }, report);
    }
    if (v2Exists) {
      v2 = openReadonly(options.v2DbPath);
      report.v2 = inspectV2(v2, options, report);
    }
    if (v1 && v2) {
      const source = readSource(v1);
      report.validation = validateImportedData(v2, source, options.targetUserId);
      report.status = report.validation.ok && report.blockers.length === 0 ? "valid" : "invalid";
    } else {
      report.status = "blocked";
    }
  } finally {
    v1?.close();
    v2?.close();
  }

  report.finishedAt = nowIso();
  return report;
}

async function runMigration(options: Options): Promise<MigrationReport> {
  const report = createReport(options, "v215-cutover-apply");
  if (options.mode === "apply" && !options.confirmCutover) {
    report.blockers.push("missing_confirm_cutover:V215_CONFIRM_CUTOVER=SIM");
  }
  const v1Exists = assertReadableSqlite(options.v1DbPath, "v1", report.blockers);
  const v2Exists = assertReadableSqlite(options.v2DbPath, "v2", report.blockers);

  let v1: SqliteDatabase | null = null;
  let v2: SqliteDatabase | null = null;
  try {
    if (v1Exists) {
      v1 = openReadonly(options.v1DbPath);
      report.v1 = inspectV1(v1, { ...options, requireV1CleanJobs: false }, report);
    }
    if (v2Exists) {
      v2 = new Database(options.v2DbPath, { fileMustExist: true, timeout: 10_000 });
      v2.pragma("foreign_keys = ON");
      v2.pragma("busy_timeout = 10000");
      report.v2 = inspectV2(v2, options, report);
    }
    if (!v1 || !v2 || report.blockers.length > 0) {
      report.status = "blocked";
      return finishReport(report);
    }

    const source = readSource(v1);
    report.counts.dataLakeSkipped = sumObject(source.ignoredTables);
    if (options.mode === "dry-run") {
      report.counts = planCounts(source);
      report.status = "ready";
      report.validation = validateImportPlan(source);
      return finishReport(report);
    }

    report.backup = await createPreCutoverBackup(options.v2DbPath, options.backupDir);
    report.counts = applyCutover({
      v2,
      source,
      targetUserId: options.targetUserId,
      v1StorageRoot: options.v1StorageRoot,
      mediaTargetRoot: options.mediaTargetRoot,
      warnings: report.warnings,
    });
    insertLegacyEventOnce(v2, options.targetUserId, "v215.cutover.applied", "info", "cutover", "applied", {
      backup: report.backup,
      counts: report.counts,
      source: { v1DbPath: options.v1DbPath },
    });
    report.validation = validateImportedData(v2, source, options.targetUserId);
    report.status = report.validation.ok ? "applied" : "invalid";
    return finishReport(report);
  } finally {
    v1?.close();
    v2?.close();
  }
}

function finishReport(report: MigrationReport) {
  report.finishedAt = nowIso();
  return report;
}

function createReport(options: Options, mode: string): MigrationReport {
  const startedAt = nowIso();
  return {
    mode,
    command: options.command,
    status: "blocked",
    startedAt,
    finishedAt: startedAt,
    paths: {
      v1DbPath: options.v1DbPath,
      v2DbPath: options.v2DbPath,
      backupDir: options.backupDir,
      v1StorageRoot: options.v1StorageRoot,
      mediaTargetRoot: options.mediaTargetRoot,
      proofRoot: options.proofRoot,
    },
    targetUserId: options.targetUserId,
    blockers: [],
    warnings: [],
    counts: emptyCounts(),
    v1: null,
    v2: null,
  };
}

function inspectV1(db: SqliteDatabase, options: Options, report: MigrationReport) {
  const tables = new Set(listTables(db));
  for (const table of requiredV1Tables) {
    if (!tables.has(table)) report.blockers.push(`v1_missing_table:${table}`);
  }
  for (const [table, columns] of Object.entries(requiredV1Columns)) {
    if (!tables.has(table)) continue;
    const existing = new Set(listColumns(db, table));
    for (const columnName of columns) {
      if (!existing.has(columnName)) report.blockers.push(`v1_missing_column:${table}.${columnName}`);
    }
  }

  const allTables = [...requiredV1Tables, ...optionalV1Tables].filter((table, index, list) => {
    return list.indexOf(table) === index;
  });
  const counts = countTables(db, allTables);
  const activeJobs = tables.has("jobs")
    ? scalar(db, "SELECT count(*) FROM jobs WHERE status IN ('pending', 'processing')")
    : 0;
  const ignoredTables = Object.fromEntries(
    listTables(db)
      .filter((table) => table.startsWith("data_lake_"))
      .map((table) => [table, scalar(db, `SELECT count(*) FROM ${quoteIdent(table)}`)]),
  );

  if (options.requireV1CleanJobs && activeJobs > 0) report.blockers.push(`v1_active_jobs:${activeJobs}`);
  if (tables.has("contacts")) {
    const contactsWithoutReach = scalar(
      db,
      `SELECT count(*) FROM contacts
       WHERE IFNULL(TRIM(phone), '') = ''
         AND IFNULL(TRIM(instagram), '') = ''
         AND IFNULL(TRIM(deleted_at), '') = ''`,
    );
    if (contactsWithoutReach > 0) report.warnings.push(`v1_contacts_without_phone_or_instagram:${contactsWithoutReach}`);
  }

  return { counts, activeJobs, ignoredTables };
}

function inspectV2(db: SqliteDatabase, options: Options, report: MigrationReport) {
  const tables = new Set(listTables(db));
  for (const table of requiredV2Tables) {
    if (!tables.has(table)) report.blockers.push(`v2_missing_table:${table}`);
  }
  const counts = countTables(db, requiredV2Tables);
  const targetUserExists = tables.has("users")
    ? scalar(db, "SELECT count(*) FROM users WHERE id = ?", [options.targetUserId]) > 0
    : false;
  const activeJobs = tables.has("jobs")
    ? scalar(
        db,
        `SELECT count(*) FROM jobs
         WHERE status IN ('queued', 'claimed', 'running')
           AND json_extract(payload_json, '$.v1.sourceJobId') IS NULL`,
      )
    : 0;

  if (!targetUserExists) report.blockers.push(`v2_target_user_missing:${options.targetUserId}`);
  if (activeJobs > 0) report.blockers.push(`v2_active_jobs:${activeJobs}`);
  if ((counts.contacts ?? 0) > 0 || (counts.conversations ?? 0) > 0 || (counts.messages ?? 0) > 0) {
    report.warnings.push(
      `v2_existing_data:contacts=${counts.contacts ?? 0},conversations=${counts.conversations ?? 0},messages=${counts.messages ?? 0}`,
    );
  }

  return { counts, activeJobs, targetUserExists };
}

function applyOperationalGates(options: Options, report: MigrationReport) {
  if (options.requireBackup) {
    const backup = findLatestBackup(options.backupDir);
    if (!backup) report.blockers.push(`missing_v2_backup:${options.backupDir}`);
    else report.v2 = { ...(report.v2 ?? { counts: {}, activeJobs: 0, targetUserExists: false }), latestBackup: backup };
  }
  if (options.requireM303Proof) {
    const proof = findM303Proof(options.proofRoot);
    if (!proof) report.blockers.push(`missing_m303_wpp_24_send_90_proof:${options.proofRoot}`);
    else report.v2 = { ...(report.v2 ?? { counts: {}, activeJobs: 0, targetUserExists: false }), m303Proof: proof };
  }
}

function readSource(db: SqliteDatabase): SourceData {
  const tables = new Set(listTables(db));
  const ignoredTables = Object.fromEntries(
    [...tables]
      .filter((table) => table.startsWith("data_lake_"))
      .map((table) => [table, scalar(db, `SELECT count(*) FROM ${quoteIdent(table)}`)]),
  );
  const allTables = [...requiredV1Tables, ...optionalV1Tables].filter((table, index, list) => {
    return list.indexOf(table) === index;
  });

  return {
    tables,
    ignoredTables,
    tags: selectAll(db, tables, "tags"),
    contacts: selectAll(db, tables, "contacts"),
    contactTags: selectAll(db, tables, "contact_tags"),
    attendants: selectAll(db, tables, "attendants"),
    mediaAssets: selectAll(db, tables, "media_assets"),
    conversations: selectAll(db, tables, "conversations"),
    messages: selectAll(db, tables, "messages"),
    campaigns: selectAll(db, tables, "campaigns"),
    campaignSteps: selectAll(db, tables, "campaign_steps"),
    campaignRecipients: selectAll(db, tables, "campaign_recipients"),
    campaignExecutions: selectAll(db, tables, "campaign_executions"),
    automations: selectAll(db, tables, "automations"),
    automationActions: selectAll(db, tables, "automation_actions"),
    automationRuns: selectAll(db, tables, "automation_runs"),
    automationContactState: selectAll(db, tables, "automation_contact_state"),
    chatbots: selectAll(db, tables, "chatbots"),
    chatbotRules: selectAll(db, tables, "chatbot_rules"),
    jobs: selectAll(db, tables, "jobs"),
    reminders: selectAll(db, tables, "reminders"),
    auditLogs: selectAll(db, tables, "audit_logs"),
    systemLogs: selectAll(db, tables, "system_logs"),
    systemEvents: selectAll(db, tables, "system_events"),
    counts: countTables(db, allTables),
  };
}

function planCounts(source: SourceData): MigrationCounts {
  const counts = emptyCounts();
  counts.users = 1;
  counts.tags = source.tags.length;
  counts.contacts = source.contacts.filter((row) => !nullableText(column(row, "deleted_at"))).length;
  counts.contactTags = source.contactTags.length;
  counts.attendants = source.attendants.length;
  counts.mediaAssets = source.mediaAssets.length;
  counts.conversations = source.conversations.length;
  counts.messages = source.messages.length;
  counts.campaigns = source.campaigns.length;
  counts.campaignRecipients = source.campaignRecipients.length;
  counts.automations = source.automations.length;
  counts.automationEvents = source.automationRuns.length + source.automationContactState.length;
  counts.chatbots = source.chatbots.length;
  counts.chatbotRules = source.chatbotRules.length;
  counts.jobs = source.jobs.filter((row) => isLiveV1Job(row)).length;
  counts.reminders = source.reminders.length;
  counts.auditLogs = source.auditLogs.length;
  counts.systemEvents =
    source.systemLogs.length +
    source.systemEvents.length +
    source.campaignExecutions.length +
    counts.automationEvents;
  counts.dataLakeSkipped = sumObject(source.ignoredTables);
  return counts;
}

function applyCutover(input: {
  v2: SqliteDatabase;
  source: SourceData;
  targetUserId: number;
  v1StorageRoot: string;
  mediaTargetRoot: string;
  warnings: string[];
}): MigrationCounts {
  const counts = emptyCounts();
  const maps = emptyMaps();
  const existing = loadExistingMigrationMarkers(input.v2);
  const actionsByAutomation = groupBy(input.source.automationActions, "automation_id");
  const stepsByCampaign = groupBy(input.source.campaignSteps, "campaign_id");
  const rulesByChatbot = groupBy(input.source.chatbotRules, "chatbot_id");

  const tx = input.v2.transaction(() => {
    counts.users = ensureTargetUser(input.v2, input.targetUserId) ? 1 : 0;

    for (const row of input.source.tags) {
      const id = upsertTag(input.v2, input.targetUserId, row);
      maps.tags.set(sourceKey(row), id);
      counts.tags += 1;
    }

    for (const row of input.source.attendants) {
      const id = upsertAttendant(input.v2, input.targetUserId, row);
      maps.attendants.set(sourceKey(row), id);
      counts.attendants += 1;
    }

    for (const row of input.source.contacts) {
      if (nullableText(column(row, "deleted_at"))) {
        counts.rowsSkipped += 1;
        continue;
      }
      const id = upsertContact(input.v2, input.targetUserId, row);
      maps.contacts.set(sourceKey(row), id);
      counts.contacts += 1;
    }

    for (const row of input.source.contactTags) {
      const contactId = maps.contacts.get(String(column(row, "contact_id")));
      const tagId = maps.tags.get(String(column(row, "tag_id")));
      if (!contactId || !tagId) {
        counts.rowsSkipped += 1;
        continue;
      }
      input.v2
        .prepare(
          `INSERT OR IGNORE INTO contact_tags (contact_id, tag_id, user_id, sort_order, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(contactId, tagId, input.targetUserId, numberValue(column(row, "sort_order"), 0), nowIso());
      counts.contactTags += 1;
    }

    for (const row of input.source.mediaAssets) {
      const copiedPath = copyMediaFile(row, input.v1StorageRoot, input.mediaTargetRoot, input.warnings);
      if (copiedPath.status === "copied") counts.mediaFilesCopied += 1;
      if (copiedPath.status === "missing") counts.mediaFilesMissing += 1;
      const id = upsertMediaAsset(input.v2, input.targetUserId, row, copiedPath.storagePath);
      maps.mediaAssets.set(sourceKey(row), id);
      counts.mediaAssets += 1;
    }

    for (const row of input.source.conversations) {
      const contactId = maps.contacts.get(String(column(row, "contact_id"))) ?? null;
      const id = upsertConversation(input.v2, input.targetUserId, row, contactId);
      maps.conversations.set(sourceKey(row), id);
      counts.conversations += 1;
    }

    for (const row of input.source.messages) {
      const conversationId = maps.conversations.get(String(column(row, "conversation_id")));
      if (!conversationId) {
        counts.rowsSkipped += 1;
        continue;
      }
      const contactId = maps.contacts.get(String(column(row, "contact_id"))) ?? null;
      const mediaAssetId = maps.mediaAssets.get(String(column(row, "media_asset_id"))) ?? null;
      const id = upsertMessage(input.v2, input.targetUserId, row, { conversationId, contactId, mediaAssetId });
      if (id) maps.messages.set(sourceKey(row), id);
      counts.messages += 1;
    }

    for (const row of input.source.campaigns) {
      const id = upsertCampaign(input.v2, input.targetUserId, row, stepsByCampaign.get(sourceKey(row)) ?? []);
      maps.campaigns.set(sourceKey(row), id);
      counts.campaigns += 1;
    }

    for (const row of input.source.campaignRecipients) {
      const campaignId = maps.campaigns.get(String(column(row, "campaign_id")));
      if (!campaignId) {
        counts.rowsSkipped += 1;
        continue;
      }
      const contactId = maps.contacts.get(String(column(row, "contact_id"))) ?? null;
      upsertCampaignRecipient(input.v2, input.targetUserId, row, { campaignId, contactId });
      counts.campaignRecipients += 1;
    }

    for (const row of input.source.campaignExecutions) {
      insertLegacyEventOnce(
        input.v2,
        input.targetUserId,
        "v215.legacy.campaign_execution",
        "info",
        "campaign_executions",
        sourceKey(row),
        { raw: row },
      );
      counts.systemEvents += 1;
    }

    for (const row of input.source.automations) {
      const id = upsertAutomation(
        input.v2,
        input.targetUserId,
        row,
        actionsByAutomation.get(sourceKey(row)) ?? [],
      );
      maps.automations.set(sourceKey(row), id);
      counts.automations += 1;
    }

    for (const row of input.source.automationRuns) {
      const automationId = maps.automations.get(String(column(row, "automation_id"))) ?? null;
      const contactId = maps.contacts.get(String(column(row, "contact_id"))) ?? null;
      const conversationId = maps.conversations.get(String(column(row, "conversation_id"))) ?? null;
      insertLegacyEventOnce(
        input.v2,
        input.targetUserId,
        "v215.legacy.automation_run",
        eventSeverity(row),
        "automation_runs",
        sourceKey(row),
        { automationId, contactId, conversationId, raw: row },
      );
      counts.automationEvents += 1;
      counts.systemEvents += 1;
    }

    for (const row of input.source.automationContactState) {
      const automationId = maps.automations.get(String(column(row, "automation_id"))) ?? null;
      const contactId = maps.contacts.get(String(column(row, "contact_id"))) ?? null;
      insertLegacyEventOnce(
        input.v2,
        input.targetUserId,
        "v215.legacy.automation_contact_state",
        "info",
        "automation_contact_state",
        sourceKey(row),
        { automationId, contactId, raw: row },
      );
      counts.automationEvents += 1;
      counts.systemEvents += 1;
    }

    for (const row of input.source.chatbots) {
      const id = upsertChatbot(input.v2, input.targetUserId, row);
      maps.chatbots.set(sourceKey(row), id);
      counts.chatbots += 1;
    }

    for (const row of input.source.chatbotRules) {
      const chatbotId = maps.chatbots.get(String(column(row, "chatbot_id")));
      if (!chatbotId) {
        counts.rowsSkipped += 1;
        continue;
      }
      const id = upsertChatbotRule(input.v2, input.targetUserId, row, chatbotId);
      maps.chatbotRules.set(sourceKey(row), id);
      counts.chatbotRules += 1;
    }

    for (const [sourceChatbotId, rules] of rulesByChatbot) {
      if (!maps.chatbots.has(sourceChatbotId)) counts.rowsSkipped += rules.length;
    }

    for (const row of input.source.jobs) {
      if (!isLiveV1Job(row)) {
        counts.rowsSkipped += 1;
        continue;
      }
      const id = upsertJob(input.v2, input.targetUserId, row, maps);
      maps.jobs.set(sourceKey(row), id);
      counts.jobs += 1;
    }

    for (const row of input.source.reminders) {
      const contactId = maps.contacts.get(String(column(row, "contact_id"))) ?? null;
      const conversationId = maps.conversations.get(String(column(row, "conversation_id"))) ?? null;
      upsertReminder(input.v2, input.targetUserId, row, { contactId, conversationId });
      counts.reminders += 1;
    }

    for (const row of input.source.auditLogs) {
      if (existing.auditLogs.has(sourceKey(row))) continue;
      insertAuditLog(input.v2, input.targetUserId, row, maps);
      existing.auditLogs.add(sourceKey(row));
      counts.auditLogs += 1;
    }

    for (const row of input.source.systemLogs) {
      insertLegacyEventOnce(
        input.v2,
        input.targetUserId,
        "v215.legacy.system_log",
        eventSeverity(row),
        "system_logs",
        sourceKey(row),
        { raw: row },
      );
      counts.systemEvents += 1;
    }

    for (const row of input.source.systemEvents) {
      insertLegacyEventOnce(
        input.v2,
        input.targetUserId,
        textValue(column(row, "type")) || "v215.legacy.system_event",
        eventSeverity(row),
        "system_events",
        sourceKey(row),
        { raw: row },
      );
      counts.systemEvents += 1;
    }
  });

  tx();
  counts.dataLakeSkipped = sumObject(input.source.ignoredTables);
  return counts;
}

function ensureTargetUser(db: SqliteDatabase, targetUserId: number) {
  const existing = db.prepare("SELECT id FROM users WHERE id = ?").get(targetUserId) as Row | undefined;
  if (existing) return true;
  db.prepare(
    `INSERT INTO users (id, email, password_hash, role, display_name, is_active, created_at, updated_at)
     VALUES (?, ?, ?, 'admin', 'Gabriel', 1, ?, ?)`,
  ).run(targetUserId, `admin+v215-${targetUserId}@nuoma.local`, "v215-import-placeholder", nowIso(), nowIso());
  return true;
}

function upsertTag(db: SqliteDatabase, userId: number, row: Row) {
  const name = textValue(column(row, "name")) || `v1-tag-${sourceKey(row)}`;
  const color = textValue(column(row, "color")) || "#3ddc97";
  const existing = db.prepare("SELECT id FROM tags WHERE user_id = ? AND name = ?").get(userId, name) as
    | Row
    | undefined;
  if (existing?.id) {
    db.prepare("UPDATE tags SET color = ?, updated_at = ? WHERE id = ?").run(color, nowIso(), existing.id);
    return Number(existing.id);
  }
  const result = db
    .prepare(
      `INSERT INTO tags (user_id, name, color, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(userId, name, color, "Migrado do nuoma-wpp via V2.15", nowIso(), nowIso());
  return Number(result.lastInsertRowid);
}

function upsertAttendant(db: SqliteDatabase, userId: number, row: Row) {
  const email = nullableText(column(row, "email"));
  const name = nullableText(column(row, "name", "display_name")) || email || `Atendente V1 ${sourceKey(row)}`;
  const existing = email
    ? (db.prepare("SELECT id FROM attendants WHERE user_id = ? AND email = ?").get(userId, email) as Row | undefined)
    : (db.prepare("SELECT id FROM attendants WHERE user_id = ? AND name = ?").get(userId, name) as Row | undefined);
  if (existing?.id) {
    db.prepare("UPDATE attendants SET name = ?, is_active = ?, updated_at = ? WHERE id = ?").run(
      name,
      booleanInt(column(row, "is_active", "active"), true),
      nowIso(),
      existing.id,
    );
    return Number(existing.id);
  }
  const result = db
    .prepare(
      `INSERT INTO attendants (user_id, user_account_id, name, email, role, is_active, created_at, updated_at)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      userId,
      name,
      email,
      enumValue({ admin: "admin", attendant: "attendant", viewer: "viewer" }, column(row, "role"), "attendant"),
      booleanInt(column(row, "is_active", "active"), true),
      nowIso(),
      nowIso(),
    );
  return Number(result.lastInsertRowid);
}

function upsertContact(db: SqliteDatabase, userId: number, row: Row) {
  const phone = normalizePhone(column(row, "phone"));
  const phoneE164 = normalizePhoneE164(phone);
  const waJid = normalizeWaJid(phone);
  const email = nullableText(column(row, "email"));
  const instagram = normalizeInstagram(column(row, "instagram", "instagram_handle"));
  const existing = findExistingContact(db, userId, { phone, phoneE164, waJid, email, instagram });
  const name = nullableText(column(row, "name")) || phone || instagram || email || `Contato V1 ${sourceKey(row)}`;
  const status = enumValue(statusMap, column(row, "status"), "lead");
  const note = migrationNote("contact", sourceKey(row));
  const lastMessageAt = nullableText(column(row, "last_message_at", "last_interaction_at", "updated_at"));

  if (existing?.id) {
    db.prepare(
      `UPDATE contacts
          SET name = ?,
              phone = COALESCE(?, phone),
              phone_e164 = COALESCE(?, phone_e164),
              wa_jid = COALESCE(?, wa_jid),
              email = COALESCE(?, email),
              instagram_handle = COALESCE(?, instagram_handle),
              primary_channel = ?,
              status = ?,
              notes = ?,
              last_message_at = COALESCE(?, last_message_at),
              deleted_at = NULL,
              updated_at = ?
        WHERE id = ?`,
    ).run(
      name,
      phone,
      phoneE164,
      waJid,
      email,
      instagram,
      instagram && !phone ? "instagram" : "whatsapp",
      status,
      mergeNote(existing.notes, note),
      lastMessageAt,
      nowIso(),
      existing.id,
    );
    return Number(existing.id);
  }

  const result = db
    .prepare(
      `INSERT INTO contacts (
        user_id, name, phone, phone_e164, wa_jid, email, primary_channel, instagram_handle,
        status, notes, last_message_at, deleted_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    )
    .run(
      userId,
      name,
      phone,
      phoneE164,
      waJid,
      email,
      instagram && !phone ? "instagram" : "whatsapp",
      instagram,
      status,
      note,
      lastMessageAt,
      nowIso(),
      nowIso(),
    );
  return Number(result.lastInsertRowid);
}

function upsertMediaAsset(db: SqliteDatabase, userId: number, row: Row, storagePath: string) {
  const sha = textValue(column(row, "sha256")) || `v1-${sourceKey(row)}`;
  const existing = db.prepare("SELECT id FROM media_assets WHERE user_id = ? AND sha256 = ?").get(userId, sha) as
    | Row
    | undefined;
  if (existing?.id) return Number(existing.id);
  const result = db
    .prepare(
      `INSERT INTO media_assets (
        user_id, type, file_name, mime_type, sha256, size_bytes, duration_ms,
        storage_path, source_url, deleted_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    )
    .run(
      userId,
      mediaType(column(row, "category", "type", "content_type")),
      textValue(column(row, "original_name", "file_name", "safe_name")) || `media-${sourceKey(row)}`,
      textValue(column(row, "mime_type")) || "application/octet-stream",
      sha,
      numberValue(column(row, "size_bytes"), 0),
      nullableNumber(column(row, "duration_ms", "duration")),
      storagePath,
      `nuoma-wpp:v1:${sourceKey(row)}`,
      nullableText(column(row, "created_at")) || nowIso(),
      nowIso(),
    );
  return Number(result.lastInsertRowid);
}

function upsertConversation(db: SqliteDatabase, userId: number, row: Row, contactId: number | null) {
  const channel = channelValue(column(row, "channel"));
  const externalThreadId =
    normalizePhone(column(row, "external_thread_id", "wa_chat_id")) ||
    textValue(column(row, "external_thread_id", "wa_chat_id")) ||
    `v1:${sourceKey(row)}`;
  const waJid = channel === "whatsapp" ? normalizeWaJid(externalThreadId) : null;
  const title = nullableText(column(row, "title")) || externalThreadId;
  const existing = db
    .prepare("SELECT id FROM conversations WHERE user_id = ? AND channel = ? AND external_thread_id = ?")
    .get(userId, channel, externalThreadId) as Row | undefined;

  if (existing?.id) {
    db.prepare(
      `UPDATE conversations
          SET contact_id = COALESCE(?, contact_id),
              wa_jid = COALESCE(?, wa_jid),
              title = ?,
              last_message_at = COALESCE(?, last_message_at),
              last_preview = COALESCE(?, last_preview),
              unread_count = ?,
              is_archived = 0,
              updated_at = ?
        WHERE id = ?`,
    ).run(
      contactId,
      waJid,
      title,
      nullableText(column(row, "last_message_at")),
      nullableText(column(row, "last_message_preview", "last_preview")),
      numberValue(column(row, "unread_count"), 0),
      nowIso(),
      existing.id,
    );
    return Number(existing.id);
  }

  const result = db
    .prepare(
      `INSERT INTO conversations (
        user_id, contact_id, channel, external_thread_id, wa_jid, title, last_message_at,
        last_preview, unread_count, is_archived, temporary_messages_until, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)`,
    )
    .run(
      userId,
      contactId,
      channel,
      externalThreadId,
      waJid,
      title,
      nullableText(column(row, "last_message_at")),
      nullableText(column(row, "last_message_preview", "last_preview")),
      numberValue(column(row, "unread_count"), 0),
      nullableText(column(row, "created_at")) || nowIso(),
      nullableText(column(row, "updated_at")) || nowIso(),
    );
  return Number(result.lastInsertRowid);
}

function upsertMessage(
  db: SqliteDatabase,
  userId: number,
  row: Row,
  refs: { conversationId: number; contactId: number | null; mediaAssetId: number | null },
) {
  const sourceId = sourceKey(row);
  const existing = findImportedMessage(db, refs.conversationId, sourceId, nullableText(column(row, "external_id")));
  const externalId = nullableText(column(row, "external_id"));
  const direction = enumValue(directionMap, column(row, "direction"), "system");
  const contentType = enumValue(messageTypeMap, column(row, "content_type", "type"), "text");
  const status = messageStatus(column(row, "status"), direction);
  const observedAt = nullableText(column(row, "sent_at", "created_at")) || nowIso();
  const raw = JSON.stringify({ v1: { sourceTable: "messages", sourceId, raw: row } });

  if (existing?.id) {
    db.prepare(
      `UPDATE messages
          SET contact_id = COALESCE(?, contact_id),
              media_asset_id = COALESCE(?, media_asset_id),
              status = ?,
              body = ?,
              raw_json = ?,
              updated_at = ?
        WHERE id = ?`,
    ).run(
      refs.contactId,
      refs.mediaAssetId,
      status,
      nullableText(column(row, "body")) ?? "",
      raw,
      nowIso(),
      existing.id,
    );
    return Number(existing.id);
  }

  const result = db
    .prepare(
      `INSERT OR IGNORE INTO messages (
        user_id, conversation_id, contact_id, external_id, direction, content_type, status,
        body, media_asset_id, media_json, observed_at_utc, raw_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      userId,
      refs.conversationId,
      refs.contactId,
      externalId,
      direction,
      contentType,
      status,
      nullableText(column(row, "body")) ?? "",
      refs.mediaAssetId,
      mediaJson(row),
      observedAt,
      raw,
      nullableText(column(row, "created_at")) || observedAt,
      nowIso(),
    );
  return result.lastInsertRowid ? Number(result.lastInsertRowid) : null;
}

function upsertCampaign(db: SqliteDatabase, userId: number, row: Row, steps: Row[]) {
  const sourceId = sourceKey(row);
  const existing = findImportedByMetadata(db, "campaigns", userId, "sourceCampaignId", sourceId);
  const name = nullableText(column(row, "name", "title")) || `Campanha V1 ${sourceId}`;
  const status = enumValue(campaignStatusMap, column(row, "status"), "draft");
  const mappedSteps = steps.map((step, index) => ({
    id: String(column(step, "id") ?? `step-${index + 1}`),
    type: enumValue(messageTypeMap, column(step, "type", "content_type"), "text"),
    label: nullableText(column(step, "label", "name", "title")) || `Step ${index + 1}`,
    body: nullableText(column(step, "body", "message", "content")),
    delayMinutes: nullableNumber(column(step, "delay_minutes", "delay")),
    source: "v1",
    raw: step,
  }));
  const metadata = JSON.stringify({ v1: { sourceCampaignId: sourceId }, migratedBy: "v215" });

  if (existing?.id) {
    db.prepare(
      `UPDATE campaigns SET name = ?, status = ?, steps_json = ?, metadata_json = ?, updated_at = ? WHERE id = ?`,
    ).run(name, status, JSON.stringify(mappedSteps), metadata, nowIso(), existing.id);
    return Number(existing.id);
  }
  const result = db
    .prepare(
      `INSERT INTO campaigns (
        user_id, name, status, channel, segment_json, steps_json, evergreen,
        starts_at, completed_at, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      userId,
      name,
      status,
      channelValue(column(row, "channel")),
      nullableText(column(row, "segment_json", "evergreen_criteria_json")),
      JSON.stringify(mappedSteps),
      booleanInt(column(row, "is_evergreen", "evergreen"), false),
      nullableText(column(row, "starts_at", "scheduled_at")),
      nullableText(column(row, "completed_at")),
      metadata,
      nullableText(column(row, "created_at")) || nowIso(),
      nowIso(),
    );
  return Number(result.lastInsertRowid);
}

function upsertCampaignRecipient(
  db: SqliteDatabase,
  userId: number,
  row: Row,
  refs: { campaignId: number; contactId: number | null },
) {
  const sourceId = sourceKey(row);
  const existing = findImportedRecipient(db, refs.campaignId, sourceId);
  const phone = normalizePhone(column(row, "phone")) || nullableText(column(row, "phone"));
  const metadata = JSON.stringify({ v1: { sourceRecipientId: sourceId }, migratedBy: "v215" });
  const status = enumValue(recipientStatusMap, column(row, "status"), "queued");

  if (existing?.id) {
    db.prepare(
      `UPDATE campaign_recipients
          SET contact_id = COALESCE(?, contact_id),
              phone = COALESCE(?, phone),
              status = ?,
              metadata_json = ?,
              updated_at = ?
        WHERE id = ?`,
    ).run(refs.contactId, phone, status, metadata, nowIso(), existing.id);
    return Number(existing.id);
  }
  const result = db
    .prepare(
      `INSERT INTO campaign_recipients (
        user_id, campaign_id, contact_id, phone, channel, status, current_step_id,
        last_error, active_pipeline_key, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
    )
    .run(
      userId,
      refs.campaignId,
      refs.contactId,
      phone,
      channelValue(column(row, "channel")),
      status,
      nullableText(column(row, "current_step_id", "step_id")),
      nullableText(column(row, "last_error", "error_message")),
      metadata,
      nullableText(column(row, "created_at")) || nowIso(),
      nowIso(),
    );
  return Number(result.lastInsertRowid);
}

function upsertAutomation(db: SqliteDatabase, userId: number, row: Row, actionRows: Row[]) {
  const sourceId = sourceKey(row);
  const existing = findImportedByMetadata(db, "automations", userId, "sourceAutomationId", sourceId);
  const name = nullableText(column(row, "name", "title")) || `Automação V1 ${sourceId}`;
  const actions = actionRows.length > 0 ? actionRows.map(mapAutomationAction) : parseJsonArray(column(row, "actions_json"));
  const trigger = parseJsonObject(column(row, "trigger_json")) ?? {
    type: nullableText(column(row, "trigger_type", "trigger_event")) || "message_received",
    event: nullableText(column(row, "trigger_event")),
  };
  const condition = parseJsonObject(column(row, "condition_json", "trigger_conditions_json")) ?? {};
  const metadata = JSON.stringify({ v1: { sourceAutomationId: sourceId, raw: row }, migratedBy: "v215" });

  if (existing?.id) {
    db.prepare(
      `UPDATE automations
          SET name = ?, category = ?, status = ?, trigger_json = ?, condition_json = ?,
              actions_json = ?, metadata_json = ?, updated_at = ?
        WHERE id = ?`,
    ).run(
      name,
      nullableText(column(row, "custom_category", "category")) || "v1-import",
      enumValue(automationStatusMap, column(row, "status"), "draft"),
      JSON.stringify(trigger),
      JSON.stringify(condition),
      JSON.stringify(actions),
      metadata,
      nowIso(),
      existing.id,
    );
    return Number(existing.id);
  }
  const result = db
    .prepare(
      `INSERT INTO automations (
        user_id, name, category, status, trigger_json, condition_json,
        actions_json, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      userId,
      name,
      nullableText(column(row, "custom_category", "category")) || "v1-import",
      enumValue(automationStatusMap, column(row, "status"), "draft"),
      JSON.stringify(trigger),
      JSON.stringify(condition),
      JSON.stringify(actions),
      metadata,
      nullableText(column(row, "created_at")) || nowIso(),
      nowIso(),
    );
  return Number(result.lastInsertRowid);
}

function upsertChatbot(db: SqliteDatabase, userId: number, row: Row) {
  const sourceId = sourceKey(row);
  const existing = findImportedByMetadata(db, "chatbots", userId, "sourceChatbotId", sourceId);
  const metadata = JSON.stringify({ v1: { sourceChatbotId: sourceId, raw: row }, migratedBy: "v215" });
  if (existing?.id) {
    db.prepare(
      `UPDATE chatbots
          SET name = ?, channel = ?, status = ?, fallback_message = ?, metadata_json = ?, updated_at = ?
        WHERE id = ?`,
    ).run(
      nullableText(column(row, "name", "title")) || `Chatbot V1 ${sourceId}`,
      channelValue(column(row, "channel")),
      enumValue(automationStatusMap, column(row, "status"), "draft"),
      nullableText(column(row, "fallback_message", "fallback")),
      metadata,
      nowIso(),
      existing.id,
    );
    return Number(existing.id);
  }
  const result = db
    .prepare(
      `INSERT INTO chatbots (
        user_id, name, channel, status, fallback_message, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      userId,
      nullableText(column(row, "name", "title")) || `Chatbot V1 ${sourceId}`,
      channelValue(column(row, "channel")),
      enumValue(automationStatusMap, column(row, "status"), "draft"),
      nullableText(column(row, "fallback_message", "fallback")),
      metadata,
      nullableText(column(row, "created_at")) || nowIso(),
      nowIso(),
    );
  return Number(result.lastInsertRowid);
}

function upsertChatbotRule(db: SqliteDatabase, userId: number, row: Row, chatbotId: number) {
  const sourceId = sourceKey(row);
  const existing = findImportedByMetadata(db, "chatbot_rules", userId, "sourceRuleId", sourceId);
  const metadata = JSON.stringify({ v1: { sourceRuleId: sourceId, raw: row }, migratedBy: "v215" });
  const match = parseJsonObject(column(row, "match_json")) ?? {
    type: nullableText(column(row, "match_type")) || "keyword",
    keywords: parseJsonArray(column(row, "keywords_json")) ?? [nullableText(column(row, "keyword"))].filter(Boolean),
  };
  const actions = parseJsonArray(column(row, "actions_json")) ?? [
    { type: "send_message", body: nullableText(column(row, "response", "body")) || "" },
  ];
  if (existing?.id) {
    db.prepare(
      `UPDATE chatbot_rules
          SET chatbot_id = ?, name = ?, priority = ?, match_json = ?, segment_json = ?,
              actions_json = ?, metadata_json = ?, is_active = ?, updated_at = ?
        WHERE id = ?`,
    ).run(
      chatbotId,
      nullableText(column(row, "name", "label")) || `Regra V1 ${sourceId}`,
      numberValue(column(row, "priority"), 100),
      JSON.stringify(match),
      nullableText(column(row, "segment_json")),
      JSON.stringify(actions),
      metadata,
      booleanInt(column(row, "is_active", "active"), true),
      nowIso(),
      existing.id,
    );
    return Number(existing.id);
  }
  const result = db
    .prepare(
      `INSERT INTO chatbot_rules (
        user_id, chatbot_id, name, priority, match_json, segment_json,
        actions_json, metadata_json, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      userId,
      chatbotId,
      nullableText(column(row, "name", "label")) || `Regra V1 ${sourceId}`,
      numberValue(column(row, "priority"), 100),
      JSON.stringify(match),
      nullableText(column(row, "segment_json")),
      JSON.stringify(actions),
      metadata,
      booleanInt(column(row, "is_active", "active"), true),
      nullableText(column(row, "created_at")) || nowIso(),
      nowIso(),
    );
  return Number(result.lastInsertRowid);
}

function upsertJob(db: SqliteDatabase, userId: number, row: Row, maps: IdMaps) {
  const sourceId = sourceKey(row);
  const existing = findImportedJob(db, userId, sourceId, nullableText(column(row, "dedupe_key")));
  const status = enumValue(jobStatusMap, column(row, "status"), "queued");
  const payload = parseJsonObject(column(row, "payload_json", "payload")) ?? {};
  const enrichedPayload = {
    ...payload,
    v1: {
      sourceJobId: sourceId,
      sourcePayload: payload,
      mappedContactId: maps.contacts.get(String(column(row, "contact_id"))) ?? null,
      mappedConversationId: maps.conversations.get(String(column(row, "conversation_id"))) ?? null,
    },
  };
  if (existing?.id) {
    db.prepare(
      `UPDATE jobs
          SET status = ?, payload_json = ?, attempts = ?, max_attempts = ?, last_error = ?, updated_at = ?
        WHERE id = ?`,
    ).run(
      status,
      JSON.stringify(enrichedPayload),
      numberValue(column(row, "attempts"), 0),
      numberValue(column(row, "max_attempts"), 3),
      nullableText(column(row, "error_message", "last_error")),
      nowIso(),
      existing.id,
    );
    return Number(existing.id);
  }
  const result = db
    .prepare(
      `INSERT INTO jobs (
        user_id, type, status, payload_json, priority, dedupe_key, dedupe_expires_at,
        scheduled_at, claimed_at, claimed_by, attempts, max_attempts, last_error, completed_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    )
    .run(
      userId,
      enumValue(jobTypeMap, column(row, "type"), "send_message"),
      status,
      JSON.stringify(enrichedPayload),
      numberValue(column(row, "priority"), 5),
      nullableText(column(row, "dedupe_key")),
      nullableText(column(row, "dedupe_expires_at")) ?? addHours(nowIso(), 24),
      nullableText(column(row, "scheduled_at")) || nowIso(),
      nullableText(column(row, "locked_at", "claimed_at")),
      nullableText(column(row, "locked_by", "claimed_by")),
      numberValue(column(row, "attempts"), 0),
      numberValue(column(row, "max_attempts"), 3),
      nullableText(column(row, "error_message", "last_error")),
      nullableText(column(row, "created_at")) || nowIso(),
      nowIso(),
    );
  return Number(result.lastInsertRowid);
}

function upsertReminder(
  db: SqliteDatabase,
  userId: number,
  row: Row,
  refs: { contactId: number | null; conversationId: number | null },
) {
  const sourceId = sourceKey(row);
  const marker = `sourceId=${sourceId}`;
  const existing = db
    .prepare(
      `SELECT id FROM reminders
       WHERE user_id = ?
         AND notes LIKE ?
       ORDER BY id DESC LIMIT 1`,
    )
    .get(userId, `%${marker}%`) as Row | undefined;
  const notes = mergeNote(nullableText(column(row, "notes", "body")), migrationNote("reminder", sourceId));
  if (existing?.id) {
    db.prepare(
      `UPDATE reminders
          SET contact_id = ?, conversation_id = ?, title = ?, notes = ?, due_at = ?,
              status = ?, completed_at = ?, updated_at = ?
        WHERE id = ?`,
    ).run(
      refs.contactId,
      refs.conversationId,
      nullableText(column(row, "title")) || `Lembrete V1 ${sourceId}`,
      notes,
      nullableText(column(row, "due_at", "scheduled_at")) || nowIso(),
      reminderStatus(column(row, "status")),
      nullableText(column(row, "completed_at")),
      nowIso(),
      existing.id,
    );
    return Number(existing.id);
  }
  const result = db
    .prepare(
      `INSERT INTO reminders (
        user_id, contact_id, conversation_id, assigned_to_user_id, title, notes,
        due_at, status, completed_at, created_at, updated_at
      ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      userId,
      refs.contactId,
      refs.conversationId,
      nullableText(column(row, "title")) || `Lembrete V1 ${sourceId}`,
      notes,
      nullableText(column(row, "due_at", "scheduled_at")) || nowIso(),
      reminderStatus(column(row, "status")),
      nullableText(column(row, "completed_at")),
      nullableText(column(row, "created_at")) || nowIso(),
      nowIso(),
    );
  return Number(result.lastInsertRowid);
}

function insertAuditLog(db: SqliteDatabase, userId: number, row: Row, maps: IdMaps) {
  const targetTable = nullableText(column(row, "target_table", "entity", "table_name")) || "v1";
  const targetId = numericTargetId(column(row, "target_id"));
  const before = parseJsonObject(column(row, "before_json")) ?? null;
  const after = {
    ...(parseJsonObject(column(row, "after_json")) ?? {}),
    v1: {
      sourceTable: "audit_logs",
      sourceId: sourceKey(row),
      sourceTargetId: nullableText(column(row, "target_id")),
      mappedContactId: maps.contacts.get(String(column(row, "contact_id"))) ?? null,
      mappedConversationId: maps.conversations.get(String(column(row, "conversation_id"))) ?? null,
      raw: row,
    },
  };
  db.prepare(
    `INSERT INTO audit_logs (
      user_id, actor_user_id, action, target_table, target_id, before_json, after_json,
      ip_address, user_agent, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    userId,
    userId,
    nullableText(column(row, "action", "type")) || "v1.migrated",
    targetTable,
    targetId,
    before ? JSON.stringify(before) : null,
    JSON.stringify(after),
    nullableText(column(row, "ip_address")),
    nullableText(column(row, "user_agent")),
    nullableText(column(row, "created_at")) || nowIso(),
  );
}

function insertLegacyEventOnce(
  db: SqliteDatabase,
  userId: number,
  type: string,
  severity: string,
  sourceTable: string,
  sourceId: string,
  payload: Record<string, unknown>,
) {
  const existing = db
    .prepare(
      `SELECT id FROM system_events
       WHERE type = ?
         AND json_extract(payload_json, '$.v1.sourceTable') = ?
         AND json_extract(payload_json, '$.v1.sourceId') = ?
       LIMIT 1`,
    )
    .get(type, sourceTable, sourceId) as Row | undefined;
  if (existing?.id) return Number(existing.id);
  const result = db
    .prepare(
      `INSERT INTO system_events (user_id, type, severity, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      userId,
      type,
      enumValue({ debug: "debug", info: "info", warn: "warn", error: "error" }, severity, "info"),
      JSON.stringify({ ...payload, v1: { sourceTable, sourceId } }),
      nullableText(payload.createdAt) || nowIso(),
    );
  return Number(result.lastInsertRowid);
}

function validateImportPlan(source: SourceData): ValidationSummary {
  const counts = planCounts(source);
  const checks = {
    hasContacts: counts.contacts >= 0,
    dataLakeSkipped: counts.dataLakeSkipped,
    liveJobsOnly: counts.jobs <= source.jobs.length,
  };
  return { ok: true, checks };
}

function validateImportedData(db: SqliteDatabase, source: SourceData, userId: number): ValidationSummary {
  const importable = planCounts(source);
  const checks: Record<string, boolean | number | string> = {
    contactsAtLeastImportable: scalar(db, "SELECT count(*) FROM contacts WHERE user_id = ?", [userId]) >= importable.contacts,
    conversationsAtLeastImportable:
      scalar(db, "SELECT count(*) FROM conversations WHERE user_id = ?", [userId]) >= importable.conversations,
    messagesAtLeastImportable:
      scalar(db, "SELECT count(*) FROM messages WHERE user_id = ?", [userId]) >= importable.messages,
    campaignsAtLeastImportable:
      scalar(db, "SELECT count(*) FROM campaigns WHERE user_id = ?", [userId]) >= importable.campaigns,
    foreignKeyCheck: readForeignKeyCheck(db),
    migratedEventExists:
      scalar(db, "SELECT count(*) FROM system_events WHERE user_id = ? AND type = 'v215.cutover.applied'", [userId]) >= 0,
  };
  const ok = Object.values(checks).every((value) => value === true || value === "ok" || typeof value === "number");
  return { ok, checks };
}

function copyMediaFile(row: Row, sourceRoot: string, targetRoot: string, warnings: string[]) {
  const original = textValue(column(row, "storage_path"));
  if (!original) return { status: "missing" as const, storagePath: `v1-media/${sourceKey(row)}` };
  const sourcePath = path.isAbsolute(original) ? original : path.resolve(sourceRoot, original);
  if (!fs.existsSync(sourcePath)) {
    warnings.push(`media_missing:${sourceKey(row)}:${sourcePath}`);
    return { status: "missing" as const, storagePath: original };
  }
  const fileName = sanitizeFileName(textValue(column(row, "original_name", "file_name", "safe_name")) || path.basename(sourcePath));
  const sha = textValue(column(row, "sha256")) || `v1-${sourceKey(row)}`;
  const targetPath = path.join(targetRoot, sha.slice(0, 2), `${sha}-${fileName}`);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  if (!fs.existsSync(targetPath)) fs.copyFileSync(sourcePath, targetPath);
  return { status: "copied" as const, storagePath: path.relative(repoRoot, targetPath) };
}

function loadExistingMigrationMarkers(db: SqliteDatabase) {
  return {
    auditLogs: new Set(
      db
        .prepare(
          `SELECT json_extract(after_json, '$.v1.sourceId') AS sourceId
           FROM audit_logs
           WHERE json_extract(after_json, '$.v1.sourceTable') = 'audit_logs'`,
        )
        .all()
        .map((row) => String((row as Row).sourceId ?? "")),
    ),
  };
}

function emptyMaps(): IdMaps {
  return {
    tags: new Map(),
    contacts: new Map(),
    attendants: new Map(),
    mediaAssets: new Map(),
    conversations: new Map(),
    campaigns: new Map(),
    automations: new Map(),
    chatbots: new Map(),
    chatbotRules: new Map(),
    messages: new Map(),
    jobs: new Map(),
  };
}

function emptyCounts(): MigrationCounts {
  return {
    users: 0,
    tags: 0,
    contacts: 0,
    contactTags: 0,
    attendants: 0,
    mediaAssets: 0,
    mediaFilesCopied: 0,
    mediaFilesMissing: 0,
    conversations: 0,
    messages: 0,
    campaigns: 0,
    campaignRecipients: 0,
    automations: 0,
    automationEvents: 0,
    chatbots: 0,
    chatbotRules: 0,
    jobs: 0,
    reminders: 0,
    auditLogs: 0,
    systemEvents: 0,
    dataLakeSkipped: 0,
    rowsSkipped: 0,
  };
}

async function createPreCutoverBackup(dbPath: string, backupDir: string) {
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `pre-v215-cutover-${nowIso().replaceAll(":", "-").replaceAll(".", "-")}.db`);
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    await db.backup(backupPath);
  } finally {
    db.close();
  }
  return backupPath;
}

function findExistingContact(
  db: SqliteDatabase,
  userId: number,
  input: { phone: string | null; phoneE164: string | null; waJid: string | null; email: string | null; instagram: string | null },
) {
  if (input.phone) {
    const row = db
      .prepare(
        `SELECT * FROM contacts
         WHERE user_id = ?
           AND (phone = ? OR phone_e164 = ? OR wa_jid = ?)`,
      )
      .get(userId, input.phone, input.phoneE164, input.waJid) as Row | undefined;
    if (row) return row;
  }
  if (input.instagram) {
    const row = db
      .prepare("SELECT * FROM contacts WHERE user_id = ? AND instagram_handle = ?")
      .get(userId, input.instagram) as Row | undefined;
    if (row) return row;
  }
  if (input.email) {
    const row = db.prepare("SELECT * FROM contacts WHERE user_id = ? AND email = ?").get(userId, input.email) as
      | Row
      | undefined;
    if (row) return row;
  }
  return null;
}

function findImportedByMetadata(db: SqliteDatabase, table: string, userId: number, key: string, sourceId: string) {
  return db
    .prepare(
      `SELECT id FROM ${quoteIdent(table)}
       WHERE user_id = ?
         AND json_extract(metadata_json, ?) = ?
       ORDER BY id DESC LIMIT 1`,
    )
    .get(userId, `$.v1.${key}`, sourceId) as Row | undefined;
}

function findImportedRecipient(db: SqliteDatabase, campaignId: number, sourceId: string) {
  return db
    .prepare(
      `SELECT id FROM campaign_recipients
       WHERE campaign_id = ?
         AND json_extract(metadata_json, '$.v1.sourceRecipientId') = ?
       ORDER BY id DESC LIMIT 1`,
    )
    .get(campaignId, sourceId) as Row | undefined;
}

function findImportedMessage(db: SqliteDatabase, conversationId: number, sourceId: string, externalId: string | null) {
  if (externalId) {
    const byExternal = db
      .prepare("SELECT id FROM messages WHERE conversation_id = ? AND external_id = ?")
      .get(conversationId, externalId) as Row | undefined;
    if (byExternal) return byExternal;
  }
  return db
    .prepare(
      `SELECT id FROM messages
       WHERE conversation_id = ?
         AND json_extract(raw_json, '$.v1.sourceId') = ?
       ORDER BY id DESC LIMIT 1`,
    )
    .get(conversationId, sourceId) as Row | undefined;
}

function findImportedJob(db: SqliteDatabase, userId: number, sourceId: string, dedupeKey: string | null) {
  if (dedupeKey) {
    const byDedupe = db.prepare("SELECT id FROM jobs WHERE dedupe_key = ?").get(dedupeKey) as Row | undefined;
    if (byDedupe) return byDedupe;
  }
  return db
    .prepare(
      `SELECT id FROM jobs
       WHERE user_id = ?
         AND json_extract(payload_json, '$.v1.sourceJobId') = ?
       ORDER BY id DESC LIMIT 1`,
    )
    .get(userId, sourceId) as Row | undefined;
}

function mapAutomationAction(row: Row) {
  return {
    id: nullableText(column(row, "id")) ?? undefined,
    type: nullableText(column(row, "type", "action_type")) || "send_step",
    label: nullableText(column(row, "label", "name")),
    payload: parseJsonObject(column(row, "payload_json", "config_json")) ?? {},
    order: nullableNumber(column(row, "sort_order", "order_index")),
    raw: row,
  };
}

function mediaJson(row: Row) {
  const mediaPath = nullableText(column(row, "media_path"));
  if (!mediaPath) return null;
  return JSON.stringify({ v1: { mediaPath } });
}

function readForeignKeyCheck(db: SqliteDatabase) {
  const rows = db.prepare("PRAGMA foreign_key_check").all();
  return rows.length === 0 ? "ok" : `violations:${rows.length}`;
}

function findLatestBackup(backupDir: string): FileProof | null {
  if (!fs.existsSync(backupDir)) return null;
  const candidates = fs
    .readdirSync(backupDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".db"))
    .map((entry) => {
      const fullPath = path.join(backupDir, entry.name);
      const stat = fs.statSync(fullPath);
      return { path: fullPath, sizeBytes: stat.size, mtime: stat.mtime.toISOString() };
    })
    .filter((entry) => entry.sizeBytes > 0)
    .sort((a, b) => Date.parse(b.mtime) - Date.parse(a.mtime));
  return candidates[0] ?? null;
}

function findM303Proof(proofRoot: string): FileProof | null {
  if (!fs.existsSync(proofRoot)) return null;
  const proofs = fs
    .readdirSync(proofRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("m303-wpp-24-send-90-proof-"))
    .map((entry) => {
      const evidencePath = path.join(proofRoot, entry.name, "evidence.json");
      if (!fs.existsSync(evidencePath)) return null;
      const stat = fs.statSync(evidencePath);
      return { path: evidencePath, sizeBytes: stat.size, mtime: stat.mtime.toISOString() };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .sort((a, b) => Date.parse(b.mtime) - Date.parse(a.mtime));
  return proofs[0] ?? null;
}

function assertReadableSqlite(filePath: string, label: string, blockers: string[]) {
  if (!fs.existsSync(filePath)) {
    blockers.push(`${label}_db_missing:${filePath}`);
    return false;
  }
  if (!fs.statSync(filePath).isFile() || fs.statSync(filePath).size === 0) {
    blockers.push(`${label}_db_empty_or_invalid:${filePath}`);
    return false;
  }
  try {
    const db = openReadonly(filePath);
    try {
      const result = db.prepare("PRAGMA quick_check").get() as Row | undefined;
      if (String(Object.values(result ?? {})[0] ?? "") !== "ok") {
        blockers.push(`${label}_db_quick_check_failed:${filePath}`);
        return false;
      }
    } finally {
      db.close();
    }
  } catch (error) {
    blockers.push(`${label}_db_unreadable:${errorMessage(error)}`);
    return false;
  }
  return true;
}

function openReadonly(filePath: string) {
  const db = new Database(filePath, { readonly: true, fileMustExist: true, timeout: 10_000 });
  db.pragma("query_only = ON");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 10000");
  return db;
}

function listTables(db: SqliteDatabase) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((row) => String((row as Row).name));
}

function listColumns(db: SqliteDatabase, table: string) {
  return db
    .prepare(`PRAGMA table_info(${quoteIdent(table)})`)
    .all()
    .map((row) => String((row as Row).name));
}

function countTables(db: SqliteDatabase, tables: string[]) {
  const tableSet = new Set(listTables(db));
  return Object.fromEntries(
    tables.map((table) => [
      table,
      tableSet.has(table) ? scalar(db, `SELECT count(*) FROM ${quoteIdent(table)}`) : null,
    ]),
  );
}

function selectAll(db: SqliteDatabase, tables: Set<string>, table: string) {
  if (!tables.has(table)) return [];
  return db.prepare(`SELECT * FROM ${quoteIdent(table)}`).all() as Row[];
}

function scalar(db: SqliteDatabase, sql: string, params: unknown[] = []) {
  const row = db.prepare(sql).get(...params) as Row | undefined;
  return Number(Object.values(row ?? { value: 0 })[0] ?? 0);
}

function groupBy(rows: Row[], key: string) {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const value = String(column(row, key));
    const list = groups.get(value) ?? [];
    list.push(row);
    groups.set(value, list);
  }
  return groups;
}

function column(row: Row | null | undefined, ...names: string[]) {
  for (const name of names) {
    if (row && Object.prototype.hasOwnProperty.call(row, name)) return row[name];
  }
  return null;
}

function sourceKey(row: Row) {
  return textValue(column(row, "id")) || textValue(column(row, "source_id")) || JSON.stringify(row);
}

function isLiveV1Job(row: Row) {
  const status = textValue(column(row, "status")).toLowerCase();
  return status === "pending" || status === "processing" || status === "queued" || status === "running";
}

function normalizePhone(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return null;
}

function normalizePhoneE164(value: unknown) {
  const phone = normalizePhone(value);
  return phone ? `+${phone}` : null;
}

function normalizeWaJid(value: unknown) {
  const phone = normalizePhone(String(value ?? "").split("@")[0]);
  return phone ? `${phone}@s.whatsapp.net` : null;
}

function normalizeInstagram(value: unknown) {
  const text = textValue(value).replace(/^@/, "");
  return text ? `@${text}` : null;
}

function nullableText(value: unknown) {
  const text = textValue(value);
  return text || null;
}

function textValue(value: unknown) {
  return String(value ?? "").trim();
}

function numberValue(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nullableNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function booleanInt(value: unknown, fallback: boolean) {
  if (value == null || value === "") return fallback ? 1 : 0;
  if (typeof value === "boolean") return value ? 1 : 0;
  const text = String(value).toLowerCase();
  return ["1", "true", "yes", "sim", "active", "enabled"].includes(text) ? 1 : 0;
}

function enumValue(map: Record<string, string>, value: unknown, fallback: string) {
  return map[String(value ?? "").toLowerCase()] ?? fallback;
}

function channelValue(value: unknown) {
  const channel = String(value ?? "whatsapp").toLowerCase();
  return ["whatsapp", "instagram", "system"].includes(channel) ? channel : "whatsapp";
}

function mediaType(value: unknown) {
  const mapped = messageTypeMap[String(value ?? "").toLowerCase()] ?? String(value ?? "").toLowerCase();
  return ["image", "audio", "voice", "video", "document"].includes(mapped) ? mapped : "document";
}

function messageStatus(value: unknown, direction: string) {
  const status = String(value ?? "").toLowerCase();
  if (["pending", "sent", "delivered", "read", "failed", "received"].includes(status)) return status;
  return direction === "inbound" ? "received" : "sent";
}

function reminderStatus(value: unknown) {
  const status = String(value ?? "").toLowerCase();
  if (status === "done" || status === "completed") return "done";
  if (status === "cancelled" || status === "canceled") return "cancelled";
  return "open";
}

function eventSeverity(row: Row) {
  const severity = String(column(row, "severity", "level", "status") ?? "info").toLowerCase();
  if (["debug", "info", "warn", "error"].includes(severity)) return severity;
  if (severity === "failed" || severity === "failure") return "error";
  return "info";
}

function numericTargetId(value: unknown) {
  const text = textValue(value);
  if (/^\d+$/.test(text)) return Number(text);
  return null;
}

function parseJsonObject(value: unknown) {
  const text = textValue(value);
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function parseJsonArray(value: unknown) {
  const text = textValue(value);
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function migrationNote(entity: string, sourceId: string) {
  return `Migrado ${entity} do nuoma-wpp via V2.15 em ${nowIso()}; sourceId=${sourceId}`;
}

function mergeNote(current: unknown, addition: string) {
  const base = nullableText(current);
  if (!base) return addition;
  if (base.includes(addition)) return base;
  return `${base}\n${addition}`;
}

function sanitizeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "media";
}

function sumObject(input: Record<string, number>) {
  return Object.values(input).reduce((total, value) => total + value, 0);
}

function addHours(iso: string, hours: number) {
  return new Date(Date.parse(iso) + hours * 60 * 60 * 1000).toISOString();
}

function nowIso() {
  return new Date().toISOString();
}

function positiveInt(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function envFlag(value: unknown, fallback: boolean) {
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "sim", "SIM"].includes(String(value));
}

function resolvePath(input: string) {
  return path.isAbsolute(input) ? input : path.resolve(repoRoot, input);
}

function quoteIdent(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function writeReport(reportPath: string | null, report: MigrationReport) {
  if (!reportPath) return;
  const target = resolvePath(reportPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
}

function printPreflightSummary(report: MigrationReport) {
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

function printApplySummary(report: MigrationReport) {
  console.log(
    [
      "v215-cutover-apply",
      `mode=${report.command === "apply" ? "apply" : "dry-run"}`,
      `contacts=${report.counts.contacts}`,
      `conversations=${report.counts.conversations}`,
      `messages=${report.counts.messages}`,
      `campaigns=${report.counts.campaigns}`,
      `recipients=${report.counts.campaignRecipients}`,
      `automations=${report.counts.automations}`,
      `chatbots=${report.counts.chatbots}`,
      `jobs=${report.counts.jobs}`,
      `blockers=${report.blockers.length}`,
      `backup=${report.backup ?? (report.command === "apply" ? "none" : "not_created")}`,
      `status=${report.status}`,
    ].join("|"),
  );
}

function printValidationSummary(report: MigrationReport) {
  console.log(
    [
      "v215-cutover-validate",
      `blockers=${report.blockers.length}`,
      `ok=${report.validation?.ok ?? false}`,
      `status=${report.status}`,
    ].join("|"),
  );
}

function exitForReport(report: MigrationReport, options: Options) {
  if (report.blockers.length > 0 && !options.allowBlockers) {
    process.exitCode = 1;
    return;
  }
  if ((report.status === "invalid" || report.status === "blocked") && !options.allowBlockers) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
