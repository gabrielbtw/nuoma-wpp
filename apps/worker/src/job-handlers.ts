import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { WorkerEnv } from "@nuoma/config";
import {
  campaignStepSchema,
  campaignTemporaryMessagesConfigSchema,
  type CampaignStep,
  type CampaignTemporaryMessagesConfig,
  type Job,
  type JobType,
  type MediaAsset,
} from "@nuoma/contracts";
import type { DbHandle, Repositories } from "@nuoma/db";
import type { Logger } from "pino";

import type { SyncEngineRuntime } from "./sync/cdp.js";
import { prepareVoiceAudio } from "./voice/audio.js";

export interface JobHandlerContext {
  env: WorkerEnv;
  db: DbHandle;
  repos: Repositories;
  logger: Logger;
  sync?: SyncEngineRuntime;
}

export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentJobError";
  }
}

export async function handleJob(job: Job, context: JobHandlerContext): Promise<void> {
  switch (job.type) {
    case "backup":
      await handleBackupJob(job, context);
      return;
    case "restart_worker":
      context.logger.warn({ jobId: job.id }, "restart_worker job acknowledged");
      return;
    case "send_message":
      await handleSendMessageJob(job, context);
      return;
    case "send_voice":
      await handleSendVoiceJob(job, context);
      return;
    case "send_document":
      await handleSendDocumentJob(job, context);
      return;
    case "send_media":
      await handleSendMediaJob(job, context);
      return;
    case "campaign_step":
      await handleCampaignStepJob(job, context);
      return;
    case "send_instagram_message":
    case "chatbot_reply":
      throw new PermanentJobError(
        `${job.type} is intentionally disabled in V2.5 safe worker base; no message was sent`,
      );
    case "sync_conversation":
    case "sync_history":
    case "sync_inbox_force":
      await handleSyncJob(job, context);
      return;
    case "automation_action":
    case "validate_recipient":
      throw new Error(`${job.type} requires a live V2.6+ runtime handler`);
    default:
      assertNeverJobType(job.type);
  }
}

