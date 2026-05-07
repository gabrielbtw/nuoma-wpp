import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  channelTypeSchema,
  createConversationInputSchema,
  updateConversationInputSchema,
  type ChannelType,
  type Contact,
  type Conversation,
} from "@nuoma/contracts";

import {
  adminCsrfProcedure,
  adminProcedure,
  protectedCsrfProcedure,
  protectedProcedure,
  router,
} from "../init.js";

const createConversationBodySchema = createConversationInputSchema.omit({ userId: true });
const updateConversationBodySchema = updateConversationInputSchema.omit({ userId: true });
const listUnifiedInputSchema = z
  .object({
    limit: z.number().int().min(1).max(500).default(100),
    channel: z.union([channelTypeSchema, z.literal("all")]).default("all"),
    search: z.string().trim().min(1).max(120).optional(),
  })
  .optional();

type UnifiedConversation = Conversation & {
  contact: Pick<Contact, "id" | "instagramHandle" | "name" | "phone" | "primaryChannel" | "status"> | null;
  target: {
    kind: "instagram" | "phone" | "system" | "thread";
    identity: string;
    label: string;
  };
};

export const conversationsRouter = router({
  list: adminProcedure
    .input(
      z.object({ limit: z.number().int().min(1).max(500).optional() }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const conversations = await ctx.repos.conversations.list(
        ctx.user.id,
        input?.limit ?? 100,
      );
      return { conversations };
    }),

  listUnified: protectedProcedure.input(listUnifiedInputSchema).query(async ({ ctx, input }) => {
    const limit = input?.limit ?? 100;
    const channel = input?.channel ?? "all";
    const search = input?.search?.trim() ?? null;
    const [conversations, contacts] = await Promise.all([
      ctx.repos.conversations.list(ctx.user.id, 500),
      ctx.repos.contacts.list({ userId: ctx.user.id, limit: 2_000 }),
    ]);
    const contactsById = new Map(contacts.map((contact) => [contact.id, contact]));

    const filtered = conversations
      .filter((conversation) => channel === "all" || conversation.channel === channel)
      .map<UnifiedConversation>((conversation) => {
        const contact =
          conversation.contactId == null ? null : contactsById.get(conversation.contactId) ?? null;
        return {
          ...conversation,
          contact: contact
            ? {
                id: contact.id,
                instagramHandle: contact.instagramHandle,
                name: contact.name,
                phone: contact.phone,
                primaryChannel: contact.primaryChannel,
                status: contact.status,
              }
            : null,
          target: buildUnifiedTarget(conversation, contact),
        };
      })
      .filter((conversation) => !search || matchesUnifiedSearch(conversation, search));

    const channels = countChannels(filtered);
    return {
      conversations: filtered.slice(0, limit),
      summary: {
        total: filtered.length,
        returned: Math.min(filtered.length, limit),
        channels,
        filters: {
          channel,
          search,
        },
      },
    };
  }),

  get: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const conversation = await ctx.repos.conversations.findById({
        userId: ctx.user.id,
        id: input.id,
      });
      if (!conversation) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }
      return { conversation };
    }),

  create: protectedCsrfProcedure
    .input(createConversationBodySchema)
    .mutation(async ({ ctx, input }) => {
      const conversation = await ctx.repos.conversations.create({
        userId: ctx.user.id,
        contactId: input.contactId ?? null,
        channel: input.channel,
        externalThreadId: input.externalThreadId,
        title: input.title,
      });
      return { conversation };
    }),

  update: protectedCsrfProcedure
    .input(updateConversationBodySchema)
    .mutation(async ({ ctx, input }) => {
      const conversation = await ctx.repos.conversations.update({
        ...input,
        userId: ctx.user.id,
      });
      return { conversation };
    }),

  softDelete: protectedCsrfProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const conversation = await ctx.repos.conversations.update({
        userId: ctx.user.id,
        id: input.id,
        isArchived: true,
      });
      return { conversation, ok: Boolean(conversation) };
    }),

  restore: protectedCsrfProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const conversation = await ctx.repos.conversations.update({
        userId: ctx.user.id,
        id: input.id,
        isArchived: false,
      });
      return { conversation, ok: Boolean(conversation) };
    }),

  forceSync: adminCsrfProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        phone: z.string().min(8).optional(),
        scheduledAt: z.string().datetime({ offset: true }).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const conversation = await ctx.repos.conversations.findById({
        userId: ctx.user.id,
        id: input.id,
      });
      if (!conversation) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }

      const job = await ctx.repos.jobs.create({
        userId: ctx.user.id,
        type: "sync_conversation",
        status: "queued",
        payload: {
          conversationId: conversation.id,
          phone: input.phone ?? null,
          source: "admin.force_conversation",
        },
        priority: 1,
        scheduledAt: input.scheduledAt ?? new Date().toISOString(),
        maxAttempts: 2,
      });

      await ctx.repos.auditLogs.create({
        userId: ctx.user.id,
        actorUserId: ctx.user.id,
        action: "sync.force_conversation",
        targetTable: "conversations",
        targetId: conversation.id,
        ipAddress: ctx.req.ip,
        userAgent: ctx.req.headers["user-agent"] ?? null,
      });
      return { job, conversation };
    }),

  forceHistorySync: adminCsrfProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        phone: z.string().min(8).optional(),
        maxScrolls: z.number().int().min(1).max(25).default(3),
        delayMs: z.number().int().min(250).max(10_000).default(1_200),
        scheduledAt: z.string().datetime({ offset: true }).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const conversation = await ctx.repos.conversations.findById({
        userId: ctx.user.id,
        id: input.id,
      });
      if (!conversation) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }

      const job = await ctx.repos.jobs.create({
        userId: ctx.user.id,
        type: "sync_history",
        status: "queued",
        payload: {
          conversationId: conversation.id,
          phone: input.phone ?? null,
          maxScrolls: input.maxScrolls,
          delayMs: input.delayMs,
          source: "admin.force_history",
        },
        priority: 1,
        scheduledAt: input.scheduledAt ?? new Date().toISOString(),
        maxAttempts: 2,
      });

      await ctx.repos.auditLogs.create({
        userId: ctx.user.id,
        actorUserId: ctx.user.id,
        action: "sync.force_history",
        targetTable: "conversations",
        targetId: conversation.id,
        ipAddress: ctx.req.ip,
        userAgent: ctx.req.headers["user-agent"] ?? null,
      });
      return { job, conversation };
    }),
});

