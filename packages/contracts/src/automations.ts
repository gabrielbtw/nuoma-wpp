import { z } from "zod";

import {
  automationStatusSchema,
  baseEntitySchema,
  channelTypeSchema,
  idSchema,
  isoDateTimeSchema,
  jsonObjectSchema,
} from "./common.js";
import { campaignStepSchema, segmentSchema } from "./campaigns.js";
import { cursorPaginationSchema } from "./pagination.js";

export const automationTriggerSchema = z.object({
  type: z.enum(["message_received", "campaign_completed", "tag_applied", "tag_removed"]),
  channel: channelTypeSchema.optional(),
  tagId: idSchema.optional(),
  campaignId: idSchema.optional(),
});

export const automationConditionSchema = z.object({
  segment: segmentSchema.nullable(),
  requireWithin24hWindow: z.boolean().default(false),
});

const automationActionBaseSchema = z.object({
  id: z.string().min(1).max(120).optional(),
});

export const automationActionSchema = z.discriminatedUnion("type", [
  automationActionBaseSchema.extend({
    type: z.literal("send_step"),
    step: campaignStepSchema,
  }),
  automationActionBaseSchema.extend({
    type: z.literal("delay"),
    seconds: z.number().int().min(1).max(2_592_000),
    label: z.string().min(1).max(120).nullable().default(null),
  }),
  automationActionBaseSchema.extend({
    type: z.literal("branch"),
    label: z.string().min(1).max(120),
    condition: segmentSchema.nullable().default(null),
    targetActionId: z.string().min(1).nullable().default(null),
  }),
  automationActionBaseSchema.extend({
    type: z.literal("apply_tag"),
    tagId: idSchema,
  }),
  automationActionBaseSchema.extend({
    type: z.literal("remove_tag"),
    tagId: idSchema,
  }),
  automationActionBaseSchema.extend({
    type: z.literal("set_status"),
    status: z.string().min(1),
  }),
  automationActionBaseSchema.extend({
    type: z.literal("create_reminder"),
    dueAt: isoDateTimeSchema,
    title: z.string().min(1),
  }),
  automationActionBaseSchema.extend({
    type: z.literal("notify_attendant"),
    attendantId: idSchema.nullable().optional(),
    message: z.string().min(1),
  }),
  automationActionBaseSchema.extend({
    type: z.literal("trigger_automation"),
    automationId: idSchema,
  }),
]);

export const automationSchema = baseEntitySchema.extend({
  name: z.string().min(1),
  category: z.string().min(1),
  status: automationStatusSchema,
  trigger: automationTriggerSchema,
  condition: automationConditionSchema,
  actions: z.array(automationActionSchema).min(1),
  metadata: jsonObjectSchema,
});

export const createAutomationInputSchema = z.object({
  userId: idSchema,
  name: z.string().min(1),
  category: z.string().min(1),
  trigger: automationTriggerSchema,
  condition: automationConditionSchema,
  actions: z.array(automationActionSchema).min(1),
  metadata: jsonObjectSchema.default({}),
});

export const updateAutomationInputSchema = z.object({
  id: idSchema,
  userId: idSchema,
  name: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  status: automationStatusSchema.optional(),
  trigger: automationTriggerSchema.optional(),
  condition: automationConditionSchema.optional(),
  actions: z.array(automationActionSchema).min(1).optional(),
  metadata: jsonObjectSchema.optional(),
});

export const listAutomationsFilterSchema = cursorPaginationSchema.extend({
  userId: idSchema,
  status: automationStatusSchema.optional(),
  category: z.string().min(1).optional(),
  triggerType: automationTriggerSchema.shape.type.optional(),
  search: z.string().min(1).optional(),
});

export type AutomationTrigger = z.infer<typeof automationTriggerSchema>;
export type AutomationCondition = z.infer<typeof automationConditionSchema>;
export type AutomationAction = z.infer<typeof automationActionSchema>;
export type Automation = z.infer<typeof automationSchema>;
export type CreateAutomationInput = z.infer<typeof createAutomationInputSchema>;
export type UpdateAutomationInput = z.infer<typeof updateAutomationInputSchema>;
export type ListAutomationsFilter = z.infer<typeof listAutomationsFilterSchema>;
