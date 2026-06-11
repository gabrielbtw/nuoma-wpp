import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  createMediaAssetInputSchema,
  type MediaAsset,
  mediaAssetTypeSchema,
  updateMediaAssetInputSchema,
} from "@nuoma/contracts";

import { createMediaReadUrl } from "../../services/media-read-token.js";
import { protectedCsrfProcedure, protectedProcedure, router } from "../init.js";

const uploadMediaAssetSchema = createMediaAssetInputSchema.omit({ userId: true });
const updateMediaAssetBodySchema = updateMediaAssetInputSchema.omit({ userId: true });

export const mediaRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          type: mediaAssetTypeSchema.optional(),
          sha256: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .optional(),
          includeDeleted: z.boolean().optional(),
          limit: z.number().int().min(1).max(500).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const assets = await ctx.repos.mediaAssets.list({
        userId: ctx.user.id,
        type: input?.type,
        sha256: input?.sha256,
        includeDeleted: input?.includeDeleted,
        limit: input?.limit,
      });
      return { assets };
    }),

  get: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const asset = await ctx.repos.mediaAssets.findById({
        userId: ctx.user.id,
        id: input.id,
      });
      return { asset };
    }),

  attachmentCandidatesByConversation: protectedProcedure
    .input(
      z.object({
        conversationId: z.number().int().positive(),
        contentType: mediaAssetTypeSchema.optional(),
        limit: z.number().int().min(1).max(50).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const conversation = await ctx.repos.conversations.findById({
        userId: ctx.user.id,
        id: input.conversationId,
      });
      if (!conversation) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }
      const [candidates, total] = await Promise.all([
        ctx.repos.attachmentCandidates.listByConversation({
          userId: ctx.user.id,
          conversationId: input.conversationId,
          contentType: input.contentType,
          limit: input.limit,
        }),
        ctx.repos.attachmentCandidates.countByConversation({
          userId: ctx.user.id,
          conversationId: input.conversationId,
          contentType: input.contentType,
        }),
      ]);
      const assets = await Promise.all(
        candidates.map((candidate) =>
          ctx.repos.mediaAssets.findById({
            userId: ctx.user.id,
            id: candidate.mediaAssetId,
          }),
        ),
      );
      return {
        total,
        candidates: candidates.map((candidate, index) => ({
          ...candidate,
          mediaAsset: assets[index] ?? null,
        })),
      };
    }),

  attachmentsByConversation: protectedProcedure
    .input(
      z.object({
        conversationId: z.number().int().positive(),
        contentType: mediaAssetTypeSchema.optional(),
        limit: z.number().int().min(1).max(100).optional(),
        ttlSeconds: z
          .number()
          .int()
          .min(60)
          .max(24 * 60 * 60)
          .optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const conversation = await ctx.repos.conversations.findById({
        userId: ctx.user.id,
        id: input.conversationId,
      });
      if (!conversation) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }
      const candidates = await ctx.repos.attachmentCandidates.listByConversation({
        userId: ctx.user.id,
        conversationId: input.conversationId,
        contentType: input.contentType,
        limit: input.limit,
      });
      const assets = await Promise.all(
        candidates.map((candidate) =>
          ctx.repos.mediaAssets.findById({
            userId: ctx.user.id,
            id: candidate.mediaAssetId,
          }),
        ),
      );
      return {
        attachments: candidates.map((candidate, index) => {
          const asset = assets[index] ?? null;
          return {
            ...candidate,
            mediaAsset: asset,
            read: asset ? mediaReadDescriptor(ctx.env, ctx.user.id, asset, input.ttlSeconds) : null,
            origin: mediaOrigin(candidate.metadata),
          };
        }),
      };
    }),

  readUrl: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        ttlSeconds: z
          .number()
          .int()
          .min(60)
          .max(24 * 60 * 60)
          .optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const asset = await ctx.repos.mediaAssets.findById({
        userId: ctx.user.id,
        id: input.id,
      });
      if (!asset || asset.deletedAt) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Media asset not found" });
      }
      return {
        asset,
        read: mediaReadDescriptor(ctx.env, ctx.user.id, asset, input.ttlSeconds),
      };
    }),

  profilePhoto: protectedProcedure
    .input(
      z
        .object({
          contactId: z.number().int().positive().optional(),
          conversationId: z.number().int().positive().optional(),
          ttlSeconds: z
            .number()
            .int()
            .min(60)
            .max(24 * 60 * 60)
            .optional(),
        })
        .refine((value) => value.contactId != null || value.conversationId != null, {
          message: "contactId or conversationId is required",
        }),
    )
    .query(async ({ ctx, input }) => {
      const conversation = input.conversationId
        ? await ctx.repos.conversations.findById({
            userId: ctx.user.id,
            id: input.conversationId,
          })
        : null;
      if (input.conversationId && !conversation) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }

      const contact = input.contactId
        ? await ctx.repos.contacts.findById(input.contactId)
        : conversation?.contactId
          ? await ctx.repos.contacts.findById(conversation.contactId)
          : null;
      if (contact && contact.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Contact not found" });
      }

      const assetId =
        contact?.profilePhotoMediaAssetId ?? conversation?.profilePhotoMediaAssetId ?? null;
      const asset = assetId
        ? await ctx.repos.mediaAssets.findById({ userId: ctx.user.id, id: assetId })
        : null;
      return {
        contact,
        conversation,
        asset,
        read: asset ? mediaReadDescriptor(ctx.env, ctx.user.id, asset, input.ttlSeconds) : null,
        sha256: contact?.profilePhotoSha256 ?? conversation?.profilePhotoSha256 ?? null,
        updatedAt: contact?.profilePhotoUpdatedAt ?? conversation?.profilePhotoUpdatedAt ?? null,
      };
    }),

  upload: protectedCsrfProcedure.input(uploadMediaAssetSchema).mutation(async ({ ctx, input }) => {
    const existing = await ctx.repos.mediaAssets.findBySha(ctx.user.id, input.sha256);
    if (existing) {
      return { asset: existing, deduped: true as const };
    }

    const asset = await ctx.repos.mediaAssets.create({
      ...input,
      userId: ctx.user.id,
      durationMs: input.durationMs ?? null,
      sourceUrl: input.sourceUrl ?? null,
      deletedAt: null,
    });
    return { asset, deduped: false as const };
  }),

  update: protectedCsrfProcedure
    .input(updateMediaAssetBodySchema)
    .mutation(async ({ ctx, input }) => {
      const asset = await ctx.repos.mediaAssets.update({
        ...input,
        userId: ctx.user.id,
      });
      return { asset };
    }),

  softDelete: protectedCsrfProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const asset = await ctx.repos.mediaAssets.update({
        id: input.id,
        userId: ctx.user.id,
        deletedAt: new Date().toISOString(),
      });
      return { asset };
    }),
});