async function handleCampaignStepJob(job: Job, context: JobHandlerContext): Promise<void> {
  const conversationId = numberFromPayload(job.payload.conversationId);
  if (!conversationId) {
    throw new PermanentJobError("campaign_step requires payload.conversationId");
  }

  const parsed = campaignStepSchema.safeParse(job.payload.step);
  if (!parsed.success) {
    throw new PermanentJobError("campaign_step requires a valid payload.step");
  }

  const step = parsed.data;
  const variables = variablesFromPayload(job.payload.variables);
  const campaignId = numberFromPayload(job.payload.campaignId);
  const recipientId = numberFromPayload(job.payload.recipientId);
  const phoneInput = typeof job.payload.phone === "string" ? job.payload.phone : null;

  if (step.type === "text" || step.type === "link") {
    const body =
      step.type === "text"
        ? renderTemplate(step.template, variables)
        : renderTemplate(`${step.text}\n${step.url}`, variables);
    const result = await withCampaignTemporaryMessagesAudit(
      job,
      context,
      { campaignId, recipientId, conversationId, phone: phoneInput, step },
      () =>
        sendTextToConversation(job, context, {
          conversationId,
          phoneInput,
          body,
          reason: "campaign_step",
        }),
    );
    await recordCampaignStepCompleted(job, context, {
      campaignId,
      recipientId,
      step,
      result,
    });
    return;
  }

  if (step.type === "document") {
    const mediaAsset = await context.repos.mediaAssets.findById({
      userId: job.userId,
      id: step.mediaAssetId,
    });
    if (!mediaAsset) {
      throw new PermanentJobError("campaign_step document media asset not found");
    }
    assertDocumentMediaAsset("campaign_step document", mediaAsset);

    const result = await withCampaignTemporaryMessagesAudit(
      job,
      context,
      { campaignId, recipientId, conversationId, phone: phoneInput, step },
      () =>
        sendDocumentToConversation(job, context, {
          conversationId,
          phoneInput,
          documentPath: resolveMediaStoragePath(mediaAsset.storagePath),
          fileName: renderTemplate(step.fileName || mediaAsset.fileName, variables),
          mimeType: mediaAsset.mimeType,
          caption: renderOptionalTemplate(step.caption, variables),
          reason: "campaign_step",
        }),
    );
    await recordCampaignStepCompleted(job, context, {
      campaignId,
      recipientId,
      step,
      result: {
        ...result,
        mediaAssetId: mediaAsset.id,
      },
    });
    return;
  }

  if (step.type === "image" || step.type === "video") {
    const mediaAssetIds =
      step.type === "image" && step.mediaAssetIds?.length
        ? uniquePositiveIds(step.mediaAssetIds)
        : [step.mediaAssetId];
    const mediaAssets: MediaAsset[] = [];
    for (const mediaAssetId of mediaAssetIds) {
      const mediaAsset = await context.repos.mediaAssets.findById({
        userId: job.userId,
        id: mediaAssetId,
      });
      if (!mediaAsset) {
        throw new PermanentJobError(`campaign_step ${step.type} media asset not found`);
      }
      assertNativeMediaAsset(`campaign_step ${step.type}`, mediaAsset, step.type);
      mediaAssets.push(mediaAsset);
    }
    const primaryMediaAsset = mediaAssets[0];
    if (!primaryMediaAsset) {
      throw new PermanentJobError(`campaign_step ${step.type} media asset not found`);
    }

    const result = await withCampaignTemporaryMessagesAudit(
      job,
      context,
      { campaignId, recipientId, conversationId, phone: phoneInput, step },
      () =>
        sendNativeMediaToConversation(job, context, {
          conversationId,
          phoneInput,
          mediaType: step.type,
          mediaPath: resolveMediaStoragePath(primaryMediaAsset.storagePath),
          fileName: primaryMediaAsset.fileName,
          mimeType: primaryMediaAsset.mimeType,
          files: mediaAssets.map((mediaAsset) => ({
            mediaPath: resolveMediaStoragePath(mediaAsset.storagePath),
            fileName: mediaAsset.fileName,
            mimeType: mediaAsset.mimeType,
          })),
          caption: renderOptionalTemplate(step.caption, variables),
          reason: "campaign_step",
        }),
    );
    await recordCampaignStepCompleted(job, context, {
      campaignId,
      recipientId,
      step,
      result: {
        ...result,
        mediaAssetId: primaryMediaAsset.id,
        mediaAssetIds: mediaAssets.map((mediaAsset) => mediaAsset.id),
      },
    });
    return;
  }

  const mediaAsset = await context.repos.mediaAssets.findById({
    userId: job.userId,
    id: step.mediaAssetId,
  });
  if (!mediaAsset) {
    throw new PermanentJobError("campaign_step voice media asset not found");
  }
  if (mediaAsset.type !== "voice" && mediaAsset.type !== "audio") {
    throw new PermanentJobError(
      `campaign_step voice requires voice/audio media asset, got ${mediaAsset.type}`,
    );
  }

  const result = await withCampaignTemporaryMessagesAudit(
    job,
    context,
    { campaignId, recipientId, conversationId, phone: phoneInput, step },
    () =>
      sendVoiceToConversation(job, context, {
        conversationId,
        phoneInput,
        audioPath: resolveMediaStoragePath(mediaAsset.storagePath),
        reason: "campaign_step",
      }),
  );
  await recordCampaignStepCompleted(job, context, {
    campaignId,
    recipientId,
    step,
    result: {
      ...result,
      mediaAssetId: mediaAsset.id,
      captionIgnored: Boolean(step.caption?.trim()),
    },
  });
}