function buildUnifiedTarget(
  conversation: Conversation,
  contact: Contact | null | undefined,
): UnifiedConversation["target"] {
  if (conversation.channel === "instagram") {
    const handle = contact?.instagramHandle ?? stripInstagramPrefix(conversation.externalThreadId);
    return {
      kind: "instagram",
      identity: handle ? `@${handle}` : conversation.externalThreadId,
      label: contact?.name ?? conversation.title,
    };
  }
  if (conversation.channel === "whatsapp") {
    return {
      kind: "phone",
      identity: contact?.phone ?? conversation.externalThreadId,
      label: contact?.name ?? conversation.title,
    };
  }
  if (conversation.channel === "system") {
    return {
      kind: "system",
      identity: conversation.externalThreadId,
      label: conversation.title,
    };
  }
  return {
    kind: "thread",
    identity: conversation.externalThreadId,
    label: conversation.title,
  };
}

function matchesUnifiedSearch(conversation: UnifiedConversation, search: string): boolean {
  const normalizedSearch = normalizeSearch(search);
  const digitSearch = search.replace(/\D/g, "");
  const fields = [
    conversation.title,
    conversation.externalThreadId,
    conversation.channel,
    conversation.lastPreview ?? "",
    conversation.target.identity,
    conversation.target.label,
    conversation.contact?.name ?? "",
    conversation.contact?.phone ?? "",
    conversation.contact?.instagramHandle ? `@${conversation.contact.instagramHandle}` : "",
    conversation.contact?.instagramHandle ?? "",
    conversation.contact?.primaryChannel ?? "",
    conversation.contact?.status ?? "",
  ];
  return fields.some((field) => {
    const normalizedField = normalizeSearch(field);
    if (normalizedField.includes(normalizedSearch)) return true;
    return digitSearch.length > 0 && field.replace(/\D/g, "").includes(digitSearch);
  });
}

function countChannels(conversations: UnifiedConversation[]): Record<ChannelType, number> {
  const channels: Record<ChannelType, number> = {
    instagram: 0,
    system: 0,
    whatsapp: 0,
  };
  for (const conversation of conversations) {
    channels[conversation.channel] += 1;
  }
  return channels;
}

function normalizeSearch(value: string): string {
  return value
    .trim()
    .replace(/^@/, "")
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function stripInstagramPrefix(value: string): string {
  return value.trim().replace(/^ig:/i, "").replace(/^@/, "");
}
