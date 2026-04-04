import { randomUUID } from "node:crypto";
import { getDb } from "../db/connection.js";
import { getContactByInstagram, getContactByPhone } from "./contact-repository.js";
import type { CampaignInput, CampaignRecord, CampaignStepInput, CampaignStepRecord } from "../types/domain.js";

function nowIso() {
  return new Date().toISOString();
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

function parseJsonArray<T>(input: string | null | undefined, fallback: T[]) {
  if (!input) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(input) as T[];
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

type ImportedCampaignRecipient = {
  channel: "whatsapp" | "instagram";
  phone?: string | null;
  instagram?: string | null;
  targetDisplayValue: string;
  targetNormalizedValue: string;
  name?: string;
  tags?: string[];
  extra?: Record<string, string>;
};

function mapStep(row: Record<string, unknown>): CampaignStepRecord {
  const metadata = parseJsonObject(row.metadata_json as string | null);
  return {
    id: String(row.id),
    campaignId: String(row.campaign_id),
    sortOrder: Number(row.sort_order),
    type: String(row.type) as CampaignStepRecord["type"],
    content: String(row.content ?? ""),
    mediaPath: (metadata.mediaPath as string | null) ?? null,
    waitMinutes: row.wait_minutes == null ? null : Number(row.wait_minutes),
    caption: String(row.caption ?? ""),
    tagName: (metadata.tagName as string | null) ?? null,
    channelScope: String(row.channel_scope ?? "any") as CampaignStepRecord["channelScope"],
    templateId: (row.template_id as string | null) ?? null,
    conditionType: (row.condition_type as CampaignStepRecord["conditionType"]) ?? null,
    conditionValue: (row.condition_value as string | null) ?? null,
    conditionAction: (row.condition_action as CampaignStepRecord["conditionAction"]) ?? null,
    conditionJumpTo: row.condition_jump_to == null ? null : Number(row.condition_jump_to),
    attendantId: (row.attendant_id as string | null) ?? null,
    createdAt: String(row.created_at)
  };
}

function getStepsForCampaign(campaignId: string) {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM campaign_steps WHERE campaign_id = ? ORDER BY sort_order ASC")
    .all(campaignId) as Array<Record<string, unknown>>;

  return rows.map(mapStep);
}

function mapCampaign(row: Record<string, unknown>): CampaignRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description ?? ""),
    status: String(row.status) as CampaignRecord["status"],
    eligibleChannels: parseJsonArray<string>(row.eligible_channels_json as string | null, ["whatsapp"]) as CampaignRecord["eligibleChannels"],
    csvPath: (row.csv_path as string | null) ?? null,
    sendWindowStart: String(row.send_window_start ?? "08:00"),
    sendWindowEnd: String(row.send_window_end ?? "20:00"),
    rateLimitCount: Number(row.rate_limit_count ?? 30),
    rateLimitWindowMinutes: Number(row.rate_limit_window_minutes ?? 60),
    randomDelayMinSeconds: Number(row.random_delay_min_seconds ?? 15),
    randomDelayMaxSeconds: Number(row.random_delay_max_seconds ?? 60),
    isEvergreen: Boolean(row.is_evergreen),
    evergreenCriteria: parseJsonObject(row.evergreen_criteria_json as string | null),
    evergreenLastEvaluatedAt: (row.evergreen_last_evaluated_at as string | null) ?? null,
    totalRecipients: Number(row.total_recipients ?? 0),
    processedRecipients: Number(row.processed_recipients ?? 0),
    startedAt: (row.started_at as string | null) ?? null,
    finishedAt: (row.finished_at as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    steps: getStepsForCampaign(String(row.id))
  };
}

