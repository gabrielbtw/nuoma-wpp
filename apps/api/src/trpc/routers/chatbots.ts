import { z } from "zod";

import {
  createChatbotInputSchema,
  createChatbotRuleInputSchema,
  listChatbotsFilterSchema,
  listChatbotRulesFilterSchema,
  updateChatbotInputSchema,
  updateChatbotRuleInputSchema,
  type AutomationAction,
  type ChatbotRuleAbTestVariant,
  type ChatbotRule,
} from "@nuoma/contracts";
import type { Repositories } from "@nuoma/db";

import { protectedCsrfProcedure, protectedProcedure, router } from "../init.js";

const createChatbotBodySchema = createChatbotInputSchema.omit({ userId: true });
const createChatbotRuleBodySchema = createChatbotRuleInputSchema.omit({ userId: true });
const listChatbotsBodySchema = listChatbotsFilterSchema.omit({ userId: true }).optional();
const updateChatbotBodySchema = updateChatbotInputSchema.omit({ userId: true });
const listChatbotRulesBodySchema = listChatbotRulesFilterSchema.omit({ userId: true });
const updateChatbotRuleBodySchema = updateChatbotRuleInputSchema.omit({ userId: true });
const chatbotVariantEventBodySchema = z.object({
  chatbotId: z.number().int().positive(),
  ruleId: z.number().int().positive(),
  variantId: z.string().min(1).max(64),
  eventType: z.enum(["exposure", "conversion"]),
  channel: z.enum(["whatsapp", "instagram", "system"]).default("whatsapp"),
  contactId: z.number().int().positive().nullable().optional(),
  conversationId: z.number().int().positive().nullable().optional(),
  messageId: z.number().int().positive().nullable().optional(),
  exposureId: z.number().int().positive().nullable().optional(),
  sourceEventId: z.string().min(1).max(160).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
const listVariantEventsBodySchema = z.object({
  chatbotId: z.number().int().positive().optional(),
  ruleId: z.number().int().positive().optional(),
  eventType: z.enum(["exposure", "conversion"]).optional(),
  cursor: z.number().int().positive().optional(),
  limit: z.number().int().min(1).max(200).default(100),
});
const chatbotMessageEvaluationBodySchema = z.object({
  chatbotId: z.number().int().positive().optional(),
  channel: z.enum(["whatsapp", "instagram", "system"]).default("whatsapp"),
  phone: z.string().min(3).optional(),
  body: z.string().min(1),
  contactId: z.number().int().positive().nullable().optional(),
  conversationId: z.number().int().positive().nullable().optional(),
  messageId: z.number().int().positive().nullable().optional(),
  sourceEventId: z.string().min(1).max(160).nullable().optional(),
});
const chatbotExecutionHistoryBodySchema = z.object({
  chatbotId: z.number().int().positive().optional(),
  ruleId: z.number().int().positive().optional(),
  conversationId: z.number().int().positive().optional(),
  messageId: z.number().int().positive().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

function bodyMatchesRule(rule: ChatbotRule, body: string): boolean {
  const value = rule.match.value ?? "";
  const normalizedBody = body.trim().toLowerCase();
  const normalizedValue = value.trim().toLowerCase();

  if (rule.match.type === "fallback") return false;
  if (!normalizedValue) return false;
  if (rule.match.type === "contains") return normalizedBody.includes(normalizedValue);
  if (rule.match.type === "equals") return normalizedBody === normalizedValue;
  if (rule.match.type === "starts_with") return normalizedBody.startsWith(normalizedValue);
  if (rule.match.type === "regex") {
    try {
      return new RegExp(value, "i").test(body);
    } catch {
      return false;
    }
  }
  return false;
}

function selectAbTestVariant(
  rule: ChatbotRule,
  input: { body: string; phone?: string },
): ChatbotRuleAbTestVariant | null {
  const abTest = rule.metadata.abTest;
  if (!abTest?.enabled || abTest.variants.length < 2) {
    return null;
  }
  const totalWeight = abTest.variants.reduce((sum, variant) => sum + variant.weight, 0);
  if (totalWeight <= 0) {
    return abTest.variants[0] ?? null;
  }
  const bucket = stableHash(`${rule.id}:${input.phone ?? ""}:${input.body}`) % totalWeight;
  let cursor = 0;
  for (const variant of abTest.variants) {
    cursor += variant.weight;
    if (bucket < cursor) {
      return variant;
    }
  }
  return abTest.variants[abTest.variants.length - 1] ?? null;
}

function summarizeAbTest(
  rule: ChatbotRule,
  input: { body: string; phone?: string },
): {
  enabled: true;
  assignment: "deterministic";
  selectedVariantId: string | null;
  selectedVariantLabel: string | null;
  variants: Array<{
    id: string;
    label: string;
    weight: number;
    actionsCount: number;
  }>;
} | null {
  const abTest = rule.metadata.abTest;
  if (!abTest?.enabled) {
    return null;
  }
  const selectedVariant = selectAbTestVariant(rule, input);
  return {
    enabled: true,
    assignment: abTest.assignment,
    selectedVariantId: selectedVariant?.id ?? null,
    selectedVariantLabel: selectedVariant?.label ?? null,
    variants: abTest.variants.map((variant) => ({
      id: variant.id,
      label: variant.label,
      weight: variant.weight,
      actionsCount: variant.actions.length,
    })),
  };
}

function resolveRuleActions(
  rule: ChatbotRule,
  input: { body: string; phone?: string },
): AutomationAction[] {
  return selectAbTestVariant(rule, input)?.actions ?? rule.actions;
}

function findAbTestVariant(rule: ChatbotRule, variantId: string): ChatbotRuleAbTestVariant | null {
  return rule.metadata.abTest?.variants.find((variant) => variant.id === variantId) ?? null;
}

function stableHash(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

export const chatbotsRouter = router({
  list: protectedProcedure.input(listChatbotsBodySchema).query(async ({ ctx, input }) => {
    const chatbots = await ctx.repos.chatbots.list({
      userId: ctx.user.id,
      cursor: input?.cursor ? Number(input.cursor) : undefined,
      limit: input?.limit,
      channel: input?.channel,
      status: input?.status,
    });
    return { chatbots };
  }),

  get: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const chatbot = await ctx.repos.chatbots.findById({
        id: input.id,
        userId: ctx.user.id,
      });
      return { chatbot };
    }),

  create: protectedCsrfProcedure.input(createChatbotBodySchema).mutation(async ({ ctx, input }) => {
    const chatbot = await ctx.repos.chatbots.create({
      userId: ctx.user.id,
      name: input.name,
      channel: input.channel,
      status: "draft",
      fallbackMessage: input.fallbackMessage ?? null,
      metadata: input.metadata,
    });
    return { chatbot };
  }),

  update: protectedCsrfProcedure.input(updateChatbotBodySchema).mutation(async ({ ctx, input }) => {
    const chatbot = await ctx.repos.chatbots.update({
      ...input,
      userId: ctx.user.id,
    });
    return { chatbot };
  }),

  softDelete: protectedCsrfProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const chatbot = await ctx.repos.chatbots.update({
        id: input.id,
        userId: ctx.user.id,
        status: "archived",
      });
      return { chatbot, ok: Boolean(chatbot) };
    }),

  restore: protectedCsrfProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        status: z.enum(["draft", "paused", "active"]).default("draft"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const chatbot = await ctx.repos.chatbots.update({
        id: input.id,
        userId: ctx.user.id,
        status: input.status,
      });
      return { chatbot, ok: Boolean(chatbot) };
    }),

  listRules: protectedProcedure.input(listChatbotRulesBodySchema).query(async ({ ctx, input }) => {
    const rules = await ctx.repos.chatbots.listRules({
      userId: ctx.user.id,
      chatbotId: input.chatbotId,
      isActive: input.isActive,
    });
    return { rules };
  }),

  createRule: protectedCsrfProcedure
    .input(createChatbotRuleBodySchema)
    .mutation(async ({ ctx, input }) => {
      const rule = await ctx.repos.chatbots.createRule({
        userId: ctx.user.id,
        chatbotId: input.chatbotId,
        name: input.name,
        priority: input.priority,
        match: input.match,
        segment: input.segment ?? null,
        actions: input.actions,
        metadata: input.metadata,
        isActive: true,
      });
      return { rule };
    }),

  updateRule: protectedCsrfProcedure
    .input(updateChatbotRuleBodySchema)
    .mutation(async ({ ctx, input }) => {
      const rule = await ctx.repos.chatbots.updateRule({
        ...input,
        userId: ctx.user.id,
      });
      return { rule };
    }),

  deleteRule: protectedCsrfProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const rule = await ctx.repos.chatbots.updateRule({
        id: input.id,
        userId: ctx.user.id,
        isActive: false,
      });
      return { rule, ok: Boolean(rule) };
    }),

  recordVariantEvent: protectedCsrfProcedure
    .input(chatbotVariantEventBodySchema)
    .mutation(async ({ ctx, input }) => {
      const chatbot = await ctx.repos.chatbots.findById({
        id: input.chatbotId,
        userId: ctx.user.id,
      });
      if (!chatbot) {
        return { event: null, ok: false as const, reason: "chatbot_not_found" };
      }
      const rules = await ctx.repos.chatbots.listRules({
        userId: ctx.user.id,
        chatbotId: chatbot.id,
      });
      const rule = rules.find((candidate) => candidate.id === input.ruleId) ?? null;
      if (!rule) {
        return { event: null, ok: false as const, reason: "rule_not_found" };
      }
      const variant = findAbTestVariant(rule, input.variantId);
      if (!variant) {
        return { event: null, ok: false as const, reason: "variant_not_found" };
      }
      const event = await ctx.repos.chatbots.recordVariantEvent({
        userId: ctx.user.id,
        chatbotId: chatbot.id,
        ruleId: rule.id,
        variantId: variant.id,
        variantLabel: variant.label,
        eventType: input.eventType,
        channel: input.channel,
        contactId: input.contactId ?? null,
        conversationId: input.conversationId ?? null,
        messageId: input.messageId ?? null,
        exposureId: input.exposureId ?? null,
        sourceEventId: input.sourceEventId ?? null,
        metadata: input.metadata ?? {},
      });
      return { event, ok: Boolean(event), reason: null };
    }),

  listVariantEvents: protectedProcedure
    .input(listVariantEventsBodySchema)
    .query(async ({ ctx, input }) => {
      const events = await ctx.repos.chatbots.listVariantEvents({
        userId: ctx.user.id,
        chatbotId: input.chatbotId,
        ruleId: input.ruleId,
        eventType: input.eventType,
        cursor: input.cursor,
        limit: input.limit,
      });
      return { events };
    }),

  summarizeVariantEvents: protectedProcedure
    .input(z.object({ chatbotId: z.number().int().positive().optional(), ruleId: z.number().int().positive().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const variants = await ctx.repos.chatbots.summarizeVariantEvents({
        userId: ctx.user.id,
        chatbotId: input?.chatbotId,
        ruleId: input?.ruleId,
      });
      return { variants };
    }),

  testRule: protectedProcedure
    .input(
      z.object({
        chatbotId: z.number().int().positive().optional(),
        channel: z.enum(["whatsapp", "instagram", "system"]).default("whatsapp"),
        phone: z.string().min(3).optional(),
        body: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      return evaluateChatbotMessage({
        repos: ctx.repos,
        userId: ctx.user.id,
        channel: input.channel,
        phone: input.phone,
        body: input.body,
        chatbotId: input.chatbotId,
        persistExecution: false,
      });
    }),

  evaluateMessage: protectedCsrfProcedure
    .input(chatbotMessageEvaluationBodySchema)
    .mutation(async ({ ctx, input }) =>
      evaluateChatbotMessage({
        repos: ctx.repos,
        userId: ctx.user.id,
        channel: input.channel,
        phone: input.phone,
        body: input.body,
        chatbotId: input.chatbotId,
        contactId: input.contactId ?? null,
        conversationId: input.conversationId ?? null,
        messageId: input.messageId ?? null,
        sourceEventId: input.sourceEventId ?? null,
        persistExecution: true,
      }),
    ),

  executionHistory: protectedProcedure
    .input(chatbotExecutionHistoryBodySchema.optional())
    .query(async ({ ctx, input }) => {
      const events = await ctx.repos.systemEvents.list({
        userId: ctx.user.id,
        type: "chatbot.execution.evaluated",
        limit: Math.max(input?.limit ?? 50, 200),
      });
      return {
        events: events
          .filter((event) => {
            if (input?.chatbotId && payloadNumber(event.payload, "chatbotId") !== input.chatbotId) {
              return false;
            }
            if (input?.ruleId && payloadNumber(event.payload, "ruleId") !== input.ruleId) {
              return false;
            }
            if (
              input?.conversationId &&
              payloadNumber(event.payload, "conversationId") !== input.conversationId
            ) {
              return false;
            }
            if (input?.messageId && payloadNumber(event.payload, "messageId") !== input.messageId) {
              return false;
            }
            return true;
          })
          .slice(0, input?.limit ?? 50),
      };
    }),
});

