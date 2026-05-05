import { z } from "zod";

import {
  baseEntitySchema,
  idSchema,
  isoDateTimeSchema,
  jobStatusSchema,
  jobTypeSchema,
  jsonObjectSchema,
} from "./common.js";
import { cursorPaginationSchema } from "./pagination.js";

export const jobSchema = baseEntitySchema.extend({
  type: jobTypeSchema,
  status: jobStatusSchema,
  payload: jsonObjectSchema,
  priority: z.number().int().min(0).max(9),
  dedupeKey: z.string().min(1).nullable(),
  dedupeExpiresAt: isoDateTimeSchema.nullable(),
  scheduledAt: isoDateTimeSchema,
  claimedAt: isoDateTimeSchema.nullable(),
  claimedBy: z.string().min(1).nullable(),
  attempts: z.number().int().min(0),
  maxAttempts: z.number().int().min(1),
  lastError: z.string().nullable(),
  completedAt: isoDateTimeSchema.nullable(),
});

export const createJobInputSchema = z.object({
  userId: idSchema,
  type: jobTypeSchema,
  payload: jsonObjectSchema,
  dedupeKey: z.string().min(1).nullable().optional(),
  dedupeExpiresAt: isoDateTimeSchema.nullable().optional(),
  scheduledAt: isoDateTimeSchema,
  priority: z.number().int().min(0).max(9).default(5),
  maxAttempts: z.number().int().min(1).default(3),
});

export const updateJobInputSchema = z.object({
  id: idSchema,
  userId: idSchema,
  status: jobStatusSchema.optional(),
  payload: jsonObjectSchema.optional(),
  dedupeKey: z.string().min(1).nullable().optional(),
  dedupeExpiresAt: isoDateTimeSchema.nullable().optional(),
  scheduledAt: isoDateTimeSchema.optional(),
  priority: z.number().int().min(0).max(9).optional(),
  claimedAt: isoDateTimeSchema.nullable().optional(),
  claimedBy: z.string().min(1).nullable().optional(),
  attempts: z.number().int().min(0).optional(),
  maxAttempts: z.number().int().min(1).optional(),
  lastError: z.string().nullable().optional(),
  completedAt: isoDateTimeSchema.nullable().optional(),
});

export const listJobsFilterSchema = cursorPaginationSchema.extend({
  userId: idSchema,
  type: jobTypeSchema.optional(),
  status: jobStatusSchema.optional(),
  maxPriority: z.number().int().min(0).max(9).optional(),
  dueBefore: isoDateTimeSchema.optional(),
  claimedBy: z.string().min(1).optional(),
});

export const deadJobSchema = z.object({
  id: idSchema,
  userId: idSchema.nullable(),
  originalJobId: idSchema.nullable(),
  type: jobTypeSchema,
  payload: jsonObjectSchema,
  finalStatus: z.string().min(1),
  attempts: z.number().int().min(0),
  lastError: z.string().nullable(),
  failedAt: isoDateTimeSchema,
  archivedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
});

export const workerStateSchema = z.object({
  workerId: z.string().min(1),
  status: z.enum(["starting", "idle", "busy", "stopping", "stopped", "error"]),
  heartbeatAt: isoDateTimeSchema,
  currentJobId: idSchema.nullable(),
  pid: z.number().int().positive().nullable(),
  rssMb: z.number().int().nonnegative().nullable(),
  browserConnected: z.boolean(),
  lastError: z.string().nullable(),
  metrics: jsonObjectSchema,
  updatedAt: isoDateTimeSchema,
});

export type Job = z.infer<typeof jobSchema>;
export type CreateJobInput = z.infer<typeof createJobInputSchema>;
export type UpdateJobInput = z.infer<typeof updateJobInputSchema>;
export type ListJobsFilter = z.infer<typeof listJobsFilterSchema>;
export type DeadJob = z.infer<typeof deadJobSchema>;
export type WorkerState = z.infer<typeof workerStateSchema>;
