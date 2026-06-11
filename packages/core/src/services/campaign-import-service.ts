import { getDb } from "../db/connection.js";
import { InputError } from "../errors/app-error.js";
import { listInactiveContactChannelValues } from "../repositories/contact-channel-repository.js";
import { looksLikeValidWhatsAppCandidate, normalizeBrazilianPhone, normalizeInstagramHandle } from "../utils/phone.js";

type CampaignImportContactMatch = {
  contactId: string;
  name: string;
  phone: string | null;
  instagram: string | null;
};

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

export type CampaignImportMapping = {
  phone?: string;
  name?: string;
  instagram?: string;
  tags?: string;
};

export type CampaignImportStatus =
  | "existing"
  | "eligible"
  | "new_contact"
  | "needs_review"
  | "insufficient_link"
  | "invalid";

export type CampaignImportPreviewRow = Record<string, string | string[]> & {
  _normalizedPhone: string;
  _normalizedInstagram: string;
  _resolvedPhone: string;
  _resolvedInstagram: string;
  _resolvedChannel: "" | "whatsapp" | "instagram";
  _resolvedTargetDisplay: string;
  _resolvedTargetNormalized: string;
  _resolvedName: string;
  _matchType: "" | "phone" | "instagram" | "phone+instagram";
  _exists: CampaignImportStatus;
  _reason: string;
  _contactId: string;
  _tags: string[];
};

export type CampaignImportPreview = {
  preview: CampaignImportPreviewRow[];
  summary: {
    total: number;
    existing: number;
    eligible: number;
    new_contact: number;
    needs_review: number;
    insufficient_link: number;
    invalid: number;
  };
  recipients: ImportedCampaignRecipient[];
};

function normalizeCell(row: Record<string, string>, key?: string) {
  if (!key) {
    return "";
  }

  return String(row[key] ?? "").trim();
}

function parseTagsCell(value: string) {
  if (!value.trim()) {
    return [];
  }

  const unique = new Map<string, string>();
  for (const part of value.split(/[;,]/)) {
    const tag = part.trim().replace(/\s+/g, " ");
    if (!tag) {
      continue;
    }
    unique.set(tag.toLowerCase(), tag);
  }
  return [...unique.values()];
}

function buildContactIndexes() {
  const db = getDb();
  const inactiveInstagramValues = new Set(listInactiveContactChannelValues("instagram"));
  const instagramChannelRows = db
    .prepare(
      `
        SELECT DISTINCT contact_id
        FROM contact_channels
        WHERE type = 'instagram'
      `
    )
    .all() as Array<{ contact_id: string }>;
  const contactsWithInstagramChannel = new Set(instagramChannelRows.map((row) => String(row.contact_id)));
  const contactRows = db
    .prepare(
      `
        SELECT
          c.id AS contact_id,
          c.name,
          c.phone,
          c.instagram,
          cc.type,
          cc.normalized_value
        FROM contacts c
        LEFT JOIN contact_channels cc
          ON cc.contact_id = c.id
         AND cc.is_active = 1
        WHERE c.deleted_at IS NULL
        ORDER BY cc.is_primary DESC, cc.updated_at DESC, c.updated_at DESC
      `
    )
    .all() as Array<Record<string, unknown>>;

  const activeInstagramByContactId = new Map<string, string>();
  for (const row of contactRows) {
    if (String(row.type ?? "") !== "instagram") {
      continue;
    }
    const contactId = String(row.contact_id);
    const channelValue = normalizeInstagramHandle(String(row.normalized_value ?? ""));
    if (channelValue && !activeInstagramByContactId.has(contactId)) {
      activeInstagramByContactId.set(contactId, channelValue);
    }
  }

  const phoneIndex = new Map<string, CampaignImportContactMatch>();
  const instagramIndex = new Map<string, CampaignImportContactMatch>();

  for (const row of contactRows) {
    const contactId = String(row.contact_id);
    const legacyInstagram = normalizeInstagramHandle(String(row.instagram ?? ""));
    const activeInstagram = activeInstagramByContactId.get(contactId) ?? null;
    const contact: CampaignImportContactMatch = {
      contactId,
      name: String(row.name ?? ""),
      phone: normalizeBrazilianPhone(String(row.phone ?? "")),
      instagram:
        activeInstagram ??
        (!contactsWithInstagramChannel.has(contactId) && legacyInstagram && !inactiveInstagramValues.has(legacyInstagram) ? legacyInstagram : null)
    };

    const channelType = String(row.type ?? "");
    const channelValue = String(row.normalized_value ?? "");

    if (channelType === "whatsapp" && channelValue && !phoneIndex.has(channelValue)) {
      phoneIndex.set(channelValue, contact);
    }

    if (channelType === "instagram" && channelValue && !instagramIndex.has(channelValue)) {
      instagramIndex.set(channelValue, contact);
    }

    if (contact.phone && !phoneIndex.has(contact.phone)) {
      phoneIndex.set(contact.phone, contact);
    }

    if (contact.instagram && !instagramIndex.has(contact.instagram)) {
      instagramIndex.set(contact.instagram, contact);
    }
  }

  return {
    phoneIndex,
    instagramIndex,
    inactiveInstagramValues
  };
}

