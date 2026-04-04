import { getDb } from "../db/connection.js";
import { InputError } from "../errors/app-error.js";
import {
  applyTagToContact,
  createAssistedContact,
  createContact,
  getContactById,
  getContactByInstagram,
  getContactByPhone,
  removeTagFromContact,
  updateAssistedContact
} from "../repositories/contact-repository.js";
import {
  advanceCampaignRecipient,
  completeCampaignRecipient,
  getCampaign,
  getCampaignRecipient,
  getDueCampaignRecipients,
  listCampaignRecipients,
  markCampaignRecipientFailed,
  markCampaignRecipientProcessing,
  setCampaignStatus,
  updateCampaignRecipientContact
} from "../repositories/campaign-repository.js";
import { getInstagramThreadIdForContact, isContactChannelValueInactive } from "../repositories/contact-channel-repository.js";
import { getLatestConversationForContactChannel } from "../repositories/conversation-repository.js";
import { enqueueJob } from "../repositories/job-repository.js";
import { getWorkerState, recordSystemEvent } from "../repositories/system-repository.js";
import { normalizeTagName } from "../repositories/tag-repository.js";
import { loadEnv } from "../config/env.js";
import type { ChannelType, ContactInput, ContactRecord } from "../types/domain.js";
import { looksLikeValidWhatsAppCandidate, normalizeInstagramHandle } from "../utils/phone.js";
import { resolveTemplateVars } from "../utils/template-vars.js";
import { addMinutes, addSeconds, isWithinTimeWindow, nextWindowStartIso, randomBetween } from "../utils/time.js";

const hhmmPattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

type CampaignRecipientRow = {
  id: string;
  campaign_id: string;
  contact_id: string | null;
  channel: ChannelType;
  phone: string | null;
  instagram: string | null;
  target_display_value: string | null;
  target_normalized_value: string | null;
  name: string | null;
  status: string;
  step_index: number;
  next_run_at: string | null;
  last_attempt_at: string | null;
  last_error: string | null;
  tags_json: string | null;
  extra_json: string | null;
};

