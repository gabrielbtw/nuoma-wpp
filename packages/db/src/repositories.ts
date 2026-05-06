import { and, asc, desc, eq, gt, gte, inArray, isNull, like, lte, or, sql } from "drizzle-orm";

import {
  attendantSchema,
  attachmentCandidateSchema,
  automationSchema,
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
  messageSchema,
  quickReplySchema,
  reminderSchema,
  tagSchema,
  userSchema,
  workerStateSchema,
  type Attendant,
  type AttachmentCandidate,
  type Automation,
  type Campaign,
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
  messages,
  passwordResetTokens,
  pushSubscriptions,
  quickReplies,
  refreshSessions,
  reminders,
  schedulerLocks,
  systemEvents,
  tags,
  users,
  workerState,
  type NewContact,
  type NewConversation,
  type NewAttachmentCandidate,
  type NewChatbotVariantEvent,
  type NewJob,
  type NewJobDead,
  type NewMessage,
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
type ContactRow = typeof contacts.$inferSelect;

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
    tagIds,
  });
}

function mapConversation(row: typeof conversations.$inferSelect): Conversation {
  return conversationSchema.parse(row);
}

function isDisplayableConversation(conversation: Conversation): boolean {
  const title = conversation.title.trim().toLowerCase();
  const externalThreadId = conversation.externalThreadId.trim().toLowerCase();
  const hasWhatsappIdentity =
    conversation.channel !== "whatsapp" ||
    conversation.contactId !== null ||
    normalizeConversationPhone(conversation.externalThreadId) !== null ||
    normalizeConversationPhone(conversation.title) !== null;
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
  const digits = value?.replace(/\D/g, "") ?? "";
  return digits.length >= 10 && digits.length <= 13 ? digits : null;
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

function mapCampaign(row: typeof campaigns.$inferSelect): Campaign {
  return campaignSchema.parse({
    ...row,
    segment: decodeNullableJsonObject(row.segment),
    steps: decodeArray(row.steps),
    metadata: decodeJsonObject(row.metadata),
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

function mapChatbotVariantEvent(row: typeof chatbotVariantEvents.$inferSelect): ChatbotVariantEvent {
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

function mapReminder(row: typeof reminders.$inferSelect): Reminder {
  return reminderSchema.parse(row);
}

function mapQuickReply(row: typeof quickReplies.$inferSelect): QuickReply {
  return quickReplySchema.parse(row);
}

function nowIso(): string {
  return new Date().toISOString();
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
    return rows[0] ? mapJob(rows[0]) : null;
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
          .where(and(eq(contacts.userId, input.userId), eq(contacts.phone, input.phone)))
          .get();
        return row ? mapContact(row, await tagIdsForContact(row.id)) : null;
      },

      async findByIdentity(input: {
        userId: number;
        phone?: string | null;
        email?: string | null;
        instagramHandle?: string | null;
      }): Promise<Contact | null> {
        const identityClauses = [
          input.phone ? eq(contacts.phone, input.phone) : undefined,
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
            | "primaryChannel"
            | "profilePhotoMediaAssetId"
            | "profilePhotoSha256"
            | "profilePhotoUpdatedAt"
            | "status"
          >
        > & { tagIds?: number[] },
      ): Promise<Contact | null> {
        const { id, userId, tagIds, ...patch } = input;
        const [row] = await db
          .update(contacts)
          .set({ ...patch, updatedAt: nowIso() })
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
        const [row] = await db.insert(conversations).values(input).returning();
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

        handle.raw
          .prepare(
            `INSERT INTO conversations (
               user_id,
               contact_id,
               channel,
               external_thread_id,
               title,
               last_message_at,
               last_preview,
               unread_count,
               profile_photo_media_asset_id,
               profile_photo_sha256,
               profile_photo_updated_at,
               updated_at
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(user_id, channel, external_thread_id) DO UPDATE SET
               contact_id = COALESCE(excluded.contact_id, contact_id),
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
            input.title || input.externalThreadId,
            input.lastMessageAt ?? null,
            input.lastPreview ?? null,
            input.unreadCount ?? 0,
            input.profilePhotoMediaAssetId ?? null,
            input.profilePhotoSha256 ?? null,
            input.profilePhotoUpdatedAt ?? null,
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
      async findActiveByTitle(input: {
        userId: number;
        channel: "whatsapp" | "instagram" | "system";
        title: string;
      }): Promise<Conversation | null> {
        const row = await db
          .select()
          .from(conversations)
          .where(
            and(
              eq(conversations.userId, input.userId),
              eq(conversations.channel, input.channel),
              eq(conversations.title, input.title),
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
        if (input.contactId !== undefined) patch.contactId = input.contactId;
        if (input.lastMessageAt !== undefined) patch.lastMessageAt = input.lastMessageAt;
        if (input.lastPreview !== undefined) patch.lastPreview = input.lastPreview;
        if (input.profilePhotoMediaAssetId !== undefined) {
          patch.profilePhotoMediaAssetId = input.profilePhotoMediaAssetId;
        }
        if (input.profilePhotoSha256 !== undefined)
          patch.profilePhotoSha256 = input.profilePhotoSha256;
        if (input.profilePhotoUpdatedAt !== undefined) {
          patch.profilePhotoUpdatedAt = input.profilePhotoUpdatedAt;
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
        if (input.title !== undefined) patch.title = input.title;
        if (input.lastMessageAt !== undefined) patch.lastMessageAt = input.lastMessageAt;
        if (input.lastPreview !== undefined) patch.lastPreview = input.lastPreview;
        if (input.unreadCount !== undefined) patch.unreadCount = input.unreadCount;
        if (input.isArchived !== undefined) patch.isArchived = input.isArchived;
        if (input.temporaryMessagesUntil !== undefined) {
          patch.temporaryMessagesUntil = input.temporaryMessagesUntil;
        }
        if (input.profilePhotoMediaAssetId !== undefined) {
          patch.profilePhotoMediaAssetId = input.profilePhotoMediaAssetId;
        }
        if (input.profilePhotoSha256 !== undefined)
          patch.profilePhotoSha256 = input.profilePhotoSha256;
        if (input.profilePhotoUpdatedAt !== undefined) {
          patch.profilePhotoUpdatedAt = input.profilePhotoUpdatedAt;
        }

        const [row] = await db
          .update(conversations)
          .set(patch)
          .where(and(eq(conversations.userId, input.userId), eq(conversations.id, input.id)))
          .returning();
        return row ? mapConversation(row) : null;
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
        const rows = await db.select().from(campaigns).where(eq(campaigns.userId, userId));
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
        const [row] = await db
          .insert(campaignRecipients)
          .values({ ...input, metadata: encodeJson(input.metadata) })
          .returning();
        return mapCampaignRecipient(expectRow(row, "campaignRecipients.create"));
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
          const rows = handle.raw
            .prepare(
              `SELECT id FROM jobs
               WHERE status = 'queued' AND scheduled_at <= ?
               ${typeFilter}
               ORDER BY priority ASC, scheduled_at ASC, id ASC
               LIMIT ?`,
            )
            .all(...[now, ...excludeTypes, limit]) as Array<{ id: number }>;

          const update = handle.raw.prepare(
            `UPDATE jobs
             SET status = 'claimed',
                 claimed_at = ?,
                 claimed_by = ?,
                 attempts = attempts + 1,
                 updated_at = ?
             WHERE id = ? AND status = 'queued'`,
          );

          for (const row of rows) {
            update.run(claimedAt, input.workerId, claimedAt, row.id);
          }

          return rows.map((row) => row.id);
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

      async markCompleted(jobId: number): Promise<void> {
        await db
          .update(jobs)
          .set({
            status: "completed",
            completedAt: nowIso(),
            updatedAt: nowIso(),
          })
          .where(eq(jobs.id, jobId));
      },

      async releaseForRetry(input: {
        jobId: number;
        error: string;
        scheduledAt: string;
      }): Promise<void> {
        await db
          .update(jobs)
          .set({
            status: "queued",
            claimedAt: null,
            claimedBy: null,
            scheduledAt: input.scheduledAt,
            lastError: input.error,
            updatedAt: nowIso(),
          })
          .where(eq(jobs.id, input.jobId));
      },

      async moveToDead(input: { jobId: number; error: string }): Promise<void> {
        const job = await db.select().from(jobs).where(eq(jobs.id, input.jobId)).get();
        if (!job) {
          return;
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
        await db
          .update(jobs)
          .set({
            status: "failed",
            lastError: input.error,
            completedAt: nowIso(),
            updatedAt: nowIso(),
          })
          .where(eq(jobs.id, job.id));
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
