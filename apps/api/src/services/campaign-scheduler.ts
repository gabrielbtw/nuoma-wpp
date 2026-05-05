import {
  campaignTemporaryMessagesConfigSchema,
  type Campaign,
  type CampaignRecipient,
  type CampaignStep,
  type CampaignTemporaryMessagesConfig,
  type Contact,
} from "@nuoma/contracts";
import type { Repositories } from "@nuoma/db";

import {
  applyCampaignAbVariantToStep,
  campaignAbAssignmentMetadata,
  resolveCampaignAbVariant,
  type CampaignAbVariant,
} from "./campaign-ab-variants.js";
import { segmentMatches } from "./segment-match.js";

interface CampaignSchedulerTickInput {
  repos: Repositories;
  userId: number;
  ownerId: string;
  campaignId?: number;
  now?: Date;
  limit?: number;
  evergreenLimit?: number;
  dryRun?: boolean;
}

export interface CampaignSchedulerTickResult {
  dryRun: boolean;
  acquired: boolean;
  campaignsScanned: number;
  recipientsScanned: number;
  jobsCreated: number;
  recipientsCompleted: number;
  recipientsSkipped: number;
  evergreenCampaignsScanned: number;
  evergreenContactsScanned: number;
  evergreenRecipientsPlanned: number;
  evergreenRecipientsCreated: number;
  evergreenRecipientsSkipped: number;
  plannedJobs: Array<{
    campaignId: number;
    recipientId: number;
    stepId: string;
    stepType: CampaignStep["type"];
    phone: string;
    scheduledAt: string;
    isLastStep: boolean;
    variantId: string | null;
    variantLabel: string | null;
    batchIndex: number;
    batchSize: number;
    temporaryMessages: CampaignTemporaryMessagesConfig | null;
  }>;
  errors: Array<{ recipientId: number; error: string }>;
}

export async function runCampaignSchedulerTick(
  input: CampaignSchedulerTickInput,
): Promise<CampaignSchedulerTickResult> {
  const now = input.now ?? new Date();
  const limit = input.limit ?? 50;
  const evergreenLimit = input.evergreenLimit ?? Math.max(limit, 100);
  const lockName = `campaign-scheduler:user:${input.userId}`;
  const dryRun = input.dryRun ?? false;
  const acquired = dryRun
    ? true
    : await input.repos.schedulerLocks.acquire({
        name: lockName,
        ownerId: input.ownerId,
        ttlMs: 30_000,
      });
  const result: CampaignSchedulerTickResult = {
    dryRun,
    acquired,
    campaignsScanned: 0,
    recipientsScanned: 0,
    jobsCreated: 0,
    recipientsCompleted: 0,
    recipientsSkipped: 0,
    evergreenCampaignsScanned: 0,
    evergreenContactsScanned: 0,
    evergreenRecipientsPlanned: 0,
    evergreenRecipientsCreated: 0,
    evergreenRecipientsSkipped: 0,
    plannedJobs: [],
    errors: [],
  };

  if (!acquired) {
    return result;
  }

  try {
    const campaigns = (await input.repos.campaigns.list(input.userId)).filter(
      (campaign) =>
        (input.campaignId === undefined || campaign.id === input.campaignId) &&
        isRunnableCampaign(campaign, now),
    );
    result.campaignsScanned = campaigns.length;

    for (const campaign of campaigns) {
      await evaluateEvergreenCampaign({
        repos: input.repos,
        userId: input.userId,
        campaign,
        now,
        dryRun,
        limit: evergreenLimit,
        result,
      });

      if (result.recipientsScanned >= limit) {
        break;
      }

      const recipients = await input.repos.campaignRecipients.listByCampaign({
        userId: input.userId,
        campaignId: campaign.id,
        statuses: ["queued", "running"],
        limit: limit - result.recipientsScanned,
      });

      for (const recipient of recipients) {
        result.recipientsScanned += 1;
        await enqueueRecipientNextStep({
          repos: input.repos,
          userId: input.userId,
          campaign,
          recipient,
          now,
          dryRun,
          result,
        });
      }
    }

    return result;
  } finally {
    if (!dryRun) {
      await input.repos.schedulerLocks.release({ name: lockName, ownerId: input.ownerId });
    }
  }
}

