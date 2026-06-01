import { and, asc, desc, eq, gt, gte, inArray, isNull, like, lte, or, sql } from "drizzle-orm";

import {
  attendantSchema,
  attachmentCandidateSchema,
  automationSchema,
  campaignStepSchema,
  campaignRecipientSchema,
  campaignSchema,
  chatbotVariantEventSchema,
  chatbotRuleSchema,
  chatbotSchema,
  contactSchema,
  conversationSchema,
  deadJobSchema,
  jobSchema,
  mediaAssetSchema,
  messageDispatchAttemptSchema,
  messageSchema,
  normalizePhone,
  normalizePhoneE164,
  normalizeWaJid,
  quickReplySchema,
  reminderSchema,
  tagSchema,
  userSchema,
  workerStateSchema,
  type Attendant,
  type AttachmentCandidate,
  type Automation,
  type Campaign,
  type CampaignStep,
  type CampaignRecipient,
  type Chatbot,
  type ChatbotRule,
  type ChatbotVariantEvent,
  type Contact,
  type Conversation,
  type DeadJob,
  type Job,
  type MediaAsset,
  type Message,
  type MessageDispatchAttempt,
  type MessageDispatchPhase,
  type QuickReply,
  type Reminder,
  type Tag,
  type User,
  type WorkerState,
} from "@nuoma/contracts";

import type { DbHandle } from "./index.js";
import {
  attachmentCandidates,
  attendants,
  auditLogs,
  automations,
  campaignRecipients,
  campaigns,
  chatbotVariantEvents,
  chatbotRules,
  chatbots,
  contactTags,
  contacts,
  conversations,
  jobs,
  jobsDead,
  mediaAssets,
  messageDispatchAttempts,
  messages,
  passwordResetTokens,
  pushSubscriptions,
  quickReplies,
  refreshSessions,
  reminders,
  schedulerLocks,
  sendAuditEvents,
  systemEvents,
  tags,
  users,
  workerSendBuckets,
  workerState,
  type NewContact,
  type NewConversation,
  type NewAttachmentCandidate,
  type NewChatbotVariantEvent,
  type NewJob,
  type NewJobDead,
  type NewMessage,
  type NewMessageDispatchAttempt,
  type NewSendAuditEvent,
  type NewQuickReply,
  type NewUser,
} from "./schema.js";

type JsonObject = Record<string, unknown>;
type ReminderStatus = NonNullable<typeof reminders.$inferInsert.status>;
type QuickReplyListInput = {
  userId: number;
  query?: string;
  category?: string;
  isActive?: boolean;
  includeDeleted?: boolean;
  cursor?: number;
  limit?: number;
};

export interface CreateUserRecord {
  email: string;
  passwordHash: string;
  role?: "admin" | "attendant" | "viewer";
  displayName?: string | null;
  isActive?: boolean;
}

export interface UserRecord extends User {
  passwordHash: string;
}

type CreateJobRecord = Omit<NewJob, "payload"> & { payload: JsonObject };
type CreateAttachmentCandidateRecord = Omit<NewAttachmentCandidate, "metadata"> & {
  metadata?: JsonObject;
};
type CreateChatbotVariantEventRecord = Omit<NewChatbotVariantEvent, "metadata"> & {
  metadata?: JsonObject;
};
type CreateSendAuditEventRecord = Omit<NewSendAuditEvent, "metadata"> & {
  metadata?: JsonObject;
};
type SendAuditEventRecord = Omit<typeof sendAuditEvents.$inferSelect, "metadata"> & {
  metadata: JsonObject;
};
type WorkerSendBucketRow = typeof workerSendBuckets.$inferSelect;
type WorkerSendBucketConsumeResult =
  | {
      allowed: true;
      bucketKey: string;
      tokensRemaining: number;
      recentAllowedCount: number;
    }
  | {
      allowed: false;
      bucketKey: string;
      tokensRemaining: number;
      recentAllowedCount: number;
      retryAfterMs: number;
    };
type ContactRow = typeof contacts.$inferSelect;
const SEND_RATE_TOKEN_SCALE = 1_000;
const serialSendJobTypes: NewJob["type"][] = [
  "send_message",
  "send_instagram_message",
  "send_voice",
  "send_document",
  "send_media",
  "campaign_step",
  "chatbot_reply",
];
const queuedSendAuditJobTypes = new Set<NewJob["type"]>(serialSendJobTypes);

export interface PushSubscriptionRecord {
  id: number;
  userId: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
}

function buildContactFtsQuery(query: string): string | null {
  const terms = query
    .trim()
    .toLowerCase()
    .match(/[\p{L}\p{N}_]+/gu);
  if (!terms?.length) {
    return null;
  }
  return terms.map((term) => `${term}*`).join(" ");
}

function encodeJson(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function decodeJsonObject(value: string | null): JsonObject {
  if (!value) {
    return {};
  }
  const parsed = JSON.parse(value) as unknown;
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? (parsed as JsonObject)
    : {};
}

function decodeNullableJsonObject(value: string | null): JsonObject | null {
  return value ? decodeJsonObject(value) : null;
}

function decodeArray<T>(value: string | null): T[] {
  if (!value) {
    return [];
  }
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function positiveIntegerValue(value: unknown): number | null {
  const number = numberValue(value);
  return number && Number.isInteger(number) && number > 0 ? number : null;
}

function legacyDelaySeconds(step: Record<string, unknown>, raw: Record<string, unknown>): number {
  const delaySeconds =
    numberValue(step.delaySeconds) ??
    numberValue(step.delay_seconds) ??
    numberValue(raw.delaySeconds) ??
    numberValue(raw.delay_seconds);
  if (delaySeconds !== null) {
    return Math.max(0, Math.round(delaySeconds));
  }
  const waitMinutes =
    numberValue(step.waitMinutes) ??
    numberValue(step.wait_minutes) ??
    numberValue(raw.waitMinutes) ??
    numberValue(raw.wait_minutes);
  return waitMinutes !== null ? Math.max(0, Math.round(waitMinutes * 60)) : 0;
}

function normalizeLegacyCampaignConditions(
  step: Record<string, unknown>,
  raw: Record<string, unknown>,
): CampaignStep["conditions"] {
  if (Array.isArray(step.conditions)) {
    const conditions = step.conditions
      .map((condition) => recordValue(condition))
      .map((condition) => ({
        type: stringValue(condition.type),
        action: stringValue(condition.action),
        value: stringValue(condition.value) || null,
        targetStepId: stringValue(condition.targetStepId) || null,
      }))
      .filter(
        (condition) =>
          ["replied", "has_tag", "channel_is", "outside_window"].includes(condition.type) &&
          ["exit", "branch", "skip", "wait"].includes(condition.action),
      );
    if (conditions.length > 0) {
      return conditions as CampaignStep["conditions"];
    }
  }

  const type = stringValue(raw.condition_type || step.conditionType);
  const action = stringValue(raw.condition_action || step.conditionAction) || "exit";
  if (
    !["replied", "has_tag", "channel_is", "outside_window"].includes(type) ||
    !["exit", "branch", "skip", "wait"].includes(action)
  ) {
    return [];
  }
  return [
    {
      type,
      action,
      value: stringValue(raw.condition_value || step.conditionValue) || null,
      targetStepId: stringValue(raw.condition_jump_to || step.conditionJumpTo) || null,
    },
  ] as CampaignStep["conditions"];
}

function firstUrlFromText(value: string): string | null {
  const match = value.match(/https?:\/\/[^\s)]+/i);
  if (!match) {
    return null;
  }
  try {
    return new URL(match[0]).toString();
  } catch {
    return null;
  }
}

function normalizeLegacyCampaignSteps(steps: unknown[]): CampaignStep[] {
  const normalized: CampaignStep[] = [];
  let pendingDelaySeconds = 0;

  for (const [index, value] of steps.entries()) {
    const step = recordValue(value);
    const raw = recordValue(step.raw);
    const type = stringValue(step.type || raw.type).toLowerCase();
    const label = stringValue(step.label) || `Step ${index + 1}`;
    const id = stringValue(step.id || raw.id) || `legacy-step-${index + 1}`;
    const delaySeconds = pendingDelaySeconds + legacyDelaySeconds(step, raw);
    const conditions = normalizeLegacyCampaignConditions(step, raw);

    if (type === "wait") {
      pendingDelaySeconds += legacyDelaySeconds(step, raw);
      continue;
    }
    if (type === "add_tag") {
      continue;
    }

    const content = stringValue(step.template || step.text || step.content || raw.content);
    const candidateBase = {
      id,
      label,
      delaySeconds,
      conditions,
    };
    const mediaAssetId =
      positiveIntegerValue(step.mediaAssetId) ?? positiveIntegerValue(raw.media_asset_id);
    const caption = stringValue(step.caption || raw.caption) || null;
    let candidate: unknown = null;

    if (type === "text" && content) {
      candidate = { ...candidateBase, type: "text", template: content };
    } else if (type === "link") {
      const url = stringValue(step.url) || firstUrlFromText(content);
      if (url && content) {
        candidate = {
          ...candidateBase,
          type: "link",
          url,
          previewEnabled: typeof step.previewEnabled === "boolean" ? step.previewEnabled : true,
          text: stringValue(step.text) || content,
        };
      }
    } else if ((type === "voice" || type === "audio") && mediaAssetId) {
      candidate = { ...candidateBase, type: "voice", mediaAssetId, caption };
    } else if (type === "document" && mediaAssetId) {
      candidate = {
        ...candidateBase,
        type: "document",
        mediaAssetId,
        fileName: stringValue(step.fileName || raw.file_name) || `${id}.pdf`,
        caption,
      };
    } else if ((type === "image" || type === "video") && mediaAssetId) {
      candidate = { ...candidateBase, type, mediaAssetId, caption };
    }

    if (!candidate && content && (type === "audio" || type === "image" || type === "video")) {
      candidate = {
        ...candidateBase,
        type: "text",
        template: `[midia legada indisponivel] ${content}`,
      };
    }

    const parsed = campaignStepSchema.safeParse(candidate);
    if (parsed.success) {
      normalized.push(parsed.data);
      pendingDelaySeconds = 0;
    }
  }

  return normalized.length > 0
    ? normalized
    : [
        {
          id: "legacy-unsupported",
          label: "Campanha legada sem steps executaveis",
          type: "text",
          delaySeconds: 0,
          conditions: [],
          template: "Campanha legada precisa de revisao antes de reativar.",
        },
      ];
}

function mapUser(row: typeof users.$inferSelect): UserRecord {
  const parsed = userSchema.parse({
    id: row.id,
    email: row.email,
    role: row.role,
    displayName: row.displayName,
    lastLoginAt: row.lastLoginAt,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
  return { ...parsed, passwordHash: row.passwordHash };
}

function mapTag(row: typeof tags.$inferSelect): Tag {
  return tagSchema.parse(row);
}

function mapAttendant(row: typeof attendants.$inferSelect): Attendant {
  return attendantSchema.parse(row);
}

function mapContact(row: typeof contacts.$inferSelect, tagIds: number[] = []): Contact {
  return contactSchema.parse({
    ...row,
    phoneE164: row.phoneE164 ?? normalizePhoneE164(row.phone),
    waJid: row.waJid ?? normalizeWaJid(row.phone),
    tagIds,
  });
}

function contactPhoneIdentityClause(phone: string) {
  const phoneE164 = normalizePhoneE164(phone);
  const phoneDigits = normalizePhone(phone);
  return or(
    eq(contacts.phone, phone),
    phoneDigits ? eq(contacts.phone, phoneDigits) : undefined,
    phoneE164 ? eq(contacts.phoneE164, phoneE164) : undefined,
  );
}

function contactWaJidIdentityClause(waJid: string) {
  const canonical = normalizeWaJid(waJid);
  return canonical ? eq(contacts.waJid, canonical) : undefined;
}

function mapConversation(row: typeof conversations.$inferSelect): Conversation {
  return conversationSchema.parse({
    ...row,
    waJid: row.waJid ?? normalizeWaJid(row.externalThreadId),
    lastMessageAt: normalizeNullableIsoDateTime(row.lastMessageAt),
    temporaryMessagesUntil: normalizeNullableIsoDateTime(row.temporaryMessagesUntil),
    profilePhotoUpdatedAt: normalizeNullableIsoDateTime(row.profilePhotoUpdatedAt),
  });
}

function normalizeNullableIsoDateTime(value: string | null | undefined): string | null {
  if (!value) return null;
  if (isContractIsoDateTime(value)) return value;

  const swappedDate = value.match(
    /^(?<year>\d{4})-(?<day>\d{2})-(?<month>\d{2})(?<time>T.*(?:Z|[+-]\d{2}:\d{2}))$/,
  );
  if (swappedDate?.groups) {
    const day = Number(swappedDate.groups.day);
    const month = Number(swappedDate.groups.month);
    if (day > 12 && month >= 1 && month <= 12) {
      const candidate = `${swappedDate.groups.year}-${swappedDate.groups.month}-${swappedDate.groups.day}${swappedDate.groups.time}`;
      if (isContractIsoDateTime(candidate)) return candidate;
    }
  }

  return null;
}

function isContractIsoDateTime(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value))
  );
}

function isDisplayableConversation(conversation: Conversation): boolean {
  const title = conversation.title.trim().toLowerCase();
  const externalThreadId = conversation.externalThreadId.trim().toLowerCase();
  const hasWhatsappIdentity =
    conversation.channel !== "whatsapp" ||
    conversation.contactId !== null ||
    normalizeConversationPhone(conversation.waJid) !== null ||
    normalizeConversationPhone(conversation.externalThreadId) !== null ||
    conversation.waJid !== null;
  const genericWhatsAppThread =
    (title === "whatsapp" || title === "whatsapp business") &&
    (externalThreadId === "whatsapp" || externalThreadId === "whatsapp business");
  const presenceOnlyThread =
    conversation.channel === "whatsapp" &&
    isPresenceOrStatusThreadTitle(title) &&
    isPresenceOrStatusThreadTitle(externalThreadId);
  return hasWhatsappIdentity && !genericWhatsAppThread && !presenceOnlyThread;
}

function normalizeConversationPhone(value: string | null | undefined): string | null {
  return normalizePhone(value);
}

const activeCampaignRecipientStatuses: Array<typeof campaignRecipients.$inferSelect.status> = [
  "queued",
  "running",
];

function normalizeCampaignPipelinePhone(value: string | null | undefined): string | null {
  return normalizePhone(value);
}

function normalizeCampaignPipelineInstagram(value: unknown): string | null {
  const cleaned = String(value ?? "")
    .trim()
    .replace(/^ig:/i, "")
    .replace(/^@+/, "")
    .toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(cleaned) ? cleaned : null;
}

function campaignActivePipelineKey(input: {
  channel: typeof campaignRecipients.$inferSelect.channel;
  phone?: string | null | undefined;
  instagramHandle?: unknown;
  metadata?: JsonObject | null | undefined;
  status?: typeof campaignRecipients.$inferSelect.status | undefined;
}): string | null {
  if (!activeCampaignRecipientStatuses.includes(input.status ?? "queued")) {
    return null;
  }
  if (input.channel === "whatsapp") {
    const phone = normalizeCampaignPipelinePhone(input.phone);
    return phone ? `whatsapp:${phone}` : null;
  }
  if (input.channel === "instagram") {
    const metadata = input.metadata && typeof input.metadata === "object" ? input.metadata : {};
    const instagramHandle = normalizeCampaignPipelineInstagram(
      input.instagramHandle ??
        (typeof metadata.instagramHandle === "string" ? metadata.instagramHandle : null) ??
        (typeof metadata.instagram === "string" ? metadata.instagram : null),
    );
    return instagramHandle ? `instagram:${instagramHandle}` : null;
  }
  return null;
}

function isPresenceOrStatusThreadTitle(value: string): boolean {
  if (!value) return false;
  if (value === "online") return true;
  if (value === "conta comercial" || value === "business account") return true;
  if (value.startsWith("visto por último")) return true;
  if (value.startsWith("last seen")) return true;
  if (value.includes("digitando") || value.includes("typing")) return true;
  if (value.includes("clique para mostrar") || value.includes("click to view")) return true;
  return false;
}

function mapMediaAsset(row: typeof mediaAssets.$inferSelect): MediaAsset {
  return mediaAssetSchema.parse(row);
}

function mapAttachmentCandidate(
  row: typeof attachmentCandidates.$inferSelect,
): AttachmentCandidate {
  return attachmentCandidateSchema.parse({
    ...row,
    metadata: decodeJsonObject(row.metadata),
  });
}

function mapMessage(row: typeof messages.$inferSelect): Message {
  return messageSchema.parse({
    ...row,
    media: decodeNullableJsonObject(row.media),
    raw: decodeNullableJsonObject(row.raw),
  });
}

function mapMessageDispatchAttempt(
  row: typeof messageDispatchAttempts.$inferSelect,
): MessageDispatchAttempt {
  return messageDispatchAttemptSchema.parse(row);
}

