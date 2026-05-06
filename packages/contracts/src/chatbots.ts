import { z } from "zod";

import {
  baseEntitySchema,
  channelTypeSchema,
  chatbotStatusSchema,
  idSchema,
  isoDateTimeSchema,
  jsonObjectSchema,
  nullableIdSchema,
} from "./common.js";
import { automationActionSchema } from "./automations.js";
import { segmentSchema } from "./campaigns.js";
import { cursorPaginationSchema } from "./pagination.js";

export const chatbotSchema = baseEntitySchema.extend({
  name: z.string().min(1),
  channel: channelTypeSchema,
  status: chatbotStatusSchema,
  fallbackMessage: z.string().nullable(),
  metadata: jsonObjectSchema,
});

export const chatbotRuleMatchSchema = z.object({
  type: z.enum(["contains", "equals", "starts_with", "regex", "fallback"]),
  value: z.string().nullable(),
});

export const chatbotRuleAbTestVariantSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(80),
  weight: z.number().int().min(0).max(10_000),
  actions: z.array(automationActionSchema).min(1),
});

export const chatbotRuleAbTestSchema = z.object({
  enabled: z.boolean().default(false),
  assignment: z.literal("deterministic").default("deterministic"),
  variants: z.array(chatbotRuleAbTestVariantSchema).min(2).max(8),
});

export const chatbotRuleMetadataSchema = z
  .object({
    abTest: chatbotRuleAbTestSchema.optional(),
  })
  .catchall(z.unknown());

export const chatbotRuleSchema = baseEntitySchema.extend({
  chatbotId: idSchema,
  name: z.string().min(1),
  priority: z.number().int().min(0),
  match: chatbotRuleMatchSchema,
  segment: segmentSchema.nullable(),
  actions: z.array(automationActionSchema).min(1),
  isActive: z.boolean(),
  metadata: chatbotRuleMetadataSchema,
});

export const chatbotVariantEventTypeSchema = z.enum(["exposure", "conversion"]);

export const chatbotVariantEventSchema = baseEntitySchema.extend({
  chatbotId: idSchema,
  ruleId: idSchema,
  variantId: z.string().min(1).max(64),
  variantLabel: z.string().min(1).max(80).nullable(),
  eventType: chatbotVariantEventTypeSchema,
  channel: channelTypeSchema,
  contactId: nullableIdSchema,
  conversationId: nullableIdSchema,
  messageId: nullableIdSchema,
  exposureId: nullableIdSchema,
  sourceEventId: z.string().min(1).max(160).nullable(),
  metadata: jsonObjectSchema,
});

export const createChatbotInputSchema = z.object({
  userId: idSchema,
  name: z.string().min(1),
  channel: channelTypeSchema.default("whatsapp"),
  fallbackMessage: z.string().nullable().optional(),
  metadata: jsonObjectSchema.default({}),
});

export const updateChatbotInputSchema = z.object({
  id: idSchema,
  userId: idSchema,
  name: z.string().min(1).optional(),
  channel: channelTypeSchema.optional(),
  status: chatbotStatusSchema.optional(),
  fallbackMessage: z.string().nullable().optional(),
  metadata: jsonObjectSchema.optional(),
});

export const createChatbotRuleInputSchema = z.object({
  userId: idSchema,
  chatbotId: idSchema,
  name: z.string().min(1),
  priority: z.number().int().min(0).default(100),
  match: chatbotRuleMatchSchema,
  segment: segmentSchema.nullable().optional(),
  actions: z.array(automationActionSchema).min(1),
  metadata: chatbotRuleMetadataSchema.default({}),
});

export const updateChatbotRuleInputSchema = z.object({
  id: idSchema,
  userId: idSchema,
  name: z.string().min(1).optional(),
  priority: z.number().int().min(0).optional(),
  match: chatbotRuleMatchSchema.optional(),
  segment: segmentSchema.nullable().optional(),
  actions: z.array(automationActionSchema).min(1).optional(),
  isActive: z.boolean().optional(),
  metadata: chatbotRuleMetadataSchema.optional(),
});

export const listChatbotsFilterSchema = cursorPaginationSchema.extend({
  userId: idSchema,
  channel: channelTypeSchema.optional(),
  status: chatbotStatusSchema.optional(),
  search: z.string().min(1).optional(),
});

export const listChatbotRulesFilterSchema = cursorPaginationSchema.extend({
  userId: idSchema,
  chatbotId: idSchema,
  isActive: z.boolean().optional(),
  updatedSince: isoDateTimeSchema.optional(),
});

export type Chatbot = z.infer<typeof chatbotSchema>;
export type ChatbotRuleMatch = z.infer<typeof chatbotRuleMatchSchema>;
export type ChatbotRuleAbTest = z.infer<typeof chatbotRuleAbTestSchema>;
export type ChatbotRuleAbTestVariant = z.infer<typeof chatbotRuleAbTestVariantSchema>;
export type ChatbotRuleMetadata = z.infer<typeof chatbotRuleMetadataSchema>;
export type ChatbotRule = z.infer<typeof chatbotRuleSchema>;
export type ChatbotVariantEventType = z.infer<typeof chatbotVariantEventTypeSchema>;
export type ChatbotVariantEvent = z.infer<typeof chatbotVariantEventSchema>;
export type CreateChatbotInput = z.infer<typeof createChatbotInputSchema>;
export type UpdateChatbotInput = z.infer<typeof updateChatbotInputSchema>;
export type CreateChatbotRuleInput = z.infer<typeof createChatbotRuleInputSchema>;
export type UpdateChatbotRuleInput = z.infer<typeof updateChatbotRuleInputSchema>;
export type ListChatbotsFilter = z.infer<typeof listChatbotsFilterSchema>;
export type ListChatbotRulesFilter = z.infer<typeof listChatbotRulesFilterSchema>;