async function evaluateEvergreenCampaign(input: {
  repos: Repositories;
  userId: number;
  campaign: Campaign;
  now: Date;
  dryRun: boolean;
  limit: number;
  result: CampaignSchedulerTickResult;
}): Promise<void> {
  if (!input.campaign.evergreen) {
    return;
  }

  input.result.evergreenCampaignsScanned += 1;
  const contacts = await input.repos.contacts.list({
    userId: input.userId,
    limit: input.limit,
  });
  const existingRecipients = await input.repos.campaignRecipients.listByCampaign({
    userId: input.userId,
    campaignId: input.campaign.id,
    limit: 10_000,
  });
  const existingKeys = new Set(
    existingRecipients.flatMap((recipient) => {
      const keys = [];
      if (recipient.contactId) keys.push(`contact:${recipient.contactId}`);
      const phone = normalizePhone(recipient.phone);
      if (phone) keys.push(`phone:${phone}`);
      return keys;
    }),
  );

  input.result.evergreenContactsScanned += contacts.length;
  let created = 0;
  let planned = 0;
  let skipped = 0;
  for (const contact of contacts) {
    const evaluation = evaluateEvergreenContact({
      campaign: input.campaign,
      contact,
      existingKeys,
    });
    if (!evaluation.eligible) {
      skipped += 1;
      continue;
    }

    planned += 1;
    input.result.evergreenRecipientsPlanned += 1;
    if (input.dryRun) {
      existingKeys.add(`contact:${contact.id}`);
      if (evaluation.phone) existingKeys.add(`phone:${evaluation.phone}`);
      continue;
    }

    await input.repos.campaignRecipients.create({
      userId: input.userId,
      campaignId: input.campaign.id,
      contactId: contact.id,
      phone: evaluation.phone,
      channel: input.campaign.channel,
      status: "queued",
      currentStepId: null,
      lastError: null,
      metadata: {
        source: "campaign_scheduler.evergreen",
        evergreen: true,
        evaluatedAt: input.now.toISOString(),
        variables: variablesForContact(contact, evaluation.phone),
      },
    });
    existingKeys.add(`contact:${contact.id}`);
    if (evaluation.phone) existingKeys.add(`phone:${evaluation.phone}`);
    created += 1;
    input.result.evergreenRecipientsCreated += 1;
  }
  input.result.evergreenRecipientsSkipped += skipped;

  if (input.dryRun) {
    return;
  }

  await input.repos.campaigns.update({
    userId: input.userId,
    id: input.campaign.id,
    metadata: {
      ...input.campaign.metadata,
      lastEvergreenEvaluation: {
        at: input.now.toISOString(),
        contactsScanned: contacts.length,
        recipientsPlanned: planned,
        recipientsCreated: created,
        recipientsSkipped: skipped,
      },
    },
  });
  await input.repos.systemEvents.create({
    userId: input.userId,
    type: "campaign.evergreen.evaluated",
    severity: "info",
    payload: JSON.stringify({
      campaignId: input.campaign.id,
      contactsScanned: contacts.length,
      recipientsPlanned: planned,
      recipientsCreated: created,
      recipientsSkipped: skipped,
    }),
  });
}

function evaluateEvergreenContact(input: {
  campaign: Campaign;
  contact: Contact;
  existingKeys: Set<string>;
}): { eligible: true; phone: string | null } | { eligible: false } {
  if (input.contact.primaryChannel !== input.campaign.channel) {
    return { eligible: false };
  }
  if (!segmentMatches(input.campaign.segment, input.contact, input.contact.primaryChannel)) {
    return { eligible: false };
  }

  const phone = input.campaign.channel === "whatsapp" ? normalizePhone(input.contact.phone) : null;
  if (input.campaign.channel === "whatsapp" && !phone) {
    return { eligible: false };
  }
  if (input.existingKeys.has(`contact:${input.contact.id}`)) {
    return { eligible: false };
  }
  if (phone && input.existingKeys.has(`phone:${phone}`)) {
    return { eligible: false };
  }
  return { eligible: true, phone };
}

