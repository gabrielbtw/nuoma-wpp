import Database from "better-sqlite3";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "./schema-v2-candidate.js";
import { inspectV1, openReadOnly, OPERATIONAL_TABLES, REPORTS_DIR, type ReadSummary, type TableSummary } from "./read-v1.js";

const EXPERIMENT_ROOT = path.dirname(fileURLToPath(import.meta.url));

type TransformDecision = {
  importable: boolean;
  reason?: string;
};

type DryRunTableResult = {
  table: string;
  exists: boolean;
  scannedRows: number;
  importableRows: number;
  skippedRows: number;
  skippedByReason: Record<string, number>;
  warnings: Record<string, number>;
};

type DryRunReport = {
  createdAt: string;
  durationMs: number;
  status: "VERDE" | "AMARELO" | "VERMELHO";
  summary: ReadSummary;
  tables: DryRunTableResult[];
  totals: {
    scannedRows: number;
    importableRows: number;
    skippedRows: number;
    orphanCount: number;
    criticalOrphanCount: number;
    invalidJsonCount: number;
    missingRequiredTables: string[];
  };
  decisions: string[];
};

type ReferenceSets = {
  contacts: Set<string>;
  conversations: Set<string>;
  tags: Set<string>;
  automations: Set<string>;
  campaigns: Set<string>;
  mediaAssets: Set<string>;
  chatbots: Set<string>;
};

const CRITICAL_TABLES = new Set([
  "contacts",
  "conversations",
  "messages",
  "jobs",
  "campaigns",
  "campaign_steps",
  "campaign_recipients",
  "automations",
  "automation_actions",
  "automation_contact_state",
  "automation_runs",
  "tags",
  "contact_tags",
  "contact_channels",
  "attendants",
  "chatbots",
  "chatbot_rules",
  "media_assets",
  "reminders"
]);

