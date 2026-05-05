import { z } from "zod";

import {
  baseEntitySchema,
  idSchema,
  isoDateTimeSchema,
  jsonObjectSchema,
  mediaAssetTypeSchema,
  messageContentTypeSchema,
  messageDirectionSchema,
  messageStatusSchema,
  timestampPrecisionSchema,
} from "./common.js";
import { cursorPaginationSchema } from "./pagination.js";

export const messageMediaSchema = z.object({
  mediaAssetId: idSchema.nullable(),
  type: mediaAssetTypeSchema,
  mimeType: z.string().min(1),
  fileName: z.string().min(1).nullable(),
  sizeBytes: z.number().int().min(0).nullable(),
  durationMs: z.number().int().min(0).nullable(),
});

export const messageSchema = baseEntitySchema.extend({
  conversationId: idSchema,
  contactId: idSchema.nullable(),
  externalId: z.string().min(1).nullable(),
  direction: messageDirectionSchema,
  contentType: messageContentTypeSchema,
  status: messageStatusSchema,
  body: z.string().nullable(),
  media: messageMediaSchema.nullable(),
  quotedMessageId: idSchema.nullable(),
  waDisplayedAt: isoDateTimeSchema.nullable(),
  timestampPrecision: timestampPrecisionSchema,
  messageSecond: z.number().int().min(0).max(59).nullable(),
  waInferredSecond: z.number().int().min(0).max(59).nullable(),
  observedAtUtc: isoDateTimeSchema,
  editedAt: isoDateTimeSchema.nullable(),
  deletedAt: isoDateTimeSchema.nullable(),
  raw: jsonObjectSchema.nullable(),
});

export const createMessageInputSchema = z.object({
  userId: idSchema,
  conversationId: idSchema,
  contactId: idSchema.nullable().optional(),
  externalId: z.string().min(1).nullable().optional(),
  direction: messageDirectionSchema,
  contentType: messageContentTypeSchema,
  status: messageStatusSchema.default("received"),
  body: z.string().nullable().optional(),
  media: messageMediaSchema.nullable().optional(),
  quotedMessageId: idSchema.nullable().optional(),
  waDisplayedAt: isoDateTimeSchema.nullable().optional(),
  timestampPrecision: timestampPrecisionSchema.default("unknown"),
  messageSecond: z.number().int().min(0).max(59).nullable().optional(),
  waInferredSecond: z.number().int().min(0).max(59).nullable().optional(),
  observedAtUtc: isoDateTimeSchema,
  raw: jsonObjectSchema.nullable().optional(),
});

export const updateMessageInputSchema = z.object({
  id: idSchema,
  userId: idSchema,
  status: messageStatusSchema.optional(),
  body: z.string().nullable().optional(),
  media: messageMediaSchema.nullable().optional(),
  editedAt: isoDateTimeSchema.nullable().optional(),
  deletedAt: isoDateTimeSchema.nullable().optional(),
  raw: jsonObjectSchema.nullable().optional(),
});

export const listMessagesFilterSchema = cursorPaginationSchema.extend({
  userId: idSchema,
  conversationId: idSchema,
  direction: messageDirectionSchema.optional(),
  contentType: messageContentTypeSchema.optional(),
  status: messageStatusSchema.optional(),
  since: isoDateTimeSchema.optional(),
  until: isoDateTimeSchema.optional(),
  includeDeleted: z.boolean().default(false),
});

export type MessageMedia = z.infer<typeof messageMediaSchema>;
export type Message = z.infer<typeof messageSchema>;
export type CreateMessageInput = z.infer<typeof createMessageInputSchema>;
export type UpdateMessageInput = z.infer<typeof updateMessageInputSchema>;
export type ListMessagesFilter = z.infer<typeof listMessagesFilterSchema>;
