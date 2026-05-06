import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import Fastify, { type FastifyInstance } from "fastify";

import { CONSTANTS, type ApiEnv } from "@nuoma/config";
import { healthResponseSchema, type HealthResponse } from "@nuoma/contracts";
import { createRepositories, openDb, runMigrations, type DbHandle } from "@nuoma/db";

import { appRouter } from "./router.js";
import { registerGlobalEventsRoutes } from "./routes/global-events.js";
import { registerInboxEventsRoutes } from "./routes/inbox-events.js";
import { registerMediaUploadRoutes } from "./routes/media-upload.js";
import { createAutomationEngineDaemon } from "./services/automation-engine-daemon.js";
import { createCampaignSchedulerDaemon } from "./services/campaign-scheduler-daemon.js";
import { resolveApiSendPolicy } from "./services/send-policy.js";
import { createStreamingCdpService } from "./services/streaming-cdp.js";
import { createContextFactory } from "./trpc/context.js";

const startedAt = new Date();

export interface ApiAppOptions {
  env: ApiEnv;
  db?: DbHandle;
  migrate?: boolean;
}

export async function buildApiApp(options: ApiAppOptions): Promise<FastifyInstance> {
  const dbHandle = options.db ?? openDb(options.env.DATABASE_URL);
  if (options.migrate ?? true) {
    await runMigrations(dbHandle);
  }

  const app = Fastify({
    logger: {
      level: options.env.API_LOG_LEVEL,
    },
  });

  await app.register(cors, {
    origin: options.env.NODE_ENV === "production" ? false : true,
    credentials: true,
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    max: options.env.NODE_ENV === "test" ? 1_000 : 60,
    timeWindow: "1 minute",
  });

  if (!options.db) {
    app.addHook("onClose", async () => {
      dbHandle.close();
    });
  }

  app.get("/", async () => buildHealthResponse());
  app.get("/health", async () => buildHealthResponse());

  const repos = createRepositories(dbHandle);
  const streaming = createStreamingCdpService({ env: options.env });
  await registerGlobalEventsRoutes(app, { env: options.env, repos });
  await registerInboxEventsRoutes(app, { env: options.env, repos });
  await registerMediaUploadRoutes(app, { env: options.env, repos });

  const campaignScheduler = createCampaignSchedulerDaemon({
    repos,
    logger: app.log,
    enabled: options.env.API_CAMPAIGN_SCHEDULER_ENABLED,
    userId: options.env.API_CAMPAIGN_SCHEDULER_USER_ID,
    ownerId: `api-daemon:${process.pid}`,
    intervalMs: options.env.API_CAMPAIGN_SCHEDULER_INTERVAL_MS,
  });
  campaignScheduler.start();
  const sendPolicy = resolveApiSendPolicy(options.env, [
    options.env.API_AUTOMATION_ENGINE_ALLOWED_PHONE,
  ]);
  const automationEngine = createAutomationEngineDaemon({
    repos,
    logger: app.log,
    enabled: options.env.API_AUTOMATION_ENGINE_ENABLED,
    userId: options.env.API_AUTOMATION_ENGINE_USER_ID,
    allowedPhone: options.env.API_AUTOMATION_ENGINE_ALLOWED_PHONE,
    allowedPhones: sendPolicy.allowedPhones,
    sendPolicyMode: sendPolicy.mode,
    intervalMs: options.env.API_AUTOMATION_ENGINE_INTERVAL_MS,
  });
  automationEngine.start();
  app.addHook("onClose", async () => {
    campaignScheduler.stop();
    automationEngine.stop();
  });

  await app.register(fastifyTRPCPlugin, {
    prefix: "/trpc",
    trpcOptions: {
      router: appRouter,
      createContext: createContextFactory({ env: options.env, repos, streaming }),
      onError(opts: { error: Error; path?: string }) {
        app.log.error({ err: opts.error, path: opts.path }, "trpc error");
      },
    },
  });

  return app;
}

function buildHealthResponse(): HealthResponse {
  return healthResponseSchema.parse({
    ok: true,
    service: CONSTANTS.apiServiceName,
    version: CONSTANTS.appVersion,
    uptimeSeconds: Math.round(process.uptime()),
    startedAt: startedAt.toISOString(),
  });
}
