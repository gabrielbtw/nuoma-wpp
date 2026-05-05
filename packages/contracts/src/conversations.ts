import { z } from "zod";

import { baseEntitySchema, channelTypeSchema, idSchema, isoDateTimeSchema } from "./common.js";
import { cursorPaginationSchema } from "./pagination.js";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const conversationSchema = baseEntitySchema.extend({
  contactId: idSchema.nullable(),
  channel: channelTypeSchema,
  externalThreadId: z.string().min(1),
  title: z.string().min(1),
  lastMessageAt: isoDateTimeSchema.nullable(),
  lastPreview: z.string().nullable(),
  unreadCount: z.number().int().min(0),
  isArchived: z.boolean(),
  temporaryMessagesUntil: isoDateTimeSchema.nullable(),
  profilePhotoMediaAssetId: idSchema.nullable(),
  profilePhotoSha256: sha256Schema.nullable(),
  profilePhotoUpdatedAt: isoDateTimeSchema.nullable(),
});

export const createConversationInputSchema = z.object({
  userId: idSchema,
  contactId: idSchema.nullable().optional(),
  channel: channelTypeSchema,
  externalThreadId: z.string().min(1),
  title: z.string().min(1),
  profilePhotoMediaAssetId: idSchema.nullable().optional(),
  profilePhotoSha256: sha256Schema.nullable().optional(),
  profilePhotoUpdatedAt: isoDateTimeSchema.nullable().optional(),
});

export const updateConversationInputSchema = z.object({
  id: idSchema,
  userId: idSchema,
  contactId: idSchema.nullable().optional(),
  title: z.string().min(1).optional(),
  lastMessageAt: isoDateTimeSchema.nullable().optional(),
  lastPreview: z.string().nullable().optional(),
  unreadCount: z.number().int().min(0).optional(),
  isArchived: z.boolean().optional(),
  temporaryMessagesUntil: isoDateTimeSchema.nullable().optional(),
  profilePhotoMediaAssetId: idSchema.nullable().optional(),
  profilePhotoSha256: sha256Schema.nullable().optional(),
  profilePhotoUpdatedAt: isoDateTimeSchema.nullable().optional(),
});

export const listConversationsFilterSchema = cursorPaginationSchema.extend({
  userId: idSchema,
  contactId: idSchema.optional(),
  channel: channelTypeSchema.optional(),
  hasUnread: z.boolean().optional(),
  archived: z.boolean().optional(),
  search: z.string().min(1).optional(),
  updatedSince: isoDateTimeSchema.optional(),
});

export type Conversation = z.infer<typeof conversationSchema>;
export type CreateConversationInput = z.infer<typeof createConversationInputSchema>;
export type UpdateConversationInput = z.infer<typeof updateConversationInputSchema>;
export type ListConversationsFilter = z.infer<typeof listConversationsFilterSchema>;
