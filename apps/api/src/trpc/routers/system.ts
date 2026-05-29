import { z } from "zod";

import { CONSTANTS } from "@nuoma/config";
import { healthResponseSchema, type HealthResponse } from "@nuoma/contracts";

import { adminProcedure, publicProcedure, router } from "../init.js";

const startedAt = new Date();
const workerStaleAfterMs = 90_000;
const sendAuditPhaseSchema = z.enum([
  "queued",
  "dispatching",
  "sent",
  "delivered",
  "read",
  "failed",
  "duplicate",
  "policy_block",
]);

export const systemRouter = router({
  health: publicProcedure.query((): HealthResponse => {
    return healthResponseSchema.parse({
      ok: true,
      service: CONSTANTS.apiServiceName,
      version: CONSTANTS.appVersion,
      uptimeSeconds: Math.round(process.uptime()),
      startedAt: startedAt.toISOString(),
    });
  }),

  events: adminProcedure
    .input(
      z
        .object({
          type: z.string().min(1).optional(),
          severity: z.enum(["debug", "info", "warn", "error"]).optional(),
          limit: z.number().int().min(1).max(500).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const events = await ctx.repos.systemEvents.list({
        userId: ctx.user.id,
        type: input?.type,
        severity: input?.severity,
        limit: input?.limit ?? 100,
      });
      return { events };
    }),

  sendAuditEvents: adminProcedure
    .input(
      z
        .object({
          campaignId: z.number().int().positive().optional(),
          contactId: z.number().int().positive().optional(),
          conversationId: z.number().int().positive().optional(),
          jobId: z.number().int().positive().optional(),
          phase: sendAuditPhaseSchema.optional(),
          limit: z.number().int().min(1).max(200).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const events = await ctx.repos.sendAuditEvents.list({
        userId: ctx.user.id,
        campaignId: input?.campaignId,
        contactId: input?.contactId,
        conversationId: input?.conversationId,
        jobId: input?.jobId,
        phase: input?.phase,
        limit: input?.limit ?? 50,
      });
      return { events };
    }),

  metrics: adminProcedure.query(async ({ ctx }) => {
    const metricsSince = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const [
      jobsByStatus,
      deadJobsCount,
      recentJobs,
      operationalMetrics,
      workers,
      warnEvents,
      errorEvents,
    ] = await Promise.all([
      ctx.repos.jobs.countByStatus(ctx.user.id),
      ctx.repos.jobs.countDead(ctx.user.id),
      ctx.repos.jobs.list(ctx.user.id),
      ctx.repos.jobs.operationalMetrics({
        userId: ctx.user.id,
        since: metricsSince,
      }),
      ctx.repos.workerState.list(),
      ctx.repos.systemEvents.list({
        userId: ctx.user.id,
        severity: "warn",
        limit: 20,
      }),
      ctx.repos.systemEvents.list({
        userId: ctx.user.id,
        severity: "error",
        limit: 20,
      }),
    ]);

    const now = Date.now();
    const workerItems = workers.map((worker) => {
      const heartbeatAgeSeconds = Math.max(
        0,
        Math.round((now - Date.parse(worker.heartbeatAt)) / 1000),
      );
      const stale = heartbeatAgeSeconds > workerStaleAfterMs / 1000;
      return {
        ...worker,
        heartbeatAgeSeconds,
        stale,
        cdpConnected: worker.browserConnected,
      };
    });
    const activeJobs = statusCount(jobsByStatus, "claimed") + statusCount(jobsByStatus, "running");
    const criticalEvents = [...warnEvents, ...errorEvents]
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, 12);
    const cdpConnected = workerItems.some((worker) => worker.cdpConnected && !worker.stale);
    const instagramSession = latestInstagramSession(workerItems);
    const workerErrors = workerItems.filter(
      (worker) => worker.status === "error" || Boolean(worker.lastError),
    ).length;

    return {
      health: {
        ok: true,
        service: CONSTANTS.apiServiceName,
        version: CONSTANTS.appVersion,
        uptimeSeconds: Math.round(process.uptime()),
        startedAt: startedAt.toISOString(),
      },
      jobsByStatus,
      jobs: {
        total: Object.values(jobsByStatus).reduce((sum, count) => sum + count, 0),
        queued: statusCount(jobsByStatus, "queued"),
        active: activeJobs,
        failed: statusCount(jobsByStatus, "failed"),
        completed: statusCount(jobsByStatus, "completed"),
        dead: deadJobsCount,
        recent: recentJobs.slice(0, 12),
      },
      operations: {
        windowSeconds: 3600,
        since: metricsSince,
        ...operationalMetrics,
      },
      workers: {
        total: workerItems.length,
        online: workerItems.filter((worker) => !worker.stale).length,
        stale: workerItems.filter((worker) => worker.stale).length,
        withErrors: workerErrors,
        browserConnected: workerItems.filter((worker) => worker.cdpConnected && !worker.stale)
          .length,
        items: workerItems,
      },
      whatsapp: {
        cdpConnected,
        sessionStatus:
          workerItems.length === 0 ? "no_worker" : cdpConnected ? "connected" : "disconnected",
      },
      instagram: {
        cdpConnected,
        sessionStatus:
          instagramSession?.status ??
          (workerItems.length === 0 ? "no_worker" : cdpConnected ? "unknown" : "disconnected"),
        authenticated: Boolean(instagramSession?.authenticated),
        username: instagramSession?.username ?? null,
        pageUrl: instagramSession?.pageUrl ?? null,
        lastSyncAt: instagramSession?.lastSyncAt ?? null,
      },
      criticalEvents,
      sendPolicy: {
        apiMode: ctx.env.API_SEND_POLICY_MODE,
        apiAllowedPhonesConfigured: Boolean(ctx.env.API_SEND_ALLOWED_PHONES.trim()),
      },
    };
  }),
});

function statusCount(counts: Record<string, number>, status: string): number {
  return counts[status] ?? 0;
}

function latestInstagramSession(
  workers: Array<{ metrics: Record<string, unknown>; stale: boolean }>,
) {
  for (const worker of workers) {
    if (worker.stale) continue;
    const instagram = worker.metrics.instagram;
    if (!instagram || typeof instagram !== "object" || Array.isArray(instagram)) continue;
    const session = (instagram as { session?: unknown }).session;
    if (!session || typeof session !== "object" || Array.isArray(session)) continue;
    return session as {
      status?: string;
      authenticated?: boolean;
      username?: string | null;
      pageUrl?: string | null;
      lastSyncAt?: string | null;
    };
  }
  return null;
}
