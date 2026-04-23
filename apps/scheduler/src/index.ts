import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  createLogger,
  getDb,
  getWorkerState,
  loadEnv,
  processAutomationTick,
  processMessageReceivedTriggers,
  processCampaignTick,
  recordSystemEvent,
  releaseStaleJobLocks,
  setWorkerState
} from "@nuoma/core";

const env = loadEnv();
const logger = createLogger("scheduler");
let cycleInFlight = false;

async function cleanupTempFiles() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;

  for (const dir of [env.TEMP_DIR, env.SCREENSHOTS_DIR]) {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }

      const target = path.join(dir, entry.name);
      const stat = await fs.stat(target).catch(() => null);
      if (!stat || stat.mtimeMs > cutoff) {
        continue;
      }
      await fs.rm(target, { force: true }).catch(() => null);
    }
  }
}

async function restartWorkerWithPm2() {
  const pm2 = await import("pm2");
  await new Promise<void>((resolve, reject) => {
    pm2.default.connect((connectError) => {
      if (connectError) {
        reject(connectError);
        return;
      }

      pm2.default.restart("wa-worker", (restartError) => {
        pm2.default.disconnect();
        if (restartError) {
          reject(restartError);
          return;
        }
        resolve();
      });
    });
  });
}

async function publishSchedulerState(extra?: Record<string, unknown>) {
  setWorkerState("scheduler", {
    status: "online",
    pid: process.pid,
    uptimeSec: Math.round(process.uptime()),
    updatedAt: new Date().toISOString(),
    ...extra
  });
}

async function watchdog() {
  const worker = getWorkerState("wa-worker");
  if (!worker) {
    return;
  }

  const lastUpdate = new Date(worker.updatedAt).getTime();
  const isStale = Date.now() - lastUpdate > env.WATCHDOG_STALE_SECONDS * 1000;
  const status = worker.value && typeof worker.value === "object" ? String((worker.value as Record<string, unknown>).status ?? "") : "";

  if (!isStale && !["error", "restarting"].includes(status)) {
    return;
  }

  const correlationId = randomUUID();
  recordSystemEvent("scheduler", "warn", "Worker watchdog triggered", {
    correlationId,
    isStale,
    status
  });
  logger.warn({ correlationId, isStale, status }, "Worker watchdog triggered");

  if (env.ENABLE_PM2_WATCHDOG) {
    await restartWorkerWithPm2().catch((error) => {
      logger.error({ err: error, correlationId }, "Failed to restart wa-worker via PM2");
      recordSystemEvent("scheduler", "error", "Failed to restart wa-worker via PM2", {
        correlationId,
        message: error instanceof Error ? error.message : String(error)
      });
    });
  }
}

async function runCycle() {
  if (cycleInFlight) {
    return;
  }

  cycleInFlight = true;
  const correlationId = randomUUID();
  try {
    // Release stale job locks before processing
    const releasedLocks = releaseStaleJobLocks(5);
    if (releasedLocks > 0) {
      logger.warn({ releasedLocks }, "Released stale job locks");
      recordSystemEvent("scheduler", "warn", `Released ${releasedLocks} stale job lock(s)`, { releasedLocks });
    }

    const msgTriggers = processMessageReceivedTriggers();
    const automations = processAutomationTick();
    const campaigns = processCampaignTick();
    await cleanupTempFiles();
    await watchdog();
    await publishSchedulerState({
      lastRunAt: new Date().toISOString(),
      automationQueued: automations.queued,
      campaignQueued: campaigns.queued,
      correlationId
    });

    // Only record visible event when actual work was done to avoid log noise
    const hadWork = automations.queued > 0 || campaigns.queued > 0 || msgTriggers.queued > 0 || releasedLocks > 0;
    if (hadWork) {
      recordSystemEvent("scheduler", "info", "Scheduler cycle completed", {
        correlationId,
        automations,
        campaigns
      });
    } else {
      logger.debug({ correlationId }, "Scheduler cycle completed (no-op)");
    }
  } catch (error) {
    logger.error({ err: error, correlationId }, "Scheduler cycle failed");
    recordSystemEvent("scheduler", "error", "Scheduler cycle failed", {
      correlationId,
      message: error instanceof Error ? error.message : String(error)
    });
    await publishSchedulerState({
      lastFailureAt: new Date().toISOString(),
      lastFailureSummary: error instanceof Error ? error.message : String(error)
    });
  } finally {
    cycleInFlight = false;
  }
}

let cycleInterval: ReturnType<typeof setInterval> | null = null;

async function start() {
  getDb();
  await publishSchedulerState({ startedAt: new Date().toISOString() });
  await runCycle();
  cycleInterval = setInterval(() => { void runCycle(); }, env.SCHEDULER_INTERVAL_SEC * 1000);
}

async function shutdown(signal: string) {
  logger.info({ signal }, "Scheduler shutting down gracefully");
  if (cycleInterval) clearInterval(cycleInterval);

  // Wait for in-flight cycle to complete (max 30s)
  const maxWait = 30_000;
  const start = Date.now();
  while (cycleInFlight && Date.now() - start < maxWait) {
    await new Promise((r) => setTimeout(r, 500));
  }

  await publishSchedulerState({ stoppedAt: new Date().toISOString(), signal });
  recordSystemEvent("scheduler", "info", `Scheduler stopped (${signal})`);
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

start().catch((error) => {
  logger.error({ err: error }, "Failed to start scheduler");
  recordSystemEvent("scheduler", "error", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
