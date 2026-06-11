import {
  campaignTemporaryMessagesConfigSchema,
  type Campaign,
  type Contact,
} from "@nuoma/contracts";
import type { Repositories } from "@nuoma/db";

import { runCampaignSchedulerTick } from "./campaign-scheduler.js";
import { isOverlayEnabled } from "./overlay-eligibility.js";
import { evaluateApiRealSendTarget, normalizePhone, type ApiSendPolicy } from "./send-policy.js";

export interface OverlayCampaignOption {
  id: number;
  name: string;
  status: Campaign["status"];
  channel: Campaign["channel"];
  stepsCount: number;
  firstStepType: Campaign["steps"][number]["type"] | null;
  overlayEnabled: boolean;
  eligible: boolean;
  reasons: string[];
  canDispatchReal: boolean;
}

export interface OverlayCampaignRunResult {
  campaign: {
    id: number;
    name: string;
    status: Campaign["status"];
  } | null;
  phone: string | null;
  recipientsCreated: number;
  jobsCreated: number;
  plannedJobs: number;
  rejected: Array<{ source: "phone"; value: string | number; reason: string }>;
}

export async function listOverlayCampaignOptions(input: {
  repos: Repositories;
  userId: number;
  phone: string | null;
  sendPolicy: ApiSendPolicy;
  limit?: number;
}): Promise<OverlayCampaignOption[]> {
  const phone = normalizePhone(input.phone);
  const contact = phone
    ? await input.repos.contacts.findByPhone({ userId: input.userId, phone })
    : null;
  const campaigns = await input.repos.campaigns.list(input.userId);
  const evaluated = await Promise.all(
    campaigns
      .filter((campaign) => isOverlayEnabled(campaign.metadata))
      .map(async (campaign) => {
        const existingRecipients = await input.repos.campaignRecipients.listByCampaign({
          userId: input.userId,
          campaignId: campaign.id,
          limit: 1_000,
        });
        const activePipeline = phone
          ? await input.repos.campaignRecipients.findActiveByPhone({
              userId: input.userId,
              phone,
              channel: "whatsapp",
            })
          : null;
        return evaluateOverlayCampaign({
          campaign,
          phone,
          contact,
          existingRecipients,
          activePipeline: Boolean(activePipeline),
          sendPolicy: input.sendPolicy,
        });
      }),
  );

  return evaluated
    .sort((a, b) => {
      const eligible = Number(b.eligible) - Number(a.eligible);
      if (eligible !== 0) return eligible;
      const runnable =
        Number(isRunnableManualStatus(b.status)) - Number(isRunnableManualStatus(a.status));
      if (runnable !== 0) return runnable;
      return a.name.localeCompare(b.name, "pt-BR");
    })
    .slice(0, input.limit ?? 5);
}