function resolvePreferredChannel(input: {
  eligibleChannels: Array<"whatsapp" | "instagram">;
  rawPhone: string;
  rawInstagram: string;
  resolvedPhone: string | null;
  resolvedInstagram: string | null;
}) {
  const prefersPhone = Boolean(input.rawPhone.trim());
  const prefersInstagram = Boolean(input.rawInstagram.trim());
  const canUseWhatsApp = input.eligibleChannels.includes("whatsapp") && Boolean(input.resolvedPhone && looksLikeValidWhatsAppCandidate(input.resolvedPhone));
  const canUseInstagram = input.eligibleChannels.includes("instagram") && Boolean(input.resolvedInstagram);

  if (prefersPhone && canUseWhatsApp) {
    return "whatsapp" as const;
  }

  if (prefersInstagram && canUseInstagram) {
    return "instagram" as const;
  }

  if (canUseWhatsApp) {
    return "whatsapp" as const;
  }

  if (canUseInstagram) {
    return "instagram" as const;
  }

  return null;
}

function resolveRowStatus(input: {
  row: Record<string, string>;
  mapping: CampaignImportMapping;
  eligibleChannels: Array<"whatsapp" | "instagram">;
  phoneIndex: Map<string, CampaignImportContactMatch>;
  instagramIndex: Map<string, CampaignImportContactMatch>;
  inactiveInstagramValues: Set<string>;
  seenTargets: Set<string>;
}): CampaignImportPreviewRow {
  const rawPhone = normalizeCell(input.row, input.mapping.phone);
  const rawInstagram = normalizeCell(input.row, input.mapping.instagram);
  const rawName = normalizeCell(input.row, input.mapping.name);
  const tags = parseTagsCell(normalizeCell(input.row, input.mapping.tags));
  const normalizedPhone = normalizeBrazilianPhone(rawPhone);
  const normalizedInstagram = normalizeInstagramHandle(rawInstagram);
  const inactiveInstagram = normalizedInstagram ? input.inactiveInstagramValues.has(normalizedInstagram) : false;
  const availableInstagram = inactiveInstagram ? null : normalizedInstagram;

  const matchedByPhone = normalizedPhone ? input.phoneIndex.get(normalizedPhone) ?? null : null;
  const matchedByInstagram = availableInstagram ? input.instagramIndex.get(availableInstagram) ?? null : null;

  if (matchedByPhone && matchedByInstagram && matchedByPhone.contactId !== matchedByInstagram.contactId) {
    return {
      ...input.row,
      _normalizedPhone: normalizedPhone ?? "",
      _normalizedInstagram: normalizedInstagram ? `@${normalizedInstagram}` : "",
      _resolvedPhone: "",
      _resolvedInstagram: "",
      _resolvedChannel: "",
      _resolvedTargetDisplay: "",
      _resolvedTargetNormalized: "",
      _resolvedName: rawName,
      _matchType: "phone+instagram",
      _exists: "needs_review",
      _reason: "Telefone e Instagram apontam para contatos diferentes. Revise antes de importar.",
      _contactId: "",
      _tags: tags
    };
  }

  const matchedContact = matchedByPhone ?? matchedByInstagram ?? null;
  const resolvedPhone = normalizedPhone ?? matchedByInstagram?.phone ?? null;
  const resolvedInstagram = availableInstagram ?? matchedByPhone?.instagram ?? null;
  const resolvedChannel = resolvePreferredChannel({
    eligibleChannels: input.eligibleChannels,
    rawPhone,
    rawInstagram,
    resolvedPhone,
    resolvedInstagram
  });

  if (!resolvedChannel) {
    const hasAnyIdentifier = Boolean(rawPhone || rawInstagram || matchedContact);
    const blockedByInactiveInstagram = Boolean(inactiveInstagram && !resolvedPhone);
    return {
      ...input.row,
      _normalizedPhone: normalizedPhone ?? "",
      _normalizedInstagram: normalizedInstagram ? `@${normalizedInstagram}` : "",
      _resolvedPhone: resolvedPhone ?? "",
      _resolvedInstagram: resolvedInstagram ? `@${resolvedInstagram}` : "",
      _resolvedChannel: "",
      _resolvedTargetDisplay: "",
      _resolvedTargetNormalized: "",
      _resolvedName: rawName || matchedContact?.name || "",
      _matchType: matchedByPhone && matchedByInstagram ? "phone+instagram" : matchedByPhone ? "phone" : matchedByInstagram ? "instagram" : "",
      _exists: blockedByInactiveInstagram ? "invalid" : hasAnyIdentifier ? "insufficient_link" : "invalid",
      _reason: blockedByInactiveInstagram
        ? `Instagram @${normalizedInstagram} marcado como inativo por perfil indisponivel.`
        : hasAnyIdentifier
          ? "Nao foi possivel resolver um canal elegivel com os dados informados para esta campanha."
        : "Linha sem telefone ou Instagram valido.",
      _contactId: matchedContact?.contactId ?? "",
      _tags: tags
    };
  }

  const resolvedTargetNormalized = resolvedChannel === "whatsapp" ? resolvedPhone ?? "" : resolvedInstagram ?? "";
  const resolvedTargetDisplay = resolvedChannel === "whatsapp" ? resolvedPhone ?? "" : resolvedInstagram ? `@${resolvedInstagram}` : "";
  const targetKey = `${resolvedChannel}:${resolvedTargetNormalized}`;

  if (!resolvedTargetNormalized) {
    return {
      ...input.row,
      _normalizedPhone: normalizedPhone ?? "",
      _normalizedInstagram: normalizedInstagram ? `@${normalizedInstagram}` : "",
      _resolvedPhone: resolvedPhone ?? "",
      _resolvedInstagram: resolvedInstagram ? `@${resolvedInstagram}` : "",
      _resolvedChannel: "",
      _resolvedTargetDisplay: "",
      _resolvedTargetNormalized: "",
      _resolvedName: rawName || matchedContact?.name || "",
      _matchType: matchedByPhone && matchedByInstagram ? "phone+instagram" : matchedByPhone ? "phone" : matchedByInstagram ? "instagram" : "",
      _exists: "insufficient_link",
      _reason: "O canal elegivel foi identificado, mas o destino final nao ficou consistente.",
      _contactId: matchedContact?.contactId ?? "",
      _tags: tags
    };
  }

  if (input.seenTargets.has(targetKey)) {
    return {
      ...input.row,
      _normalizedPhone: normalizedPhone ?? "",
      _normalizedInstagram: normalizedInstagram ? `@${normalizedInstagram}` : "",
      _resolvedPhone: resolvedPhone ?? "",
      _resolvedInstagram: resolvedInstagram ? `@${resolvedInstagram}` : "",
      _resolvedChannel: resolvedChannel,
      _resolvedTargetDisplay: resolvedTargetDisplay,
      _resolvedTargetNormalized: resolvedTargetNormalized,
      _resolvedName: rawName || matchedContact?.name || "",
      _matchType: matchedByPhone && matchedByInstagram ? "phone+instagram" : matchedByPhone ? "phone" : matchedByInstagram ? "instagram" : "",
      _exists: "invalid",
      _reason: "Destino duplicado no CSV para o mesmo canal.",
      _contactId: matchedContact?.contactId ?? "",
      _tags: tags
    };
  }

  input.seenTargets.add(targetKey);

  const directMatch =
    (resolvedChannel === "whatsapp" && Boolean(normalizedPhone && matchedByPhone)) ||
    (resolvedChannel === "instagram" && Boolean(normalizedInstagram && matchedByInstagram));

  const exists: CampaignImportStatus = matchedContact ? (directMatch ? "existing" : "eligible") : "new_contact";
  const reason =
    exists === "existing"
      ? "Contato ja existente com vinculo direto no canal resolvido."
      : exists === "eligible"
        ? "Contato existente reaproveitado por canal alternativo ou dado complementar."
        : "Novo contato elegivel para a campanha omnichannel.";

  return {
    ...input.row,
    _normalizedPhone: normalizedPhone ?? "",
    _normalizedInstagram: normalizedInstagram ? `@${normalizedInstagram}` : "",
    _resolvedPhone: resolvedPhone ?? "",
    _resolvedInstagram: resolvedInstagram ? `@${resolvedInstagram}` : "",
    _resolvedChannel: resolvedChannel,
    _resolvedTargetDisplay: resolvedTargetDisplay,
    _resolvedTargetNormalized: resolvedTargetNormalized,
    _resolvedName: rawName || matchedContact?.name || resolvedTargetDisplay,
    _matchType: matchedByPhone && matchedByInstagram ? "phone+instagram" : matchedByPhone ? "phone" : matchedByInstagram ? "instagram" : "",
    _exists: exists,
    _reason: reason,
    _contactId: matchedContact?.contactId ?? "",
    _tags: tags
  };
}

