import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { jobStatusSchema } from "@nuoma/contracts";

import { adminCsrfProcedure, adminProcedure, router } from "../init.js";

export const jobsRouter = router({
  listDead: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(500).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const jobs = await ctx.repos.jobs.listDead(ctx.user.id, input?.limit ?? 100);
      return { jobs };
    }),

  retryDead: adminCsrfProcedure
    .input(
      z.object({
        deadJobId: z.number().int().positive(),
        scheduledAt: z.string().datetime({ offset: true }).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const job = await ctx.repos.jobs.retryDead({
        deadJobId: input.deadJobId,
        userId: ctx.user.id,
        scheduledAt: input.scheduledAt,
      });
      if (!job) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Dead job not found" });
      }
      await ctx.repos.auditLogs.create({
        userId: ctx.user.id,
        actorUserId: ctx.user.id,
        action: "jobs.dead.retry",
        targetTable: "jobs_dead",
        targetId: input.deadJobId,
        ipAddress: ctx.req.ip,
        userAgent: ctx.req.headers["user-agent"] ?? null,
      });
      return { job };
    }),

  cleanup: adminCsrfProcedure
    .input(
      z
        .object({ olderThanDays: z.number().int().min(1).max(365).optional() })
        .optional(),
    )
    .mutation(async ({ ctx, input }) => {
      const days = input?.olderThanDays ?? 30;
      const olderThan = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const deleted = await ctx.repos.jobs.cleanupCompleted({
        olderThan: olderThan.toISOString(),
      });
      await ctx.repos.auditLogs.create({
        userId: ctx.user.id,
        actorUserId: ctx.user.id,
        action: "jobs.cleanup_completed",
        targetTable: "jobs",
        ipAddress: ctx.req.ip,
        userAgent: ctx.req.headers["user-agent"] ?? null,
      });
      return { ok: true as const, deleted };
    }),

  list: adminProcedure
    .input(z.object({ status: jobStatusSchema.optional() }).optional())
    .query(async ({ ctx, input }) => {
      const jobs = await ctx.repos.jobs.list(ctx.user.id, input?.status);
      return { jobs };
    }),
});
