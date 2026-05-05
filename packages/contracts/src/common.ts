import { z } from "zod";

export const idSchema = z.number().int().positive();
export const nullableIdSchema = idSchema.nullable();
export const isoDateTimeSchema = z.string().datetime({ offset: true });
export const jsonObjectSchema = z.record(z.string(), z.unknown());

export const baseEntitySchema = z.object({
  id: idSchema,
  userId: idSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const channelTypeSchema = z.enum(["whatsapp", "instagram", "system"]);
export const roleSchema = z.enum(["admin", "attendant", "viewer"]);
export const messageDirectionSchema = z.enum(["inbound", "outbound", "system"]);
export const messageContentTypeSchema = z.enum([
  "text",
  "image",
  "audio",
  "voice",
  "video",
  "document",
  "link",
  "sticker",
  "system",
]);
export const messageStatusSchema = z.enum([
  "pending",
  "sent",
  "delivered",
  "read",
  "failed",
  "received",
]);
export const timestampPrecisionSchema = z.enum(["second", "minute", "date", "unknown"]);
export const campaignStatusSchema = z.enum([
  "draft",
  "scheduled",
  "running",
  "paused",
  "completed",
  "archived",
]);
export const automationStatusSchema = z.enum(["draft", "active", "paused", "archived"]);
export const chatbotStatusSchema = z.enum(["draft", "active", "paused", "archived"]);
export const jobStatusSchema = z.enum([
  "queued",
  "claimed",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export const jobTypeSchema = z.enum([
  "send_message",
  "send_instagram_message",
  "send_voice",
  "send_document",
  "send_media",
  "validate_recipient",
  "sync_conversation",
  "sync_history",
  "sync_inbox_force",
  "campaign_step",
  "automation_action",
  "chatbot_reply",
  "backup",
  "restart_worker",
]);
export const reminderStatusSchema = z.enum(["open", "done", "cancelled"]);
export const mediaAssetTypeSchema = z.enum(["image", "audio", "voice", "video", "document"]);

export type ChannelType = z.infer<typeof channelTypeSchema>;
export type Role = z.infer<typeof roleSchema>;
export type MessageDirection = z.infer<typeof messageDirectionSchema>;
export type MessageContentType = z.infer<typeof messageContentTypeSchema>;
export type MessageStatus = z.infer<typeof messageStatusSchema>;
export type TimestampPrecision = z.infer<typeof timestampPrecisionSchema>;
export type CampaignStatus = z.infer<typeof campaignStatusSchema>;
export type AutomationStatus = z.infer<typeof automationStatusSchema>;
export type ChatbotStatus = z.infer<typeof chatbotStatusSchema>;
export type JobStatus = z.infer<typeof jobStatusSchema>;
export type JobType = z.infer<typeof jobTypeSchema>;
export type ReminderStatus = z.infer<typeof reminderStatusSchema>;
export type MediaAssetType = z.infer<typeof mediaAssetTypeSchema>;
