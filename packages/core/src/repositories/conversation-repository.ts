import { randomUUID } from "node:crypto";
import { getDb } from "../db/connection.js";
import { ensureDefaultChannelAccounts } from "./channel-account-repository.js";
import { createAutoContact, getContactById, getContactByPhone, hydrateAutoContact, recordContactHistory, touchContactTimestamps } from "./contact-repository.js";
import { recordAuditLog } from "./audit-log-repository.js";
import { rememberInstagramThreadForContact } from "./contact-channel-repository.js";
import type { ChannelType, ConversationRecord, MessageContentType, MessageDirection, MessageRecord } from "../types/domain.js";

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

function conversationLegacyThreadId(channel: ChannelType, externalThreadId: string) {
  return channel === "whatsapp" ? externalThreadId : `${channel}:${externalThreadId}`;
}

function mapConversation(row: Record<string, unknown>): ConversationRecord {
  const channel = String(row.channel ?? "whatsapp") as ChannelType;
  const externalThreadId = String(row.external_thread_id ?? row.wa_chat_id);

  return {
    id: String(row.id),
    contactId: (row.contact_id as string | null) ?? null,
    channel,
    channelAccountId: (row.channel_account_id as string | null) ?? null,
    externalThreadId,
    inboxCategory: String(row.inbox_category ?? "primary"),
    internalStatus: String(row.internal_status ?? row.status ?? "open"),
    waChatId: channel === "whatsapp" ? externalThreadId : String(row.wa_chat_id ?? externalThreadId),
    title: String(row.title),
    unreadCount: Number(row.unread_count ?? 0),
    lastMessagePreview: String(row.last_message_preview ?? ""),
    lastMessageAt: (row.last_message_at as string | null) ?? null,
    status: String(row.status) as ConversationRecord["status"],
    assignedTo: (row.assigned_to as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    metadata: parseMeta(row.metadata_json as string | null),
    contactName: (row.contact_name as string | null) ?? null,
    contactPhone: (row.contact_phone as string | null) ?? null,
    contactInstagram: (row.contact_instagram as string | null) ?? null
  };
}

function mapMessage(row: Record<string, unknown>): MessageRecord {
  const meta = parseMeta(row.meta_json as string | null);
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    contactId: (row.contact_id as string | null) ?? null,
    channel: String(row.channel ?? "whatsapp") as ChannelType,
    channelAccountId: (row.channel_account_id as string | null) ?? null,
    direction: String(row.direction) as MessageDirection,
    contentType: String(row.content_type) as MessageContentType,
    body: String(row.body ?? ""),
    mediaPath: (row.storage_path as string | null) ?? (row.media_storage_path as string | null) ?? (meta.mediaPath as string | null) ?? null,
    externalId: (row.external_id as string | null) ?? null,
    status: String(row.status ?? "sent"),
    sentAt: (row.sent_at as string | null) ?? null,
    createdAt: String(row.created_at),
    meta
  };
}

function ensureContact(input: { channel: ChannelType; contactPhone: string | null | undefined; contactName: string }) {
  if (input.channel !== "whatsapp" || !input.contactPhone) {
    return null;
  }

  const existing = getContactByPhone(input.contactPhone);
  if (existing) {
    return hydrateAutoContact(existing.id, {
      title: input.contactName
    }) ?? existing;
  }

  return createAutoContact({
    phone: input.contactPhone,
    title: input.contactName
  });
}

function rememberInstagramThreadForConversation(input: {
  contactId?: string | null;
  externalThreadId: string;
  instagramHandle?: string | null;
  title: string;
  observedAt?: string | null;
  source?: string | null;
}) {
  if (!input.contactId) {
    return null;
  }

  const contact = getContactById(input.contactId);
  const instagramHandle = input.instagramHandle ?? contact?.instagram ?? null;
  if (!instagramHandle) {
    return null;
  }

  return rememberInstagramThreadForContact({
    contactId: input.contactId,
    instagram: instagramHandle,
    threadId: input.externalThreadId,
    threadTitle: input.title,
    observedAt: input.observedAt ?? null,
    source: input.source ?? "conversation-upsert"
  });
}

