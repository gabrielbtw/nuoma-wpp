import { z } from "zod";

import { baseEntitySchema, channelTypeSchema, idSchema, isoDateTimeSchema } from "./common.js";
import { cursorPaginationSchema } from "./pagination.js";

export const contactStatusSchema = z.enum(["lead", "active", "inactive", "blocked", "archived"]);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const contactSchema = baseEntitySchema.extend({
  name: z.string().min(1),
  phone: z.string().min(8).nullable(),
  email: z.string().email().nullable(),
  primaryChannel: channelTypeSchema,
  instagramHandle: z.string().min(1).nullable(),
  status: contactStatusSchema,
  tagIds: z.array(idSchema),
  notes: z.string().nullable(),
  lastMessageAt: isoDateTimeSchema.nullable(),
  profilePhotoMediaAssetId: idSchema.nullable(),
  profilePhotoSha256: sha256Schema.nullable(),
  profilePhotoUpdatedAt: isoDateTimeSchema.nullable(),
  deletedAt: isoDateTimeSchema.nullable(),
});

export const createContactInputSchema = z.object({
  userId: idSchema,
  name: z.string().min(1),
  phone: z.string().min(8).nullable().optional(),
  email: z.string().email().nullable().optional(),
  primaryChannel: channelTypeSchema.default("whatsapp"),
  instagramHandle: z.string().min(1).nullable().optional(),
  status: contactStatusSchema.default("lead"),
  tagIds: z.array(idSchema).default([]),
  notes: z.string().nullable().optional(),
  profilePhotoMediaAssetId: idSchema.nullable().optional(),
  profilePhotoSha256: sha256Schema.nullable().optional(),
  profilePhotoUpdatedAt: isoDateTimeSchema.nullable().optional(),
});

export const updateContactInputSchema = z.object({
  id: idSchema,
  userId: idSchema,
  name: z.string().min(1).optional(),
  phone: z.string().min(8).nullable().optional(),
  email: z.string().email().nullable().optional(),
  primaryChannel: channelTypeSchema.optional(),
  instagramHandle: z.string().min(1).nullable().optional(),
  status: contactStatusSchema.optional(),
  tagIds: z.array(idSchema).optional(),
  notes: z.string().nullable().optional(),
  profilePhotoMediaAssetId: idSchema.nullable().optional(),
  profilePhotoSha256: sha256Schema.nullable().optional(),
  profilePhotoUpdatedAt: isoDateTimeSchema.nullable().optional(),
});

export const listContactsFilterSchema = cursorPaginationSchema.extend({
  userId: idSchema,
  channel: channelTypeSchema.optional(),
  status: contactStatusSchema.optional(),
  tagId: idSchema.optional(),
  hasPhone: z.boolean().optional(),
  search: z.string().min(1).optional(),
  updatedSince: isoDateTimeSchema.optional(),
  includeDeleted: z.boolean().default(false),
});

export const searchContactsInputSchema = z.object({
  userId: idSchema,
  query: z.string().min(1),
  limit: z.number().int().min(1).max(100).default(20),
  includeDeleted: z.boolean().default(false),
});

export const importContactRowSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(3).nullable().optional(),
  email: z.string().email().nullable().optional(),
  primaryChannel: channelTypeSchema.default("whatsapp"),
  instagramHandle: z.string().min(1).nullable().optional(),
  status: contactStatusSchema.default("lead"),
  notes: z.string().nullable().optional(),
});

export const importContactsInputSchema = z.object({
  csv: z.string().min(1).optional(),
  rows: z.array(importContactRowSchema).optional(),
  dryRun: z.boolean().default(true),
  duplicateMode: z.enum(["skip_existing", "update_existing"]).default("skip_existing"),
});

export type ContactStatus = z.infer<typeof contactStatusSchema>;
export type Contact = z.infer<typeof contactSchema>;
export type CreateContactInput = z.infer<typeof createContactInputSchema>;
export type UpdateContactInput = z.infer<typeof updateContactInputSchema>;
export type ListContactsFilter = z.infer<typeof listContactsFilterSchema>;
export type SearchContactsInput = z.infer<typeof searchContactsInputSchema>;
export type ImportContactRow = z.infer<typeof importContactRowSchema>;
export type ImportContactsInput = z.infer<typeof importContactsInputSchema>;
