import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { getDb } from "../db/connection.js";
import {
  createContact,
  getContactById,
  getContactByPhone,
  updateContact,
  updateContactInstagramSignals
} from "../repositories/contact-repository.js";
import { findContactIdByChannel } from "../repositories/contact-channel-repository.js";
import type { ContactInput, ContactRecord } from "../types/domain.js";
import { looksLikeValidWhatsAppCandidate, normalizeBrazilianPhone, normalizeInstagramHandle } from "../utils/phone.js";
import { normalizeWhatsAppValue } from "../utils/channels.js";
import { isValidCpf, normalizeCpf } from "../utils/cpf.js";

type InstagramMessageEntry = {
  sender_name?: string;
  timestamp_ms?: number;
  content?: string;
};

type InstagramMessageFile = {
  participants?: Array<{ name?: string }>;
  messages?: InstagramMessageEntry[];
  title?: string;
};

export type InstagramConversationMessageSnapshot = {
  senderName: string;
  timestampMs: number | null;
  content: string;
  direction: "incoming" | "outgoing";
};

export type InstagramConversationThreadSnapshot = {
  threadKey: string;
  threadDirName: string;
  instagramHandle: string | null;
  title: string;
  participants: string[];
  messages: InstagramConversationMessageSnapshot[];
};

export type InstagramConversationArchiveSnapshot = {
  zipPath: string;
  ownAliases: string[];
  threads: InstagramConversationThreadSnapshot[];
};

type FollowerFileEntry = {
  title?: string;
  string_list_data?: Array<{
    href?: string;
    value?: string;
    timestamp?: number;
  }>;
};

type FollowingFile = {
  relationships_following?: FollowerFileEntry[];
};

type ThreadGroup = {
  threadKey: string;
  threadDirName: string;
  filePaths: string[];
};

type ImportThreadResult = "created" | "updated" | "unchanged" | "skipped" | "conflict";

type ImportConflict = {
  instagram: string;
  phone: string;
  instagramContactId: string;
  phoneContactId: string;
};

type ResolvedContactName = {
  source: "whatsapp" | "imported" | "phone" | "blank";
  value: string;
};

type UpsertImportedProfileResult = {
  result: ImportThreadResult;
  whatsappCsvMatched: boolean;
  appliedNameSource: ResolvedContactName["source"] | null;
  nameChanged: boolean;
};

type RelationshipSnapshot = {
  followers: Map<string, number>;
  following: Map<string, number>;
};

type ExtractedInstagramExport = {
  extractionDir: string;
  extractedFiles: string[];
  messageFiles: string[];
  followerFiles: string[];
  followingFiles: string[];
};

type ThreadAnalysis = {
  latestInteractionAt: string | null;
  phone: string | null;
  threadTitle: string;
  participants: string[];
  incomingMessagesCount: number;
  cpf: string | null;
  email: string | null;
  fullName: string | null;
};

type WhatsAppCsvContact = {
  normalizedPhone: string;
  savedName: string;
  publicName: string;
  preferredName: string;
  isBusiness: boolean;
};

export type WhatsAppCsvLookup = {
  csvPath: string;
  totalRows: number;
  contactsByPhone: Map<string, WhatsAppCsvContact>;
};

type WhatsAppConversationCandidate = {
  phone: string;
  name: string;
  timestamp: number;
};

type RankedTextCandidate = {
  value: string;
  score: number;
  occurrences: number;
  latestTimestampMs: number;
};

export type WhatsAppCsvImportSummary = {
  csvPath: string;
  totalRows: number;
  uniquePhones: number;
  created: number;
  updated: number;
  unchanged: number;
  matchedExistingContacts: number;
  matchedWhatsAppConversations: number;
  whatsappConversationNamesApplied: number;
  csvNamesApplied: number;
  phoneNamesApplied: number;
};

export type WhatsAppMessageEnrichmentSummary = {
  scannedMessages: number;
  matchedContacts: number;
  contactsWithNameCandidates: number;
  updatedContacts: number;
  namesApplied: number;
  highConfidenceNamesApplied: number;
  cpfsApplied: number;
  emailsApplied: number;
};

export type InstagramContactImportSummary = {
  zipPath: string;
  extractedJsonFiles: number;
  hasMessageSnapshot: boolean;
  hasRelationshipSnapshot: boolean;
  processedThreads: number;
  processedFollowers: number;
  processedFollowing: number;
  created: number;
  updated: number;
  normalizedNames: number;
  unchanged: number;
  skippedNoHandle: number;
  skippedInvalidJson: number;
  skippedNoSupportedData: number;
  conflicts: number;
  phonesDiscovered: number;
  currentFollowers: number;
  currentFollowing: number;
  relationshipSignalsUpdated: number;
  messageSignalsUpdated: number;
  whatsappCsvRows: number;
  whatsappCsvMatches: number;
  whatsappCsvNamesApplied: number;
  namesFromPhones: number;
  ownAliases: string[];
  conflictSamples: ImportConflict[];
};

const PERSON_NAME_KEYWORDS_BLOCKLIST = [
  "academia",
  "advocacia",
  "atacado",
  "auto",
  "barbearia",
  "boutique",
  "clinica",
  "clínica",
  "cliente",
  "clientes",
  "confeitaria",
  "construtora",
  "cosmeticos",
  "cosméticos",
  "deus e amor",
  "deus é amor",
  "distribuidora",
  "empresa",
  "estetica",
  "estética",
  "farmacia",
  "farmácia",
  "igreja",
  "imoveis",
  "imóveis",
  "lashes",
  "loja",
  "make",
  "ministerio",
  "ministério",
  "mãe",
  "mae",
  "moda",
  "motos",
  "oficial",
  "pai",
  "salao",
  "salão",
  "store",
  "studio",
  "transportes",
  "turismo",
  "variedades"
] as const;

const MESSAGE_ENTRY_PATH_PATTERN = /(?:^|\/)(?:your_instagram_activity\/)?messages\/inbox\/.+\/message_\d+\.json$/i;
const FOLLOWERS_ENTRY_PATH_PATTERN = /(?:^|\/)(?:connections\/)?followers_and_following\/followers_\d+\.json$/i;
const FOLLOWING_ENTRY_PATH_PATTERN = /(?:^|\/)(?:connections\/)?followers_and_following\/following\.json$/i;
const MESSAGE_FILE_NAME_PATTERN = /^message_\d+\.json$/i;

function collapseWhitespace(input?: string | null) {
  let normalized = String(input ?? "").replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, "");

  if (/[ÃÂâ][\u0080-\u00BF]?/u.test(normalized)) {
    try {
      const repaired = Buffer.from(normalized, "latin1").toString("utf8");
      if (!repaired.includes("\uFFFD")) {
        normalized = repaired;
      }
    } catch {
      // Keep the original text when the heuristic repair fails.
    }
  }

  return normalized.replace(/\s+/g, " ").trim();
}

function normalizeCsvCell(input?: string | null) {
  return collapseWhitespace(input).replace(/^\uFEFF/, "");
}

function nameKey(input?: string | null) {
  return collapseWhitespace(input).toLocaleLowerCase("pt-BR");
}

function hasMojibake(input?: string | null) {
  return /[ÃÂâ][\u0080-\u00BF]?/u.test(String(input ?? ""));
}

function normalizeInstagramDisplayValue(input?: string | null) {
  const normalized = normalizeInstagramHandle(input);
  return normalized ? `@${normalized}` : null;
}

function looksLikePhoneLabel(input?: string | null) {
  const value = collapseWhitespace(input);
  const normalizedPhone = normalizeWhatsAppValue(value);
  if (!normalizedPhone) {
    return false;
  }

  const digits = value.replace(/\D/g, "");
  return digits.length >= 8 && digits.length === normalizedPhone.length;
}

function titleCaseName(input?: string | null) {
  const value = collapseWhitespace(input);
  if (!value) {
    return "";
  }

  return value
    .split(" ")
    .map((word, index) => {
      if (!word) {
        return "";
      }

      if (/^\d+$/.test(word)) {
        return word;
      }

      const lower = word.toLocaleLowerCase("pt-BR");
      if (index > 0 && ["da", "das", "de", "do", "dos", "e"].includes(lower)) {
        return lower;
      }

      return `${lower.slice(0, 1).toLocaleUpperCase("pt-BR")}${lower.slice(1)}`;
    })
    .join(" ");
}

function normalizePersonName(input?: string | null, instagram?: string | null) {
  const normalized = titleCaseName(input);
  return looksLikePersonName(normalized, instagram) ? normalized : "";
}

function normalizeEmailValue(input?: string | null) {
  const normalized = collapseWhitespace(input).toLocaleLowerCase("en-US");
  if (!normalized) {
    return null;
  }

  return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(normalized) ? normalized : null;
}

function normalizeWhatsAppConversationName(input?: string | null) {
  const normalized = titleCaseName(input);
  const lower = normalized.toLocaleLowerCase("pt-BR");
  if (!normalized || looksLikePhoneLabel(normalized)) {
    return "";
  }

  if (["meta ai", "whatsapp", "whatsapp business", "archived", "arquivadas"].includes(lower)) {
    return "";
  }

  return normalized;
}

