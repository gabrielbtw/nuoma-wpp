import { z } from "zod";

import { CONSTANTS } from "@nuoma/config";
import { healthResponseSchema, type HealthResponse } from "@nuoma/contracts";

import { adminProcedure, publicProcedure, router } from "../init.js";

const startedAt = new Date();
const workerStaleAfterMs = 90_000;

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
    ] =
      await Promise.all([
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