export function listConversations(filters?: { channel?: string; status?: string; query?: string }) {
  const db = getDb();
  const where: string[] = [];
  const params: unknown[] = [];

  if (filters?.channel && filters.channel !== "all") {
    where.push("conv.channel = ?");
    params.push(filters.channel);
  }

  if (filters?.status && filters.status !== "all") {
    where.push("conv.internal_status = ?");
    params.push(filters.status);
  }

  if (filters?.query) {
    const like = `%${filters.query.trim()}%`;
    where.push(
      "(conv.title LIKE ? OR IFNULL(conv.last_message_preview, '') LIKE ? OR IFNULL(c.name, '') LIKE ? OR IFNULL(c.phone, '') LIKE ? OR IFNULL(c.instagram, '') LIKE ?)"
    );
    params.push(like, like, like, like, like);
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const rows = db
    .prepare(
      `
        SELECT
          conv.*,
          c.name AS contact_name,
          c.phone AS contact_phone,
          c.instagram AS contact_instagram
        FROM conversations conv
        LEFT JOIN contacts c ON c.id = conv.contact_id
        ${whereClause}
        ORDER BY datetime(COALESCE(conv.last_message_at, conv.updated_at)) DESC
      `
    )
    .all(...params) as Array<Record<string, unknown>>;

  return rows.map(mapConversation);
}

/**
 * Lists conversations grouped by contact for the unified inbox.
 * Returns one entry per contact with their latest message across all channels.
 */
export function listUnifiedInbox(filters?: { channel?: string; status?: string; query?: string }) {
  const db = getDb();
  const where: string[] = ["conv.contact_id IS NOT NULL"];
  const params: unknown[] = [];

  if (filters?.channel && filters.channel !== "all") {
    where.push("conv.channel = ?");
    params.push(filters.channel);
  }

  if (filters?.status && filters.status !== "all") {
    where.push("conv.internal_status = ?");
    params.push(filters.status);
  }

  if (filters?.query) {
    const like = `%${filters.query.trim()}%`;
    where.push(
      "(IFNULL(c.name, '') LIKE ? OR IFNULL(c.phone, '') LIKE ? OR IFNULL(c.instagram, '') LIKE ? OR IFNULL(conv.last_message_preview, '') LIKE ?)"
    );
    params.push(like, like, like, like);
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  // Single query with subquery to avoid N+1 (architecture fix)
  const rows = db.prepare(
    `SELECT
      c.id AS contact_id,
      c.name AS contact_name,
      c.phone AS contact_phone,
      c.instagram AS contact_instagram,
      c.status AS contact_status,
      GROUP_CONCAT(DISTINCT conv.channel) AS channels,
      MAX(conv.last_message_at) AS last_message_at,
      SUM(conv.unread_count) AS total_unread,
      COUNT(DISTINCT conv.id) AS conversation_count,
      (SELECT lc.last_message_preview FROM conversations lc
       WHERE lc.contact_id = c.id
       ORDER BY datetime(COALESCE(lc.last_message_at, lc.updated_at)) DESC LIMIT 1) AS latest_preview,
      (SELECT lc2.channel FROM conversations lc2
       WHERE lc2.contact_id = c.id
       ORDER BY datetime(COALESCE(lc2.last_message_at, lc2.updated_at)) DESC LIMIT 1) AS latest_channel
    FROM conversations conv
    INNER JOIN contacts c ON c.id = conv.contact_id
    ${whereClause}
    GROUP BY c.id
    ORDER BY MAX(datetime(COALESCE(conv.last_message_at, conv.updated_at))) DESC`
  ).all(...params) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    contactId: String(row.contact_id),
    contactName: String(row.contact_name ?? ""),
    contactPhone: (row.contact_phone as string) ?? null,
    contactInstagram: (row.contact_instagram as string) ?? null,
    contactStatus: String(row.contact_status ?? "novo"),
    channels: String(row.channels ?? "").split(",").filter(Boolean),
    lastMessageAt: (row.last_message_at as string) ?? null,
    lastMessagePreview: String(row.latest_preview ?? ""),
    lastMessageChannel: (row.latest_channel as string) ?? null,
    totalUnread: Number(row.total_unread ?? 0),
    conversationCount: Number(row.conversation_count ?? 0)
  }));
}

/**
 * Lists messages across ALL conversations for a given contact, mixed chronologically.
 */
