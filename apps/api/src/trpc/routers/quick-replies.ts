import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  createQuickReplyInputSchema,
  listQuickRepliesFilterSchema,
  updateQuickReplyInputSchema,
} from "@nuoma/contracts";

import { protectedCsrfProcedure, protectedProcedure, router } from "../init.js";

const createQuickReplyBodySchema = createQuickReplyInputSchema.omit({ userId: true });
const updateQuickReplyBodySchema = updateQuickReplyInputSchema.omit({ userId: true });
const listQuickRepliesBodySchema = listQuickRepliesFilterSchema.omit({ userId: true }).optional();

function normalizeOptionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export const quickRepliesRouter = router({
  list: protectedProcedure.input(listQuickRepliesBodySchema).query(async ({ ctx, input }) => {
    const cursor = input?.cursor ? Number.parseInt(input.cursor, 10) : undefined;
    if (input?.cursor && !Number.isFinite(cursor)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid quick reply cursor" });
    }

    const quickReplies = await ctx.repos.quickReplies.list({
      userId: ctx.user.id,
      query: input?.query,
      category: input?.category,
      isActive: input?.isActive ?? true,
      includeDeleted: input?.includeDeleted,
      cursor,
      limit: input?.limit,
    });
    return { quickReplies };
  }),

  create: protectedCsrfProcedure
    .input(createQuickReplyBodySchema)
    .mutation(async ({ ctx, input }) => {
      const quickReply = await ctx.repos.quickReplies.create({
        userId: ctx.user.id,
        title: input.title.trim(),
        body: input.body.trim(),
        shortcut: normalizeOptionalText(input.shortcut),
        category: normalizeOptionalText(input.category),
        sortOrder: input.sortOrder ?? 0,
      });
      return { quickReply };
    }),

  update: protectedCsrfProcedure
    .input(updateQuickReplyBodySchema)
    .mutation(async ({ ctx, input }) => {
      const quickReply = await ctx.repos.quickReplies.update({
        ...input,
        userId: ctx.user.id,
        title: input.title?.trim(),
        body: input.body?.trim(),
        shortcut:
          input.shortcut === undefined ? undefined : normalizeOptionalText(input.shortcut),
        category:
          input.category === undefined ? undefined : normalizeOptionalText(input.category),
      });

      if (!quickReply) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Quick reply not found" });
      }

      return { quickReply };
    }),

  markUsed: protectedCsrfProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const quickReply = await ctx.repos.quickReplies.markUsed({
        id: input.id,
        userId: ctx.user.id,
      });

      if (!quickReply) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Quick reply not found" });
      }

      return { quickReply };
    }),

  softDelete: protectedCsrfProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const quickReply = await ctx.repos.quickReplies.update({
        id: input.id,
        userId: ctx.user.id,
        deletedAt: new Date().toISOString(),
        isActive: false,
      });

      if (!quickReply) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Quick reply not found" });
      }

      return { quickReply, ok: true };
    }),
});
