import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  createReminderInputSchema,
  listRemindersFilterSchema,
  updateReminderInputSchema,
} from "@nuoma/contracts";

import { protectedCsrfProcedure, protectedProcedure, router } from "../init.js";

const createReminderBodySchema = createReminderInputSchema.omit({ userId: true });
const updateReminderBodySchema = updateReminderInputSchema.omit({ userId: true });
const listRemindersBodySchema = listRemindersFilterSchema.omit({ userId: true }).optional();

export const remindersRouter = router({
  list: protectedProcedure.input(listRemindersBodySchema).query(async ({ ctx, input }) => {
    const cursor = input?.cursor ? Number.parseInt(input.cursor, 10) : undefined;
    if (input?.cursor && !Number.isFinite(cursor)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid reminder cursor" });
    }

    const reminders = await ctx.repos.reminders.list({
      userId: ctx.user.id,
      contactId: input?.contactId,
      conversationId: input?.conversationId,
      assignedToUserId: input?.assignedToUserId,
      status: input?.status,
      dueBefore: input?.dueBefore,
      dueAfter: input?.dueAfter,
      cursor,
      limit: input?.limit,
    });
    return { reminders };
  }),

  create: protectedCsrfProcedure
    .input(createReminderBodySchema)
    .mutation(async ({ ctx, input }) => {
      const conversation = input.conversationId
        ? await ctx.repos.conversations.findById({
            userId: ctx.user.id,
            id: input.conversationId,
          })
        : null;

      if (input.conversationId && !conversation) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }

      const reminder = await ctx.repos.reminders.create({
        userId: ctx.user.id,
        contactId: input.contactId ?? conversation?.contactId ?? null,
        conversationId: input.conversationId ?? null,
        assignedToUserId: input.assignedToUserId ?? ctx.user.id,
        title: input.title,
        notes: input.notes ?? null,
        dueAt: input.dueAt,
        status: "open",
      });

      return { reminder };
    }),

  update: protectedCsrfProcedure
    .input(updateReminderBodySchema)
    .mutation(async ({ ctx, input }) => {
      const completedAt =
        input.completedAt !== undefined
          ? input.completedAt
          : input.status === "done"
            ? new Date().toISOString()
            : input.status === "open" || input.status === "cancelled"
              ? null
              : undefined;

      const reminder = await ctx.repos.reminders.update({
        ...input,
        userId: ctx.user.id,
        completedAt,
      });

      if (!reminder) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Reminder not found" });
      }

      return { reminder };
    }),

  complete: protectedCsrfProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const reminder = await ctx.repos.reminders.update({
        id: input.id,
        userId: ctx.user.id,
        status: "done",
        completedAt: new Date().toISOString(),
      });

      if (!reminder) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Reminder not found" });
      }

      return { reminder };
    }),
});
