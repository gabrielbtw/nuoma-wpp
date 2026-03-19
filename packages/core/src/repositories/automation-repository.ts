import { randomUUID } from "node:crypto";
import { getDb } from "../db/connection.js";
import type { AutomationRuleInput, AutomationRuleRecord } from "../types/domain.js";

function nowIso() {
  return new Date().toISOString();
}

function parseJsonArray(input: string | null | undefined) {
  if (!input) {
    return [];
  }

  try {
    const parsed = JSON.parse(input);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseJsonObject(input: string | null | undefined) {
  if (!input) {
    return {};
  }

  try {
    return JSON.parse(input) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function mapAutomation(row: Record<string, unknown>, actions: Array<Record<string, unknown>>): AutomationRuleRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    category: String(row.category) as AutomationRuleRecord["category"],
    enabled: Number(row.enabled ?? 1) === 1,
    description: String(row.description ?? ""),
    triggerTags: parseJsonArray(row.required_tags_json as string | null),
    excludeTags: parseJsonArray(row.excluded_tags_json as string | null),
    requiredStatus: (row.required_status as AutomationRuleRecord["requiredStatus"]) ?? null,
    procedureOnly: Number(row.procedure_only ?? 0) === 1,
    requireLastOutgoing: Number(row.require_last_outgoing ?? 0) === 1,
    requireNoReply: Number(row.require_no_reply ?? 0) === 1,
    timeWindowHours: Number(row.time_window_hours ?? 24),
    minimumIntervalHours: Number(row.minimum_interval_hours ?? 72),
    randomDelayMinSeconds: Number(row.random_delay_min_seconds ?? 10),
    randomDelayMaxSeconds: Number(row.random_delay_max_seconds ?? 45),
    sendWindowStart: String(row.send_window_start ?? "08:00"),
    sendWindowEnd: String(row.send_window_end ?? "20:00"),
    templateKey: (row.template_key as string | null) ?? null,
    actions: actions.map((action) => {
      const metadata = parseJsonObject(action.metadata_json as string | null);
      return {
        id: String(action.id),
        type: String(action.type) as AutomationRuleInput["actions"][number]["type"],
        content: String(action.content ?? ""),
        mediaPath: (metadata.mediaPath as string | null) ?? null,
        waitSeconds: action.wait_seconds == null ? null : Number(action.wait_seconds),
        tagName: (action.tag_name as string | null) ?? null,
        reminderText: (action.reminder_text as string | null) ?? null,
        metadata
      };
    }),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function getAutomationActions(automationId: string) {
  const db = getDb();
  return db
    .prepare("SELECT * FROM automation_actions WHERE automation_id = ? ORDER BY sort_order ASC")
    .all(automationId) as Array<Record<string, unknown>>;
}

function replaceAutomationActions(automationId: string, actions: AutomationRuleInput["actions"]) {
  const db = getDb();
  const timestamp = nowIso();
  const transaction = db.transaction(() => {
    db.prepare("DELETE FROM automation_actions WHERE automation_id = ?").run(automationId);

    const insert = db.prepare(
      `
        INSERT INTO automation_actions (
          id, automation_id, sort_order, type, content, media_asset_id, wait_seconds, tag_name, reminder_text, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)
      `
    );

    actions.forEach((action, index) => {
      insert.run(
        action.id?.trim() || randomUUID(),
        automationId,
        index,
        action.type,
        action.content ?? "",
        action.waitSeconds ?? null,
        action.tagName ?? null,
        action.reminderText ?? null,
        JSON.stringify({
          ...(action.metadata ?? {}),
          mediaPath: action.mediaPath ?? null
        }),
        timestamp
      );
    });
  });

  transaction();
}

export function listAutomations() {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM automations ORDER BY enabled DESC, updated_at DESC").all() as Array<Record<string, unknown>>;
  return rows.map((row) => mapAutomation(row, getAutomationActions(String(row.id))));
}

export function getAutomation(automationId: string) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM automations WHERE id = ?").get(automationId) as Record<string, unknown> | undefined;
  return row ? mapAutomation(row, getAutomationActions(automationId)) : null;
}

export function createAutomation(input: AutomationRuleInput) {
  const db = getDb();
  const id = randomUUID();
  const timestamp = nowIso();

  db.prepare(
    `
      INSERT INTO automations (
        id, name, category, enabled, description, required_tags_json, excluded_tags_json, required_status,
        procedure_only, require_last_outgoing, require_no_reply, time_window_hours, minimum_interval_hours,
        random_delay_min_seconds, random_delay_max_seconds, send_window_start, send_window_end, template_key,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    id,
    input.name,
    input.category,
    input.enabled ? 1 : 0,
    input.description,
    JSON.stringify(input.triggerTags),
    JSON.stringify(input.excludeTags),
    input.requiredStatus,
    input.procedureOnly ? 1 : 0,
    input.requireLastOutgoing ? 1 : 0,
    input.requireNoReply ? 1 : 0,
    input.timeWindowHours,
    input.minimumIntervalHours,
    input.randomDelayMinSeconds,
    input.randomDelayMaxSeconds,
    input.sendWindowStart,
    input.sendWindowEnd,
    input.templateKey,
    timestamp,
    timestamp
  );

  replaceAutomationActions(id, input.actions);
  return getAutomation(id);
}

export function updateAutomation(automationId: string, input: AutomationRuleInput) {
  const db = getDb();
  const timestamp = nowIso();
  db.prepare(
    `
      UPDATE automations
      SET
        name = ?,
        category = ?,
        enabled = ?,
        description = ?,
        required_tags_json = ?,
        excluded_tags_json = ?,
        required_status = ?,
        procedure_only = ?,
        require_last_outgoing = ?,
        require_no_reply = ?,
        time_window_hours = ?,
        minimum_interval_hours = ?,
        random_delay_min_seconds = ?,
        random_delay_max_seconds = ?,
        send_window_start = ?,
        send_window_end = ?,
        template_key = ?,
        updated_at = ?
      WHERE id = ?
    `
  ).run(
    input.name,
    input.category,
    input.enabled ? 1 : 0,
    input.description,
    JSON.stringify(input.triggerTags),
    JSON.stringify(input.excludeTags),
    input.requiredStatus,
    input.procedureOnly ? 1 : 0,
    input.requireLastOutgoing ? 1 : 0,
    input.requireNoReply ? 1 : 0,
    input.timeWindowHours,
    input.minimumIntervalHours,
    input.randomDelayMinSeconds,
    input.randomDelayMaxSeconds,
    input.sendWindowStart,
    input.sendWindowEnd,
    input.templateKey,
    timestamp,
    automationId
  );

  replaceAutomationActions(automationId, input.actions);
  return getAutomation(automationId);
}

export function setAutomationEnabled(automationId: string, enabled: boolean) {
  const db = getDb();
  db.prepare("UPDATE automations SET enabled = ?, updated_at = ? WHERE id = ?").run(enabled ? 1 : 0, nowIso(), automationId);
  return getAutomation(automationId);
}

export function listActiveAutomations() {
  return listAutomations().filter((automation) => automation.enabled);
}

export function listDueAutomationRuns() {
  const db = getDb();
  return db
    .prepare(
      `
        SELECT *
        FROM automation_runs
        WHERE status IN ('pending', 'active')
          AND datetime(next_run_at) <= datetime('now')
        ORDER BY datetime(next_run_at) ASC
        LIMIT 100
      `
    )
    .all() as Array<Record<string, unknown>>;
}

export function getAutomationRun(runId: string) {
  const db = getDb();
  return db.prepare("SELECT * FROM automation_runs WHERE id = ?").get(runId) as Record<string, unknown> | undefined;
}

export function getOpenAutomationRunForContact(automationId: string, contactId: string) {
  const db = getDb();
  return db
    .prepare(
      `
        SELECT *
        FROM automation_runs
        WHERE automation_id = ? AND contact_id = ? AND status IN ('pending', 'active')
        ORDER BY datetime(created_at) DESC
        LIMIT 1
      `
    )
    .get(automationId, contactId) as Record<string, unknown> | undefined;
}

export function createAutomationRun(input: {
  automationId: string;
  contactId: string;
  conversationId?: string | null;
  nextRunAt?: string;
}) {
  const db = getDb();
  const timestamp = nowIso();
  const id = randomUUID();
  db.prepare(
    `
      INSERT INTO automation_runs (
        id, automation_id, contact_id, conversation_id, status, action_index, next_run_at, triggered_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?)
    `
  ).run(id, input.automationId, input.contactId, input.conversationId ?? null, input.nextRunAt ?? timestamp, timestamp, timestamp, timestamp);

  return getAutomationRun(id);
}

export function advanceAutomationRun(runId: string, actionIndex: number, nextRunAt: string, status: "pending" | "active" = "active") {
  const db = getDb();
  db.prepare("UPDATE automation_runs SET action_index = ?, next_run_at = ?, status = ?, updated_at = ? WHERE id = ?").run(
    actionIndex,
    nextRunAt,
    status,
    nowIso(),
    runId
  );
}

export function completeAutomationRun(runId: string) {
  const db = getDb();
  db.prepare("UPDATE automation_runs SET status = 'completed', updated_at = ? WHERE id = ?").run(nowIso(), runId);
}

export function failAutomationRun(runId: string, error: string) {
  const db = getDb();
  db.prepare("UPDATE automation_runs SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ?").run(error, nowIso(), runId);
}

export function recordAutomationContactState(automationId: string, contactId: string, jobId: string, sentAt = nowIso()) {
  const db = getDb();
  db.prepare(
    `
      INSERT INTO automation_contact_state (automation_id, contact_id, last_sent_at, last_job_id, last_triggered_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(automation_id, contact_id) DO UPDATE SET
        last_sent_at = excluded.last_sent_at,
        last_job_id = excluded.last_job_id,
        last_triggered_at = excluded.last_triggered_at,
        updated_at = excluded.updated_at
    `
  ).run(automationId, contactId, sentAt, jobId, sentAt, sentAt);

  db.prepare("UPDATE contacts SET last_automation_at = ?, updated_at = ? WHERE id = ?").run(sentAt, sentAt, contactId);
}

export function getAutomationContactState(automationId: string, contactId: string) {
  const db = getDb();
  return db
    .prepare("SELECT * FROM automation_contact_state WHERE automation_id = ? AND contact_id = ?")
    .get(automationId, contactId) as Record<string, unknown> | undefined;
}
