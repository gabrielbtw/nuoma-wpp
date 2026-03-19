import { randomUUID } from "node:crypto";
import { getDb } from "../db/connection.js";
import type { AuditLogRecord, ChannelType } from "../types/domain.js";

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

function mapAuditLog(row: Record<string, unknown>): AuditLogRecord {
  return {
    id: String(row.id),
    entityType: String(row.entity_type),
    entityId: String(row.entity_id),
    action: String(row.action),
    channel: (row.channel as ChannelType | null) ?? null,
    contactId: (row.contact_id as string | null) ?? null,
    conversationId: (row.conversation_id as string | null) ?? null,
    messageId: (row.message_id as string | null) ?? null,
    campaignId: (row.campaign_id as string | null) ?? null,
    metadata: parseJsonObject(row.metadata_json as string | null),
    createdAt: String(row.created_at)
  };
}

export function recordAuditLog(input: {
  entityType: string;
  entityId: string;
  action: string;
  channel?: ChannelType | null;
  contactId?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
  campaignId?: string | null;
  metadata?: Record<string, unknown>;
  createdAt?: string;
}) {
  const db = getDb();
  db.prepare(
    `
      INSERT INTO audit_logs (
        id, entity_type, entity_id, action, channel, contact_id, conversation_id, message_id, campaign_id, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    randomUUID(),
    input.entityType,
    input.entityId,
    input.action,
    input.channel ?? null,
    input.contactId ?? null,
    input.conversationId ?? null,
    input.messageId ?? null,
    input.campaignId ?? null,
    JSON.stringify(input.metadata ?? {}),
    input.createdAt ?? nowIso()
  );
}

export function listAuditLogs(limit = 100, offset = 0) {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM audit_logs ORDER BY datetime(created_at) DESC LIMIT ? OFFSET ?")
    .all(limit, offset) as Array<Record<string, unknown>>;

  return rows.map(mapAuditLog);
}