export function listMessagesForContact(contactId: string, limit = 200) {
  const db = getDb();
  const rows = db.prepare(
    `SELECT m.*, conv.channel AS conv_channel, ma.storage_path AS media_storage_path
     FROM messages m
     INNER JOIN conversations conv ON conv.id = m.conversation_id
     LEFT JOIN media_assets ma ON ma.id = m.media_asset_id
     WHERE conv.contact_id = ?
     ORDER BY datetime(m.created_at) ASC
     LIMIT ?`
  ).all(contactId, limit) as Array<Record<string, unknown>>;

  return rows.map((row) => {
    const msg = mapMessage(row);
    return {
      ...msg,
      channel: String(row.conv_channel ?? row.channel ?? "whatsapp") as ChannelType,
      mediaPath: (row.media_storage_path as string) ?? msg.mediaPath ?? null
    };
  });
}

export function getConversationById(conversationId: string) {
  const db = getDb();
  const row = db
    .prepare(
      `
        SELECT
          conv.*,
          c.name AS contact_name,
          c.phone AS contact_phone,
          c.instagram AS contact_instagram
        FROM conversations conv
        LEFT JOIN contacts c ON c.id = conv.contact_id
        WHERE conv.id = ?
      `
    )
    .get(conversationId) as Record<string, unknown> | undefined;
  return row ? mapConversation(row) : null;
}

export function getConversationByExternalThread(channel: ChannelType, externalThreadId: string) {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM conversations WHERE channel = ? AND external_thread_id = ?")
    .get(channel, externalThreadId) as Record<string, unknown> | undefined;

  return row ? mapConversation(row) : null;
}

export function getLatestConversationForContactChannel(contactId: string, channel: ChannelType) {
  const db = getDb();
  const row = db
    .prepare(
      `
        SELECT *
        FROM conversations
        WHERE contact_id = ?
          AND channel = ?
        ORDER BY datetime(COALESCE(last_message_at, updated_at)) DESC
        LIMIT 1
      `
    )
    .get(contactId, channel) as Record<string, unknown> | undefined;

  return row ? mapConversation(row) : null;
}

export function getConversationByChatId(waChatId: string) {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM conversations WHERE channel = 'whatsapp' AND (external_thread_id = ? OR wa_chat_id = ?)")
    .get(waChatId, waChatId) as Record<string, unknown> | undefined;
  return row ? mapConversation(row) : null;
}

export function getMessageByExternalId(externalId: string) {
  const db = getDb();
  const row = db
    .prepare(
      `
        SELECT m.*, ma.storage_path
        FROM messages m
        LEFT JOIN media_assets ma ON ma.id = m.media_asset_id
        WHERE m.external_id = ?
        LIMIT 1
      `
    )
    .get(externalId) as Record<string, unknown> | undefined;

  return row ? mapMessage(row) : null;
}

export function listMessagesForConversation(conversationId: string, limit = 120) {
  const db = getDb();
  const rows = db
    .prepare(
      `
        SELECT m.*, ma.storage_path
        FROM messages m
        LEFT JOIN media_assets ma ON ma.id = m.media_asset_id
        WHERE m.conversation_id = ?
        ORDER BY datetime(m.created_at) DESC
        LIMIT ?
      `
    )
    .all(conversationId, limit) as Array<Record<string, unknown>>;

  return rows.reverse().map(mapMessage);
}