async function withCampaignTemporaryMessagesAudit<T>(
  job: Job,
  context: JobHandlerContext,
  input: {
    campaignId: number | null;
    recipientId: number | null;
    conversationId: number;
    phone: string | null;
    step: CampaignStep;
  },
  run: () => Promise<T>,
): Promise<T> {
  const config = temporaryMessagesConfigFromPayload(job.payload.temporaryMessages);
  if (!config) {
    return run();
  }

  await recordCampaignTemporaryMessagesEvent(job, context, {
    ...input,
    config,
    phase: "before_send",
    duration: config.beforeSendDuration,
  });

  try {
    const result = await run();
    await recordCampaignTemporaryMessagesEvent(job, context, {
      ...input,
      config,
      phase: job.payload.isLastStep === true ? "after_completion_restore" : "step_completed_keep_window",
      duration:
        job.payload.isLastStep === true
          ? config.afterCompletionDuration
          : config.beforeSendDuration,
    });
    return result;
  } catch (error) {
    if (config.restoreOnFailure) {
      await recordCampaignTemporaryMessagesEvent(job, context, {
        ...input,
        config,
        phase: "failure_restore",
        duration: config.afterCompletionDuration,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  }
}

async function recordCampaignTemporaryMessagesEvent(
  job: Job,
  context: JobHandlerContext,
  input: {
    campaignId: number | null;
    recipientId: number | null;
    conversationId: number;
    phone: string | null;
    step: CampaignStep;
    config: CampaignTemporaryMessagesConfig;
    phase: "before_send" | "step_completed_keep_window" | "after_completion_restore" | "failure_restore";
    duration: CampaignTemporaryMessagesConfig["beforeSendDuration"];
    error?: string;
  },
): Promise<void> {
  await context.repos.systemEvents.create({
    userId: job.userId,
    type: "sender.temporary_messages.audit",
    severity: input.phase === "failure_restore" ? "warn" : "info",
    payload: JSON.stringify({
      jobId: job.id,
      campaignId: input.campaignId,
      recipientId: input.recipientId,
      conversationId: input.conversationId,
      phone: input.phone,
      stepId: input.step.id,
      stepType: input.step.type,
      phase: input.phase,
      duration: input.duration,
      beforeSendDuration: input.config.beforeSendDuration,
      afterCompletionDuration: input.config.afterCompletionDuration,
      restoreOnFailure: input.config.restoreOnFailure,
      executionMode: "audit_only",
      campaignBatchId: stringFromPayload(job.payload.campaignBatchId),
      campaignBatchIndex: numberFromPayload(job.payload.campaignBatchIndex),
      campaignBatchSize: numberFromPayload(job.payload.campaignBatchSize),
      ...(input.error ? { error: input.error } : {}),
    }),
  });
}

async function handleSendDocumentJob(job: Job, context: JobHandlerContext): Promise<void> {
  const conversationId = numberFromPayload(job.payload.conversationId);
  if (!conversationId) {
    throw new PermanentJobError("send_document requires payload.conversationId");
  }
  const document = await resolveDocumentPayload(job, context);
  const result = await sendDocumentToConversation(job, context, {
    conversationId,
    phoneInput: typeof job.payload.phone === "string" ? job.payload.phone : null,
    documentPath: document.documentPath,
    fileName: document.fileName,
    mimeType: document.mimeType,
    caption: typeof job.payload.caption === "string" ? job.payload.caption : null,
    reason: "send_document",
  });
  await context.repos.systemEvents.create({
    userId: job.userId,
    type: "sender.document_message.completed",
    severity: "info",
    payload: JSON.stringify({
      jobId: job.id,
      ...(document.mediaAssetId ? { mediaAssetId: document.mediaAssetId } : {}),
      ...result,
    }),
  });
}

async function handleSendMediaJob(job: Job, context: JobHandlerContext): Promise<void> {
  const conversationId = numberFromPayload(job.payload.conversationId);
  if (!conversationId) {
    throw new PermanentJobError("send_media requires payload.conversationId");
  }
  const mediaAssetId = numberFromPayload(job.payload.mediaAssetId);
  if (!mediaAssetId) {
    throw new PermanentJobError("send_media requires payload.mediaAssetId");
  }
  const mediaType = job.payload.mediaType;
  if (mediaType !== "image" && mediaType !== "video") {
    throw new PermanentJobError("send_media requires payload.mediaType image or video");
  }
  const mediaAsset = await context.repos.mediaAssets.findById({
    userId: job.userId,
    id: mediaAssetId,
  });
  if (!mediaAsset) {
    throw new PermanentJobError("send_media media asset not found");
  }
  assertNativeMediaAsset("send_media", mediaAsset, mediaType);

  const result = await sendNativeMediaToConversation(job, context, {
    conversationId,
    phoneInput: typeof job.payload.phone === "string" ? job.payload.phone : null,
    mediaType,
    mediaPath: resolveMediaStoragePath(mediaAsset.storagePath),
    fileName: mediaAsset.fileName,
    mimeType: mediaAsset.mimeType,
    caption: typeof job.payload.caption === "string" ? job.payload.caption : null,
    reason: "send_media",
  });
  await context.repos.systemEvents.create({
    userId: job.userId,
    type: "sender.media_message.completed",
    severity: "info",
    payload: JSON.stringify({
      jobId: job.id,
      mediaAssetId: mediaAsset.id,
      mediaType,
      ...result,
    }),
  });
}

async function handleSendVoiceJob(job: Job, context: JobHandlerContext): Promise<void> {
  const conversationId = numberFromPayload(job.payload.conversationId);
  if (!conversationId) {
    throw new PermanentJobError("send_voice requires payload.conversationId");
  }
  const audioPath = typeof job.payload.audioPath === "string" ? job.payload.audioPath.trim() : "";
  if (!audioPath) {
    throw new PermanentJobError("send_voice requires payload.audioPath");
  }
  const result = await sendVoiceToConversation(job, context, {
    conversationId,
    phoneInput: typeof job.payload.phone === "string" ? job.payload.phone : null,
    audioPath,
    reason: "send_voice",
  });
  await context.repos.systemEvents.create({
    userId: job.userId,
    type: "sender.voice_message.completed",
    severity: "info",
    payload: JSON.stringify({
      jobId: job.id,
      ...result,
    }),
  });
}

async function sendVoiceToConversation(
  job: Job,
  context: JobHandlerContext,
  input: {
    conversationId: number;
    phoneInput: string | null;
    audioPath: string;
    reason: string;
  },
) {
  if (!context.sync?.connected) {
    throw new Error("send_voice requires a connected WhatsApp runtime");
  }
  const conversation = await context.repos.conversations.findById({
    userId: job.userId,
    id: input.conversationId,
  });
  if (!conversation) {
    throw new PermanentJobError("send_voice conversation not found");
  }
  if (conversation.channel !== "whatsapp") {
    throw new PermanentJobError(`send_voice unsupported channel: ${conversation.channel}`);
  }
  const phone =
    normalizePhone(input.phoneInput) ??
    normalizePhone(conversation.externalThreadId) ??
    normalizePhone(conversation.title);
  const targetPhone = await enforceSendPolicy(job, context, "send_voice", phone);

  const prepared = await prepareVoiceAudio({
    audioPath: input.audioPath,
    tempDir: path.resolve(process.cwd(), context.env.WORKER_TEMP_DIR),
  });
  const result = await context.sync.sendVoiceMessage({
    userId: job.userId,
    conversationId: input.conversationId,
    phone: targetPhone,
    wavPath: prepared.wavPath,
    durationSecs: prepared.durationSecs,
    reason: input.reason,
  });
  return {
    audio: {
      sourcePath: prepared.sourcePath,
      wavPath: prepared.wavPath,
      durationSecs: prepared.durationSecs,
      durationSource: prepared.durationSource,
      sha256: prepared.sha256,
      sizeBytes: prepared.sizeBytes,
      sampleRate: prepared.sampleRate,
      channels: prepared.channels,
      bitsPerSample: prepared.bitsPerSample,
    },
    ...result,
  };
}

async function sendDocumentToConversation(
  job: Job,
  context: JobHandlerContext,
  input: {
    conversationId: number;
    phoneInput: string | null;
    documentPath: string;
    fileName: string;
    mimeType: string;
    caption: string | null;
    reason: string;
  },
) {
  if (!context.sync?.connected) {
    throw new Error("send_document requires a connected WhatsApp runtime");
  }
  const conversation = await context.repos.conversations.findById({
    userId: job.userId,
    id: input.conversationId,
  });
  if (!conversation) {
    throw new PermanentJobError("send_document conversation not found");
  }
  if (conversation.channel !== "whatsapp") {
    throw new PermanentJobError(`send_document unsupported channel: ${conversation.channel}`);
  }
  const phone =
    normalizePhone(input.phoneInput) ??
    normalizePhone(conversation.externalThreadId) ??
    normalizePhone(conversation.title);
  const targetPhone = await enforceSendPolicy(job, context, "send_document", phone);

  await fs.access(input.documentPath);
  return context.sync.sendDocumentMessage({
    userId: job.userId,
    conversationId: input.conversationId,
    phone: targetPhone,
    filePath: input.documentPath,
    fileName: input.fileName,
    mimeType: input.mimeType,
    caption: input.caption,
    reason: input.reason,
  });
}

async function sendNativeMediaToConversation(
  job: Job,
  context: JobHandlerContext,
  input: {
    conversationId: number;
    phoneInput: string | null;
    mediaType: "image" | "video";
    mediaPath: string;
    fileName: string;
    mimeType: string;
    files?: Array<{
      mediaPath: string;
      fileName: string;
      mimeType: string;
    }>;
    caption: string | null;
    reason: string;
  },
) {
  if (!context.sync?.connected) {
    throw new Error("send_media requires a connected WhatsApp runtime");
  }
  const conversation = await context.repos.conversations.findById({
    userId: job.userId,
    id: input.conversationId,
  });
  if (!conversation) {
    throw new PermanentJobError("send_media conversation not found");
  }
  if (conversation.channel !== "whatsapp") {
    throw new PermanentJobError(`send_media unsupported channel: ${conversation.channel}`);
  }
  const phone =
    normalizePhone(input.phoneInput) ??
    normalizePhone(conversation.externalThreadId) ??
    normalizePhone(conversation.title);
  const targetPhone = await enforceSendPolicy(job, context, "send_media", phone);

  const mediaFiles = input.files?.length
    ? input.files
    : [
        {
          mediaPath: input.mediaPath,
          fileName: input.fileName,
          mimeType: input.mimeType,
        },
      ];
  for (const file of mediaFiles) {
    await fs.access(file.mediaPath);
  }
  return context.sync.sendMediaMessage({
    userId: job.userId,
    conversationId: input.conversationId,
    phone: targetPhone,
    mediaType: input.mediaType,
    filePath: input.mediaPath,
    fileName: input.fileName,
    mimeType: input.mimeType,
    files: mediaFiles.map((file) => ({
      filePath: file.mediaPath,
      fileName: file.fileName,
      mimeType: file.mimeType,
    })),
    caption: input.caption,
    reason: input.reason,
  });
}

async function handleSendMessageJob(job: Job, context: JobHandlerContext): Promise<void> {
  const conversationId = numberFromPayload(job.payload.conversationId);
  if (!conversationId) {
    throw new PermanentJobError("send_message requires payload.conversationId");
  }
  const body = typeof job.payload.body === "string" ? job.payload.body.trim() : "";
  if (!body) {
    throw new PermanentJobError("send_message requires non-empty payload.body");
  }
  const result = await sendTextToConversation(job, context, {
    conversationId,
    phoneInput: typeof job.payload.phone === "string" ? job.payload.phone : null,
    body,
    reason: "send_message",
  });
  await context.repos.systemEvents.create({
    userId: job.userId,
    type: "sender.text_message.completed",
    severity: "info",
    payload: JSON.stringify({
      jobId: job.id,
      ...result,
    }),
  });
}

async function sendTextToConversation(
  job: Job,
  context: JobHandlerContext,
  input: {
    conversationId: number;
    phoneInput: string | null;
    body: string;
    reason: string;
  },
) {
  if (!context.sync?.connected) {
    throw new Error("send_message requires a connected WhatsApp runtime");
  }
  const conversation = await context.repos.conversations.findById({
    userId: job.userId,
    id: input.conversationId,
  });
  if (!conversation) {
    throw new PermanentJobError("send_message conversation not found");
  }
  if (conversation.channel !== "whatsapp") {
    throw new PermanentJobError(`send_message unsupported channel: ${conversation.channel}`);
  }
  const phone =
    normalizePhone(input.phoneInput) ??
    normalizePhone(conversation.externalThreadId) ??
    normalizePhone(conversation.title);
  const targetPhone = await enforceSendPolicy(job, context, "send_message", phone);

  return context.sync.sendTextMessage({
    userId: job.userId,
    conversationId: input.conversationId,
    phone: targetPhone,
    body: input.body,
    reason: input.reason,
  });
}

async function recordCampaignStepCompleted(
  job: Job,
  context: JobHandlerContext,
  input: {
    campaignId: number | null;
    recipientId: number | null;
    step: CampaignStep;
    result: object;
  },
): Promise<void> {
  const variantId = stringFromPayload(job.payload.variantId);
  const variantLabel = stringFromPayload(job.payload.variantLabel);
  if (input.recipientId) {
    const recipient = await context.repos.campaignRecipients.findById({
      userId: job.userId,
      id: input.recipientId,
    });
    if (recipient) {
      const remainingJobIds = numericPayloadArray(recipient.metadata.awaitingJobIds).filter(
        (jobId) => jobId !== job.id,
      );
      const remainingStepIds = stringPayloadArray(recipient.metadata.awaitingStepIds).filter(
        (stepId) => stepId !== input.step.id,
      );
      await context.repos.campaignRecipients.updateState({
        userId: job.userId,
        id: recipient.id,
        status: job.payload.isLastStep ? "completed" : "running",
        currentStepId: input.step.id,
        lastError: null,
        metadata: {
          ...recipient.metadata,
          awaitingJobId: remainingJobIds[0] ?? null,
          awaitingStepId: remainingStepIds[0] ?? null,
          awaitingJobIds: remainingJobIds,
          awaitingStepIds: remainingStepIds,
          lastCompletedStepId: input.step.id,
          lastCompletedJobId: job.id,
          lastCompletedAt: new Date().toISOString(),
          lastCompletedVariantId: variantId,
          lastCompletedVariantLabel: variantLabel,
        },
      });
    }
  }

  await context.repos.systemEvents.create({
    userId: job.userId,
    type: "sender.campaign_step.completed",
    severity: "info",
    payload: JSON.stringify({
      jobId: job.id,
      campaignId: input.campaignId,
      recipientId: input.recipientId,
      stepId: input.step.id,
      stepType: input.step.type,
      variantId,
      variantLabel,
      campaignBatchId: stringFromPayload(job.payload.campaignBatchId),
      campaignBatchIndex: numberFromPayload(job.payload.campaignBatchIndex),
      campaignBatchSize: numberFromPayload(job.payload.campaignBatchSize),
      ...input.result,
    }),
  });
}

async function enforceSendPolicy(
  job: Job,
  context: JobHandlerContext,
  jobType: "send_message" | "send_voice" | "send_document" | "send_media",
  phone: string | null,
): Promise<string> {
  const policy = resolveWorkerSendPolicy(context.env);
  if (!phone) {
    await recordSendPolicyDecision(job, context, {
      jobType,
      phone: null,
      policy,
      decision: "blocked",
      reason: "invalid_target_phone",
    });
    throw new PermanentJobError(`${jobType} blocked: target phone unknown is invalid`);
  }

  const eligibility = evaluateWorkerSendEligibility(policy, phone);
  if (!eligibility.allowed) {
    await recordSendPolicyDecision(job, context, {
      jobType,
      phone,
      policy,
      decision: "blocked",
      reason: eligibility.reason,
    });
    throw new PermanentJobError(`${jobType} blocked: ${eligibility.reason} (${phone})`);
  }

  const rateLimit = await evaluateSendRateLimit(job, context, policy);
  if (!rateLimit.allowed) {
    await recordSendPolicyDecision(job, context, {
      jobType,
      phone,
      policy,
      decision: "blocked",
      reason: rateLimit.reason,
      recentAllowedCount: rateLimit.recentAllowedCount,
    });
    throw new PermanentJobError(`${jobType} blocked: ${rateLimit.reason}`);
  }

  await recordSendPolicyDecision(job, context, {
    jobType,
    phone,
    policy,
    decision: "allowed",
    reason: "eligible",
    recentAllowedCount: rateLimit.recentAllowedCount,
  });

  return phone;
}

interface WorkerSendPolicy {
  mode: WorkerEnv["WA_SEND_POLICY_MODE"];
  allowedPhones: string[];
  rateLimitWindowMs: number;
  rateLimitMax: number;
}

function resolveWorkerSendPolicy(env: WorkerEnv): WorkerSendPolicy {
  const allowedPhones = parsePhoneList(env.WA_SEND_ALLOWED_PHONES, [env.WA_SEND_ALLOWED_PHONE]);
  return {
    mode: env.WA_SEND_POLICY_MODE,
    allowedPhones,
    rateLimitWindowMs: env.WA_SEND_RATE_LIMIT_WINDOW_MS,
    rateLimitMax: env.WA_SEND_RATE_LIMIT_MAX,
  };
}

function evaluateWorkerSendEligibility(
  policy: WorkerSendPolicy,
  phone: string,
): { allowed: true } | { allowed: false; reason: string } {
  if (policy.mode === "test") {
    if (policy.allowedPhones.length === 0) {
      return { allowed: false, reason: "test_policy_allowlist_not_configured" };
    }
    return policy.allowedPhones.includes(phone)
      ? { allowed: true }
      : { allowed: false, reason: "not_allowlisted_for_test_execution" };
  }

  if (policy.allowedPhones.length > 0 && !policy.allowedPhones.includes(phone)) {
    return { allowed: false, reason: "not_in_production_canary_allowlist" };
  }

  return { allowed: true };
}

async function evaluateSendRateLimit(
  job: Job,
  context: JobHandlerContext,
  policy: WorkerSendPolicy,
): Promise<
  | { allowed: true; recentAllowedCount: number }
  | { allowed: false; reason: string; recentAllowedCount: number }
> {
  const since = Date.now() - policy.rateLimitWindowMs;
  const recentAllowedEvents = await context.repos.systemEvents.list({
    userId: job.userId,
    type: "sender.send_policy.allowed",
    limit: Math.max(policy.rateLimitMax + 25, 100),
  });
  const recentAllowedCount = recentAllowedEvents.filter((event) => {
    const timestamp = Date.parse(event.createdAt);
    return Number.isFinite(timestamp) && timestamp >= since;
  }).length;

  if (recentAllowedCount >= policy.rateLimitMax) {
    return { allowed: false, reason: "send_rate_limit_exceeded", recentAllowedCount };
  }

  return { allowed: true, recentAllowedCount };
}

async function recordSendPolicyDecision(
  job: Job,
  context: JobHandlerContext,
  input: {
    jobType: "send_message" | "send_voice" | "send_document" | "send_media";
    phone: string | null;
    policy: WorkerSendPolicy;
    decision: "allowed" | "blocked";
    reason: string;
    recentAllowedCount?: number;
  },
): Promise<void> {
  await context.repos.systemEvents.create({
    userId: job.userId,
    type: `sender.send_policy.${input.decision}`,
    severity: input.decision === "allowed" ? "info" : "warn",
    payload: JSON.stringify({
      jobId: job.id,
      jobType: input.jobType,
      phone: input.phone,
      decision: input.decision,
      reason: input.reason,
      policyMode: input.policy.mode,
      allowedPhonesCount: input.policy.allowedPhones.length,
      rateLimitWindowMs: input.policy.rateLimitWindowMs,
      rateLimitMax: input.policy.rateLimitMax,
      recentAllowedCount: input.recentAllowedCount ?? null,
    }),
  });
}

function parsePhoneList(
  csv: string | null | undefined,
  extraPhones: Array<string | null | undefined> = [],
): string[] {
  const phones = new Set<string>();
  for (const raw of [...(csv ?? "").split(","), ...extraPhones]) {
    const phone = normalizePhone(raw);
    if (phone) {
      phones.add(phone);
    }
  }
  return [...phones];
}

async function handleSyncJob(job: Job, context: JobHandlerContext): Promise<void> {
  if (!context.sync) {
    throw new Error("sync runtime is not available");
  }

  const conversationId = numberFromPayload(job.payload.conversationId);
  if ((job.type === "sync_conversation" || job.type === "sync_history") && !conversationId) {
    throw new PermanentJobError(`${job.type} requires payload.conversationId`);
  }

  const phone = typeof job.payload.phone === "string" ? job.payload.phone : null;
  const result = await context.sync.forceConversation({
    userId: job.userId,
    conversationId: conversationId ?? undefined,
    phone,
    reason: job.type,
    history:
      job.type === "sync_history"
        ? {
            enabled: true,
            maxScrolls: boundedNumberFromPayload(job.payload.maxScrolls, 1, 25) ?? 3,
            delayMs: boundedNumberFromPayload(job.payload.delayMs, 250, 10_000) ?? 1_200,
          }
        : undefined,
  });
  await context.repos.systemEvents.create({
    userId: job.userId,
    type: "sync.force_conversation.completed",
    severity: result.mode === "unsupported" ? "warn" : "info",
    payload: JSON.stringify({
      jobId: job.id,
      ...result,
    }),
  });
}

function numberFromPayload(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function numericPayloadArray(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => numberFromPayload(entry))
    .filter((entry): entry is number => entry !== null);
}

function stringFromPayload(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringPayloadArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "");
}

function temporaryMessagesConfigFromPayload(
  value: unknown,
): CampaignTemporaryMessagesConfig | null {
  const parsed = campaignTemporaryMessagesConfigSchema.safeParse(value);
  return parsed.success && parsed.data.enabled ? parsed.data : null;
}

function uniquePositiveIds(ids: number[]): number[] {
  return [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
}

function boundedNumberFromPayload(value: unknown, min: number, max: number): number | null {
  const number = numberFromPayload(value);
  if (number === null) {
    return null;
  }
  return Math.max(min, Math.min(max, number));
}

function variablesFromPayload(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, rawValue]) => [
      key,
      rawValue === null ? "" : String(rawValue),
    ]),
  );
}

