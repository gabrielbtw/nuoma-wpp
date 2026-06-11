import { randomUUID } from "node:crypto";
import { getDb } from "../db/connection.js";
import type { AttachmentCandidateContentType, AttachmentCandidateRecord, ChannelType } from "../types/domain.js";

function nowIso() {
  return new Date().toISOString();
}

function parseMeta(input: string | null | undefined) {
  if (!input) {
    return {};
  }

  try {
    return JSON.parse(input) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function mapAttachmentCandidate(row: Record<string, unknown>): AttachmentCandidateRecord {
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    contactId: (row.contact_id as string | null) ?? null,
    messageId: (row.message_id as string | null) ?? null,
    mediaAssetId: String(row.media_asset_id),
    channel: String(row.channel ?? "whatsapp") as ChannelType,
    contentType: String(row.content_type) as AttachmentCandidateContentType,
    originalName: String(row.original_name ?? ""),
    mimeType: String(row.mime_type ?? ""),
    sizeBytes: Number(row.size_bytes ?? 0),
    sha256: String(row.sha256 ?? ""),
    storagePath: String(row.storage_path ?? ""),
    sourceUrl: (row.source_url as string | null) ?? null,
    caption: (row.caption as string | null) ?? null,
    observedAt: String(row.observed_at),
    metadata: parseMeta(row.metadata_json as string | null),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    conversationTitle: (row.conversation_title as string | null) ?? null,
    messageBody: (row.message_body as string | null) ?? null
  };
}

export function getMediaAssetByHash(sha256: string) {
  const db = getDb();
  return db.prepare("SELECT * FROM media_assets WHERE sha256 = ?").get(sha256) as Record<string, unknown> | undefined;
}

export function getMediaAssetById(mediaAssetId: string) {
  const db = getDb();
  return db.prepare("SELECT * FROM media_assets WHERE id = ?").get(mediaAssetId) as Record<string, unknown> | undefined;
}

export function createOrReuseMediaAsset(input: {
  sha256: string;
  originalName: string;
  safeName: string;
  mimeType: string;
  sizeBytes: number;
  category: string;
  storagePath: string;
  linkedCampaignId?: string | null;
  linkedAutomationId?: string | null;
}) {
  const existing = getMediaAssetByHash(input.sha256);
  if (existing) {
    return existing;
  }

  const db = getDb();
  const id = randomUUID();
  db.prepare(
    `
      INSERT INTO media_assets (
        id, sha256, original_name, safe_name, mime_type, size_bytes, category, linked_campaign_id, linked_automation_id, storage_path, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    id,
    input.sha256,
    input.originalName,
    input.safeName,
    input.mimeType,
    input.sizeBytes,
    input.category,
    input.linkedCampaignId ?? null,
    input.linkedAutomationId ?? null,
    input.storagePath,
    nowIso()
  );

  return getMediaAssetById(id);
}

export function listTemporaryMediaAssets() {
  const db = getDb();
  return db.prepare("SELECT * FROM media_assets WHERE category = 'temp'").all() as Array<Record<string, unknown>>;
}

export function createAttachmentCandidate(input: {
  conversationId: string;
  contactId?: string | null;
  messageId?: string | null;
  channel?: ChannelType;
  contentType: AttachmentCandidateContentType;
  originalName: string;
  safeName: string;
  mimeType: string;
  sizeBytes?: number | null;
  sha256: string;
  storagePath: string;
  sourceUrl?: string | null;
  caption?: string | null;
  observedAt?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const db = getDb();
  const conversation = db
    .prepare("SELECT contact_id, channel FROM conversations WHERE id = ?")
    .get(input.conversationId) as { contact_id: string | null; channel: string | null } | undefined;

  const media = createOrReuseMediaAsset({
    sha256: input.sha256,
    originalName: input.originalName,
    safeName: input.safeName,
    mimeType: input.mimeType,
    sizeBytes: Math.max(0, Number(input.sizeBytes ?? 0)),
    category: "sync-candidate",
    storagePath: input.storagePath
  });
  if (!media) {
    throw new Error("media_asset_create_failed");
  }

  const mediaAssetId = String(media.id);
  const existing = db
    .prepare(
      `
        SELECT ac.*, ma.sha256, ma.storage_path, conv.title AS conversation_title, m.body AS message_body
        FROM attachment_candidates ac
        INNER JOIN media_assets ma ON ma.id = ac.media_asset_id
        LEFT JOIN conversations conv ON conv.id = ac.conversation_id
        LEFT JOIN messages m ON m.id = ac.message_id
        WHERE ac.conversation_id = ?
          AND ac.media_asset_id = ?
          AND COALESCE(ac.message_id, '') = COALESCE(?, '')
        LIMIT 1
      `
    )
    .get(input.conversationId, mediaAssetId, input.messageId ?? null) as Record<string, unknown> | undefined;

  if (existing) {
    return mapAttachmentCandidate(existing);
  }

  const timestamp = nowIso();
  const id = randomUUID();
  const contactId = input.contactId ?? conversation?.contact_id ?? null;
  const channel = input.channel ?? (conversation?.channel as ChannelType | null) ?? "whatsapp";
  const observedAt = input.observedAt ?? timestamp;

  db.prepare(
    `
      INSERT OR IGNORE INTO attachment_candidates (
        id, conversation_id, contact_id, message_id, media_asset_id, channel, content_type, original_name,
        mime_type, size_bytes, source_url, caption, observed_at, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    id,
    input.conversationId,
    contactId,
    input.messageId ?? null,
    mediaAssetId,
    channel,
    input.contentType,
    input.originalName,
    input.mimeType,
    Math.max(0, Number(input.sizeBytes ?? 0)),
    input.sourceUrl ?? null,
    input.caption ?? null,
    observedAt,
    JSON.stringify(input.metadata ?? {}),
    timestamp,
    timestamp
  );

  const inserted = getAttachmentCandidateById(id);
  if (inserted) {
    return inserted;
  }

  const fallback = db
    .prepare(
      `
        SELECT ac.*, ma.sha256, ma.storage_path, conv.title AS conversation_title, m.body AS message_body
        FROM attachment_candidates ac
        INNER JOIN media_assets ma ON ma.id = ac.media_asset_id
        LEFT JOIN conversations conv ON conv.id = ac.conversation_id
        LEFT JOIN messages m ON m.id = ac.message_id
        WHERE ac.conversation_id = ?
          AND ac.media_asset_id = ?
        ORDER BY datetime(ac.created_at) DESC
        LIMIT 1
      `
    )
    .get(input.conversationId, mediaAssetId) as Record<string, unknown> | undefined;

  return fallback ? mapAttachmentCandidate(fallback) : null;
}

export function getAttachmentCandidateById(candidateId: string) {
  const db = getDb();
  const row = db
    .prepare(
      `
        SELECT ac.*, ma.sha256, ma.storage_path, conv.title AS conversation_title, m.body AS message_body
        FROM attachment_candidates ac
        INNER JOIN media_assets ma ON ma.id = ac.media_asset_id
        LEFT JOIN conversations conv ON conv.id = ac.conversation_id
        LEFT JOIN messages m ON m.id = ac.message_id
        WHERE ac.id = ?
      `
    )
    .get(candidateId) as Record<string, unknown> | undefined;

  return row ? mapAttachmentCandidate(row) : null;
}

export function listAttachmentCandidatesByConversation(conversationId: string, limit = 50) {
  const db = getDb();
  const totalRow = db
    .prepare("SELECT COUNT(*) AS total FROM attachment_candidates WHERE conversation_id = ?")
    .get(conversationId) as { total: number } | undefined;

  const rows = db
    .prepare(
      `
        SELECT ac.*, ma.sha256, ma.storage_path, conv.title AS conversation_title, m.body AS message_body
        FROM attachment_candidates ac
        INNER JOIN media_assets ma ON ma.id = ac.media_asset_id
        LEFT JOIN conversations conv ON conv.id = ac.conversation_id
        LEFT JOIN messages m ON m.id = ac.message_id
        WHERE ac.conversation_id = ?
        ORDER BY datetime(ac.observed_at) DESC, datetime(ac.created_at) DESC
        LIMIT ?
      `
    )
    .all(conversationId, Math.max(1, Math.min(200, limit))) as Array<Record<string, unknown>>;

  return {
    total: Number(totalRow?.total ?? 0),
    items: rows.map(mapAttachmentCandidate)
  };
}

export function listAttachmentCandidatesByContact(contactId: string, limit = 50) {
  const db = getDb();
  const totalRow = db
    .prepare(
      `
        SELECT COUNT(*) AS total
        FROM attachment_candidates ac
        LEFT JOIN conversations conv ON conv.id = ac.conversation_id
        WHERE COALESCE(ac.contact_id, conv.contact_id) = ?
      `
    )
    .get(contactId) as { total: number } | undefined;

  const rows = db
    .prepare(
      `
        SELECT ac.*, ma.sha256, ma.storage_path, conv.title AS conversation_title, m.body AS message_body
        FROM attachment_candidates ac
        INNER JOIN media_assets ma ON ma.id = ac.media_asset_id
        LEFT JOIN conversations conv ON conv.id = ac.conversation_id
        LEFT JOIN messages m ON m.id = ac.message_id
        WHERE COALESCE(ac.contact_id, conv.contact_id) = ?
        ORDER BY datetime(ac.observed_at) DESC, datetime(ac.created_at) DESC
        LIMIT ?
      `
    )
    .all(contactId, Math.max(1, Math.min(200, limit))) as Array<Record<string, unknown>>;

  return {
    total: Number(totalRow?.total ?? 0),
    items: rows.map(mapAttachmentCandidate)
  };
}
