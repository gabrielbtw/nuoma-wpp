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

import { protectedCsrfProcedure, protectedProcedure, router } from "../init.js";

const createChatbotBodySchema = createChatbotInputSchema.omit({ userId: true });
const createChatbotRuleBodySchema = createChatbotRuleInputSchema.omit({ userId: true });
const listChatbotsBodySchema = listChatbotsFilterSchema.omit({ userId: true }).optional();
const updateChatbotBodySchema = updateChatbotInputSchema.omit({ userId: true });
const listChatbotRulesBodySchema = listChatbotRulesFilterSchema.omit({ userId: true });
const updateChatbotRuleBodySchema = updateChatbotRuleInputSchema.omit({ userId: true });

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
      const candidates = input.chatbotId
        ? [
            await ctx.repos.chatbots.findById({
              id: input.chatbotId,
              userId: ctx.user.id,
            }),
          ].filter((chatbot) => chatbot !== null)
        : await ctx.repos.chatbots.list({
            userId: ctx.user.id,
            channel: input.channel,
            status: "active",
          });

      for (const chatbot of candidates) {
        if (chatbot.channel !== input.channel) continue;
        if (chatbot.status === "archived") continue;

        const rules = await ctx.repos.chatbots.listRules({
          userId: ctx.user.id,
          chatbotId: chatbot.id,
          isActive: true,
        });
        const directMatch = rules.find((rule) => bodyMatchesRule(rule, input.body));
        const fallback = directMatch ?? rules.find((rule) => rule.match.type === "fallback");
        if (fallback) {
          return {
            matched: true,
            chatbot,
            rule: fallback,
            fallbackUsed: fallback.match.type === "fallback",
            actions: resolveRuleActions(fallback, input),
            abTest: summarizeAbTest(fallback, input),
            phone: input.phone ?? null,
            wouldEnqueueJobs: false as const,
            reasons: [],
          };
        }
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
        reasons: candidates.length === 0 ? ["no_chatbot"] : ["no_rule_match"],
      };
    }),
});