function replaceSteps(campaignId: string, steps: CampaignStepInput[]) {
  const db = getDb();
  const timestamp = nowIso();
  const transaction = db.transaction(() => {
    db.prepare("DELETE FROM campaign_steps WHERE campaign_id = ?").run(campaignId);
    const insert = db.prepare(
      `
        INSERT INTO campaign_steps (
          id, campaign_id, sort_order, type, content, media_asset_id, wait_minutes, caption, metadata_json, channel_scope,
          template_id, condition_type, condition_value, condition_action, condition_jump_to, attendant_id, created_at
        ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    );

    steps.forEach((step, index) => {
      insert.run(
        step.id?.trim() || randomUUID(),
        campaignId,
        index,
        step.type,
        step.content ?? "",
        step.waitMinutes ?? null,
        step.caption ?? "",
        JSON.stringify({
          mediaPath: step.mediaPath ?? null,
          tagName: step.tagName ?? null
        }),
        step.channelScope ?? "any",
        step.templateId ?? null,
        step.conditionType ?? null,
        step.conditionValue ?? null,
        step.conditionAction ?? null,
        step.conditionJumpTo ?? null,
        step.attendantId ?? null,
        timestamp
      );
    });
  });

  transaction();
}

export function listCampaigns() {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM campaigns ORDER BY updated_at DESC").all() as Array<Record<string, unknown>>;
  return rows.map(mapCampaign);
}

export function getCampaign(campaignId: string) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(campaignId) as Record<string, unknown> | undefined;
  return row ? mapCampaign(row) : null;
}

export function createCampaign(input: CampaignInput) {
  const db = getDb();
  const id = randomUUID();
  const timestamp = nowIso();

  db.prepare(
    `
      INSERT INTO campaigns (
        id, name, description, status, csv_path, send_window_start, send_window_end, rate_limit_count,
        rate_limit_window_minutes, random_delay_min_seconds, random_delay_max_seconds, eligible_channels_json,
        is_evergreen, evergreen_criteria_json, total_recipients,
        processed_recipients, started_at, finished_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, NULL, ?, ?)
    `
  ).run(
    id,
    input.name,
    input.description,
    input.status,
    input.sendWindowStart,
    input.sendWindowEnd,
    input.rateLimitCount,
    input.rateLimitWindowMinutes,
    input.randomDelayMinSeconds,
    input.randomDelayMaxSeconds,
    JSON.stringify(input.eligibleChannels ?? ["whatsapp"]),
    input.isEvergreen ? 1 : 0,
    JSON.stringify(input.evergreenCriteria ?? {}),
    timestamp,
    timestamp
  );

  replaceSteps(id, input.steps);
  return getCampaign(id);
}

export function updateCampaign(campaignId: string, input: CampaignInput) {
  const db = getDb();
  const timestamp = nowIso();
  db.prepare(
    `
      UPDATE campaigns
      SET
        name = ?,
        description = ?,
        status = ?,
        send_window_start = ?,
        send_window_end = ?,
        rate_limit_count = ?,
        rate_limit_window_minutes = ?,
        random_delay_min_seconds = ?,
        random_delay_max_seconds = ?,
        eligible_channels_json = ?,
        is_evergreen = ?,
        evergreen_criteria_json = ?,
        updated_at = ?
      WHERE id = ?
    `
  ).run(
    input.name,
    input.description,
    input.status,
    input.sendWindowStart,
    input.sendWindowEnd,
    input.rateLimitCount,
    input.rateLimitWindowMinutes,
    input.randomDelayMinSeconds,
    input.randomDelayMaxSeconds,
    JSON.stringify(input.eligibleChannels ?? ["whatsapp"]),
    input.isEvergreen ? 1 : 0,
    JSON.stringify(input.evergreenCriteria ?? {}),
    timestamp,
    campaignId
  );

  replaceSteps(campaignId, input.steps);
  return getCampaign(campaignId);
}

export function setCampaignStatus(campaignId: string, status: CampaignRecord["status"]) {
  const db = getDb();
  const timestamp = nowIso();
  db.prepare(
    `
      UPDATE campaigns
      SET
        status = ?,
        started_at = CASE WHEN ? = 'active' AND started_at IS NULL THEN ? ELSE started_at END,
        finished_at = CASE WHEN ? IN ('completed', 'cancelled', 'failed') THEN ? ELSE finished_at END,
        updated_at = ?
      WHERE id = ?
    `
  ).run(status, status, timestamp, status, timestamp, timestamp, campaignId);
  return getCampaign(campaignId);
}

export function deleteCampaign(campaignId: string) {
  const db = getDb();
  const transaction = db.transaction(() => {
    db.prepare("DELETE FROM campaign_steps WHERE campaign_id = ?").run(campaignId);
    db.prepare("DELETE FROM campaign_recipients WHERE campaign_id = ?").run(campaignId);
    db.prepare("DELETE FROM campaigns WHERE id = ?").run(campaignId);
  });

  transaction();
}

export function duplicateCampaign(campaignId: string) {
  const existing = getCampaign(campaignId);
  if (!existing) {
    return null;
  }

  const cloneName = `${existing.name} (copia)`;
  return createCampaign({
    name: cloneName,
    description: existing.description ?? "",
    status: "draft",
    eligibleChannels: existing.eligibleChannels,
    sendWindowStart: existing.sendWindowStart,
    sendWindowEnd: existing.sendWindowEnd,
    rateLimitCount: existing.rateLimitCount,
    rateLimitWindowMinutes: existing.rateLimitWindowMinutes,
    randomDelayMinSeconds: existing.randomDelayMinSeconds,
    randomDelayMaxSeconds: existing.randomDelayMaxSeconds,
    isEvergreen: existing.isEvergreen,
    evergreenCriteria: existing.evergreenCriteria,
    steps: existing.steps.map((step) => ({
      type: step.type,
      content: step.content,
      mediaPath: step.mediaPath ?? null,
      waitMinutes: step.waitMinutes ?? null,
      caption: step.caption ?? "",
      tagName: step.tagName ?? null,
      channelScope: step.channelScope ?? "any",
      templateId: step.templateId ?? null,
      conditionType: step.conditionType ?? null,
      conditionValue: step.conditionValue ?? null,
      conditionAction: step.conditionAction ?? null,
      conditionJumpTo: step.conditionJumpTo ?? null,
      attendantId: step.attendantId ?? null
    }))
  });
}

export function importCampaignRecipients(campaignId: string, recipients: ImportedCampaignRecipient[], csvPath?: string | null) {
  const db = getDb();
  const timestamp = nowIso();
  const transaction = db.transaction(() => {
    db.prepare("DELETE FROM campaign_recipients WHERE campaign_id = ?").run(campaignId);
    const insert = db.prepare(
      `
        INSERT INTO campaign_recipients (
          id, campaign_id, contact_id, channel, phone, instagram, target_display_value, target_normalized_value,
          name, tags_json, extra_json, status, step_index, next_run_at, last_attempt_at, last_error, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
      `
    );

    recipients.forEach((recipient) => {
      const phone = recipient.phone?.trim() ?? "";
      const instagram = recipient.instagram?.trim().replace(/^@+/, "").toLowerCase() || null;
      const contact =
        recipient.channel === "instagram"
          ? (instagram ? getContactByInstagram(instagram) : null) ?? (phone ? getContactByPhone(phone) : null)
          : (phone ? getContactByPhone(phone) : null) ?? (instagram ? getContactByInstagram(instagram) : null);
      const requiresValidation = recipient.channel === "whatsapp";
      insert.run(
        randomUUID(),
        campaignId,
        contact?.id ?? null,
        recipient.channel,
        phone,
        instagram ? `@${instagram}` : null,
        recipient.targetDisplayValue.trim(),
        recipient.targetNormalizedValue.trim(),
        recipient.name?.trim() ?? "",
        JSON.stringify(recipient.tags ?? []),
        JSON.stringify(recipient.extra ?? {}),
        "pending",
        requiresValidation ? -1 : 0,
        timestamp,
        requiresValidation ? "awaiting_validation" : null,
        timestamp,
        timestamp
      );
    });

    db.prepare(
      `
        UPDATE campaigns
        SET csv_path = ?, total_recipients = ?, processed_recipients = 0, updated_at = ?
        WHERE id = ?
      `
    ).run(csvPath ?? null, recipients.length, timestamp, campaignId);
  });

  transaction();
  return getCampaign(campaignId);
}

export function addManualRecipients(
  campaignId: string,
  entries: Array<{ value: string; channel: "whatsapp" | "instagram"; name?: string }>
) {
  const db = getDb();
  const timestamp = nowIso();
  const insert = db.prepare(
    `INSERT INTO campaign_recipients (
      id, campaign_id, contact_id, channel, phone, instagram, target_display_value, target_normalized_value,
      name, tags_json, extra_json, status, step_index, next_run_at, last_attempt_at, last_error, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`
  );

  const transaction = db.transaction(() => {
    let added = 0;
    for (const entry of entries) {
      const val = entry.value.trim();
      if (!val) continue;

      const isIg = entry.channel === "instagram";
      const igHandle = isIg ? val.replace(/^@+/, "").toLowerCase() : null;
      const phone = isIg ? "" : val;
      const display = isIg ? `@${igHandle}` : val;
      const normalized = isIg ? (igHandle ?? "") : val;

      const contact = isIg
        ? (igHandle ? getContactByInstagram(igHandle) : null)
        : (phone ? getContactByPhone(phone) : null);

      const requiresValidation = entry.channel === "whatsapp";

      insert.run(
        randomUUID(),
        campaignId,
        contact?.id ?? null,
        entry.channel,
        phone,
        igHandle ? `@${igHandle}` : null,
        display,
        normalized,
        entry.name?.trim() ?? "",
        "[]",
        "{}",
        "pending",
        requiresValidation ? -1 : 0,
        timestamp,
        requiresValidation ? "awaiting_validation" : null,
        timestamp,
        timestamp
      );
      added++;
    }

    // Update total count
    const countRow = db.prepare("SELECT COUNT(*) as cnt FROM campaign_recipients WHERE campaign_id = ?").get(campaignId) as { cnt: number };
    db.prepare("UPDATE campaigns SET total_recipients = ?, updated_at = ? WHERE id = ?").run(countRow.cnt, timestamp, campaignId);

    return added;
  });

  const count = transaction();
  return { added: count, campaign: getCampaign(campaignId) };
}

export function getCampaignRecipient(recipientId: string) {
  const db = getDb();
  return db.prepare("SELECT * FROM campaign_recipients WHERE id = ?").get(recipientId) as Record<string, unknown> | undefined;
}

export function updateCampaignRecipientContact(recipientId: string, contactId: string | null) {
  const db = getDb();
  db.prepare("UPDATE campaign_recipients SET contact_id = ?, updated_at = ? WHERE id = ?").run(contactId, nowIso(), recipientId);
}

export function listCampaignRecipients(campaignId: string) {
  const db = getDb();
  return db
    .prepare("SELECT * FROM campaign_recipients WHERE campaign_id = ? ORDER BY created_at ASC")
    .all(campaignId) as Array<Record<string, unknown>>;
}

export function getCampaignStepStats(campaignId: string) {
  const db = getDb();
  const rows = db.prepare(
    `SELECT step_index, status, COUNT(*) as count
     FROM campaign_recipients
     WHERE campaign_id = ?
     GROUP BY step_index, status
     ORDER BY step_index ASC, status ASC`
  ).all(campaignId) as Array<{ step_index: number; status: string; count: number }>;

  const stats: Record<number, { pending: number; processing: number; sent: number; failed: number; skipped: number; total: number }> = {};
  for (const row of rows) {
    if (!stats[row.step_index]) {
      stats[row.step_index] = { pending: 0, processing: 0, sent: 0, failed: 0, skipped: 0, total: 0 };
    }
    const s = stats[row.step_index];
    if (row.status === "pending") s.pending += row.count;
    else if (row.status === "processing") s.processing += row.count;
    else if (row.status === "sent") s.sent += row.count;
    else if (row.status === "failed") s.failed += row.count;
    else if (row.status === "skipped" || row.status === "blocked_by_rule") s.skipped += row.count;
    s.total += row.count;
  }
  return stats;
}

export function getDueCampaignRecipients() {
  const db = getDb();
  return db
    .prepare(
      `
        SELECT cr.*, c.status AS campaign_status
        FROM campaign_recipients cr
        INNER JOIN campaigns c ON c.id = cr.campaign_id
        WHERE c.status = 'active'
          AND cr.status IN ('pending', 'processing')
          AND cr.step_index >= 0
          AND datetime(cr.next_run_at) <= datetime('now')
        ORDER BY datetime(cr.next_run_at) ASC
        LIMIT 100
      `
    )
    .all() as Array<Record<string, unknown>>;
}

export function markCampaignRecipientAwaitingValidation(recipientId: string) {
  const db = getDb();
  const timestamp = nowIso();
  db.prepare(
    `
      UPDATE campaign_recipients
      SET status = 'pending', step_index = -1, last_error = 'awaiting_validation', updated_at = ?
      WHERE id = ?
    `
  ).run(timestamp, recipientId);
}

export function markCampaignRecipientValidated(recipientId: string) {
  const db = getDb();
  const timestamp = nowIso();
  db.prepare(
    `
      UPDATE campaign_recipients
      SET status = 'pending', step_index = 0, last_error = NULL, next_run_at = ?, updated_at = ?
      WHERE id = ?
    `
  ).run(timestamp, timestamp, recipientId);
}

export function advanceCampaignRecipient(recipientId: string, nextStepIndex: number, nextRunAt: string, status: string) {
  const db = getDb();
  db.prepare(
    `
      UPDATE campaign_recipients
      SET step_index = ?, next_run_at = ?, status = ?, last_error = NULL, updated_at = ?
      WHERE id = ?
    `
  ).run(nextStepIndex, nextRunAt, status, nowIso(), recipientId);
}

export function markCampaignRecipientProcessing(recipientId: string) {
  const db = getDb();
  db.prepare("UPDATE campaign_recipients SET status = 'processing', last_error = NULL, last_attempt_at = ?, updated_at = ? WHERE id = ?").run(
    nowIso(),
    nowIso(),
    recipientId
  );
}

export function completeCampaignRecipient(recipientId: string) {
  const db = getDb();
  const timestamp = nowIso();
  const transaction = db.transaction(() => {
    db.prepare("UPDATE campaign_recipients SET status = 'sent', last_error = NULL, updated_at = ? WHERE id = ?").run(timestamp, recipientId);
    db.prepare(
      `
        UPDATE campaigns
        SET
          processed_recipients = (
            SELECT COUNT(*) FROM campaign_recipients WHERE campaign_id = campaigns.id AND status = 'sent'
          ),
          status = CASE
            WHEN (
              SELECT COUNT(*) FROM campaign_recipients WHERE campaign_id = campaigns.id AND status = 'sent'
            ) >= total_recipients AND total_recipients > 0 THEN 'completed'
            ELSE status
          END,
          finished_at = CASE
            WHEN (
              SELECT COUNT(*) FROM campaign_recipients WHERE campaign_id = campaigns.id AND status = 'sent'
            ) >= total_recipients AND total_recipients > 0 THEN ?
            ELSE finished_at
          END,
          updated_at = ?
        WHERE id = (SELECT campaign_id FROM campaign_recipients WHERE id = ?)
      `
    ).run(timestamp, timestamp, recipientId);
  });

  transaction();
}

export function markCampaignRecipientFailed(recipientId: string, error: string, status: "failed" | "blocked_by_rule" = "failed") {
  const db = getDb();
  db.prepare(
    `
      UPDATE campaign_recipients
      SET status = ?, last_error = ?, updated_at = ?
      WHERE id = ?
    `
  ).run(status, error, nowIso(), recipientId);
}
