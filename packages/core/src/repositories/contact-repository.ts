import { randomUUID } from "node:crypto";
import { getDb } from "../db/connection.js";
import type { ContactHistoryRecord, ContactInput, ContactRecord } from "../types/domain.js";
import { recordAuditLog } from "./audit-log-repository.js";
import { findContactIdByChannel, listContactChannelsForContacts, syncPrimaryContactChannels } from "./contact-channel-repository.js";
import { ensureTag, normalizeTagName } from "./tag-repository.js";
import { normalizeWhatsAppValue } from "../utils/channels.js";

const WHATSAPP_TAG_NAME = "whatsapp";

function nowIso() {
  return new Date().toISOString();
}

function normalizeNullable(input?: string | null) {
  if (input == null) {
    return null;
  }

  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizePhoneForStorage(input?: string | null) {
  return normalizeNullable(input);
}

function sanitizeAutoContactTitle(input: string) {
  return input.replace(/\s+/g, " ").trim();
}

function inferInstagramHandle(input: string) {
  const normalized = sanitizeAutoContactTitle(input);
  if (!normalized) {
    return null;
  }

  const withoutAt = normalized.startsWith("@") ? normalized.slice(1) : normalized;
  if (!/^[a-z0-9._]{3,30}$/i.test(withoutAt)) {
    return null;
  }

  if (!/[a-z]/i.test(withoutAt)) {
    return null;
  }

  return `@${withoutAt}`;
}

function normalizeAutoContactName(input: string) {
  const normalized = sanitizeAutoContactTitle(input);
  if (!normalized) {
    return "";
  }

  if (inferInstagramHandle(normalized)) {
    return normalized.startsWith("@") ? normalized : `@${normalized}`;
  }

  if (/^[\W_.-]+$/u.test(normalized)) {
    return "";
  }

  if (!/[a-z0-9]/i.test(normalized)) {
    return "";
  }

  return normalized;
}

function normalizeTagList(tags: string[], phone?: string | null) {
  const normalized = new Map<string, string>();

  for (const rawTag of tags) {
    const trimmed = rawTag.trim().replace(/\s+/g, " ");
    if (!trimmed) {
      continue;
    }

    normalized.set(normalizeTagName(trimmed), trimmed);
  }

  if (normalizeWhatsAppValue(phone)) {
    normalized.set(normalizeTagName(WHATSAPP_TAG_NAME), WHATSAPP_TAG_NAME);
  }

  return [...normalized.values()];
}

function stringifyHistoryValue(value: unknown) {
  if (value == null) {
    return null;
  }

  if (Array.isArray(value)) {
    const normalized = value.map((item) => String(item).trim()).filter(Boolean);
    return normalized.length > 0 ? normalized.join(", ") : null;
  }

  if (typeof value === "boolean") {
    return value ? "Sim" : "Não";
  }

  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function mapContact(row: Record<string, unknown>): ContactRecord {
  const tagsCsv = typeof row.tags_csv === "string" && row.tags_csv.length > 0 ? row.tags_csv.split(",") : [];
  const tags = [...new Set(tagsCsv.map((tag) => tag.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right, "pt-BR"));
  const instagramFollowsMeValue = row.instagram_follows_me;
  const instagramFollowedByMeValue = row.instagram_followed_by_me;

  return {
    id: String(row.id),
    name: String(row.name),
    phone: normalizePhoneForStorage((row.phone as string | null) ?? null) ?? "",
    cpf: normalizeNullable(String(row.cpf ?? "")),
    email: normalizeNullable(String(row.email ?? "")),
    instagram: normalizeNullable(String(row.instagram ?? "")),
    procedureStatus: String(row.procedure_status) as ContactRecord["procedureStatus"],
    lastAttendant: normalizeNullable(String(row.last_attendant ?? "")),
    notes: normalizeNullable(String(row.notes ?? "")),
    status: String(row.status) as ContactRecord["status"],
    tags,
    channels: [],
    instagramFollowsMe:
      instagramFollowsMeValue == null ? null : Number(instagramFollowsMeValue) === 1,
    instagramFollowedByMe:
      instagramFollowedByMeValue == null ? null : Number(instagramFollowedByMeValue) === 1,
    instagramIncomingMessagesCount: Number(row.instagram_incoming_messages_count ?? 0),
    instagramSentMoreThanThreeMessages: Number(row.instagram_sent_more_than_three_messages ?? 0) === 1,
    lastInteractionAt: (row.last_interaction_at as string | null) ?? null,
    lastProcedureAt: (row.last_procedure_at as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    conversationId: (row.conversation_id as string | null) ?? null,
    lastMessagePreview: normalizeNullable(String(row.last_message_preview ?? "")),
    lastMessageAt: (row.last_message_at as string | null) ?? null
  };
}

function hydrateContactsWithChannels(contacts: ContactRecord[]) {
  const channelsByContact = listContactChannelsForContacts(contacts.map((contact) => contact.id));
  return contacts.map((contact) => ({
    ...contact,
    channels: channelsByContact.get(contact.id) ?? []
  }));
}

function mapHistoryRow(row: Record<string, unknown>): ContactHistoryRecord {
  return {
    id: String(row.id),
    contactId: String(row.contact_id),
    field: String(row.field_key),
    label: String(row.field_label),
    previousValue: normalizeNullable(String(row.previous_value ?? "")),
    nextValue: normalizeNullable(String(row.next_value ?? "")),
    source: String(row.source ?? "manual"),
    createdAt: String(row.created_at)
  };
}

function replaceContactTags(contactId: string, tagNames: string[]) {
  const db = getDb();
  const timestamp = nowIso();
  const cleanTags = normalizeTagList(tagNames);

  const transaction = db.transaction(() => {
    db.prepare("DELETE FROM contact_tags WHERE contact_id = ?").run(contactId);
    const insert = db.prepare("INSERT INTO contact_tags (contact_id, tag_id, created_at) VALUES (?, ?, ?)");

    for (const tagName of cleanTags) {
      const tag = ensureTag(tagName, {
        type: normalizeTagName(tagName) === WHATSAPP_TAG_NAME ? "canal" : "manual",
        active: true
      });
      insert.run(contactId, tag.id, timestamp);
    }
  });

  transaction();
}

function baseContactQuery(whereClause = "") {
  return `
    SELECT
      c.*,
      conv.id AS conversation_id,
      conv.last_message_preview AS last_message_preview,
      conv.last_message_at AS last_message_at,
      GROUP_CONCAT(t.name) AS tags_csv
    FROM contacts c
    LEFT JOIN conversations conv ON conv.contact_id = c.id
    LEFT JOIN contact_tags ct ON ct.contact_id = c.id
    LEFT JOIN tags t ON t.id = ct.tag_id
    ${whereClause}
    GROUP BY c.id
  `;
}

function buildContactFilters(filters?: { query?: string; tag?: string; status?: string }) {
  const where: string[] = ["c.deleted_at IS NULL"];
  const params: unknown[] = [];

  if (filters?.query) {
    const like = `%${filters.query}%`;
    where.push(
      "(c.name LIKE ? OR c.phone LIKE ? OR IFNULL(c.instagram, '') LIKE ? OR EXISTS (SELECT 1 FROM contact_tags ctx INNER JOIN tags tx ON tx.id = ctx.tag_id WHERE ctx.contact_id = c.id AND tx.name LIKE ?))"
    );
    params.push(like, like, like, like);
  }

  if (filters?.tag) {
    where.push(
      "EXISTS (SELECT 1 FROM contact_tags ctx INNER JOIN tags tx ON tx.id = ctx.tag_id WHERE ctx.contact_id = c.id AND tx.normalized_name = ?)"
    );
    params.push(normalizeTagName(filters.tag));
  }

  if (filters?.status) {
    where.push("c.status = ?");
    params.push(filters.status);
  }

  return {
    whereClause: `WHERE ${where.join(" AND ")}`,
    params
  };
}

export type SegmentFilter = {
  field: "tag" | "status" | "channel" | "procedure" | "created_after" | "created_before" | "last_interaction_after" | "last_interaction_before" | "has_phone" | "has_instagram";
  operator: "equals" | "not_equals" | "has" | "not_has";
  value: string;
};

export type SegmentQuery = {
  logic: "and" | "or";
  filters: SegmentFilter[];
};

export function queryContactsBySegment(segment: SegmentQuery, page = 1, pageSize = 60) {
  const db = getDb();
  const clauses: string[] = ["c.deleted_at IS NULL"];
  const params: unknown[] = [];

  for (const f of segment.filters) {
    const clause = buildSegmentClause(f, params);
    if (clause) clauses.push(clause);
  }

  const joiner = segment.logic === "or" ? " OR " : " AND ";
  const filterClauses = clauses.slice(1); // skip deleted_at
  const whereStr = filterClauses.length > 0
    ? `WHERE c.deleted_at IS NULL AND (${filterClauses.join(joiner)})`
    : "WHERE c.deleted_at IS NULL";

  const total = Number((db.prepare(`SELECT COUNT(*) AS count FROM contacts c ${whereStr}`).get(...params) as { count: number }).count ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const offset = (safePage - 1) * pageSize;

  const rows = db.prepare(
    `${baseContactQuery(whereStr)} ORDER BY COALESCE(c.last_interaction_at, c.updated_at) DESC LIMIT ? OFFSET ?`
  ).all(...params, pageSize, offset) as Array<Record<string, unknown>>;

  return {
    items: hydrateContactsWithChannels(rows.map(mapContact)),
    total,
    page: safePage,
    pageSize,
    totalPages
  };
}

function buildSegmentClause(f: SegmentFilter, params: unknown[]): string | null {
  switch (f.field) {
    case "tag":
      if (f.operator === "has" || f.operator === "equals") {
        params.push(normalizeTagName(f.value));
        return "EXISTS (SELECT 1 FROM contact_tags ctx INNER JOIN tags tx ON tx.id = ctx.tag_id WHERE ctx.contact_id = c.id AND tx.normalized_name = ?)";
      }
      if (f.operator === "not_has" || f.operator === "not_equals") {
        params.push(normalizeTagName(f.value));
        return "NOT EXISTS (SELECT 1 FROM contact_tags ctx INNER JOIN tags tx ON tx.id = ctx.tag_id WHERE ctx.contact_id = c.id AND tx.normalized_name = ?)";
      }
      return null;
    case "status":
      params.push(f.value);
      return f.operator === "not_equals" ? "c.status <> ?" : "c.status = ?";
    case "channel":
      if (f.value === "whatsapp") {
        return f.operator === "has" || f.operator === "equals"
          ? "c.phone IS NOT NULL AND trim(c.phone) <> ''"
          : "(c.phone IS NULL OR trim(c.phone) = '')";
      }
      if (f.value === "instagram") {
        return f.operator === "has" || f.operator === "equals"
          ? "c.instagram IS NOT NULL AND trim(c.instagram) <> ''"
          : "(c.instagram IS NULL OR trim(c.instagram) = '')";
      }
      return null;
    case "procedure":
      params.push(f.value);
      return f.operator === "not_equals" ? "c.procedure_status <> ?" : "c.procedure_status = ?";
    case "created_after":
      params.push(f.value);
      return "datetime(c.created_at) >= datetime(?)";
    case "created_before":
      params.push(f.value);
      return "datetime(c.created_at) <= datetime(?)";
    case "last_interaction_after":
      params.push(f.value);
      return "datetime(c.last_interaction_at) >= datetime(?)";
    case "last_interaction_before":
      params.push(f.value);
      return "datetime(c.last_interaction_at) <= datetime(?)";
    case "has_phone":
      return f.value === "true" ? "c.phone IS NOT NULL AND trim(c.phone) <> ''" : "(c.phone IS NULL OR trim(c.phone) = '')";
    case "has_instagram":
      return f.value === "true" ? "c.instagram IS NOT NULL AND trim(c.instagram) <> ''" : "(c.instagram IS NULL OR trim(c.instagram) = '')";
    default:
      return null;
  }
}

function getTagNamesForContact(contactId: string) {
  const db = getDb();
  const rows = db
    .prepare(
      `
        SELECT t.name
        FROM contact_tags ct
        INNER JOIN tags t ON t.id = ct.tag_id
        WHERE ct.contact_id = ?
        ORDER BY t.name ASC
      `
    )
    .all(contactId) as Array<{ name: string }>;

  return rows.map((row) => row.name);
}

type HistoryEntryInput = {
  field: string;
  label: string;
  previousValue?: unknown;
  nextValue?: unknown;
  source?: string;
  createdAt?: string;
};

export function recordContactHistory(contactId: string, input: HistoryEntryInput | HistoryEntryInput[]) {
  const db = getDb();
  const entries = Array.isArray(input) ? input : [input];

  const insert = db.prepare(
    `
      INSERT INTO contact_history (id, contact_id, field_key, field_label, previous_value, next_value, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
  );

  const transaction = db.transaction(() => {
    for (const entry of entries) {
      const previousValue = stringifyHistoryValue(entry.previousValue);
      const nextValue = stringifyHistoryValue(entry.nextValue);
      if (previousValue === nextValue) {
        continue;
      }

      insert.run(
        randomUUID(),
        contactId,
        entry.field,
        entry.label,
        previousValue,
        nextValue,
        entry.source ?? "manual",
        entry.createdAt ?? nowIso()
      );
    }
  });

  transaction();
}

function recordContactChanges(before: ContactRecord, after: ContactRecord, source = "manual") {
  recordContactHistory(before.id, [
    { field: "name", label: "Nome", previousValue: before.name, nextValue: after.name, source },
    { field: "phone", label: "Telefone", previousValue: before.phone, nextValue: after.phone, source },
    { field: "cpf", label: "CPF", previousValue: before.cpf, nextValue: after.cpf, source },
    { field: "email", label: "Email", previousValue: before.email, nextValue: after.email, source },
    { field: "instagram", label: "Instagram", previousValue: before.instagram, nextValue: after.instagram, source },
    { field: "status", label: "Status", previousValue: before.status, nextValue: after.status, source },
    {
      field: "procedure_status",
      label: "Status do procedimento",
      previousValue: before.procedureStatus,
      nextValue: after.procedureStatus,
      source
    },
    { field: "notes", label: "Observações", previousValue: before.notes, nextValue: after.notes, source },
    {
      field: "instagram_follows_me",
      label: "Segue no Instagram",
      previousValue: before.instagramFollowsMe,
      nextValue: after.instagramFollowsMe,
      source
    },
    {
      field: "instagram_followed_by_me",
      label: "Seguido por você no Instagram",
      previousValue: before.instagramFollowedByMe,
      nextValue: after.instagramFollowedByMe,
      source
    },
    {
      field: "instagram_incoming_messages_count",
      label: "Mensagens recebidas no Instagram",
      previousValue: before.instagramIncomingMessagesCount,
      nextValue: after.instagramIncomingMessagesCount,
      source
    },
    {
      field: "instagram_sent_more_than_three_messages",
      label: "Mais de 3 mensagens no Instagram",
      previousValue: before.instagramSentMoreThanThreeMessages,
      nextValue: after.instagramSentMoreThanThreeMessages,
      source
    },
    { field: "tags", label: "Tags", previousValue: before.tags, nextValue: after.tags, source }
  ]);
}

export function updateContactInstagramSignals(
  contactId: string,
  input: {
    instagramFollowsMe?: boolean | null;
    instagramFollowedByMe?: boolean | null;
    instagramIncomingMessagesCount?: number;
    instagramSentMoreThanThreeMessages?: boolean;
  },
  source = "instagram-import"
) {
  const db = getDb();
  const existing = getContactById(contactId);
  if (!existing) {
    return null;
  }

  const nextInstagramFollowsMe =
    Object.prototype.hasOwnProperty.call(input, "instagramFollowsMe") ? input.instagramFollowsMe ?? null : existing.instagramFollowsMe;
  const nextInstagramFollowedByMe =
    Object.prototype.hasOwnProperty.call(input, "instagramFollowedByMe") ? input.instagramFollowedByMe ?? null : existing.instagramFollowedByMe;
  const nextInstagramIncomingMessagesCount =
    input.instagramIncomingMessagesCount != null ? Math.max(0, Math.trunc(input.instagramIncomingMessagesCount)) : existing.instagramIncomingMessagesCount;
  const nextInstagramSentMoreThanThreeMessages =
    input.instagramSentMoreThanThreeMessages != null
      ? input.instagramSentMoreThanThreeMessages
      : nextInstagramIncomingMessagesCount > 3;

  if (
    existing.instagramFollowsMe === nextInstagramFollowsMe &&
    existing.instagramFollowedByMe === nextInstagramFollowedByMe &&
    existing.instagramIncomingMessagesCount === nextInstagramIncomingMessagesCount &&
    existing.instagramSentMoreThanThreeMessages === nextInstagramSentMoreThanThreeMessages
  ) {
    return existing;
  }

  const timestamp = nowIso();
  db.prepare(
    `
      UPDATE contacts
      SET
        instagram_follows_me = ?,
        instagram_followed_by_me = ?,
        instagram_incoming_messages_count = ?,
        instagram_sent_more_than_three_messages = ?,
        updated_at = ?
      WHERE id = ?
    `
  ).run(
    nextInstagramFollowsMe == null ? null : Number(nextInstagramFollowsMe),
    nextInstagramFollowedByMe == null ? null : Number(nextInstagramFollowedByMe),
    nextInstagramIncomingMessagesCount,
    Number(nextInstagramSentMoreThanThreeMessages),
    timestamp,
    contactId
  );

  const updated = getContactById(contactId);
  if (updated) {
    recordContactHistory(contactId, [
      {
        field: "instagram_follows_me",
        label: "Segue no Instagram",
        previousValue: existing.instagramFollowsMe,
        nextValue: updated.instagramFollowsMe,
        source,
        createdAt: timestamp
      },
      {
        field: "instagram_followed_by_me",
        label: "Seguido por você no Instagram",
        previousValue: existing.instagramFollowedByMe,
        nextValue: updated.instagramFollowedByMe,
        source,
        createdAt: timestamp
      },
      {
        field: "instagram_incoming_messages_count",
        label: "Mensagens recebidas no Instagram",
        previousValue: existing.instagramIncomingMessagesCount,
        nextValue: updated.instagramIncomingMessagesCount,
        source,
        createdAt: timestamp
      },
      {
        field: "instagram_sent_more_than_three_messages",
        label: "Mais de 3 mensagens no Instagram",
        previousValue: existing.instagramSentMoreThanThreeMessages,
        nextValue: updated.instagramSentMoreThanThreeMessages,
        source,
        createdAt: timestamp
      }
    ]);
    recordAuditLog({
      entityType: "contact",
      entityId: contactId,
      action: "contact.instagram_signals_updated",
      channel: "instagram",
      contactId,
      metadata: {
        source,
        instagramFollowsMe: updated.instagramFollowsMe,
        instagramFollowedByMe: updated.instagramFollowedByMe,
        instagramIncomingMessagesCount: updated.instagramIncomingMessagesCount,
        instagramSentMoreThanThreeMessages: updated.instagramSentMoreThanThreeMessages
      },
      createdAt: timestamp
    });
  }

  return updated;
}

export function listContacts(filters?: { query?: string; tag?: string; status?: string }) {
  const db = getDb();
  const { whereClause, params } = buildContactFilters(filters);
  const rows = db
    .prepare(`${baseContactQuery(whereClause)} ORDER BY COALESCE(c.last_interaction_at, c.updated_at, c.created_at) DESC`)
    .all(...params) as Array<Record<string, unknown>>;

  return hydrateContactsWithChannels(rows.map(mapContact));
}

export function listContactsPage(filters?: { query?: string; tag?: string; status?: string; page?: number; pageSize?: number }) {
  const db = getDb();
  const { whereClause, params } = buildContactFilters(filters);
  const pageSize = Math.max(1, Math.min(100, Number(filters?.pageSize ?? 20)));
  const page = Math.max(1, Number(filters?.page ?? 1));
  const total = Number((db.prepare(`SELECT COUNT(*) AS count FROM contacts c ${whereClause}`).get(...params) as { count: number }).count ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const offset = (safePage - 1) * pageSize;

  const rows = db
    .prepare(`${baseContactQuery(whereClause)} ORDER BY COALESCE(c.last_interaction_at, c.updated_at, c.created_at) DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, offset) as Array<Record<string, unknown>>;

  return {
    items: hydrateContactsWithChannels(rows.map(mapContact)),
    total,
    page: safePage,
    pageSize,
    totalPages
  };
}

export function getContactById(contactId: string) {
  const db = getDb();
  const row = db
    .prepare(baseContactQuery("WHERE c.id = ? AND c.deleted_at IS NULL"))
    .get(contactId) as Record<string, unknown> | undefined;
  return row ? hydrateContactsWithChannels([mapContact(row)])[0] ?? null : null;
}

export function getContactByPhone(phone: string) {
  const db = getDb();
  const normalizedPhone = normalizePhoneForStorage(phone);
  if (!normalizedPhone) {
    return null;
  }

  const row = db
    .prepare(baseContactQuery("WHERE c.phone = ? AND c.deleted_at IS NULL"))
    .get(normalizedPhone) as Record<string, unknown> | undefined;
  if (row) {
    return hydrateContactsWithChannels([mapContact(row)])[0] ?? null;
  }

  const contactId = findContactIdByChannel("whatsapp", normalizedPhone);
  if (contactId) {
    return getContactById(contactId);
  }

  const normalizedLookup = normalizeWhatsAppValue(normalizedPhone);
  if (!normalizedLookup) {
    return null;
  }

  const candidateRows = db
    .prepare(
      `${baseContactQuery("WHERE c.deleted_at IS NULL AND c.phone IS NOT NULL AND trim(c.phone) <> ''")}
       ORDER BY datetime(c.updated_at) DESC`
    )
    .all() as Array<Record<string, unknown>>;

  const matched = candidateRows
    .map(mapContact)
    .find((candidate) => normalizeWhatsAppValue(candidate.phone) === normalizedLookup);

  return matched ? hydrateContactsWithChannels([matched])[0] ?? null : null;
}

export function getContactByInstagram(instagram: string) {
  const db = getDb();
  const normalizedInstagram = normalizeNullable(instagram)?.replace(/^@+/, "").toLowerCase();
  if (!normalizedInstagram) {
    return null;
  }

  const channelContactId = findContactIdByChannel("instagram", normalizedInstagram);
  if (channelContactId) {
    return getContactById(channelContactId);
  }

  const row = db
    .prepare(
      `
        ${baseContactQuery("WHERE c.deleted_at IS NULL AND lower(trim(IFNULL(c.instagram, ''))) = ?")}
      `
    )
    .get(normalizedInstagram) as Record<string, unknown> | undefined;

  return row ? hydrateContactsWithChannels([mapContact(row)])[0] ?? null : null;
}

export function listContactHistory(contactId: string, limit = 60) {
  const db = getDb();
  const rows = db
    .prepare(
      `
        SELECT *
        FROM contact_history
        WHERE contact_id = ?
        ORDER BY datetime(created_at) DESC
        LIMIT ?
      `
    )
    .all(contactId, Math.max(1, Math.min(200, limit))) as Array<Record<string, unknown>>;

  return rows.map(mapHistoryRow);
}

export function createContact(input: ContactInput, source = "manual") {
  const db = getDb();
  const id = randomUUID();
  const timestamp = nowIso();
  const storedPhone = normalizePhoneForStorage(input.phone);
  const finalTags = normalizeTagList(input.tags, storedPhone);

  db.prepare(
    `
      INSERT INTO contacts (
        id, name, phone, cpf, email, instagram, procedure_status, last_attendant, notes,
        status, last_interaction_at, last_outgoing_at, last_incoming_at, last_procedure_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    id,
    input.name.trim(),
    storedPhone,
    normalizeNullable(input.cpf),
    normalizeNullable(input.email),
    normalizeNullable(input.instagram),
    input.procedureStatus,
    normalizeNullable(input.lastAttendant),
    normalizeNullable(input.notes),
    input.status,
    input.lastInteractionAt ?? null,
    null,
    null,
    input.lastProcedureAt ?? null,
    timestamp,
    timestamp
  );

  syncPrimaryContactChannels(id, {
    whatsapp: storedPhone,
    instagram: input.instagram
  });
  replaceContactTags(id, finalTags);
  const created = getContactById(id);
  if (created) {
    recordContactHistory(id, {
      field: "contact.created",
      label: "Contato criado",
      previousValue: null,
      nextValue: created.name || created.phone || created.instagram || id,
      source,
      createdAt: timestamp
    });
    recordAuditLog({
      entityType: "contact",
      entityId: id,
      action: "contact.created",
      contactId: id,
      metadata: {
        source,
        whatsapp: storedPhone,
        instagram: input.instagram
      },
      createdAt: timestamp
    });
  }

  return created;
}

export function createAssistedContact(
  input: ContactInput & {
    syncWhatsAppChannel?: boolean;
  },
  source = "instagram-assisted"
) {
  const db = getDb();
  const id = randomUUID();
  const timestamp = nowIso();
  const storedPhone = normalizePhoneForStorage(input.phone);
  const syncWhatsAppChannel = input.syncWhatsAppChannel !== false && Boolean(normalizeWhatsAppValue(storedPhone));
  const finalTags = syncWhatsAppChannel ? normalizeTagList(input.tags, storedPhone) : normalizeTagList(input.tags);

  db.prepare(
    `
      INSERT INTO contacts (
        id, name, phone, cpf, email, instagram, procedure_status, last_attendant, notes,
        status, last_interaction_at, last_outgoing_at, last_incoming_at, last_procedure_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    id,
    input.name.trim(),
    storedPhone,
    normalizeNullable(input.cpf),
    normalizeNullable(input.email),
    normalizeNullable(input.instagram),
    input.procedureStatus,
    normalizeNullable(input.lastAttendant),
    normalizeNullable(input.notes),
    input.status,
    input.lastInteractionAt ?? null,
    null,
    null,
    input.lastProcedureAt ?? null,
    timestamp,
    timestamp
  );

  syncPrimaryContactChannels(id, {
    whatsapp: syncWhatsAppChannel ? storedPhone : null,
    instagram: input.instagram
  });
  replaceContactTags(id, finalTags);
  const created = getContactById(id);
  if (created) {
    recordContactHistory(id, {
      field: "contact.created",
      label: "Contato criado",
      previousValue: null,
      nextValue: created.name || created.phone || created.instagram || id,
      source,
      createdAt: timestamp
    });
    recordAuditLog({
      entityType: "contact",
      entityId: id,
      action: "contact.created",
      channel: input.instagram ? "instagram" : syncWhatsAppChannel ? "whatsapp" : null,
      contactId: id,
      metadata: {
        source,
        whatsapp: syncWhatsAppChannel ? storedPhone : null,
        instagram: input.instagram ?? null
      },
      createdAt: timestamp
    });
  }

  return created;
}

export function createAutoContact(input: { phone: string; title?: string | null }) {
  const db = getDb();
  const id = randomUUID();
  const timestamp = nowIso();
  const inferredInstagram = inferInstagramHandle(input.title ?? "");
  const normalizedName = normalizeAutoContactName(input.title ?? "");

  db.prepare(
    `
      INSERT INTO contacts (
        id, name, phone, cpf, email, instagram, procedure_status, last_attendant, notes,
        status, last_interaction_at, last_outgoing_at, last_incoming_at, last_procedure_at, created_at, updated_at
      ) VALUES (?, ?, ?, NULL, NULL, ?, 'unknown', NULL, NULL, 'novo', NULL, NULL, NULL, NULL, ?, ?)
    `
  ).run(id, normalizedName, input.phone.trim(), inferredInstagram, timestamp, timestamp);

  syncPrimaryContactChannels(id, {
    whatsapp: input.phone,
    instagram: inferredInstagram
  });
  replaceContactTags(id, [WHATSAPP_TAG_NAME]);
  recordContactHistory(id, {
    field: "contact.created",
    label: "Contato criado",
    previousValue: null,
    nextValue: normalizedName || input.phone,
    source: "whatsapp",
    createdAt: timestamp
  });
  recordAuditLog({
    entityType: "contact",
    entityId: id,
    action: "contact.auto_created",
    channel: "whatsapp",
    contactId: id,
    metadata: {
      phone: input.phone,
      title: input.title ?? null
    },
    createdAt: timestamp
  });

  return getContactById(id);
}

export function hydrateAutoContact(contactId: string, input: { title?: string | null }) {
  const db = getDb();
  const existing = getContactById(contactId);
  if (!existing) {
    return null;
  }

  const inferredInstagram = inferInstagramHandle(input.title ?? "");
  const normalizedName = normalizeAutoContactName(input.title ?? "");
  const nextName = existing.name.trim().length > 0 ? existing.name : normalizedName;
  const nextInstagram = existing.instagram ?? inferredInstagram;

  db.prepare(
    `
      UPDATE contacts
      SET name = ?, instagram = ?, updated_at = ?
      WHERE id = ?
    `
  ).run(nextName, nextInstagram, nowIso(), contactId);

  syncPrimaryContactChannels(contactId, {
    whatsapp: existing.phone,
    instagram: nextInstagram
  });
  const tagsBefore = getTagNamesForContact(contactId);
  replaceContactTags(contactId, normalizeTagList(tagsBefore, existing.phone));
  const updated = getContactById(contactId);
  if (updated) {
    recordContactChanges(existing, updated, "whatsapp");
    recordAuditLog({
      entityType: "contact",
      entityId: contactId,
      action: "contact.auto_hydrated",
      channel: "whatsapp",
      contactId,
      metadata: {
        previousName: existing.name,
        nextName: updated.name,
        previousInstagram: existing.instagram,
        nextInstagram: updated.instagram
      }
    });
  }

  return updated;
}

export function updateContact(contactId: string, input: ContactInput, source = "manual") {
  const db = getDb();
  const timestamp = nowIso();
  const existing = getContactById(contactId);
  if (!existing) {
    return null;
  }

  const storedPhone = normalizePhoneForStorage(input.phone);
  const finalTags = normalizeTagList(input.tags, storedPhone);

  db.prepare(
    `
      UPDATE contacts
      SET
        name = ?,
        phone = ?,
        cpf = ?,
        email = ?,
        instagram = ?,
        procedure_status = ?,
        last_attendant = ?,
        notes = ?,
        status = ?,
        last_interaction_at = ?,
        last_procedure_at = ?,
        updated_at = ?
      WHERE id = ?
    `
  ).run(
    input.name.trim(),
    storedPhone,
    normalizeNullable(input.cpf),
    normalizeNullable(input.email),
    normalizeNullable(input.instagram),
    input.procedureStatus,
    normalizeNullable(input.lastAttendant),
    normalizeNullable(input.notes),
    input.status,
    input.lastInteractionAt ?? null,
    input.lastProcedureAt ?? null,
    timestamp,
    contactId
  );

  syncPrimaryContactChannels(contactId, {
    whatsapp: storedPhone,
    instagram: input.instagram
  });
  replaceContactTags(contactId, finalTags);
  const updated = getContactById(contactId);
  if (updated) {
    recordContactChanges(existing, updated, source);
    recordAuditLog({
      entityType: "contact",
      entityId: contactId,
      action: "contact.updated",
      contactId,
      metadata: {
        source,
        phone: updated.phone,
        instagram: updated.instagram
      },
      createdAt: timestamp
    });
  }

  return updated;
}

export function updateAssistedContact(
  contactId: string,
  input: ContactInput & {
    syncWhatsAppChannel?: boolean;
  },
  source = "instagram-assisted"
) {
  const db = getDb();
  const timestamp = nowIso();
  const existing = getContactById(contactId);
  if (!existing) {
    return null;
  }

  const storedPhone = normalizePhoneForStorage(input.phone);
  const existingWhatsAppValue = normalizeWhatsAppValue(existing.phone) ? existing.phone : null;
  const nextCandidatePhone = storedPhone ?? existing.phone ?? null;
  const syncWhatsAppChannel =
    input.syncWhatsAppChannel === false
      ? Boolean(existingWhatsAppValue)
      : Boolean(normalizeWhatsAppValue(nextCandidatePhone)) && Boolean(String(nextCandidatePhone ?? "").trim());
  const whatsappValue = input.syncWhatsAppChannel === false ? existingWhatsAppValue : storedPhone ?? existingWhatsAppValue;
  const finalTags = syncWhatsAppChannel ? normalizeTagList(input.tags, whatsappValue) : normalizeTagList(input.tags);

  db.prepare(
    `
      UPDATE contacts
      SET
        name = ?,
        phone = ?,
        cpf = ?,
        email = ?,
        instagram = ?,
        procedure_status = ?,
        last_attendant = ?,
        notes = ?,
        status = ?,
        last_interaction_at = ?,
        last_procedure_at = ?,
        updated_at = ?
      WHERE id = ?
    `
  ).run(
    input.name.trim(),
    storedPhone,
    normalizeNullable(input.cpf),
    normalizeNullable(input.email),
    normalizeNullable(input.instagram),
    input.procedureStatus,
    normalizeNullable(input.lastAttendant),
    normalizeNullable(input.notes),
    input.status,
    input.lastInteractionAt ?? null,
    input.lastProcedureAt ?? null,
    timestamp,
    contactId
  );

  syncPrimaryContactChannels(contactId, {
    whatsapp: syncWhatsAppChannel ? whatsappValue : null,
    instagram: input.instagram
  });
  replaceContactTags(contactId, finalTags);
  const updated = getContactById(contactId);
  if (updated) {
    recordContactChanges(existing, updated, source);
    recordAuditLog({
      entityType: "contact",
      entityId: contactId,
      action: "contact.updated",
      channel: input.instagram ? "instagram" : syncWhatsAppChannel ? "whatsapp" : null,
      contactId,
      metadata: {
        source,
        phone: updated.phone,
        instagram: updated.instagram
      },
      createdAt: timestamp
    });
  }

  return updated;
}

export function deleteContact(contactId: string) {
  const db = getDb();
  db.prepare("UPDATE contacts SET deleted_at = ?, updated_at = ? WHERE id = ?").run(nowIso(), nowIso(), contactId);
}

export function touchContactTimestamps(
  contactId: string,
  input: {
    lastInteractionAt?: string | null;
    lastOutgoingAt?: string | null;
    lastIncomingAt?: string | null;
  }
) {
  const db = getDb();
  const timestamp = nowIso();
  db.prepare(
    `
      UPDATE contacts
      SET
        last_interaction_at = COALESCE(?, last_interaction_at),
        last_outgoing_at = COALESCE(?, last_outgoing_at),
        last_incoming_at = COALESCE(?, last_incoming_at),
        updated_at = ?
      WHERE id = ?
    `
  ).run(input.lastInteractionAt ?? null, input.lastOutgoingAt ?? null, input.lastIncomingAt ?? null, timestamp, contactId);
}

export function applyTagToContact(contactId: string, tagName: string, source = "automation") {
  const db = getDb();
  const before = getContactById(contactId);
  const tag = ensureTag(tagName, {
    type: normalizeTagName(tagName) === WHATSAPP_TAG_NAME ? "canal" : "manual",
    active: true
  });
  db.prepare("INSERT OR IGNORE INTO contact_tags (contact_id, tag_id, created_at) VALUES (?, ?, ?)").run(contactId, tag.id, nowIso());
  const after = getContactById(contactId);
  if (before && after) {
    recordContactChanges(before, after, source);
    recordAuditLog({
      entityType: "contact",
      entityId: contactId,
      action: "contact.tag_added",
      contactId,
      metadata: {
        source,
        tagName
      }
    });
  }
}

export function removeTagFromContact(contactId: string, tagName: string, source = "automation") {
  const db = getDb();
  const before = getContactById(contactId);
  db.prepare(
    `
      DELETE FROM contact_tags
      WHERE contact_id = ?
        AND tag_id IN (SELECT id FROM tags WHERE normalized_name = ?)
    `
  ).run(contactId, normalizeTagName(tagName));
  const after = getContactById(contactId);
  if (before && after) {
    recordContactChanges(before, after, source);
    recordAuditLog({
      entityType: "contact",
      entityId: contactId,
      action: "contact.tag_removed",
      contactId,
      metadata: {
        source,
        tagName
      }
    });
  }
}

export function listContactsForAutomationEvaluation() {
  const db = getDb();
  const rows = db
    .prepare(
      `${baseContactQuery("WHERE c.deleted_at IS NULL")}
       ORDER BY COALESCE(c.last_interaction_at, c.updated_at, c.created_at) DESC`
    )
    .all() as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    ...mapContact(row),
    lastOutgoingAt: (row.last_outgoing_at as string | null) ?? null,
    lastIncomingAt: (row.last_incoming_at as string | null) ?? null,
    lastAutomationAt: (row.last_automation_at as string | null) ?? null
  }));
}