function renderTemplate(template: string, variables: Record<string, string>): string {
  const missing = new Set<string>();
  const rendered = template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (match, key: string) => {
    if (!Object.hasOwn(variables, key)) {
      missing.add(key);
      return match;
    }
    return variables[key] ?? "";
  });
  if (missing.size > 0) {
    throw new PermanentJobError(
      `campaign_step missing template variables: ${[...missing].join(", ")}`,
    );
  }
  const body = rendered.trim();
  if (!body) {
    throw new PermanentJobError("campaign_step rendered an empty message");
  }
  return body;
}

function renderOptionalTemplate(
  template: string | null | undefined,
  variables: Record<string, string>,
): string | null {
  if (!template?.trim()) {
    return null;
  }
  return renderTemplate(template, variables);
}

async function resolveDocumentPayload(
  job: Job,
  context: JobHandlerContext,
): Promise<{
  documentPath: string;
  fileName: string;
  mimeType: string;
  mediaAssetId: number | null;
}> {
  const mediaAssetId = numberFromPayload(job.payload.mediaAssetId);
  if (mediaAssetId) {
    const mediaAsset = await context.repos.mediaAssets.findById({
      userId: job.userId,
      id: mediaAssetId,
    });
    if (!mediaAsset) {
      throw new PermanentJobError("send_document media asset not found");
    }
    assertDocumentMediaAsset("send_document", mediaAsset);
    return {
      documentPath: resolveMediaStoragePath(mediaAsset.storagePath),
      fileName: mediaAsset.fileName,
      mimeType: mediaAsset.mimeType,
      mediaAssetId: mediaAsset.id,
    };
  }

  const documentPath =
    typeof job.payload.documentPath === "string" ? job.payload.documentPath.trim() : "";
  if (!documentPath) {
    throw new PermanentJobError(
      "send_document requires payload.mediaAssetId or payload.documentPath",
    );
  }
  const resolvedPath = path.resolve(process.cwd(), documentPath);
  return {
    documentPath: resolvedPath,
    fileName:
      typeof job.payload.fileName === "string" && job.payload.fileName.trim()
        ? job.payload.fileName.trim()
        : path.basename(resolvedPath),
    mimeType:
      typeof job.payload.mimeType === "string" && job.payload.mimeType.trim()
        ? job.payload.mimeType.trim()
        : "application/octet-stream",
    mediaAssetId: null,
  };
}