function mapCampaign(row: typeof campaigns.$inferSelect): Campaign {
  const campaign = {
    ...row,
    segment: decodeNullableJsonObject(row.segment),
    steps: decodeArray(row.steps),
    metadata: decodeJsonObject(row.metadata),
  };
  const parsed = campaignSchema.safeParse(campaign);
  if (parsed.success) {
    return parsed.data;
  }

  const normalizedSteps = normalizeLegacyCampaignSteps(campaign.steps);
  return campaignSchema.parse({
    ...campaign,
    steps: normalizedSteps,
    metadata: {
      ...campaign.metadata,
      legacyStepNormalization: {
        applied: true,
        originalStepCount: campaign.steps.length,
        normalizedStepCount: normalizedSteps.length,
      },
    },
  });
}

function mapCampaignRecipient(row: typeof campaignRecipients.$inferSelect): CampaignRecipient {
  return campaignRecipientSchema.parse({
    ...row,
    metadata: decodeJsonObject(row.metadata),
  });
}

function mapAutomation(row: typeof automations.$inferSelect): Automation {
  return automationSchema.parse({
    ...row,
    trigger: decodeJsonObject(row.trigger),
    condition: decodeJsonObject(row.condition),
    actions: decodeArray(row.actions),
    metadata: decodeJsonObject(row.metadata),
  });
}

function mapChatbot(row: typeof chatbots.$inferSelect): Chatbot {
  return chatbotSchema.parse({
    ...row,
    metadata: decodeJsonObject(row.metadata),
  });
}

function mapChatbotRule(row: typeof chatbotRules.$inferSelect): ChatbotRule {
  return chatbotRuleSchema.parse({
    ...row,
    match: decodeJsonObject(row.match),
    segment: decodeNullableJsonObject(row.segment),
    actions: decodeArray(row.actions),
    metadata: decodeJsonObject(row.metadata),
  });
}

function mapChatbotVariantEvent(
  row: typeof chatbotVariantEvents.$inferSelect,
): ChatbotVariantEvent {
  return chatbotVariantEventSchema.parse({
    ...row,
    metadata: decodeJsonObject(row.metadata),
  });
}

function mapJob(row: typeof jobs.$inferSelect): Job {
  return jobSchema.parse({
    ...row,
    payload: decodeJsonObject(row.payload),
  });
}

function mapDeadJob(row: typeof jobsDead.$inferSelect): DeadJob {
  return deadJobSchema.parse({
    ...row,
    payload: decodeJsonObject(row.payload),
  });
}

function mapWorkerState(row: typeof workerState.$inferSelect): WorkerState {
  return workerStateSchema.parse({
    ...row,
    metrics: decodeJsonObject(row.metrics),
  });
}

function mapSystemEvent(row: typeof systemEvents.$inferSelect) {
  return {
    ...row,
    payload: decodeJsonObject(row.payload),
  };
}

function mapSendAuditEvent(row: typeof sendAuditEvents.$inferSelect): SendAuditEventRecord {
  return {
    ...row,
    metadata: decodeJsonObject(row.metadata),
  };
}

function mapReminder(row: typeof reminders.$inferSelect): Reminder {
  return reminderSchema.parse(row);
}

