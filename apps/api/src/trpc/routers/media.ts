import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  createMediaAssetInputSchema,
  mediaAssetTypeSchema,
  updateMediaAssetInputSchema,
} from "@nuoma/contracts";

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