function assertDocumentMediaAsset(context: string, mediaAsset: MediaAsset): void {
  if (mediaAsset.type !== "document") {
    throw new PermanentJobError(`${context} requires document media asset, got ${mediaAsset.type}`);
  }
  if (mediaAsset.deletedAt) {
    throw new PermanentJobError(`${context} media asset is deleted`);
  }
}

function assertNativeMediaAsset(
  context: string,
  mediaAsset: MediaAsset,
  expectedType: "image" | "video",
): void {
  if (mediaAsset.type !== expectedType) {
    throw new PermanentJobError(
      `${context} requires ${expectedType} media asset, got ${mediaAsset.type}`,
    );
  }
  if (mediaAsset.deletedAt) {
    throw new PermanentJobError(`${context} media asset is deleted`);
  }
}

function resolveMediaStoragePath(storagePath: string): string {
  if (path.isAbsolute(storagePath)) {
    return storagePath;
  }
  if (storagePath.startsWith("..")) {
    return path.resolve(process.cwd(), storagePath);
  }
  return path.resolve(process.cwd(), "../..", storagePath);
}

function normalizePhone(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").replace(/\D/g, "");
  return normalized.length >= 10 ? normalized : null;
}

function assertNeverJobType(type: never): never {
  throw new PermanentJobError(`Unsupported job type: ${String(type)}`);
}

async function handleBackupJob(job: Job, context: JobHandlerContext): Promise<void> {
  const requestedPath = typeof job.payload.targetPath === "string" ? job.payload.targetPath : null;
  const targetPath =
    requestedPath ??
    path.resolve(
      process.cwd(),
      "data",
      "backups",
      `nuoma-v2-${new Date().toISOString().replaceAll(":", "-")}.db`,
    );

  await context.db.backupTo(targetPath);
  await context.repos.systemEvents.create({
    userId: job.userId,
    type: "worker.backup.completed",
    severity: "info",
    payload: JSON.stringify({
      jobId: job.id,
      targetPath,
    }),
  });
  context.logger.info({ jobId: job.id, targetPath }, "backup job completed");
}

export function isPermanentJobError(error: unknown): boolean {
  return error instanceof PermanentJobError;
}

export function isSendJobType(type: JobType): boolean {
  return [
    "send_message",
    "send_instagram_message",
    "send_voice",
    "send_document",
    "send_media",
    "campaign_step",
    "chatbot_reply",
  ].includes(type);
}