function mapQuickReply(row: typeof quickReplies.$inferSelect): QuickReply {
  return quickReplySchema.parse(row);
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizedPhoneSql(valueSql: string): string {
  const source = `(CASE
    WHEN instr(coalesce(${valueSql}, ''), '@') > 0
      THEN substr(coalesce(${valueSql}, ''), 1, instr(coalesce(${valueSql}, ''), '@') - 1)
    ELSE coalesce(${valueSql}, '')
  END)`;
  const digits = `replace(replace(replace(replace(replace(${source}, ' ', ''), '-', ''), '(', ''), ')', ''), '+', '')`;
  return `(CASE
    WHEN length(${digits}) IN (12, 13) AND substr(${digits}, 1, 2) = '55' THEN ${digits}
    WHEN length(${digits}) IN (10, 11) THEN '55' || ${digits}
    ELSE ''
  END)`;
}

function normalizedJsonPhoneSql(tableAlias: string): string {
  return normalizedPhoneSql(
    `coalesce(
      json_extract(${tableAlias}.payload_json, '$.waJid'),
      json_extract(${tableAlias}.payload_json, '$.externalThreadId'),
      json_extract(${tableAlias}.payload_json, '$.phone')
    )`,
  );
}

function normalizedJsonInstagramHandleSql(tableAlias: string): string {
  const raw = `lower(trim(coalesce(json_extract(${tableAlias}.payload_json, '$.instagramHandle'), json_extract(${tableAlias}.payload_json, '$.username'), json_extract(${tableAlias}.payload_json, '$.recipientNormalizedValue'), '')))`;
  const withoutPrefix = `replace(replace(${raw}, '@', ''), 'ig:', '')`;
  return `(CASE WHEN length(${withoutPrefix}) BETWEEN 1 AND 30 THEN ${withoutPrefix} ELSE '' END)`;
}

function normalizedConversationWhatsappTargetSql(tableAlias: string): string {
  return normalizedPhoneSql(`(
    SELECT coalesce(c.wa_jid, c.external_thread_id, ct.wa_jid, ct.phone_e164, ct.phone, '')
    FROM conversations c
    LEFT JOIN contacts ct ON ct.id = c.contact_id AND ct.user_id = c.user_id
    WHERE c.user_id = ${tableAlias}.user_id
      AND c.id = cast(coalesce(json_extract(${tableAlias}.payload_json, '$.conversationId'), 0) AS integer)
      AND c.channel = 'whatsapp'
    LIMIT 1
  )`);
}

function normalizedConversationInstagramTargetSql(tableAlias: string): string {
  const raw = `(SELECT lower(trim(coalesce(c.external_thread_id, ct.instagram_handle, '')))
    FROM conversations c
    LEFT JOIN contacts ct ON ct.id = c.contact_id AND ct.user_id = c.user_id
    WHERE c.user_id = ${tableAlias}.user_id
      AND c.id = cast(coalesce(json_extract(${tableAlias}.payload_json, '$.conversationId'), 0) AS integer)
      AND c.channel = 'instagram'
    LIMIT 1)`;
  const withoutPrefix = `replace(replace(${raw}, '@', ''), 'ig:', '')`;
  return `(CASE WHEN length(${withoutPrefix}) BETWEEN 1 AND 128 THEN ${withoutPrefix} ELSE '' END)`;
}

function normalizedJsonSerialTargetSql(tableAlias: string): string {
  const phone = normalizedJsonPhoneSql(tableAlias);
  const instagramHandle = normalizedJsonInstagramHandleSql(tableAlias);
  const conversationPhone = normalizedConversationWhatsappTargetSql(tableAlias);
  const conversationInstagram = normalizedConversationInstagramTargetSql(tableAlias);
  return `(CASE
    WHEN ${conversationPhone} != '' THEN 'wa:' || ${conversationPhone}
    WHEN ${phone} != '' THEN 'wa:' || ${phone}
    WHEN ${conversationInstagram} != '' THEN 'ig:' || ${conversationInstagram}
    WHEN ${instagramHandle} != '' THEN 'ig:' || ${instagramHandle}
    ELSE ''
  END)`;
}

function roundBucketTokens(tokens: number): number {
  return Math.max(0, Math.round(tokens * 1000) / 1000);
}

function queuedAuditChannel(
  job: Job,
  resolvedChannel: NewSendAuditEvent["channel"] | null,
): NewSendAuditEvent["channel"] {
  if (resolvedChannel === "whatsapp" || resolvedChannel === "instagram") {
    return resolvedChannel;
  }
  if (
    job.type === "send_instagram_message" ||
    normalizeInstagramHandleForAudit(stringFromJson(job.payload.instagramHandle)) ||
    normalizeInstagramHandleForAudit(stringFromJson(job.payload.username)) ||
    normalizeInstagramHandleForAudit(stringFromJson(job.payload.recipientNormalizedValue))
  ) {
    return "instagram";
  }
  return "whatsapp";
}

function numberFromJson(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function stringFromJson(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeInstagramHandleForAudit(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const handle = value.trim().toLowerCase().replace(/^ig:/, "").replace(/^@/, "");
  return /^[a-z0-9._]{1,128}$/.test(handle) ? handle : null;
}

function expectRow<T>(row: T | undefined, context: string): T {
  if (!row) {
    throw new Error(`${context} did not return a row`);
  }
  return row;
}

export function createRepositories(handle: DbHandle) {
  const db = handle.db;

  async function insertJob(input: CreateJobRecord): Promise<Job | null> {
    const rows = await db
      .insert(jobs)
      .values({ ...input, payload: encodeJson(input.payload) })
      .onConflictDoNothing()
      .returning();
    const row = rows[0];
    if (!row) {
      return null;
    }
    const job = mapJob(row);
    await recordQueuedSendAuditForJob(job);
    return job;
  }

  async function recordQueuedSendAuditForJob(job: Job): Promise<void> {
    if (!queuedSendAuditJobTypes.has(job.type)) {
      return;
    }

    const conversationId = numberFromJson(job.payload.conversationId);
    const conversation = conversationId
      ? await db
          .select({
            id: conversations.id,
            channel: conversations.channel,
            contactId: conversations.contactId,
          })
          .from(conversations)
          .where(and(eq(conversations.userId, job.userId), eq(conversations.id, conversationId)))
          .get()
      : null;
    const recipientId = numberFromJson(job.payload.recipientId);
    const recipient = recipientId
      ? await db
          .select({
            campaignId: campaignRecipients.campaignId,
            contactId: campaignRecipients.contactId,
            channel: campaignRecipients.channel,
          })
          .from(campaignRecipients)
          .where(
            and(eq(campaignRecipients.userId, job.userId), eq(campaignRecipients.id, recipientId)),
          )
          .get()
      : null;
    const campaignId = await existingCampaignId(
      numberFromJson(job.payload.campaignId) ?? recipient?.campaignId ?? null,
      job.userId,
    );
    const contactId = await existingContactId(
      numberFromJson(job.payload.contactId) ??
        conversation?.contactId ??
        recipient?.contactId ??
        null,
      job.userId,
    );
    const channel = queuedAuditChannel(job, conversation?.channel ?? recipient?.channel ?? null);
    const idempotencyKey = stringFromJson(job.payload.idempotencyKey);

    await db.insert(sendAuditEvents).values({
      userId: job.userId,
      campaignId,
      contactId,
      conversationId: conversation?.id ?? null,
      messageId: null,
      jobId: job.id,
      channel,
      phase: "queued",
      latencyMs: null,
      errorCode: null,
      errorMessage: null,
      payloadHash: idempotencyKey ?? job.dedupeKey ?? null,
      workerId: null,
      metadata: encodeJson({
        jobType: job.type,
        idempotencyKey,
        dedupeKey: job.dedupeKey,
        scheduledAt: job.scheduledAt,
        priority: job.priority,
        campaignBatchId: stringFromJson(job.payload.campaignBatchId),
        campaignBatchIndex: numberFromJson(job.payload.campaignBatchIndex),
        recipientId,
      }),
    });
  }

  async function existingCampaignId(
    campaignId: number | null,
    userId: number,
  ): Promise<number | null> {
    if (!campaignId) {
      return null;
    }
    const row = await db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(and(eq(campaigns.userId, userId), eq(campaigns.id, campaignId)))
      .get();
    return row?.id ?? null;
  }

  async function existingContactId(
    contactId: number | null,
    userId: number,
  ): Promise<number | null> {
    if (!contactId) {
      return null;
    }
    const row = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.userId, userId), eq(contacts.id, contactId)))
      .get();
    return row?.id ?? null;
  }

  async function tagIdsForContact(contactId: number): Promise<number[]> {
    const rows = await db
      .select({ tagId: contactTags.tagId })
      .from(contactTags)
      .where(eq(contactTags.contactId, contactId))
      .orderBy(asc(contactTags.sortOrder), asc(contactTags.createdAt), asc(contactTags.tagId));
    return rows.map((row) => row.tagId);
  }

  async function findAttachmentCandidateByConversationExternalMedia(input: {
    userId: number;
    conversationId: number;
    externalMessageId?: string | null;
    mediaAssetId: number;
  }): Promise<AttachmentCandidate | null> {
    const externalMessageId = input.externalMessageId ?? null;
    const row = await db
      .select()
      .from(attachmentCandidates)
      .where(
        and(
          eq(attachmentCandidates.userId, input.userId),
          eq(attachmentCandidates.conversationId, input.conversationId),
          eq(attachmentCandidates.mediaAssetId, input.mediaAssetId),
          externalMessageId
            ? eq(attachmentCandidates.externalMessageId, externalMessageId)
            : isNull(attachmentCandidates.externalMessageId),
        ),
      )
      .get();
    return row ? mapAttachmentCandidate(row) : null;
  }

  return {
    users: {
      async create(input: CreateUserRecord): Promise<UserRecord> {
        const [row] = await db
          .insert(users)
          .values({
            email: input.email.toLowerCase(),
            passwordHash: input.passwordHash,
            role: input.role ?? "attendant",
            displayName: input.displayName ?? null,
            isActive: input.isActive ?? true,
          } satisfies NewUser)
          .returning();
        return mapUser(expectRow(row, "users.create"));
      },

      async findById(id: number): Promise<UserRecord | null> {
        const row = await db.select().from(users).where(eq(users.id, id)).get();
        return row ? mapUser(row) : null;
      },

      async findByEmail(email: string): Promise<UserRecord | null> {
        const row = await db.select().from(users).where(eq(users.email, email.toLowerCase())).get();
        return row ? mapUser(row) : null;
      },

      async list(input: { cursor?: number; limit?: number } = {}): Promise<User[]> {
        const limit = input.limit ?? 50;
        const rows = await db
          .select()
          .from(users)
          .where(input.cursor ? gt(users.id, input.cursor) : undefined)
          .limit(limit);
        return rows.map((row) => mapUser(row));
      },

      async update(
        id: number,
        patch: Partial<
          Pick<
            NewUser,
            "displayName" | "email" | "isActive" | "lastLoginAt" | "passwordHash" | "role"
          >
        >,
      ): Promise<UserRecord | null> {
        const [row] = await db
          .update(users)
          .set({ ...patch, updatedAt: nowIso() })
          .where(eq(users.id, id))
          .returning();
        return row ? mapUser(row) : null;
      },
    },

    contacts: {
      async create(
        input: Omit<
          NewContact,
          "createdAt" | "deletedAt" | "id" | "lastMessageAt" | "updatedAt"
        > & {
          tagIds?: number[];
        },
      ): Promise<Contact> {
        const [row] = await db
          .insert(contacts)
          .values({
            userId: input.userId,
            name: input.name,
            phone: input.phone ?? null,
            phoneE164: input.phoneE164 ?? normalizePhoneE164(input.phone) ?? null,
            waJid: input.waJid ?? normalizeWaJid(input.phone) ?? null,
            email: input.email ?? null,
            primaryChannel: input.primaryChannel ?? "whatsapp",
            instagramHandle: input.instagramHandle ?? null,
            status: input.status ?? "lead",
            notes: input.notes ?? null,
            profilePhotoMediaAssetId: input.profilePhotoMediaAssetId ?? null,
            profilePhotoSha256: input.profilePhotoSha256 ?? null,
            profilePhotoUpdatedAt: input.profilePhotoUpdatedAt ?? null,
          })
          .returning();

        const created = expectRow(row, "contacts.create");

        for (const [index, tagId] of (input.tagIds ?? []).entries()) {
          await db
            .insert(contactTags)
            .values({ contactId: created.id, tagId, userId: created.userId, sortOrder: index })
            .onConflictDoNothing();
        }

        return mapContact(created, input.tagIds ?? []);
      },

      async findById(id: number): Promise<Contact | null> {
        const row = await db.select().from(contacts).where(eq(contacts.id, id)).get();
        return row ? mapContact(row, await tagIdsForContact(row.id)) : null;
      },

      async findByPhone(input: { userId: number; phone: string }): Promise<Contact | null> {
        const row = await db
          .select()
          .from(contacts)
          .where(and(eq(contacts.userId, input.userId), contactPhoneIdentityClause(input.phone)))
          .get();
        return row ? mapContact(row, await tagIdsForContact(row.id)) : null;
      },

      async findByIdentity(input: {
        userId: number;
        phone?: string | null;
        waJid?: string | null;
        email?: string | null;
        instagramHandle?: string | null;
      }): Promise<Contact | null> {
        const identityClauses = [
          input.phone ? contactPhoneIdentityClause(input.phone) : undefined,
          input.waJid ? contactWaJidIdentityClause(input.waJid) : undefined,
          input.email ? eq(contacts.email, input.email) : undefined,
          input.instagramHandle ? eq(contacts.instagramHandle, input.instagramHandle) : undefined,
        ].filter(Boolean);
        if (identityClauses.length === 0) {
          return null;
        }
        const row = await db
          .select()
          .from(contacts)
          .where(and(eq(contacts.userId, input.userId), or(...identityClauses)))
          .get();
        return row ? mapContact(row, await tagIdsForContact(row.id)) : null;
      },

      async list(input: {
        userId: number;
        cursor?: number;
        limit?: number;
        includeDeleted?: boolean;
      }): Promise<Contact[]> {
        const clauses = [
          eq(contacts.userId, input.userId),
          input.cursor ? gt(contacts.id, input.cursor) : undefined,
          input.includeDeleted ? undefined : isNull(contacts.deletedAt),
        ].filter(Boolean);
        const rows = await db
          .select()
          .from(contacts)
          .where(and(...clauses))
          .orderBy(desc(contacts.id))
          .limit(input.limit ?? 50);
        return Promise.all(
          rows.map(async (row) => mapContact(row, await tagIdsForContact(row.id))),
        );
      },

      async search(input: {
        userId: number;
        query: string;
        limit?: number;
        includeDeleted?: boolean;
      }): Promise<Contact[]> {
        const limit = input.limit ?? 20;
        const ftsQuery = buildContactFtsQuery(input.query);
        if (ftsQuery) {
          try {
            const rows = handle.raw
              .prepare(
                `
                  SELECT
                    c.id AS id,
                    c.user_id AS userId,
                    c.name AS name,
            c.phone AS phone,
            c.phone_e164 AS phoneE164,
            c.wa_jid AS waJid,
            c.email AS email,
                    c.primary_channel AS primaryChannel,
                    c.instagram_handle AS instagramHandle,
                    c.status AS status,
                    c.notes AS notes,
                    c.last_message_at AS lastMessageAt,
                    c.profile_photo_media_asset_id AS profilePhotoMediaAssetId,
                    c.profile_photo_sha256 AS profilePhotoSha256,
                    c.profile_photo_updated_at AS profilePhotoUpdatedAt,
                    c.deleted_at AS deletedAt,
                    c.created_at AS createdAt,
                    c.updated_at AS updatedAt
                  FROM contacts_fts
                  JOIN contacts c ON c.id = contacts_fts.rowid
                  WHERE c.user_id = @userId
                    AND contacts_fts.user_id = @userId
                    AND contacts_fts MATCH @ftsQuery
                    ${input.includeDeleted ? "" : "AND c.deleted_at IS NULL"}
                  ORDER BY bm25(contacts_fts), c.updated_at DESC, c.id DESC
                  LIMIT @limit
                `,
              )
              .all({ userId: input.userId, ftsQuery, limit }) as ContactRow[];
            return Promise.all(
              rows.map(async (row) => mapContact(row, await tagIdsForContact(row.id))),
            );
          } catch {
            // Databases that have not run V2.7.12 migration yet still get operational search.
          }
        }

        const pattern = `%${input.query.trim().toLowerCase()}%`;
        const rows = await db
          .select()
          .from(contacts)
          .where(
            and(
              eq(contacts.userId, input.userId),
              input.includeDeleted ? undefined : isNull(contacts.deletedAt),
              or(
                like(sql`lower(${contacts.name})`, pattern),
                like(sql`lower(coalesce(${contacts.phone}, ''))`, pattern),
                like(sql`lower(coalesce(${contacts.phoneE164}, ''))`, pattern),
                like(sql`lower(coalesce(${contacts.waJid}, ''))`, pattern),
                like(sql`lower(coalesce(${contacts.email}, ''))`, pattern),
                like(sql`lower(coalesce(${contacts.instagramHandle}, ''))`, pattern),
                like(sql`lower(coalesce(${contacts.notes}, ''))`, pattern),
              ),
            ),
          )
          .orderBy(desc(contacts.updatedAt), desc(contacts.id))
          .limit(limit);
        return Promise.all(
          rows.map(async (row) => mapContact(row, await tagIdsForContact(row.id))),
        );
      },

      async softDelete(id: number, userId: number): Promise<boolean> {
        const rows = await db
          .update(contacts)
          .set({ deletedAt: nowIso(), updatedAt: nowIso() })
          .where(and(eq(contacts.id, id), eq(contacts.userId, userId)))
          .returning({ id: contacts.id });
        return rows.length > 0;
      },

      async update(
        input: {
          id: number;
          userId: number;
        } & Partial<
          Pick<
            NewContact,
            | "email"
            | "instagramHandle"
            | "name"
            | "notes"
            | "phone"
            | "phoneE164"
            | "waJid"
            | "primaryChannel"
            | "profilePhotoMediaAssetId"
            | "profilePhotoSha256"
            | "profilePhotoUpdatedAt"
            | "status"
          >
        > & { tagIds?: number[] },
      ): Promise<Contact | null> {
        const { id, userId, tagIds, ...patch } = input;
        const contactPatch = {
          ...patch,
          ...(patch.phone !== undefined && patch.phoneE164 === undefined
            ? { phoneE164: normalizePhoneE164(patch.phone) }
            : {}),
          ...(patch.phone !== undefined && patch.waJid === undefined
            ? { waJid: normalizeWaJid(patch.phone) }
            : {}),
          ...(patch.waJid !== undefined ? { waJid: normalizeWaJid(patch.waJid) } : {}),
        };
        const [row] = await db
          .update(contacts)
          .set({ ...contactPatch, updatedAt: nowIso() })
          .where(and(eq(contacts.id, id), eq(contacts.userId, userId)))
          .returning();
        if (!row) return null;

        if (tagIds !== undefined) {
          await db
            .delete(contactTags)
            .where(and(eq(contactTags.contactId, row.id), eq(contactTags.userId, userId)));
          for (const [index, tagId] of tagIds.entries()) {
            await db
              .insert(contactTags)
              .values({ contactId: row.id, tagId, userId, sortOrder: index })
              .onConflictDoNothing();
          }
        }

        return mapContact(row, tagIds ?? (await tagIdsForContact(row.id)));
      },

      async updateProfilePhoto(input: {
        id: number;
        userId: number;
        mediaAssetId: number;
        sha256: string;
        observedAtUtc: string;
      }): Promise<Contact | null> {
        const [row] = await db
          .update(contacts)
          .set({
            profilePhotoMediaAssetId: input.mediaAssetId,
            profilePhotoSha256: input.sha256,
            profilePhotoUpdatedAt: input.observedAtUtc,
            updatedAt: nowIso(),
          })
          .where(and(eq(contacts.id, input.id), eq(contacts.userId, input.userId)))
          .returning();
        return row ? mapContact(row, await tagIdsForContact(row.id)) : null;
      },
    },

    tags: {
      async create(input: typeof tags.$inferInsert): Promise<Tag> {
        const [row] = await db.insert(tags).values(input).returning();
        return mapTag(expectRow(row, "tags.create"));
      },
      async list(userId: number): Promise<Tag[]> {
        const rows = await db.select().from(tags).where(eq(tags.userId, userId));
        return rows.map(mapTag);
      },
      async update(input: {
        id: number;
        userId: number;
        name?: string;
        color?: string;
        description?: string | null;
      }): Promise<Tag | null> {
        const patch: Partial<typeof tags.$inferInsert> = {
          updatedAt: nowIso(),
        };
        if (input.name !== undefined) patch.name = input.name;
        if (input.color !== undefined) patch.color = input.color;
        if (input.description !== undefined) patch.description = input.description;
        const [row] = await db
          .update(tags)
          .set(patch)
          .where(and(eq(tags.id, input.id), eq(tags.userId, input.userId)))
          .returning();
        return row ? mapTag(row) : null;
      },
      async delete(input: { id: number; userId: number }): Promise<boolean> {
        const rows = await db
          .delete(tags)
          .where(and(eq(tags.id, input.id), eq(tags.userId, input.userId)))
          .returning({ id: tags.id });
        return rows.length > 0;
      },
    },

    contactTags: {
      async add(input: { userId: number; contactId: number; tagId: number }): Promise<boolean> {
        const sortOrder = (await tagIdsForContact(input.contactId)).length;
        const result = await db
          .insert(contactTags)
          .values({ ...input, sortOrder })
          .onConflictDoNothing()
          .returning({ contactId: contactTags.contactId });
        return result.length > 0;
      },
      async remove(input: { userId: number; contactId: number; tagId: number }): Promise<boolean> {
        const result = await db
          .delete(contactTags)
          .where(
            and(
              eq(contactTags.userId, input.userId),
              eq(contactTags.contactId, input.contactId),
              eq(contactTags.tagId, input.tagId),
            ),
          )
          .returning({ contactId: contactTags.contactId });
        return result.length > 0;
      },
    },

    conversations: {
      async create(input: NewConversation): Promise<Conversation> {
        const [row] = await db
          .insert(conversations)
          .values({
            ...input,
            waJid:
              input.waJid ??
              (input.channel === "whatsapp" ? normalizeWaJid(input.externalThreadId) : null),
          })
          .returning();
        return mapConversation(expectRow(row, "conversations.create"));
      },
      async findById(input: { userId: number; id: number }): Promise<Conversation | null> {
        const row = await db
          .select()
          .from(conversations)
          .where(and(eq(conversations.userId, input.userId), eq(conversations.id, input.id)))
          .get();
        return row ? mapConversation(row) : null;
      },
      async upsertObserved(input: {
        userId: number;
        channel: "whatsapp" | "instagram" | "system";
        externalThreadId: string;
        waJid?: string | null;
        title: string;
        contactId?: number | null;
        lastMessageAt?: string | null;
        lastPreview?: string | null;
        profilePhotoMediaAssetId?: number | null;
        profilePhotoSha256?: string | null;
        profilePhotoUpdatedAt?: string | null;
        unreadCount?: number;
      }): Promise<Conversation> {
        const updatedAt = nowIso();
        const hasUnreadCount = input.unreadCount === undefined ? 0 : 1;
        const lastMessageAt = normalizeNullableIsoDateTime(input.lastMessageAt);
        const profilePhotoUpdatedAt = normalizeNullableIsoDateTime(input.profilePhotoUpdatedAt);
        const waJid =
          input.channel === "whatsapp"
            ? normalizeWaJid(input.waJid ?? input.externalThreadId)
            : null;
        if (input.channel === "whatsapp" && waJid) {
          const existingByWaJid = await db
            .select()
            .from(conversations)
            .where(
              and(
                eq(conversations.userId, input.userId),
                eq(conversations.channel, "whatsapp"),
                eq(conversations.waJid, waJid),
                eq(conversations.isArchived, false),
              ),
            )
            .orderBy(desc(conversations.lastMessageAt), desc(conversations.id))
            .limit(1)
            .get();
          if (existingByWaJid && existingByWaJid.externalThreadId !== input.externalThreadId) {
            const [row] = await db
              .update(conversations)
              .set({
                contactId: input.contactId ?? existingByWaJid.contactId,
                waJid,
                title: input.title || existingByWaJid.title,
                lastMessageAt: lastMessageAt ?? existingByWaJid.lastMessageAt,
                lastPreview: input.lastPreview ?? existingByWaJid.lastPreview,
                unreadCount: input.unreadCount ?? existingByWaJid.unreadCount,
                profilePhotoMediaAssetId:
                  input.profilePhotoMediaAssetId ?? existingByWaJid.profilePhotoMediaAssetId,
                profilePhotoSha256:
                  input.profilePhotoSha256 ?? existingByWaJid.profilePhotoSha256,
                profilePhotoUpdatedAt:
                  profilePhotoUpdatedAt ?? existingByWaJid.profilePhotoUpdatedAt,
                updatedAt,
              })
              .where(
                and(
                  eq(conversations.userId, input.userId),
                  eq(conversations.id, existingByWaJid.id),
                ),
              )
              .returning();
            return mapConversation(expectRow(row, "conversations.upsertObserved.waJid"));
          }
        }

        handle.raw
          .prepare(
            `INSERT INTO conversations (
               user_id,
               contact_id,
               channel,
               external_thread_id,
               wa_jid,
               title,
               last_message_at,
               last_preview,
               unread_count,
               profile_photo_media_asset_id,
               profile_photo_sha256,
               profile_photo_updated_at,
               updated_at
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(user_id, channel, external_thread_id) DO UPDATE SET
               contact_id = COALESCE(excluded.contact_id, contact_id),
               wa_jid = COALESCE(excluded.wa_jid, wa_jid),
               title = excluded.title,
               last_message_at = COALESCE(excluded.last_message_at, last_message_at),
               last_preview = COALESCE(excluded.last_preview, last_preview),
               unread_count = CASE
                 WHEN ? = 1 THEN excluded.unread_count
                 ELSE unread_count
               END,
               profile_photo_media_asset_id = COALESCE(excluded.profile_photo_media_asset_id, profile_photo_media_asset_id),
               profile_photo_sha256 = COALESCE(excluded.profile_photo_sha256, profile_photo_sha256),
               profile_photo_updated_at = COALESCE(excluded.profile_photo_updated_at, profile_photo_updated_at),
               updated_at = excluded.updated_at`,
          )
          .run(
            input.userId,
            input.contactId ?? null,
            input.channel,
            input.externalThreadId,
            waJid,
            input.title || input.externalThreadId,
            lastMessageAt,
            input.lastPreview ?? null,
            input.unreadCount ?? 0,
            input.profilePhotoMediaAssetId ?? null,
            input.profilePhotoSha256 ?? null,
            profilePhotoUpdatedAt,
            updatedAt,
            hasUnreadCount,
          );

        const row = await db
          .select()
          .from(conversations)
          .where(
            and(
              eq(conversations.userId, input.userId),
              eq(conversations.channel, input.channel),
              eq(conversations.externalThreadId, input.externalThreadId),
            ),
          )
          .get();
        return mapConversation(expectRow(row, "conversations.upsertObserved"));
      },
      async findByExternalThread(input: {
        userId: number;
        channel: "whatsapp" | "instagram" | "system";
        externalThreadId: string;
      }): Promise<Conversation | null> {
        const row = await db
          .select()
          .from(conversations)
          .where(
            and(
              eq(conversations.userId, input.userId),
              eq(conversations.channel, input.channel),
              eq(conversations.externalThreadId, input.externalThreadId),
            ),
          )
          .get();
        return row ? mapConversation(row) : null;
      },
      async findByWaJid(input: { userId: number; waJid: string }): Promise<Conversation | null> {
        const waJid = normalizeWaJid(input.waJid);
        if (!waJid) {
          return null;
        }
        const phone = normalizePhone(waJid);
        const externalThreadCandidates = [
          phone,
          phone ? `${phone}@c.us` : null,
          phone ? `${phone}@s.whatsapp.net` : null,
        ].filter((value): value is string => Boolean(value));
        const row = await db
          .select()
          .from(conversations)
          .where(
            and(
              eq(conversations.userId, input.userId),
              eq(conversations.channel, "whatsapp"),
              or(
                eq(conversations.waJid, waJid),
                inArray(conversations.externalThreadId, externalThreadCandidates),
              ),
              eq(conversations.isArchived, false),
            ),
          )
          .orderBy(desc(conversations.lastMessageAt))
          .limit(1)
          .get();
        return row ? mapConversation(row) : null;
      },
      async updateObservedById(input: {
        userId: number;
        id: number;
        waJid?: string | null;
        title?: string | null;
        contactId?: number | null;
        lastMessageAt?: string | null;
        lastPreview?: string | null;
        profilePhotoMediaAssetId?: number | null;
        profilePhotoSha256?: string | null;
        profilePhotoUpdatedAt?: string | null;
        unreadCount?: number;
      }): Promise<Conversation | null> {
        const patch: Partial<typeof conversations.$inferInsert> = {
          updatedAt: nowIso(),
        };
        if (input.title) patch.title = input.title;
        if (input.waJid !== undefined) patch.waJid = normalizeWaJid(input.waJid);
        if (input.contactId !== undefined) patch.contactId = input.contactId;
        if (input.lastMessageAt !== undefined) {
          patch.lastMessageAt = normalizeNullableIsoDateTime(input.lastMessageAt);
        }
        if (input.lastPreview !== undefined) patch.lastPreview = input.lastPreview;
        if (input.profilePhotoMediaAssetId !== undefined) {
          patch.profilePhotoMediaAssetId = input.profilePhotoMediaAssetId;
        }
        if (input.profilePhotoSha256 !== undefined)
          patch.profilePhotoSha256 = input.profilePhotoSha256;
        if (input.profilePhotoUpdatedAt !== undefined) {
          patch.profilePhotoUpdatedAt = normalizeNullableIsoDateTime(input.profilePhotoUpdatedAt);
        }
        if (input.unreadCount !== undefined) patch.unreadCount = input.unreadCount;

        const [row] = await db
          .update(conversations)
          .set(patch)
          .where(and(eq(conversations.userId, input.userId), eq(conversations.id, input.id)))
          .returning();
        return row ? mapConversation(row) : null;
      },
      async update(input: {
        userId: number;
        id: number;
        contactId?: number | null;
        waJid?: string | null;
        title?: string;
        lastMessageAt?: string | null;
        lastPreview?: string | null;
        unreadCount?: number;
        isArchived?: boolean;
        temporaryMessagesUntil?: string | null;
        profilePhotoMediaAssetId?: number | null;
        profilePhotoSha256?: string | null;
        profilePhotoUpdatedAt?: string | null;
      }): Promise<Conversation | null> {
        const patch: Partial<typeof conversations.$inferInsert> = {
          updatedAt: nowIso(),
        };
        if (input.contactId !== undefined) patch.contactId = input.contactId;
        if (input.waJid !== undefined) patch.waJid = normalizeWaJid(input.waJid);
        if (input.title !== undefined) patch.title = input.title;
        if (input.lastMessageAt !== undefined) {
          patch.lastMessageAt = normalizeNullableIsoDateTime(input.lastMessageAt);
        }
        if (input.lastPreview !== undefined) patch.lastPreview = input.lastPreview;
        if (input.unreadCount !== undefined) patch.unreadCount = input.unreadCount;
        if (input.isArchived !== undefined) patch.isArchived = input.isArchived;
        if (input.temporaryMessagesUntil !== undefined) {
          patch.temporaryMessagesUntil = normalizeNullableIsoDateTime(input.temporaryMessagesUntil);
        }
        if (input.profilePhotoMediaAssetId !== undefined) {
          patch.profilePhotoMediaAssetId = input.profilePhotoMediaAssetId;
        }
        if (input.profilePhotoSha256 !== undefined)
          patch.profilePhotoSha256 = input.profilePhotoSha256;
        if (input.profilePhotoUpdatedAt !== undefined) {
          patch.profilePhotoUpdatedAt = normalizeNullableIsoDateTime(input.profilePhotoUpdatedAt);
        }

        const [row] = await db
          .update(conversations)
          .set(patch)
          .where(and(eq(conversations.userId, input.userId), eq(conversations.id, input.id)))
          .returning();
        return row ? mapConversation(row) : null;
      },

      async materializeExternalThread(input: {
        userId: number;
        id: number;
        externalThreadId: string;
        title?: string | null;
      }): Promise<Conversation | null> {
        const existing = await db
          .select()
          .from(conversations)
          .where(
            and(
              eq(conversations.userId, input.userId),
              eq(conversations.channel, "instagram"),
              eq(conversations.externalThreadId, input.externalThreadId),
            ),
          )
          .get();
        if (existing && existing.id !== input.id) {
          const updatedAt = nowIso();
          await db
            .update(messages)
            .set({ conversationId: existing.id, updatedAt })
            .where(and(eq(messages.userId, input.userId), eq(messages.conversationId, input.id)));
          await db
            .update(conversations)
            .set({ isArchived: true, updatedAt })
            .where(and(eq(conversations.userId, input.userId), eq(conversations.id, input.id)));
          return mapConversation(existing);
        }

        const [row] = await db
          .update(conversations)
          .set({
            externalThreadId: input.externalThreadId,
            ...(input.title ? { title: input.title } : {}),
            updatedAt: nowIso(),
          })
          .where(and(eq(conversations.userId, input.userId), eq(conversations.id, input.id)))
          .returning();
        return row ? mapConversation(row) : existing ? mapConversation(existing) : null;
      },

      async updateProfilePhoto(input: {
        id: number;
        userId: number;
        contactId?: number | null;
        mediaAssetId: number;
        sha256: string;
        observedAtUtc: string;
      }): Promise<Conversation | null> {
        const patch: Partial<typeof conversations.$inferInsert> = {
          profilePhotoMediaAssetId: input.mediaAssetId,
          profilePhotoSha256: input.sha256,
          profilePhotoUpdatedAt: input.observedAtUtc,
          updatedAt: nowIso(),
        };
        if (input.contactId !== undefined) {
          patch.contactId = input.contactId;
        }
        const [row] = await db
          .update(conversations)
          .set(patch)
          .where(and(eq(conversations.userId, input.userId), eq(conversations.id, input.id)))
          .returning();
        return row ? mapConversation(row) : null;
      },
      async list(userId: number, limit = 50): Promise<Conversation[]> {
        const rows = await db
          .select()
          .from(conversations)
          .where(and(eq(conversations.userId, userId), eq(conversations.isArchived, false)))
          .orderBy(desc(conversations.lastMessageAt))
          .limit(limit * 2);
        return rows.map(mapConversation).filter(isDisplayableConversation).slice(0, limit);
      },
    },

    mediaAssets: {
      async create(input: typeof mediaAssets.$inferInsert): Promise<MediaAsset> {
        const [row] = await db.insert(mediaAssets).values(input).returning();
        return mapMediaAsset(expectRow(row, "mediaAssets.create"));
      },
      async findById(input: { userId: number; id: number }): Promise<MediaAsset | null> {
        const row = await db
          .select()
          .from(mediaAssets)
          .where(and(eq(mediaAssets.userId, input.userId), eq(mediaAssets.id, input.id)))
          .get();
        return row ? mapMediaAsset(row) : null;
      },
      async findBySha(userId: number, sha256: string): Promise<MediaAsset | null> {
        const row = await db
          .select()
          .from(mediaAssets)
          .where(and(eq(mediaAssets.userId, userId), eq(mediaAssets.sha256, sha256)))
          .get();
        return row ? mapMediaAsset(row) : null;
      },
      async list(input: {
        userId: number;
        type?: typeof mediaAssets.$inferInsert.type;
        sha256?: string;
        includeDeleted?: boolean;
        limit?: number;
      }): Promise<MediaAsset[]> {
        const clauses = [
          eq(mediaAssets.userId, input.userId),
          input.type ? eq(mediaAssets.type, input.type) : undefined,
          input.sha256 ? eq(mediaAssets.sha256, input.sha256) : undefined,
          input.includeDeleted ? undefined : isNull(mediaAssets.deletedAt),
        ].filter(Boolean);
        const rows = await db
          .select()
          .from(mediaAssets)
          .where(and(...clauses))
          .orderBy(desc(mediaAssets.createdAt))
          .limit(input.limit ?? 100);
        return rows.map(mapMediaAsset);
      },
      async update(input: {
        id: number;
        userId: number;
        fileName?: string;
        sourceUrl?: string | null;
        deletedAt?: string | null;
      }): Promise<MediaAsset | null> {
        const patch: Partial<typeof mediaAssets.$inferInsert> = {
          updatedAt: nowIso(),
        };
        if (input.fileName !== undefined) patch.fileName = input.fileName;
        if (input.sourceUrl !== undefined) patch.sourceUrl = input.sourceUrl;
        if (input.deletedAt !== undefined) patch.deletedAt = input.deletedAt;
        const [row] = await db
          .update(mediaAssets)
          .set(patch)
          .where(and(eq(mediaAssets.userId, input.userId), eq(mediaAssets.id, input.id)))
          .returning();
        return row ? mapMediaAsset(row) : null;
      },
    },

    attachmentCandidates: {
      async create(input: CreateAttachmentCandidateRecord): Promise<AttachmentCandidate> {
        const [row] = await db
          .insert(attachmentCandidates)
          .values({
            ...input,
            messageId: input.messageId ?? null,
            externalMessageId: input.externalMessageId ?? null,
            caption: input.caption ?? null,
            metadata: encodeJson(input.metadata),
          })
          .returning();
        return mapAttachmentCandidate(expectRow(row, "attachmentCandidates.create"));
      },
      async findByConversationExternalMedia(input: {
        userId: number;
        conversationId: number;
        externalMessageId?: string | null;
        mediaAssetId: number;
      }): Promise<AttachmentCandidate | null> {
        return findAttachmentCandidateByConversationExternalMedia(input);
      },
      async upsert(input: CreateAttachmentCandidateRecord): Promise<AttachmentCandidate> {
        const existing = await findAttachmentCandidateByConversationExternalMedia({
          userId: input.userId,
          conversationId: input.conversationId,
          externalMessageId: input.externalMessageId ?? null,
          mediaAssetId: input.mediaAssetId,
        });
        if (existing) {
          const [row] = await db
            .update(attachmentCandidates)
            .set({
              messageId: input.messageId ?? existing.messageId,
              channel: input.channel,
              contentType: input.contentType,
              caption: input.caption ?? existing.caption,
              observedAt: input.observedAt,
              metadata: encodeJson(input.metadata ?? existing.metadata),
              updatedAt: nowIso(),
            })
            .where(
              and(
                eq(attachmentCandidates.userId, input.userId),
                eq(attachmentCandidates.id, existing.id),
              ),
            )
            .returning();
          return mapAttachmentCandidate(expectRow(row, "attachmentCandidates.upsert.update"));
        }

        const rows = await db
          .insert(attachmentCandidates)
          .values({
            ...input,
            messageId: input.messageId ?? null,
            externalMessageId: input.externalMessageId ?? null,
            caption: input.caption ?? null,
            metadata: encodeJson(input.metadata),
          })
          .onConflictDoNothing()
          .returning();
        if (rows[0]) {
          return mapAttachmentCandidate(rows[0]);
        }

        const resolved = await findAttachmentCandidateByConversationExternalMedia({
          userId: input.userId,
          conversationId: input.conversationId,
          externalMessageId: input.externalMessageId ?? null,
          mediaAssetId: input.mediaAssetId,
        });
        return expectRow(resolved ?? undefined, "attachmentCandidates.upsert.resolve");
      },
      async listByConversation(input: {
        userId: number;
        conversationId: number;
        contentType?: typeof attachmentCandidates.$inferInsert.contentType;
        limit?: number;
      }): Promise<AttachmentCandidate[]> {
        const clauses = [
          eq(attachmentCandidates.userId, input.userId),
          eq(attachmentCandidates.conversationId, input.conversationId),
          input.contentType ? eq(attachmentCandidates.contentType, input.contentType) : undefined,
        ].filter(Boolean);
        const rows = await db
          .select()
          .from(attachmentCandidates)
          .where(and(...clauses))
          .orderBy(desc(attachmentCandidates.observedAt), desc(attachmentCandidates.id))
          .limit(input.limit ?? 50);
        return rows.map(mapAttachmentCandidate);
      },
      async countByConversation(input: {
        userId: number;
        conversationId: number;
        contentType?: typeof attachmentCandidates.$inferInsert.contentType;
      }): Promise<number> {
        const clauses = [
          eq(attachmentCandidates.userId, input.userId),
          eq(attachmentCandidates.conversationId, input.conversationId),
          input.contentType ? eq(attachmentCandidates.contentType, input.contentType) : undefined,
        ].filter(Boolean);
        const row = await db
          .select({ total: sql<number>`count(*)` })
          .from(attachmentCandidates)
          .where(and(...clauses))
          .get();
        return Number(row?.total ?? 0);
      },
    },

    messages: {
      async create(
        input: Omit<NewMessage, "media" | "raw"> & {
          media?: JsonObject | null;
          raw?: JsonObject | null;
        },
      ): Promise<Message> {
        const values: NewMessage = {
          ...input,
          media: input.media ? encodeJson(input.media) : null,
          raw: input.raw ? encodeJson(input.raw) : null,
        };
        const [row] = await db.insert(messages).values(values).returning();
        return mapMessage(expectRow(row, "messages.create"));
      },
      async insertOrIgnore(
        input: Omit<NewMessage, "media" | "raw"> & {
          media?: JsonObject | null;
          raw?: JsonObject | null;
        },
      ): Promise<Message | null> {
        const values: NewMessage = {
          ...input,
          media: input.media ? encodeJson(input.media) : null,
          raw: input.raw ? encodeJson(input.raw) : null,
        };
        const rows = await db.insert(messages).values(values).onConflictDoNothing().returning();
        return rows[0] ? mapMessage(rows[0]) : null;
      },
      async findById(input: { userId: number; id: number }): Promise<Message | null> {
        const row = await db
          .select()
          .from(messages)
          .where(and(eq(messages.userId, input.userId), eq(messages.id, input.id)))
          .get();
        return row ? mapMessage(row) : null;
      },
      async findByExternalId(input: {
        userId: number;
        conversationId: number;
        externalId: string;
      }): Promise<Message | null> {
        const row = await db
          .select()
          .from(messages)
          .where(
            and(
              eq(messages.userId, input.userId),
              eq(messages.conversationId, input.conversationId),
              eq(messages.externalId, input.externalId),
            ),
          )
          .get();
        return row ? mapMessage(row) : null;
      },
      async listByConversation(input: {
        userId: number;
        conversationId: number;
        limit?: number;
        includeDeleted?: boolean;
      }): Promise<Message[]> {
        const rows = await db
          .select()
          .from(messages)
          .where(
            and(
              eq(messages.userId, input.userId),
              eq(messages.conversationId, input.conversationId),
              input.includeDeleted === false ? isNull(messages.deletedAt) : undefined,
            ),
          )
          .orderBy(desc(messages.observedAtUtc))
          .limit(input.limit ?? 100);
        return rows.map(mapMessage);
      },
      async findLatestInboundByConversation(input: {
        userId: number;
        conversationId: number;
      }): Promise<Message | null> {
        const row = await db
          .select()
          .from(messages)
          .where(
            and(
              eq(messages.userId, input.userId),
              eq(messages.conversationId, input.conversationId),
              eq(messages.direction, "inbound"),
              isNull(messages.deletedAt),
            ),
          )
          .orderBy(desc(messages.observedAtUtc), desc(messages.id))
          .limit(1)
          .get();
        return row ? mapMessage(row) : null;
      },
      async failedConversationIds(input: {
        userId: number;
        conversationIds: number[];
      }): Promise<Set<number>> {
        if (input.conversationIds.length === 0) {
          return new Set();
        }
        const placeholders = input.conversationIds.map(() => "?").join(", ");
        const rows = handle.raw
          .prepare(
            `SELECT DISTINCT conversation_id AS conversationId
             FROM messages
             WHERE user_id = ?
               AND status = 'failed'
               AND deleted_at IS NULL
               AND conversation_id IN (${placeholders})`,
          )
          .all(input.userId, ...input.conversationIds) as Array<{ conversationId: number }>;
        return new Set(rows.map((row) => row.conversationId));
      },
      async update(input: {
        id: number;
        userId: number;
        status?: typeof messages.$inferInsert.status;
        body?: string | null;
        media?: JsonObject | null;
        editedAt?: string | null;
        deletedAt?: string | null;
        raw?: JsonObject | null;
      }): Promise<Message | null> {
        const patch: Partial<typeof messages.$inferInsert> = {
          updatedAt: nowIso(),
        };
        if (input.status !== undefined) patch.status = input.status;
        if (input.body !== undefined) patch.body = input.body;
        if (input.media !== undefined) patch.media = input.media ? encodeJson(input.media) : null;
        if (input.editedAt !== undefined) patch.editedAt = input.editedAt;
        if (input.deletedAt !== undefined) patch.deletedAt = input.deletedAt;
        if (input.raw !== undefined) patch.raw = input.raw ? encodeJson(input.raw) : null;
        const [row] = await db
          .update(messages)
          .set(patch)
          .where(and(eq(messages.userId, input.userId), eq(messages.id, input.id)))
          .returning();
        return row ? mapMessage(row) : null;
      },
      async updateStatus(
        id: number,
        status: typeof messages.$inferInsert.status,
      ): Promise<boolean> {
        const rows = await db
          .update(messages)
          .set({ status, updatedAt: nowIso() })
          .where(eq(messages.id, id))
          .returning({ id: messages.id });
        return rows.length > 0;
      },
      async updateStatusByExternalId(input: {
        userId: number;
        conversationId: number;
        externalId: string;
        status: typeof messages.$inferInsert.status;
      }): Promise<boolean> {
        const rows = await db
          .update(messages)
          .set({ status: input.status, updatedAt: nowIso() })
          .where(
            and(
              eq(messages.userId, input.userId),
              eq(messages.conversationId, input.conversationId),
              eq(messages.externalId, input.externalId),
            ),
          )
          .returning({ id: messages.id });
        return rows.length > 0;
      },
      async updateObservedByExternalId(input: {
        userId: number;
        conversationId: number;
        externalId: string;
        status: typeof messages.$inferInsert.status;
        body?: string | null;
        contentType?: typeof messages.$inferInsert.contentType;
        editedAt?: string | null;
        raw?: JsonObject | null;
      }): Promise<boolean> {
        const rows = await db
          .update(messages)
          .set({
            status: input.status,
            body: input.body,
            contentType: input.contentType,
            editedAt: input.editedAt,
            raw: input.raw ? encodeJson(input.raw) : undefined,
            updatedAt: nowIso(),
          })
          .where(
            and(
              eq(messages.userId, input.userId),
              eq(messages.conversationId, input.conversationId),
              eq(messages.externalId, input.externalId),
            ),
          )
          .returning({ id: messages.id });
        return rows.length > 0;
      },
      async markDeletedByExternalId(input: {
        userId: number;
        conversationId: number;
        externalId: string;
        deletedAt: string;
        raw?: JsonObject | null;
      }): Promise<boolean> {
        const rows = await db
          .update(messages)
          .set({
            deletedAt: input.deletedAt,
            raw: input.raw ? encodeJson(input.raw) : undefined,
            updatedAt: nowIso(),
          })
          .where(
            and(
              eq(messages.userId, input.userId),
              eq(messages.conversationId, input.conversationId),
              eq(messages.externalId, input.externalId),
            ),
          )
          .returning({ id: messages.id });
        return rows.length > 0;
      },
      async latestId(userId: number): Promise<number> {
        const row = await db
          .select({ id: messages.id })
          .from(messages)
          .where(eq(messages.userId, userId))
          .orderBy(desc(messages.id))
          .limit(1)
          .get();
        return row?.id ?? 0;
      },
      async listInboundAfterId(input: {
        userId: number;
        afterId: number;
        limit?: number;
      }): Promise<Message[]> {
        const rows = await db
          .select()
          .from(messages)
          .where(
            and(
              eq(messages.userId, input.userId),
              gt(messages.id, input.afterId),
              eq(messages.direction, "inbound"),
              isNull(messages.deletedAt),
            ),
          )
          .orderBy(asc(messages.id))
          .limit(input.limit ?? 100);
        return rows.map(mapMessage);
      },
      async findByIdempotencyKey(input: {
        userId: number;
        idempotencyKey: string;
      }): Promise<Message | null> {
        const row = await db
          .select()
          .from(messages)
          .where(
            and(
              eq(messages.userId, input.userId),
              eq(messages.idempotencyKey, input.idempotencyKey),
            ),
          )
          .get();
        return row ? mapMessage(row) : null;
      },
      async upsertOutboundByKey(
        input: Omit<NewMessage, "media" | "raw"> & {
          idempotencyKey: string;
          media?: JsonObject | null;
          raw?: JsonObject | null;
        },
      ): Promise<{ message: Message; created: boolean }> {
        const values: NewMessage = {
          ...input,
          media: input.media ? encodeJson(input.media) : null,
          raw: input.raw ? encodeJson(input.raw) : null,
        };
        // We intentionally omit the conflict target: SQLite cannot match a
        // partial unique index (idx_messages_idempotency WHERE idempotency_key
        // IS NOT NULL) without restating the predicate, and Drizzle's
        // onConflictDoNothing API does not expose targetWhere. A bare
        // ON CONFLICT DO NOTHING is safe here because every other unique
        // constraint on messages tolerates the values used for outbound
        // inserts (external_id is NULL until the platform returns it).
        const inserted = await db.insert(messages).values(values).onConflictDoNothing().returning();
        if (inserted[0]) {
          return { message: mapMessage(inserted[0]), created: true };
        }
        const existing = await db
          .select()
          .from(messages)
          .where(
            and(
              eq(messages.userId, input.userId),
              eq(messages.idempotencyKey, input.idempotencyKey),
            ),
          )
          .get();
        if (!existing) {
          throw new Error(
            `upsertOutboundByKey: conflict reported but no existing row for key=${input.idempotencyKey}`,
          );
        }
        return { message: mapMessage(existing), created: false };
      },
      async markDispatched(input: { id: number; dispatchAttempts: number }): Promise<void> {
        await db
          .update(messages)
          .set({
            dispatchedAt: nowIso(),
            dispatchAttempts: input.dispatchAttempts,
            updatedAt: nowIso(),
          })
          .where(eq(messages.id, input.id));
      },
      async setExternalId(input: {
        id: number;
        externalId: string;
        status: typeof messages.$inferInsert.status;
      }): Promise<void> {
        await db
          .update(messages)
          .set({
            externalId: input.externalId,
            status: input.status,
            updatedAt: nowIso(),
          })
          .where(eq(messages.id, input.id));
      },
      async reconcileIdempotencyExternalConflict(input: {
        userId: number;
        conversationId: number;
        idempotencyMessageId: number;
        idempotencyKey: string;
        externalId: string;
        status: typeof messages.$inferInsert.status;
        dispatchAttempts: number;
      }): Promise<Message | null> {
        const now = nowIso();
        const tx = handle.raw.transaction(() => {
          const external = handle.raw
            .prepare(
              `SELECT id
               FROM messages
               WHERE user_id = ?
                 AND conversation_id = ?
                 AND external_id = ?
                 AND id != ?
               LIMIT 1`,
            )
            .get(
              input.userId,
              input.conversationId,
              input.externalId,
              input.idempotencyMessageId,
            ) as { id: number } | undefined;
          if (!external) {
            return null;
          }

          const placeholder = handle.raw
            .prepare(
              `SELECT contact_id, body, media_asset_id, media_json, raw_json
               FROM messages
               WHERE id = ?
                 AND user_id = ?
                 AND idempotency_key = ?
               LIMIT 1`,
            )
            .get(input.idempotencyMessageId, input.userId, input.idempotencyKey) as
            | {
                contact_id: number | null;
                body: string | null;
                media_asset_id: number | null;
                media_json: string | null;
                raw_json: string | null;
              }
            | undefined;

          if (!placeholder) {
            return external.id;
          }

          handle.raw
            .prepare(
              `UPDATE message_dispatch_attempts
               SET message_id = ?,
                   external_id = COALESCE(external_id, ?),
                   updated_at = ?
               WHERE message_id = ?
                 AND idempotency_key = ?`,
            )
            .run(
              external.id,
              input.externalId,
              now,
              input.idempotencyMessageId,
              input.idempotencyKey,
            );

          handle.raw
            .prepare(
              `UPDATE attachment_candidates
               SET message_id = ?,
                   updated_at = ?
               WHERE message_id = ?`,
            )
            .run(external.id, now, input.idempotencyMessageId);

          handle.raw
            .prepare(
              `UPDATE chatbot_variant_events
               SET message_id = ?,
                   updated_at = ?
               WHERE message_id = ?`,
            )
            .run(external.id, now, input.idempotencyMessageId);

          handle.raw
            .prepare(
              `DELETE FROM messages
               WHERE id = ?
                 AND user_id = ?
                 AND idempotency_key = ?`,
            )
            .run(input.idempotencyMessageId, input.userId, input.idempotencyKey);

          handle.raw
            .prepare(
              `UPDATE messages
               SET idempotency_key = ?,
                   dispatched_at = COALESCE(dispatched_at, ?),
                   dispatch_attempts = max(dispatch_attempts, ?),
                   status = CASE
                     WHEN status IN ('delivered', 'read') THEN status
                     ELSE ?
                   END,
                   contact_id = COALESCE(contact_id, ?),
                   body = COALESCE(body, ?),
                   media_asset_id = COALESCE(media_asset_id, ?),
                   media_json = COALESCE(media_json, ?),
                   raw_json = COALESCE(raw_json, ?),
                   updated_at = ?
               WHERE id = ?
                 AND user_id = ?
                 AND conversation_id = ?
                 AND external_id = ?`,
            )
            .run(
              input.idempotencyKey,
              now,
              input.dispatchAttempts,
              input.status,
              placeholder.contact_id,
              placeholder.body,
              placeholder.media_asset_id,
              placeholder.media_json,
              placeholder.raw_json,
              now,
              external.id,
              input.userId,
              input.conversationId,
              input.externalId,
            );

          return external.id;
        });

        const reconciledId = tx();
        if (!reconciledId) {
          return null;
        }
        const row = await db.select().from(messages).where(eq(messages.id, reconciledId)).get();
        return row ? mapMessage(row) : null;
      },
    },

    messageDispatchAttempts: {
      async create(input: {
        idempotencyKey: string;
        userId: number;
        jobId: number;
        workerId: string;
        phase: MessageDispatchPhase;
        messageId?: number | null;
        externalId?: string | null;
        error?: string | null;
      }): Promise<MessageDispatchAttempt> {
        const values: NewMessageDispatchAttempt = {
          idempotencyKey: input.idempotencyKey,
          userId: input.userId,
          jobId: input.jobId,
          workerId: input.workerId,
          phase: input.phase,
          messageId: input.messageId ?? null,
          externalId: input.externalId ?? null,
          error: input.error ?? null,
        };
        const [row] = await db.insert(messageDispatchAttempts).values(values).returning();
        return mapMessageDispatchAttempt(expectRow(row, "messageDispatchAttempts.create"));
      },
      async findActiveByKey(input: {
        idempotencyKey: string;
        staleAfterMs: number;
        now?: Date;
      }): Promise<MessageDispatchAttempt | null> {
        const cutoff = new Date(
          (input.now?.getTime() ?? Date.now()) - input.staleAfterMs,
        ).toISOString();
        const row = await db
          .select()
          .from(messageDispatchAttempts)
          .where(
            and(
              eq(messageDispatchAttempts.idempotencyKey, input.idempotencyKey),
              inArray(messageDispatchAttempts.phase, ["sending", "sent", "confirmed"]),
              gte(messageDispatchAttempts.startedAt, cutoff),
            ),
          )
          .orderBy(desc(messageDispatchAttempts.startedAt))
          .limit(1)
          .get();
        return row ? mapMessageDispatchAttempt(row) : null;
      },
      async transitionPhase(input: {
        id: number;
        phase: MessageDispatchPhase;
        externalId?: string | null;
        messageId?: number | null;
        error?: string | null;
      }): Promise<void> {
        const terminalPhases: MessageDispatchPhase[] = [
          "sent",
          "confirmed",
          "failed",
          "skipped_duplicate",
        ];
        const patch: Partial<typeof messageDispatchAttempts.$inferInsert> = {
          phase: input.phase,
          updatedAt: nowIso(),
        };
        if (input.externalId !== undefined) patch.externalId = input.externalId;
        if (input.messageId !== undefined) patch.messageId = input.messageId;
        if (input.error !== undefined) patch.error = input.error;
        if (terminalPhases.includes(input.phase)) {
          patch.finishedAt = nowIso();
        }
        await db
          .update(messageDispatchAttempts)
          .set(patch)
          .where(eq(messageDispatchAttempts.id, input.id));
      },
      async listByKey(idempotencyKey: string): Promise<MessageDispatchAttempt[]> {
        const rows = await db
          .select()
          .from(messageDispatchAttempts)
          .where(eq(messageDispatchAttempts.idempotencyKey, idempotencyKey))
          .orderBy(asc(messageDispatchAttempts.id));
        return rows.map(mapMessageDispatchAttempt);
      },
    },

    campaigns: {
      async create(
        input: Omit<typeof campaigns.$inferInsert, "metadata" | "segment" | "steps"> & {
          metadata?: JsonObject;
          segment?: JsonObject | null;
          steps: unknown[];
        },
      ): Promise<Campaign> {
        const [row] = await db
          .insert(campaigns)
          .values({
            ...input,
            metadata: encodeJson(input.metadata),
            segment: input.segment ? encodeJson(input.segment) : null,
            steps: encodeJson(input.steps),
          })
          .returning();
        return mapCampaign(expectRow(row, "campaigns.create"));
      },
      async findById(input: { userId: number; id: number }): Promise<Campaign | null> {
        const row = await db
          .select()
          .from(campaigns)
          .where(and(eq(campaigns.userId, input.userId), eq(campaigns.id, input.id)))
          .get();
        return row ? mapCampaign(row) : null;
      },
      async list(userId: number): Promise<Campaign[]> {
        const rows = await db
          .select()
          .from(campaigns)
          .where(eq(campaigns.userId, userId))
          .orderBy(desc(campaigns.id));
        return rows.map(mapCampaign);
      },
      async update(input: {
        id: number;
        userId: number;
        name?: string;
        channel?: typeof campaigns.$inferInsert.channel;
        status?: typeof campaigns.$inferInsert.status;
        segment?: JsonObject | null;
        steps?: unknown[];
        evergreen?: boolean;
        startsAt?: string | null;
        completedAt?: string | null;
        metadata?: JsonObject;
      }): Promise<Campaign | null> {
        const patch: Partial<typeof campaigns.$inferInsert> = { updatedAt: nowIso() };
        if (input.name !== undefined) patch.name = input.name;
        if (input.channel !== undefined) patch.channel = input.channel;
        if (input.status !== undefined) patch.status = input.status;
        if (input.segment !== undefined)
          patch.segment = input.segment ? encodeJson(input.segment) : null;
        if (input.steps !== undefined) patch.steps = encodeJson(input.steps);
        if (input.evergreen !== undefined) patch.evergreen = input.evergreen;
        if (input.startsAt !== undefined) patch.startsAt = input.startsAt;
        if (input.completedAt !== undefined) patch.completedAt = input.completedAt;
        if (input.metadata !== undefined) patch.metadata = encodeJson(input.metadata);
        const [row] = await db
          .update(campaigns)
          .set(patch)
          .where(and(eq(campaigns.id, input.id), eq(campaigns.userId, input.userId)))
          .returning();
        return row ? mapCampaign(row) : null;
      },
    },

    campaignRecipients: {
      async create(
        input: Omit<typeof campaignRecipients.$inferInsert, "metadata"> & {
          metadata?: JsonObject;
        },
      ): Promise<CampaignRecipient> {
        const activePipelineKey = campaignActivePipelineKey({
          ...input,
          instagramHandle: input.metadata?.instagramHandle ?? input.metadata?.instagram,
        });
        const [row] = await db
          .insert(campaignRecipients)
          .values({ ...input, activePipelineKey, metadata: encodeJson(input.metadata) })
          .returning();
        return mapCampaignRecipient(expectRow(row, "campaignRecipients.create"));
      },
      async findActiveByPhone(input: {
        userId: number;
        phone: string;
        channel?: typeof campaignRecipients.$inferSelect.channel;
      }): Promise<CampaignRecipient | null> {
        const activePipelineKey = campaignActivePipelineKey({
          channel: input.channel ?? "whatsapp",
          phone: input.phone,
          status: "queued",
        });
        if (!activePipelineKey) {
          return null;
        }
        const row = await db
          .select()
          .from(campaignRecipients)
          .where(
            and(
              eq(campaignRecipients.userId, input.userId),
              eq(campaignRecipients.activePipelineKey, activePipelineKey),
              inArray(campaignRecipients.status, activeCampaignRecipientStatuses),
            ),
          )
          .get();
        return row ? mapCampaignRecipient(row) : null;
      },
      async findActiveByInstagramHandle(input: {
        userId: number;
        instagramHandle: string;
      }): Promise<CampaignRecipient | null> {
        const activePipelineKey = campaignActivePipelineKey({
          channel: "instagram",
          instagramHandle: input.instagramHandle,
          status: "queued",
        });
        if (!activePipelineKey) {
          return null;
        }
        const row = await db
          .select()
          .from(campaignRecipients)
          .where(
            and(
              eq(campaignRecipients.userId, input.userId),
              eq(campaignRecipients.activePipelineKey, activePipelineKey),
              inArray(campaignRecipients.status, activeCampaignRecipientStatuses),
            ),
          )
          .get();
        return row ? mapCampaignRecipient(row) : null;
      },
      async findById(input: { userId: number; id: number }): Promise<CampaignRecipient | null> {
        const row = await db
          .select()
          .from(campaignRecipients)
          .where(
            and(eq(campaignRecipients.userId, input.userId), eq(campaignRecipients.id, input.id)),
          )
          .get();
        return row ? mapCampaignRecipient(row) : null;
      },
      async listByCampaign(input: {
        userId: number;
        campaignId: number;
        statuses?: Array<typeof campaignRecipients.$inferSelect.status>;
        limit?: number;
      }): Promise<CampaignRecipient[]> {
        const statusClauses = input.statuses?.map((status) =>
          eq(campaignRecipients.status, status),
        );
        const rows = await db
          .select()
          .from(campaignRecipients)
          .where(
            and(
              eq(campaignRecipients.userId, input.userId),
              eq(campaignRecipients.campaignId, input.campaignId),
              statusClauses && statusClauses.length > 0 ? or(...statusClauses) : undefined,
            ),
          )
          .orderBy(campaignRecipients.id)
          .limit(input.limit ?? 100);
        return rows.map(mapCampaignRecipient);
      },
      async updateState(input: {
        userId: number;
        id: number;
        status?: typeof campaignRecipients.$inferSelect.status;
        currentStepId?: string | null;
        lastError?: string | null;
        metadata?: JsonObject;
      }): Promise<CampaignRecipient | null> {
        const patch: Partial<typeof campaignRecipients.$inferInsert> = {
          updatedAt: nowIso(),
        };
        if (input.status !== undefined) patch.status = input.status;
        if (input.currentStepId !== undefined) patch.currentStepId = input.currentStepId;
        if (input.lastError !== undefined) patch.lastError = input.lastError;
        if (input.metadata !== undefined) patch.metadata = encodeJson(input.metadata);
        if (input.status !== undefined && !activeCampaignRecipientStatuses.includes(input.status)) {
          patch.activePipelineKey = null;
        }

        const [row] = await db
          .update(campaignRecipients)
          .set(patch)
          .where(
            and(eq(campaignRecipients.userId, input.userId), eq(campaignRecipients.id, input.id)),
          )
          .returning();
        return row ? mapCampaignRecipient(row) : null;
      },
    },

    automations: {
      async create(
        input: Omit<
          typeof automations.$inferInsert,
          "actions" | "condition" | "metadata" | "trigger"
        > & {
          actions: unknown[];
          condition: JsonObject;
          metadata?: JsonObject;
          trigger: JsonObject;
        },
      ): Promise<Automation> {
        const [row] = await db
          .insert(automations)
          .values({
            ...input,
            actions: encodeJson(input.actions),
            condition: encodeJson(input.condition),
            metadata: encodeJson(input.metadata),
            trigger: encodeJson(input.trigger),
          })
          .returning();
        return mapAutomation(expectRow(row, "automations.create"));
      },
      async findById(input: { userId: number; id: number }): Promise<Automation | null> {
        const row = await db
          .select()
          .from(automations)
          .where(and(eq(automations.userId, input.userId), eq(automations.id, input.id)))
          .get();
        return row ? mapAutomation(row) : null;
      },
      async list(userId: number): Promise<Automation[]> {
        const rows = await db.select().from(automations).where(eq(automations.userId, userId));
        return rows.map(mapAutomation);
      },
      async update(
        input: {
          id: number;
          userId: number;
        } & Partial<Pick<typeof automations.$inferInsert, "category" | "name" | "status">> & {
            actions?: unknown[];
            condition?: JsonObject;
            metadata?: JsonObject;
            trigger?: JsonObject;
          },
      ): Promise<Automation | null> {
        const patch: Partial<typeof automations.$inferInsert> = {
          updatedAt: nowIso(),
        };
        if (input.name !== undefined) patch.name = input.name;
        if (input.category !== undefined) patch.category = input.category;
        if (input.status !== undefined) patch.status = input.status;
        if (input.trigger !== undefined) patch.trigger = encodeJson(input.trigger);
        if (input.condition !== undefined) patch.condition = encodeJson(input.condition);
        if (input.actions !== undefined) patch.actions = encodeJson(input.actions);
        if (input.metadata !== undefined) patch.metadata = encodeJson(input.metadata);
        const [row] = await db
          .update(automations)
          .set(patch)
          .where(and(eq(automations.id, input.id), eq(automations.userId, input.userId)))
          .returning();
        return row ? mapAutomation(row) : null;
      },
    },

    attendants: {
      async create(input: typeof attendants.$inferInsert): Promise<Attendant> {
        const [row] = await db.insert(attendants).values(input).returning();
        return mapAttendant(expectRow(row, "attendants.create"));
      },
      async list(userId: number): Promise<Attendant[]> {
        const rows = await db.select().from(attendants).where(eq(attendants.userId, userId));
        return rows.map(mapAttendant);
      },
      async update(input: {
        id: number;
        userId: number;
        userAccountId?: number | null;
        name?: string;
        email?: string | null;
        role?: typeof attendants.$inferInsert.role;
        isActive?: boolean;
      }): Promise<Attendant | null> {
        const patch: Partial<typeof attendants.$inferInsert> = {
          updatedAt: nowIso(),
        };
        if (input.userAccountId !== undefined) patch.userAccountId = input.userAccountId;
        if (input.name !== undefined) patch.name = input.name;
        if (input.email !== undefined) patch.email = input.email;
        if (input.role !== undefined) patch.role = input.role;
        if (input.isActive !== undefined) patch.isActive = input.isActive;
        const [row] = await db
          .update(attendants)
          .set(patch)
          .where(and(eq(attendants.id, input.id), eq(attendants.userId, input.userId)))
          .returning();
        return row ? mapAttendant(row) : null;
      },
    },

    chatbots: {
      async list(input: {
        userId: number;
        cursor?: number;
        limit?: number;
        channel?: typeof chatbots.$inferInsert.channel;
        status?: typeof chatbots.$inferInsert.status;
      }): Promise<Chatbot[]> {
        const limit = input.limit ?? 50;
        const rows = await db
          .select()
          .from(chatbots)
          .where(
            and(
              eq(chatbots.userId, input.userId),
              input.cursor ? gt(chatbots.id, input.cursor) : undefined,
              input.channel ? eq(chatbots.channel, input.channel) : undefined,
              input.status ? eq(chatbots.status, input.status) : undefined,
            ),
          )
          .limit(limit);
        return rows.map((row) => mapChatbot(row));
      },
      async findById(input: { id: number; userId: number }): Promise<Chatbot | null> {
        const row = await db
          .select()
          .from(chatbots)
          .where(and(eq(chatbots.id, input.id), eq(chatbots.userId, input.userId)))
          .get();
        return row ? mapChatbot(row) : null;
      },
      async create(
        input: Omit<typeof chatbots.$inferInsert, "metadata"> & { metadata?: JsonObject },
      ): Promise<Chatbot> {
        const [row] = await db
          .insert(chatbots)
          .values({ ...input, metadata: encodeJson(input.metadata) })
          .returning();
        return mapChatbot(expectRow(row, "chatbots.create"));
      },
      async update(input: {
        id: number;
        userId: number;
        name?: typeof chatbots.$inferInsert.name;
        channel?: typeof chatbots.$inferInsert.channel;
        status?: typeof chatbots.$inferInsert.status;
        fallbackMessage?: typeof chatbots.$inferInsert.fallbackMessage;
        metadata?: JsonObject;
      }): Promise<Chatbot | null> {
        const patch: Partial<typeof chatbots.$inferInsert> = { updatedAt: nowIso() };
        if (input.name !== undefined) patch.name = input.name;
        if (input.channel !== undefined) patch.channel = input.channel;
        if (input.status !== undefined) patch.status = input.status;
        if (input.fallbackMessage !== undefined) patch.fallbackMessage = input.fallbackMessage;
        if (input.metadata !== undefined) patch.metadata = encodeJson(input.metadata);
        const [row] = await db
          .update(chatbots)
          .set(patch)
          .where(and(eq(chatbots.id, input.id), eq(chatbots.userId, input.userId)))
          .returning();
        return row ? mapChatbot(row) : null;
      },
      async createRule(
        input: Omit<
          typeof chatbotRules.$inferInsert,
          "actions" | "match" | "metadata" | "segment"
        > & {
          actions: unknown[];
          match: JsonObject;
          metadata?: JsonObject;
          segment?: JsonObject | null;
        },
      ): Promise<ChatbotRule> {
        const [row] = await db
          .insert(chatbotRules)
          .values({
            ...input,
            actions: encodeJson(input.actions),
            match: encodeJson(input.match),
            metadata: encodeJson(input.metadata ?? {}),
            segment: input.segment ? encodeJson(input.segment) : null,
          })
          .returning();
        return mapChatbotRule(expectRow(row, "chatbots.createRule"));
      },
      async listRules(input: {
        userId: number;
        chatbotId: number;
        isActive?: boolean;
      }): Promise<ChatbotRule[]> {
        const rows = await db
          .select()
          .from(chatbotRules)
          .where(
            and(
              eq(chatbotRules.userId, input.userId),
              eq(chatbotRules.chatbotId, input.chatbotId),
              input.isActive !== undefined ? eq(chatbotRules.isActive, input.isActive) : undefined,
            ),
          )
          .orderBy(asc(chatbotRules.priority), asc(chatbotRules.id));
        return rows.map((row) => mapChatbotRule(row));
      },
      async updateRule(input: {
        id: number;
        userId: number;
        name?: typeof chatbotRules.$inferInsert.name;
        priority?: typeof chatbotRules.$inferInsert.priority;
        match?: JsonObject;
        metadata?: JsonObject;
        segment?: JsonObject | null;
        actions?: unknown[];
        isActive?: typeof chatbotRules.$inferInsert.isActive;
      }): Promise<ChatbotRule | null> {
        const patch: Partial<typeof chatbotRules.$inferInsert> = { updatedAt: nowIso() };
        if (input.name !== undefined) patch.name = input.name;
        if (input.priority !== undefined) patch.priority = input.priority;
        if (input.match !== undefined) patch.match = encodeJson(input.match);
        if (input.metadata !== undefined) patch.metadata = encodeJson(input.metadata);
        if (input.segment !== undefined) {
          patch.segment = input.segment ? encodeJson(input.segment) : null;
        }
        if (input.actions !== undefined) patch.actions = encodeJson(input.actions);
        if (input.isActive !== undefined) patch.isActive = input.isActive;
        const [row] = await db
          .update(chatbotRules)
          .set(patch)
          .where(and(eq(chatbotRules.id, input.id), eq(chatbotRules.userId, input.userId)))
          .returning();
        return row ? mapChatbotRule(row) : null;
      },
      async recordVariantEvent(
        input: CreateChatbotVariantEventRecord,
      ): Promise<ChatbotVariantEvent | null> {
        const values = {
          ...input,
          metadata: encodeJson(input.metadata ?? {}),
        } satisfies NewChatbotVariantEvent;
        const [row] = await db
          .insert(chatbotVariantEvents)
          .values(values)
          .onConflictDoNothing()
          .returning();
        if (row) {
          return mapChatbotVariantEvent(row);
        }
        if (!input.sourceEventId) {
          return null;
        }
        const existing = await db
          .select()
          .from(chatbotVariantEvents)
          .where(
            and(
              eq(chatbotVariantEvents.userId, input.userId),
              eq(chatbotVariantEvents.sourceEventId, input.sourceEventId),
            ),
          )
          .get();
        return existing ? mapChatbotVariantEvent(existing) : null;
      },
      async listVariantEvents(input: {
        userId: number;
        chatbotId?: number;
        ruleId?: number;
        eventType?: typeof chatbotVariantEvents.$inferInsert.eventType;
        cursor?: number;
        limit?: number;
      }): Promise<ChatbotVariantEvent[]> {
        const rows = await db
          .select()
          .from(chatbotVariantEvents)
          .where(
            and(
              eq(chatbotVariantEvents.userId, input.userId),
              input.chatbotId ? eq(chatbotVariantEvents.chatbotId, input.chatbotId) : undefined,
              input.ruleId ? eq(chatbotVariantEvents.ruleId, input.ruleId) : undefined,
              input.eventType ? eq(chatbotVariantEvents.eventType, input.eventType) : undefined,
              input.cursor ? gt(chatbotVariantEvents.id, input.cursor) : undefined,
            ),
          )
          .orderBy(desc(chatbotVariantEvents.createdAt), desc(chatbotVariantEvents.id))
          .limit(input.limit ?? 100);
        return rows.map(mapChatbotVariantEvent);
      },
      async summarizeVariantEvents(input: {
        userId: number;
        chatbotId?: number;
        ruleId?: number;
      }): Promise<
        Array<{
          chatbotId: number;
          ruleId: number;
          variantId: string;
          variantLabel: string | null;
          exposures: number;
          conversions: number;
        }>
      > {
        const params: Array<string | number> = [input.userId];
        let filters = "WHERE user_id = ?";
        if (input.chatbotId) {
          filters += " AND chatbot_id = ?";
          params.push(input.chatbotId);
        }
        if (input.ruleId) {
          filters += " AND rule_id = ?";
          params.push(input.ruleId);
        }
        const rows = handle.raw
          .prepare(
            `SELECT
               chatbot_id AS chatbotId,
               rule_id AS ruleId,
               variant_id AS variantId,
               variant_label AS variantLabel,
               SUM(CASE WHEN event_type = 'exposure' THEN 1 ELSE 0 END) AS exposures,
               SUM(CASE WHEN event_type = 'conversion' THEN 1 ELSE 0 END) AS conversions
             FROM chatbot_variant_events
             ${filters}
             GROUP BY chatbot_id, rule_id, variant_id, variant_label
             ORDER BY rule_id ASC, variant_id ASC`,
          )
          .all(...params) as Array<{
          chatbotId: number;
          ruleId: number;
          variantId: string;
          variantLabel: string | null;
          exposures: number | null;
          conversions: number | null;
        }>;
        return rows.map((row) => ({
          chatbotId: row.chatbotId,
          ruleId: row.ruleId,
          variantId: row.variantId,
          variantLabel: row.variantLabel,
          exposures: row.exposures ?? 0,
          conversions: row.conversions ?? 0,
        }));
      },
    },

    jobs: {
      async create(input: CreateJobRecord): Promise<Job | null> {
        return insertJob(input);
      },

      async claimDueJobs(input: {
        workerId: string;
        now?: string;
        limit?: number;
        excludeTypes?: NewJob["type"][];
      }): Promise<Job[]> {
        const now = input.now ?? nowIso();
        const limit = input.limit ?? 1;
        const claimedAt = nowIso();
        const excludeTypes = input.excludeTypes ?? [];

        const tx = handle.raw.transaction(() => {
          const typeFilter =
            excludeTypes.length > 0
              ? `AND type NOT IN (${excludeTypes.map(() => "?").join(", ")})`
              : "";
          const sendTypePlaceholders = serialSendJobTypes.map(() => "?").join(", ");
          const jobTargetExpr = normalizedJsonSerialTargetSql("jobs");
          const activeTargetExpr = normalizedJsonSerialTargetSql("active_jobs");
          const jobPhoneExpr = normalizedJsonPhoneSql("jobs");
          const candidateRecipientPhoneExpr = normalizedPhoneSql("candidate_recipients.phone");
          const rows = handle.raw
            .prepare(
              `SELECT id, ${jobTargetExpr} AS target_key FROM jobs
               WHERE status = 'queued' AND scheduled_at <= ?
               ${typeFilter}
               AND NOT (
                 type = 'campaign_step'
                 AND coalesce(json_extract(payload_json, '$.campaignBatchId'), '') != ''
                 AND EXISTS (
                   SELECT 1
                   FROM jobs earlier_campaign_steps
                   WHERE earlier_campaign_steps.user_id = jobs.user_id
                     AND earlier_campaign_steps.type = 'campaign_step'
                     AND earlier_campaign_steps.id != jobs.id
                     AND coalesce(json_extract(earlier_campaign_steps.payload_json, '$.campaignBatchId'), '') =
                       coalesce(json_extract(jobs.payload_json, '$.campaignBatchId'), '')
                     AND cast(coalesce(json_extract(earlier_campaign_steps.payload_json, '$.campaignBatchIndex'), 0) as integer) <
                       cast(coalesce(json_extract(jobs.payload_json, '$.campaignBatchIndex'), 0) as integer)
                     AND earlier_campaign_steps.status != 'completed'
                 )
               )
               AND NOT (
                 type = 'campaign_step'
                 AND coalesce(json_extract(payload_json, '$.campaignId'), '') != ''
                 AND ${jobPhoneExpr} != ''
                 AND EXISTS (
                   SELECT 1
                   FROM campaign_recipients candidate_recipients
                   JOIN campaign_recipients earlier_recipients
                     ON earlier_recipients.user_id = candidate_recipients.user_id
                    AND earlier_recipients.campaign_id = candidate_recipients.campaign_id
                    AND earlier_recipients.id < candidate_recipients.id
                    AND earlier_recipients.status IN ('queued', 'running')
                   WHERE candidate_recipients.user_id = jobs.user_id
                     AND candidate_recipients.campaign_id =
                       cast(json_extract(jobs.payload_json, '$.campaignId') as integer)
                     AND candidate_recipients.channel = 'whatsapp'
                     AND ${candidateRecipientPhoneExpr} = ${jobPhoneExpr}
                 )
               )
               AND NOT (
                 type IN (${sendTypePlaceholders})
                 AND ${jobTargetExpr} != ''
                 AND EXISTS (
                   SELECT 1
                   FROM jobs active_jobs
                   WHERE active_jobs.id != jobs.id
                     AND active_jobs.status IN ('claimed', 'running')
                     AND active_jobs.type IN (${sendTypePlaceholders})
                     AND ${activeTargetExpr} = ${jobTargetExpr}
                 )
               )
               ORDER BY priority ASC, scheduled_at ASC, id ASC
               LIMIT ?`,
            )
            .all(
              ...[now, ...excludeTypes, ...serialSendJobTypes, ...serialSendJobTypes, limit],
            ) as Array<{ id: number; target_key: string | null }>;

          const selectedRows: Array<{ id: number; target_key: string | null }> = [];
          const selectedTargetKeys = new Set<string>();
          for (const row of rows) {
            const targetKey = row.target_key ?? "";
            if (targetKey && selectedTargetKeys.has(targetKey)) {
              continue;
            }
            if (targetKey) {
              selectedTargetKeys.add(targetKey);
            }
            selectedRows.push(row);
            if (selectedRows.length >= limit) {
              break;
            }
          }

          const update = handle.raw.prepare(
            `UPDATE jobs
             SET status = 'claimed',
                 claimed_at = ?,
                 claimed_by = ?,
                 attempts = attempts + 1,
                 updated_at = ?
             WHERE id = ? AND status = 'queued'`,
          );

          for (const row of selectedRows) {
            update.run(claimedAt, input.workerId, claimedAt, row.id);
          }

          return selectedRows.map((row) => row.id);
        });

        const ids = tx.immediate();
        if (ids.length === 0) {
          return [];
        }

        const rows = await db
          .select()
          .from(jobs)
          .where(or(...ids.map((jobId) => eq(jobs.id, jobId))));
        const rowsById = new Map(rows.map((row) => [row.id, row]));
        return ids
          .map((jobId) => rowsById.get(jobId))
          .filter((row): row is typeof jobs.$inferSelect => Boolean(row))
          .map(mapJob);
      },

      async claimNextDueSerialJobForTarget(input: {
        workerId: string;
        completedJobId: number;
        now?: string;
        excludeTypes?: NewJob["type"][];
      }): Promise<Job | null> {
        const now = input.now ?? nowIso();
        const claimedAt = nowIso();
        const excludeTypes = input.excludeTypes ?? [];

        const tx = handle.raw.transaction(() => {
          const typeFilter =
            excludeTypes.length > 0
              ? `AND candidate_jobs.type NOT IN (${excludeTypes.map(() => "?").join(", ")})`
              : "";
          const sendTypePlaceholders = serialSendJobTypes.map(() => "?").join(", ");
          const currentTargetExpr = normalizedJsonSerialTargetSql("current_job");
          const candidateTargetExpr = normalizedJsonSerialTargetSql("candidate_jobs");
          const activeTargetExpr = normalizedJsonSerialTargetSql("active_jobs");
          const candidatePhoneExpr = normalizedJsonPhoneSql("candidate_jobs");
          const candidateRecipientPhoneExpr = normalizedPhoneSql("candidate_recipients.phone");

          const row = handle.raw
            .prepare(
              `SELECT candidate_jobs.id, ${candidateTargetExpr} AS target_key
               FROM jobs candidate_jobs
               WHERE candidate_jobs.status = 'queued'
                 AND candidate_jobs.scheduled_at <= ?
                 AND candidate_jobs.type IN (${sendTypePlaceholders})
                 ${typeFilter}
                 AND ${candidateTargetExpr} != ''
                 AND ${candidateTargetExpr} = (
                   SELECT ${currentTargetExpr}
                   FROM jobs current_job
                   WHERE current_job.id = ?
                   LIMIT 1
                 )
                 AND NOT (
                   candidate_jobs.type = 'campaign_step'
                   AND coalesce(json_extract(candidate_jobs.payload_json, '$.campaignBatchId'), '') != ''
                   AND EXISTS (
                     SELECT 1
                     FROM jobs earlier_campaign_steps
                     WHERE earlier_campaign_steps.user_id = candidate_jobs.user_id
                       AND earlier_campaign_steps.type = 'campaign_step'
                       AND earlier_campaign_steps.id != candidate_jobs.id
                       AND coalesce(json_extract(earlier_campaign_steps.payload_json, '$.campaignBatchId'), '') =
                         coalesce(json_extract(candidate_jobs.payload_json, '$.campaignBatchId'), '')
                       AND cast(coalesce(json_extract(earlier_campaign_steps.payload_json, '$.campaignBatchIndex'), 0) as integer) <
                         cast(coalesce(json_extract(candidate_jobs.payload_json, '$.campaignBatchIndex'), 0) as integer)
                       AND earlier_campaign_steps.status != 'completed'
                   )
                 )
                 AND NOT (
                   candidate_jobs.type = 'campaign_step'
                   AND coalesce(json_extract(candidate_jobs.payload_json, '$.campaignId'), '') != ''
                   AND ${candidatePhoneExpr} != ''
                   AND EXISTS (
                     SELECT 1
                     FROM campaign_recipients candidate_recipients
                     JOIN campaign_recipients earlier_recipients
                       ON earlier_recipients.user_id = candidate_recipients.user_id
                      AND earlier_recipients.campaign_id = candidate_recipients.campaign_id
                      AND earlier_recipients.id < candidate_recipients.id
                      AND earlier_recipients.status IN ('queued', 'running')
                     WHERE candidate_recipients.user_id = candidate_jobs.user_id
                       AND candidate_recipients.campaign_id =
                         cast(json_extract(candidate_jobs.payload_json, '$.campaignId') as integer)
                       AND candidate_recipients.channel = 'whatsapp'
                       AND ${candidateRecipientPhoneExpr} = ${candidatePhoneExpr}
                   )
                 )
                 AND NOT (
                   EXISTS (
                     SELECT 1
                     FROM jobs active_jobs
                     WHERE active_jobs.id != candidate_jobs.id
                       AND active_jobs.status IN ('claimed', 'running')
                       AND active_jobs.type IN (${sendTypePlaceholders})
                       AND ${activeTargetExpr} = ${candidateTargetExpr}
                   )
                 )
               ORDER BY candidate_jobs.priority ASC, candidate_jobs.scheduled_at ASC, candidate_jobs.id ASC
               LIMIT 1`,
            )
            .get(
              ...[
                now,
                ...serialSendJobTypes,
                ...excludeTypes,
                input.completedJobId,
                ...serialSendJobTypes,
              ],
            ) as { id: number; target_key: string | null } | undefined;

          if (!row) {
            return null;
          }

          const result = handle.raw
            .prepare(
              `UPDATE jobs
               SET status = 'claimed',
                   claimed_at = ?,
                   claimed_by = ?,
                   attempts = attempts + 1,
                   updated_at = ?
               WHERE id = ? AND status = 'queued'`,
            )
            .run(claimedAt, input.workerId, claimedAt, row.id);

          return result.changes > 0 ? row.id : null;
        });

        const id = tx.immediate();
        if (!id) {
          return null;
        }
        const [row] = await db.select().from(jobs).where(eq(jobs.id, id));
        return row ? mapJob(row) : null;
      },

      async markCompleted(jobId: number, workerId?: string): Promise<boolean> {
        const completedAt = nowIso();
        const result = workerId
          ? handle.raw
              .prepare(
                `UPDATE jobs
                 SET status = 'completed',
                     claimed_at = NULL,
                     claimed_by = NULL,
                     last_error = NULL,
                     completed_at = ?,
                     updated_at = ?
                 WHERE id = ?
                   AND status IN ('claimed', 'running')
                   AND claimed_by = ?`,
              )
              .run(completedAt, completedAt, jobId, workerId)
          : handle.raw
              .prepare(
                `UPDATE jobs
                 SET status = 'completed',
                     claimed_at = NULL,
                     claimed_by = NULL,
                     last_error = NULL,
                     completed_at = ?,
                     updated_at = ?
                 WHERE id = ?
                   AND status IN ('claimed', 'running')`,
              )
              .run(completedAt, completedAt, jobId);
        return result.changes > 0;
      },

      async releaseForRetry(input: {
        jobId: number;
        error: string;
        scheduledAt: string;
        workerId?: string;
        preserveAttempt?: boolean;
      }): Promise<boolean> {
        const updatedAt = nowIso();
        const attemptPatch = input.preserveAttempt
          ? "attempts = CASE WHEN attempts > 0 THEN attempts - 1 ELSE 0 END,"
          : "";
        const result = input.workerId
          ? handle.raw
              .prepare(
                `UPDATE jobs
                 SET status = 'queued',
                     claimed_at = NULL,
                     claimed_by = NULL,
                     scheduled_at = ?,
                     ${attemptPatch}
                     last_error = ?,
                     updated_at = ?
                 WHERE id = ?
                   AND status IN ('claimed', 'running')
                   AND claimed_by = ?`,
              )
              .run(input.scheduledAt, input.error, updatedAt, input.jobId, input.workerId)
          : handle.raw
              .prepare(
                `UPDATE jobs
                 SET status = 'queued',
                     claimed_at = NULL,
                     claimed_by = NULL,
                     scheduled_at = ?,
                     ${attemptPatch}
                     last_error = ?,
                     updated_at = ?
                 WHERE id = ?
                   AND status IN ('claimed', 'running')`,
              )
              .run(input.scheduledAt, input.error, updatedAt, input.jobId);
        return result.changes > 0;
      },

      async releaseStaleClaims(input: {
        staleAfterMs: number;
        now?: Date;
        limit?: number;
      }): Promise<{
        released: number;
        cutoff: string;
        now: string;
        staleAfterMs: number;
      }> {
        const nowDate = input.now ?? new Date();
        const now = nowDate.toISOString();
        const cutoff = new Date(nowDate.getTime() - input.staleAfterMs).toISOString();
        const limit = input.limit ?? 50;
        const rows = handle.raw
          .prepare(
            `
            SELECT id
            FROM jobs
            WHERE status IN ('claimed', 'running')
              AND claimed_at IS NOT NULL
              AND claimed_at <= ?
            ORDER BY claimed_at ASC, id ASC
            LIMIT ?
          `,
          )
          .all(cutoff, limit) as Array<{ id: number }>;
        if (rows.length === 0) {
          return { released: 0, cutoff, now, staleAfterMs: input.staleAfterMs };
        }

        const placeholders = rows.map(() => "?").join(", ");
        const result = handle.raw
          .prepare(
            `
            UPDATE jobs
            SET status = 'queued',
                claimed_at = NULL,
                claimed_by = NULL,
                scheduled_at = ?,
                last_error = ?,
                updated_at = ?
            WHERE id IN (${placeholders})
          `,
          )
          .run(
            now,
            `stale claim reaped after ${input.staleAfterMs}ms`,
            now,
            ...rows.map((row) => row.id),
          );
        return {
          released: result.changes,
          cutoff,
          now,
          staleAfterMs: input.staleAfterMs,
        };
      },

      async moveToDead(input: { jobId: number; error: string; workerId?: string }): Promise<boolean> {
        const job = await db
          .select()
          .from(jobs)
          .where(
            and(
              eq(jobs.id, input.jobId),
              inArray(jobs.status, ["claimed", "running"]),
              input.workerId ? eq(jobs.claimedBy, input.workerId) : undefined,
            ),
          )
          .get();
        if (!job) {
          return false;
        }

        const completedAt = nowIso();
        const result = input.workerId
          ? handle.raw
              .prepare(
                `UPDATE jobs
                 SET status = 'failed',
                     last_error = ?,
                     completed_at = ?,
                     updated_at = ?
                 WHERE id = ?
                   AND status IN ('claimed', 'running')
                   AND claimed_by = ?`,
              )
              .run(input.error, completedAt, completedAt, job.id, input.workerId)
          : handle.raw
              .prepare(
                `UPDATE jobs
                 SET status = 'failed',
                     last_error = ?,
                     completed_at = ?,
                     updated_at = ?
                 WHERE id = ?
                   AND status IN ('claimed', 'running')`,
              )
              .run(input.error, completedAt, completedAt, job.id);
        if (result.changes === 0) {
          return false;
        }

        await db.insert(jobsDead).values({
          userId: job.userId,
          originalJobId: job.id,
          type: job.type,
          payload: job.payload,
          finalStatus: "failed",
          attempts: job.attempts,
          lastError: input.error,
        } satisfies NewJobDead);
        return true;
      },

      async listDead(userId: number, limit = 100): Promise<DeadJob[]> {
        const rows = await db
          .select()
          .from(jobsDead)
          .where(and(eq(jobsDead.userId, userId), isNull(jobsDead.archivedAt)))
          .orderBy(desc(jobsDead.failedAt))
          .limit(limit);
        return rows.map(mapDeadJob);
      },

      async countDead(userId: number): Promise<number> {
        const row = handle.raw
          .prepare(
            `SELECT count(*) AS count
             FROM jobs_dead
             WHERE user_id = ? AND archived_at IS NULL`,
          )
          .get(userId) as { count: number } | undefined;
        return row?.count ?? 0;
      },

      async retryDead(input: {
        deadJobId: number;
        userId?: number;
        scheduledAt?: string;
      }): Promise<Job | null> {
        const clauses = [
          eq(jobsDead.id, input.deadJobId),
          isNull(jobsDead.archivedAt),
          input.userId ? eq(jobsDead.userId, input.userId) : undefined,
        ].filter(Boolean);
        const dead = await db
          .select()
          .from(jobsDead)
          .where(and(...clauses))
          .get();
        if (!dead || !dead.userId) {
          return null;
        }
        const created = await insertJob({
          userId: dead.userId,
          type: dead.type as NewJob["type"],
          status: "queued",
          payload: decodeJsonObject(dead.payload),
          scheduledAt: input.scheduledAt ?? nowIso(),
          maxAttempts: 3,
        });
        await db.update(jobsDead).set({ archivedAt: nowIso() }).where(eq(jobsDead.id, dead.id));
        return created;
      },

      async cleanupCompleted(input: { olderThan: string }): Promise<number> {
        const result = await handle.raw
          .prepare(`DELETE FROM jobs WHERE status = 'completed' AND completed_at < ?`)
          .run(input.olderThan);
        return result.changes;
      },

      async list(userId: number, status?: typeof jobs.$inferInsert.status): Promise<Job[]> {
        const rows = await db
          .select()
          .from(jobs)
          .where(
            status
              ? and(eq(jobs.userId, userId), eq(jobs.status, status))
              : eq(jobs.userId, userId),
          )
          .orderBy(desc(jobs.scheduledAt))
          .limit(100);
        return rows.map(mapJob);
      },

      async countByStatus(userId: number): Promise<Record<string, number>> {
        const rows = handle.raw
          .prepare(
            `SELECT status, count(*) AS count
             FROM jobs
             WHERE user_id = ?
             GROUP BY status`,
          )
          .all(userId) as Array<{ status: string; count: number }>;
        return Object.fromEntries(rows.map((row) => [row.status, row.count]));
      },

      async operationalMetrics(input: { userId: number; since: string }): Promise<{
        avgQueueLatencyMs: number | null;
        avgRunLatencyMs: number | null;
        maxRunLatencyMs: number | null;
        terminalLastHour: number;
        completedLastHour: number;
        failedLastHour: number;
        failureRatePct: number;
        throughputPerHour: number;
      }> {
        const rows = await db
          .select({
            status: jobs.status,
            scheduledAt: jobs.scheduledAt,
            claimedAt: jobs.claimedAt,
            completedAt: jobs.completedAt,
          })
          .from(jobs)
          .where(
            and(
              eq(jobs.userId, input.userId),
              inArray(jobs.status, ["completed", "failed"]),
              sql`${jobs.completedAt} IS NOT NULL`,
              sql`${jobs.completedAt} >= ${input.since}`,
            ),
          );

        let queueLatencyTotal = 0;
        let queueLatencySamples = 0;
        let runLatencyTotal = 0;
        let runLatencySamples = 0;
        let maxRunLatencyMs: number | null = null;
        let completedLastHour = 0;
        let failedLastHour = 0;

        for (const row of rows) {
          if (row.status === "completed") completedLastHour += 1;
          if (row.status === "failed") failedLastHour += 1;

          const scheduledAt = Date.parse(row.scheduledAt);
          const claimedAt = row.claimedAt ? Date.parse(row.claimedAt) : Number.NaN;
          const completedAt = row.completedAt ? Date.parse(row.completedAt) : Number.NaN;

          if (Number.isFinite(scheduledAt) && Number.isFinite(claimedAt)) {
            queueLatencyTotal += Math.max(0, claimedAt - scheduledAt);
            queueLatencySamples += 1;
          }
          if (Number.isFinite(claimedAt) && Number.isFinite(completedAt)) {
            const runLatencyMs = Math.max(0, completedAt - claimedAt);
            runLatencyTotal += runLatencyMs;
            runLatencySamples += 1;
            maxRunLatencyMs = Math.max(maxRunLatencyMs ?? 0, runLatencyMs);
          }
        }

        const terminalLastHour = completedLastHour + failedLastHour;
        return {
          avgQueueLatencyMs:
            queueLatencySamples > 0 ? Math.round(queueLatencyTotal / queueLatencySamples) : null,
          avgRunLatencyMs:
            runLatencySamples > 0 ? Math.round(runLatencyTotal / runLatencySamples) : null,
          maxRunLatencyMs,
          terminalLastHour,
          completedLastHour,
          failedLastHour,
          failureRatePct:
            terminalLastHour > 0 ? Math.round((failedLastHour / terminalLastHour) * 1000) / 10 : 0,
          throughputPerHour: terminalLastHour,
        };
      },
    },

    quickReplies: {
      async create(input: NewQuickReply): Promise<QuickReply> {
        const [row] = await db.insert(quickReplies).values(input).returning();
        return mapQuickReply(expectRow(row, "quickReplies.create"));
      },
      async list(input: QuickReplyListInput): Promise<QuickReply[]> {
        const query = input.query?.trim().toLowerCase();
        const pattern = query ? `%${query}%` : undefined;
        const clauses = [
          eq(quickReplies.userId, input.userId),
          input.includeDeleted ? undefined : isNull(quickReplies.deletedAt),
          input.category !== undefined ? eq(quickReplies.category, input.category) : undefined,
          input.isActive !== undefined ? eq(quickReplies.isActive, input.isActive) : undefined,
          input.cursor !== undefined ? gt(quickReplies.id, input.cursor) : undefined,
          pattern
            ? or(
                like(sql`lower(${quickReplies.title})`, pattern),
                like(sql`lower(${quickReplies.body})`, pattern),
                like(sql`lower(coalesce(${quickReplies.shortcut}, ''))`, pattern),
                like(sql`lower(coalesce(${quickReplies.category}, ''))`, pattern),
              )
            : undefined,
        ].filter(Boolean);

        const rows = await db
          .select()
          .from(quickReplies)
          .where(and(...clauses))
          .orderBy(
            asc(quickReplies.sortOrder),
            desc(quickReplies.usageCount),
            desc(quickReplies.updatedAt),
            asc(quickReplies.id),
          )
          .limit(input.limit ?? 20);
        return rows.map(mapQuickReply);
      },
      async update(input: {
        id: number;
        userId: number;
        title?: string;
        body?: string;
        shortcut?: string | null;
        category?: string | null;
        isActive?: boolean;
        sortOrder?: number;
        deletedAt?: string | null;
      }): Promise<QuickReply | null> {
        const patch: Partial<NewQuickReply> = { updatedAt: nowIso() };
        if (input.title !== undefined) patch.title = input.title;
        if (input.body !== undefined) patch.body = input.body;
        if (input.shortcut !== undefined) patch.shortcut = input.shortcut;
        if (input.category !== undefined) patch.category = input.category;
        if (input.isActive !== undefined) patch.isActive = input.isActive;
        if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;
        if (input.deletedAt !== undefined) patch.deletedAt = input.deletedAt;

        const [row] = await db
          .update(quickReplies)
          .set(patch)
          .where(and(eq(quickReplies.id, input.id), eq(quickReplies.userId, input.userId)))
          .returning();
        return row ? mapQuickReply(row) : null;
      },
      async markUsed(input: {
        id: number;
        userId: number;
        usedAt?: string;
      }): Promise<QuickReply | null> {
        const usedAt = input.usedAt ?? nowIso();
        const [row] = await db
          .update(quickReplies)
          .set({
            usageCount: sql`${quickReplies.usageCount} + 1`,
            lastUsedAt: usedAt,
            updatedAt: usedAt,
          })
          .where(
            and(
              eq(quickReplies.id, input.id),
              eq(quickReplies.userId, input.userId),
              eq(quickReplies.isActive, true),
              isNull(quickReplies.deletedAt),
            ),
          )
          .returning();
        return row ? mapQuickReply(row) : null;
      },
    },

    reminders: {
      async create(input: typeof reminders.$inferInsert): Promise<Reminder> {
        const [row] = await db.insert(reminders).values(input).returning();
        return mapReminder(expectRow(row, "reminders.create"));
      },
      async list(input: {
        userId: number;
        contactId?: number;
        conversationId?: number;
        assignedToUserId?: number;
        status?: ReminderStatus;
        dueBefore?: string;
        dueAfter?: string;
        cursor?: number;
        limit?: number;
      }): Promise<Reminder[]> {
        const clauses = [
          eq(reminders.userId, input.userId),
          input.contactId !== undefined ? eq(reminders.contactId, input.contactId) : undefined,
          input.conversationId !== undefined
            ? eq(reminders.conversationId, input.conversationId)
            : undefined,
          input.assignedToUserId !== undefined
            ? eq(reminders.assignedToUserId, input.assignedToUserId)
            : undefined,
          input.status !== undefined ? eq(reminders.status, input.status) : undefined,
          input.dueBefore !== undefined ? lte(reminders.dueAt, input.dueBefore) : undefined,
          input.dueAfter !== undefined ? gte(reminders.dueAt, input.dueAfter) : undefined,
          input.cursor !== undefined ? gt(reminders.id, input.cursor) : undefined,
        ].filter(Boolean);
        const rows = await db
          .select()
          .from(reminders)
          .where(and(...clauses))
          .orderBy(asc(reminders.dueAt), asc(reminders.id))
          .limit(input.limit ?? 50);
        return rows.map(mapReminder);
      },
      async update(input: {
        id: number;
        userId: number;
        contactId?: number | null;
        conversationId?: number | null;
        assignedToUserId?: number | null;
        title?: string;
        notes?: string | null;
        dueAt?: string;
        status?: ReminderStatus;
        completedAt?: string | null;
      }): Promise<Reminder | null> {
        const patch: Partial<typeof reminders.$inferInsert> = { updatedAt: nowIso() };
        if (input.contactId !== undefined) patch.contactId = input.contactId;
        if (input.conversationId !== undefined) patch.conversationId = input.conversationId;
        if (input.assignedToUserId !== undefined) {
          patch.assignedToUserId = input.assignedToUserId;
        }
        if (input.title !== undefined) patch.title = input.title;
        if (input.notes !== undefined) patch.notes = input.notes;
        if (input.dueAt !== undefined) patch.dueAt = input.dueAt;
        if (input.status !== undefined) patch.status = input.status;
        if (input.completedAt !== undefined) patch.completedAt = input.completedAt;

        const [row] = await db
          .update(reminders)
          .set(patch)
          .where(and(eq(reminders.id, input.id), eq(reminders.userId, input.userId)))
          .returning();
        return row ? mapReminder(row) : null;
      },
      async dueBefore(userId: number, dueBefore: string): Promise<Reminder[]> {
        const rows = await db
          .select()
          .from(reminders)
          .where(and(eq(reminders.userId, userId), lte(reminders.dueAt, dueBefore)));
        return rows.map(mapReminder);
      },
    },

    auditLogs: {
      async create(input: typeof auditLogs.$inferInsert): Promise<void> {
        await db.insert(auditLogs).values(input);
      },
    },

    sendAuditEvents: {
      async create(input: CreateSendAuditEventRecord): Promise<SendAuditEventRecord> {
        const values: NewSendAuditEvent = {
          ...input,
          metadata: encodeJson(input.metadata),
        };
        const [row] = await db.insert(sendAuditEvents).values(values).returning();
        return mapSendAuditEvent(expectRow(row, "sendAuditEvents.create"));
      },
      async list(input: {
        userId: number;
        campaignId?: number;
        contactId?: number;
        conversationId?: number;
        jobId?: number;
        phase?: NewSendAuditEvent["phase"];
        limit?: number;
      }): Promise<SendAuditEventRecord[]> {
        const clauses = [
          eq(sendAuditEvents.userId, input.userId),
          input.campaignId !== undefined
            ? eq(sendAuditEvents.campaignId, input.campaignId)
            : undefined,
          input.contactId !== undefined ? eq(sendAuditEvents.contactId, input.contactId) : undefined,
          input.conversationId !== undefined
            ? eq(sendAuditEvents.conversationId, input.conversationId)
            : undefined,
          input.jobId !== undefined ? eq(sendAuditEvents.jobId, input.jobId) : undefined,
          input.phase ? eq(sendAuditEvents.phase, input.phase) : undefined,
        ].filter(Boolean);

        const rows = await db
          .select()
          .from(sendAuditEvents)
          .where(and(...clauses))
          .orderBy(desc(sendAuditEvents.occurredAt), desc(sendAuditEvents.id))
          .limit(Math.min(input.limit ?? 100, 500));
        return rows.map(mapSendAuditEvent);
      },
    },

    workerSendBuckets: {
      consume(input: {
        userId: number;
        bucketKey: string;
        rateLimitMax: number;
        refillWindowMs: number;
        nowMs?: number;
      }): WorkerSendBucketConsumeResult {
        const rateLimitMax = Math.max(1, Math.trunc(input.rateLimitMax));
        const refillWindowMs = Math.max(1, Math.trunc(input.refillWindowMs));
        const capacityMilli = rateLimitMax * SEND_RATE_TOKEN_SCALE;
        const nowMs = Math.max(0, Math.trunc(input.nowMs ?? Date.now()));
        const nowIsoValue = new Date(nowMs).toISOString();
        const bucketKey = input.bucketKey.trim();

        const tx = handle.raw.transaction(() => {
          const existing = handle.raw
            .prepare(
              `SELECT
                 tokens_milli AS tokensMilli,
                 refilled_at_ms AS refilledAtMs
               FROM worker_send_buckets
               WHERE user_id = ? AND bucket_key = ?`,
            )
            .get(input.userId, bucketKey) as
            | Pick<WorkerSendBucketRow, "tokensMilli" | "refilledAtMs">
            | undefined;

          const existingTokens = existing
            ? Math.min(capacityMilli, Math.max(0, existing.tokensMilli))
            : capacityMilli;
          const elapsedMs = existing ? Math.max(0, nowMs - existing.refilledAtMs) : 0;
          const refilledTokensMilli = Math.min(
            capacityMilli,
            Math.floor(existingTokens + (elapsedMs * capacityMilli) / refillWindowMs),
          );
          const allowed = refilledTokensMilli >= SEND_RATE_TOKEN_SCALE;
          const nextTokensMilli = allowed
            ? refilledTokensMilli - SEND_RATE_TOKEN_SCALE
            : refilledTokensMilli;

          handle.raw
            .prepare(
              `INSERT INTO worker_send_buckets (
                 user_id,
                 bucket_key,
                 tokens_milli,
                 rate_limit_max,
                 refill_window_ms,
                 refilled_at_ms,
                 last_seen_at,
                 updated_at
               )
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(user_id, bucket_key) DO UPDATE SET
                 tokens_milli = excluded.tokens_milli,
                 rate_limit_max = excluded.rate_limit_max,
                 refill_window_ms = excluded.refill_window_ms,
                 refilled_at_ms = excluded.refilled_at_ms,
                 last_seen_at = excluded.last_seen_at,
                 updated_at = excluded.updated_at`,
            )
            .run(
              input.userId,
              bucketKey,
              nextTokensMilli,
              rateLimitMax,
              refillWindowMs,
              nowMs,
              nowIsoValue,
              nowIsoValue,
            );

          const tokensRemaining = roundBucketTokens(nextTokensMilli / SEND_RATE_TOKEN_SCALE);
          const recentAllowedCount = Math.min(
            rateLimitMax,
            Math.max(0, Math.ceil(rateLimitMax - tokensRemaining)),
          );
          if (allowed) {
            return {
              allowed: true,
              bucketKey,
              tokensRemaining,
              recentAllowedCount,
            } satisfies WorkerSendBucketConsumeResult;
          }

          const refillPerMs = capacityMilli / refillWindowMs;
          const retryAfterMs = Math.max(
            1,
            Math.ceil((SEND_RATE_TOKEN_SCALE - nextTokensMilli) / refillPerMs),
          );
          return {
            allowed: false,
            bucketKey,
            tokensRemaining,
            recentAllowedCount,
            retryAfterMs,
          } satisfies WorkerSendBucketConsumeResult;
        });

        return tx.immediate();
      },
    },

    systemEvents: {
      async create(input: typeof systemEvents.$inferInsert): Promise<void> {
        await db.insert(systemEvents).values(input);
      },
      async list(
        input: {
          userId?: number;
          type?: string;
          severity?: typeof systemEvents.$inferInsert.severity;
          afterId?: number;
          order?: "asc" | "desc";
          limit?: number;
        } = {},
      ) {
        const clauses = [
          input.userId ? eq(systemEvents.userId, input.userId) : undefined,
          input.type ? eq(systemEvents.type, input.type) : undefined,
          input.severity ? eq(systemEvents.severity, input.severity) : undefined,
          input.afterId !== undefined ? gt(systemEvents.id, input.afterId) : undefined,
        ].filter(Boolean);
        const rows = await db
          .select()
          .from(systemEvents)
          .where(clauses.length > 0 ? and(...clauses) : undefined)
          .orderBy(input.order === "asc" ? asc(systemEvents.id) : desc(systemEvents.createdAt))
          .limit(input.limit ?? 100);
        return rows.map(mapSystemEvent);
      },
    },

    workerState: {
      async heartbeat(input: {
        workerId: string;
        status: "starting" | "idle" | "busy" | "stopping" | "stopped" | "error";
        currentJobId?: number | null;
        pid?: number;
        rssMb?: number;
        browserConnected?: boolean;
        lastError?: string | null;
        metrics?: JsonObject;
      }): Promise<void> {
        const heartbeatAt = nowIso();
        await db
          .insert(workerState)
          .values({
            workerId: input.workerId,
            status: input.status,
            heartbeatAt,
            currentJobId: input.currentJobId ?? null,
            pid: input.pid ?? null,
            rssMb: input.rssMb ?? null,
            browserConnected: input.browserConnected ?? false,
            lastError: input.lastError ?? null,
            metrics: encodeJson(input.metrics),
            updatedAt: heartbeatAt,
          })
          .onConflictDoUpdate({
            target: workerState.workerId,
            set: {
              status: input.status,
              heartbeatAt,
              currentJobId: input.currentJobId ?? null,
              pid: input.pid ?? null,
              rssMb: input.rssMb ?? null,
              browserConnected: input.browserConnected ?? false,
              lastError: input.lastError ?? null,
              metrics: encodeJson(input.metrics),
              updatedAt: heartbeatAt,
            },
          });
      },

      async get(workerId: string): Promise<WorkerState | null> {
        const row = await db
          .select()
          .from(workerState)
          .where(eq(workerState.workerId, workerId))
          .get();
        return row ? mapWorkerState(row) : null;
      },

      async list(): Promise<WorkerState[]> {
        const rows = await db.select().from(workerState).orderBy(desc(workerState.heartbeatAt));
        return rows.map(mapWorkerState);
      },
    },

    schedulerLocks: {
      async acquire(input: { name: string; ownerId: string; ttlMs: number }): Promise<boolean> {
        const now = nowIso();
        const expiresAt = new Date(Date.now() + input.ttlMs).toISOString();
        const tx = handle.raw.transaction(() => {
          const existing = handle.raw
            .prepare(`SELECT owner_id, expires_at FROM scheduler_locks WHERE name = ?`)
            .get(input.name) as { owner_id: string; expires_at: string } | undefined;

          if (existing && existing.expires_at > now && existing.owner_id !== input.ownerId) {
            return false;
          }

          handle.raw
            .prepare(
              `INSERT INTO scheduler_locks (name, owner_id, expires_at, acquired_at, updated_at)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(name) DO UPDATE SET
                 owner_id = excluded.owner_id,
                 expires_at = excluded.expires_at,
                 updated_at = excluded.updated_at`,
            )
            .run(input.name, input.ownerId, expiresAt, now, now);
          return true;
        });
        return tx();
      },

      async release(input: { name: string; ownerId: string }): Promise<void> {
        await db
          .delete(schedulerLocks)
          .where(
            and(eq(schedulerLocks.name, input.name), eq(schedulerLocks.ownerId, input.ownerId)),
          );
      },
    },

    pushSubscriptions: {
      async upsert(input: typeof pushSubscriptions.$inferInsert): Promise<void> {
        await db
          .insert(pushSubscriptions)
          .values(input)
          .onConflictDoUpdate({
            target: pushSubscriptions.endpoint,
            set: {
              p256dh: input.p256dh,
              auth: input.auth,
              userAgent: input.userAgent ?? null,
              updatedAt: nowIso(),
            },
          });
      },
      async deleteByEndpoint(input: { userId: number; endpoint: string }): Promise<boolean> {
        const rows = await db
          .delete(pushSubscriptions)
          .where(
            and(
              eq(pushSubscriptions.userId, input.userId),
              eq(pushSubscriptions.endpoint, input.endpoint),
            ),
          )
          .returning({ id: pushSubscriptions.id });
        return rows.length > 0;
      },
      async listByUser(userId: number): Promise<PushSubscriptionRecord[]> {
        return db
          .select({
            id: pushSubscriptions.id,
            userId: pushSubscriptions.userId,
            endpoint: pushSubscriptions.endpoint,
            p256dh: pushSubscriptions.p256dh,
            auth: pushSubscriptions.auth,
            userAgent: pushSubscriptions.userAgent,
          })
          .from(pushSubscriptions)
          .where(eq(pushSubscriptions.userId, userId));
      },
    },

    refreshSessions: {
      async create(input: typeof refreshSessions.$inferInsert): Promise<void> {
        await db.insert(refreshSessions).values(input);
      },
      async findByTokenHash(tokenHash: string) {
        return db
          .select()
          .from(refreshSessions)
          .where(eq(refreshSessions.tokenHash, tokenHash))
          .get();
      },
      async revoke(tokenHash: string, replacedByTokenHash?: string): Promise<void> {
        await db
          .update(refreshSessions)
          .set({
            revokedAt: nowIso(),
            replacedByTokenHash: replacedByTokenHash ?? null,
            updatedAt: nowIso(),
          })
          .where(eq(refreshSessions.tokenHash, tokenHash));
      },
      async revokeAllForUser(userId: number): Promise<void> {
        await db
          .update(refreshSessions)
          .set({ revokedAt: nowIso(), updatedAt: nowIso() })
          .where(and(eq(refreshSessions.userId, userId), isNull(refreshSessions.revokedAt)));
      },
    },

    passwordResetTokens: {
      async create(input: typeof passwordResetTokens.$inferInsert): Promise<void> {
        await db.insert(passwordResetTokens).values(input);
      },
      async findByTokenHash(tokenHash: string) {
        return db
          .select()
          .from(passwordResetTokens)
          .where(eq(passwordResetTokens.tokenHash, tokenHash))
          .get();
      },
      async markUsed(tokenHash: string): Promise<void> {
        await db
          .update(passwordResetTokens)
          .set({ usedAt: nowIso() })
          .where(eq(passwordResetTokens.tokenHash, tokenHash));
      },
    },
  };
}

export type Repositories = ReturnType<typeof createRepositories>;