function q(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function increment(target: Record<string, number>, key: string, amount = 1) {
  target[key] = (target[key] ?? 0) + amount;
}

function rowString(row: Record<string, unknown>, key: string) {
  const value = row[key];
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function hasReference(refs: Set<string>, value: string) {
  return value === "" || refs.has(value);
}

function loadReferenceSet(db: Database.Database, table: string) {
  const exists = db
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name = ?")
    .get(table) as { ok: number } | undefined;
  if (!exists) return new Set<string>();

  return new Set(
    (db.prepare(`SELECT id FROM ${q(table)}`).all() as Array<{ id: string | null }>)
      .map((row) => row.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
  );
}

function loadReferenceSets(db: Database.Database): ReferenceSets {
  return {
    contacts: loadReferenceSet(db, "contacts"),
    conversations: loadReferenceSet(db, "conversations"),
    tags: loadReferenceSet(db, "tags"),
    automations: loadReferenceSet(db, "automations"),
    campaigns: loadReferenceSet(db, "campaigns"),
    mediaAssets: loadReferenceSet(db, "media_assets"),
    chatbots: loadReferenceSet(db, "chatbots")
  };
}

function transformRow(table: string, row: Record<string, unknown>, refs: ReferenceSets, warnings: Record<string, number>): TransformDecision {
  if (table === "jobs") {
    const status = rowString(row, "status");
    if (status !== "pending" && status !== "processing") {
      return { importable: false, reason: `job-${status || "unknown"}-history` };
    }
    return { importable: true };
  }

  if (table === "campaign_executions") {
    return { importable: false, reason: "legacy-campaign-execution-needs-reconciliation" };
  }

  if (table === "conversations") {
    const externalThreadId = rowString(row, "external_thread_id") || rowString(row, "wa_chat_id");
    if (!externalThreadId) {
      return { importable: false, reason: "missing-external-thread-id" };
    }
    if (!hasReference(refs.contacts, rowString(row, "contact_id"))) {
      increment(warnings, "set-null-orphan-contact-id");
    }
  }

  if (table === "messages") {
    const conversationId = rowString(row, "conversation_id");
    if (!conversationId) {
      return { importable: false, reason: "missing-conversation-id" };
    }
    if (!refs.conversations.has(conversationId)) {
      return { importable: false, reason: "orphan-conversation-id" };
    }
    if (!hasReference(refs.contacts, rowString(row, "contact_id"))) {
      increment(warnings, "set-null-orphan-contact-id");
    }
    if (!hasReference(refs.mediaAssets, rowString(row, "media_asset_id"))) {
      increment(warnings, "set-null-orphan-media-asset-id");
    }
  }

  if (table === "campaign_steps") {
    if (!refs.campaigns.has(rowString(row, "campaign_id"))) {
      return { importable: false, reason: "orphan-campaign-id" };
    }
    if (!hasReference(refs.mediaAssets, rowString(row, "media_asset_id"))) {
      increment(warnings, "set-null-orphan-media-asset-id");
    }
  }

  if (table === "campaign_recipients") {
    if (!refs.campaigns.has(rowString(row, "campaign_id"))) {
      return { importable: false, reason: "orphan-campaign-id" };
    }
    if (!hasReference(refs.contacts, rowString(row, "contact_id"))) {
      increment(warnings, "set-null-orphan-contact-id");
    }
  }

  if (table === "automation_actions") {
    if (!refs.automations.has(rowString(row, "automation_id"))) {
      return { importable: false, reason: "orphan-automation-id" };
    }
    if (!hasReference(refs.mediaAssets, rowString(row, "media_asset_id"))) {
      increment(warnings, "set-null-orphan-media-asset-id");
    }
  }

  if (table === "automation_contact_state") {
    if (!refs.automations.has(rowString(row, "automation_id"))) {
      return { importable: false, reason: "orphan-automation-id" };
    }
    if (!refs.contacts.has(rowString(row, "contact_id"))) {
      return { importable: false, reason: "orphan-contact-id" };
    }
  }

  if (table === "automation_runs") {
    if (!refs.automations.has(rowString(row, "automation_id"))) {
      return { importable: false, reason: "orphan-automation-id" };
    }
    if (!refs.contacts.has(rowString(row, "contact_id"))) {
      return { importable: false, reason: "orphan-contact-id" };
    }
    if (!hasReference(refs.conversations, rowString(row, "conversation_id"))) {
      increment(warnings, "set-null-orphan-conversation-id");
    }
  }

  if (table === "contact_tags") {
    if (!refs.contacts.has(rowString(row, "contact_id"))) {
      return { importable: false, reason: "orphan-contact-id" };
    }
    if (!refs.tags.has(rowString(row, "tag_id"))) {
      return { importable: false, reason: "orphan-tag-id" };
    }
  }

  if (table === "contact_channels" || table === "contact_history") {
    if (!refs.contacts.has(rowString(row, "contact_id"))) {
      return { importable: false, reason: "orphan-contact-id" };
    }
  }

  if (table === "chatbot_rules") {
    if (!refs.chatbots.has(rowString(row, "chatbot_id"))) {
      return { importable: false, reason: "orphan-chatbot-id" };
    }
  }

  if (table === "audit_logs") {
    if (!hasReference(refs.contacts, rowString(row, "contact_id"))) {
      increment(warnings, "drop-orphan-contact-reference");
    }
    if (!hasReference(refs.conversations, rowString(row, "conversation_id"))) {
      increment(warnings, "drop-orphan-conversation-reference");
    }
  }

  return { importable: true };
}

function collectWarnings(table: string, row: Record<string, unknown>, warnings: Record<string, number>) {
  if (table === "messages" && !rowString(row, "external_id")) {
    increment(warnings, "messages-without-external-id");
  }

  if (table === "contacts" && !rowString(row, "phone")) {
    increment(warnings, "contacts-without-phone");
  }

  if (table === "campaign_recipients" && !rowString(row, "contact_id")) {
    increment(warnings, "campaign-recipients-without-contact-id");
  }

  if (table === "conversations" && Number(row.unread_count ?? 0) > 100) {
    increment(warnings, "conversations-unread-count-over-100");
  }
}

function runTableDryRun(db: Database.Database, table: TableSummary, refs: ReferenceSets): DryRunTableResult {
  if (!table.exists) {
    return {
      table: table.name,
      exists: false,
      scannedRows: 0,
      importableRows: 0,
      skippedRows: 0,
      skippedByReason: {},
      warnings: {}
    };
  }

  let scannedRows = 0;
  let importableRows = 0;
  let skippedRows = 0;
  const skippedByReason: Record<string, number> = {};
  const warnings: Record<string, number> = {};

  const rows = db.prepare(`SELECT * FROM ${q(table.name)}`).iterate() as Iterable<Record<string, unknown>>;
  for (const row of rows) {
    scannedRows += 1;
    collectWarnings(table.name, row, warnings);
    const decision = transformRow(table.name, row, refs, warnings);
    if (decision.importable) {
      importableRows += 1;
    } else {
      skippedRows += 1;
      increment(skippedByReason, decision.reason ?? "skipped");
    }
  }

  return {
    table: table.name,
    exists: true,
    scannedRows,
    importableRows,
    skippedRows,
    skippedByReason,
    warnings
  };
}

function tableOrphanCount(table: TableSummary) {
  return table.foreignKeys.reduce((total, fk) => total + fk.orphanCount, 0);
}

function invalidJsonCount(table: TableSummary) {
  return table.jsonValidation.reduce((total, item) => total + item.invalidCount, 0);
}

function buildDecisions(summary: ReadSummary, tables: DryRunTableResult[]) {
  const decisions: string[] = [];
  const byName = new Map(tables.map((table) => [table.table, table]));
  const messageWarnings = byName.get("messages")?.warnings["messages-without-external-id"] ?? 0;
  if (messageWarnings > 0) {
    decisions.push(`${messageWarnings} messages sem external_id: manter NULL permitido e confiar no reconcile V2 para dedupe futuro.`);
  }

  const contactsWithoutPhone = byName.get("contacts")?.warnings["contacts-without-phone"] ?? 0;
  if (contactsWithoutPhone > 0) {
    decisions.push(`${contactsWithoutPhone} contacts sem phone: aceito. V2 permite phone NULL porque contatos podem existir só por Instagram.`);
  }

  const orphanSkippedRows = tables.reduce(
    (total, table) =>
      total +
      Object.entries(table.skippedByReason)
        .filter(([reason]) => reason.startsWith("orphan-"))
        .reduce((subtotal, [, count]) => subtotal + count, 0),
    0
  );
  if (orphanSkippedRows > 0) {
    decisions.push(`${orphanSkippedRows} linhas dependentes de contatos/parents apagados serao puladas no import operacional.`);
  }

  const setNullWarnings = tables.reduce(
    (total, table) =>
      total +
      Object.entries(table.warnings)
        .filter(([warning]) => warning.startsWith("set-null-orphan-") || warning.startsWith("drop-orphan-"))
        .reduce((subtotal, [, count]) => subtotal + count, 0),
    0
  );
  if (setNullWarnings > 0) {
    decisions.push(`${setNullWarnings} referencias orfas serao preservadas com FK nula/removida, principalmente em recipients e audit_logs.`);
  }

  const campaignExecutions = byName.get("campaign_executions");
  if (campaignExecutions?.exists && campaignExecutions.scannedRows > 0) {
    decisions.push(`${campaignExecutions.scannedRows} campaign_executions legacy: reconciliar com campaign_recipients antes de import final.`);
  }

  const historicalOrphans = summary.tables
    .filter((table) => !CRITICAL_TABLES.has(table.name))
    .reduce((total, table) => total + tableOrphanCount(table), 0);
  if (historicalOrphans > 0) {
    decisions.push(`${historicalOrphans} orphans em tabelas historicas/auditoria: preservar sem FK forte ou com FK nula, sem bloquear o import.`);
  }

  decisions.push("Etapa de estabilizacao V2 deve rodar resync geral para reconstruir estado operacional recente apos o import.");

  const missingOptional = summary.tables.filter((table) => !table.exists && !table.required).map((table) => table.name);
  if (missingOptional.length > 0) {
    decisions.push(`Tabelas opcionais ausentes (${missingOptional.join(", ")}): mapper deve tratar como zero linhas.`);
  }

  return decisions;
}

function classifyStatus(summary: ReadSummary) {
  const missingRequired = summary.tables.filter((table) => table.required && !table.exists).map((table) => table.name);
  const invalidJson = summary.tables.reduce((total, table) => total + invalidJsonCount(table), 0);

  if (missingRequired.length > 0 || invalidJson > 0) {
    return "VERMELHO";
  }
  return "VERDE";
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("pt-BR").format(value);
}

function markdownReport(report: DryRunReport) {
  const tableRows = report.tables
    .map((table) => {
      const summary = report.summary.tables.find((item) => item.name === table.table);
      const orphanCount = summary ? tableOrphanCount(summary) : 0;
      return `| \`${table.table}\` | ${table.exists ? "sim" : "nao"} | ${formatNumber(table.scannedRows)} | ${formatNumber(table.importableRows)} | ${formatNumber(table.skippedRows)} | ${formatNumber(orphanCount)} |`;
    })
    .join("\n");

  const orphanRows = report.summary.tables
    .flatMap((table) =>
      table.foreignKeys
        .filter((fk) => fk.orphanCount > 0)
        .map(
          (fk) =>
            `| \`${fk.childTable}\` | \`${fk.parentTable}\` | ${fk.columns.map((column) => `${column.from}->${column.to}`).join(", ")} | ${formatNumber(fk.orphanCount)} |`
        )
    )
    .join("\n");

  const policyRows = report.tables
    .filter((table) => table.skippedRows > 0 || Object.keys(table.warnings).length > 0)
    .map((table) => {
      const skipped = Object.entries(table.skippedByReason)
        .map(([reason, count]) => `${reason}: ${formatNumber(count)}`)
        .join("; ");
      const warnings = Object.entries(table.warnings)
        .map(([warning, count]) => `${warning}: ${formatNumber(count)}`)
        .join("; ");
      return `| \`${table.table}\` | ${skipped || "-"} | ${warnings || "-"} |`;
    })
    .join("\n");

  const decisionRows = report.decisions.map((decision) => `- ${decision}`).join("\n") || "- Nenhuma decisao pendente detectada.";

  return `# Spike 4 — Migration dry-run V1 SQLite

## Status

${report.status}

Executado em ${report.createdAt}. Duração: ${Math.round(report.durationMs)}ms.

## Fonte

- Source DB: \`${report.summary.sourceDbPath}\`
- Snapshot: \`${report.summary.snapshotPath}\`
- Snapshot method: \`${report.summary.snapshotMethod}\`
- DB size: ${formatNumber(report.summary.dbSizeBytes)} bytes
- WAL size no momento do snapshot: ${formatNumber(report.summary.walSizeBytes)} bytes

## Totais

- Linhas escaneadas: ${formatNumber(report.totals.scannedRows)}
- Linhas importáveis no dry-run: ${formatNumber(report.totals.importableRows)}
- Linhas puladas por regra: ${formatNumber(report.totals.skippedRows)}
- Orphans totais: ${formatNumber(report.totals.orphanCount)}
- Orphans críticos: ${formatNumber(report.totals.criticalOrphanCount)}
- JSON inválidos: ${formatNumber(report.totals.invalidJsonCount)}
- Tabelas obrigatórias ausentes: ${report.totals.missingRequiredTables.length ? report.totals.missingRequiredTables.join(", ") : "nenhuma"}

## Tabelas

| tabela | existe | scanned | importavel | skipped | orphans |
|---|---:|---:|---:|---:|---:|
${tableRows}

## Orphans

${orphanRows || "Nenhum orphan detectado nas tabelas avaliadas."}

## Política Simulada

| tabela | skipped | warnings/set-null |
|---|---|---|
${policyRows || "| - | - | - |"}

## Politica Aceita

${decisionRows}

## Samples E Tipos

Samples redigidos e validação de tipos por coluna estão em \`reports/dryrun.json\`.
`;
}

async function main() {
  const startedAt = Date.now();
  const summary = await inspectV1();
  const db = openReadOnly(summary.snapshotPath);
  const refs = loadReferenceSets(db);

  const tables = summary.tables.map((table) => runTableDryRun(db, table, refs));
  db.close();

  const totals = {
    scannedRows: tables.reduce((total, table) => total + table.scannedRows, 0),
    importableRows: tables.reduce((total, table) => total + table.importableRows, 0),
    skippedRows: tables.reduce((total, table) => total + table.skippedRows, 0),
    orphanCount: summary.tables.reduce((total, table) => total + tableOrphanCount(table), 0),
    criticalOrphanCount: summary.tables
      .filter((table) => CRITICAL_TABLES.has(table.name))
      .reduce((total, table) => total + tableOrphanCount(table), 0),
    invalidJsonCount: summary.tables.reduce((total, table) => total + invalidJsonCount(table), 0),
    missingRequiredTables: summary.tables.filter((table) => table.required && !table.exists).map((table) => table.name)
  };

  const report: DryRunReport = {
    createdAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    status: classifyStatus(summary),
    summary,
    tables,
    totals,
    decisions: buildDecisions(summary, tables)
  };

  await fs.mkdir(REPORTS_DIR, { recursive: true });
  await fs.writeFile(path.join(REPORTS_DIR, "dryrun.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(EXPERIMENT_ROOT, "REPORT.md"), markdownReport(report), "utf8");

  console.log(`status=${report.status}`);
  console.log(`durationMs=${Math.round(report.durationMs)}`);
  console.log(`scannedRows=${report.totals.scannedRows}`);
  console.log(`importableRows=${report.totals.importableRows}`);
  console.log(`skippedRows=${report.totals.skippedRows}`);
  console.log(`orphans=${report.totals.orphanCount}`);
  console.log(`criticalOrphans=${report.totals.criticalOrphanCount}`);
  console.log(`invalidJson=${report.totals.invalidJsonCount}`);
  console.log(`report=${path.join(EXPERIMENT_ROOT, "REPORT.md")}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