function mediaReadDescriptor(
  env: Parameters<typeof createMediaReadUrl>[0]["env"],
  userId: number,
  asset: MediaAsset,
  ttlSeconds?: number,
) {
  const readable = !asset.deletedAt && !asset.storagePath.startsWith("wa-visible://");
  if (!readable) {
    return {
      readable: false,
      path: null,
      token: null,
      expiresAt: null,
      auth: "none" as const,
      provider: mediaProvider(asset.storagePath),
    };
  }
  const signed = createMediaReadUrl({ env, assetId: asset.id, userId, ttlSeconds });
  return {
    readable: true,
    path: signed.path,
    token: signed.token,
    expiresAt: signed.expiresAt,
    auth: "signed-url" as const,
    provider: mediaProvider(asset.storagePath),
  };
}

function mediaProvider(storagePath: string): "s3" | "local" | "virtual" {
  if (storagePath.startsWith("s3://")) return "s3";
  if (storagePath.startsWith("wa-visible://")) return "virtual";
  return "local";
}

function mediaOrigin(metadata: Record<string, unknown>): {
  channel: "whatsapp" | "instagram" | "system" | "unknown";
  source: string | null;
  externalMessageId: string | null;
} {
  const rawChannel = metadata.channel;
  const channel =
    rawChannel === "whatsapp" || rawChannel === "instagram" || rawChannel === "system"
      ? rawChannel
      : "unknown";
  return {
    channel,
    source: typeof metadata.source === "string" ? metadata.source : null,
    externalMessageId:
      typeof metadata.externalMessageId === "string" ? metadata.externalMessageId : null,
  };
}
