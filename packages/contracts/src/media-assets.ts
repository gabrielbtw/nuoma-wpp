import { z } from "zod";

import {
  baseEntitySchema,
  channelTypeSchema,
  idSchema,
  isoDateTimeSchema,
  jsonObjectSchema,
  mediaAssetTypeSchema,
} from "./common.js";
import { cursorPaginationSchema } from "./pagination.js";

export const mediaAssetSchema = baseEntitySchema.extend({
  type: mediaAssetTypeSchema,
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  sizeBytes: z.number().int().min(0),
  durationMs: z.number().int().min(0).nullable(),
  storagePath: z.string().min(1),
  sourceUrl: z.string().url().nullable(),
  deletedAt: isoDateTimeSchema.nullable(),
});

export const createMediaAssetInputSchema = z.object({
  userId: idSchema,
  type: mediaAssetTypeSchema,
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  sizeBytes: z.number().int().min(0),
  durationMs: z.number().int().min(0).nullable().optional(),
  storagePath: z.string().min(1),
  sourceUrl: z.string().url().nullable().optional(),
});

export const updateMediaAssetInputSchema = z.object({
  id: idSchema,
  userId: idSchema,
  fileName: z.string().min(1).optional(),
  sourceUrl: z.string().url().nullable().optional(),
  deletedAt: isoDateTimeSchema.nullable().optional(),
});

export const listMediaAssetsFilterSchema = cursorPaginationSchema.extend({
  userId: idSchema,
  type: mediaAssetTypeSchema.optional(),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  includeDeleted: z.boolean().default(false),
});

export const attachmentCandidateSchema = baseEntitySchema.extend({
  conversationId: idSchema,
  messageId: idSchema.nullable(),
  mediaAssetId: idSchema,
  channel: channelTypeSchema.extract(["whatsapp", "instagram", "system"]),
  contentType: mediaAssetTypeSchema,
  externalMessageId: z.string().min(1).nullable(),
  caption: z.string().min(1).nullable(),
  observedAt: isoDateTimeSchema,
  metadata: jsonObjectSchema,
});

export const createAttachmentCandidateInputSchema = z.object({
  userId: idSchema,
  conversationId: idSchema,
  messageId: idSchema.nullable().optional(),
  mediaAssetId: idSchema,
  channel: channelTypeSchema.extract(["whatsapp", "instagram", "system"]),
  contentType: mediaAssetTypeSchema,
  externalMessageId: z.string().min(1).nullable().optional(),
  caption: z.string().min(1).nullable().optional(),
  observedAt: isoDateTimeSchema,
  metadata: jsonObjectSchema.optional(),
});

export const listAttachmentCandidatesFilterSchema = cursorPaginationSchema.extend({
  userId: idSchema,
  conversationId: idSchema,
  contentType: mediaAssetTypeSchema.optional(),
});

export type MediaAsset = z.infer<typeof mediaAssetSchema>;
export type CreateMediaAssetInput = z.infer<typeof createMediaAssetInputSchema>;
export type UpdateMediaAssetInput = z.infer<typeof updateMediaAssetInputSchema>;
export type ListMediaAssetsFilter = z.infer<typeof listMediaAssetsFilterSchema>;
export type AttachmentCandidate = z.infer<typeof attachmentCandidateSchema>;
export type CreateAttachmentCandidateInput = z.infer<typeof createAttachmentCandidateInputSchema>;
export type ListAttachmentCandidatesFilter = z.infer<typeof listAttachmentCandidatesFilterSchema>;
