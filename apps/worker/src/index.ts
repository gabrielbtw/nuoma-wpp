import { setTimeout as sleep } from "node:timers/promises";

import { loadWorkerEnv, CONSTANTS } from "@nuoma/config";
import { createRepositories, openDb, runMigrations } from "@nuoma/db";
import pino from "pino";

import { startBrowserRuntime } from "./browser.js";
import { createJobLoop } from "./job-loop.js";
import { startSyncEngine } from "./sync/cdp.js";

const env = loadWorkerEnv();
const logger = pino({ name: CONSTANTS.workerServiceName, level: "info" });
const db = openDb(env.DATABASE_URL);
await runMigrations(db);
const repos = createRepositories(db);
const browser = await startBrowserRuntime({ env, logger });
const sync = await startSyncEngine({ env, repos, logger });

let stopping = false;
let heartbeatStatus: "starting" | "idle" | "busy" | "stopping" | "stopped" | "error" = "starting";
let lastError: string | null = null;

const jobLoop = createJobLoop({
  env,
  repos,
  logger,
  handlerContext: {
    env,
    db,
    repos,
    logger,
    sync,
  },
});

logger.info(
  {
    workerId: env.WORKER_ID,
    jobLoopEnabled: env.WORKER_JOB_LOOP_ENABLED,
    browserEnabled: env.WORKER_BROWSER_ENABLED,
    syncEnabled: env.WORKER_SYNC_ENABLED,
    headless: env.WORKER_HEADLESS,
    cdpHost: env.CHROMIUM_CDP_HOST,
    cdpPort: env.CHROMIUM_CDP_PORT,
    profileDir: env.CHROMIUM_PROFILE_DIR,
    databaseUrl: env.DATABASE_URL,
  },
  "worker booted",
);

async function heartbeat(status: typeof heartbeatStatus = heartbeatStatus): Promise<void> {
  const rssMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
  await repos.workerState.heartbeat({
    workerId: env.WORKER_ID,
    status,
    currentJobId: jobLoop.state.currentJobId,
    pid: process.pid,
    rssMb,
    browserConnected: browser.connected,
    lastError: lastError ?? jobLoop.state.lastError,
    metrics: {
      ...jobLoop.state.metrics,
      sync: sync.metrics,
      service: CONSTANTS.workerServiceName,
    },
  });
}

async function checkMemoryPressure(): Promise<void> {
  const rssMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
  if (rssMb <= env.WORKER_MAX_RSS_MB) {
    return;
  }

  lastError = `Worker RSS ${rssMb}MB exceeded limit ${env.WORKER_MAX_RSS_MB}MB`;
  logger.warn({ rssMb, limitMb: env.WORKER_MAX_RSS_MB }, "worker memory pressure detected");

  if (env.WORKER_BROWSER_ENABLED) {
    await browser.restart();
  }
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (stopping) {
    return;
  }
  stopping = true;
  heartbeatStatus = "stopping";
  logger.info({ signal }, "worker shutdown requested");
  clearInterval(heartbeatTimer);
  clearInterval(memoryTimer);

  await heartbeat("stopping").catch((error: unknown) => {
    logger.warn({ error }, "stopping heartbeat failed");
  });
  await browser.close();
  await sync.close();
  heartbeatStatus = "stopped";
  await heartbeat("stopped").catch((error: unknown) => {
    logger.warn({ error }, "stopped heartbeat failed");
  });
  db.close();
  process.exit(0);
}

const heartbeatTimer = setInterval(() => {
  void heartbeat().catch((error: unknown) => {
    logger.warn({ error }, "worker heartbeat failed");
  });
}, env.WORKER_HEARTBEAT_SEC * 1000);

const memoryTimer = setInterval(
  () => {
    void checkMemoryPressure().catch((error: unknown) => {
      logger.warn({ error }, "worker memory pressure check failed");
    });
  },
  Math.max(env.WORKER_HEARTBEAT_SEC * 1000, 10_000),
);

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

await heartbeat("idle");

if (!env.WORKER_JOB_LOOP_ENABLED) {
  heartbeatStatus = "idle";
  logger.info("worker job loop disabled by WORKER_JOB_LOOP_ENABLED=false");
} else {
  heartbeatStatus = "idle";
  while (!stopping && env.WORKER_JOB_LOOP_ENABLED) {
    const processed = await jobLoop.processOne();
    await checkMemoryPressure();
    await heartbeat("idle");
    if (!processed) {
      await sleep(env.WORKER_POLL_MS);
    }
  }
}

while (!stopping) {
  await checkMemoryPressure();
  await heartbeat(heartbeatStatus);
  await new Promise((resolve) => setTimeout(resolve, env.WORKER_POLL_MS));
}
