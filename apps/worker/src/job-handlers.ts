import * as fs from "node:fs/promises";
import * as path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import type { WorkerEnv } from "@nuoma/config";
import {
  campaignStepSchema,
  campaignTemporaryMessagesConfigSchema,
  extractIdempotencyKeyFromJobPayload,
  jobSchema,
  normalizePhone,
  type CampaignStep,
  type CampaignTemporaryMessagesConfig,
  type Job,
  type JobType,
  type MediaAsset,
  type Message,
  type MessageContentType,
} from "@nuoma/contracts";
import type { DbHandle, Repositories } from "@nuoma/db";
import type { Logger } from "pino";

import type {
  SyncEngineRuntime,
  SyncEnsureTemporaryMessagesResult,
  SyncTemporaryMessagesDuration,
} from "./sync/cdp.js";
import { normalizeInstagramHandle, sendInstagramTextViaCdp } from "./instagram/assisted.js";
import type { InstagramRuntime } from "./instagram/sync.js";
import { prepareVoiceAudio } from "./voice/audio.js";

export interface JobHandlerContext {
  env: WorkerEnv;
  db: DbHandle;
  repos: Repositories;
  logger: Logger;
  sync?: SyncEngineRuntime;
  instagram?: InstagramRuntime;
}

export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentJobError";
  }
}

const INSTAGRAM_SEND_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_SEND_RATE_BUCKETS = 1_000;

interface SendRateBucket {
  tokens: number;
  refilledAtMs: number;
  lastSeenAtMs: number;
}

type SendRateLimitResult =
  | {
      allowed: true;
      recentAllowedCount: number;
      bucketKey: string;
      tokensRemaining: number;
    }
  | {
      allowed: false;
      reason: string;
      recentAllowedCount: number;
      bucketKey: string;
      tokensRemaining: number;
      retryAfterMs: number;
    };

const sendRateBuckets = new Map<string, SendRateBucket>();

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
      await handleSendInstagramMessageJob(job, context);
      return;
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
  await handleSingleCampaignStepJob(job, context);
  const drainResult = await drainCampaignStepBatch(job, context);
  if (drainResult.drainedJobs > 0 || drainResult.stopped) {
    context.logger.info(
      {
        jobId: job.id,
        type: job.type,
        campaignBatchId: drainResult.campaignBatchId,
        drainedJobs: drainResult.drainedJobs,
        stopped: drainResult.stopped,
        stoppedJobId: drainResult.stoppedJobId,
        terminal: drainResult.terminal,
        error: drainResult.error,
      },
      "campaign_step batch drain finished",
    );
    await context.repos.systemEvents.create({
      userId: job.userId,
      type: "sender.campaign_step.batch_drained",
      severity: drainResult.stopped ? "warn" : "info",
      payload: JSON.stringify({
        rootJobId: job.id,
        campaignBatchId: drainResult.campaignBatchId,
        drainedJobs: drainResult.drainedJobs,
        stopped: drainResult.stopped,
        stoppedJobId: drainResult.stoppedJobId ?? null,
        terminal: drainResult.terminal ?? null,
        error: drainResult.error ?? null,
      }),
    });
  }
}

