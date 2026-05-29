import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { CONSTANTS } from "@nuoma/config";
import type { Repositories } from "@nuoma/db";

const syncRequestSchema = z
  .object({
    threadLimit: z.coerce.number().int().min(1).max(50).optional(),
    messagesLimit: z.coerce.number().int().min(1).max(100).optional(),
    scrollPasses: z.coerce.number().int().min(1).max(50).optional(),
  })
  .partial()
  .default({});

export async function registerInstagramRoutes(
  app: FastifyInstance,
  input: { repos: Repositories },
): Promise<void> {
  app.get("/instagram/session", async () => {
    return readLatestInstagramSession(input.repos);
  });

  app.post("/instagram/session/open", async () => {
    const job = await input.repos.jobs.create({
      userId: CONSTANTS.defaultUserId,
      type: "sync_inbox_force",
      status: "queued",
      payload: {
        channel: "instagram",
        openPage: true,
        threadLimit: 1,
        source: "api.instagram.session.open",
      },
      priority: 1,
      scheduledAt: new Date().toISOString(),
      maxAttempts: 2,
    });
    return {
      queued: Boolean(job),
      job,
      session: await readLatestInstagramSession(input.repos),
    };
  });

  app.post("/instagram/sync", async (request) => {
    const body = syncRequestSchema.parse(request.body ?? {});
    const job = await input.repos.jobs.create({
      userId: CONSTANTS.defaultUserId,
      type: "sync_inbox_force",
      status: "queued",
      payload: {
        channel: "instagram",
        openPage: true,
        threadLimit: body.threadLimit ?? null,
        messagesLimit: body.messagesLimit ?? null,
        scrollPasses: body.scrollPasses ?? null,
        source: "api.instagram.sync",
      },
      priority: 1,
      scheduledAt: new Date().toISOString(),
      maxAttempts: 2,
    });
    return {
      queued: Boolean(job),
      job,
      requested: body,
      session: await readLatestInstagramSession(input.repos),
    };
  });
}

async function readLatestInstagramSession(repos: Repositories) {
  const workers = await repos.workerState.list();
  const worker = workers.find((candidate) => {
    const metrics = candidate.metrics as Record<string, unknown>;
    return Boolean(metrics.instagram);
  });
  const metrics = worker?.metrics as { instagram?: Record<string, unknown> } | undefined;
  const instagram = metrics?.instagram ?? {};
  const session =
    instagram.session && typeof instagram.session === "object"
      ? (instagram.session as Record<string, unknown>)
      : null;

  return {
    mode: session?.mode ?? "shared-cdp",
    status: session?.status ?? (worker ? "not_open" : "no_worker"),
    authenticated: Boolean(session?.authenticated),
    username: typeof session?.username === "string" ? session.username : null,
    lastSyncAt: typeof instagram.lastSyncAt === "string" ? instagram.lastSyncAt : null,
    threadCount: typeof session?.threadCount === "number" ? session.threadCount : 0,
    messageCount: typeof session?.messageCount === "number" ? session.messageCount : 0,
    errorMessage:
      typeof session?.errorMessage === "string"
        ? session.errorMessage
        : typeof instagram.lastError === "string"
          ? instagram.lastError
          : null,
    sharedBrowser: true,
    browserEndpoint: typeof session?.browserEndpoint === "string" ? session.browserEndpoint : null,
    pageUrl: typeof session?.pageUrl === "string" ? session.pageUrl : null,
    lastCheckedAt: typeof session?.lastCheckedAt === "string" ? session.lastCheckedAt : null,
    worker: worker
      ? {
          workerId: worker.workerId,
          status: worker.status,
          heartbeatAt: worker.heartbeatAt,
          stale: Date.now() - Date.parse(worker.heartbeatAt) > 90_000,
        }
      : null,
  };
}
