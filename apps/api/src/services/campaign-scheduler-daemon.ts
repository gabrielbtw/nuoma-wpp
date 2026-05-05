import type { Repositories } from "@nuoma/db";

import { runCampaignSchedulerTick } from "./campaign-scheduler.js";

interface SchedulerLogger {
  info: (obj: Record<string, unknown>, message: string) => void;
  warn: (obj: Record<string, unknown>, message: string) => void;
  error: (obj: Record<string, unknown>, message: string) => void;
}

interface CampaignSchedulerDaemonOptions {
  repos: Repositories;
  logger: SchedulerLogger;
  enabled: boolean;
  userId: number;
  ownerId: string;
  intervalMs: number;
}

export interface CampaignSchedulerDaemon {
  start: () => void;
  stop: () => void;
  tickOnce: () => Promise<void>;
}

export function createCampaignSchedulerDaemon(
  options: CampaignSchedulerDaemonOptions,
): CampaignSchedulerDaemon {
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let stopped = false;

  async function tickOnce(): Promise<void> {
    if (running) {
      options.logger.warn(
        { ownerId: options.ownerId, userId: options.userId },
        "campaign scheduler tick skipped because previous tick is still running",
      );
      return;
    }

    running = true;
    try {
      const result = await runCampaignSchedulerTick({
        repos: options.repos,
        userId: options.userId,
        ownerId: options.ownerId,
      });
      options.logger.info({ result }, "campaign scheduler tick completed");
    } catch (error) {
      options.logger.error(
        { err: error, ownerId: options.ownerId, userId: options.userId },
        "campaign scheduler tick failed",
      );
    } finally {
      running = false;
    }
  }

  function start(): void {
    if (!options.enabled || timer || stopped) {
      return;
    }
    options.logger.info(
      { ownerId: options.ownerId, userId: options.userId, intervalMs: options.intervalMs },
      "campaign scheduler daemon started",
    );
    timer = setInterval(() => {
      void tickOnce();
    }, options.intervalMs);
  }

  function stop(): void {
    stopped = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    options.logger.info({ ownerId: options.ownerId, userId: options.userId }, "campaign scheduler daemon stopped");
  }

  return { start, stop, tickOnce };
}