async function enqueueRecipientNextStep(input: {
  repos: Repositories;
  userId: number;
  campaign: Campaign;
  recipient: CampaignRecipient;
  now: Date;
  dryRun: boolean;
  result: CampaignSchedulerTickResult;
}): Promise<void> {
  try {
    if (
      numberFromUnknown(input.recipient.metadata.awaitingJobId) ||
      numericArrayFromUnknown(input.recipient.metadata.awaitingJobIds).length > 0
    ) {
      return;
    }

    if (input.recipient.channel !== "whatsapp") {
      await markRecipientSkipped(input, `unsupported channel: ${input.recipient.channel}`);
      return;
    }

    const phone = normalizePhone(input.recipient.phone);
    if (!phone) {
      await markRecipientSkipped(input, "missing WhatsApp phone");
      return;
    }

    const next = nextStepForRecipient(input.campaign.steps, input.recipient.currentStepId);
    if (next.mode === "completed") {
      if (input.dryRun) {
        input.result.recipientsCompleted += 1;
        return;
      }
      await input.repos.campaignRecipients.updateState({
        userId: input.userId,
        id: input.recipient.id,
        status: "completed",
        lastError: null,
        metadata: {
          ...input.recipient.metadata,
          completedAt: input.now.toISOString(),
        },
      });
      input.result.recipientsCompleted += 1;
      return;
    }
    if (next.mode === "invalid") {
      await markRecipientSkipped(input, next.error);
      return;
    }

    const abVariant = resolveCampaignAbVariant({
      campaign: input.campaign,
      recipient: input.recipient,
    });
    const temporaryMessages = temporaryMessagesConfigFromCampaign(input.campaign);
    const batch = campaignStepBatch({
      campaign: input.campaign,
      startStepId: next.step.id,
      variant: abVariant,
      now: input.now,
    });
    for (const item of batch) {
      input.result.plannedJobs.push({
        campaignId: input.campaign.id,
        recipientId: input.recipient.id,
        stepId: item.step.id,
        stepType: item.step.type,
        phone,
        scheduledAt: item.scheduledAt,
        isLastStep: item.isLastStep,
        variantId: abVariant?.id ?? null,
        variantLabel: abVariant?.label ?? null,
        batchIndex: item.batchIndex,
        batchSize: batch.length,
        temporaryMessages,
      });
    }

    if (input.dryRun) {
      return;
    }

    const existingConversation = await input.repos.conversations.findByExternalThread({
      userId: input.userId,
      channel: "whatsapp",
      externalThreadId: phone,
    });
    const conversation = await input.repos.conversations.upsertObserved({
      userId: input.userId,
      channel: "whatsapp",
      externalThreadId: phone,
      title: usefulConversationTitle(existingConversation?.title) ?? phone,
      contactId: input.recipient.contactId,
    });
    const batchId = `campaign:${input.campaign.id}:recipient:${input.recipient.id}:batch:${input.now.getTime()}`;
    const createdJobs = [];
    for (const item of batch) {
      const job = await input.repos.jobs.create({
        userId: input.userId,
        type: "campaign_step",
        status: "queued",
        payload: {
          campaignId: input.campaign.id,
          recipientId: input.recipient.id,
          conversationId: conversation.id,
          phone,
          step: jsonObjectFromStep(item.step),
          variables: variablesForRecipient(input.recipient, phone),
          isLastStep: item.isLastStep,
          variantId: abVariant?.id ?? null,
          variantLabel: abVariant?.label ?? null,
          campaignBatchId: batchId,
          campaignBatchIndex: item.batchIndex,
          campaignBatchSize: batch.length,
          temporaryMessages,
        },
        dedupeKey: `campaign_step:${input.campaign.id}:${input.recipient.id}:${item.step.id}`,
        scheduledAt: item.scheduledAt,
        priority: 5,
        maxAttempts: 3,
      });
      if (job) {
        createdJobs.push({ job, step: item.step });
      }
    }

    if (createdJobs.length === 0) {
      return;
    }

    await input.repos.campaignRecipients.updateState({
      userId: input.userId,
      id: input.recipient.id,
      status: "running",
      lastError: null,
      metadata: {
        ...campaignAbAssignmentMetadata({
          metadata: input.recipient.metadata,
          variant: abVariant,
          now: input.now,
        }),
        awaitingJobId: createdJobs[0]?.job.id ?? null,
        awaitingStepId: createdJobs[0]?.step.id ?? null,
        awaitingJobIds: createdJobs.map((item) => item.job.id),
        awaitingStepIds: createdJobs.map((item) => item.step.id),
        campaignBatchId: batchId,
        temporaryMessages,
        lastEnqueuedAt: input.now.toISOString(),
      },
    });
    input.result.jobsCreated += createdJobs.length;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    input.result.errors.push({ recipientId: input.recipient.id, error: message });
    if (input.dryRun) {
      return;
    }
    await input.repos.campaignRecipients.updateState({
      userId: input.userId,
      id: input.recipient.id,
      status: "failed",
      lastError: message,
      metadata: {
        ...input.recipient.metadata,
        failedAt: input.now.toISOString(),
      },
    });
  }
}

