import { z } from "zod";

import { baseEntitySchema, idSchema, isoDateTimeSchema, reminderStatusSchema } from "./common.js";
import { cursorPaginationSchema } from "./pagination.js";

export const reminderSchema = baseEntitySchema.extend({
  contactId: idSchema.nullable(),
  conversationId: idSchema.nullable(),
  assignedToUserId: idSchema.nullable(),
  title: z.string().min(1),
  notes: z.string().nullable(),
  dueAt: isoDateTimeSchema,
  status: reminderStatusSchema,
  completedAt: isoDateTimeSchema.nullable(),
});

export const createReminderInputSchema = z.object({
  userId: idSchema,
  contactId: idSchema.nullable().optional(),
  conversationId: idSchema.nullable().optional(),
  assignedToUserId: idSchema.nullable().optional(),
  title: z.string().min(1),
  notes: z.string().nullable().optional(),
  dueAt: isoDateTimeSchema,
});

export const updateReminderInputSchema = z.object({
  id: idSchema,
  userId: idSchema,
  contactId: idSchema.nullable().optional(),
  conversationId: idSchema.nullable().optional(),
  assignedToUserId: idSchema.nullable().optional(),
  title: z.string().min(1).optional(),
  notes: z.string().nullable().optional(),
  dueAt: isoDateTimeSchema.optional(),
  status: reminderStatusSchema.optional(),
  completedAt: isoDateTimeSchema.nullable().optional(),
});

export const listRemindersFilterSchema = cursorPaginationSchema.extend({
  userId: idSchema,
  contactId: idSchema.optional(),
  conversationId: idSchema.optional(),
  assignedToUserId: idSchema.optional(),
  status: reminderStatusSchema.optional(),
  dueBefore: isoDateTimeSchema.optional(),
  dueAfter: isoDateTimeSchema.optional(),
});

export type Reminder = z.infer<typeof reminderSchema>;
export type CreateReminderInput = z.infer<typeof createReminderInputSchema>;
export type UpdateReminderInput = z.infer<typeof updateReminderInputSchema>;
export type ListRemindersFilter = z.infer<typeof listRemindersFilterSchema>;
