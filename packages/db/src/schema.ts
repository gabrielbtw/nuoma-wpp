/**
 * V2 SQLite schema (Drizzle).
 *
 * Mirrors the V2.2 Zod contracts. Complex product payloads stay as JSON text
 * in SQLite and are validated at the repo/API boundary.
 */
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const nowIso = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

const id = {
  id: integer("id").primaryKey({ autoIncrement: true }),
};

const timestamps = {
  createdAt: text("created_at").notNull().default(nowIso),
  updatedAt: text("updated_at").notNull().default(nowIso),
};

export const users = sqliteTable(
  "users",
  {
    ...id,
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role", { enum: ["admin", "attendant", "viewer"] })
      .notNull()
      .default("admin"),
    displayName: text("display_name"),
    lastLoginAt: text("last_login_at"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    ...timestamps,
  },
  (t) => ({
    emailIdx: uniqueIndex("idx_users_email").on(t.email),
    activeIdx: index("idx_users_active").on(t.isActive),
  }),
);

export const contacts = sqliteTable(
  "contacts",
  {
    ...id,
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    primaryChannel: text("primary_channel", { enum: ["whatsapp", "instagram", "system"] })
      .notNull()
      .default("whatsapp"),
    instagramHandle: text("instagram_handle"),
    status: text("status", { enum: ["lead", "active", "inactive", "blocked", "archived"] })
      .notNull()
      .default("lead"),
    notes: text("notes"),
    lastMessageAt: text("last_message_at"),
    profilePhotoMediaAssetId: integer("profile_photo_media_asset_id"),
    profilePhotoSha256: text("profile_photo_sha256"),
    profilePhotoUpdatedAt: text("profile_photo_updated_at"),
    deletedAt: text("deleted_at"),
    ...timestamps,
  },
  (t) => ({
    userStatusIdx: index("idx_contacts_user_status").on(t.userId, t.status),
    userPhoneIdx: index("idx_contacts_user_phone").on(t.userId, t.phone),
    userInstagramIdx: index("idx_contacts_user_instagram").on(t.userId, t.instagramHandle),
    userUpdatedIdx: index("idx_contacts_user_updated").on(t.userId, t.updatedAt),
  }),
);

export const tags = sqliteTable(
  "tags",
  {
    ...id,
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull(),
    description: text("description"),
    ...timestamps,
  },
  (t) => ({
    userNameIdx: uniqueIndex("idx_tags_user_name").on(t.userId, t.name),
  }),
);

export const contactTags = sqliteTable(
  "contact_tags",
  {
    contactId: integer("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull().default(nowIso),
  },
  (t) => ({
    pk: uniqueIndex("idx_contact_tags_unique").on(t.contactId, t.tagId),
    userTagIdx: index("idx_contact_tags_user_tag").on(t.userId, t.tagId),
  }),
);

export const conversations = sqliteTable(
  "conversations",
  {
    ...id,
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    contactId: integer("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    channel: text("channel", { enum: ["whatsapp", "instagram", "system"] }).notNull(),
    externalThreadId: text("external_thread_id").notNull(),
    title: text("title").notNull(),
    lastMessageAt: text("last_message_at"),
    lastPreview: text("last_preview"),
    unreadCount: integer("unread_count").notNull().default(0),
    isArchived: integer("is_archived", { mode: "boolean" }).notNull().default(false),
    temporaryMessagesUntil: text("temporary_messages_until"),
    profilePhotoMediaAssetId: integer("profile_photo_media_asset_id"),
    profilePhotoSha256: text("profile_photo_sha256"),
    profilePhotoUpdatedAt: text("profile_photo_updated_at"),
    ...timestamps,
  },
  (t) => ({
    userThreadIdx: uniqueIndex("idx_conversations_user_channel_thread").on(
      t.userId,
      t.channel,
      t.externalThreadId,
    ),
    userLastMessageIdx: index("idx_conversations_user_last_message").on(t.userId, t.lastMessageAt),
    userContactIdx: index("idx_conversations_user_contact").on(t.userId, t.contactId),
    userProfilePhotoIdx: index("idx_conversations_user_profile_photo").on(
      t.userId,
      t.profilePhotoMediaAssetId,
    ),
  }),
);

export const mediaAssets = sqliteTable(
  "media_assets",
  {
    ...id,
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type", { enum: ["image", "audio", "voice", "video", "document"] }).notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sha256: text("sha256").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    durationMs: integer("duration_ms"),
    storagePath: text("storage_path").notNull(),
    sourceUrl: text("source_url"),
    deletedAt: text("deleted_at"),
    ...timestamps,
  },
  (t) => ({
    userShaIdx: uniqueIndex("idx_media_assets_user_sha").on(t.userId, t.sha256),
    userTypeIdx: index("idx_media_assets_user_type").on(t.userId, t.type),
  }),
);

export const messages = sqliteTable(
  "messages",
  {
    ...id,
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    contactId: integer("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    externalId: text("external_id"),
    direction: text("direction", { enum: ["inbound", "outbound", "system"] }).notNull(),
    contentType: text("content_type", {
      enum: ["text", "image", "audio", "voice", "video", "document", "link", "sticker", "system"],
    }).notNull(),
    status: text("status", {
      enum: ["pending", "sent", "delivered", "read", "failed", "received"],
    })
      .notNull()
      .default("received"),
    body: text("body"),
    mediaAssetId: integer("media_asset_id").references(() => mediaAssets.id, {
      onDelete: "set null",
    }),
    media: text("media_json"),
    quotedMessageId: integer("quoted_message_id"),
    waDisplayedAt: text("wa_displayed_at"),
    timestampPrecision: text("timestamp_precision", {
      enum: ["second", "minute", "date", "unknown"],
    })
      .notNull()
      .default("unknown"),
    messageSecond: integer("message_second"),
    waInferredSecond: integer("wa_inferred_second"),
    observedAtUtc: text("observed_at_utc").notNull(),
    editedAt: text("edited_at"),
    deletedAt: text("deleted_at"),
    raw: text("raw_json"),
    ...timestamps,
  },
  (t) => ({
    externalUniqueIdx: uniqueIndex("idx_messages_conversation_external").on(
      t.conversationId,
      t.externalId,
    ),
    userConversationObservedIdx: index("idx_messages_user_conversation_observed").on(
      t.userId,
      t.conversationId,
      t.observedAtUtc,
    ),
    userStatusIdx: index("idx_messages_user_status").on(t.userId, t.status),
  }),
);

export const attachmentCandidates = sqliteTable(
  "attachment_candidates",
  {
    ...id,
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    messageId: integer("message_id").references(() => messages.id, { onDelete: "set null" }),
    mediaAssetId: integer("media_asset_id")
      .notNull()
      .references(() => mediaAssets.id, { onDelete: "cascade" }),
    channel: text("channel", { enum: ["whatsapp", "instagram", "system"] }).notNull(),
    contentType: text("content_type", {
      enum: ["image", "audio", "voice", "video", "document"],
    }).notNull(),
    externalMessageId: text("external_message_id"),
    caption: text("caption"),
    observedAt: text("observed_at").notNull(),
    metadata: text("metadata_json").notNull().default("{}"),
    ...timestamps,
  },
  (t) => ({
    userConversationObservedIdx: index("idx_attachment_candidates_user_conversation_observed").on(
      t.userId,
      t.conversationId,
      t.observedAt,
    ),
    userMediaIdx: index("idx_attachment_candidates_user_media").on(t.userId, t.mediaAssetId),
    uniqueVisibleCandidateIdx: uniqueIndex(
      "idx_attachment_candidates_user_conversation_external_media",
    ).on(t.userId, t.conversationId, t.externalMessageId, t.mediaAssetId),
  }),
);

export const campaigns = sqliteTable(
  "campaigns",
  {
    ...id,
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    status: text("status", {
      enum: ["draft", "scheduled", "running", "paused", "completed", "archived"],
    })
      .notNull()
      .default("draft"),
    channel: text("channel", { enum: ["whatsapp", "instagram", "system"] }).notNull(),
    segment: text("segment_json"),
    steps: text("steps_json").notNull(),
    evergreen: integer("evergreen", { mode: "boolean" }).notNull().default(false),
    startsAt: text("starts_at"),
    completedAt: text("completed_at"),
    metadata: text("metadata_json").notNull().default("{}"),
    ...timestamps,
  },
  (t) => ({
    userStatusIdx: index("idx_campaigns_user_status").on(t.userId, t.status),
    userChannelIdx: index("idx_campaigns_user_channel").on(t.userId, t.channel),
  }),
);

export const campaignRecipients = sqliteTable(
  "campaign_recipients",
  {
    ...id,
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    campaignId: integer("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    contactId: integer("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    phone: text("phone"),
    channel: text("channel", { enum: ["whatsapp", "instagram", "system"] }).notNull(),
    status: text("status", { enum: ["queued", "running", "completed", "failed", "skipped"] })
      .notNull()
      .default("queued"),
    currentStepId: text("current_step_id"),
    lastError: text("last_error"),
    metadata: text("metadata_json").notNull().default("{}"),
    ...timestamps,
  },
  (t) => ({
    userCampaignIdx: index("idx_campaign_recipients_user_campaign").on(t.userId, t.campaignId),
    userStatusIdx: index("idx_campaign_recipients_user_status").on(t.userId, t.status),
  }),
);

export const automations = sqliteTable(
  "automations",
  {
    ...id,
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    category: text("category").notNull(),
    status: text("status", { enum: ["draft", "active", "paused", "archived"] })
      .notNull()
      .default("draft"),
    trigger: text("trigger_json").notNull(),
    condition: text("condition_json").notNull(),
    actions: text("actions_json").notNull(),
    metadata: text("metadata_json").notNull().default("{}"),
    ...timestamps,
  },
  (t) => ({
    userStatusIdx: index("idx_automations_user_status").on(t.userId, t.status),
    userCategoryIdx: index("idx_automations_user_category").on(t.userId, t.category),
  }),
);

export const attendants = sqliteTable(
  "attendants",
  {
    ...id,
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    userAccountId: integer("user_account_id").references(() => users.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    email: text("email"),
    role: text("role", { enum: ["admin", "attendant", "viewer"] })
      .notNull()
      .default("attendant"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    ...timestamps,
  },
  (t) => ({
    userActiveIdx: index("idx_attendants_user_active").on(t.userId, t.isActive),
  }),
);

export const chatbots = sqliteTable(
  "chatbots",
  {
    ...id,
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    channel: text("channel", { enum: ["whatsapp", "instagram", "system"] }).notNull(),
    status: text("status", { enum: ["draft", "active", "paused", "archived"] })
      .notNull()
      .default("draft"),
    fallbackMessage: text("fallback_message"),
    metadata: text("metadata_json").notNull().default("{}"),
    ...timestamps,
  },
  (t) => ({
    userStatusIdx: index("idx_chatbots_user_status").on(t.userId, t.status),
  }),
);

export const chatbotRules = sqliteTable(
  "chatbot_rules",
  {
    ...id,
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    chatbotId: integer("chatbot_id")
      .notNull()
      .references(() => chatbots.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    priority: integer("priority").notNull().default(100),
    match: text("match_json").notNull(),
    segment: text("segment_json"),
    actions: text("actions_json").notNull(),
    metadata: text("metadata_json").notNull().default("{}"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    ...timestamps,
  },
  (t) => ({
    chatbotPriorityIdx: index("idx_chatbot_rules_chatbot_priority").on(t.chatbotId, t.priority),
    userActiveIdx: index("idx_chatbot_rules_user_active").on(t.userId, t.isActive),
  }),
);

export const chatbotVariantEvents = sqliteTable(
  "chatbot_variant_events",
  {
    ...id,
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    chatbotId: integer("chatbot_id")
      .notNull()
      .references(() => chatbots.id, { onDelete: "cascade" }),
    ruleId: integer("rule_id")
      .notNull()
      .references(() => chatbotRules.id, { onDelete: "cascade" }),
    variantId: text("variant_id").notNull(),
    variantLabel: text("variant_label"),
    eventType: text("event_type", { enum: ["exposure", "conversion"] }).notNull(),
    channel: text("channel", { enum: ["whatsapp", "instagram", "system"] }).notNull(),
    contactId: integer("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    conversationId: integer("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    messageId: integer("message_id").references(() => messages.id, { onDelete: "set null" }),
    exposureId: integer("exposure_id"),
    sourceEventId: text("source_event_id"),
    metadata: text("metadata_json").notNull().default("{}"),
    ...timestamps,
  },
  (t) => ({
    userChatbotRuleIdx: index("idx_chatbot_variant_events_rule").on(
      t.userId,
      t.chatbotId,
      t.ruleId,
    ),
    variantEventIdx: index("idx_chatbot_variant_events_variant_type").on(
      t.userId,
      t.ruleId,
      t.variantId,
      t.eventType,
    ),
    sourceEventIdx: uniqueIndex("idx_chatbot_variant_events_source").on(
      t.userId,
      t.sourceEventId,
    ),
  }),
);

export const jobs = sqliteTable(
  "jobs",
  {
    ...id,
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type", {
      enum: [
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
      ],
    }).notNull(),
    status: text("status", {
      enum: ["queued", "claimed", "running", "completed", "failed", "cancelled"],
    })
      .notNull()
      .default("queued"),
    payload: text("payload_json").notNull(),
    priority: integer("priority").notNull().default(5),
    dedupeKey: text("dedupe_key"),
    dedupeExpiresAt: text("dedupe_expires_at"),
    scheduledAt: text("scheduled_at").notNull(),
    claimedAt: text("claimed_at"),
    claimedBy: text("claimed_by"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    lastError: text("last_error"),
    completedAt: text("completed_at"),
    ...timestamps,
  },
  (t) => ({
    dueIdx: index("idx_jobs_due").on(t.status, t.priority, t.scheduledAt),
    userStatusIdx: index("idx_jobs_user_status").on(t.userId, t.status),
    dedupeIdx: uniqueIndex("idx_jobs_dedupe").on(t.dedupeKey),
  }),
);

export const jobsDead = sqliteTable(
  "jobs_dead",
  {
    ...id,
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    originalJobId: integer("original_job_id"),
    type: text("type").notNull(),
    payload: text("payload_json").notNull(),
    finalStatus: text("final_status").notNull(),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    failedAt: text("failed_at").notNull().default(nowIso),
    archivedAt: text("archived_at"),
    createdAt: text("created_at").notNull().default(nowIso),
  },
  (t) => ({
    userFailedIdx: index("idx_jobs_dead_user_failed").on(t.userId, t.failedAt),
    originalIdx: index("idx_jobs_dead_original").on(t.originalJobId),
  }),
);

export const workerState = sqliteTable(
  "worker_state",
  {
    workerId: text("worker_id").primaryKey(),
    status: text("status", { enum: ["starting", "idle", "busy", "stopping", "stopped", "error"] })
      .notNull()
      .default("starting"),
    heartbeatAt: text("heartbeat_at").notNull().default(nowIso),
    currentJobId: integer("current_job_id"),
    pid: integer("pid"),
    rssMb: integer("rss_mb"),
    browserConnected: integer("browser_connected", { mode: "boolean" }).notNull().default(false),
    lastError: text("last_error"),
    metrics: text("metrics_json").notNull().default("{}"),
    updatedAt: text("updated_at").notNull().default(nowIso),
  },
  (t) => ({
    heartbeatIdx: index("idx_worker_state_heartbeat").on(t.heartbeatAt),
  }),
);

export const schedulerLocks = sqliteTable(
  "scheduler_locks",
  {
    name: text("name").primaryKey(),
    ownerId: text("owner_id").notNull(),
    expiresAt: text("expires_at").notNull(),
    acquiredAt: text("acquired_at").notNull().default(nowIso),
    updatedAt: text("updated_at").notNull().default(nowIso),
  },
  (t) => ({
    expiresIdx: index("idx_scheduler_locks_expires").on(t.expiresAt),
  }),
);

export const reminders = sqliteTable(
  "reminders",
  {
    ...id,
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    contactId: integer("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    conversationId: integer("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    assignedToUserId: integer("assigned_to_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    notes: text("notes"),
    dueAt: text("due_at").notNull(),
    status: text("status", { enum: ["open", "done", "cancelled"] })
      .notNull()
      .default("open"),
    completedAt: text("completed_at"),
    ...timestamps,
  },
  (t) => ({
    userStatusDueIdx: index("idx_reminders_user_status_due").on(t.userId, t.status, t.dueAt),
  }),
);

export const quickReplies = sqliteTable(
  "quick_replies",
  {
    ...id,
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body").notNull(),
    shortcut: text("shortcut"),
    category: text("category"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    usageCount: integer("usage_count").notNull().default(0),
    lastUsedAt: text("last_used_at"),
    deletedAt: text("deleted_at"),
    ...timestamps,
  },
  (t) => ({
    userActiveSortIdx: index("idx_quick_replies_user_active_sort").on(
      t.userId,
      t.isActive,
      t.sortOrder,
    ),
    userCategoryIdx: index("idx_quick_replies_user_category").on(t.userId, t.category),
    userShortcutIdx: uniqueIndex("idx_quick_replies_user_shortcut").on(t.userId, t.shortcut),
  }),
);

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    ...id,
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    actorUserId: integer("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetTable: text("target_table").notNull(),
    targetId: integer("target_id"),
    before: text("before_json"),
    after: text("after_json"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: text("created_at").notNull().default(nowIso),
  },
  (t) => ({
    targetIdx: index("idx_audit_logs_target").on(t.targetTable, t.targetId),
    userCreatedIdx: index("idx_audit_logs_user_created").on(t.userId, t.createdAt),
  }),
);

export const systemEvents = sqliteTable(
  "system_events",
  {
    ...id,
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    type: text("type").notNull(),
    severity: text("severity", { enum: ["debug", "info", "warn", "error"] })
      .notNull()
      .default("info"),
    payload: text("payload_json").notNull().default("{}"),
    createdAt: text("created_at").notNull().default(nowIso),
  },
  (t) => ({
    typeCreatedIdx: index("idx_system_events_type_created").on(t.type, t.createdAt),
  }),
);

export const pushSubscriptions = sqliteTable(
  "push_subscriptions",
  {
    ...id,
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    createdAt: text("created_at").notNull().default(nowIso),
    updatedAt: text("updated_at").notNull().default(nowIso),
  },
  (t) => ({
    endpointIdx: uniqueIndex("idx_push_subscriptions_endpoint").on(t.endpoint),
    userIdx: index("idx_push_subscriptions_user").on(t.userId),
  }),
);

export const refreshSessions = sqliteTable(
  "refresh_sessions",
  {
    ...id,
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: text("expires_at").notNull(),
    revokedAt: text("revoked_at"),
    replacedByTokenHash: text("replaced_by_token_hash"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: text("created_at").notNull().default(nowIso),
    updatedAt: text("updated_at").notNull().default(nowIso),
  },
  (t) => ({
    tokenHashIdx: uniqueIndex("idx_refresh_sessions_token_hash").on(t.tokenHash),
    userActiveIdx: index("idx_refresh_sessions_user_active").on(t.userId, t.revokedAt),
  }),
);

export const passwordResetTokens = sqliteTable(
  "password_reset_tokens",
  {
    ...id,
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: text("expires_at").notNull(),
    usedAt: text("used_at"),
    createdAt: text("created_at").notNull().default(nowIso),
  },
  (t) => ({
    tokenHashIdx: uniqueIndex("idx_password_reset_tokens_token_hash").on(t.tokenHash),
  }),
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;
export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type AttachmentCandidate = typeof attachmentCandidates.$inferSelect;
export type NewAttachmentCandidate = typeof attachmentCandidates.$inferInsert;
export type ChatbotVariantEvent = typeof chatbotVariantEvents.$inferSelect;
export type NewChatbotVariantEvent = typeof chatbotVariantEvents.$inferInsert;
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type JobDead = typeof jobsDead.$inferSelect;
export type NewJobDead = typeof jobsDead.$inferInsert;
export type QuickReply = typeof quickReplies.$inferSelect;
export type NewQuickReply = typeof quickReplies.$inferInsert;
