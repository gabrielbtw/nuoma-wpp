import { z } from "zod";

import {
  baseEntitySchema,
  campaignStatusSchema,
  channelTypeSchema,
  idSchema,
  isoDateTimeSchema,
  jsonObjectSchema,
  mediaAssetTypeSchema,
} from "./common.js";
import { cursorPaginationSchema } from "./pagination.js";

export const segmentOperatorSchema = z.enum(["and", "or"]);
export const segmentConditionSchema = z.object({
  field: z.enum([
    "tag",
    "status",
    "channel",
    "lastMessageAt",
    "createdAt",
    "procedure",
    "instagramRelationship",
  ]),
  operator: z.enum(["eq", "neq", "in", "not_in", "exists", "not_exists", "before", "after"]),
  value: z
    .union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))])
    .nullable(),
});
export const segmentSchema = z.object({
  operator: segmentOperatorSchema,
  conditions: z.array(segmentConditionSchema),
});

export const campaignStepConditionSchema = z.object({
  type: z.enum(["replied", "has_tag", "channel_is", "outside_window"]),
  action: z.enum(["exit", "branch", "skip", "wait"]),
  value: z.string().nullable(),
  targetStepId: z.string().min(1).nullable(),
});

const baseCampaignStepSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  delaySeconds: z.number().int().min(0),
  conditions: z.array(campaignStepConditionSchema).default([]),
});

export const campaignStepSchema = z.discriminatedUnion("type", [
  baseCampaignStepSchema.extend({
    type: z.literal("text"),
    template: z.string().min(1),
  }),
  baseCampaignStepSchema.extend({
    type: z.literal("voice"),
    mediaAssetId: idSchema,
    caption: z.string().nullable(),
  }),
  baseCampaignStepSchema.extend({
    type: z.literal("document"),
    mediaAssetId: idSchema,
    fileName: z.string().min(1),
    caption: z.string().nullable(),
  }),
  baseCampaignStepSchema.extend({
    type: z.literal("image"),
    mediaAssetId: idSchema,
    mediaAssetIds: z.array(idSchema).min(1).max(10).optional(),
    caption: z.string().nullable(),
  }),
  baseCampaignStepSchema.extend({
    type: z.literal("video"),
    mediaAssetId: idSchema,
    caption: z.string().nullable(),
  }),
  baseCampaignStepSchema.extend({
    type: z.literal("link"),
    url: z.string().url(),
    previewEnabled: z.boolean(),
    text: z.string().min(1),
  }),
]);

export const campaignTemporaryMessagesConfigSchema = z.object({
  enabled: z.boolean().default(false),
  beforeSendDuration: z.enum(["24h", "7d", "90d"]).default("24h"),
  afterCompletionDuration: z.enum(["24h", "7d", "90d"]).default("90d"),
  restoreOnFailure: z.boolean().default(true),
});

export const campaignSchema = baseEntitySchema.extend({
  name: z.string().min(1),
  status: campaignStatusSchema,
  channel: channelTypeSchema,
  segment: segmentSchema.nullable(),
  steps: z.array(campaignStepSchema).min(1),
  evergreen: z.boolean(),
  startsAt: isoDateTimeSchema.nullable(),
  completedAt: isoDateTimeSchema.nullable(),
  metadata: jsonObjectSchema,
});

export const createCampaignInputSchema = z.object({
  userId: idSchema,
  name: z.string().min(1),
  channel: channelTypeSchema.default("whatsapp"),
  segment: segmentSchema.nullable().optional(),
  steps: z.array(campaignStepSchema).min(1),
  evergreen: z.boolean().default(false),
  startsAt: isoDateTimeSchema.nullable().optional(),
  metadata: jsonObjectSchema.default({}),
});

export const updateCampaignInputSchema = z.object({
  id: idSchema,
  userId: idSchema,
  name: z.string().min(1).optional(),
  status: campaignStatusSchema.optional(),
  channel: channelTypeSchema.optional(),
  segment: segmentSchema.nullable().optional(),
  steps: z.array(campaignStepSchema).min(1).optional(),
  evergreen: z.boolean().optional(),
  startsAt: isoDateTimeSchema.nullable().optional(),
  completedAt: isoDateTimeSchema.nullable().optional(),
  metadata: jsonObjectSchema.optional(),
});

export const listCampaignsFilterSchema = cursorPaginationSchema.extend({
  userId: idSchema,
  status: campaignStatusSchema.optional(),
  channel: channelTypeSchema.optional(),
  evergreen: z.boolean().optional(),
  search: z.string().min(1).optional(),
});

export const campaignRecipientSchema = z.object({
  id: idSchema,
  userId: idSchema,
  campaignId: idSchema,
  contactId: idSchema.nullable(),
  phone: z.string().min(8).nullable(),
  channel: channelTypeSchema,
  status: z.enum(["queued", "running", "completed", "failed", "skipped"]),
  currentStepId: z.string().min(1).nullable(),
  lastError: z.string().nullable(),
  metadata: jsonObjectSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export type SegmentOperator = z.infer<typeof segmentOperatorSchema>;
export type SegmentCondition = z.infer<typeof segmentConditionSchema>;
export type Segment = z.infer<typeof segmentSchema>;
export type CampaignStepCondition = z.infer<typeof campaignStepConditionSchema>;
export type CampaignStep = z.infer<typeof campaignStepSchema>;
export type CampaignTemporaryMessagesConfig = z.infer<
  typeof campaignTemporaryMessagesConfigSchema
>;
export type Campaign = z.infer<typeof campaignSchema>;
export type CreateCampaignInput = z.infer<typeof createCampaignInputSchema>;
export type UpdateCampaignInput = z.infer<typeof updateCampaignInputSchema>;
export type ListCampaignsFilter = z.infer<typeof listCampaignsFilterSchema>;
export type CampaignRecipient = z.infer<typeof campaignRecipientSchema>;

export const supportedCampaignMediaTypes = mediaAssetTypeSchema.extract(["voice", "document", "image", "video"]);
