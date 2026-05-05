import { setTimeout as sleep } from "node:timers/promises";

import type { WorkerEnv } from "@nuoma/config";
import type { Job } from "@nuoma/contracts";
import type { Repositories } from "@nuoma/db";
import type { Logger } from "pino";

import {
  handleJob,
  isPermanentJobError,
  isSendJobType,
  type JobHandlerContext,
} from "./job-handlers.js";

const syncJobTypes: Job["type"][] = ["sync_conversation", "sync_history", "sync_inbox_force"];
const sendJobTypes: Job["type"][] = [
  "send_message",
  "send_instagram_message",
  "send_voice",
  "send_document",
  "send_media",
  "campaign_step",
  "chatbot_reply",
];

export interface WorkerMetrics {
  claimed: number;
  completed: number;
  retried: number;
  dead: number;
  emptyPolls: number;
  errors: number;
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
    },
    lastError: null,
  };

  async function processOne(): Promise<boolean> {
    const claimed = await input.repos.jobs.claimDueJobs({
      workerId: input.env.WORKER_ID,
      limit: 1,
      excludeTypes: input.handlerContext.sync?.connected ? [] : [...syncJobTypes, ...sendJobTypes],
    });

    const job = claimed[0];
    if (!job) {
      state.metrics.emptyPolls += 1;
      return false;
    }

    state.metrics.claimed += 1;
    state.currentJobId = job.id;
    state.lastError = null;
    input.logger.info(
      { jobId: job.id, type: job.type, attempts: job.attempts, maxAttempts: job.maxAttempts },
      "job claimed",
    );

    try {
      await handleJob(job, input.handlerContext);
      await input.repos.jobs.markCompleted(job.id);
      state.metrics.completed += 1;
      input.logger.info({ jobId: job.id, type: job.type }, "job completed");
      return true;
    } catch (error) {
      state.metrics.errors += 1;
      const message = serializeError(error);
      state.lastError = message;

      if (isPermanentJobError(error) || job.attempts >= job.maxAttempts) {
        await input.repos.jobs.moveToDead({ jobId: job.id, error: message });
        state.metrics.dead += 1;
        input.logger.warn({ jobId: job.id, type: job.type, error: message }, "job moved to DLQ");
        return true;
      }

      const scheduledAt = nextRetryAt(job).toISOString();
      await input.repos.jobs.releaseForRetry({
        jobId: job.id,
        error: message,
        scheduledAt,
      });
      state.metrics.retried += 1;
      input.logger.warn(
        { jobId: job.id, type: job.type, scheduledAt, error: message },
        "job released for retry",
      );
      return true;
    } finally {
      state.currentJobId = null;
    }
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

function nextRetryAt(job: Job): Date {
  const now = Date.now();
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