export function buildCampaignImportPreview(
  rows: Array<Record<string, string>>,
  mapping: CampaignImportMapping,
  options?: { eligibleChannels?: Array<"whatsapp" | "instagram"> }
): CampaignImportPreview {
  if (!mapping.phone && !mapping.instagram) {
    throw new InputError("Selecione ao menos uma coluna de telefone ou Instagram para a pré-validação.");
  }

  const fallbackChannels: Array<"whatsapp" | "instagram"> = ["whatsapp"];
  const eligibleChannels = options?.eligibleChannels?.length ? options.eligibleChannels : fallbackChannels;
  const { phoneIndex, instagramIndex, inactiveInstagramValues } = buildContactIndexes();
  const seenTargets = new Set<string>();

  const preview = rows.map((row) =>
    resolveRowStatus({
      row,
      mapping,
      eligibleChannels,
      phoneIndex,
      instagramIndex,
      inactiveInstagramValues,
      seenTargets
    })
  );

  const summary = preview.reduce(
    (accumulator, row) => {
      accumulator.total += 1;
      accumulator[row._exists] += 1;
      return accumulator;
    },
    {
      total: 0,
      existing: 0,
      eligible: 0,
      new_contact: 0,
      needs_review: 0,
      insufficient_link: 0,
      invalid: 0
    }
  );

  const recipients = preview
    .filter((row) => ["existing", "eligible", "new_contact"].includes(row._exists) && row._resolvedChannel)
    .map((row) => ({
      channel: row._resolvedChannel,
      phone: row._resolvedPhone || null,
      instagram: row._resolvedInstagram || null,
      targetDisplayValue: row._resolvedTargetDisplay,
      targetNormalizedValue: row._resolvedTargetNormalized,
      name: row._resolvedName || "",
      tags: row._tags,
      extra: {
        ...row,
        _tags: row._tags.join(", ")
      }
    })) as ImportedCampaignRecipient[];

  return {
    preview,
    summary,
    recipients
  };
}
