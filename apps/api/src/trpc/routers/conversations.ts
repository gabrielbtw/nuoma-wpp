import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createConversationInputSchema, updateConversationInputSchema } from "@nuoma/contracts";

import {
  adminCsrfProcedure,
  adminProcedure,
  protectedCsrfProcedure,
  protectedProcedure,
  router,
} from "../init.js";

const createConversationBodySchema = createConversationInputSchema.omit({ userId: true });
const updateConversationBodySchema = updateConversationInputSchema.omit({ userId: true });

export const conversationsRouter = router({
  list: adminProcedure
    .input(
      z.object({ limit: z.number().int().min(1).max(500).optional() }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const conversations = await ctx.repos.conversations.list(
        ctx.user.id,
        input?.limit ?? 100,
      );
      return { conversations };
    }),

  get: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const conversation = await ctx.repos.conversations.findById({
        userId: ctx.user.id,
        id: input.id,
      });
      if (!conversation) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }
      return { conversation };
    }),

  create: protectedCsrfProcedure
    .input(createConversationBodySchema)
    .mutation(async ({ ctx, input }) => {
      const conversation = await ctx.repos.conversations.create({
        userId: ctx.user.id,
        contactId: input.contactId ?? null,
        channel: input.channel,
        externalThreadId: input.externalThreadId,
        title: input.title,
      });
      return { conversation };
    }),

  update: protectedCsrfProcedure
    .input(updateConversationBodySchema)
    .mutation(async ({ ctx, input }) => {
      const conversation = await ctx.repos.conversations.update({
        ...input,
        userId: ctx.user.id,
      });
      return { conversation };
    }),

  softDelete: protectedCsrfProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const conversation = await ctx.repos.conversations.update({
        userId: ctx.user.id,
        id: input.id,
        isArchived: true,
      });
      return { conversation, ok: Boolean(conversation) };
    }),

  restore: protectedCsrfProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const conversation = await ctx.repos.conversations.update({
        userId: ctx.user.id,
        id: input.id,
        isArchived: false,
      });
      return { conversation, ok: Boolean(conversation) };
    }),

  forceSync: adminCsrfProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        phone: z.string().min(8).optional(),
        scheduledAt: z.string().datetime({ offset: true }).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const conversation = await ctx.repos.conversations.findById({
        userId: ctx.user.id,
        id: input.id,
      });
      if (!conversation) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }

      const job = await ctx.repos.jobs.create({
        userId: ctx.user.id,
        type: "sync_conversation",
        status: "queued",
        payload: {
          conversationId: conversation.id,
          phone: input.phone ?? null,
          source: "admin.force_conversation",
        },
        priority: 1,
        scheduledAt: input.scheduledAt ?? new Date().toISOString(),
        maxAttempts: 2,
      });

      await ctx.repos.auditLogs.create({
        userId: ctx.user.id,
        actorUserId: ctx.user.id,
        action: "sync.force_conversation",
        targetTable: "conversations",
        targetId: conversation.id,
        ipAddress: ctx.req.ip,
        userAgent: ctx.req.headers["user-agent"] ?? null,
      });
      return { job, conversation };
    }),

  forceHistorySync: adminCsrfProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        phone: z.string().min(8).optional(),
        maxScrolls: z.number().int().min(1).max(25).default(3),
        delayMs: z.number().int().min(250).max(10_000).default(1_200),
        scheduledAt: z.string().datetime({ offset: true }).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const conversation = await ctx.repos.conversations.findById({
        userId: ctx.user.id,
        id: input.id,
      });
      if (!conversation) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }

      const job = await ctx.repos.jobs.create({
        userId: ctx.user.id,
        type: "sync_history",
        status: "queued",
        payload: {
          conversationId: conversation.id,
          phone: input.phone ?? null,
          maxScrolls: input.maxScrolls,
          delayMs: input.delayMs,
          source: "admin.force_history",
        },
        priority: 1,
        scheduledAt: input.scheduledAt ?? new Date().toISOString(),
        maxAttempts: 2,
      });

      await ctx.repos.auditLogs.create({
        userId: ctx.user.id,
        actorUserId: ctx.user.id,
        action: "sync.force_history",
        targetTable: "conversations",
        targetId: conversation.id,
        ipAddress: ctx.req.ip,
        userAgent: ctx.req.headers["user-agent"] ?? null,
      });
      return { job, conversation };
    }),
});