export async function runOverlayCampaignNow(input: {
  repos: Repositories;
  userId: number;
  campaignId: number;
  phone: string | null;
  sendPolicy: ApiSendPolicy;
  ownerId: string;
  source: string;
  idempotencyKey?: string | null;
}): Promise<OverlayCampaignRunResult> {
  const phone = normalizePhone(input.phone);
  if (!phone) {
    return blockedRun(null, null, "invalid_phone");
  }

  const campaign = await input.repos.campaigns.findById({
    userId: input.userId,
    id: input.campaignId,
  });
  if (!campaign) {
    return blockedRun(null, phone, "campaign_not_found");
  }
  if (!isOverlayEnabled(campaign.metadata)) {
    return blockedRun(campaign, phone, "overlay_not_enabled");
  }
  const replay = replayOverlayRun(campaign, phone, input.idempotencyKey);
  if (replay) {
    return replay;
  }

  const contact = await input.repos.contacts.findByPhone({ userId: input.userId, phone });
  const existingRecipients = await input.repos.campaignRecipients.listByCampaign({
    userId: input.userId,
    campaignId: campaign.id,
    limit: 1_000,
  });
  const activePipeline = await input.repos.campaignRecipients.findActiveByPhone({
    userId: input.userId,
    phone,
    channel: "whatsapp",
  });
  const evaluation = evaluateOverlayCampaign({
    campaign,
    phone,
    contact,
    existingRecipients,
    activePipeline: Boolean(activePipeline),
    sendPolicy: input.sendPolicy,
  });

  if (!evaluation.eligible || !evaluation.canDispatchReal) {
    return blockedRun(campaign, phone, evaluation.reasons[0] ?? "campaign_blocked");
  }

  const nowIso = new Date().toISOString();
  const updatedCampaign = await input.repos.campaigns.update({
    id: campaign.id,
    userId: input.userId,
    status: "running",
    startsAt: campaign.startsAt ?? nowIso,
    metadata: {
      ...campaign.metadata,
      lastOverlayRun: {
        at: nowIso,
        phone,
        byUserId: input.userId,
        source: input.source,
        idempotencyKey: input.idempotencyKey ?? null,
      },
    },
  });

  await input.repos.campaignRecipients.create({
    userId: input.userId,
    campaignId: campaign.id,
    contactId: contact?.id ?? null,
    phone,
    channel: campaign.channel,
    status: "queued",
    currentStepId: null,
    lastError: null,
    metadata: {
      source: input.source,
      candidateSource: "overlay-phone",
      variables: {
        telefone: phone,
        phone,
      },
    },
  });

  const scheduler = await runCampaignSchedulerTick({
    repos: input.repos,
    userId: input.userId,
    ownerId: input.ownerId,
    campaignId: campaign.id,
    limit: 1,
    evergreenLimit: 0,
    dryRun: false,
  });

  await input.repos.systemEvents.create({
    userId: input.userId,
    type: "campaign.overlay.dispatched",
    severity: "info",
    payload: JSON.stringify({
      campaignId: campaign.id,
      phone,
      jobsCreated: scheduler.jobsCreated,
      plannedJobs: scheduler.plannedJobs.length,
      source: input.source,
      idempotencyKey: input.idempotencyKey ?? null,
      dispatchedAtUtc: nowIso,
    }),
  });

  const result = {
    campaign: {
      id: updatedCampaign?.id ?? campaign.id,
      name: updatedCampaign?.name ?? campaign.name,
      status: updatedCampaign?.status ?? "running",
    },
    phone,
    recipientsCreated: 1,
    jobsCreated: scheduler.jobsCreated,
    plannedJobs: scheduler.plannedJobs.length,
    rejected: [],
  } satisfies OverlayCampaignRunResult;

  await input.repos.campaigns.update({
    id: campaign.id,
    userId: input.userId,
    metadata: {
      ...(updatedCampaign?.metadata ?? campaign.metadata),
      lastOverlayRun: {
        at: nowIso,
        phone,
        byUserId: input.userId,
        source: input.source,
        idempotencyKey: input.idempotencyKey ?? null,
        result: {
          recipientsCreated: result.recipientsCreated,
          jobsCreated: result.jobsCreated,
          plannedJobs: result.plannedJobs,
        },
      },
    },
  });

  return result;
}

function replayOverlayRun(
  campaign: Campaign,
  phone: string,
  idempotencyKey: string | null | undefined,
): OverlayCampaignRunResult | null {
  if (!idempotencyKey) {
    return null;
  }
  const lastRun = objectRecord(campaign.metadata.lastOverlayRun);
  if (lastRun.idempotencyKey !== idempotencyKey || lastRun.phone !== phone) {
    return null;
  }
  const previousResult = objectRecord(lastRun.result);
  return {
    campaign: {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
    },
    phone,
    recipientsCreated: numberFromUnknown(previousResult.recipientsCreated) ?? 0,
    jobsCreated: numberFromUnknown(previousResult.jobsCreated) ?? 0,
    plannedJobs: numberFromUnknown(previousResult.plannedJobs) ?? 0,
    rejected: [],
  };
}

