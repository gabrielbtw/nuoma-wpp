import { z } from "zod";

import { baseEntitySchema, idSchema } from "./common.js";
import { cursorPaginationSchema } from "./pagination.js";

export const tagSchema = baseEntitySchema.extend({
  name: z.string().min(1),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  description: z.string().nullable(),
});

export const createTagInputSchema = z.object({
  userId: idSchema,
  name: z.string().min(1),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  description: z.string().nullable().optional(),
});

export const updateTagInputSchema = z.object({
  id: idSchema,
  userId: idSchema,
  name: z.string().min(1).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  description: z.string().nullable().optional(),
});

export const listTagsFilterSchema = cursorPaginationSchema.extend({
  userId: idSchema,
  search: z.string().min(1).optional(),
});

export type Tag = z.infer<typeof tagSchema>;
export type CreateTagInput = z.infer<typeof createTagInputSchema>;
export type UpdateTagInput = z.infer<typeof updateTagInputSchema>;
export type ListTagsFilter = z.infer<typeof listTagsFilterSchema>;