function extractCpfCandidatesFromText(text: string) {
  const matches = text.match(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g) ?? [];
  const candidates = new Set<string>();

  for (const match of matches) {
    const normalized = normalizeCpf(match);
    if (normalized && isValidCpf(normalized)) {
      candidates.add(normalized);
    }
  }

  return [...candidates];
}

function extractEmailCandidatesFromText(text: string) {
  const matches = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? [];
  const candidates = new Set<string>();

  for (const match of matches) {
    const normalized = normalizeEmailValue(match);
    if (normalized) {
      candidates.add(normalized);
    }
  }

  return [...candidates];
}

function extractNameCandidatesFromText(text: string, instagram?: string | null) {
  const normalizedText = collapseWhitespace(text);
  if (!normalizedText) {
    return [];
  }

  const hasExplicitCue = /\b(?:nome(?:\s+completo)?|me chamo|meu nome|sou|pode me chamar)\b/i.test(normalizedText);
  const patterns = [
    /(?:nome(?:\s+completo)?\s*[:\-]\s*)([\p{L}'`-]+(?:\s+[\p{L}'`-]+){0,4})/iu,
    /(?:meu nome(?:\s+completo)?\s+[ée]\s+)([\p{L}'`-]+(?:\s+[\p{L}'`-]+){0,4})/iu,
    /(?:me chamo\s+)([\p{L}'`-]+(?:\s+[\p{L}'`-]+){0,4})/iu,
    /(?:sou\s+)([\p{L}'`-]+(?:\s+[\p{L}'`-]+){0,4})/iu,
    /(?:pode me chamar de\s+)([\p{L}'`-]+(?:\s+[\p{L}'`-]+){0,4})/iu
  ];

  const candidates = new Set<string>();
  for (const pattern of patterns) {
    const match = normalizedText.match(pattern);
    const candidate = normalizePersonName(match?.[1] ?? "", instagram);
    if (candidate) {
      candidates.add(candidate);
    }
  }

  if (candidates.size === 0 && !hasExplicitCue) {
    const directCandidate = normalizePersonName(normalizedText, instagram);
    if (directCandidate && normalizedText.split(" ").length >= 2) {
      candidates.add(directCandidate);
    }
  }

  return [...candidates];
}

function listWhatsAppConversationCandidates() {
  const db = getDb();
  const rows = db
    .prepare(
      `
        SELECT
          conv.title,
          conv.external_thread_id,
          conv.wa_chat_id,
          conv.last_message_at,
          conv.updated_at,
          c.phone AS contact_phone
        FROM conversations conv
        LEFT JOIN contacts c ON c.id = conv.contact_id
        WHERE conv.channel = 'whatsapp'
      `
    )
    .all() as Array<{
      title: string | null;
      external_thread_id: string | null;
      wa_chat_id: string | null;
      last_message_at: string | null;
      updated_at: string | null;
      contact_phone: string | null;
    }>;

  const candidates = new Map<string, WhatsAppConversationCandidate>();

  for (const row of rows) {
    const phone =
      normalizeWhatsAppValue(row.contact_phone) ??
      normalizeWhatsAppValue(row.external_thread_id) ??
      normalizeWhatsAppValue(row.wa_chat_id) ??
      normalizeWhatsAppValue(row.title);
    if (!phone) {
      continue;
    }

    const name = normalizeWhatsAppConversationName(row.title);
    if (!name) {
      continue;
    }

    const timestamp = Date.parse(row.last_message_at ?? row.updated_at ?? "") || 0;
    const current = candidates.get(phone);
    if (!current || timestamp >= current.timestamp) {
      candidates.set(phone, {
        phone,
        name,
        timestamp
      });
    }
  }

  return candidates;
}

function upsertRankedTextCandidate(target: Map<string, RankedTextCandidate>, value: string, score: number, timestampMs: number) {
  const current = target.get(value);
  if (current) {
    current.score = Math.max(current.score, score);
    current.occurrences += 1;
    current.latestTimestampMs = Math.max(current.latestTimestampMs, timestampMs);
    return;
  }

  target.set(value, {
    value,
    score,
    occurrences: 1,
    latestTimestampMs: timestampMs
  });
}

function pickBestRankedTextCandidate(target: Map<string, RankedTextCandidate>) {
  return (
    [...target.values()].sort(
      (left, right) =>
        right.score - left.score || right.occurrences - left.occurrences || right.latestTimestampMs - left.latestTimestampMs
    )[0] ?? null
  );
}

function resolveUpdatedMessageDerivedName(
  existing: ContactRecord,
  input: {
    instagram?: string | null;
    candidateName: string;
    confidenceScore: number;
  }
) {
  const candidateName = normalizePersonName(input.candidateName, input.instagram);
  if (!candidateName) {
    return collapseWhitespace(existing.name);
  }

  const currentName = collapseWhitespace(existing.name);
  if (!currentName) {
    return candidateName;
  }

  if (hasMojibake(existing.name)) {
    return candidateName;
  }

  if (looksLikePhoneLabel(currentName) || isInstagramHandleLabel(currentName, input.instagram)) {
    return candidateName;
  }

  const normalizedCurrentPersonName = normalizePersonName(currentName, input.instagram);
  if (!normalizedCurrentPersonName) {
    return candidateName;
  }

  if (nameKey(normalizedCurrentPersonName) === nameKey(candidateName)) {
    return candidateName;
  }

  return input.confidenceScore >= 5 ? candidateName : normalizedCurrentPersonName;
}

function parseCsvRow(rawRow: string) {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < rawRow.length; index += 1) {
    const char = rawRow[index];

    if (char === "\"") {
      const next = rawRow[index + 1];
      if (inQuotes && next === "\"") {
        current += "\"";
        index += 1;
        continue;
      }

      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells.map((cell) => normalizeCsvCell(cell));
}

function parseCsvRecords(raw: string) {
  const rows: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    const next = raw[index + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        current += "\"";
        index += 1;
        continue;
      }

      inQuotes = !inQuotes;
      current += char;
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }

      if (current.trim()) {
        rows.push(current);
      }

      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    rows.push(current);
  }

  const [headerRow, ...dataRows] = rows;
  if (!headerRow) {
    return [];
  }

  const headers = parseCsvRow(headerRow);
  return dataRows
    .map((row) => parseCsvRow(row))
    .filter((row) => row.some((cell) => cell.length > 0))
    .map((cells) =>
      Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])) as Record<string, string>
    );
}

function chooseWhatsAppCsvName(record: Record<string, string>, normalizedPhone: string) {
  const savedName = normalizeCsvCell(record.saved_name);
  const publicName = normalizeCsvCell(record.public_name);
  const normalizedSavedName = normalizePersonName(savedName);
  const normalizedPublicName = normalizePersonName(publicName);

  if (normalizedSavedName) {
    return {
      savedName,
      publicName,
      preferredName: normalizedSavedName
    };
  }

  if (normalizedPublicName) {
    return {
      savedName,
      publicName,
      preferredName: normalizedPublicName
    };
  }

  return {
    savedName,
    publicName,
    preferredName: normalizedPhone
  };
}

export function loadWhatsAppCsvLookup(csvPath?: string | null): WhatsAppCsvLookup | null {
  const normalizedPath = collapseWhitespace(csvPath);
  if (!normalizedPath) {
    return null;
  }

  const resolvedPath = path.resolve(normalizedPath);
  if (!existsSync(resolvedPath)) {
    return null;
  }

  const raw = readFileSync(resolvedPath, "utf8");
  const rows = parseCsvRecords(raw);
  const contactsByPhone = new Map<string, WhatsAppCsvContact>();

  for (const row of rows) {
    const normalizedPhone = normalizeWhatsAppValue(row.phone_number ?? row.formatted_phone ?? "");
    if (!normalizedPhone) {
      continue;
    }

    const chosenName = chooseWhatsAppCsvName(row, normalizedPhone);
    const current = contactsByPhone.get(normalizedPhone);
    if (current && current.preferredName !== normalizedPhone && chosenName.preferredName === normalizedPhone) {
      continue;
    }

    contactsByPhone.set(normalizedPhone, {
      normalizedPhone,
      savedName: chosenName.savedName,
      publicName: chosenName.publicName,
      preferredName: chosenName.preferredName,
      isBusiness: /true/i.test(normalizeCsvCell(row.is_business))
    });
  }

  return {
    csvPath: resolvedPath,
    totalRows: rows.length,
    contactsByPhone
  };
}

function chooseWhatsAppPreferredName(input: {
  phone: string;
  csvName?: string | null;
  conversationName?: string | null;
  instagram?: string | null;
}) {
  const conversationName = normalizeWhatsAppConversationName(input.conversationName);
  if (conversationName) {
    return {
      source: "whatsapp" as const,
      value: conversationName
    };
  }

  const csvName = normalizePersonName(input.csvName, input.instagram);
  if (csvName) {
    return {
      source: "whatsapp" as const,
      value: csvName
    };
  }

  return {
    source: "phone" as const,
    value: input.phone
  };
}

function resolveUpdatedWhatsAppName(existing: ContactRecord, input: { phone: string; preferredName: { source: "whatsapp" | "phone"; value: string } }) {
  const currentName = collapseWhitespace(existing.name);
  if (!currentName) {
    return input.preferredName.value;
  }

  if (hasMojibake(existing.name)) {
    return input.preferredName.value || currentName;
  }

  if (currentName === input.phone && input.preferredName.value !== input.phone) {
    return input.preferredName.value;
  }

  if (looksLikePhoneLabel(currentName) && input.preferredName.value !== input.phone) {
    return input.preferredName.value;
  }

  const normalizedCurrentPersonName = normalizePersonName(currentName);
  if (normalizedCurrentPersonName) {
    return normalizedCurrentPersonName;
  }

  if (input.preferredName.value === input.phone) {
    return input.phone;
  }

  return input.preferredName.value;
}

export function importWhatsAppCsvContacts(lookup: WhatsAppCsvLookup | null): WhatsAppCsvImportSummary | null {
  if (!lookup) {
    return null;
  }

  const db = getDb();
  const conversationCandidates = listWhatsAppConversationCandidates();
  const contactIdsByPhone = listContactIdsByNormalizedPhone();
  const contactCache = new Map<string, ContactRecord>();
  const resolveExistingContact = (contactId: string | null) => {
    if (!contactId) {
      return null;
    }

    const cached = contactCache.get(contactId);
    if (cached) {
      return cached;
    }

    const contact = getContactById(contactId);
    if (contact) {
      contactCache.set(contactId, contact);
    }

    return contact;
  };
  const summary: WhatsAppCsvImportSummary = {
    csvPath: lookup.csvPath,
    totalRows: lookup.totalRows,
    uniquePhones: lookup.contactsByPhone.size,
    created: 0,
    updated: 0,
    unchanged: 0,
    matchedExistingContacts: 0,
    matchedWhatsAppConversations: 0,
    whatsappConversationNamesApplied: 0,
    csvNamesApplied: 0,
    phoneNamesApplied: 0
  };

  const transaction = db.transaction(() => {
    for (const [phone, csvContact] of lookup.contactsByPhone.entries()) {
      const existing = resolveExistingContact(contactIdsByPhone.get(phone) ?? null);
      if (existing) {
        summary.matchedExistingContacts += 1;
      }

      const conversationCandidate = conversationCandidates.get(phone) ?? null;
      if (conversationCandidate) {
        summary.matchedWhatsAppConversations += 1;
      }

      const preferredName = chooseWhatsAppPreferredName({
        phone,
        csvName: csvContact.preferredName,
        conversationName: conversationCandidate?.name ?? null,
        instagram: existing?.instagram ?? null
      });

      if (!existing) {
        const created = createContact(
          {
            name: preferredName.value,
            phone,
            cpf: null,
            email: null,
            instagram: null,
            procedureStatus: "unknown",
            lastAttendant: null,
            notes: null,
            status: "novo",
            tags: [],
            lastInteractionAt: null,
            lastProcedureAt: null
          },
          "whatsapp-csv-import"
        );

        if (!created) {
          summary.unchanged += 1;
          continue;
        }

        contactIdsByPhone.set(phone, created.id);
        contactCache.set(created.id, created);
        summary.created += 1;
        if (preferredName.source === "whatsapp" && conversationCandidate) {
          summary.whatsappConversationNamesApplied += 1;
        } else if (preferredName.source === "whatsapp") {
          summary.csvNamesApplied += 1;
        } else {
          summary.phoneNamesApplied += 1;
        }
        continue;
      }

      const nextName = resolveUpdatedWhatsAppName(existing, {
        phone,
        preferredName
      });

      if (nextName === existing.name) {
        summary.unchanged += 1;
        continue;
      }

      const updated = updateContact(
        existing.id,
        {
          ...existing,
          name: nextName,
          tags: existing.tags
        },
        "whatsapp-csv-import"
      );

      if (!updated) {
        summary.unchanged += 1;
        continue;
      }

      contactCache.set(updated.id, updated);
      summary.updated += 1;
      if (preferredName.source === "whatsapp" && conversationCandidate) {
        summary.whatsappConversationNamesApplied += 1;
      } else if (preferredName.source === "whatsapp") {
        summary.csvNamesApplied += 1;
      } else {
        summary.phoneNamesApplied += 1;
      }
    }
  });

  transaction.immediate();

  return summary;
}

export function enrichContactsFromWhatsAppConversations() {
  const conversationCandidates = listWhatsAppConversationCandidates();
  let matchedContacts = 0;
  let updatedContacts = 0;
  let phoneFallbacks = 0;

  for (const [phone, candidate] of conversationCandidates.entries()) {
    const contact = getContactByPhone(phone);
    if (!contact) {
      continue;
    }

    matchedContacts += 1;
    const preferredName = chooseWhatsAppPreferredName({
      phone,
      conversationName: candidate.name,
      csvName: null,
      instagram: contact.instagram
    });
    const nextName = resolveUpdatedWhatsAppName(contact, {
      phone,
      preferredName
    });

    if (nextName === contact.name) {
      continue;
    }

    const updated = updateContact(
      contact.id,
      {
        ...contact,
        name: nextName,
        tags: contact.tags
      },
      "whatsapp-conversation-enrichment"
    );

    if (!updated) {
      continue;
    }

    updatedContacts += 1;
    if (preferredName.value === phone) {
      phoneFallbacks += 1;
    }
  }

  return {
    matchedContacts,
    updatedContacts,
    phoneFallbacks
  };
}

export function enrichContactsFromWhatsAppMessageBodies(): WhatsAppMessageEnrichmentSummary {
  const db = getDb();
  const rows = db
    .prepare(
      `
        SELECT
          COALESCE(m.contact_id, conv.contact_id) AS resolved_contact_id,
          c.instagram,
          m.body,
          COALESCE(m.sent_at, m.created_at, conv.last_message_at, conv.updated_at) AS timestamp
        FROM messages m
        INNER JOIN conversations conv ON conv.id = m.conversation_id
        INNER JOIN contacts c ON c.id = COALESCE(m.contact_id, conv.contact_id)
        WHERE conv.channel = 'whatsapp'
          AND m.direction = 'incoming'
          AND trim(IFNULL(m.body, '')) <> ''
          AND COALESCE(m.contact_id, conv.contact_id) IS NOT NULL
          AND c.deleted_at IS NULL
      `
    )
    .all() as Array<{
      resolved_contact_id: string;
      instagram: string | null;
      body: string;
      timestamp: string | null;
    }>;

  const summary: WhatsAppMessageEnrichmentSummary = {
    scannedMessages: 0,
    matchedContacts: 0,
    contactsWithNameCandidates: 0,
    updatedContacts: 0,
    namesApplied: 0,
    highConfidenceNamesApplied: 0,
    cpfsApplied: 0,
    emailsApplied: 0
  };

  const candidatesByContact = new Map<
    string,
    {
      instagram: string | null;
      names: Map<string, RankedTextCandidate>;
      cpfs: Map<string, RankedTextCandidate>;
      emails: Map<string, RankedTextCandidate>;
    }
  >();

  for (const row of rows) {
    const content = collapseWhitespace(row.body);
    if (!content) {
      continue;
    }

    summary.scannedMessages += 1;
    const timestampMs = Date.parse(row.timestamp ?? "") || 0;
    const candidateGroup =
      candidatesByContact.get(row.resolved_contact_id) ??
      {
        instagram: row.instagram,
        names: new Map<string, RankedTextCandidate>(),
        cpfs: new Map<string, RankedTextCandidate>(),
        emails: new Map<string, RankedTextCandidate>()
      };

    const hasExplicitNameCue = /\b(?:nome(?:\s+completo)?|me chamo|meu nome|sou|pode me chamar)\b/i.test(content);
    const looksLikeBareName = /^[\p{L}'`-]+(?:\s+[\p{L}'`-]+){1,4}$/u.test(content);
    const nameScoreBase = hasExplicitNameCue ? 6 : looksLikeBareName ? 3 : 1;
    for (const fullName of extractNameCandidatesFromText(content, row.instagram)) {
      upsertRankedTextCandidate(candidateGroup.names, fullName, nameScoreBase, timestampMs);
    }

    const cpfScoreBase = /\bcpf\b/i.test(content) ? 5 : 2;
    for (const cpf of extractCpfCandidatesFromText(content)) {
      upsertRankedTextCandidate(candidateGroup.cpfs, cpf, cpfScoreBase, timestampMs);
    }

    const emailScoreBase = /\b(?:email|e-mail)\b/i.test(content) ? 5 : 2;
    for (const email of extractEmailCandidatesFromText(content)) {
      upsertRankedTextCandidate(candidateGroup.emails, email, emailScoreBase, timestampMs);
    }

    candidatesByContact.set(row.resolved_contact_id, candidateGroup);
  }

  summary.matchedContacts = candidatesByContact.size;

  for (const [contactId, candidateGroup] of candidatesByContact.entries()) {
    const contact = getContactById(contactId);
    if (!contact) {
      continue;
    }

    const bestName = pickBestRankedTextCandidate(candidateGroup.names);
    const bestCpf = pickBestRankedTextCandidate(candidateGroup.cpfs);
    const bestEmail = pickBestRankedTextCandidate(candidateGroup.emails);

    if (bestName) {
      summary.contactsWithNameCandidates += 1;
    }

    const nextName = bestName
      ? resolveUpdatedMessageDerivedName(contact, {
          instagram: contact.instagram ?? candidateGroup.instagram,
          candidateName: bestName.value,
          confidenceScore: bestName.score
        })
      : contact.name;
    const currentCpf = normalizeCpf(contact.cpf) ?? null;
    const nextCpf = currentCpf ?? (bestCpf?.value ?? null);
    const currentEmail = normalizeEmailValue(contact.email) ?? null;
    const nextEmail = currentEmail ?? (bestEmail?.value ?? null);

    const nameChanged = nextName !== contact.name;
    const cpfChanged = currentCpf !== nextCpf;
    const emailChanged = currentEmail !== nextEmail;
    if (!nameChanged && !cpfChanged && !emailChanged) {
      continue;
    }

    const updated = updateContact(
      contact.id,
      {
        ...contact,
        name: nextName,
        cpf: nextCpf,
        email: nextEmail,
        tags: contact.tags
      },
      "whatsapp-message-enrichment"
    );

    if (!updated) {
      continue;
    }

    summary.updatedContacts += 1;
    if (nameChanged) {
      summary.namesApplied += 1;
      if ((bestName?.score ?? 0) >= 5) {
        summary.highConfidenceNamesApplied += 1;
      }
    }
    if (cpfChanged) {
      summary.cpfsApplied += 1;
    }
    if (emailChanged) {
      summary.emailsApplied += 1;
    }
  }

  return summary;
}

function parseMessageOrder(filePath: string) {
  const match = path.basename(filePath).match(/^message_(\d+)\.json$/i);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function readInstagramMessageFile(filePath: string) {
  const raw = readFileSync(filePath, "utf8");
  return JSON.parse(raw) as InstagramMessageFile;
}

function listZipEntries(zipPath: string) {
  const output = execFileSync("unzip", ["-Z1", zipPath], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 512 * 1024 * 1024
  });

  return output
    .split(/\r?\n/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isReadableZipArchive(filePath: string) {
  try {
    const output = execFileSync("file", ["-b", filePath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 1024 * 1024
    });
    return /zip archive data/i.test(output);
  } catch {
    return false;
  }
}

function extractInstagramJsons(zipPath: string): ExtractedInstagramExport {
  if (!existsSync(zipPath)) {
    throw new Error(`Arquivo não encontrado: ${zipPath}`);
  }

  const extractionDir = mkdtempSync(path.join(tmpdir(), "nuoma-ig-import-"));
  const selectedEntries = listZipEntries(zipPath).filter(
    (entry) => MESSAGE_ENTRY_PATH_PATTERN.test(entry) || FOLLOWERS_ENTRY_PATH_PATTERN.test(entry) || FOLLOWING_ENTRY_PATH_PATTERN.test(entry)
  );

  if (selectedEntries.length > 0) {
    execFileSync("unzip", ["-oq", zipPath, ...selectedEntries, "-d", extractionDir], {
      stdio: "pipe"
    });
  }

  const extractedFiles = selectedEntries.map((entry) => path.join(extractionDir, entry)).filter((filePath) => existsSync(filePath));

  return {
    extractionDir,
    extractedFiles,
    messageFiles: extractedFiles.filter((filePath) => MESSAGE_ENTRY_PATH_PATTERN.test(filePath)),
    followerFiles: extractedFiles.filter((filePath) => FOLLOWERS_ENTRY_PATH_PATTERN.test(filePath)),
    followingFiles: extractedFiles.filter((filePath) => FOLLOWING_ENTRY_PATH_PATTERN.test(filePath))
  };
}

function groupThreadFiles(messageFiles: string[]) {
  const grouped = new Map<string, ThreadGroup>();
  const files = [...messageFiles]
    .filter((filePath) => MESSAGE_FILE_NAME_PATTERN.test(path.basename(filePath)))
    .sort((left, right) => {
      if (path.dirname(left) === path.dirname(right)) {
        return parseMessageOrder(left) - parseMessageOrder(right);
      }

      return left.localeCompare(right, "en");
    });

  for (const filePath of files) {
    const threadKey = path.dirname(filePath);
    const current = grouped.get(threadKey);
    if (current) {
      current.filePaths.push(filePath);
      continue;
    }

    grouped.set(threadKey, {
      threadKey,
      threadDirName: path.basename(path.dirname(filePath)),
      filePaths: [filePath]
    });
  }

  return [...grouped.values()];
}

function inferOwnAliases(threads: ThreadGroup[]) {
  const counts = new Map<string, { name: string; count: number }>();

  for (const thread of threads) {
    try {
      const file = readInstagramMessageFile(thread.filePaths[0]);
      const participants = new Set((file.participants ?? []).map((participant) => collapseWhitespace(participant.name)).filter(Boolean));

      for (const participantName of participants) {
        const key = nameKey(participantName);
        const current = counts.get(key);
        if (current) {
          current.count += 1;
          continue;
        }

        counts.set(key, {
          name: participantName,
          count: 1
        });
      }
    } catch {
      // Invalid files are handled later in the import pass.
    }
  }

  const minimumCount = Math.max(5, Math.ceil(threads.length * 0.05));
  const aliases = [...counts.values()]
    .filter((entry) => entry.count >= minimumCount || /nuoma/i.test(entry.name))
    .sort((left, right) => right.count - left.count)
    .map((entry) => entry.name);

  if (aliases.length > 0) {
    return aliases;
  }

  const fallback = [...counts.values()].sort((left, right) => right.count - left.count)[0];
  return fallback ? [fallback.name] : [];
}

function deriveThreadHandle(threadDirName: string) {
  const withoutSuffix = threadDirName.replace(/_\d+$/, "");
  const normalized = normalizeInstagramHandle(withoutSuffix);
  return normalized ? `@${normalized}` : null;
}

function looksLikePersonName(input: string, instagram?: string | null) {
  const value = collapseWhitespace(input);
  if (!value) {
    return false;
  }

  const normalizedInstagram = normalizeInstagramHandle(instagram);
  const compactName = value.toLocaleLowerCase("pt-BR").replace(/[\s._-]+/g, "");

  if (/@|https?:\/\/|www\.|\.com\b/i.test(value)) {
    return false;
  }

  if (/\d/.test(value) || value.length > 60) {
    return false;
  }

  if (/\s-\s/.test(value)) {
    return false;
  }

  const lower = value.toLocaleLowerCase("pt-BR");
  if (PERSON_NAME_KEYWORDS_BLOCKLIST.some((keyword) => lower.includes(keyword))) {
    return false;
  }

  const words = value.split(" ");
  if (words.length === 0 || words.length > 5) {
    return false;
  }

  if (normalizedInstagram && words.length === 1 && compactName === normalizedInstagram) {
    return false;
  }

  if (!words.every((word) => /[\p{L}]/u.test(word) && /^[\p{L}'`-]{1,30}$/u.test(word))) {
    return false;
  }

  if (words.length === 1) {
    return /^[\p{Lu}][\p{L}'`-]{1,29}$/u.test(words[0]);
  }

  const titleCaseWords = words.filter((word) => /^[\p{Lu}]/u.test(word)).length;
  return titleCaseWords >= Math.ceil(words.length / 2);
}

function chooseImportedName(input: {
  title: string;
  participants: string[];
  instagram: string | null;
  ownAliasKeys: Set<string>;
  messageFullName?: string | null;
}) {
  const participantCandidates = input.participants.filter((participant) => !input.ownAliasKeys.has(nameKey(participant)));
  const candidates = [input.messageFullName ?? "", input.title, ...participantCandidates].map(collapseWhitespace).filter(Boolean);

  for (const candidate of candidates) {
    const normalized = normalizePersonName(candidate, input.instagram);
    if (normalized) {
      return normalized;
    }
  }

  return "";
}

function isInstagramHandleLabel(input?: string | null, instagram?: string | null) {
  const value = collapseWhitespace(input);
  if (!value) {
    return false;
  }

  const normalizedValue = normalizeInstagramHandle(value);
  const normalizedInstagram = normalizeInstagramHandle(instagram);
  return Boolean(normalizedValue && normalizedInstagram && normalizedValue === normalizedInstagram);
}

function resolvePreferredContactName(input: {
  instagram: string | null;
  importedName?: string | null;
  whatsappImportedName?: string | null;
  phone?: string | null;
}): ResolvedContactName {
  const whatsappName = normalizePersonName(input.whatsappImportedName, input.instagram);
  if (whatsappName) {
    return {
      source: "whatsapp",
      value: whatsappName
    };
  }

  const importedName = normalizePersonName(input.importedName, input.instagram);
  if (importedName) {
    return {
      source: "imported",
      value: importedName
    };
  }

  const normalizedPhone = normalizeWhatsAppValue(input.phone);
  if (normalizedPhone) {
    return {
      source: "phone",
      value: normalizedPhone
    };
  }

  return {
    source: "blank",
    value: ""
  };
}

function extractPhoneCandidatesFromText(text: string) {
  const matches = text.match(/(?:\+?\d[\d\s().-]{7,}\d)/g) ?? [];
  const unique = new Map<string, { raw: string; score: number }>();
  const normalizedText = collapseWhitespace(text);

  for (const match of matches) {
    const normalizedPhone = normalizeBrazilianPhone(match);
    if (!normalizedPhone || !looksLikeValidWhatsAppCandidate(normalizedPhone)) {
      continue;
    }

    let score = 1;
    const rawDigits = match.replace(/\D/g, "").length;
    if (rawDigits >= 10 && rawDigits <= 13) {
      score += 2;
    }

    if (/\b(?:zap|whats|whatsapp|telefone|numero|número)\b/i.test(normalizedText)) {
      score += 1;
    }

    if (/^[^\d]*\+?\d[\d\s().-]{7,}\d[^\d]*$/i.test(normalizedText)) {
      score += 4;
    }

    const current = unique.get(normalizedPhone);
    if (!current || current.score < score) {
      unique.set(normalizedPhone, {
        raw: match,
        score
      });
    }
  }

  return unique;
}

function participantFrequencyMap(threads: ThreadGroup[]) {
  const frequencies = new Map<string, number>();

  for (const thread of threads) {
    try {
      const parsed = readInstagramMessageFile(thread.filePaths[0]);
      const participantKeys = new Set((parsed.participants ?? []).map((participant) => nameKey(participant.name)).filter(Boolean));

      for (const key of participantKeys) {
        frequencies.set(key, (frequencies.get(key) ?? 0) + 1);
      }
    } catch {
      // Invalid files are handled in the import loop.
    }
  }

  return frequencies;
}

function analyzeThread(thread: ThreadGroup, ownAliasKeys: Set<string>, participantFrequency: Map<string, number>): ThreadAnalysis {
  let latestTimestampMs: number | null = null;
  const candidates = new Map<string, { score: number; occurrences: number; latestTimestampMs: number }>();
  const cpfCandidates = new Map<string, { score: number; latestTimestampMs: number }>();
  const emailCandidates = new Map<string, { score: number; latestTimestampMs: number }>();
  const fullNameCandidates = new Map<string, { score: number; latestTimestampMs: number }>();
  let incomingMessagesCount = 0;

  let threadTitle = "";
  let participantNames: string[] = [];

  for (const filePath of thread.filePaths) {
    const parsed = readInstagramMessageFile(filePath);
    threadTitle = collapseWhitespace(parsed.title);
    participantNames = (parsed.participants ?? []).map((participant) => collapseWhitespace(participant.name)).filter(Boolean);

    const titleKey = nameKey(threadTitle);
    const contactParticipants = participantNames.filter((name) => !ownAliasKeys.has(nameKey(name)));
    let incomingSenderKeys = new Set(contactParticipants.map((name) => nameKey(name)));
    let canExtractIncomingPhones = incomingSenderKeys.size === 1;

    if (incomingSenderKeys.size === 0 && participantNames.length === 2) {
      const [left, right] = participantNames;
      const leftCount = participantFrequency.get(nameKey(left)) ?? 0;
      const rightCount = participantFrequency.get(nameKey(right)) ?? 0;
      incomingSenderKeys = new Set([nameKey(leftCount <= rightCount ? left : right)]);
      canExtractIncomingPhones = true;
    }

    if (incomingSenderKeys.size > 1 && titleKey) {
      const filtered = participantNames.filter((name) => nameKey(name) === titleKey);
      if (filtered.length === 1) {
        incomingSenderKeys = new Set([titleKey]);
        canExtractIncomingPhones = true;
      }
    }

    if (incomingSenderKeys.size !== 1) {
      canExtractIncomingPhones = false;
    }

    for (const message of parsed.messages ?? []) {
      const timestampMs = Number(message.timestamp_ms ?? 0);
      if (timestampMs > 0) {
        latestTimestampMs = latestTimestampMs == null ? timestampMs : Math.max(latestTimestampMs, timestampMs);
      }

      const senderKey = nameKey(message.sender_name);
      if (senderKey && !ownAliasKeys.has(senderKey)) {
        incomingMessagesCount += 1;
      }

      const content = collapseWhitespace(message.content);
      if (content && senderKey && !ownAliasKeys.has(senderKey)) {
        const cpfScoreBase = /\bcpf\b/i.test(content) ? 5 : 2;
        for (const cpf of extractCpfCandidatesFromText(content)) {
          const current = cpfCandidates.get(cpf);
          if (!current || current.score < cpfScoreBase || current.latestTimestampMs < timestampMs) {
            cpfCandidates.set(cpf, {
              score: cpfScoreBase,
              latestTimestampMs: timestampMs
            });
          }
        }

        const emailScoreBase = /\b(?:email|e-mail)\b/i.test(content) ? 5 : 2;
        for (const email of extractEmailCandidatesFromText(content)) {
          const current = emailCandidates.get(email);
          if (!current || current.score < emailScoreBase || current.latestTimestampMs < timestampMs) {
            emailCandidates.set(email, {
              score: emailScoreBase,
              latestTimestampMs: timestampMs
            });
          }
        }

        const nameScoreBase = /\b(?:nome|nome completo|me chamo|meu nome|sou)\b/i.test(content) ? 5 : 2;
        for (const fullName of extractNameCandidatesFromText(content, threadTitle)) {
          const current = fullNameCandidates.get(fullName);
          if (!current || current.score < nameScoreBase || current.latestTimestampMs < timestampMs) {
            fullNameCandidates.set(fullName, {
              score: nameScoreBase,
              latestTimestampMs: timestampMs
            });
          }
        }
      }

      if (!canExtractIncomingPhones || !incomingSenderKeys.has(senderKey)) {
        continue;
      }

      if (!content) {
        continue;
      }

      const extracted = extractPhoneCandidatesFromText(content);
      for (const [phone, candidate] of extracted.entries()) {
        const current = candidates.get(phone);
        if (current) {
          current.score = Math.max(current.score, candidate.score);
          current.occurrences += 1;
          current.latestTimestampMs = Math.max(current.latestTimestampMs, timestampMs);
          continue;
        }

        candidates.set(phone, {
          score: candidate.score,
          occurrences: 1,
          latestTimestampMs: timestampMs
        });
      }
    }
  }

  const bestPhone = [...candidates.entries()]
    .sort((left, right) => {
      const leftCandidate = left[1];
      const rightCandidate = right[1];

      if (leftCandidate.score !== rightCandidate.score) {
        return rightCandidate.score - leftCandidate.score;
      }

      if (leftCandidate.occurrences !== rightCandidate.occurrences) {
        return rightCandidate.occurrences - leftCandidate.occurrences;
      }

      return rightCandidate.latestTimestampMs - leftCandidate.latestTimestampMs;
    })
    .map(([phone]) => phone)[0] ?? null;
  const bestCpf = [...cpfCandidates.entries()]
    .sort((left, right) => right[1].score - left[1].score || right[1].latestTimestampMs - left[1].latestTimestampMs)
    .map(([cpf]) => cpf)[0] ?? null;
  const bestEmail = [...emailCandidates.entries()]
    .sort((left, right) => right[1].score - left[1].score || right[1].latestTimestampMs - left[1].latestTimestampMs)
    .map(([email]) => email)[0] ?? null;
  const bestFullName = [...fullNameCandidates.entries()]
    .sort((left, right) => right[1].score - left[1].score || right[1].latestTimestampMs - left[1].latestTimestampMs)
    .map(([fullName]) => fullName)[0] ?? null;

  return {
    latestInteractionAt: latestTimestampMs ? new Date(latestTimestampMs).toISOString() : null,
    phone: bestPhone,
    threadTitle,
    participants: participantNames,
    incomingMessagesCount,
    cpf: bestCpf,
    email: bestEmail,
    fullName: bestFullName
  };
}

function mergeLastInteractionAt(existingValue?: string | null, importedValue?: string | null) {
  const currentTimestamp = existingValue ? Date.parse(existingValue) : Number.NaN;
  const importedTimestamp = importedValue ? Date.parse(importedValue) : Number.NaN;

  if (Number.isNaN(importedTimestamp)) {
    return existingValue ?? null;
  }

  if (Number.isNaN(currentTimestamp) || importedTimestamp > currentTimestamp) {
    return importedValue ?? null;
  }

  return existingValue ?? null;
}

function resolveUpdatedContactName(
  existing: ContactRecord,
  input: { instagram: string; preferredName: ResolvedContactName; ownAliasKeys: Set<string> }
) {
  const currentName = collapseWhitespace(existing.name);
  const preferredName = input.preferredName;
  const normalizedCurrentPersonName = normalizePersonName(currentName, input.instagram);

  if (!currentName) {
    return preferredName.value;
  }

  if (hasMojibake(existing.name)) {
    return preferredName.value || collapseWhitespace(existing.name);
  }

  if (normalizedCurrentPersonName) {
    if (preferredName.source !== "blank" && nameKey(normalizedCurrentPersonName) === nameKey(preferredName.value)) {
      return preferredName.value;
    }

    return normalizedCurrentPersonName;
  }

  if (preferredName.source !== "blank") {
    return preferredName.value;
  }

  if (input.ownAliasKeys.has(nameKey(currentName)) || isInstagramHandleLabel(currentName, input.instagram) || looksLikePhoneLabel(currentName)) {
    return currentName;
  }

  return currentName;
}

function buildUpdatedContactInput(
  existing: ContactRecord,
  input: {
    instagram: string;
    importedPhone: string | null;
    importedCpf: string | null;
    importedEmail: string | null;
    lastInteractionAt: string | null;
    ownAliasKeys: Set<string>;
    preferredName: ResolvedContactName;
  }
): ContactInput {
  const nextPhone = existing.phone || input.importedPhone || "";
  const nextName = resolveUpdatedContactName(existing, input);
  const nextCpf = existing.cpf || input.importedCpf || null;
  const nextEmail = existing.email || input.importedEmail || null;

  return {
    ...existing,
    name: nextName,
    phone: nextPhone,
    cpf: nextCpf,
    email: nextEmail,
    instagram: existing.instagram || input.instagram,
    tags: existing.tags,
    lastInteractionAt: mergeLastInteractionAt(existing.lastInteractionAt, input.lastInteractionAt)
  };
}

function createImportedContactInput(input: {
  instagram: string;
  importedPhone: string | null;
  importedCpf: string | null;
  importedEmail: string | null;
  lastInteractionAt: string | null;
  preferredName: ResolvedContactName;
}): ContactInput {
  return {
    name: input.preferredName.value,
    phone: input.importedPhone ?? "",
    cpf: input.importedCpf,
    email: input.importedEmail,
    instagram: input.instagram,
    procedureStatus: "unknown",
    lastAttendant: null,
    notes: null,
    status: "novo",
    tags: [],
    lastInteractionAt: input.lastInteractionAt,
    lastProcedureAt: null
  };
}

function repairImportedMojibakeNames() {
  let normalizedNames = 0;
  const db = getDb();
  const rows = db
    .prepare(
      `
        SELECT id
        FROM contacts
        WHERE deleted_at IS NULL
          AND instagram IS NOT NULL
          AND trim(instagram) <> ''
          AND name IS NOT NULL
          AND trim(name) <> ''
      `
    )
    .all() as Array<{ id: string }>;

  for (const row of rows) {
    const contact = getContactById(row.id);
    if (!contact) {
      continue;
    }

    const repairedName = collapseWhitespace(contact.name);
    if (!hasMojibake(contact.name) || !repairedName || repairedName === contact.name) {
      continue;
    }

    const updated = updateContact(
      contact.id,
      {
        ...contact,
        name: repairedName,
        tags: contact.tags
      },
      "instagram-import"
    );

    if (updated) {
      normalizedNames += 1;
    }
  }

  return normalizedNames;
}

function resolveExistingContact(instagram: string, phone: string | null) {
  const instagramContactId = findContactIdByChannel("instagram", instagram);
  const phoneContact = phone ? getContactByPhone(phone) : null;

  return {
    instagramContactId,
    phoneContactId: phoneContact?.id ?? null
  };
}

function upsertImportedProfile(input: {
  instagram: string;
  importedName: string;
  whatsappImportedName: string | null;
  importedPhone: string | null;
  importedCpf: string | null;
  importedEmail: string | null;
  lastInteractionAt: string | null;
  ownAliasKeys: Set<string>;
  conflicts: ImportConflict[];
}): UpsertImportedProfileResult {
  const existing = resolveExistingContact(input.instagram, input.importedPhone);
  const preferredName = resolvePreferredContactName({
    instagram: input.instagram,
    importedName: input.importedName,
    whatsappImportedName: input.whatsappImportedName,
    phone: input.importedPhone
  });
  const whatsappCsvMatched = Boolean(input.whatsappImportedName);

  if (existing.instagramContactId && existing.phoneContactId && existing.instagramContactId !== existing.phoneContactId) {
    input.conflicts.push({
      instagram: input.instagram,
      phone: input.importedPhone ?? "",
      instagramContactId: existing.instagramContactId,
      phoneContactId: existing.phoneContactId
    });
    return {
      result: "conflict",
      whatsappCsvMatched,
      appliedNameSource: null,
      nameChanged: false
    };
  }

  const targetContactId = existing.instagramContactId ?? existing.phoneContactId;
  if (!targetContactId) {
    const created = createContact(
      createImportedContactInput({
        instagram: input.instagram,
        importedPhone: input.importedPhone,
        importedCpf: input.importedCpf,
        importedEmail: input.importedEmail,
        lastInteractionAt: input.lastInteractionAt,
        preferredName
      }),
      "instagram-import"
    );

    return {
      result: created ? "created" : "skipped",
      whatsappCsvMatched,
      appliedNameSource: created && preferredName.source !== "blank" ? preferredName.source : null,
      nameChanged: Boolean(created && preferredName.value.length > 0)
    };
  }

  const current = getContactById(targetContactId);
  if (!current) {
    return {
      result: "skipped",
      whatsappCsvMatched,
      appliedNameSource: null,
      nameChanged: false
    };
  }

  const nextInput = buildUpdatedContactInput(current, {
    instagram: input.instagram,
    importedPhone: input.importedPhone,
    importedCpf: input.importedCpf,
    importedEmail: input.importedEmail,
    lastInteractionAt: input.lastInteractionAt,
    ownAliasKeys: input.ownAliasKeys,
    preferredName
  });
  const nextName = nextInput.name;
  const nextPhone = collapseWhitespace(nextInput.phone);
  const nextCpf = collapseWhitespace(nextInput.cpf);
  const nextEmail = collapseWhitespace(nextInput.email);
  const nextInstagram = collapseWhitespace(nextInput.instagram);
  const currentLastInteractionAt = current.lastInteractionAt ?? null;
  const nextLastInteractionAt = nextInput.lastInteractionAt ?? null;
  const nameChanged = current.name !== nextName;

  if (
    current.name === nextName &&
    current.phone === nextPhone &&
    collapseWhitespace(current.cpf) === nextCpf &&
    collapseWhitespace(current.email) === nextEmail &&
    collapseWhitespace(current.instagram) === nextInstagram &&
    currentLastInteractionAt === nextLastInteractionAt
  ) {
    return {
      result: "unchanged",
      whatsappCsvMatched,
      appliedNameSource: null,
      nameChanged: false
    };
  }

  const updated = updateContact(targetContactId, nextInput, "instagram-import");
  return {
    result: updated ? "updated" : "skipped",
    whatsappCsvMatched,
    appliedNameSource: updated && nameChanged && preferredName.source !== "blank" ? preferredName.source : null,
    nameChanged: Boolean(updated && nameChanged)
  };
}

function readJsonFile<Payload>(filePath: string): Payload {
  return JSON.parse(readFileSync(filePath, "utf8")) as Payload;
}

function resolveInstagramHandleFromHref(href?: string | null) {
  const value = collapseWhitespace(href);
  if (!value) {
    return null;
  }

  const match = value.match(/instagram\.com\/(?:_u\/)?([^/?#]+)/i);
  return normalizeInstagramHandle(match?.[1] ?? null);
}

function resolveFollowerEntryHandle(entry: FollowerFileEntry) {
  const listItem = entry.string_list_data?.[0];
  const handle =
    normalizeInstagramHandle(listItem?.value ?? null) ??
    normalizeInstagramHandle(entry.title ?? null) ??
    resolveInstagramHandleFromHref(listItem?.href ?? null);

  return handle ? `@${handle}` : null;
}

function mergeRelationshipTimestamp(target: Map<string, number>, instagram: string, timestamp?: number | null) {
  const normalized = normalizeInstagramHandle(instagram);
  if (!normalized) {
    return;
  }

  const nextTimestamp = Number(timestamp ?? 0);
  const currentTimestamp = target.get(normalized) ?? 0;
  target.set(normalized, Math.max(currentTimestamp, nextTimestamp));
}

function loadRelationshipSnapshot(extraction: ExtractedInstagramExport): RelationshipSnapshot {
  const followers = new Map<string, number>();
  const following = new Map<string, number>();

  for (const filePath of extraction.followerFiles) {
    const parsed = readJsonFile<FollowerFileEntry[]>(filePath);
    const entries = Array.isArray(parsed) ? parsed : [];

    for (const entry of entries) {
      const instagram = resolveFollowerEntryHandle(entry);
      if (!instagram) {
        continue;
      }

      mergeRelationshipTimestamp(followers, instagram, entry.string_list_data?.[0]?.timestamp);
    }
  }

  for (const filePath of extraction.followingFiles) {
    const parsed = readJsonFile<FollowingFile>(filePath);
    const entries = Array.isArray(parsed.relationships_following) ? parsed.relationships_following : [];

    for (const entry of entries) {
      const instagram = resolveFollowerEntryHandle(entry);
      if (!instagram) {
        continue;
      }

      mergeRelationshipTimestamp(following, instagram, entry.string_list_data?.[0]?.timestamp);
    }
  }

  return {
    followers,
    following
  };
}

function listInstagramContacts() {
  const db = getDb();
  const rows = db
    .prepare(
      `
        SELECT id
        FROM contacts
        WHERE deleted_at IS NULL
          AND instagram IS NOT NULL
          AND trim(instagram) <> ''
      `
    )
    .all() as Array<{ id: string }>;

  return rows.map((row) => getContactById(row.id)).filter(Boolean) as ContactRecord[];
}

function listContactIdsByNormalizedPhone() {
  const db = getDb();
  const rows = db
    .prepare(
      `
        SELECT id, phone
        FROM contacts
        WHERE deleted_at IS NULL
          AND phone IS NOT NULL
          AND trim(phone) <> ''
        ORDER BY datetime(updated_at) DESC, id ASC
      `
    )
    .all() as Array<{ id: string; phone: string | null }>;

  const contactIdsByPhone = new Map<string, string>();
  for (const row of rows) {
    const normalizedPhone = normalizeWhatsAppValue(row.phone);
    if (!normalizedPhone || contactIdsByPhone.has(normalizedPhone)) {
      continue;
    }

    contactIdsByPhone.set(normalizedPhone, row.id);
  }

  return contactIdsByPhone;
}

function listStoredInstagramIncomingMessageCounts() {
  const db = getDb();
  const rows = db
    .prepare(
      `
        SELECT
          lower(ltrim(trim(c.instagram), '@')) AS instagram_key,
          COUNT(m.id) AS incoming_count
        FROM contacts c
        LEFT JOIN messages m
          ON m.contact_id = c.id
          AND m.channel = 'instagram'
          AND m.direction = 'incoming'
        WHERE c.deleted_at IS NULL
          AND c.instagram IS NOT NULL
          AND trim(c.instagram) <> ''
        GROUP BY lower(ltrim(trim(c.instagram), '@'))
      `
    )
    .all() as Array<{ instagram_key: string | null; incoming_count: number }>;

  return new Map(
    rows
      .filter((row) => row.instagram_key)
      .map((row) => [String(row.instagram_key), Number(row.incoming_count ?? 0)])
  );
}

function refreshInstagramSignals(input: {
  relationshipSnapshot: RelationshipSnapshot;
  hasRelationshipSnapshot: boolean;
  importedIncomingMessageCounts: Map<string, number>;
}) {
  let relationshipSignalsUpdated = 0;
  let messageSignalsUpdated = 0;
  const storedIncomingCounts = listStoredInstagramIncomingMessageCounts();

  for (const contact of listInstagramContacts()) {
    const normalizedInstagram = normalizeInstagramHandle(contact.instagram);
    if (!normalizedInstagram) {
      continue;
    }

    const nextIncomingMessagesCount = Math.max(
      contact.instagramIncomingMessagesCount,
      input.importedIncomingMessageCounts.get(normalizedInstagram) ?? 0,
      storedIncomingCounts.get(normalizedInstagram) ?? 0
    );

    const beforeRelationship = {
      followsMe: contact.instagramFollowsMe,
      followedByMe: contact.instagramFollowedByMe
    };
    const beforeMessages = {
      incomingCount: contact.instagramIncomingMessagesCount,
      sentMoreThanThreeMessages: contact.instagramSentMoreThanThreeMessages
    };

    const updated = updateContactInstagramSignals(
      contact.id,
      {
        instagramFollowsMe: input.hasRelationshipSnapshot ? input.relationshipSnapshot.followers.has(normalizedInstagram) : undefined,
        instagramFollowedByMe: input.hasRelationshipSnapshot ? input.relationshipSnapshot.following.has(normalizedInstagram) : undefined,
        instagramIncomingMessagesCount: nextIncomingMessagesCount,
        instagramSentMoreThanThreeMessages: nextIncomingMessagesCount > 3
      },
      "instagram-import"
    );

    if (!updated) {
      continue;
    }

    if (
      beforeRelationship.followsMe !== updated.instagramFollowsMe ||
      beforeRelationship.followedByMe !== updated.instagramFollowedByMe
    ) {
      relationshipSignalsUpdated += 1;
    }

    if (
      beforeMessages.incomingCount !== updated.instagramIncomingMessagesCount ||
      beforeMessages.sentMoreThanThreeMessages !== updated.instagramSentMoreThanThreeMessages
    ) {
      messageSignalsUpdated += 1;
    }
  }

  return {
    relationshipSignalsUpdated,
    messageSignalsUpdated
  };
}

function trackUpsertResult(summary: InstagramContactImportSummary, result: UpsertImportedProfileResult) {
  if (result.whatsappCsvMatched) {
    summary.whatsappCsvMatches += 1;
  }

  if (result.nameChanged && result.appliedNameSource === "whatsapp") {
    summary.whatsappCsvNamesApplied += 1;
  }

  if (result.nameChanged && result.appliedNameSource === "phone") {
    summary.namesFromPhones += 1;
  }

  switch (result.result) {
    case "created":
      summary.created += 1;
      break;
    case "updated":
      summary.updated += 1;
      break;
    case "unchanged":
      summary.unchanged += 1;
      break;
    case "conflict":
      summary.conflicts += 1;
      break;
    case "skipped":
    default:
      break;
  }
}

export function reconcileInstagramContactNamesWithWhatsAppCsv(lookup: WhatsAppCsvLookup | null) {
  const db = getDb();
  const phoneContactIds = listContactIdsByNormalizedPhone();
  const phoneContactCache = new Map<string, ContactRecord>();
  const resolvePhoneContact = (contactId: string | null) => {
    if (!contactId) {
      return null;
    }

    const cached = phoneContactCache.get(contactId);
    if (cached) {
      return cached;
    }

    const contact = getContactById(contactId);
    if (contact) {
      phoneContactCache.set(contactId, contact);
    }

    return contact;
  };
  let matchedContacts = 0;
  let updatedContacts = 0;
  let whatsappCsvNamesApplied = 0;
  let whatsappContactNamesApplied = 0;
  let namesFromPhones = 0;
  let cpfsApplied = 0;
  let emailsApplied = 0;

  const transaction = db.transaction(() => {
    for (const contact of listInstagramContacts()) {
      const normalizedInstagram = normalizeInstagramDisplayValue(contact.instagram);
      const normalizedPhone = normalizeWhatsAppValue(contact.phone);
      const csvMatch = normalizedPhone ? lookup?.contactsByPhone.get(normalizedPhone) ?? null : null;
      const phoneContact =
        normalizedPhone && phoneContactIds.get(normalizedPhone) !== contact.id
          ? resolvePhoneContact(phoneContactIds.get(normalizedPhone) ?? null)
          : null;
      const normalizedPhoneContactName = phoneContact ? normalizePersonName(phoneContact.name, normalizedInstagram) : "";
      const phoneContactCpf = phoneContact ? normalizeCpf(phoneContact.cpf) ?? null : null;
      const phoneContactEmail = phoneContact ? normalizeEmailValue(phoneContact.email) ?? null : null;
      if (csvMatch || normalizedPhoneContactName || phoneContactCpf || phoneContactEmail) {
        matchedContacts += 1;
      }

      const preferredName = normalizedPhoneContactName
        ? {
            source: "whatsapp" as const,
            value: normalizedPhoneContactName
          }
        : resolvePreferredContactName({
            instagram: normalizedInstagram,
            importedName: null,
            whatsappImportedName: csvMatch?.preferredName ?? null,
            phone: normalizedPhone
          });

      const nextName = resolveUpdatedContactName(contact, {
        instagram: normalizedInstagram ?? contact.instagram ?? "",
        preferredName,
        ownAliasKeys: new Set<string>()
      });
      const currentCpf = normalizeCpf(contact.cpf) ?? null;
      const nextCpf = currentCpf ?? phoneContactCpf ?? null;
      const currentEmail = normalizeEmailValue(contact.email) ?? null;
      const nextEmail = currentEmail ?? phoneContactEmail ?? null;

      if (nextName === contact.name && currentCpf === nextCpf && currentEmail === nextEmail) {
        continue;
      }

      const updated = updateContact(
        contact.id,
        {
          ...contact,
          name: nextName,
          cpf: nextCpf,
          email: nextEmail,
          tags: contact.tags
        },
        "instagram-import"
      );

      if (!updated) {
        continue;
      }

      updatedContacts += 1;
      if (normalizedPhoneContactName && nextName !== contact.name) {
        whatsappContactNamesApplied += 1;
      } else if (preferredName.source === "whatsapp" && nextName !== contact.name) {
        whatsappCsvNamesApplied += 1;
      }
      if (preferredName.source === "phone" && nextName !== contact.name) {
        namesFromPhones += 1;
      }
      if (currentCpf !== nextCpf) {
        cpfsApplied += 1;
      }
      if (currentEmail !== nextEmail) {
        emailsApplied += 1;
      }
    }
  });

  transaction.immediate();

  return {
    matchedContacts,
    updatedContacts,
    whatsappCsvNamesApplied,
    whatsappContactNamesApplied,
    namesFromPhones,
    cpfsApplied,
    emailsApplied
  };
}

export function importInstagramContacts(
  zipPath: string,
  options?: {
    whatsappLookup?: WhatsAppCsvLookup | null;
  }
): InstagramContactImportSummary {
  const resolvedZipPath = path.resolve(zipPath);
  const extraction = extractInstagramJsons(resolvedZipPath);
  const whatsappLookup = options?.whatsappLookup ?? null;

  try {
    const threadGroups = groupThreadFiles(extraction.messageFiles);
    const relationshipSnapshot = loadRelationshipSnapshot(extraction);
    const hasRelationshipSnapshot = relationshipSnapshot.followers.size > 0 || relationshipSnapshot.following.size > 0;
    const ownAliases = inferOwnAliases(threadGroups);
    const ownAliasKeys = new Set(ownAliases.map((alias) => nameKey(alias)));
    const participantFrequency = participantFrequencyMap(threadGroups);
    const importedIncomingMessageCounts = new Map<string, number>();
    const importedFollowerHandles = new Set<string>();

    const summary: InstagramContactImportSummary = {
      zipPath: resolvedZipPath,
      extractedJsonFiles: extraction.extractedFiles.length,
      hasMessageSnapshot: threadGroups.length > 0,
      hasRelationshipSnapshot,
      processedThreads: 0,
      processedFollowers: 0,
      processedFollowing: 0,
      created: 0,
      updated: 0,
      normalizedNames: 0,
      unchanged: 0,
      skippedNoHandle: 0,
      skippedInvalidJson: 0,
      skippedNoSupportedData: 0,
      conflicts: 0,
      phonesDiscovered: 0,
      currentFollowers: relationshipSnapshot.followers.size,
      currentFollowing: relationshipSnapshot.following.size,
      relationshipSignalsUpdated: 0,
      messageSignalsUpdated: 0,
      whatsappCsvRows: whatsappLookup?.totalRows ?? 0,
      whatsappCsvMatches: 0,
      whatsappCsvNamesApplied: 0,
      namesFromPhones: 0,
      ownAliases,
      conflictSamples: []
    };

    if (!summary.hasMessageSnapshot && !summary.hasRelationshipSnapshot) {
      summary.skippedNoSupportedData = 1;
      return summary;
    }

    for (const thread of threadGroups) {
      const instagram = deriveThreadHandle(thread.threadDirName);
      if (!instagram) {
        summary.skippedNoHandle += 1;
        continue;
      }

      let threadAnalysis: ThreadAnalysis;
      try {
        threadAnalysis = analyzeThread(thread, ownAliasKeys, participantFrequency);
      } catch {
        summary.skippedInvalidJson += 1;
        continue;
      }

      const importedName = chooseImportedName({
        messageFullName: threadAnalysis.fullName,
        title: threadAnalysis.threadTitle,
        participants: threadAnalysis.participants,
        instagram,
        ownAliasKeys
      });
      const whatsappMatch = threadAnalysis.phone ? whatsappLookup?.contactsByPhone.get(threadAnalysis.phone) ?? null : null;

      const result = upsertImportedProfile({
        instagram,
        importedName,
        whatsappImportedName: whatsappMatch?.preferredName ?? null,
        importedPhone: threadAnalysis.phone,
        importedCpf: threadAnalysis.cpf,
        importedEmail: threadAnalysis.email,
        lastInteractionAt: threadAnalysis.latestInteractionAt,
        ownAliasKeys,
        conflicts: summary.conflictSamples
      });

      const normalizedInstagram = normalizeInstagramHandle(instagram);
      if (normalizedInstagram) {
        importedIncomingMessageCounts.set(
          normalizedInstagram,
          Math.max(importedIncomingMessageCounts.get(normalizedInstagram) ?? 0, threadAnalysis.incomingMessagesCount)
        );
      }

      summary.processedThreads += 1;
      if (threadAnalysis.phone) {
        summary.phonesDiscovered += 1;
      }
      trackUpsertResult(summary, result);
    }

    for (const normalizedInstagram of relationshipSnapshot.followers.keys()) {
      const instagram = normalizeInstagramDisplayValue(normalizedInstagram);
      if (!instagram || importedFollowerHandles.has(normalizedInstagram)) {
        continue;
      }

      importedFollowerHandles.add(normalizedInstagram);
      const result = upsertImportedProfile({
        instagram,
        importedName: "",
        whatsappImportedName: null,
        importedPhone: null,
        importedCpf: null,
        importedEmail: null,
        lastInteractionAt: null,
        ownAliasKeys,
        conflicts: summary.conflictSamples
      });

      summary.processedFollowers += 1;
      trackUpsertResult(summary, result);
    }

    for (const normalizedInstagram of relationshipSnapshot.following.keys()) {
      const instagram = normalizeInstagramDisplayValue(normalizedInstagram);
      if (!instagram || importedFollowerHandles.has(normalizedInstagram)) {
        continue;
      }

      importedFollowerHandles.add(normalizedInstagram);
      const result = upsertImportedProfile({
        instagram,
        importedName: "",
        whatsappImportedName: null,
        importedPhone: null,
        importedCpf: null,
        importedEmail: null,
        lastInteractionAt: null,
        ownAliasKeys,
        conflicts: summary.conflictSamples
      });

      summary.processedFollowing += 1;
      trackUpsertResult(summary, result);
    }

    const signalSummary = refreshInstagramSignals({
      relationshipSnapshot,
      hasRelationshipSnapshot,
      importedIncomingMessageCounts
    });

    summary.relationshipSignalsUpdated = signalSummary.relationshipSignalsUpdated;
    summary.messageSignalsUpdated = signalSummary.messageSignalsUpdated;
    summary.normalizedNames = repairImportedMojibakeNames();
    summary.conflictSamples = summary.conflictSamples.slice(0, 20);

    return summary;
  } finally {
    rmSync(extraction.extractionDir, { recursive: true, force: true });
  }
}

export function extractInstagramConversationSnapshots(zipPath: string): InstagramConversationArchiveSnapshot {
  const resolvedZipPath = path.resolve(zipPath);
  const extraction = extractInstagramJsons(resolvedZipPath);

  try {
    const threadGroups = groupThreadFiles(extraction.messageFiles);
    const ownAliases = inferOwnAliases(threadGroups);
    const ownAliasKeys = new Set(ownAliases.map((alias) => nameKey(alias)));

    const threads = threadGroups
      .map((thread) => {
        const messages: InstagramConversationMessageSnapshot[] = [];
        let title = "";
        let participants: string[] = [];

        for (const filePath of thread.filePaths) {
          const parsed = readInstagramMessageFile(filePath);
          title = collapseWhitespace(parsed.title) || title;
          participants = (parsed.participants ?? []).map((participant) => collapseWhitespace(participant.name)).filter(Boolean);

          for (const message of parsed.messages ?? []) {
            const content = collapseWhitespace(message.content);
            if (!content) {
              continue;
            }

            const senderName = collapseWhitespace(message.sender_name);
            messages.push({
              senderName,
              timestampMs: Number(message.timestamp_ms ?? 0) > 0 ? Number(message.timestamp_ms) : null,
              content,
              direction: ownAliasKeys.has(nameKey(senderName)) ? "outgoing" : "incoming"
            });
          }
        }

        messages.sort((left, right) => {
          const leftTimestamp = left.timestampMs ?? Number.MAX_SAFE_INTEGER;
          const rightTimestamp = right.timestampMs ?? Number.MAX_SAFE_INTEGER;
          return leftTimestamp - rightTimestamp;
        });

        return {
          threadKey: thread.threadDirName,
          threadDirName: thread.threadDirName,
          instagramHandle: deriveThreadHandle(thread.threadDirName),
          title,
          participants,
          messages
        };
      })
      .filter((thread) => thread.messages.length > 0);

    return {
      zipPath: resolvedZipPath,
      ownAliases,
      threads
    };
  } finally {
    rmSync(extraction.extractionDir, { recursive: true, force: true });
  }
}

export function listInstagramExportFiles(inputPath: string) {
  const resolvedPath = path.resolve(inputPath);
  if (!existsSync(resolvedPath)) {
    return [];
  }

  const stats = statSync(resolvedPath);
  if (stats.isFile()) {
    if (/\.crdownload$/i.test(path.basename(resolvedPath))) {
      return [];
    }

    return isReadableZipArchive(resolvedPath) ? [resolvedPath] : [];
  }

  if (!stats.isDirectory()) {
    return [];
  }

  const files = execFileSync("find", [resolvedPath, "-type", "f"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  })
    .split(/\r?\n/g)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry) => !/\.crdownload$/i.test(path.basename(entry)));

  return files
    .filter((filePath) => isReadableZipArchive(filePath))
    .sort((left, right) => {
      const leftStats = statSync(left);
      const rightStats = statSync(right);
      if (leftStats.mtimeMs !== rightStats.mtimeMs) {
        return leftStats.mtimeMs - rightStats.mtimeMs;
      }

      return left.localeCompare(right, "en");
    });
}

export function listPendingIncompleteInstagramDownloads(inputPath: string) {
  const resolvedPath = path.resolve(inputPath);
  if (!existsSync(resolvedPath)) {
    return [];
  }

  const stats = statSync(resolvedPath);
  if (stats.isFile()) {
    return /\.crdownload$/i.test(path.basename(resolvedPath)) ? [resolvedPath] : [];
  }

  if (!stats.isDirectory()) {
    return [];
  }

  return execFileSync("find", [resolvedPath, "-type", "f", "-name", "*.crdownload"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  })
    .split(/\r?\n/g)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, "en"));
}

export function removeImportedInstagramSource(filePath: string) {
  rmSync(filePath, { force: true });
}
