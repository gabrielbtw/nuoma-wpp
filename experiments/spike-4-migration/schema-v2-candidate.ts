import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("admin"),
  displayName: text("display_name").notNull(),
  createdAt: text("created_at").notNull()
});

export const contacts = sqliteTable(
  "contacts",
  {
    id: text("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    phone: text("phone"),
    cpf: text("cpf"),
    email: text("email"),
    instagram: text("instagram"),
    procedureStatus: text("procedure_status").notNull().default("unknown"),
    lastAttendant: text("last_attendant"),
    notes: text("notes"),
    status: text("status").notNull().default("novo"),
    lastInteractionAt: text("last_interaction_at"),
    lastOutgoingAt: text("last_outgoing_at"),
    lastIncomingAt: text("last_incoming_at"),
    lastAutomationAt: text("last_automation_at"),
    lastProcedureAt: text("last_procedure_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at")
  },
  (table) => [
    index("idx_v2_contacts_user_status").on(table.userId, table.status),
    uniqueIndex("idx_v2_contacts_user_phone").on(table.userId, table.phone)
  ]
);

export const tags = sqliteTable(
  "tags",
  {
    id: text("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    color: text("color").notNull().default("#3ddc97"),
    type: text("type").notNull().default("manual"),
    active: integer("active").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [uniqueIndex("idx_v2_tags_user_normalized").on(table.userId, table.normalizedName)]
);

export const contactTags = sqliteTable(
  "contact_tags",
  {
    contactId: text("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
    tagId: text("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull()
  },
  (table) => [primaryKey({ columns: [table.contactId, table.tagId] })]
);

export const conversations = sqliteTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    channel: text("channel").notNull().default("whatsapp"),
    externalThreadId: text("external_thread_id").notNull(),
    waChatId: text("wa_chat_id"),
    title: text("title").notNull(),
    unreadCount: integer("unread_count").notNull().default(0),
    lastMessagePreview: text("last_message_preview").notNull().default(""),
    lastMessageAt: text("last_message_at"),
    lastMessageDirection: text("last_message_direction"),
    status: text("status").notNull().default("open"),
    assignedTo: text("assigned_to"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [
    uniqueIndex("idx_v2_conversations_user_channel_thread").on(table.userId, table.channel, table.externalThreadId),
    index("idx_v2_conversations_last_message").on(table.userId, table.lastMessageAt)
  ]
);

export const mediaAssets = sqliteTable("media_assets", {
  id: text("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  sha256: text("sha256").notNull(),
  originalName: text("original_name").notNull(),
  safeName: text("safe_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  category: text("category").notNull(),
  linkedCampaignId: text("linked_campaign_id"),
  linkedAutomationId: text("linked_automation_id"),
  storagePath: text("storage_path").notNull(),
  createdAt: text("created_at").notNull()
});

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    mediaAssetId: text("media_asset_id").references(() => mediaAssets.id, { onDelete: "set null" }),
    externalId: text("external_id"),
    direction: text("direction").notNull(),
    contentType: text("content_type").notNull(),
    body: text("body").notNull().default(""),
    status: text("status").notNull().default("sent"),
    sentAt: text("sent_at"),
    timestampPrecision: text("timestamp_precision").notNull().default("minute"),
    observedAtUtc: text("observed_at_utc"),
    waInferredSecond: integer("wa_inferred_second"),
    metaJson: text("meta_json").notNull().default("{}"),
    createdAt: text("created_at").notNull()
  },
  (table) => [
    uniqueIndex("idx_v2_messages_conversation_external").on(table.conversationId, table.externalId),
    index("idx_v2_messages_conversation_created").on(table.conversationId, table.createdAt)
  ]
);

export const automations = sqliteTable("automations", {
  id: text("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  category: text("category").notNull(),
  enabled: integer("enabled").notNull().default(1),
  description: text("description").notNull().default(""),
  triggerJson: text("trigger_json").notNull().default("{}"),
  requiredTagsJson: text("required_tags_json").notNull().default("[]"),
  excludedTagsJson: text("excluded_tags_json").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const automationActions = sqliteTable("automation_actions", {
  id: text("id").primaryKey(),
  automationId: text("automation_id").notNull().references(() => automations.id, { onDelete: "cascade" }),
  sortOrder: integer("sort_order").notNull(),
  type: text("type").notNull(),
  content: text("content").notNull().default(""),
  mediaAssetId: text("media_asset_id").references(() => mediaAssets.id, { onDelete: "set null" }),
  waitSeconds: integer("wait_seconds"),
  tagName: text("tag_name"),
  reminderText: text("reminder_text"),
  metadataJson: text("metadata_json").notNull().default("{}"),
  createdAt: text("created_at").notNull()
});

export const automationContactState = sqliteTable(
  "automation_contact_state",
  {
    automationId: text("automation_id").notNull().references(() => automations.id, { onDelete: "cascade" }),
    contactId: text("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
    lastSentAt: text("last_sent_at"),
    lastJobId: text("last_job_id"),
    lastTriggeredAt: text("last_triggered_at"),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [primaryKey({ columns: [table.automationId, table.contactId] })]
);

export const campaigns = sqliteTable("campaigns", {
  id: text("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  status: text("status").notNull().default("draft"),
  csvPath: text("csv_path"),
  sendWindowStart: text("send_window_start").notNull().default("08:00"),
  sendWindowEnd: text("send_window_end").notNull().default("20:00"),
  totalRecipients: integer("total_recipients").notNull().default(0),
  processedRecipients: integer("processed_recipients").notNull().default(0),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const campaignSteps = sqliteTable("campaign_steps", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  sortOrder: integer("sort_order").notNull(),
  type: text("type").notNull(),
  content: text("content").notNull().default(""),
  mediaAssetId: text("media_asset_id").references(() => mediaAssets.id, { onDelete: "set null" }),
  waitMinutes: integer("wait_minutes"),
  caption: text("caption").notNull().default(""),
  metadataJson: text("metadata_json").notNull().default("{}"),
  createdAt: text("created_at").notNull()
});

export const campaignRecipients = sqliteTable("campaign_recipients", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  phone: text("phone").notNull(),
  name: text("name").notNull().default(""),
  extraJson: text("extra_json").notNull().default("{}"),
  status: text("status").notNull().default("pending"),
  stepIndex: integer("step_index").notNull().default(0),
  nextRunAt: text("next_run_at").notNull(),
  lastAttemptAt: text("last_attempt_at"),
  lastError: text("last_error"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    status: text("status").notNull().default("pending"),
    priority: integer("priority").notNull().default(5),
    dedupeKey: text("dedupe_key"),
    dedupeExpiresAt: text("dedupe_expires_at"),
    payloadJson: text("payload_json").notNull().default("{}"),
    scheduledAt: text("scheduled_at").notNull(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    lockedAt: text("locked_at"),
    lockedBy: text("locked_by"),
    errorMessage: text("error_message"),
    errorJson: text("error_json"),
    finishedAt: text("finished_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [
    index("idx_v2_jobs_due").on(table.status, table.scheduledAt),
    index("idx_v2_jobs_dedupe").on(table.dedupeKey, table.status)
  ]
);

export const auditLogs = sqliteTable("audit_logs", {
  id: text("id").primaryKey(),
  actorUserId: integer("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  action: text("action").notNull(),
  beforeJson: text("before_json"),
  afterJson: text("after_json"),
  createdAt: text("created_at").notNull()
});

export const chatbots = sqliteTable("chatbots", {
  id: text("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  enabled: integer("enabled").notNull().default(1),
  configJson: text("config_json").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const chatbotRules = sqliteTable("chatbot_rules", {
  id: text("id").primaryKey(),
  chatbotId: text("chatbot_id").notNull().references(() => chatbots.id, { onDelete: "cascade" }),
  sortOrder: integer("sort_order").notNull(),
  triggerJson: text("trigger_json").notNull().default("{}"),
  responseJson: text("response_json").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const operationalV2Tables = {
  users,
  contacts,
  tags,
  contactTags,
  conversations,
  mediaAssets,
  messages,
  automations,
  automationActions,
  automationContactState,
  campaigns,
  campaignSteps,
  campaignRecipients,
  jobs,
  auditLogs,
  chatbots,
  chatbotRules
};