async function handleSingleCampaignStepJob(job: Job, context: JobHandlerContext): Promise<void> {
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
  const instagramConversation = await isInstagramConversation(job, context, conversationId);

  await assertCampaignRecipientCanRun(job, context, recipientId);

  await recordCampaignStepStarted(job, context, {
    campaignId,
    recipientId,
    conversationId,
    phone: phoneInput,
    step,
  });

  try {
    if (step.type === "temporary_messages") {
      if (instagramConversation) {
        throw new PermanentJobError("campaign_step temporary_messages is WhatsApp-only");
      }
      const result = await handleTemporaryMessagesControlStep(job, context, {
        campaignId,
        recipientId,
        conversationId,
        phone: phoneInput,
        step,
      });
      await recordCampaignStepCompleted(job, context, {
        campaignId,
        recipientId,
        step,
        result,
      });
      return;
    }

    if (step.type === "text" || step.type === "link") {
      const body =
        step.type === "text"
          ? renderTemplate(step.template, variables)
          : renderTemplate(`${step.text}\n${step.url}`, variables);
      const result = await sendCampaignTextStep(job, context, {
        campaignId,
        recipientId,
        conversationId,
        phone: phoneInput,
        step,
        body,
      });
      await recordCampaignStepCompleted(job, context, {
        campaignId,
        recipientId,
        step,
        result,
      });
      return;
    }

    if (instagramConversation && step.type !== "image" && step.type !== "video") {
      throw new PermanentJobError(`campaign_step ${step.type} is not supported for Instagram yet`);
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
            mediaAssetId: mediaAsset.id,
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

      const mediaFiles = mediaAssets.map((mediaAsset) => ({
        mediaPath: resolveMediaStoragePath(mediaAsset.storagePath),
        fileName: mediaAsset.fileName,
        mimeType: mediaAsset.mimeType,
      }));
      const mediaInput = {
        conversationId,
        phoneInput,
        mediaAssetId: primaryMediaAsset.id,
        mediaType: step.type,
        mediaPath: resolveMediaStoragePath(primaryMediaAsset.storagePath),
        fileName: primaryMediaAsset.fileName,
        mimeType: primaryMediaAsset.mimeType,
        files: mediaFiles,
        caption: renderOptionalTemplate(step.caption, variables),
        reason: "campaign_step",
      } satisfies Parameters<typeof sendNativeMediaToConversation>[2];
      const result = instagramConversation
        ? await sendInstagramTextToConversation(job, context, {
            conversationId,
            body: mediaInput.caption ?? "",
            mediaAssetId: mediaInput.mediaAssetId,
            mediaType: mediaInput.mediaType,
            mediaPath: mediaInput.mediaPath,
            fileName: mediaInput.fileName,
            mimeType: mediaInput.mimeType,
            files: mediaInput.files,
            reason: "campaign_step",
          })
        : await withCampaignTemporaryMessagesAudit(
            job,
            context,
            { campaignId, recipientId, conversationId, phone: phoneInput, step },
            () => sendNativeMediaToConversation(job, context, mediaInput),
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
          mediaAssetId: mediaAsset.id,
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
  } catch (error) {
    await recordCampaignStepFailed(job, context, {
      campaignId,
      recipientId,
      conversationId,
      phone: phoneInput,
      step,
      error,
    });
    throw error;
  }
}

interface CampaignBatchDrainResult {
  campaignBatchId: string | null;
  drainedJobs: number;
  stopped: boolean;
  stoppedJobId?: number;
  terminal?: boolean;
  error?: string;
}

interface CampaignBatchDrainTarget {
  kind: "phone" | "instagram";
  value: string;
}

async function drainCampaignStepBatch(
  job: Job,
  context: JobHandlerContext,
): Promise<CampaignBatchDrainResult> {
  const campaignBatchId = stringFromPayload(job.payload.campaignBatchId);
  const campaignBatchIndex = numberFromPayloadAllowZero(job.payload.campaignBatchIndex);
  const target = campaignBatchDrainTarget(job);
  const result: CampaignBatchDrainResult = {
    campaignBatchId,
    drainedJobs: 0,
    stopped: false,
  };
  if (!campaignBatchId || campaignBatchIndex === null || !target) {
    return result;
  }

  while (true) {
    const sibling = nextQueuedCampaignBatchSibling(context, {
      userId: job.userId,
      campaignBatchId,
      afterIndex: campaignBatchIndex,
      target,
    });
    if (!sibling) {
      return result;
    }

    const waitMs = Date.parse(sibling.scheduledAt) - Date.now();
    if (Number.isFinite(waitMs) && waitMs > 0) {
      await sleep(Math.min(waitMs, 30_000));
    }

    const claimed = claimCampaignBatchSibling(context, sibling.id, context.env.WORKER_ID);
    if (!claimed) {
      return {
        ...result,
        stopped: true,
        stoppedJobId: sibling.id,
        terminal: false,
        error: "campaign_step_sibling_claim_lost",
      };
    }

    try {
      await handleSingleCampaignStepJob(claimed, context);
      const completed = await context.repos.jobs.markCompleted(claimed.id, context.env.WORKER_ID);
      if (!completed) {
        context.logger.warn(
          {
            jobId: claimed.id,
            type: claimed.type,
            campaignBatchId,
            workerId: context.env.WORKER_ID,
          },
          "campaign_step batch sibling completion skipped because ownership was lost",
        );
        return {
          ...result,
          stopped: true,
          stoppedJobId: claimed.id,
          terminal: false,
          error: "campaign_step_sibling_ownership_lost",
        };
      }
      result.drainedJobs += 1;
      context.logger.info(
        { jobId: claimed.id, type: claimed.type, campaignBatchId },
        "campaign_step batch sibling completed without reopening worker loop",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const terminal =
        error instanceof PermanentJobError ||
        isTerminalCampaignStepError(message) ||
        claimed.attempts >= claimed.maxAttempts;
      if (terminal) {
        const moved = await context.repos.jobs.moveToDead({
          jobId: claimed.id,
          error: message,
          workerId: context.env.WORKER_ID,
        });
        if (moved) {
          await cancelCampaignBatchSiblingJobs(claimed, context, message);
        }
      } else {
        await context.repos.jobs.releaseForRetry({
          jobId: claimed.id,
          error: message,
          scheduledAt: nextCampaignStepRetryAt(claimed).toISOString(),
          workerId: context.env.WORKER_ID,
        });
      }
      context.logger.warn(
        { jobId: claimed.id, type: claimed.type, campaignBatchId, terminal, error: message },
        "campaign_step batch stopped after sibling failure",
      );
      return {
        ...result,
        stopped: true,
        stoppedJobId: claimed.id,
        terminal,
        error: message,
      };
    }
  }
}

function nextQueuedCampaignBatchSibling(
  context: JobHandlerContext,
  input: {
    userId: number;
    campaignBatchId: string;
    afterIndex: number;
    target: CampaignBatchDrainTarget;
  },
): Job | null {
  const jobTargetExpr =
    input.target.kind === "instagram"
      ? normalizedJsonInstagramHandleSql("payload_json")
      : normalizedJsonPhoneSql("payload_json", "$.phone");
  const row = context.db.raw
    .prepare(
      `
      select *
      from jobs
      where user_id = ?
        and type = 'campaign_step'
        and status = 'queued'
        and json_extract(payload_json, '$.campaignBatchId') = ?
        and cast(json_extract(payload_json, '$.campaignBatchIndex') as integer) > ?
        and ${jobTargetExpr} = ?
      order by cast(json_extract(payload_json, '$.campaignBatchIndex') as integer) asc, scheduled_at asc, id asc
      limit 1
    `,
    )
    .get(input.userId, input.campaignBatchId, input.afterIndex, input.target.value) as
    | RawJobRow
    | undefined;
  return row ? mapRawJob(row) : null;
}

function campaignBatchDrainTarget(job: Job): CampaignBatchDrainTarget | null {
  const phone = typeof job.payload.phone === "string" ? normalizePhone(job.payload.phone) : null;
  if (phone) {
    return { kind: "phone", value: phone };
  }
  const instagramHandle =
    normalizeInstagramHandle(stringFromPayload(job.payload.instagramHandle)) ??
    normalizeInstagramHandle(stringFromPayload(job.payload.username)) ??
    normalizeInstagramHandle(stringFromPayload(job.payload.recipientNormalizedValue));
  return instagramHandle ? { kind: "instagram", value: instagramHandle } : null;
}

function normalizedJsonPhoneSql(jsonColumn: string, jsonPath: string): string {
  const digits = `replace(replace(replace(replace(replace(coalesce(json_extract(${jsonColumn}, '${jsonPath}'), ''), '+', ''), ' ', ''), '-', ''), '(', ''), ')', '')`;
  return `(CASE
    WHEN length(${digits}) IN (12, 13) AND substr(${digits}, 1, 2) = '55' THEN ${digits}
    WHEN length(${digits}) IN (10, 11) THEN '55' || ${digits}
    ELSE ''
  END)`;
}

function normalizedJsonInstagramHandleSql(jsonColumn: string): string {
  const raw = `lower(trim(coalesce(json_extract(${jsonColumn}, '$.instagramHandle'), json_extract(${jsonColumn}, '$.username'), json_extract(${jsonColumn}, '$.recipientNormalizedValue'), '')))`;
  const withoutPrefix = `replace(replace(${raw}, '@', ''), 'ig:', '')`;
  return `(CASE WHEN length(${withoutPrefix}) BETWEEN 1 AND 30 THEN ${withoutPrefix} ELSE '' END)`;
}

function claimCampaignBatchSibling(
  context: JobHandlerContext,
  jobId: number,
  workerId: string,
): Job | null {
  const claimedAt = new Date().toISOString();
  const result = context.db.raw
    .prepare(
      `
      update jobs
      set status = 'claimed',
          claimed_at = ?,
          claimed_by = ?,
          attempts = attempts + 1,
          updated_at = ?
      where id = ?
        and status = 'queued'
    `,
    )
    .run(claimedAt, workerId, claimedAt, jobId);
  if (result.changes === 0) {
    return null;
  }
  const row = context.db.raw.prepare("select * from jobs where id = ?").get(jobId) as
    | RawJobRow
    | undefined;
  return row ? mapRawJob(row) : null;
}

interface RawJobRow {
  id: number;
  user_id: number;
  type: JobType;
  status: Job["status"];
  payload_json: string;
  dedupe_key: string | null;
  dedupe_expires_at: string | null;
  scheduled_at: string;
  claimed_at: string | null;
  claimed_by: string | null;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  priority: number;
}

function mapRawJob(row: RawJobRow): Job {
  return jobSchema.parse({
    id: row.id,
    userId: row.user_id,
    type: row.type,
    status: row.status,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    dedupeKey: row.dedupe_key,
    dedupeExpiresAt: row.dedupe_expires_at,
    scheduledAt: row.scheduled_at,
    claimedAt: row.claimed_at,
    claimedBy: row.claimed_by,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    lastError: row.last_error,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    priority: row.priority,
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

  if (shouldApplyTemporaryMessagesBeforeSend(job)) {
    try {
      const beforeEvidence = await ensureCampaignTemporaryMessages(job, context, input, {
        config,
        phase: "before_send",
        duration: config.beforeSendDuration,
      });
      await recordCampaignTemporaryMessagesEvent(job, context, {
        ...input,
        config,
        phase: "before_send",
        duration: config.beforeSendDuration,
        executionMode: "whatsapp_real",
        verified: beforeEvidence.verifiedDuration === config.beforeSendDuration,
        ensureResult: beforeEvidence,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await recordCampaignTemporaryMessagesEvent(job, context, {
        ...input,
        config,
        phase: "before_send",
        duration: config.beforeSendDuration,
        executionMode: "whatsapp_real",
        verified: false,
        error: message,
      });
      throw new PermanentJobError(message);
    }
  }

  try {
    const sendStartedAt = Date.now();
    const rawResult = await run();
    const result = annotateCampaignSendResult(rawResult, {
      sendStage: "runtime_send",
      stageDurationMs: Date.now() - sendStartedAt,
    });
    if (job.payload.isLastStep === true) {
      try {
        const restoreEvidence = await ensureCampaignTemporaryMessages(job, context, input, {
          config,
          phase: "after_completion_restore",
          duration: config.afterCompletionDuration,
        });
        await recordCampaignTemporaryMessagesEvent(job, context, {
          ...input,
          config,
          phase: "after_completion_restore",
          duration: config.afterCompletionDuration,
          executionMode: "whatsapp_real",
          verified: restoreEvidence.verifiedDuration === config.afterCompletionDuration,
          ensureResult: restoreEvidence,
        });
      } catch (restoreError) {
        await recordCampaignTemporaryMessagesEvent(job, context, {
          ...input,
          config,
          phase: "after_completion_restore",
          duration: config.afterCompletionDuration,
          executionMode: "whatsapp_real",
          verified: false,
          error: restoreError instanceof Error ? restoreError.message : String(restoreError),
        });
        context.logger.warn(
          { error: restoreError, jobId: job.id },
          "campaign temporary messages restore failed after successful send",
        );
      }
    } else {
      await recordCampaignTemporaryMessagesEvent(job, context, {
        ...input,
        config,
        phase: "step_completed_keep_window",
        duration: config.beforeSendDuration,
        executionMode: "whatsapp_real",
        verified: true,
        ensureResult: temporaryKeepWindowEvidence(result, config.beforeSendDuration),
      });
    }
    return result;
  } catch (error) {
    if (config.restoreOnFailure) {
      try {
        const restoreEvidence = await ensureCampaignTemporaryMessages(job, context, input, {
          config,
          phase: "failure_restore",
          duration: config.afterCompletionDuration,
        });
        await recordCampaignTemporaryMessagesEvent(job, context, {
          ...input,
          config,
          phase: "failure_restore",
          duration: config.afterCompletionDuration,
          executionMode: "whatsapp_real",
          verified: restoreEvidence.verifiedDuration === config.afterCompletionDuration,
          ensureResult: restoreEvidence,
          error: error instanceof Error ? error.message : String(error),
        });
      } catch (restoreError) {
        await recordCampaignTemporaryMessagesEvent(job, context, {
          ...input,
          config,
          phase: "failure_restore",
          duration: config.afterCompletionDuration,
          executionMode: "whatsapp_real",
          verified: false,
          error: restoreError instanceof Error ? restoreError.message : String(restoreError),
          originalError: error instanceof Error ? error.message : String(error),
        });
        context.logger.warn(
          { error: restoreError, originalError: error, jobId: job.id },
          "campaign temporary messages restore failed after send failure",
        );
      }
    }
    throw error;
  }
}

async function handleTemporaryMessagesControlStep(
  job: Job,
  context: JobHandlerContext,
  input: {
    campaignId: number | null;
    recipientId: number | null;
    conversationId: number;
    phone: string | null;
    step: Extract<CampaignStep, { type: "temporary_messages" }>;
  },
): Promise<Record<string, unknown>> {
  const startedAt = Date.now();
  await recordTemporaryMessagesControlEvent(job, context, input, {
    event: "temporary_messages.set.started",
    status: "running",
    duration: input.step.duration,
    stageDurationMs: 0,
  });
  try {
    const ensureResult = await ensureCampaignTemporaryMessages(job, context, input, {
      phase: "temporary_messages_set",
      duration: input.step.duration,
    });
    const verified = ensureResult.verifiedDuration === input.step.duration;
    const stageDurationMs = Date.now() - startedAt;
    await recordTemporaryMessagesControlEvent(job, context, input, {
      event: "temporary_messages.set.completed",
      status: verified ? "completed" : "warn",
      duration: input.step.duration,
      verified,
      ensureResult,
      stageDurationMs,
    });
    return {
      mode: "temporary_messages",
      sendStage: "temporary_messages.set",
      stageDurationMs,
      temporaryMessagesRequestedDuration: input.step.duration,
      temporaryMessagesConfirmedDuration: ensureResult.verifiedDuration,
      temporaryMessagesProof: verified,
      lastKnownTemporaryMessagesDuration: ensureResult.verifiedDuration,
      targetVerification: {
        temporaryMessagesProof: verified,
        requestedDuration: ensureResult.requestedDuration,
        verifiedDuration: ensureResult.verifiedDuration,
        livePhoneRequired: true,
        phone: ensureResult.phone,
        navigationMode: ensureResult.navigationMode,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordTemporaryMessagesControlEvent(job, context, input, {
      event: "temporary_messages.set.failed",
      status: "failed",
      duration: input.step.duration,
      verified: false,
      error: message,
      stageDurationMs: Date.now() - startedAt,
    });
    throw new PermanentJobError(message);
  }
}

async function isInstagramConversation(
  job: Job,
  context: JobHandlerContext,
  conversationId: number,
): Promise<boolean> {
  const conversation = await context.repos.conversations.findById({
    userId: job.userId,
    id: conversationId,
  });
  return conversation?.channel === "instagram";
}

async function sendCampaignTextStep(
  job: Job,
  context: JobHandlerContext,
  input: {
    campaignId: number | null;
    recipientId: number | null;
    conversationId: number;
    phone: string | null;
    step: CampaignStep;
    body: string;
  },
) {
  if (await isInstagramConversation(job, context, input.conversationId)) {
    return sendInstagramTextToConversation(job, context, {
      conversationId: input.conversationId,
      body: input.body,
      reason: "campaign_step",
    });
  }

  return withCampaignTemporaryMessagesAudit(
    job,
    context,
    {
      campaignId: input.campaignId,
      recipientId: input.recipientId,
      conversationId: input.conversationId,
      phone: input.phone,
      step: input.step,
    },
    () =>
      sendTextToConversation(job, context, {
        conversationId: input.conversationId,
        phoneInput: input.phone,
        body: input.body,
        reason: "campaign_step",
      }),
  );
}

async function assertCampaignRecipientCanRun(
  job: Job,
  context: JobHandlerContext,
  recipientId: number | null,
): Promise<void> {
  if (!recipientId) {
    return;
  }
  const recipient = await context.repos.campaignRecipients.findById({
    userId: job.userId,
    id: recipientId,
  });
  if (!recipient) {
    return;
  }
  if (["failed", "cancelled", "skipped", "completed"].includes(recipient.status)) {
    throw new PermanentJobError(
      `campaign_step blocked because recipient ${recipient.id} is ${recipient.status}`,
    );
  }
}

function shouldApplyTemporaryMessagesBeforeSend(job: Job): boolean {
  const batchIndex = numberFromPayloadAllowZero(job.payload.campaignBatchIndex);
  return batchIndex === null || batchIndex === 0;
}

async function ensureCampaignTemporaryMessages(
  job: Job,
  context: JobHandlerContext,
  input: {
    conversationId: number;
    phone: string | null;
    step: CampaignStep;
  },
  ensureInput: {
    config?: CampaignTemporaryMessagesConfig;
    phase:
      | "before_send"
      | "temporary_messages_set"
      | "after_completion_restore"
      | "failure_restore";
    duration: SyncTemporaryMessagesDuration;
  },
): Promise<SyncEnsureTemporaryMessagesResult> {
  if (!context.sync?.connected || !context.sync.ensureTemporaryMessages) {
    throw new Error("temporary_messages requires a connected WhatsApp runtime");
  }
  const targetPhone = await resolveCampaignStepTargetPhone(job, context, input);
  return context.sync.ensureTemporaryMessages({
    userId: job.userId,
    conversationId: input.conversationId,
    phone: targetPhone,
    duration: ensureInput.duration,
    phase: ensureInput.phase,
    reason: `campaign_step:${ensureInput.phase}`,
  });
}

async function resolveCampaignStepTargetPhone(
  job: Job,
  context: JobHandlerContext,
  input: {
    conversationId: number;
    phone: string | null;
    step: CampaignStep;
  },
): Promise<string> {
  const conversation = await context.repos.conversations.findById({
    userId: job.userId,
    id: input.conversationId,
  });
  if (!conversation) {
    throw new PermanentJobError("campaign_step conversation not found");
  }
  if (conversation.channel !== "whatsapp") {
    throw new PermanentJobError(`campaign_step unsupported channel: ${conversation.channel}`);
  }
  const phone =
    normalizePhone(input.phone) ??
    normalizePhone(conversation.waJid) ??
    normalizePhone(conversation.externalThreadId);
  return enforceSendPolicy(job, context, sendPolicyJobTypeForStep(input.step), phone);
}

function sendPolicyJobTypeForStep(
  step: CampaignStep,
): "send_message" | "send_voice" | "send_document" | "send_media" {
  if (step.type === "voice") {
    return "send_voice";
  }
  if (step.type === "document") {
    return "send_document";
  }
  if (step.type === "image" || step.type === "video") {
    return "send_media";
  }
  return "send_message";
}

function temporaryKeepWindowEvidence(
  result: unknown,
  duration: SyncTemporaryMessagesDuration,
): Partial<SyncEnsureTemporaryMessagesResult> {
  const record =
    result && typeof result === "object" && !Array.isArray(result)
      ? (result as Record<string, unknown>)
      : {};
  const navigationMode =
    record.navigationMode === "navigated" || record.navigationMode === "reused-open-chat"
      ? record.navigationMode
      : undefined;
  return {
    requestedDuration: duration,
    verifiedDuration: duration,
    ...(navigationMode ? { navigationMode } : {}),
  };
}

async function recordTemporaryMessagesControlEvent(
  job: Job,
  context: JobHandlerContext,
  input: {
    campaignId: number | null;
    recipientId: number | null;
    conversationId: number;
    phone: string | null;
    step: Extract<CampaignStep, { type: "temporary_messages" }>;
  },
  eventInput: {
    event:
      | "temporary_messages.set.started"
      | "temporary_messages.set.completed"
      | "temporary_messages.set.failed";
    status: "running" | "completed" | "warn" | "failed";
    duration: SyncTemporaryMessagesDuration;
    verified?: boolean;
    ensureResult?: Partial<SyncEnsureTemporaryMessagesResult>;
    error?: string;
    stageDurationMs: number;
  },
): Promise<void> {
  const payload = {
    event: eventInput.event,
    source: "worker_campaign_step",
    at: new Date().toISOString(),
    status: eventInput.status,
    jobId: job.id,
    campaignId: input.campaignId,
    recipientId: input.recipientId,
    conversationId: input.conversationId,
    phone: input.phone,
    stepId: input.step.id,
    stepType: input.step.type,
    campaignBatchId: stringFromPayload(job.payload.campaignBatchId),
    campaignBatchIndex: numberFromPayloadAllowZero(job.payload.campaignBatchIndex),
    campaignBatchSize: numberFromPayload(job.payload.campaignBatchSize),
    sendStage: "temporary_messages.set",
    stageDurationMs: eventInput.stageDurationMs,
    temporaryMessagesRequestedDuration: eventInput.duration,
    temporaryMessagesConfirmedDuration: eventInput.ensureResult?.verifiedDuration ?? null,
    temporaryMessagesProof: eventInput.verified ?? false,
    lastKnownTemporaryMessagesDuration: eventInput.ensureResult?.verifiedDuration ?? null,
    temporaryMessagesWarning:
      eventInput.status === "warn" || eventInput.status === "failed"
        ? (eventInput.error ?? "not_verified")
        : null,
    requestedDuration: eventInput.ensureResult?.requestedDuration ?? eventInput.duration,
    verifiedDuration: eventInput.ensureResult?.verifiedDuration ?? null,
    executionMode: "whatsapp_real",
    verified: eventInput.verified ?? false,
    navigationMode: eventInput.ensureResult?.navigationMode,
    menuDetected: eventInput.ensureResult?.menuDetected,
    changed: eventInput.ensureResult?.changed,
    targetVerification: eventInput.ensureResult
      ? {
          temporaryMessagesProof: eventInput.verified ?? false,
          requestedDuration: eventInput.ensureResult.requestedDuration ?? eventInput.duration,
          verifiedDuration: eventInput.ensureResult.verifiedDuration ?? null,
        }
      : null,
    ...(eventInput.error ? { error: eventInput.error } : {}),
  };

  await appendCampaignRecipientAudit(job, context, input.recipientId, payload);
  await context.repos.systemEvents.create({
    userId: job.userId,
    type: `sender.${eventInput.event}`,
    severity:
      eventInput.status === "failed" ? "error" : eventInput.status === "warn" ? "warn" : "info",
    payload: JSON.stringify({
      ...payload,
      targetEvidence: eventInput.ensureResult?.targetEvidence,
      visualProof: eventInput.ensureResult?.visualProof,
    }),
  });
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
    phase:
      | "before_send"
      | "step_completed_keep_window"
      | "after_completion_restore"
      | "failure_restore";
    duration: CampaignTemporaryMessagesConfig["beforeSendDuration"];
    executionMode?: "audit_only" | "whatsapp_real";
    verified?: boolean;
    ensureResult?: Partial<SyncEnsureTemporaryMessagesResult>;
    error?: string;
    originalError?: string;
  },
): Promise<void> {
  const proof =
    input.phase === "before_send" && input.verified
      ? {
          sendStage: "temporary_messages.before_send",
          verifiedAt: new Date().toISOString(),
          requestedDuration: input.ensureResult?.requestedDuration ?? input.duration,
          verifiedDuration: input.ensureResult?.verifiedDuration ?? null,
          screenshotPath: input.ensureResult?.visualProof?.screenshotPath,
          navigationMode: input.ensureResult?.navigationMode,
          menuDetected: input.ensureResult?.menuDetected,
          changed: input.ensureResult?.changed,
        }
      : null;
  await appendCampaignRecipientAudit(
    job,
    context,
    input.recipientId,
    {
      event: "temporary_messages.audit",
      source: "worker_campaign_step",
      at: new Date().toISOString(),
      status: input.verified === false ? "warn" : "info",
      jobId: job.id,
      campaignId: input.campaignId,
      conversationId: input.conversationId,
      phone: input.phone,
      stepId: input.step.id,
      stepType: input.step.type,
      phase: input.phase,
      duration: input.duration,
      requestedDuration: input.ensureResult?.requestedDuration ?? input.duration,
      verifiedDuration: input.ensureResult?.verifiedDuration ?? null,
      executionMode: input.executionMode ?? "audit_only",
      verified: input.verified ?? false,
      navigationMode: input.ensureResult?.navigationMode,
      menuDetected: input.ensureResult?.menuDetected,
      changed: input.ensureResult?.changed,
      error: input.error,
      originalError: input.originalError,
      campaignBatchId: stringFromPayload(job.payload.campaignBatchId),
      campaignBatchIndex: numberFromPayloadAllowZero(job.payload.campaignBatchIndex),
      campaignBatchSize: numberFromPayload(job.payload.campaignBatchSize),
      sendStage: `temporary_messages.${input.phase}`,
      targetVerification: input.verified
        ? {
            temporaryMessagesProof: true,
            requestedDuration: input.ensureResult?.requestedDuration ?? input.duration,
            verifiedDuration: input.ensureResult?.verifiedDuration ?? null,
          }
        : null,
    },
    proof ? { temporaryMessagesProof: proof } : undefined,
  );
  if (proof) {
    await context.repos.systemEvents.create({
      userId: job.userId,
      type: "sender.temporary_messages.proof",
      severity: "info",
      payload: JSON.stringify({
        jobId: job.id,
        campaignId: input.campaignId,
        recipientId: input.recipientId,
        conversationId: input.conversationId,
        phone: input.phone,
        stepId: input.step.id,
        stepType: input.step.type,
        proof,
      }),
    });
  }

  await context.repos.systemEvents.create({
    userId: job.userId,
    type: "sender.temporary_messages.audit",
    severity: input.verified === false || input.phase === "failure_restore" ? "warn" : "info",
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
      requestedDuration: input.ensureResult?.requestedDuration ?? input.duration,
      verifiedDuration: input.ensureResult?.verifiedDuration ?? null,
      beforeSendDuration: input.config.beforeSendDuration,
      afterCompletionDuration: input.config.afterCompletionDuration,
      restoreOnFailure: input.config.restoreOnFailure,
      executionMode: input.executionMode ?? "audit_only",
      verified: input.verified ?? false,
      navigationMode: input.ensureResult?.navigationMode,
      menuDetected: input.ensureResult?.menuDetected,
      changed: input.ensureResult?.changed,
      targetEvidence: input.ensureResult?.targetEvidence,
      visualProof: input.ensureResult?.visualProof,
      campaignBatchId: stringFromPayload(job.payload.campaignBatchId),
      campaignBatchIndex: numberFromPayloadAllowZero(job.payload.campaignBatchIndex),
      campaignBatchSize: numberFromPayload(job.payload.campaignBatchSize),
      ...(input.error ? { error: input.error } : {}),
      ...(input.originalError ? { originalError: input.originalError } : {}),
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
    mediaAssetId: document.mediaAssetId ?? numberFromPayload(job.payload.mediaAssetId),
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
  const mediaAssetIdsFromPayload = Array.isArray(job.payload.mediaAssetIds)
    ? uniquePositiveIds(
        job.payload.mediaAssetIds
          .map((value) => numberFromPayload(value))
          .filter((value): value is number => value !== null),
      )
    : [];
  const selectedMediaAssetId = mediaAssetId ?? mediaAssetIdsFromPayload[0];
  if (!selectedMediaAssetId) {
    throw new PermanentJobError("send_media requires payload.mediaAssetId");
  }
  const mediaType =
    job.payload.mediaType === "image" || job.payload.mediaType === "video"
      ? job.payload.mediaType
      : null;
  if (mediaType !== "image" && mediaType !== "video") {
    throw new PermanentJobError("send_media requires payload.mediaType image or video");
  }
  const mediaAssetIds = mediaAssetIdsFromPayload.length
    ? mediaAssetIdsFromPayload
    : [selectedMediaAssetId];
  if (mediaAssetIds.length > 1 && mediaType !== "image") {
    throw new PermanentJobError("send_media mediaAssetIds is only supported for image media");
  }

  const mediaAssets: MediaAsset[] = [];
  for (const id of mediaAssetIds) {
    const mediaAsset = await context.repos.mediaAssets.findById({
      userId: job.userId,
      id,
    });
    if (!mediaAsset) {
      throw new PermanentJobError("send_media media asset not found");
    }
    assertNativeMediaAsset("send_media", mediaAsset, mediaType);
    mediaAssets.push(mediaAsset);
  }
  const primaryMediaAsset = mediaAssets[0];
  if (!primaryMediaAsset) {
    throw new PermanentJobError("send_media media asset not found");
  }

  const result = await sendNativeMediaToConversation(job, context, {
    conversationId,
    phoneInput: typeof job.payload.phone === "string" ? job.payload.phone : null,
    mediaAssetId: primaryMediaAsset.id,
    mediaType,
    mediaPath: resolveMediaStoragePath(primaryMediaAsset.storagePath),
    fileName: primaryMediaAsset.fileName,
    mimeType: primaryMediaAsset.mimeType,
    files: mediaAssets.map((mediaAsset) => ({
      mediaPath: resolveMediaStoragePath(mediaAsset.storagePath),
      fileName: mediaAsset.fileName,
      mimeType: mediaAsset.mimeType,
    })),
    caption: typeof job.payload.caption === "string" ? job.payload.caption : null,
    reason: "send_media",
  });
  await context.repos.systemEvents.create({
    userId: job.userId,
    type: "sender.media_message.completed",
    severity: "info",
    payload: JSON.stringify({
      jobId: job.id,
      mediaAssetId: primaryMediaAsset.id,
      mediaAssetIds: mediaAssets.map((mediaAsset) => mediaAsset.id),
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
    mediaAssetId: numberFromPayload(job.payload.mediaAssetId),
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

async function handleSendInstagramMessageJob(job: Job, context: JobHandlerContext): Promise<void> {
  const conversationId = numberFromPayload(job.payload.conversationId);
  if (!conversationId) {
    throw new PermanentJobError("send_instagram_message requires payload.conversationId");
  }
  const body = typeof job.payload.body === "string" ? job.payload.body.trim() : "";
  const mediaAssetId = numberFromPayload(job.payload.mediaAssetId);
  const rawMediaType = job.payload.mediaType;
  const mediaType = rawMediaType === "image" || rawMediaType === "video" ? rawMediaType : null;
  if (!body && !mediaAssetId) {
    throw new PermanentJobError("send_instagram_message requires text or mediaAssetId");
  }
  if (mediaAssetId && !mediaType) {
    throw new PermanentJobError(
      "send_instagram_message mediaAssetId requires mediaType image or video",
    );
  }

  let media: {
    mediaAssetId: number;
    mediaType: "image" | "video";
    mediaPath: string;
    fileName: string;
    mimeType: string;
  } | null = null;
  if (mediaAssetId) {
    const mediaAsset = await context.repos.mediaAssets.findById({
      userId: job.userId,
      id: mediaAssetId,
    });
    if (!mediaAsset) {
      throw new PermanentJobError("send_instagram_message media asset not found");
    }
    if (!mediaType) {
      throw new PermanentJobError(
        "send_instagram_message mediaAssetId requires mediaType image or video",
      );
    }
    assertNativeMediaAsset("send_instagram_message", mediaAsset, mediaType);
    media = {
      mediaAssetId: mediaAsset.id,
      mediaType,
      mediaPath: resolveMediaStoragePath(mediaAsset.storagePath),
      fileName: mediaAsset.fileName,
      mimeType: mediaAsset.mimeType,
    };
  }

  const result = await sendInstagramTextToConversation(job, context, {
    conversationId,
    body,
    mediaAssetId: media?.mediaAssetId,
    mediaType: media?.mediaType,
    mediaPath: media?.mediaPath,
    fileName: media?.fileName,
    mimeType: media?.mimeType,
    reason: "send_instagram_message",
  });
  await context.repos.systemEvents.create({
    userId: job.userId,
    type: "sender.instagram_message.completed",
    severity: "info",
    payload: JSON.stringify({
      jobId: job.id,
      ...result,
    }),
  });
}

type DispatchSendResult = {
  externalId: string | null;
};

type DispatchMetadata = Record<string, unknown>;

interface DispatchMessageDraft {
  conversationId: number;
  contactId: number | null;
  contentType: MessageContentType;
  body: string | null;
  mediaAssetId?: number | null;
  media?: DispatchMetadata | null;
  raw?: DispatchMetadata | null;
}

interface DispatchSkippedDuplicateResult {
  mode: "dispatch-skipped";
  dispatchGuard: "skipped_duplicate";
  skippedDuplicate: true;
  idempotencyKey: string;
  messageId: number;
  externalId: string | null;
  conversationId: number;
  phone: string;
  reason: string;
  contentType: MessageContentType;
  existingStatus: Message["status"];
}

type SendAuditPhase = NonNullable<
  Parameters<JobHandlerContext["repos"]["sendAuditEvents"]["list"]>[0]["phase"]
>;

function hasDispatchEvidence(message: Message): boolean {
  return Boolean(
    message.dispatchedAt ||
    message.dispatchAttempts > 0 ||
    message.externalId ||
    ["sent", "delivered", "read"].includes(message.status),
  );
}

function dispatchAttemptStaleAfterMs(context: JobHandlerContext): number {
  return Math.max(context.env.WORKER_SEND_CONFIRMATION_TIMEOUT_MS * 2, 60_000);
}

function isUniqueConstraintError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /UNIQUE constraint failed/i.test(message);
}

async function recentActiveDispatchAttempt(context: JobHandlerContext, idempotencyKey: string) {
  return context.repos.messageDispatchAttempts.findActiveByKey({
    idempotencyKey,
    staleAfterMs: dispatchAttemptStaleAfterMs(context),
  });
}

async function markSkippedDuplicate(
  job: Job,
  context: JobHandlerContext,
  input: {
    idempotencyKey: string;
    message: Message;
    activeAttemptId: number | null;
    activeAttemptPhase: string | null;
    phone: string | null;
    reason: string;
    conversationId: number;
    contentType: MessageContentType;
  },
): Promise<DispatchSkippedDuplicateResult> {
  const attempt = await context.repos.messageDispatchAttempts.create({
    idempotencyKey: input.idempotencyKey,
    userId: job.userId,
    jobId: job.id,
    workerId: context.env.WORKER_ID,
    phase: "sending",
    messageId: input.message.id,
  });
  await context.repos.messageDispatchAttempts.transitionPhase({
    id: attempt.id,
    phase: "skipped_duplicate",
    messageId: input.message.id,
    externalId: input.message.externalId,
    error: input.activeAttemptPhase
      ? `active_dispatch_attempt_${input.activeAttemptPhase}`
      : "message_idempotency_key_already_dispatched",
  });
  context.logger.warn(
    {
      jobId: job.id,
      type: job.type,
      idempotencyKey: input.idempotencyKey,
      messageId: input.message.id,
      externalId: input.message.externalId,
      activeAttemptId: input.activeAttemptId,
      existingStatus: input.message.status,
      dispatchAttempts: input.message.dispatchAttempts,
    },
    "dispatch skipped because idempotency key already exists",
  );
  await recordStructuredSendAudit(job, context, {
    phase: "duplicate",
    channel: auditChannelFromTarget(input.phone),
    campaignId: numberFromPayload(job.payload.campaignId),
    contactId: input.message.contactId,
    conversationId: input.conversationId,
    messageId: input.message.id,
    latencyMs: null,
    errorCode: "skipped_duplicate",
    errorMessage: input.activeAttemptPhase
      ? `active_dispatch_attempt_${input.activeAttemptPhase}`
      : "message_idempotency_key_already_dispatched",
    metadata: {
      idempotencyKey: input.idempotencyKey,
      contentType: input.contentType,
      reason: input.reason,
      phone: input.phone,
      externalId: input.message.externalId,
      activeAttemptId: input.activeAttemptId,
      activeAttemptPhase: input.activeAttemptPhase,
      existingStatus: input.message.status,
      dispatchAttempts: input.message.dispatchAttempts,
    },
  });
  return {
    mode: "dispatch-skipped",
    dispatchGuard: "skipped_duplicate",
    skippedDuplicate: true,
    idempotencyKey: input.idempotencyKey,
    messageId: input.message.id,
    externalId: input.message.externalId,
    conversationId: input.conversationId,
    phone: input.phone ?? "",
    reason: input.reason,
    contentType: input.contentType,
    existingStatus: input.message.status,
  };
}

async function trySkipExistingDispatch(
  job: Job,
  context: JobHandlerContext,
  input: {
    idempotencyKey: string;
    phone: string | null;
    reason: string;
    conversationId: number;
    contentType: MessageContentType;
  },
): Promise<DispatchSkippedDuplicateResult | null> {
  if (!context.env.WORKER_IDEMPOTENCY_GUARD_ENABLED) {
    return null;
  }
  const existing = await context.repos.messages.findByIdempotencyKey({
    userId: job.userId,
    idempotencyKey: input.idempotencyKey,
  });
  if (!existing) {
    return null;
  }
  const activeAttempt = await recentActiveDispatchAttempt(context, input.idempotencyKey);
  if (!hasDispatchEvidence(existing) && !activeAttempt) {
    return null;
  }
  return markSkippedDuplicate(job, context, {
    ...input,
    message: existing,
    activeAttemptId: activeAttempt?.id ?? null,
    activeAttemptPhase: activeAttempt?.phase ?? null,
  });
}

async function dispatchWithIdempotencyGuard<T extends DispatchSendResult>(
  job: Job,
  context: JobHandlerContext,
  input: {
    idempotencyKey: string;
    phone: string;
    reason: string;
    draft: DispatchMessageDraft;
    send: () => Promise<T>;
    validateResult?: (result: T) => Promise<void>;
  },
): Promise<
  (T & { idempotencyKey: string; dispatchMessageId: number }) | DispatchSkippedDuplicateResult
> {
  if (!context.env.WORKER_IDEMPOTENCY_GUARD_ENABLED) {
    const result = await input.send();
    return {
      ...result,
      idempotencyKey: input.idempotencyKey,
      dispatchMessageId: 0,
    };
  }

  const observedAtUtc = new Date().toISOString();
  const dispatchStartedAtMs = Date.now();
  const upsert = await context.repos.messages.upsertOutboundByKey({
    userId: job.userId,
    conversationId: input.draft.conversationId,
    contactId: input.draft.contactId,
    externalId: null,
    direction: "outbound",
    contentType: input.draft.contentType,
    status: "pending",
    body: input.draft.body,
    mediaAssetId: input.draft.mediaAssetId ?? null,
    media: input.draft.media ?? null,
    quotedMessageId: null,
    waDisplayedAt: null,
    timestampPrecision: "unknown",
    messageSecond: null,
    waInferredSecond: null,
    observedAtUtc,
    raw: {
      ...(input.draft.raw ?? {}),
      jobId: job.id,
      jobType: job.type,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
      dispatchGuard: "if-01a",
    },
    idempotencyKey: input.idempotencyKey,
  });

  const activeAttempt = upsert.created
    ? null
    : await recentActiveDispatchAttempt(context, input.idempotencyKey);
  const shouldSkipDuplicate =
    !upsert.created && (hasDispatchEvidence(upsert.message) || Boolean(activeAttempt));

  if (shouldSkipDuplicate) {
    return markSkippedDuplicate(job, context, {
      idempotencyKey: input.idempotencyKey,
      message: upsert.message,
      activeAttemptId: activeAttempt?.id ?? null,
      activeAttemptPhase: activeAttempt?.phase ?? null,
      conversationId: input.draft.conversationId,
      phone: input.phone,
      reason: input.reason,
      contentType: input.draft.contentType,
    });
  }

  const attempt = await context.repos.messageDispatchAttempts.create({
    idempotencyKey: input.idempotencyKey,
    userId: job.userId,
    jobId: job.id,
    workerId: context.env.WORKER_ID,
    phase: "sending",
    messageId: upsert.message.id,
  });
  await recordStructuredSendAudit(job, context, {
    phase: "dispatching",
    channel: auditChannelFromTarget(input.phone),
    campaignId: numberFromPayload(job.payload.campaignId),
    contactId: input.draft.contactId,
    conversationId: input.draft.conversationId,
    messageId: upsert.message.id,
    latencyMs: null,
    metadata: {
      idempotencyKey: input.idempotencyKey,
      contentType: input.draft.contentType,
      reason: input.reason,
      phone: input.phone,
      attemptId: attempt.id,
      jobType: job.type,
    },
  });

  let attemptFinalized = false;

  async function finalizeDispatchMessage(inputStatus: {
    status: "sent" | "failed";
    externalId: string | null;
    dispatchAttempts: number;
  }): Promise<number> {
    await context.repos.messages.markDispatched({
      id: upsert.message.id,
      dispatchAttempts: inputStatus.dispatchAttempts,
    });
    await context.repos.messages.updateStatus(upsert.message.id, inputStatus.status);
    if (!inputStatus.externalId) {
      return upsert.message.id;
    }
    try {
      await context.repos.messages.setExternalId({
        id: upsert.message.id,
        externalId: inputStatus.externalId,
        status: inputStatus.status,
      });
      return upsert.message.id;
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }
      const reconciled = await context.repos.messages.reconcileIdempotencyExternalConflict({
        userId: job.userId,
        conversationId: input.draft.conversationId,
        idempotencyMessageId: upsert.message.id,
        idempotencyKey: input.idempotencyKey,
        externalId: inputStatus.externalId,
        status: inputStatus.status,
        dispatchAttempts: inputStatus.dispatchAttempts,
      });
      if (reconciled) {
        context.logger.warn(
          {
            jobId: job.id,
            type: job.type,
            idempotencyKey: input.idempotencyKey,
            placeholderMessageId: upsert.message.id,
            messageId: reconciled.id,
            externalId: inputStatus.externalId,
          },
          "dispatch idempotency row reconciled with sync message",
        );
        return reconciled.id;
      }
      const message = error instanceof Error ? error.message : String(error);
      context.logger.warn(
        {
          jobId: job.id,
          type: job.type,
          idempotencyKey: input.idempotencyKey,
          messageId: upsert.message.id,
          externalId: inputStatus.externalId,
          error: message,
        },
        "dispatch external id already reconciled by sync handler but target row was not found",
      );
      return upsert.message.id;
    }
  }

  try {
    const result = await input.send();
    const dispatchAttempts = upsert.message.dispatchAttempts + 1;
    if (input.validateResult) {
      try {
        await input.validateResult(result);
      } catch (error) {
        const failedMessageId = await finalizeDispatchMessage({
          status: "failed",
          externalId: result.externalId,
          dispatchAttempts,
        });
        await context.repos.messageDispatchAttempts.transitionPhase({
          id: attempt.id,
          phase: "failed",
          messageId: failedMessageId,
          externalId: result.externalId,
          error: error instanceof Error ? error.message : String(error),
        });
        await recordStructuredSendAudit(job, context, {
          phase: "failed",
          channel: auditChannelFromTarget(input.phone),
          campaignId: numberFromPayload(job.payload.campaignId),
          contactId: input.draft.contactId,
          conversationId: input.draft.conversationId,
          messageId: failedMessageId,
          latencyMs: elapsedMs(dispatchStartedAtMs),
          errorCode: "dispatch_result_validation_failed",
          errorMessage: error instanceof Error ? error.message : String(error),
          metadata: {
            idempotencyKey: input.idempotencyKey,
            contentType: input.draft.contentType,
            reason: input.reason,
            phone: input.phone,
            attemptId: attempt.id,
            externalId: result.externalId,
            jobType: job.type,
          },
        });
        attemptFinalized = true;
        throw error;
      }
    }
    const dispatchMessageId = await finalizeDispatchMessage({
      status: "sent",
      externalId: result.externalId,
      dispatchAttempts,
    });
    await context.repos.messageDispatchAttempts.transitionPhase({
      id: attempt.id,
      phase: "sent",
      messageId: dispatchMessageId,
      externalId: result.externalId,
    });
    await recordStructuredSendAudit(job, context, {
      phase: "sent",
      channel: auditChannelFromTarget(input.phone),
      campaignId: numberFromPayload(job.payload.campaignId),
      contactId: input.draft.contactId,
      conversationId: input.draft.conversationId,
      messageId: dispatchMessageId,
      latencyMs: elapsedMs(dispatchStartedAtMs),
      metadata: {
        idempotencyKey: input.idempotencyKey,
        contentType: input.draft.contentType,
        reason: input.reason,
        phone: input.phone,
        attemptId: attempt.id,
        externalId: result.externalId,
        jobType: job.type,
      },
    });
    return {
      ...result,
      idempotencyKey: input.idempotencyKey,
      dispatchMessageId,
    };
  } catch (error) {
    if (!attemptFinalized) {
      await context.repos.messages.updateStatus(upsert.message.id, "failed");
      await context.repos.messageDispatchAttempts.transitionPhase({
        id: attempt.id,
        phase: "failed",
        messageId: upsert.message.id,
        error: error instanceof Error ? error.message : String(error),
      });
      await recordStructuredSendAudit(job, context, {
        phase: "failed",
        channel: auditChannelFromTarget(input.phone),
        campaignId: numberFromPayload(job.payload.campaignId),
        contactId: input.draft.contactId,
        conversationId: input.draft.conversationId,
        messageId: upsert.message.id,
        latencyMs: elapsedMs(dispatchStartedAtMs),
        errorCode: "dispatch_failed",
        errorMessage: error instanceof Error ? error.message : String(error),
        metadata: {
          idempotencyKey: input.idempotencyKey,
          contentType: input.draft.contentType,
          reason: input.reason,
          phone: input.phone,
          attemptId: attempt.id,
          jobType: job.type,
        },
      });
    }
    throw error;
  }
}

async function recordStructuredSendAudit(
  job: Job,
  context: JobHandlerContext,
  input: {
    phase: SendAuditPhase;
    channel: "whatsapp" | "instagram" | "system";
    campaignId: number | null;
    contactId: number | null;
    conversationId: number | null;
    messageId?: number | null;
    latencyMs?: number | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    const metadata: Record<string, unknown> = {
      jobType: job.type,
      ...input.metadata,
    };
    const idempotencyKey =
      typeof metadata.idempotencyKey === "string"
        ? metadata.idempotencyKey
        : stringFromPayload(job.payload.idempotencyKey);
    await context.repos.sendAuditEvents.create({
      userId: job.userId,
      campaignId: input.campaignId,
      contactId: input.contactId,
      conversationId: input.conversationId,
      messageId: input.messageId ?? null,
      jobId: job.id,
      channel: input.channel,
      phase: input.phase,
      latencyMs: input.latencyMs ?? null,
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
      payloadHash: idempotencyKey,
      workerId: context.env.WORKER_ID,
      metadata,
    });
  } catch (error) {
    context.logger.warn(
      { jobId: job.id, type: job.type, phase: input.phase, error },
      "send audit event write failed",
    );
  }
}

function auditChannelFromTarget(target: string | null): "whatsapp" | "instagram" {
  return target?.startsWith("ig:") ? "instagram" : "whatsapp";
}

function elapsedMs(startedAtMs: number): number {
  return Math.max(0, Date.now() - startedAtMs);
}

async function sendVoiceToConversation(
  job: Job,
  context: JobHandlerContext,
  input: {
    conversationId: number;
    phoneInput: string | null;
    mediaAssetId?: number | null;
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
    normalizePhone(conversation.waJid) ??
    normalizePhone(conversation.externalThreadId);
  const idempotencyKey = extractIdempotencyKeyFromJobPayload(job.payload, job.id);
  const skippedDuplicate = await trySkipExistingDispatch(job, context, {
    idempotencyKey,
    phone,
    reason: input.reason,
    conversationId: input.conversationId,
    contentType: "voice",
  });
  if (skippedDuplicate) {
    return {
      audio: {
        sourcePath: input.audioPath,
      },
      ...skippedDuplicate,
    };
  }
  const targetPhone = await enforceSendPolicy(job, context, "send_voice", phone);

  const prepared = await prepareVoiceAudio({
    audioPath: input.audioPath,
    tempDir: path.resolve(process.cwd(), context.env.WORKER_TEMP_DIR),
  });
  const sendPath = prepared.wavPath;
  const result = await dispatchWithIdempotencyGuard(job, context, {
    idempotencyKey,
    phone: targetPhone,
    reason: input.reason,
    draft: {
      conversationId: input.conversationId,
      contactId: conversation.contactId,
      contentType: "voice",
      body: null,
      mediaAssetId: input.mediaAssetId ?? null,
      media: {
        mediaAssetId: input.mediaAssetId ?? null,
        type: "voice",
        mimeType: "audio/wav",
        fileName: path.basename(sendPath),
        sizeBytes: prepared.sizeBytes,
        durationMs: Math.round(prepared.durationSecs * 1000),
      },
      raw: {
        clientNonce: stringFromPayload(job.payload.clientNonce),
        sourcePath: prepared.sourcePath,
        wavPath: prepared.wavPath,
        sha256: prepared.sha256,
        sampleRate: prepared.sampleRate,
        channels: prepared.channels,
        bitsPerSample: prepared.bitsPerSample,
      },
    },
    send: () =>
      context.sync!.sendVoiceMessage({
        userId: job.userId,
        conversationId: input.conversationId,
        phone: targetPhone,
        wavPath: sendPath,
        durationSecs: prepared.durationSecs,
        reason: input.reason,
      }),
    validateResult: (result) => assertNativeVoiceSendResult(job, context, input, result),
  });
  return {
    audio: {
      sourcePath: prepared.sourcePath,
      wavPath: prepared.wavPath,
      sendPath,
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

async function assertNativeVoiceSendResult(
  job: Job,
  context: JobHandlerContext,
  input: {
    conversationId: number;
    phoneInput: string | null;
    reason: string;
  },
  result: unknown,
): Promise<void> {
  const record = isRecord(result) ? result : {};
  const nativeVoiceEvidence = record.nativeVoiceEvidence === true;
  const voiceSendMode = typeof record.voiceSendMode === "string" ? record.voiceSendMode : null;
  if (nativeVoiceEvidence && (!voiceSendMode || voiceSendMode === "native-ptt")) {
    return;
  }
  const reason = "native_voice_evidence_required";
  const step = isRecord(job.payload.step) ? job.payload.step : {};
  const payload = {
    jobId: job.id,
    campaignId: numberFromPayload(job.payload.campaignId),
    recipientId: numberFromPayload(job.payload.recipientId),
    conversationId: input.conversationId,
    phone: typeof record.phone === "string" ? record.phone : input.phoneInput,
    stepId: typeof step.id === "string" ? step.id : null,
    voiceSendMode,
    fallbackReason: typeof record.fallbackReason === "string" ? record.fallbackReason : null,
    nativeVoiceEvidence,
    reason,
  };
  await context.repos.systemEvents.create({
    userId: job.userId,
    type: "sender.voice_message.rejected",
    severity: "error",
    payload: JSON.stringify(payload),
  });
  throw new PermanentJobError(reason);
}

async function sendDocumentToConversation(
  job: Job,
  context: JobHandlerContext,
  input: {
    conversationId: number;
    phoneInput: string | null;
    mediaAssetId?: number | null;
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
    normalizePhone(conversation.waJid) ??
    normalizePhone(conversation.externalThreadId);
  const idempotencyKey = extractIdempotencyKeyFromJobPayload(job.payload, job.id);
  const skippedDuplicate = await trySkipExistingDispatch(job, context, {
    idempotencyKey,
    phone,
    reason: input.reason,
    conversationId: input.conversationId,
    contentType: "document",
  });
  if (skippedDuplicate) {
    return skippedDuplicate;
  }
  const targetPhone = await enforceSendPolicy(job, context, "send_document", phone);

  await fs.access(input.documentPath);
  return dispatchWithIdempotencyGuard(job, context, {
    idempotencyKey,
    phone: targetPhone,
    reason: input.reason,
    draft: {
      conversationId: input.conversationId,
      contactId: conversation.contactId,
      contentType: "document",
      body: input.caption,
      mediaAssetId: input.mediaAssetId ?? null,
      media: {
        mediaAssetId: input.mediaAssetId ?? null,
        type: "document",
        mimeType: input.mimeType,
        fileName: input.fileName,
        sizeBytes: null,
        durationMs: null,
      },
      raw: {
        clientNonce: stringFromPayload(job.payload.clientNonce),
        documentPath: input.documentPath,
        fileName: input.fileName,
        mimeType: input.mimeType,
        caption: input.caption,
      },
    },
    send: () =>
      context.sync!.sendDocumentMessage({
        userId: job.userId,
        conversationId: input.conversationId,
        phone: targetPhone,
        filePath: input.documentPath,
        fileName: input.fileName,
        mimeType: input.mimeType,
        caption: input.caption,
        reason: input.reason,
      }),
  });
}

async function sendNativeMediaToConversation(
  job: Job,
  context: JobHandlerContext,
  input: {
    conversationId: number;
    phoneInput: string | null;
    mediaAssetId?: number | null;
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
    normalizePhone(conversation.waJid) ??
    normalizePhone(conversation.externalThreadId);
  const idempotencyKey = extractIdempotencyKeyFromJobPayload(job.payload, job.id);
  const skippedDuplicate = await trySkipExistingDispatch(job, context, {
    idempotencyKey,
    phone,
    reason: input.reason,
    conversationId: input.conversationId,
    contentType: input.mediaType,
  });
  if (skippedDuplicate) {
    return skippedDuplicate;
  }
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
  return dispatchWithIdempotencyGuard(job, context, {
    idempotencyKey,
    phone: targetPhone,
    reason: input.reason,
    draft: {
      conversationId: input.conversationId,
      contactId: conversation.contactId,
      contentType: input.mediaType,
      body: input.caption,
      mediaAssetId: input.mediaAssetId ?? null,
      media: {
        mediaAssetId: input.mediaAssetId ?? null,
        type: input.mediaType,
        mimeType: input.mimeType,
        fileName: input.fileName,
        sizeBytes: null,
        durationMs: null,
        files: mediaFiles.map((file) => ({
          fileName: file.fileName,
          mimeType: file.mimeType,
        })),
      },
      raw: {
        clientNonce: stringFromPayload(job.payload.clientNonce),
        mediaPath: input.mediaPath,
        fileName: input.fileName,
        mimeType: input.mimeType,
        mediaCount: mediaFiles.length,
      },
    },
    send: () =>
      context.sync!.sendMediaMessage({
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
      }),
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

async function sendInstagramTextToConversation(
  job: Job,
  context: JobHandlerContext,
  input: {
    conversationId: number;
    body: string;
    mediaAssetId?: number | null;
    mediaType?: "image" | "video";
    mediaPath?: string | null;
    fileName?: string | null;
    mimeType?: string | null;
    files?: Array<{
      mediaPath: string;
      fileName: string;
      mimeType: string;
    }>;
    reason: string;
  },
) {
  const conversation = await context.repos.conversations.findById({
    userId: job.userId,
    id: input.conversationId,
  });
  if (!conversation) {
    throw new PermanentJobError("send_instagram_message conversation not found");
  }
  if (conversation.channel !== "instagram") {
    throw new PermanentJobError(
      `send_instagram_message unsupported channel: ${conversation.channel}`,
    );
  }

  const username = await resolveInstagramUsername(job, context, conversation);
  assertInstagramSendAllowed(context, username);
  await assertInstagramConversationWithinSendWindow(job, context, {
    conversationId: conversation.id,
    contactId: conversation.contactId,
    username,
  });

  const idempotencyKey = extractIdempotencyKeyFromJobPayload(job.payload, job.id);
  const targetKey = `ig:${username}`;
  const contentType = input.mediaType ?? "text";
  const skippedDuplicate = await trySkipExistingDispatch(job, context, {
    idempotencyKey,
    phone: targetKey,
    reason: input.reason,
    conversationId: input.conversationId,
    contentType,
  });
  if (skippedDuplicate) {
    return skippedDuplicate;
  }
  const mediaFiles = input.files?.length
    ? input.files
    : input.mediaPath && input.fileName && input.mimeType
      ? [{ mediaPath: input.mediaPath, fileName: input.fileName, mimeType: input.mimeType }]
      : [];
  for (const file of mediaFiles) {
    await fs.access(file.mediaPath);
  }

  const result = await dispatchWithIdempotencyGuard(job, context, {
    idempotencyKey,
    phone: targetKey,
    reason: input.reason,
    draft: {
      conversationId: input.conversationId,
      contactId: conversation.contactId,
      contentType,
      body: input.body,
      mediaAssetId: input.mediaAssetId ?? null,
      media:
        mediaFiles.length > 0
          ? {
              mediaAssetId: input.mediaAssetId ?? null,
              type: contentType,
              mimeType: input.mimeType ?? mediaFiles[0]?.mimeType ?? null,
              fileName: input.fileName ?? mediaFiles[0]?.fileName ?? null,
              sizeBytes: null,
              durationMs: null,
              files: mediaFiles.map((file) => ({
                fileName: file.fileName,
                mimeType: file.mimeType,
              })),
            }
          : null,
      raw: {
        bodyLength: input.body.length,
        clientNonce: stringFromPayload(job.payload.clientNonce),
        instagramHandle: username,
        targetKey,
        mediaPath: input.mediaPath ?? null,
        mediaCount: mediaFiles.length,
      },
    },
    send: () =>
      sendInstagramTextViaCdp({
        env: context.env,
        username,
        threadId: conversation.externalThreadId,
        text: input.body,
        mediaPaths: mediaFiles.map((file) => file.mediaPath),
        contentType,
        reason: input.reason,
      }),
  });
  if (
    "threadId" in result &&
    typeof result.threadId === "string" &&
    result.threadId.trim() &&
    conversation.externalThreadId !== result.threadId
  ) {
    await context.repos.conversations.materializeExternalThread({
      userId: job.userId,
      id: input.conversationId,
      externalThreadId: result.threadId,
      title: `@${username}`,
    });
  }
  return result;
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
    normalizePhone(conversation.waJid) ??
    normalizePhone(conversation.externalThreadId);
  const idempotencyKey = extractIdempotencyKeyFromJobPayload(job.payload, job.id);
  const skippedDuplicate = await trySkipExistingDispatch(job, context, {
    idempotencyKey,
    phone,
    reason: input.reason,
    conversationId: input.conversationId,
    contentType: "text",
  });
  if (skippedDuplicate) {
    return skippedDuplicate;
  }
  const targetPhone = await enforceSendPolicy(job, context, "send_message", phone);

  return dispatchWithIdempotencyGuard(job, context, {
    idempotencyKey,
    phone: targetPhone,
    reason: input.reason,
    draft: {
      conversationId: input.conversationId,
      contactId: conversation.contactId,
      contentType: "text",
      body: input.body,
      media: null,
      raw: {
        bodyLength: input.body.length,
        clientNonce: stringFromPayload(job.payload.clientNonce),
      },
    },
    send: () =>
      context.sync!.sendTextMessage({
        userId: job.userId,
        conversationId: input.conversationId,
        phone: targetPhone,
        body: input.body,
        reason: input.reason,
      }),
  });
}

async function resolveInstagramUsername(
  job: Job,
  context: JobHandlerContext,
  conversation: {
    contactId: number | null;
    externalThreadId: string;
    title: string;
  },
): Promise<string> {
  const fromPayload =
    normalizeInstagramHandle(stringFromPayload(job.payload.instagramHandle)) ??
    normalizeInstagramHandle(stringFromPayload(job.payload.username)) ??
    normalizeInstagramHandle(stringFromPayload(job.payload.recipientNormalizedValue));
  if (fromPayload) {
    return fromPayload;
  }

  if (conversation.contactId) {
    const contact = await context.repos.contacts.findById(conversation.contactId);
    const fromContact =
      contact?.userId === job.userId ? normalizeInstagramHandle(contact.instagramHandle) : null;
    if (fromContact) {
      return fromContact;
    }
  }

  const fromThread =
    normalizeInstagramHandle(conversation.externalThreadId) ??
    normalizeInstagramHandle(conversation.title);
  if (fromThread) {
    return fromThread;
  }

  throw new PermanentJobError("send_instagram_message requires instagramHandle or ig thread");
}

function assertInstagramSendAllowed(context: JobHandlerContext, username: string): void {
  const allowed = new Set(
    context.env.IG_SEND_ALLOWED_HANDLES.split(/[\s,;]+/)
      .map((value) => normalizeInstagramHandle(value))
      .filter((value): value is string => Boolean(value)),
  );
  if (allowed.size === 0) {
    throw new PermanentJobError("Instagram send blocked: IG_SEND_ALLOWED_HANDLES is empty");
  }
  if (!allowed.has(username)) {
    throw new PermanentJobError(`Instagram send blocked by allowlist: @${username}`);
  }
}

async function assertInstagramConversationWithinSendWindow(
  job: Job,
  context: JobHandlerContext,
  input: {
    conversationId: number;
    contactId: number | null;
    username: string;
  },
): Promise<void> {
  const latestInbound = await context.repos.messages.findLatestInboundByConversation({
    userId: job.userId,
    conversationId: input.conversationId,
  });
  const observedAtUtc = latestInbound?.observedAtUtc ?? null;
  const observedAtMs = observedAtUtc ? Date.parse(observedAtUtc) : Number.NaN;
  const nowMs = Date.now();
  const withinWindow = Number.isFinite(observedAtMs)
    ? nowMs - observedAtMs <= INSTAGRAM_SEND_WINDOW_MS
    : false;
  if (withinWindow) {
    return;
  }

  const errorCode = latestInbound ? "instagram_24h_window_expired" : "instagram_24h_window_missing";
  const errorMessage = latestInbound
    ? "Instagram send blocked: last inbound message is outside the 24h window"
    : "Instagram send blocked: no inbound message found for 24h window";
  await context.repos.systemEvents.create({
    userId: job.userId,
    type: "sender.instagram_24h_window.blocked",
    severity: "warn",
    payload: JSON.stringify({
      jobId: job.id,
      jobType: job.type,
      conversationId: input.conversationId,
      contactId: input.contactId,
      instagramHandle: input.username,
      latestInboundMessageId: latestInbound?.id ?? null,
      latestInboundObservedAtUtc: observedAtUtc,
      sendWindowMs: INSTAGRAM_SEND_WINDOW_MS,
      reason: errorCode,
    }),
  });
  await recordStructuredSendAudit(job, context, {
    phase: "policy_block",
    channel: "instagram",
    campaignId: numberFromPayload(job.payload.campaignId),
    contactId: input.contactId,
    conversationId: input.conversationId,
    latencyMs: null,
    errorCode,
    errorMessage,
    metadata: {
      idempotencyKey: stringFromPayload(job.payload.idempotencyKey),
      instagramHandle: input.username,
      latestInboundMessageId: latestInbound?.id ?? null,
      latestInboundObservedAtUtc: observedAtUtc,
      sendWindowMs: INSTAGRAM_SEND_WINDOW_MS,
    },
  });
  throw new PermanentJobError(`${errorMessage}: @${input.username}`);
}

async function recordCampaignStepStarted(
  job: Job,
  context: JobHandlerContext,
  input: {
    campaignId: number | null;
    recipientId: number | null;
    conversationId: number;
    phone: string | null;
    step: CampaignStep;
  },
): Promise<void> {
  const targetAudit = campaignJobAuditTarget(job, input.phone);
  await appendCampaignRecipientAudit(job, context, input.recipientId, {
    event: "campaign_step.started",
    source: "worker_campaign_step",
    at: new Date().toISOString(),
    status: "running",
    jobId: job.id,
    campaignId: input.campaignId,
    conversationId: input.conversationId,
    phone: input.phone,
    ...targetAudit,
    stepId: input.step.id,
    stepType: input.step.type,
    attempt: job.attempts,
    campaignBatchId: stringFromPayload(job.payload.campaignBatchId),
    campaignBatchIndex: numberFromPayloadAllowZero(job.payload.campaignBatchIndex),
    campaignBatchSize: numberFromPayload(job.payload.campaignBatchSize),
  });
  await context.repos.systemEvents.create({
    userId: job.userId,
    type: "sender.campaign_step.started",
    severity: "info",
    payload: JSON.stringify({
      jobId: job.id,
      campaignId: input.campaignId,
      recipientId: input.recipientId,
      conversationId: input.conversationId,
      phone: input.phone,
      ...targetAudit,
      stepId: input.step.id,
      stepType: input.step.type,
      campaignBatchId: stringFromPayload(job.payload.campaignBatchId),
      campaignBatchIndex: numberFromPayloadAllowZero(job.payload.campaignBatchIndex),
      campaignBatchSize: numberFromPayload(job.payload.campaignBatchSize),
      attempt: job.attempts,
      evidence: {
        phase: "before_runtime_send",
        hasTemporaryMessages: Boolean(
          temporaryMessagesConfigFromPayload(job.payload.temporaryMessages),
        ),
        scheduledAt: job.scheduledAt,
      },
    }),
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
  const conversationId = numberFromPayload(job.payload.conversationId);
  const targetAudit = campaignJobAuditTarget(job, stringFromPayload(job.payload.phone));
  const isInstagramStep =
    conversationId !== null ? await isInstagramConversation(job, context, conversationId) : false;
  let result = input.result;
  if (input.recipientId) {
    const recipient = await context.repos.campaignRecipients.findById({
      userId: job.userId,
      id: input.recipientId,
    });
    if (recipient) {
      const lastKnownTemporaryMessagesDuration = lastKnownTemporaryMessagesDurationFromMetadata(
        recipient.metadata,
      );
      if (
        !isInstagramStep &&
        input.step.type !== "temporary_messages" &&
        !("lastKnownTemporaryMessagesDuration" in input.result)
      ) {
        result = {
          ...input.result,
          lastKnownTemporaryMessagesDuration,
          temporaryMessagesProof: lastKnownTemporaryMessagesDuration === "24h",
          temporaryMessagesWarning:
            lastKnownTemporaryMessagesDuration === "24h"
              ? null
              : lastKnownTemporaryMessagesDuration
                ? "last_known_duration_not_24h"
                : "missing_24h_proof",
        };
      }
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
          ...withRecipientAudit(recipient.metadata, {
            event: "campaign_step.completed",
            source: "worker_campaign_step",
            at: new Date().toISOString(),
            status: job.payload.isLastStep ? "completed" : "running",
            jobId: job.id,
            campaignId: input.campaignId,
            conversationId,
            ...targetAudit,
            stepId: input.step.id,
            stepType: input.step.type,
            variantId,
            variantLabel,
            campaignBatchId: stringFromPayload(job.payload.campaignBatchId),
            campaignBatchIndex: numberFromPayloadAllowZero(job.payload.campaignBatchIndex),
            campaignBatchSize: numberFromPayload(job.payload.campaignBatchSize),
            result,
          }),
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
      conversationId,
      ...targetAudit,
      stepId: input.step.id,
      stepType: input.step.type,
      variantId,
      variantLabel,
      campaignBatchId: stringFromPayload(job.payload.campaignBatchId),
      campaignBatchIndex: numberFromPayloadAllowZero(job.payload.campaignBatchIndex),
      campaignBatchSize: numberFromPayload(job.payload.campaignBatchSize),
      ...result,
    }),
  });
}

async function recordCampaignStepFailed(
  job: Job,
  context: JobHandlerContext,
  input: {
    campaignId: number | null;
    recipientId: number | null;
    conversationId: number;
    phone: string | null;
    step: CampaignStep;
    error: unknown;
  },
): Promise<void> {
  const message = input.error instanceof Error ? input.error.message : String(input.error);
  const targetAudit = campaignJobAuditTarget(job, input.phone);
  const isTerminal =
    input.error instanceof PermanentJobError ||
    isTerminalCampaignStepError(message) ||
    job.attempts >= job.maxAttempts;
  if (isTerminal) {
    await cancelCampaignBatchSiblingJobs(job, context, message);
  }
  if (input.recipientId) {
    const recipient = await context.repos.campaignRecipients.findById({
      userId: job.userId,
      id: input.recipientId,
    });
    if (recipient) {
      const remainingJobIds = isTerminal
        ? numericPayloadArray(recipient.metadata.awaitingJobIds).filter((jobId) => jobId !== job.id)
        : numericPayloadArray(recipient.metadata.awaitingJobIds);
      const remainingStepIds = isTerminal
        ? stringPayloadArray(recipient.metadata.awaitingStepIds).filter(
            (stepId) => stepId !== input.step.id,
          )
        : stringPayloadArray(recipient.metadata.awaitingStepIds);
      await context.repos.campaignRecipients.updateState({
        userId: job.userId,
        id: recipient.id,
        status: isTerminal ? "failed" : recipient.status,
        lastError: message,
        metadata: {
          ...withRecipientAudit(recipient.metadata, {
            event: "campaign_step.failed",
            source: "worker_campaign_step",
            at: new Date().toISOString(),
            status: isTerminal ? "failed" : recipient.status,
            jobId: job.id,
            campaignId: input.campaignId,
            conversationId: input.conversationId,
            phone: input.phone,
            ...targetAudit,
            stepId: input.step.id,
            stepType: input.step.type,
            attempt: job.attempts,
            maxAttempts: job.maxAttempts,
            terminal: isTerminal,
            error: message,
            campaignBatchId: stringFromPayload(job.payload.campaignBatchId),
            campaignBatchIndex: numberFromPayloadAllowZero(job.payload.campaignBatchIndex),
            campaignBatchSize: numberFromPayload(job.payload.campaignBatchSize),
          }),
          lastFailedStepId: input.step.id,
          lastFailedJobId: job.id,
          lastFailedAt: new Date().toISOString(),
          lastFailureAttempt: job.attempts,
          lastFailureTerminal: isTerminal,
          ...(isTerminal
            ? {
                awaitingJobId: remainingJobIds[0] ?? null,
                awaitingStepId: remainingStepIds[0] ?? null,
                awaitingJobIds: remainingJobIds,
                awaitingStepIds: remainingStepIds,
              }
            : {}),
        },
      });
    }
  }

  await context.repos.systemEvents.create({
    userId: job.userId,
    type: "sender.campaign_step.failed",
    severity: isTerminal ? "error" : "warn",
    payload: JSON.stringify({
      jobId: job.id,
      campaignId: input.campaignId,
      recipientId: input.recipientId,
      conversationId: input.conversationId,
      phone: input.phone,
      ...targetAudit,
      stepId: input.step.id,
      stepType: input.step.type,
      campaignBatchId: stringFromPayload(job.payload.campaignBatchId),
      campaignBatchIndex: numberFromPayloadAllowZero(job.payload.campaignBatchIndex),
      campaignBatchSize: numberFromPayload(job.payload.campaignBatchSize),
      attempt: job.attempts,
      maxAttempts: job.maxAttempts,
      terminal: isTerminal,
      error: message,
      evidence: {
        phase: "runtime_send_failed",
        hasTemporaryMessages: Boolean(
          temporaryMessagesConfigFromPayload(job.payload.temporaryMessages),
        ),
      },
    }),
  });
}

function isTerminalCampaignStepError(message: string): boolean {
  return (
    /^WhatsApp rejected target phone:/i.test(message) ||
    /requires native WhatsApp PTT/i.test(message) ||
    /not_allowlisted_for_test_execution/i.test(message) ||
    /not_in_production_canary_allowlist/i.test(message) ||
    /production_without_canary_allowlist/i.test(message)
  );
}

function nextCampaignStepRetryAt(job: Job): Date {
  const attemptIndex = Math.max(job.attempts - 1, 0);
  return new Date(Date.now() + Math.min(5 * 60_000, 2 ** attemptIndex * 1000));
}

async function cancelCampaignBatchSiblingJobs(
  job: Job,
  context: JobHandlerContext,
  error: string,
): Promise<void> {
  const campaignBatchId = stringFromPayload(job.payload.campaignBatchId);
  if (!campaignBatchId) {
    return;
  }
  const now = new Date().toISOString();
  const result = context.db.raw
    .prepare(
      `
      update jobs
      set status = 'cancelled',
          last_error = coalesce(last_error, ?),
          updated_at = ?
      where user_id = ?
        and type = 'campaign_step'
        and id <> ?
        and status in ('queued', 'claimed', 'running', 'retrying')
        and json_extract(payload_json, '$.campaignBatchId') = ?
    `,
    )
    .run(
      `campaign_step batch cancelled after terminal failure: ${error}`,
      now,
      job.userId,
      job.id,
      campaignBatchId,
    );
  if (result.changes > 0) {
    await context.repos.systemEvents.create({
      userId: job.userId,
      type: "sender.campaign_step.batch_cancelled",
      severity: "warn",
      payload: JSON.stringify({
        jobId: job.id,
        campaignBatchId,
        cancelledJobs: result.changes,
        reason: error,
      }),
    });
  }
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

  const rateLimit = evaluateSendRateLimit(job, context, policy, phone);
  if (!rateLimit.allowed) {
    await recordSendPolicyDecision(job, context, {
      jobType,
      phone,
      policy,
      decision: "blocked",
      reason: rateLimit.reason,
      recentAllowedCount: rateLimit.recentAllowedCount,
      rateLimitBucketKey: rateLimit.bucketKey,
      rateLimitTokensRemaining: rateLimit.tokensRemaining,
      rateLimitRetryAfterMs: rateLimit.retryAfterMs,
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
    rateLimitBucketKey: rateLimit.bucketKey,
    rateLimitTokensRemaining: rateLimit.tokensRemaining,
    rateLimitRetryAfterMs: null,
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

  if (policy.allowedPhones.length === 0) {
    return { allowed: false, reason: "production_without_canary_allowlist" };
  }

  return { allowed: true };
}

function evaluateSendRateLimit(
  job: Job,
  context: JobHandlerContext,
  policy: WorkerSendPolicy,
  phone: string,
): SendRateLimitResult {
  const nowMs = Date.now();
  const bucketKey = `wa:${phone}`;
  const internalKey = `${context.db.url}:${job.userId}:${bucketKey}`;
  const refillPerMs = policy.rateLimitMax / policy.rateLimitWindowMs;
  const existing = sendRateBuckets.get(internalKey);
  const elapsedMs = existing ? Math.max(0, nowMs - existing.refilledAtMs) : 0;
  const refilledTokens = Math.min(
    policy.rateLimitMax,
    (existing?.tokens ?? policy.rateLimitMax) + elapsedMs * refillPerMs,
  );

  if (refilledTokens < 1) {
    const retryAfterMs = Math.ceil((1 - refilledTokens) / refillPerMs);
    sendRateBuckets.set(internalKey, {
      tokens: refilledTokens,
      refilledAtMs: nowMs,
      lastSeenAtMs: nowMs,
    });
    pruneSendRateBuckets(nowMs, policy.rateLimitWindowMs);
    return {
      allowed: false,
      reason: "send_rate_limit_exceeded",
      recentAllowedCount: Math.min(
        policy.rateLimitMax,
        Math.ceil(policy.rateLimitMax - refilledTokens),
      ),
      bucketKey,
      tokensRemaining: roundBucketTokens(refilledTokens),
      retryAfterMs,
    };
  }

  const tokensRemaining = refilledTokens - 1;
  sendRateBuckets.set(internalKey, {
    tokens: tokensRemaining,
    refilledAtMs: nowMs,
    lastSeenAtMs: nowMs,
  });
  pruneSendRateBuckets(nowMs, policy.rateLimitWindowMs);
  return {
    allowed: true,
    recentAllowedCount: Math.min(
      policy.rateLimitMax,
      Math.ceil(policy.rateLimitMax - tokensRemaining),
    ),
    bucketKey,
    tokensRemaining: roundBucketTokens(tokensRemaining),
  };
}

function pruneSendRateBuckets(nowMs: number, windowMs: number): void {
  if (sendRateBuckets.size <= MAX_SEND_RATE_BUCKETS) {
    return;
  }
  const staleAfterMs = Math.max(windowMs * 2, 60_000);
  for (const [key, bucket] of sendRateBuckets) {
    if (nowMs - bucket.lastSeenAtMs > staleAfterMs) {
      sendRateBuckets.delete(key);
    }
  }
  while (sendRateBuckets.size > MAX_SEND_RATE_BUCKETS) {
    const oldestKey = sendRateBuckets.keys().next().value;
    if (!oldestKey) {
      return;
    }
    sendRateBuckets.delete(oldestKey);
  }
}

function roundBucketTokens(tokens: number): number {
  return Math.max(0, Math.round(tokens * 1000) / 1000);
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
    rateLimitBucketKey?: string | null;
    rateLimitTokensRemaining?: number | null;
    rateLimitRetryAfterMs?: number | null;
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
      rateLimitMode: "token_bucket",
      rateLimitBucketKey: input.rateLimitBucketKey ?? null,
      rateLimitTokensRemaining: input.rateLimitTokensRemaining ?? null,
      rateLimitRetryAfterMs: input.rateLimitRetryAfterMs ?? null,
      recentAllowedCount: input.recentAllowedCount ?? null,
    }),
  });
  if (input.decision === "blocked") {
    await recordStructuredSendAudit(job, context, {
      phase: "policy_block",
      channel: "whatsapp",
      campaignId: numberFromPayload(job.payload.campaignId),
      contactId: null,
      conversationId: numberFromPayload(job.payload.conversationId),
      latencyMs: null,
      errorCode: input.reason,
      errorMessage: `${input.jobType} blocked by worker send policy`,
      metadata: {
        jobType: input.jobType,
        phone: input.phone,
        policyMode: input.policy.mode,
        allowedPhonesCount: input.policy.allowedPhones.length,
        rateLimitWindowMs: input.policy.rateLimitWindowMs,
        rateLimitMax: input.policy.rateLimitMax,
        rateLimitMode: "token_bucket",
        rateLimitBucketKey: input.rateLimitBucketKey ?? null,
        rateLimitTokensRemaining: input.rateLimitTokensRemaining ?? null,
        rateLimitRetryAfterMs: input.rateLimitRetryAfterMs ?? null,
        recentAllowedCount: input.recentAllowedCount ?? null,
      },
    });
  }
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
  const conversationId = numberFromPayload(job.payload.conversationId);
  if ((job.type === "sync_conversation" || job.type === "sync_history") && !conversationId) {
    throw new PermanentJobError(`${job.type} requires payload.conversationId`);
  }

  const channel = typeof job.payload.channel === "string" ? job.payload.channel : null;
  const conversation = conversationId
    ? await context.repos.conversations.findById({ userId: job.userId, id: conversationId })
    : null;
  const isInstagramSync = channel === "instagram" || conversation?.channel === "instagram";
  if (isInstagramSync) {
    if (!context.instagram) {
      throw new Error("Instagram sync runtime is not available");
    }
    const messagesLimit =
      boundedNumberFromPayload(job.payload.messagesLimit, 1, 100) ??
      context.env.WORKER_INSTAGRAM_SYNC_MESSAGE_LIMIT;
    const result =
      conversation?.channel === "instagram"
        ? await context.instagram.syncConversation({
            userId: job.userId,
            threadId: conversation.externalThreadId,
            instagramHandle:
              normalizeInstagramHandle(stringFromPayload(job.payload.instagramHandle)) ??
              (conversation.contactId
                ? normalizeInstagramHandle(
                    (await context.repos.contacts.findById(conversation.contactId))
                      ?.instagramHandle,
                  )
                : null),
            title: conversation.title,
            messagesLimit,
            reason: job.type,
          })
        : await context.instagram.syncInbox({
            userId: job.userId,
            threadLimit:
              boundedNumberFromPayload(job.payload.threadLimit, 1, 50) ??
              context.env.WORKER_INSTAGRAM_SYNC_THREAD_LIMIT,
            messagesLimit,
            scrollPasses:
              boundedNumberFromPayload(job.payload.scrollPasses, 1, 50) ??
              context.env.WORKER_INSTAGRAM_SYNC_SCROLL_PASSES,
            openPage: booleanFromPayload(job.payload.openPage) ?? true,
            reason: job.type,
          });
    await context.repos.systemEvents.create({
      userId: job.userId,
      type: "sync.instagram.completed",
      severity: "info",
      payload: JSON.stringify({
        jobId: job.id,
        jobType: job.type,
        ...result,
      }),
    });
    return;
  }

  if (!context.sync) {
    throw new Error("sync runtime is not available");
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
    severity: result.mode === "unsupported" || result.mode === "unresolved" ? "warn" : "info",
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

function numberFromPayloadAllowZero(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
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

function campaignJobAuditTarget(job: Job, phone: string | null): Record<string, string | null> {
  const instagramHandle =
    normalizeInstagramHandle(stringFromPayload(job.payload.instagramHandle)) ??
    normalizeInstagramHandle(stringFromPayload(job.payload.username)) ??
    normalizeInstagramHandle(stringFromPayload(job.payload.recipientNormalizedValue));
  const normalizedPhone = normalizePhone(phone ?? stringFromPayload(job.payload.phone));
  return {
    targetKey: instagramHandle
      ? `ig:${instagramHandle}`
      : normalizedPhone
        ? `wa:${normalizedPhone}`
        : null,
    instagramHandle,
  };
}

function booleanFromPayload(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    if (/^(true|1|yes)$/i.test(value)) return true;
    if (/^(false|0|no)$/i.test(value)) return false;
  }
  return null;
}

function stringPayloadArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "");
}

async function appendCampaignRecipientAudit(
  job: Job,
  context: JobHandlerContext,
  recipientId: number | null,
  entry: Record<string, unknown>,
  metadataPatch?: Record<string, unknown>,
): Promise<void> {
  if (!recipientId) {
    return;
  }
  const recipient = await context.repos.campaignRecipients.findById({
    userId: job.userId,
    id: recipientId,
  });
  if (!recipient) {
    return;
  }
  await context.repos.campaignRecipients.updateState({
    userId: job.userId,
    id: recipient.id,
    metadata: {
      ...withRecipientAudit(recipient.metadata, entry),
      ...(metadataPatch ?? {}),
    },
  });
}

function annotateCampaignSendResult<T>(
  result: T,
  annotation: { sendStage: string; stageDurationMs: number },
): T {
  if (!isRecord(result)) {
    return result;
  }
  return {
    ...result,
    sendStage: annotation.sendStage,
    stageDurationMs: annotation.stageDurationMs,
    targetVerification: {
      livePhoneRequired: true,
      phone: typeof result.phone === "string" ? result.phone : null,
      navigationMode: typeof result.navigationMode === "string" ? result.navigationMode : null,
    },
    voiceSendMode: typeof result.voiceSendMode === "string" ? result.voiceSendMode : undefined,
    fallbackReason: typeof result.fallbackReason === "string" ? result.fallbackReason : null,
  } as T;
}

function withRecipientAudit(
  metadata: Record<string, unknown>,
  entry: Record<string, unknown>,
): Record<string, unknown> {
  const auditTrail = Array.isArray(metadata.auditTrail) ? metadata.auditTrail.filter(isRecord) : [];
  return {
    ...metadata,
    auditTrail: [...auditTrail.slice(-24), entry],
  };
}

function lastKnownTemporaryMessagesDurationFromMetadata(
  metadata: Record<string, unknown>,
): SyncTemporaryMessagesDuration | null {
  const auditTrail = Array.isArray(metadata.auditTrail) ? metadata.auditTrail.filter(isRecord) : [];
  for (const entry of auditTrail.slice().reverse()) {
    const duration =
      entry.lastKnownTemporaryMessagesDuration ?? entry.temporaryMessagesConfirmedDuration;
    if (duration === "24h" || duration === "7d" || duration === "90d") {
      return duration;
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
