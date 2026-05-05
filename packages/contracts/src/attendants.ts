import { z } from "zod";

import { baseEntitySchema, idSchema, roleSchema } from "./common.js";
import { cursorPaginationSchema } from "./pagination.js";

export const attendantSchema = baseEntitySchema.extend({
  userAccountId: idSchema.nullable(),
  name: z.string().min(1),
  email: z.string().email().nullable(),
  role: roleSchema,
  isActive: z.boolean(),
});

export const createAttendantInputSchema = z.object({
  userId: idSchema,
  userAccountId: idSchema.nullable().optional(),
  name: z.string().min(1),
  email: z.string().email().nullable().optional(),
  role: roleSchema.default("attendant"),
});

export const updateAttendantInputSchema = z.object({
  id: idSchema,
  userId: idSchema,
  userAccountId: idSchema.nullable().optional(),
  name: z.string().min(1).optional(),
  email: z.string().email().nullable().optional(),
  role: roleSchema.optional(),
  isActive: z.boolean().optional(),
});

export const listAttendantsFilterSchema = cursorPaginationSchema.extend({
  userId: idSchema,
  role: roleSchema.optional(),
  isActive: z.boolean().optional(),
  search: z.string().min(1).optional(),
});

export type Attendant = z.infer<typeof attendantSchema>;
export type CreateAttendantInput = z.infer<typeof createAttendantInputSchema>;
export type UpdateAttendantInput = z.infer<typeof updateAttendantInputSchema>;
export type ListAttendantsFilter = z.infer<typeof listAttendantsFilterSchema>;