function evaluateOverlayCampaign(input: {
  campaign: Campaign;
  phone: string | null;
  contact: Contact | null;
  existingRecipients: Array<{ contactId: number | null; phone: string | null }>;
  activePipeline: boolean;
  sendPolicy: ApiSendPolicy;
}): OverlayCampaignOption {
  const reasons: string[] = [];
  const firstStep = input.campaign.steps[0] ?? null;
  const phone = normalizePhone(input.phone);
  const existingKeys = new Set(
    input.existingRecipients.flatMap((recipient) => {
      const keys = [];
      if (recipient.contactId) keys.push(`contact:${recipient.contactId}`);
      const recipientPhone = normalizePhone(recipient.phone);
      if (recipientPhone) keys.push(`phone:${recipientPhone}`);
      return keys;
    }),
  );

  if (!isRunnableManualCampaign(input.campaign)) reasons.push("status_not_runnable");
  if (!isOverlayEnabled(input.campaign.metadata)) reasons.push("overlay_not_enabled");
  if (hasLegacyStepNormalization(input.campaign)) reasons.push("legacy_campaign_steps_need_review");
  if (input.campaign.channel !== "whatsapp") reasons.push("channel_not_supported");
  if (!phone) reasons.push("invalid_phone");
  if (input.contact && !isContactRemarketingAllowed(input.contact)) {
    reasons.push(`contact_${input.contact.status}_suppressed`);
  }
  if (input.contact?.id && existingKeys.has(`contact:${input.contact.id}`)) {
    reasons.push("duplicate_recipient");
  } else if (phone && existingKeys.has(`phone:${phone}`)) {
    reasons.push("duplicate_recipient");
  }
  if (input.activePipeline) reasons.push("active_pipeline_for_phone");
  if (input.campaign.steps.length === 0) reasons.push("campaign_without_steps");
  if (hasEmptyMessageStep(input.campaign)) reasons.push("empty_message_step");
  const temporaryMessagesIssue = campaignTemporaryMessagesGateIssue(input.campaign);
  if (temporaryMessagesIssue) reasons.push(temporaryMessagesIssue);
  const sendDecision = phone
    ? evaluateApiRealSendTarget(input.sendPolicy, phone)
    : ({ allowed: false, reason: "invalid_phone" } as const);
  if (!sendDecision.allowed) reasons.push(sendDecision.reason);
  const eligible = reasons.length === 0;

  return {
    id: input.campaign.id,
    name: input.campaign.name,
    status: input.campaign.status,
    channel: input.campaign.channel,
    stepsCount: input.campaign.steps.length,
    firstStepType: firstStep?.type ?? null,
    overlayEnabled: isOverlayEnabled(input.campaign.metadata),
    eligible,
    reasons,
    canDispatchReal: eligible && sendDecision.allowed,
  };
}

function blockedRun(
  campaign: Campaign | null,
  phone: string | null,
  reason: string,
): OverlayCampaignRunResult {
  return {
    campaign: campaign
      ? {
          id: campaign.id,
          name: campaign.name,
          status: campaign.status,
        }
      : null,
    phone,
    recipientsCreated: 0,
    jobsCreated: 0,
    plannedJobs: 0,
    rejected: [{ source: "phone", value: phone ?? "", reason }],
  };
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numberFromUnknown(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRunnableManualCampaign(campaign: Campaign): boolean {
  return isRunnableManualStatus(campaign.status);
}

function hasLegacyStepNormalization(campaign: Campaign): boolean {
  const value = campaign.metadata.legacyStepNormalization;
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isRunnableManualStatus(status: Campaign["status"]): boolean {
  return status === "running" || status === "scheduled";
}

function isContactRemarketingAllowed(contact: Contact): boolean {
  return contact.status !== "blocked" && contact.status !== "archived" && !contact.deletedAt;
}

function hasEmptyMessageStep(campaign: Campaign): boolean {
  return campaign.steps.some(
    (step) =>
      (step.type === "text" && !step.template.trim()) ||
      (step.type === "link" && !step.text.trim()),
  );
}

function campaignTemporaryMessagesGateIssue(campaign: Campaign): string | null {
  const hasTemporaryMessagesControl = campaign.steps.some(
    (step) => step.type === "temporary_messages",
  );
  if (hasTemporaryMessagesControl) {
    return null;
  }
  const parsed = campaignTemporaryMessagesConfigSchema.safeParse(
    campaign.metadata.temporaryMessages,
  );
  if (!parsed.success || !parsed.data.enabled) {
    return "temporary_messages_audit_only";
  }
  if (parsed.data.beforeSendDuration !== "24h" || parsed.data.afterCompletionDuration !== "90d") {
    return "temporary_messages_global_not_m303";
  }
  return null;
}
