import { z } from "zod";

export const cursorPaginationSchema = z.object({
  cursor: z.string().nullable().optional(),
  limit: z.number().int().min(1).max(200).default(50),
  direction: z.enum(["forward", "backward"]).default("forward"),
});

export const pageInfoSchema = z.object({
  nextCursor: z.string().nullable(),
  previousCursor: z.string().nullable(),
  hasNextPage: z.boolean(),
  hasPreviousPage: z.boolean(),
});

export function paginatedResponseSchema<TItem extends z.ZodTypeAny>(itemSchema: TItem) {
  return z.object({
    items: z.array(itemSchema),
    pageInfo: pageInfoSchema,
  });
}

export type CursorPagination = z.infer<typeof cursorPaginationSchema>;
export type PageInfo = z.infer<typeof pageInfoSchema>;