export function upsertConversation(input: {
  channel?: ChannelType;
  channelAccountId?: string | null;
  contactId?: string | null;
  externalThreadId?: string | null;
  waChatId?: string;
  title: string;
  contactInstagram?: string | null;
  unreadCount?: number;
  lastMessagePreview?: string;
  lastMessageAt?: string | null;
  lastMessageDirection?: MessageDirection | null;
  assignedTo?: string | null;
  contactPhone?: string | null;
  inboxCategory?: string | null;
  internalStatus?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const db = getDb();
  const accounts = ensureDefaultChannelAccounts();
  const channel = input.channel ?? "whatsapp";
  const externalThreadId = String(input.externalThreadId ?? input.waChatId ?? "").trim();
  if (!externalThreadId) {
    throw new Error("external_thread_required");
  }

  const channelAccountId =
    input.channelAccountId ?? (channel === "instagram" ? accounts.instagram?.id : accounts.whatsapp?.id) ?? null;
  const existing = getConversationByExternalThread(channel, externalThreadId);
  const timestamp = nowIso();
  const ensuredContact = ensureContact({
    channel,
    contactPhone: input.contactPhone ?? null,
    contactName: input.title
  });
  const contactId = input.contactId ?? ensuredContact?.id ?? existing?.contactId ?? null;
  const instagramHandle = input.contactInstagram ?? (typeof input.metadata?.username === "string" ? input.metadata.username : null);

  if (existing) {
    db.prepare(
      `
        UPDATE conversations
        SET
          title = ?,
          unread_count = ?,
          last_message_preview = ?,
          last_message_at = ?,
          last_message_direction = ?,
          assigned_to = ?,
          contact_id = COALESCE(?, contact_id),
          channel_account_id = COALESCE(?, channel_account_id),
          inbox_category = ?,
          internal_status = ?,
          metadata_json = ?,
          updated_at = ?
        WHERE id = ?
      `
    ).run(
      input.title,
      input.unreadCount ?? existing.unreadCount,
      input.lastMessagePreview ?? existing.lastMessagePreview,
      input.lastMessageAt ?? existing.lastMessageAt,
      input.lastMessageDirection ?? null,
      input.assignedTo ?? existing.assignedTo,
      contactId,
      channelAccountId,
      input.inboxCategory ?? existing.inboxCategory ?? "primary",
      input.internalStatus ?? existing.internalStatus ?? "open",
      JSON.stringify(input.metadata ?? existing.metadata ?? {}),
      timestamp,
      existing.id
    );

    recordAuditLog({
      entityType: "conversation",
      entityId: existing.id,
      action: "conversation.upserted",
      channel,
      contactId,
      conversationId: existing.id,
      metadata: {
        externalThreadId,
        title: input.title
      },
      createdAt: timestamp
    });

    if (channel === "instagram") {
      rememberInstagramThreadForConversation({
        contactId,
        externalThreadId,
        instagramHandle,
        title: input.title,
        observedAt: input.lastMessageAt ?? existing.lastMessageAt ?? timestamp,
        source: "conversation-upsert"
      });
    }

    return getConversationById(existing.id);
  }

  const id = randomUUID();
  db.prepare(
    `
      INSERT INTO conversations (
        id, contact_id, wa_chat_id, title, unread_count, last_message_preview, last_message_at, last_message_direction,
        status, assigned_to, created_at, updated_at, channel, channel_account_id, external_thread_id, inbox_category, internal_status, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    id,
    contactId,
    conversationLegacyThreadId(channel, externalThreadId),
    input.title,
    input.unreadCount ?? 0,
    input.lastMessagePreview ?? "",
    input.lastMessageAt ?? null,
    input.lastMessageDirection ?? null,
    input.assignedTo ?? null,
    timestamp,
    timestamp,
    channel,
    channelAccountId,
    externalThreadId,
    input.inboxCategory ?? "primary",
    input.internalStatus ?? "open",
    JSON.stringify(input.metadata ?? {})
  );

  recordAuditLog({
    entityType: "conversation",
    entityId: id,
    action: "conversation.created",
    channel,
    contactId,
    conversationId: id,
    metadata: {
      externalThreadId,
      title: input.title
    },
    createdAt: timestamp
  });

  if (channel === "instagram") {
    rememberInstagramThreadForConversation({
      contactId,
      externalThreadId,
      instagramHandle,
      title: input.title,
      observedAt: input.lastMessageAt ?? timestamp,
      source: "conversation-upsert"
    });
  }

  return getConversationById(id);
}

export function updateConversationInternalStatus(conversationId: string, internalStatus: string) {
  const db = getDb();
  const timestamp = nowIso();
  const existing = getConversationById(conversationId);
  if (!existing) {
    return null;
  }

  db.prepare(
    `
      UPDATE conversations
      SET internal_status = ?, updated_at = ?
      WHERE id = ?
    `
  ).run(internalStatus, timestamp, conversationId);

  recordAuditLog({
    entityType: "conversation",
    entityId: conversationId,
    action: "conversation.status_updated",
    channel: existing.channel,
    contactId: existing.contactId,
    conversationId,
    metadata: {
      previousStatus: existing.internalStatus,
      nextStatus: internalStatus
    },
    createdAt: timestamp
  });

  return getConversationById(conversationId);
}

export function addMessage(input: {
  conversationId: string;
  contactId?: string | null;
  direction: MessageDirection;
  contentType: MessageContentType;
  body?: string;
  mediaAssetId?: string | null;
  mediaPath?: string | null;
  externalId?: string | null;
  status?: string;
  sentAt?: string | null;
  meta?: Record<string, unknown>;
}) {
  const db = getDb();
  const conversation = getConversationById(input.conversationId);
  if (input.externalId) {
    const existing = db.prepare("SELECT id FROM messages WHERE external_id = ?").get(input.externalId) as { id: string } | undefined;
    if (existing) {
      return existing.id;
    }
  }

  const timestamp = nowIso();
  const id = randomUUID();
  db.prepare(
    `
      INSERT INTO messages (
        id, conversation_id, contact_id, direction, content_type, body, media_asset_id, external_id, status, sent_at, meta_json, created_at, channel, channel_account_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    id,
    input.conversationId,
    input.contactId ?? null,
    input.direction,
    input.contentType,
    input.body ?? "",
    input.mediaAssetId ?? null,
    input.externalId ?? null,
    input.status ?? "sent",
    input.sentAt ?? timestamp,
    JSON.stringify(input.meta ?? {}),
    timestamp,
    conversation?.channel ?? "whatsapp",
    conversation?.channelAccountId ?? null
  );

  const preview = input.body?.trim() || (input.contentType === "text" ? "Mensagem" : `Arquivo: ${input.contentType}`);
  db.prepare(
    `
      UPDATE conversations
      SET last_message_preview = ?, last_message_at = ?, last_message_direction = ?, updated_at = ?
      WHERE id = ?
    `
  ).run(preview, input.sentAt ?? timestamp, input.direction, timestamp, input.conversationId);

  if (input.contactId && input.meta?.source !== "snapshot" && conversation?.lastMessagePreview !== preview) {
    recordContactHistory(input.contactId, {
      field: "last_message_preview",
      label: "Última mensagem",
      previousValue: conversation?.lastMessagePreview ?? null,
      nextValue: preview,
      source: conversation?.channel ?? "whatsapp",
      createdAt: input.sentAt ?? timestamp
    });
  }

  if (input.contactId) {
    touchContactTimestamps(input.contactId, {
      lastInteractionAt: input.sentAt ?? timestamp,
      lastOutgoingAt: input.direction === "outgoing" ? input.sentAt ?? timestamp : null,
      lastIncomingAt: input.direction === "incoming" ? input.sentAt ?? timestamp : null
    });
  }

  recordAuditLog({
    entityType: "message",
    entityId: id,
    action: "message.recorded",
    channel: conversation?.channel ?? "whatsapp",
    contactId: input.contactId ?? null,
    conversationId: input.conversationId,
    messageId: id,
    metadata: {
      direction: input.direction,
      contentType: input.contentType,
      source: input.meta?.source ?? null
    },
    createdAt: input.sentAt ?? timestamp
  });

  return id;
}

export function saveConversationSnapshot(input: {
  channel?: ChannelType;
  channelAccountId?: string | null;
  contactId?: string | null;
  externalThreadId?: string | null;
  waChatId?: string;
  title: string;
  unreadCount: number;
  lastMessagePreview: string;
  lastMessageAt: string | null;
  lastMessageDirection: MessageDirection | null;
  contactPhone: string | null;
  messages: Array<{
    externalId?: string | null;
    direction: MessageDirection;
    body: string;
    contentType: MessageContentType;
    sentAt?: string | null;
  }>;
}) {
  const conversation = upsertConversation({
    channel: input.channel ?? "whatsapp",
    channelAccountId: input.channelAccountId ?? null,
    contactId: input.contactId ?? null,
    externalThreadId: input.externalThreadId ?? input.waChatId ?? null,
    waChatId: input.waChatId,
    title: input.title,
    unreadCount: input.unreadCount,
    lastMessagePreview: input.lastMessagePreview,
    lastMessageAt: input.lastMessageAt,
    lastMessageDirection: input.lastMessageDirection,
    contactPhone: input.contactPhone
  });

  if (!conversation) {
    return null;
  }

  for (const message of input.messages) {
    addMessage({
      conversationId: conversation.id,
      contactId: conversation.contactId,
      direction: message.direction,
      body: message.body,
      contentType: message.contentType,
      sentAt: message.sentAt,
      externalId: message.externalId ?? null,
      meta: {
        source: "snapshot"
      }
    });
  }

  return getConversationById(conversation.id);
}
