import type { ContactInput, ContactRecord } from "../types/domain.js";
import { recordAuditLog } from "../repositories/audit-log-repository.js";
import {
  applyTagToContact,
  createAssistedContact,
  getContactById,
  getContactByInstagram,
  getContactByPhone,
  updateAssistedContact
} from "../repositories/contact-repository.js";
import { ensureTag } from "../repositories/tag-repository.js";
import { normalizeBrazilianPhone, normalizeInstagramHandle } from "../utils/phone.js";

const ANALYZE_TAG = "Analisar";
const NEW_IG_TAG = "new_ig";

function collapseWhitespace(input?: string | null) {
  return String(input ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeInstagramDisplayValue(input?: string | null) {
  const normalized = normalizeInstagramHandle(input);
  return normalized ? `@${normalized}` : null;
}

function chooseContactName(input: { threadTitle?: string | null; instagram: string }) {
  const threadTitle = collapseWhitespace(input.threadTitle);
  if (threadTitle && !threadTitle.startsWith("@") && !/^https?:\/\//i.test(threadTitle)) {
    return threadTitle;
  }

  return input.instagram;
}

function extractPhoneCandidatesFromText(text: string) {
  const matches = text.match(/(?:\+?\d[\d\s().-]{6,}\d)/g) ?? [];
  return matches
    .map((raw) => ({
      raw: collapseWhitespace(raw),
      digits: raw.replace(/\D/g, "")
    }))
    .filter((candidate) => candidate.digits.length >= 8);
}

function stripLeadingCountryCode(phoneDigits: string) {
  return phoneDigits.startsWith("55") && phoneDigits.length > 11 ? phoneDigits.slice(2) : phoneDigits;
}

function isMissingDdd(phoneDigits: string) {
  const localDigits = stripLeadingCountryCode(phoneDigits);
  return localDigits.length === 8 || localDigits.length === 9;
}

function normalizeDetectedPhone(phoneDigits: string) {
  if (!phoneDigits) {
    return null;
  }

  if (isMissingDdd(phoneDigits)) {
    return phoneDigits;
  }

  return normalizeBrazilianPhone(phoneDigits) ?? phoneDigits;
}

function mergeLastInteractionAt(currentValue?: string | null, incomingValue?: string | null) {
  const currentTimestamp = currentValue ? Date.parse(currentValue) : Number.NaN;
  const incomingTimestamp = incomingValue ? Date.parse(incomingValue) : Number.NaN;

  if (Number.isNaN(incomingTimestamp)) {
    return currentValue ?? null;
  }

  if (Number.isNaN(currentTimestamp) || incomingTimestamp > currentTimestamp) {
    return incomingValue ?? null;
  }

  return currentValue ?? null;
}

function buildNextContactInput(
  contact: ContactRecord,
  input: {
    instagramDisplay: string;
    importedName: string;
    detectedPhone: string | null;
    missingDdd: boolean;
    lastInteractionAt: string | null;
    allowInstagramUpdate: boolean;
  }
): ContactInput & { syncWhatsAppChannel?: boolean } {
  const hasExistingPhone = collapseWhitespace(contact.phone).length > 0;
  const nextPhone = !hasExistingPhone && input.detectedPhone ? input.detectedPhone : contact.phone;
  const nextName = collapseWhitespace(contact.name) || !input.importedName ? contact.name : input.importedName;
  const nextInstagram = input.allowInstagramUpdate ? contact.instagram || input.instagramDisplay : contact.instagram;

  return {
    ...contact,
    name: nextName,
    phone: nextPhone,
    instagram: nextInstagram,
    tags: contact.tags,
    lastInteractionAt: mergeLastInteractionAt(contact.lastInteractionAt, input.lastInteractionAt),
    syncWhatsAppChannel: Boolean(nextPhone) && !input.missingDdd
  };
}

export type InstagramContactMatchResult = {
  contact: ContactRecord;
  created: boolean;
  linkedBy: "phone" | "instagram" | "new";
  detectedPhoneRaw: string | null;
  detectedPhoneNormalized: string | null;
  missingDdd: boolean;
  automaticTagsApplied: string[];
  conflict: {
    instagramContactId: string;
    phoneContactId: string;
  } | null;
};

export function resolveInstagramContactFromLastMessage(input: {
  instagramUsername: string;
  threadTitle?: string | null;
  lastMessageText?: string | null;
  lastMessageAt?: string | null;
}) {
  const normalizedInstagram = normalizeInstagramHandle(input.instagramUsername);
  if (!normalizedInstagram) {
    throw new Error("instagram_username_required");
  }

  ensureTag(ANALYZE_TAG, { type: "sistema", active: true, color: "#f59e0b" });
  ensureTag(NEW_IG_TAG, { type: "sistema", active: true, color: "#f97316" });

  const instagramDisplay = normalizeInstagramDisplayValue(normalizedInstagram) ?? `@${normalizedInstagram}`;
  const importedName = chooseContactName({
    threadTitle: input.threadTitle,
    instagram: instagramDisplay
  });
  const phoneCandidates = extractPhoneCandidatesFromText(collapseWhitespace(input.lastMessageText));
  const primaryPhoneCandidate = phoneCandidates[phoneCandidates.length - 1] ?? null;
  const detectedPhoneRaw = primaryPhoneCandidate?.raw ?? null;
  const detectedPhoneDigits = primaryPhoneCandidate?.digits ?? null;
  const missingDdd = detectedPhoneDigits ? isMissingDdd(detectedPhoneDigits) : false;
  const detectedPhoneNormalized = detectedPhoneDigits ? normalizeDetectedPhone(detectedPhoneDigits) : null;
  const existingByPhone = detectedPhoneNormalized && !missingDdd ? getContactByPhone(detectedPhoneNormalized) : null;
  const existingByInstagram = getContactByInstagram(normalizedInstagram);
  const conflict =
    existingByPhone && existingByInstagram && existingByPhone.id !== existingByInstagram.id
      ? {
          instagramContactId: existingByInstagram.id,
          phoneContactId: existingByPhone.id
        }
      : null;
  const automaticTagsApplied: string[] = [];
  const timestamp = input.lastMessageAt ?? nowIso();

  let contact = existingByPhone ?? existingByInstagram;
  let created = false;
  let linkedBy: InstagramContactMatchResult["linkedBy"] = existingByPhone ? "phone" : existingByInstagram ? "instagram" : "new";

  if (!contact) {
    const tags = [NEW_IG_TAG];
    automaticTagsApplied.push(NEW_IG_TAG);
    if (missingDdd && detectedPhoneNormalized) {
      tags.push(ANALYZE_TAG);
      automaticTagsApplied.push(ANALYZE_TAG);
    }

    contact = createAssistedContact(
      {
        name: importedName,
        phone: detectedPhoneNormalized ?? "",
        cpf: null,
        email: null,
        instagram: instagramDisplay,
        procedureStatus: "unknown",
        lastAttendant: null,
        notes: null,
        status: "novo",
        tags,
        lastInteractionAt: input.lastMessageAt ?? null,
        lastProcedureAt: null,
        syncWhatsAppChannel: Boolean(detectedPhoneNormalized) && !missingDdd
      },
      "instagram-assisted"
    );
    created = true;
  } else {
    const nextContactInput = buildNextContactInput(contact, {
      instagramDisplay,
      importedName,
      detectedPhone: detectedPhoneNormalized,
      missingDdd,
      lastInteractionAt: input.lastMessageAt ?? null,
      allowInstagramUpdate: !conflict || conflict.instagramContactId === contact.id
    });

    const shouldUpdate =
      nextContactInput.name !== contact.name ||
      nextContactInput.phone !== contact.phone ||
      nextContactInput.instagram !== contact.instagram ||
      nextContactInput.lastInteractionAt !== contact.lastInteractionAt;

    if (shouldUpdate) {
      contact =
        updateAssistedContact(contact.id, nextContactInput, "instagram-assisted") ??
        contact;
    }

    if (missingDdd && detectedPhoneNormalized && !contact.tags.some((tag) => tag.toLowerCase() === ANALYZE_TAG.toLowerCase())) {
      applyTagToContact(contact.id, ANALYZE_TAG, "instagram-assisted");
      automaticTagsApplied.push(ANALYZE_TAG);
      contact = getContactById(contact.id) ?? contact;
    }
  }

  if (!contact) {
    throw new Error("instagram_contact_match_failed");
  }

  recordAuditLog({
    entityType: "contact",
    entityId: contact.id,
    action: "contact.instagram_phone_detected",
    channel: "instagram",
    contactId: contact.id,
    metadata: {
      instagram: instagramDisplay,
      rawPhone: detectedPhoneRaw,
      normalizedPhone: detectedPhoneNormalized,
      missingDdd,
      lastMessageAt: timestamp
    },
    createdAt: timestamp
  });

  if (!existingByInstagram && (!conflict || conflict.phoneContactId === contact.id)) {
    recordAuditLog({
      entityType: "contact",
      entityId: contact.id,
      action: "contact.channel_linked",
      channel: "instagram",
      contactId: contact.id,
      metadata: {
        type: "instagram",
        instagram: instagramDisplay,
        linkedBy
      },
      createdAt: timestamp
    });
  }

  if (conflict) {
    recordAuditLog({
      entityType: "contact",
      entityId: contact.id,
      action: "contact.instagram_match_conflict",
      channel: "instagram",
      contactId: contact.id,
      metadata: conflict,
      createdAt: timestamp
    });
  }

  recordAuditLog({
    entityType: "contact",
    entityId: contact.id,
    action: created ? "contact.instagram_auto_created" : "contact.instagram_matched",
    channel: "instagram",
    contactId: contact.id,
    metadata: {
      instagram: instagramDisplay,
      linkedBy,
      automaticTagsApplied,
      missingDdd
    },
    createdAt: timestamp
  });

  return {
    contact,
    created,
    linkedBy,
    detectedPhoneRaw,
    detectedPhoneNormalized,
    missingDdd,
    automaticTagsApplied,
    conflict
  } satisfies InstagramContactMatchResult;
}
