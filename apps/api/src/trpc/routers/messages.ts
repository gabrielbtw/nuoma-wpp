import { randomUUID } from "node:crypto";

import { z } from "zod";

import { TRPCError } from "@trpc/server";
import {
  createMessageInputSchema,
  idempotencyKey,
  updateMessageInputSchema,
} from "@nuoma/contracts";
import type { Repositories } from "@nuoma/db";

import {
  evaluateApiRealSendTarget,
  normalizePhone,
  resolveApiSendPolicy,
} from "../../services/send-policy.js";
import { protectedCsrfProcedure, protectedProcedure, router } from "../init.js";

const createMessageBodySchema = createMessageInputSchema.omit({ userId: true });
const updateMessageBodySchema = updateMessageInputSchema.omit({ userId: true });
const manualSendAllowedPhone = "5531982066263";
const clientNonceSchema = z.string().min(8).max(128).optional();
const instagramSendWindowMs = 24 * 60 * 60 * 1000;

function resolveManualIdempotencyKey(input: {
  userId: number;
  conversationId: number;
  clientNonce?: string | undefined;
}): string {
  return idempotencyKey({
    kind: "manual",
    userId: input.userId,
    conversationId: input.conversationId,
    clientNonce: input.clientNonce ?? randomUUID(),
  });
}

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
        clientNonce: clientNonceSchema,
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
      const instagramHandle =
        conversation.channel === "instagram"
          ? await deriveConversationInstagramHandle(ctx.repos, ctx.user.id, conversation)
          : null;
      if (conversation.channel === "instagram") {
        await assertApiInstagramWithin24hWindow(ctx.repos, {
          userId: ctx.user.id,
          conversationId: conversation.id,
          contactId: conversation.contactId,
          instagramHandle,
          scheduledAt: input.scheduledAt ?? null,
        });
      }

      const dispatchIdempotencyKey = resolveManualIdempotencyKey({
        userId: ctx.user.id,
        conversationId: conversation.id,
        clientNonce: input.clientNonce,
      });

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
          instagramHandle,
          body: input.body,
          clientNonce: input.clientNonce ?? null,
          idempotencyKey: dispatchIdempotencyKey,
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
        clientNonce: clientNonceSchema,
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

      const dispatchIdempotencyKey = resolveManualIdempotencyKey({
        userId: ctx.user.id,
        conversationId: conversation.id,
        clientNonce: input.clientNonce,
      });

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
          clientNonce: input.clientNonce ?? null,
          idempotencyKey: dispatchIdempotencyKey,
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
        clientNonce: clientNonceSchema,
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
      if (conversation.channel !== "whatsapp" && conversation.channel !== "instagram") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Media sending does not support ${conversation.channel} conversations`,
        });
      }
      const phone =
        conversation.channel === "whatsapp" ? normalizePhone(conversation.externalThreadId) : null;
      if (conversation.channel === "whatsapp") {
        assertApiSendAllowed(ctx.env, phone);
      }

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
      if (conversation.channel === "instagram" && mediaAsset.type === "document") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Instagram media sending supports image and video assets only",
        });
      }

      const dispatchIdempotencyKey = resolveManualIdempotencyKey({
        userId: ctx.user.id,
        conversationId: conversation.id,
        clientNonce: input.clientNonce,
      });
      const instagramHandle =
        conversation.channel === "instagram"
          ? await deriveConversationInstagramHandle(ctx.repos, ctx.user.id, conversation)
          : null;
      if (conversation.channel === "instagram") {
        await assertApiInstagramWithin24hWindow(ctx.repos, {
          userId: ctx.user.id,
          conversationId: conversation.id,
          contactId: conversation.contactId,
          instagramHandle,
          scheduledAt: input.scheduledAt ?? null,
        });
      }

      const job = await ctx.repos.jobs.create({
        userId: ctx.user.id,
        type:
          conversation.channel === "instagram"
            ? "send_instagram_message"
            : mediaAsset.type === "document"
              ? "send_document"
              : "send_media",
        status: "queued",
        payload: {
          conversationId: conversation.id,
          phone,
          instagramHandle,
          body: input.caption?.trim() || "",
          mediaAssetId: mediaAsset.id,
          mediaType: mediaAsset.type,
          caption: input.caption?.trim() || null,
          source: "inbox.composer",
          clientNonce: input.clientNonce ?? null,
          idempotencyKey: dispatchIdempotencyKey,
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

async function assertApiInstagramWithin24hWindow(
  repos: Repositories,
  input: {
    userId: number;
    conversationId: number;
    contactId: number | null;
    instagramHandle: string | null;
    scheduledAt: string | null;
  },
): Promise<void> {
  const latestInbound = await repos.messages.findLatestInboundByConversation({
    userId: input.userId,
    conversationId: input.conversationId,
  });
  const observedAtUtc = latestInbound?.observedAtUtc ?? null;
  const observedAtMs = observedAtUtc ? Date.parse(observedAtUtc) : Number.NaN;
  const referenceAtMs = input.scheduledAt ? Date.parse(input.scheduledAt) : Date.now();
  const withinWindow =
    Number.isFinite(observedAtMs) &&
    Number.isFinite(referenceAtMs) &&
    referenceAtMs - observedAtMs <= instagramSendWindowMs;
  if (withinWindow) {
    return;
  }

  const errorCode = latestInbound ? "instagram_24h_window_expired" : "instagram_24h_window_missing";
  const errorMessage = latestInbound
    ? "Instagram send blocked: last inbound message is outside the 24h window"
    : "Instagram send blocked: no inbound message found for 24h window";
  await repos.systemEvents.create({
    userId: input.userId,
    type: "sender.instagram_24h_window.blocked",
    severity: "warn",
    payload: JSON.stringify({
      source: "api.messages",
      conversationId: input.conversationId,
      contactId: input.contactId,
      instagramHandle: input.instagramHandle,
      latestInboundMessageId: latestInbound?.id ?? null,
      latestInboundObservedAtUtc: observedAtUtc,
      scheduledAt: input.scheduledAt,
      sendWindowMs: instagramSendWindowMs,
      reason: errorCode,
    }),
  });
  await repos.sendAuditEvents.create({
    userId: input.userId,
    campaignId: null,
    contactId: input.contactId,
    conversationId: input.conversationId,
    messageId: null,
    jobId: null,
    channel: "instagram",
    phase: "policy_block",
    latencyMs: null,
    errorCode,
    errorMessage,
    payloadHash: null,
    workerId: null,
    metadata: {
      source: "api.messages",
      instagramHandle: input.instagramHandle,
      latestInboundMessageId: latestInbound?.id ?? null,
      latestInboundObservedAtUtc: observedAtUtc,
      scheduledAt: input.scheduledAt,
      sendWindowMs: instagramSendWindowMs,
    },
  });
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: `${errorMessage}${input.instagramHandle ? `: @${input.instagramHandle}` : ""}`,
  });
}

async function deriveConversationInstagramHandle(
  repos: Repositories,
  userId: number,
  conversation: { contactId: number | null; externalThreadId: string; title: string },
): Promise<string | null> {
  if (conversation.contactId) {
    const contact = await repos.contacts.findById(conversation.contactId);
    if (contact?.userId === userId) {
      const fromContact = normalizeInstagramHandle(contact.instagramHandle);
      if (fromContact) return fromContact;
    }
  }
  return normalizeInstagramHandle(conversation.externalThreadId);
}

function normalizeInstagramHandle(value: string | null | undefined): string | null {
  const cleaned = String(value ?? "")
    .trim()
    .replace(/^ig:/i, "")
    .replace(/^@+/, "")
    .toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(cleaned) ? cleaned : null;
}
