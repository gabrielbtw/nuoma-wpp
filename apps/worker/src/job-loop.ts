import { setTimeout as sleep } from "node:timers/promises";

import type { WorkerEnv } from "@nuoma/config";
import type { Job } from "@nuoma/contracts";
import type { Repositories } from "@nuoma/db";
import type { Logger } from "pino";

import {
  handleJob,
  isPermanentJobError,
  isSendJobType,
  retryAfterMsForJobError,
  type JobHandlerContext,
} from "./job-handlers.js";

const syncJobTypes: Job["type"][] = ["sync_conversation", "sync_history"];
const SERIAL_TARGET_DRAIN_LIMIT = 25;
export interface WorkerMetrics {
  claimed: number;
  completed: number;
  retried: number;
  dead: number;
  emptyPolls: number;
  errors: number;
  reaped: number;
}

export interface JobLoopState {
  currentJobId: number | null;
  metrics: WorkerMetrics;
  lastError: string | null;
}

export interface JobLoopRuntime {
  state: JobLoopState;
  runUntilStopped: (shouldStop: () => boolean) => Promise<void>;
  processOne: () => Promise<boolean>;
}

export function createJobLoop(input: {
  env: WorkerEnv;
  repos: Repositories;
  logger: Logger;
  handlerContext: JobHandlerContext;
}): JobLoopRuntime {
  const state: JobLoopState = {
    currentJobId: null,
    metrics: {
      claimed: 0,
      completed: 0,
      retried: 0,
      dead: 0,
      emptyPolls: 0,
      errors: 0,
      reaped: 0,
    },
    lastError: null,
  };

  async function processOne(): Promise<boolean> {
    await reapStaleClaims();

    const excludeTypes: Job["type"][] = [];
    if (!input.handlerContext.sync?.connected) {
      excludeTypes.push(
        ...syncJobTypes,
        "send_message",
        "send_voice",
        "send_document",
        "send_media",
      );
    }
    if (!input.handlerContext.instagram?.metrics.connected) {
      excludeTypes.push("send_instagram_message");
    }

    const claimed = await input.repos.jobs.claimDueJobs({
      workerId: input.env.WORKER_ID,
      limit: 1,
      excludeTypes,
    });

    const job = claimed[0];
    if (!job) {
      state.metrics.emptyPolls += 1;
      return false;
    }

    recordClaimedJob(job);

    await processClaimedJobChain(job, excludeTypes);
    return true;
  }

  async function processClaimedJobChain(firstJob: Job, excludeTypes: Job["type"][]): Promise<void> {
    let job: Job | null = firstJob;
    let drainedJobs = 0;
    while (job) {
      const completed = await processClaimedJob(job);
      if (!completed || !isSendJobType(job.type)) {
        return;
      }
      if (drainedJobs >= SERIAL_TARGET_DRAIN_LIMIT) {
        input.logger.warn(
          { jobId: job.id, type: job.type, drainLimit: SERIAL_TARGET_DRAIN_LIMIT },
          "serial target drain limit reached",
        );
        return;
      }

      const nextJob = await input.repos.jobs.claimNextDueSerialJobForTarget({
        workerId: input.env.WORKER_ID,
        completedJobId: job.id,
        excludeTypes,
      });
      if (!nextJob) {
        return;
      }
      drainedJobs += 1;
      recordClaimedJob(nextJob, { serialTargetDrainIndex: drainedJobs });
      job = nextJob;
    }
  }

  function recordClaimedJob(job: Job, extra: Record<string, unknown> = {}): void {
    state.metrics.claimed += 1;
    state.currentJobId = job.id;
    state.lastError = null;
    input.logger.info(
      {
        jobId: job.id,
        type: job.type,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        ...extra,
      },
      "job claimed",
    );
  }

  async function processClaimedJob(job: Job): Promise<boolean> {
    try {
      await handleJob(job, input.handlerContext);
      const completed = await input.repos.jobs.markCompleted(job.id, input.env.WORKER_ID);
      if (!completed) {
        input.logger.warn(
          { jobId: job.id, type: job.type, workerId: input.env.WORKER_ID },
          "job completion skipped because ownership was lost",
        );
        return false;
      }
      state.metrics.completed += 1;
      input.logger.info({ jobId: job.id, type: job.type }, "job completed");
      return true;
    } catch (error) {
      state.metrics.errors += 1;
      const message = serializeError(error);
      state.lastError = message;

      if (
        isPermanentJobError(error) ||
        isNonRetryableSendError(message) ||
        job.attempts >= job.maxAttempts
      ) {
        const moved = await input.repos.jobs.moveToDead({
          jobId: job.id,
          error: message,
          workerId: input.env.WORKER_ID,
        });
        if (moved) {
          state.metrics.dead += 1;
          input.logger.warn({ jobId: job.id, type: job.type, error: message }, "job moved to DLQ");
        } else {
          input.logger.warn(
            { jobId: job.id, type: job.type, error: message, workerId: input.env.WORKER_ID },
            "job DLQ transition skipped because ownership was lost",
          );
        }
        return false;
      }

      const retryAfterMs = retryAfterMsForJobError(error);
      const scheduledAt = nextRetryAt(job, retryAfterMs).toISOString();
      const released = await input.repos.jobs.releaseForRetry({
        jobId: job.id,
        error: message,
        scheduledAt,
        workerId: input.env.WORKER_ID,
        preserveAttempt: retryAfterMs !== null,
      });
      if (released) {
        state.metrics.retried += 1;
        input.logger.warn(
          { jobId: job.id, type: job.type, scheduledAt, error: message },
          "job released for retry",
        );
      } else {
        input.logger.warn(
          {
            jobId: job.id,
            type: job.type,
            scheduledAt,
            error: message,
            workerId: input.env.WORKER_ID,
          },
          "job retry release skipped because ownership was lost",
        );
      }
      return false;
    } finally {
      state.currentJobId = null;
    }
  }

  async function reapStaleClaims(): Promise<void> {
    if (!input.env.WORKER_IDEMPOTENCY_GUARD_ENABLED) {
      return;
    }
    const result = await input.repos.jobs.releaseStaleClaims({
      staleAfterMs: input.env.WORKER_STALE_CLAIM_TIMEOUT_MS,
      limit: 50,
    });
    if (result.released === 0) {
      return;
    }
    state.metrics.reaped += result.released;
    input.logger.warn(
      {
        released: result.released,
        staleAfterMs: result.staleAfterMs,
        cutoff: result.cutoff,
      },
      "stale job claims released for retry",
    );
  }

  async function runUntilStopped(shouldStop: () => boolean): Promise<void> {
    while (!shouldStop()) {
      const processed = await processOne();
      if (!processed) {
        await sleep(input.env.WORKER_POLL_MS);
      }
    }
  }

  return {
    state,
    processOne,
    runUntilStopped,
  };
}

function isNonRetryableSendError(message: string): boolean {
  return /^WhatsApp rejected target phone:/i.test(message);
}

function nextRetryAt(job: Job, retryAfterMs?: number | null): Date {
  const now = Date.now();
  if (retryAfterMs !== null && retryAfterMs !== undefined) {
    return new Date(now + Math.max(0, retryAfterMs));
  }
  if (isSendJobType(job.type)) {
    return new Date(now + 60_000);
  }

  const attemptIndex = Math.max(job.attempts - 1, 0);
  const delayMs = Math.min(5 * 60_000, 2 ** attemptIndex * 1000);
  return new Date(now + delayMs);
}

function serializeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
