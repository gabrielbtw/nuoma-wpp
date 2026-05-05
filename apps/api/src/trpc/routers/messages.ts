import { z } from "zod";

import { TRPCError } from "@trpc/server";
import { createMessageInputSchema, updateMessageInputSchema } from "@nuoma/contracts";

import {
  evaluateApiRealSendTarget,
  normalizePhone,
  resolveApiSendPolicy,
} from "../../services/send-policy.js";
import { protectedCsrfProcedure, protectedProcedure, router } from "../init.js";

const createMessageBodySchema = createMessageInputSchema.omit({ userId: true });
const updateMessageBodySchema = updateMessageInputSchema.omit({ userId: true });
const manualSendAllowedPhone = "5531982066263";

export const messagesRouter = router({
  listByConversation: protectedProcedure
    .input(
      z.object({
        conversationId: z.number().int().positive(),
        limit: z.number().int().min(1).max(500).optional(),
        includeDeleted: z.boolean().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const messages = await ctx.repos.messages.listByConversation({
        userId: ctx.user.id,
        conversationId: input.conversationId,
        limit: input.limit,
        includeDeleted: input.includeDeleted,
      });
      return { messages };
    }),

  get: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const message = await ctx.repos.messages.findById({
        userId: ctx.user.id,
        id: input.id,
      });
      return { message };
    }),

  create: protectedCsrfProcedure
    .input(createMessageBodySchema)
    .mutation(async ({ ctx, input }) => {
      const conversation = await ctx.repos.conversations.findById({
        userId: ctx.user.id,
        id: input.conversationId,
      });
      if (!conversation) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }
      const message = await ctx.repos.messages.create({
        ...input,
        userId: ctx.user.id,
        contactId: input.contactId ?? conversation.contactId,
        body: input.body ?? null,
        media: input.media ?? null,
        raw: input.raw ?? null,
      });
      return { message };
    }),

  update: protectedCsrfProcedure
    .input(updateMessageBodySchema)
    .mutation(async ({ ctx, input }) => {
      const message = await ctx.repos.messages.update({
        ...input,
        userId: ctx.user.id,
      });
      return { message };
    }),

  softDelete: protectedCsrfProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const message = await ctx.repos.messages.update({
        userId: ctx.user.id,
        id: input.id,
        deletedAt: new Date().toISOString(),
      });
      return { message, ok: Boolean(message) };
    }),

  send: protectedCsrfProcedure
    .input(
      z.object({
        conversationId: z.number().int().positive(),
        body: z.string().min(1).max(4096),
        scheduledAt: z.string().datetime({ offset: true }).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const conversation = await ctx.repos.conversations.findById({
        userId: ctx.user.id,
        id: input.conversationId,
      });
      if (!conversation) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }
      const phone = normalizePhone(conversation.externalThreadId);
      if (conversation.channel === "whatsapp") {
        assertApiSendAllowed(ctx.env, phone);
      }

      const job = await ctx.repos.jobs.create({
        userId: ctx.user.id,
        type:
          conversation.channel === "instagram"
            ? "send_instagram_message"
            : "send_message",
        status: "queued",
        payload: {
          conversationId: conversation.id,
          phone,
          body: input.body,
        },
        priority: 5,
        scheduledAt: input.scheduledAt ?? new Date().toISOString(),
        maxAttempts: 3,
      });

      return { job };
    }),

  sendVoice: protectedCsrfProcedure
    .input(
      z.object({
        conversationId: z.number().int().positive(),
        mediaAssetId: z.number().int().positive(),
        scheduledAt: z.string().datetime({ offset: true }).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const conversation = await ctx.repos.conversations.findById({
        userId: ctx.user.id,
        id: input.conversationId,
      });
      if (!conversation) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }
      if (conversation.channel !== "whatsapp") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Voice recording can only be sent to WhatsApp conversations",
        });
      }
      const phone = normalizePhone(conversation.externalThreadId);
      assertApiSendAllowed(ctx.env, phone);

      const mediaAsset = await ctx.repos.mediaAssets.findById({
        userId: ctx.user.id,
        id: input.mediaAssetId,
      });
      if (!mediaAsset || mediaAsset.deletedAt) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Voice media asset not found" });
      }
      if (mediaAsset.type !== "voice" && mediaAsset.type !== "audio") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Voice recording requires audio/voice media, got ${mediaAsset.type}`,
        });
      }

      const job = await ctx.repos.jobs.create({
        userId: ctx.user.id,
        type: "send_voice",
        status: "queued",
        payload: {
          conversationId: conversation.id,
          phone,
          audioPath: mediaAsset.storagePath,
          mediaAssetId: mediaAsset.id,
          fileName: mediaAsset.fileName,
          mimeType: mediaAsset.mimeType,
          durationMs: mediaAsset.durationMs,
          source: "inbox.voice_recorder",
        },
        priority: 4,
        scheduledAt: input.scheduledAt ?? new Date().toISOString(),
        maxAttempts: 3,
      });

      return { job, mediaAsset };
    }),

  sendMedia: protectedCsrfProcedure
    .input(
      z.object({
        conversationId: z.number().int().positive(),
        mediaAssetId: z.number().int().positive(),
        caption: z.string().max(1024).nullable().optional(),
        scheduledAt: z.string().datetime({ offset: true }).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const conversation = await ctx.repos.conversations.findById({
        userId: ctx.user.id,
        id: input.conversationId,
      });
      if (!conversation) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }
      if (conversation.channel !== "whatsapp") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Media sending can only target WhatsApp conversations in this phase",
        });
      }
      const phone = normalizePhone(conversation.externalThreadId);
      assertApiSendAllowed(ctx.env, phone);

      const mediaAsset = await ctx.repos.mediaAssets.findById({
        userId: ctx.user.id,
        id: input.mediaAssetId,
      });
      if (!mediaAsset || mediaAsset.deletedAt) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Media asset not found" });
      }
      if (!["image", "video", "document"].includes(mediaAsset.type)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Unsupported composer media type: ${mediaAsset.type}`,
        });
      }

      const job = await ctx.repos.jobs.create({
        userId: ctx.user.id,
        type: mediaAsset.type === "document" ? "send_document" : "send_media",
        status: "queued",
        payload: {
          conversationId: conversation.id,
          phone,
          mediaAssetId: mediaAsset.id,
          mediaType: mediaAsset.type,
          caption: input.caption?.trim() || null,
          source: "inbox.composer",
        },
        priority: 4,
        scheduledAt: input.scheduledAt ?? new Date().toISOString(),
        maxAttempts: 3,
      });

      return { job, mediaAsset };
    }),
});

function assertApiSendAllowed(
  env: Parameters<typeof resolveApiSendPolicy>[0],
  phone: string | null,
): asserts phone is string {
  if (phone !== manualSendAllowedPhone) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Envio bloqueado pela allowlist da API: manual_target_not_${manualSendAllowedPhone}`,
    });
  }
  const decision = evaluateApiRealSendTarget(resolveApiSendPolicy(env), phone ?? "");
  if (!decision.allowed) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Envio bloqueado pela allowlist da API: ${decision.reason}`,
    });
  }
}