function parseJsonArray(input: string | null | undefined) {
  if (!input) {
    return [];
  }

  try {
    const parsed = JSON.parse(input) as unknown[];
    return Array.isArray(parsed) ? parsed.map((item) => String(item).trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function parseRecipient(row: Record<string, unknown>) {
  return row as CampaignRecipientRow;
}

function countRecentCampaignMessages(windowMinutes: number, channel: ChannelType) {
  const db = getDb();
  const row = db
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM messages
        WHERE direction = 'outgoing'
          AND channel = ?
          AND datetime(created_at) >= datetime('now', '-' || ? || ' minutes')
          AND meta_json LIKE '%"source":"campaign"%'
      `
    )
    .get(channel, windowMinutes) as { count: number };

  return Number(row.count ?? 0);
}

const STATE_FRESHNESS_SECONDS = 120; // Consider state stale after 2 minutes

function isStateFresh(state: Record<string, unknown> | null): boolean {
  if (!state) return false;
  const updatedAt = String((state as Record<string, unknown>).updatedAt ?? (state as Record<string, unknown>).updated_at ?? "");
  if (!updatedAt) return false;
  const ageMs = Date.now() - new Date(updatedAt).getTime();
  return ageMs < STATE_FRESHNESS_SECONDS * 1000;
}

function getChannelAvailability(channel: ChannelType) {
  if (channel === "whatsapp") {
    const state = getWorkerState("wa-worker");
    if (!isStateFresh(state as Record<string, unknown> | null)) return false; // Stale state = unavailable
    const payload = state?.value && typeof state.value === "object" ? (state.value as Record<string, unknown>) : {};
    const status = String(payload.status ?? "");
    return status === "authenticated" || status === "degraded";
  }

  const state = getWorkerState("instagram-assisted");
  // Freshness check relaxed for Instagram assisted mode (state updates every heartbeat)
  const payload = state?.value && typeof state.value === "object" ? (state.value as Record<string, unknown>) : {};
  return payload.authenticated === true || payload.status === "connected";
}

function normalizeInstagramDisplay(input?: string | null) {
  const normalized = normalizeInstagramHandle(input);
  return normalized ? `@${normalized}` : null;
}

function buildContactInputFromRecipient(recipient: CampaignRecipientRow, existing?: ContactRecord | null): ContactInput & { syncWhatsAppChannel?: boolean } {
  const phone = recipient.phone?.trim() ?? "";
  const instagram =
    normalizeInstagramDisplay(recipient.instagram) ??
    (recipient.channel === "instagram" ? normalizeInstagramDisplay(recipient.target_normalized_value) : null);
  const tags = parseJsonArray(recipient.tags_json);
  const name = recipient.name?.trim() || existing?.name || recipient.target_display_value?.trim() || instagram || phone || "Contato campanha";
  const syncWhatsAppChannel = Boolean(phone && looksLikeValidWhatsAppCandidate(phone));

  return {
    name,
    phone,
    cpf: existing?.cpf ?? null,
    email: existing?.email ?? null,
    instagram: instagram ?? existing?.instagram ?? null,
    procedureStatus: existing?.procedureStatus ?? "unknown",
    lastAttendant: existing?.lastAttendant ?? null,
    notes: existing?.notes ?? null,
    status: existing?.status ?? "novo",
    tags: existing?.tags ?? tags,
    lastInteractionAt: existing?.lastInteractionAt ?? null,
    lastProcedureAt: existing?.lastProcedureAt ?? null,
    syncWhatsAppChannel
  };
}

function applyImportedTags(contact: ContactRecord, recipient: CampaignRecipientRow) {
  const importedTags = parseJsonArray(recipient.tags_json);
  for (const tagName of importedTags) {
    if (!contact.tags.some((tag) => normalizeTagName(tag) === normalizeTagName(tagName))) {
      applyTagToContact(contact.id, tagName, "campaign");
    }
  }
}

function ensureCampaignRecipientContact(recipient: CampaignRecipientRow) {
  let contact =
    (recipient.contact_id ? getContactById(recipient.contact_id) : null) ??
    (recipient.phone ? getContactByPhone(recipient.phone) : null) ??
    (recipient.instagram ? getContactByInstagram(recipient.instagram) : null) ??
    (recipient.channel === "instagram" && recipient.target_normalized_value ? getContactByInstagram(recipient.target_normalized_value) : null);

  if (!contact) {
    const input = buildContactInputFromRecipient(recipient);
    contact =
      recipient.channel === "instagram"
        ? createAssistedContact(input, "campaign")
        : createContact(
            {
              ...input,
              phone: recipient.phone?.trim() ?? input.phone
            },
            "campaign"
          );
  } else {
    const input = buildContactInputFromRecipient(recipient, contact);
    const needsUpdate =
      input.name !== contact.name ||
      input.phone !== contact.phone ||
      input.instagram !== contact.instagram;

    if (needsUpdate) {
      contact = updateAssistedContact(contact.id, input, "campaign") ?? contact;
    }
  }

  if (!contact) {
    return null;
  }

  applyImportedTags(contact, recipient);
  updateCampaignRecipientContact(recipient.id, contact.id);
  return getContactById(contact.id) ?? contact;
}

function resolveRecipientExternalThreadId(recipient: CampaignRecipientRow, contact: ContactRecord | null) {
  if (recipient.channel === "whatsapp") {
    return recipient.target_normalized_value ?? recipient.phone;
  }

  if (!contact?.id) {
    return null;
  }

  return getLatestConversationForContactChannel(contact.id, "instagram")?.externalThreadId ?? getInstagramThreadIdForContact(contact.id) ?? null;
}

export function getCampaignActivationIssues(campaignId: string) {
  const campaign = getCampaign(campaignId);
  if (!campaign) {
    return [];
  }

  const issues: string[] = [];
  if (!campaign.name.trim()) {
    issues.push("Defina um nome para a campanha.");
  }

  if (!campaign.eligibleChannels.length) {
    issues.push("Selecione ao menos um canal elegível para a campanha.");
  }

  if (!hhmmPattern.test(campaign.sendWindowStart) || !hhmmPattern.test(campaign.sendWindowEnd)) {
    issues.push("Revise a janela de envio no formato HH:mm.");
  }

  if (campaign.sendWindowStart === campaign.sendWindowEnd) {
    issues.push("A janela de envio precisa ter inicio e fim diferentes.");
  }

  if (campaign.randomDelayMaxSeconds < campaign.randomDelayMinSeconds) {
    issues.push("O delay maximo nao pode ser menor que o delay minimo.");
  }

  if (campaign.totalRecipients <= 0) {
    issues.push("Importe pelo menos um destinatario antes de ativar.");
  }

  if (campaign.steps.length === 0) {
    issues.push("Adicione pelo menos uma etapa no builder.");
  }

  campaign.steps.forEach((step, index) => {
    const label = `Etapa ${index + 1}`;
    const hasText = step.content.trim().length > 0;
    const hasCaption = step.caption.trim().length > 0;
    const hasMedia = Boolean(step.mediaPath);

    if (step.channelScope !== "any" && !campaign.eligibleChannels.includes(step.channelScope)) {
      issues.push(`${label}: o escopo da etapa precisa estar entre os canais elegíveis da campanha.`);
    }

    if (step.type === "wait") {
      if (!step.waitMinutes || step.waitMinutes < 1) {
        issues.push(`${label}: informe um tempo de espera valido.`);
      }
      return;
    }

    if (step.type === "ADD_TAG" || step.type === "REMOVE_TAG") {
      if (!step.tagName?.trim()) {
        issues.push(`${label}: informe a tag que sera alterada.`);
      }
      return;
    }

    if ((step.type === "text" || step.type === "link") && !hasText) {
      issues.push(`${label}: etapas de ${step.type} precisam de conteudo.`);
    }

    if (!["text", "link", "wait", "ADD_TAG", "REMOVE_TAG"].includes(step.type) && !hasMedia) {
      issues.push(`${label}: etapas de ${step.type} precisam de midia enviada.`);
    }

    if (!hasText && !hasCaption && !hasMedia) {
      issues.push(`${label}: preencha conteudo, legenda ou midia antes de ativar.`);
    }
  });

  return [...new Set(issues)];
}

export function syncCampaignRecipientContacts(campaignId: string) {
  const recipients = listCampaignRecipients(campaignId).map(parseRecipient);
  let synced = 0;

  for (const recipient of recipients) {
    if (ensureCampaignRecipientContact(recipient)) {
      synced += 1;
    }
  }

  return synced;
}

export function processCampaignTick() {
  const env = loadEnv();
  if (!env.ENABLE_CAMPAIGNS) {
    return { queued: 0, skipped: true };
  }

  let queued = 0;
  const dueRecipients = getDueCampaignRecipients().map(parseRecipient);

  // Pre-fetch campaigns to avoid N+1 queries (Fix: architecture risk #4)
  const campaignCache = new Map<string, ReturnType<typeof getCampaign>>();
  const uniqueCampaignIds = [...new Set(dueRecipients.map((r) => r.campaign_id))];
  for (const cid of uniqueCampaignIds) {
    campaignCache.set(cid, getCampaign(cid));
  }

  for (const recipient of dueRecipients) {
    const campaign = campaignCache.get(recipient.campaign_id) ?? null;
    if (!campaign) {
      continue;
    }

    if (recipient.channel === "instagram" && isContactChannelValueInactive("instagram", recipient.target_normalized_value ?? recipient.instagram)) {
      const instagramHandle = normalizeInstagramDisplay(recipient.target_normalized_value ?? recipient.instagram);
      markCampaignRecipientFailed(
        recipient.id,
        `Perfil ${instagramHandle ?? "do Instagram"} marcado como inativo apos falha de validacao da URL.`,
        "blocked_by_rule"
      );
      continue;
    }

    const contact = ensureCampaignRecipientContact(recipient);
    if (contact?.tags.some((tag) => normalizeTagName(tag) === "nao_insistir")) {
      markCampaignRecipientFailed(recipient.id, "Blocked by nao_insistir tag", "blocked_by_rule");
      continue;
    }

    if (!getChannelAvailability(recipient.channel)) {
      advanceCampaignRecipient(recipient.id, recipient.step_index, addMinutes(5), "pending");
      continue;
    }

    if (!isWithinTimeWindow(campaign.sendWindowStart, campaign.sendWindowEnd, env.DEFAULT_TIMEZONE)) {
      advanceCampaignRecipient(recipient.id, recipient.step_index, nextWindowStartIso(campaign.sendWindowStart, campaign.sendWindowEnd, env.DEFAULT_TIMEZONE), "pending");
      continue;
    }

    if (countRecentCampaignMessages(campaign.rateLimitWindowMinutes, recipient.channel) >= campaign.rateLimitCount) {
      advanceCampaignRecipient(recipient.id, recipient.step_index, addMinutes(5), "pending");
      continue;
    }

    const step = campaign.steps[recipient.step_index];
    if (!step) {
      completeCampaignRecipient(recipient.id);
      continue;
    }

    if (step.channelScope !== "any" && step.channelScope !== recipient.channel) {
      advanceCampaignRecipient(recipient.id, recipient.step_index + 1, addSeconds(1), "pending");
      continue;
    }

    if (step.type === "wait") {
      advanceCampaignRecipient(recipient.id, recipient.step_index + 1, addMinutes(step.waitMinutes ?? 1), "pending");
      continue;
    }

    if (step.type === "ADD_TAG" || step.type === "REMOVE_TAG") {
      if (!contact || !step.tagName?.trim()) {
        markCampaignRecipientFailed(recipient.id, "Step de tag sem contato ou tag válida");
        continue;
      }

      if (step.type === "ADD_TAG") {
        applyTagToContact(contact.id, step.tagName, "campaign");
      } else {
        removeTagFromContact(contact.id, step.tagName, "campaign");
      }

      advanceCampaignRecipient(recipient.id, recipient.step_index + 1, addSeconds(1), "pending");
      continue;
    }

    if (!["text", "link"].includes(step.type) && !step.mediaPath) {
      markCampaignRecipientFailed(recipient.id, `Step ${step.type} requires uploaded media`);
      continue;
    }

    if (!step.content && !step.mediaPath) {
      markCampaignRecipientFailed(recipient.id, "Step without content or media");
      continue;
    }

    const jobId = enqueueJob({
      type: recipient.channel === "instagram" ? "send-assisted-message" : "send-message",
      dedupeKey: `campaign:${recipient.id}:${step.id}:${recipient.channel}`,
      payload: {
        source: "campaign",
        channel: recipient.channel,
        externalThreadId: resolveRecipientExternalThreadId(recipient, contact),
        recipientDisplayValue: recipient.target_display_value ?? recipient.name ?? recipient.phone ?? recipient.instagram,
        recipientNormalizedValue: recipient.target_normalized_value ?? recipient.phone ?? recipient.instagram,
        phone: recipient.phone,
        contactId: contact?.id ?? recipient.contact_id,
        recipientId: recipient.id,
        campaignId: recipient.campaign_id,
        stepId: step.id,
        contentType: step.type,
        text: contact ? resolveTemplateVars(step.content, contact) : step.content,
        mediaPath: step.mediaPath,
        caption: contact ? resolveTemplateVars(step.caption || step.content, contact) : (step.caption || step.content)
      }
    });

    markCampaignRecipientProcessing(recipient.id);
    recordSystemEvent("scheduler", "info", "Campaign send queued", {
      campaignId: recipient.campaign_id,
      recipientId: recipient.id,
      channel: recipient.channel,
      jobId
    });
    queued += 1;
  }

  return { queued, skipped: false };
}

export function handleCampaignJobSuccess(input: { recipientId: string; campaignId: string }) {
  const recipient = getCampaignRecipient(input.recipientId);
  const campaign = getCampaign(input.campaignId);
  if (!recipient || !campaign) {
    return;
  }

  const nextStepIndex = Number(recipient.step_index) + 1;
  const delay = randomBetween(campaign.randomDelayMinSeconds, campaign.randomDelayMaxSeconds);

  if (nextStepIndex >= campaign.steps.length) {
    completeCampaignRecipient(input.recipientId);
    return;
  }

  advanceCampaignRecipient(input.recipientId, nextStepIndex, addSeconds(delay), "pending");
}

export function handleCampaignJobFailure(recipientId: string, error: string) {
  markCampaignRecipientFailed(recipientId, error);
}

export function activateCampaign(campaignId: string) {
  const issues = getCampaignActivationIssues(campaignId);
  if (issues.length > 0) {
    throw new InputError(issues[0]);
  }

  return setCampaignStatus(campaignId, "active");
}

export function pauseCampaign(campaignId: string) {
  return setCampaignStatus(campaignId, "paused");
}

export function cancelCampaign(campaignId: string) {
  return setCampaignStatus(campaignId, "cancelled");
}
