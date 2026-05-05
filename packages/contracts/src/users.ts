import { z } from "zod";

import { baseEntitySchema, idSchema, isoDateTimeSchema, roleSchema } from "./common.js";
import { cursorPaginationSchema } from "./pagination.js";

export const userSchema = baseEntitySchema.omit({ userId: true }).extend({
  email: z.string().email(),
  role: roleSchema,
  displayName: z.string().min(1).nullable(),
  lastLoginAt: isoDateTimeSchema.nullable(),
  isActive: z.boolean(),
});

export const createUserInputSchema = z.object({
  email: z.string().email(),
  role: roleSchema.default("attendant"),
  displayName: z.string().min(1).nullable().optional(),
  password: z.string().min(12),
});

export const updateUserInputSchema = z.object({
  id: idSchema,
  email: z.string().email().optional(),
  role: roleSchema.optional(),
  displayName: z.string().min(1).nullable().optional(),
  isActive: z.boolean().optional(),
});

export const listUsersFilterSchema = cursorPaginationSchema.extend({
  role: roleSchema.optional(),
  isActive: z.boolean().optional(),
  search: z.string().min(1).optional(),
});

export type User = z.infer<typeof userSchema>;
export type CreateUserInput = z.infer<typeof createUserInputSchema>;
export type UpdateUserInput = z.infer<typeof updateUserInputSchema>;
export type ListUsersFilter = z.infer<typeof listUsersFilterSchema>;
