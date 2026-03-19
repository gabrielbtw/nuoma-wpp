import { getDb } from "../db/connection.js";
import type { ChannelType, ContactChannelRecord } from "../types/domain.js";
import { normalizeChannelDisplayValue, normalizeChannelValue } from "../utils/channels.js";

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

function mapContactChannel(row: Record<string, unknown>): ContactChannelRecord {
  return {
    id: String(row.id),
    contactId: String(row.contact_id),
    type: String(row.type) as ChannelType,
    externalId: (row.external_id as string | null) ?? null,
    displayValue: String(row.display_value),
    normalizedValue: (row.normalized_value as string | null) ?? null,
    isPrimary: Boolean(row.is_primary ?? 0),
    isActive: Boolean(row.is_active ?? 1),
    metadata: parseJsonObject(row.metadata_json as string | null),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function contactChannelId(contactId: string, type: ChannelType) {
  return `contact-channel:${contactId}:${type}`;
}

function getContactChannel(contactId: string, type: ChannelType) {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM contact_channels WHERE contact_id = ? AND type = ? LIMIT 1")
    .get(contactId, type) as Record<string, unknown> | undefined;
  return row ? mapContactChannel(row) : null;
}

function normalizeMetadataText(value?: string | null) {
  const normalized = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || null;
}

export function listContactChannels(contactId: string) {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM contact_channels WHERE contact_id = ? ORDER BY is_primary DESC, type ASC, created_at ASC")
    .all(contactId) as Array<Record<string, unknown>>;

  return rows.map(mapContactChannel);
}

export function listContactChannelsForContacts(contactIds: string[]) {
  if (contactIds.length === 0) {
    return new Map<string, ContactChannelRecord[]>();
  }

  const db = getDb();
  const placeholders = contactIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `
        SELECT *
        FROM contact_channels
        WHERE contact_id IN (${placeholders})
        ORDER BY is_primary DESC, type ASC, created_at ASC
      `
    )
    .all(...contactIds) as Array<Record<string, unknown>>;

  const grouped = new Map<string, ContactChannelRecord[]>();
  for (const row of rows) {
    const channel = mapContactChannel(row);
    const current = grouped.get(channel.contactId) ?? [];
    current.push(channel);
    grouped.set(channel.contactId, current);
  }

  return grouped;
}

export function findContactIdByChannel(type: ChannelType, value?: string | null) {
  const normalized = normalizeChannelValue(type, value);
  if (!normalized) {
    return null;
  }

  const db = getDb();
  const row = db
    .prepare(
      `
        SELECT contact_id
        FROM contact_channels
        WHERE type = ?
          AND normalized_value = ?
          AND is_active = 1
        ORDER BY is_primary DESC, updated_at DESC
        LIMIT 1
      `
    )
    .get(type, normalized) as { contact_id: string } | undefined;

  return row?.contact_id ?? null;
}

export function upsertContactChannel(input: {
  contactId: string;
  type: ChannelType;
  displayValue: string;
  normalizedValue?: string | null;
  externalId?: string | null;
  isPrimary?: boolean;
  isActive?: boolean;
  metadata?: Record<string, unknown>;
}) {
  const db = getDb();
  const timestamp = nowIso();
  const id = contactChannelId(input.contactId, input.type);

  db.prepare(
    `
      INSERT INTO contact_channels (
        id, contact_id, type, external_id, display_value, normalized_value, is_primary, is_active, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        external_id = excluded.external_id,
        display_value = excluded.display_value,
        normalized_value = excluded.normalized_value,
        is_primary = excluded.is_primary,
        is_active = excluded.is_active,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `
  ).run(
    id,
    input.contactId,
    input.type,
    input.externalId ?? null,
    input.displayValue.trim(),
    input.normalizedValue ?? null,
    input.isPrimary ? 1 : 0,
    input.isActive === false ? 0 : 1,
    JSON.stringify(input.metadata ?? {}),
    timestamp,
    timestamp
  );

  return id;
}

export function listInactiveContactChannelValues(type: ChannelType) {
  const db = getDb();
  const rows = db
    .prepare(
      `
        SELECT DISTINCT normalized_value
        FROM contact_channels
        WHERE type = ?
          AND is_active = 0
          AND normalized_value IS NOT NULL
          AND trim(normalized_value) <> ''
      `
    )
    .all(type) as Array<{ normalized_value: string | null }>;

  return rows
    .map((row) => normalizeChannelValue(type, row.normalized_value))
    .filter((value): value is string => Boolean(value));
}

export function isContactChannelValueInactive(type: ChannelType, value?: string | null) {
  const normalizedValue = normalizeChannelValue(type, value);
  if (!normalizedValue) {
    return false;
  }

  const db = getDb();
  const row = db
    .prepare(
      `
        SELECT 1
        FROM contact_channels
        WHERE type = ?
          AND normalized_value = ?
          AND is_active = 0
        LIMIT 1
      `
    )
    .get(type, normalizedValue) as { 1: number } | undefined;

  return Boolean(row);
}

export function deactivateContactChannel(input: {
  contactId: string;
  type: ChannelType;
  displayValue?: string | null;
  normalizedValue?: string | null;
  externalId?: string | null;
  reason?: string | null;
  source?: string | null;
  observedAt?: string | null;
}) {
  const existing = getContactChannel(input.contactId, input.type);
  const normalizedValue =
    normalizeChannelValue(input.type, input.normalizedValue) ??
    normalizeChannelValue(input.type, input.displayValue) ??
    existing?.normalizedValue ??
    null;
  const displayValue =
    normalizeChannelDisplayValue(input.type, input.displayValue) ??
    normalizeChannelDisplayValue(input.type, normalizedValue) ??
    existing?.displayValue ??
    null;

  if (!normalizedValue || !displayValue) {
    return existing && existing.isActive === false ? existing : null;
  }

  const previousMetadata = existing?.metadata ?? {};
  const reason = normalizeMetadataText(input.reason);
  const source = normalizeMetadataText(input.source) ?? "system";
  const observedAt = normalizeMetadataText(input.observedAt) ?? nowIso();
  const metadata: Record<string, unknown> = {
    ...previousMetadata,
    inactiveAt: observedAt,
    inactiveSource: source
  };

  if (reason) {
    metadata.inactiveReason = reason;
  }

  upsertContactChannel({
    contactId: input.contactId,
    type: input.type,
    displayValue,
    normalizedValue,
    externalId: input.externalId ?? existing?.externalId ?? normalizedValue,
    isPrimary: existing?.isPrimary ?? true,
    isActive: false,
    metadata
  });

  return getContactChannel(input.contactId, input.type);
}

export function getInstagramThreadIdForContact(contactId: string) {
  const channel = getContactChannel(contactId, "instagram");
  const threadId = typeof channel?.metadata?.threadId === "string" ? channel.metadata.threadId.trim() : "";
  return threadId || null;
}

export function rememberInstagramThreadForContact(input: {
  contactId: string;
  instagram?: string | null;
  threadId: string;
  threadTitle?: string | null;
  observedAt?: string | null;
  source?: string | null;
}) {
  const normalizedValue = normalizeChannelValue("instagram", input.instagram);
  const displayValue = normalizeChannelDisplayValue("instagram", input.instagram);
  const threadId = normalizeMetadataText(input.threadId);

  if (!normalizedValue || !displayValue || !threadId) {
    return null;
  }

  const existing = getContactChannel(input.contactId, "instagram");
  const previousMetadata = existing?.metadata ?? {};
  const threadTitle = normalizeMetadataText(input.threadTitle);
  const observedAt = normalizeMetadataText(input.observedAt) ?? nowIso();
  const source = normalizeMetadataText(input.source) ?? "instagram-assisted-sync";
  const metadata: Record<string, unknown> = {
    ...previousMetadata,
    threadId,
    threadObservedAt: observedAt,
    threadSource: source
  };

  if (threadTitle) {
    metadata.threadTitle = threadTitle;
  }

  const currentThreadId = typeof previousMetadata.threadId === "string" ? previousMetadata.threadId.trim() : "";
  const currentThreadTitle = typeof previousMetadata.threadTitle === "string" ? previousMetadata.threadTitle.trim() : "";
  const currentObservedAt = typeof previousMetadata.threadObservedAt === "string" ? previousMetadata.threadObservedAt.trim() : "";
  const currentSource = typeof previousMetadata.threadSource === "string" ? previousMetadata.threadSource.trim() : "";

  if (
    existing &&
    currentThreadId === threadId &&
    currentThreadTitle === (threadTitle ?? currentThreadTitle) &&
    currentObservedAt === observedAt &&
    currentSource === source &&
    existing.displayValue === displayValue &&
    existing.normalizedValue === normalizedValue
  ) {
    return existing;
  }

  upsertContactChannel({
    contactId: input.contactId,
    type: "instagram",
    displayValue,
    normalizedValue,
    externalId: normalizedValue,
    isPrimary: existing?.isPrimary ?? true,
    isActive: existing?.isActive ?? true,
    metadata
  });

  return getContactChannel(input.contactId, "instagram");
}

export function syncPrimaryContactChannels(
  contactId: string,
  input: {
    whatsapp?: string | null;
    instagram?: string | null;
  }
) {
  const db = getDb();
  const timestamp = nowIso();
  const channels: Array<{ type: ChannelType; value?: string | null; externalId?: string | null }> = [
    { type: "whatsapp", value: input.whatsapp ?? null, externalId: null },
    {
      type: "instagram",
      value: input.instagram ?? null,
      externalId: normalizeChannelValue("instagram", input.instagram)
    }
  ];

  const transaction = db.transaction(() => {
    for (const channel of channels) {
      const displayValue = normalizeChannelDisplayValue(channel.type, channel.value);
      const normalizedValue = normalizeChannelValue(channel.type, channel.value);

      if (!displayValue || !normalizedValue) {
        db.prepare("DELETE FROM contact_channels WHERE contact_id = ? AND type = ? AND is_primary = 1").run(contactId, channel.type);
        continue;
      }

      db.prepare(
        `
          INSERT INTO contact_channels (
            id, contact_id, type, external_id, display_value, normalized_value, is_primary, is_active, metadata_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 1, 1, '{}', ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            external_id = excluded.external_id,
            display_value = excluded.display_value,
            normalized_value = excluded.normalized_value,
            is_active = 1,
            updated_at = excluded.updated_at
        `
      ).run(contactChannelId(contactId, channel.type), contactId, channel.type, channel.externalId ?? null, displayValue, normalizedValue, timestamp, timestamp);
    }
  });

  transaction();
}
