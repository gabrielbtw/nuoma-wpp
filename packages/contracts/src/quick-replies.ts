import { z } from "zod";

import { baseEntitySchema, idSchema, isoDateTimeSchema } from "./common.js";
import { cursorPaginationSchema } from "./pagination.js";

export const quickReplySchema = baseEntitySchema.extend({
  title: z.string().min(1).max(80),
  body: z.string().min(1).max(4096),
  shortcut: z.string().min(1).max(32).nullable(),
  category: z.string().min(1).max(48).nullable(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
  usageCount: z.number().int().nonnegative(),
  lastUsedAt: isoDateTimeSchema.nullable(),
  deletedAt: isoDateTimeSchema.nullable(),
});

export const createQuickReplyInputSchema = z.object({
  userId: idSchema,
  title: z.string().trim().min(1).max(80),
  body: z.string().trim().min(1).max(4096),
  shortcut: z.string().trim().min(1).max(32).nullable().optional(),
  category: z.string().trim().min(1).max(48).nullable().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});

export const updateQuickReplyInputSchema = z.object({
  id: idSchema,
  userId: idSchema,
  title: z.string().trim().min(1).max(80).optional(),
  body: z.string().trim().min(1).max(4096).optional(),
  shortcut: z.string().trim().min(1).max(32).nullable().optional(),
  category: z.string().trim().min(1).max(48).nullable().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  deletedAt: isoDateTimeSchema.nullable().optional(),
});

export const listQuickRepliesFilterSchema = cursorPaginationSchema.extend({
  userId: idSchema,
  query: z.string().trim().min(1).max(120).optional(),
  category: z.string().trim().min(1).max(48).optional(),
  isActive: z.boolean().optional(),
  includeDeleted: z.boolean().optional(),
});

export type QuickReply = z.infer<typeof quickReplySchema>;
export type CreateQuickReplyInput = z.infer<typeof createQuickReplyInputSchema>;
export type UpdateQuickReplyInput = z.infer<typeof updateQuickReplyInputSchema>;
export type ListQuickRepliesFilter = z.infer<typeof listQuickRepliesFilterSchema>;