async function evaluateChatbotMessage(input: {
  repos: Repositories;
  userId: number;
  chatbotId?: number;
  channel: "whatsapp" | "instagram" | "system";
  phone?: string;
  body: string;
  contactId?: number | null;
  conversationId?: number | null;
  messageId?: number | null;
  sourceEventId?: string | null;
  persistExecution: boolean;
}) {
  const candidates = input.chatbotId
    ? [
        await input.repos.chatbots.findById({
          id: input.chatbotId,
          userId: input.userId,
        }),
      ].filter((chatbot) => chatbot !== null)
    : await input.repos.chatbots.list({
        userId: input.userId,
        channel: input.channel,
        status: "active",
      });

  for (const chatbot of candidates) {
    if (chatbot.channel !== input.channel) continue;
    if (chatbot.status === "archived") continue;

    const rules = await input.repos.chatbots.listRules({
      userId: input.userId,
      chatbotId: chatbot.id,
      isActive: true,
    });
    const directMatch = rules.find((rule) => bodyMatchesRule(rule, input.body));
    const fallback = directMatch ?? rules.find((rule) => rule.match.type === "fallback");
    if (fallback) {
      const actions = resolveRuleActions(fallback, input);
      const abTest = summarizeAbTest(fallback, input);
      if (input.persistExecution) {
        await persistChatbotExecution(input, {
          matched: true,
          chatbot,
          rule: fallback,
          fallbackUsed: fallback.match.type === "fallback",
          abTest,
          actionsCount: actions.length,
        });
      }
      return {
        matched: true,
        chatbot,
        rule: fallback,
        fallbackUsed: fallback.match.type === "fallback",
        actions,
        abTest,
        phone: input.phone ?? null,
        wouldEnqueueJobs: false as const,
        persisted: input.persistExecution,
        reasons: [],
      };
    }
  }

  if (input.persistExecution) {
    await persistChatbotExecution(input, {
      matched: false,
      chatbot: null,
      rule: null,
      fallbackUsed: false,
      abTest: null,
      actionsCount: 0,
    });
  }
  return {
    matched: false,
    chatbot: null,
    rule: null,
    fallbackUsed: false,
    actions: [],
    abTest: null,
    phone: input.phone ?? null,
    wouldEnqueueJobs: false as const,
    persisted: input.persistExecution,
    reasons: candidates.length === 0 ? ["no_chatbot"] : ["no_rule_match"],
  };
}