async function markRecipientSkipped(
  input: {
    repos: Repositories;
    userId: number;
    recipient: CampaignRecipient;
    now: Date;
    dryRun?: boolean;
    result: CampaignSchedulerTickResult;
  },
  reason: string,
): Promise<void> {
  if (input.dryRun) {
    input.result.recipientsSkipped += 1;
    return;
  }
  await input.repos.campaignRecipients.updateState({
    userId: input.userId,
    id: input.recipient.id,
    status: "skipped",
    lastError: reason,
    metadata: {
      ...input.recipient.metadata,
      skippedAt: input.now.toISOString(),
    },
  });
  input.result.recipientsSkipped += 1;
}

function isRunnableCampaign(campaign: Campaign, now: Date): boolean {
  if (campaign.status !== "running" && campaign.status !== "scheduled") {
    return false;
  }
  if (!campaign.startsAt) {
    return true;
  }
  return new Date(campaign.startsAt).getTime() <= now.getTime();
}

function nextStepForRecipient(
  steps: CampaignStep[],
  currentStepId: string | null,
):
  | { mode: "step"; step: CampaignStep; isLastStep: boolean }
  | { mode: "completed" }
  | { mode: "invalid"; error: string } {
  if (!currentStepId) {
    const first = steps[0];
    return first ? { mode: "step", step: first, isLastStep: steps.length === 1 } : { mode: "completed" };
  }

  const currentIndex = steps.findIndex((step) => step.id === currentStepId);
  if (currentIndex < 0) {
    return { mode: "invalid", error: `current step not found: ${currentStepId}` };
  }

  const next = steps[currentIndex + 1];
  if (!next) {
    return { mode: "completed" };
  }
  return { mode: "step", step: next, isLastStep: currentIndex + 1 === steps.length - 1 };
}

function campaignStepBatch(input: {
  campaign: Campaign;
  startStepId: string;
  variant: CampaignAbVariant | null;
  now: Date;
}): Array<{
  step: CampaignStep;
  scheduledAt: string;
  isLastStep: boolean;
  batchIndex: number;
}> {
  const startIndex = input.campaign.steps.findIndex((step) => step.id === input.startStepId);
  if (startIndex < 0) {
    return [];
  }

  const steps: CampaignStep[] = [];
  for (const step of input.campaign.steps.slice(startIndex)) {
    if (step.conditions.length > 0) {
      if (steps.length === 0) {
        steps.push(step);
      }
      break;
    }
    if (steps.length > 0 && step.delaySeconds > 8) {
      break;
    }
    steps.push(step);
  }

  let offsetSeconds = 0;
  return steps.map((rawStep, index) => {
    const step = applyCampaignAbVariantToStep(rawStep, input.variant);
    offsetSeconds += index === 0 ? step.delaySeconds : Math.max(1, step.delaySeconds);
    return {
      step,
      scheduledAt: new Date(input.now.getTime() + offsetSeconds * 1000).toISOString(),
      isLastStep: startIndex + index === input.campaign.steps.length - 1,
      batchIndex: index,
    };
  });
}

function temporaryMessagesConfigFromCampaign(
  campaign: Campaign,
): CampaignTemporaryMessagesConfig | null {
  const parsed = campaignTemporaryMessagesConfigSchema.safeParse(campaign.metadata.temporaryMessages);
  return parsed.success && parsed.data.enabled ? parsed.data : null;
}

function variablesForRecipient(recipient: CampaignRecipient, phone: string): Record<string, string> {
  const variables = objectRecord(recipient.metadata.variables);
  return {
    telefone: phone,
    phone,
    ...Object.fromEntries(Object.entries(variables).map(([key, value]) => [key, String(value ?? "")])),
  };
}

function variablesForContact(contact: Contact, phone: string | null): Record<string, string> {
  return {
    nome: contact.name,
    name: contact.name,
    telefone: phone ?? contact.phone ?? "",
    phone: phone ?? contact.phone ?? "",
    email: contact.email ?? "",
  };
}

function jsonObjectFromStep(step: CampaignStep): Record<string, unknown> {
  return JSON.parse(JSON.stringify(step)) as Record<string, unknown>;
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numberFromUnknown(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function numericArrayFromUnknown(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => numberFromUnknown(entry))
    .filter((entry): entry is number => entry !== null);
}

function normalizePhone(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").replace(/\D/g, "");
  return normalized.length >= 10 ? normalized : null;
}

function usefulConversationTitle(value: string | null | undefined): string | null {
  const title = String(value ?? "").trim();
  if (!title || normalizePhone(title)) {
    return null;
  }
  return title;
}