async function persistChatbotExecution(
  input: {
    repos: Repositories;
    userId: number;
    channel: "whatsapp" | "instagram" | "system";
    phone?: string;
    body: string;
    contactId?: number | null;
    conversationId?: number | null;
    messageId?: number | null;
    sourceEventId?: string | null;
  },
  result: {
    matched: boolean;
    chatbot: { id: number; name: string } | null;
    rule: ChatbotRule | null;
    fallbackUsed: boolean;
    abTest: ReturnType<typeof summarizeAbTest>;
    actionsCount: number;
  },
) {
  const selectedVariantId = result.abTest?.selectedVariantId ?? null;
  const selectedVariantLabel = result.abTest?.selectedVariantLabel ?? null;
  const sourceEventId =
    input.sourceEventId ??
    (input.messageId && result.chatbot && result.rule
      ? `message:${input.messageId}:chatbot:${result.chatbot.id}:rule:${result.rule.id}`
      : null);
  await input.repos.systemEvents.create({
    userId: input.userId,
    type: "chatbot.execution.evaluated",
    severity: result.matched ? "info" : "warn",
    payload: JSON.stringify({
      chatbotId: result.chatbot?.id ?? null,
      chatbotName: result.chatbot?.name ?? null,
      ruleId: result.rule?.id ?? null,
      ruleName: result.rule?.name ?? null,
      matched: result.matched,
      fallbackUsed: result.fallbackUsed,
      channel: input.channel,
      phone: input.phone ?? null,
      contactId: input.contactId ?? null,
      conversationId: input.conversationId ?? null,
      messageId: input.messageId ?? null,
      sourceEventId,
      bodyPreview: input.body.slice(0, 240),
      actionsCount: result.actionsCount,
      selectedVariantId,
      selectedVariantLabel,
      executionMode: "dry_run",
      wouldEnqueueJobs: false,
    }),
  });
  if (result.chatbot && result.rule && selectedVariantId) {
    await input.repos.chatbots.recordVariantEvent({
      userId: input.userId,
      chatbotId: result.chatbot.id,
      ruleId: result.rule.id,
      variantId: selectedVariantId,
      variantLabel: selectedVariantLabel,
      eventType: "exposure",
      channel: input.channel,
      contactId: input.contactId ?? null,
      conversationId: input.conversationId ?? null,
      messageId: input.messageId ?? null,
      exposureId: null,
      sourceEventId,
      metadata: {
        source: "chatbot.execution.evaluated",
        bodyPreview: input.body.slice(0, 120),
      },
    });
  }
}

function payloadNumber(payload: unknown, key: string): number | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const value = (payload as Record<string, unknown>)[key];
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}
