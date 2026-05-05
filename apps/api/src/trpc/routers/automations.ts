import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { createAutomationInputSchema, updateAutomationInputSchema } from "@nuoma/contracts";

import { triggerAutomationForPhone } from "../../services/automation-trigger.js";
import {
  evaluateApiRealSendTarget,
  normalizeClientAllowedPhoneOverride,
  normalizePhone,
  resolveApiSendPolicy,
} from "../../services/send-policy.js";
import { protectedCsrfProcedure, protectedProcedure, router } from "../init.js";

const createAutomationBodySchema = createAutomationInputSchema.omit({ userId: true });
const updateAutomationBodySchema = updateAutomationInputSchema.omit({ userId: true });
const listForConversationInputSchema = z.object({
  conversationId: z.number().int().positive(),
  search: z.string().trim().min(1).optional(),
  onlyEligible: z.boolean().default(false),
  limit: z.number().int().min(1).max(50).default(25),
});

export const automationsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const automations = await ctx.repos.automations.list(ctx.user.id);
    return { automations };
  }),

  listForConversation: protectedProcedure
    .input(listForConversationInputSchema)
    .query(async ({ ctx, input }) => {
      const conversation = await ctx.repos.conversations.findById({
        id: input.conversationId,
        userId: ctx.user.id,
      });
      if (!conversation) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }

      const phone = deriveConversationPhone(conversation);
      const within24hWindow = isWithin24hWindow(conversation.lastMessageAt);
      const sendPolicy = resolveApiSendPolicy(ctx.env);
      const dispatchDecision = phone
        ? evaluateApiRealSendTarget(sendPolicy, phone)
        : ({ allowed: false, reason: "invalid_phone" } as const);
      const search = input.search?.toLocaleLowerCase("pt-BR");
      const automationCandidates = (await ctx.repos.automations.list(ctx.user.id)).filter(
        (automation) =>
          !search ||
          `${automation.name} ${automation.category} ${automation.status}`
            .toLocaleLowerCase("pt-BR")
            .includes(search),
      );

      const evaluated = await Promise.all(
        automationCandidates.map(async (automation) => {
          const result = await triggerAutomationForPhone({
            repos: ctx.repos,
            userId: ctx.user.id,
            automationId: automation.id,
            phone: phone ?? conversation.externalThreadId,
            dryRun: true,
            allowedPhones: sendPolicy.allowedPhones,
            sendPolicyMode: sendPolicy.mode,
            conversationId: conversation.id,
            triggerChannel: conversation.channel,
            within24hWindow,
          });
          return {
            automation,
            eligible: result.eligible,
            reasons: result.reasons,
            wouldEnqueueJobs: result.wouldEnqueueJobs,
            plannedActionsCount: result.plannedActions.length,
            sendStepCount: result.plannedActions.filter((action) => action.type === "send_step")
              .length,
          };
        }),
      );

      const automations = evaluated
        .filter((item) => !input.onlyEligible || item.eligible)
        .sort((a, b) => {
          const eligibleScore = Number(b.eligible) - Number(a.eligible);
          if (eligibleScore !== 0) return eligibleScore;
          const activeScore =
            Number(b.automation.status === "active") - Number(a.automation.status === "active");
          if (activeScore !== 0) return activeScore;
          return a.automation.name.localeCompare(b.automation.name, "pt-BR");
        })
        .slice(0, input.limit);

      return {
        conversation: {
          id: conversation.id,
          channel: conversation.channel,
          title: conversation.title,
          phone,
          within24hWindow,
          canDispatchReal: dispatchDecision.allowed,
          realDispatchBlockedReason: dispatchDecision.allowed ? null : dispatchDecision.reason,
        },
        automations,
      };
    }),

  get: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const automation = await ctx.repos.automations.findById({
        id: input.id,
        userId: ctx.user.id,
      });
      return { automation };
    }),

  create: protectedCsrfProcedure
    .input(createAutomationBodySchema)
    .mutation(async ({ ctx, input }) => {
      const automation = await ctx.repos.automations.create({
        userId: ctx.user.id,
        name: input.name,
        category: input.category,
        status: "draft",
        trigger: input.trigger,
        condition: input.condition,
        actions: input.actions,
        metadata: input.metadata,
      });
      return { automation };
    }),

  update: protectedCsrfProcedure
    .input(updateAutomationBodySchema)
    .mutation(async ({ ctx, input }) => {
      const current = await ctx.repos.automations.findById({
        id: input.id,
        userId: ctx.user.id,
      });
      const metadata =
        current && hasVersionedAutomationChange(input)
          ? appendAutomationHistory({ ...current.metadata, ...(input.metadata ?? {}) }, {
              id: current.id,
              name: current.name,
              category: current.category,
              status: current.status,
              trigger: current.trigger,
              condition: current.condition,
              actions: current.actions,
              updatedAt: current.updatedAt,
            })
          : input.metadata;
      const automation = await ctx.repos.automations.update({
        ...input,
        userId: ctx.user.id,
        ...(metadata ? { metadata } : {}),
      });
      return { automation };
    }),

  softDelete: protectedCsrfProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const automation = await ctx.repos.automations.update({
        id: input.id,
        userId: ctx.user.id,
        status: "archived",
      });
      return { automation, ok: Boolean(automation) };
    }),

  restore: protectedCsrfProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        status: z.enum(["draft", "paused", "active"]).default("draft"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const automation = await ctx.repos.automations.update({
        id: input.id,
        userId: ctx.user.id,
        status: input.status,
      });
      return { automation, ok: Boolean(automation) };
    }),

  test: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        channel: z.enum(["whatsapp", "instagram", "system"]).optional(),
        tagId: z.number().int().positive().optional(),
        campaignId: z.number().int().positive().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const automation = await ctx.repos.automations.findById({
        id: input.id,
        userId: ctx.user.id,
      });
      if (!automation) {
        return { automation: null, eligible: false as const, reasons: ["not_found"] };
      }
      const reasons: string[] = [];
      if (automation.status !== "active") {
        reasons.push("status_not_active");
      }
      if (
        automation.trigger.channel &&
        input.channel &&
        automation.trigger.channel !== input.channel
      ) {
        reasons.push("channel_mismatch");
      }
      if (automation.trigger.tagId && input.tagId && automation.trigger.tagId !== input.tagId) {
        reasons.push("tag_mismatch");
      }
      if (
        automation.trigger.campaignId &&
        input.campaignId &&
        automation.trigger.campaignId !== input.campaignId
      ) {
        reasons.push("campaign_mismatch");
      }
      return {
        automation,
        eligible: reasons.length === 0,
        reasons,
        wouldEnqueueJobs: false as const,
      };
    }),

  trigger: protectedCsrfProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        phone: z.string().min(8).optional(),
        conversationId: z.number().int().positive().optional(),
        within24hWindow: z.boolean().optional(),
        dryRun: z.boolean().default(true),
        allowedPhone: z.string().min(8).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const conversation = input.conversationId
        ? await ctx.repos.conversations.findById({
            id: input.conversationId,
            userId: ctx.user.id,
          })
        : null;
      if (input.conversationId && !conversation) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }
      const phone = normalizePhone(input.phone) ?? deriveConversationPhone(conversation);
      if (!phone) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Conversation does not expose a valid phone",
        });
      }
      const sendPolicy = resolveApiSendPolicy(ctx.env, [
        normalizeClientAllowedPhoneOverride(input.allowedPhone),
      ]);
      return triggerAutomationForPhone({
        repos: ctx.repos,
        userId: ctx.user.id,
        automationId: input.id,
        phone,
        dryRun: input.dryRun,
        allowedPhones: sendPolicy.allowedPhones,
        sendPolicyMode: sendPolicy.mode,
        conversationId: conversation?.id ?? null,
        triggerChannel: conversation?.channel,
        within24hWindow:
          input.within24hWindow ??
          (conversation ? isWithin24hWindow(conversation.lastMessageAt) : undefined),
      });
    }),
});

function deriveConversationPhone(
  conversation: { externalThreadId: string; title: string } | null,
): string | null {
  if (!conversation) return null;
  return normalizePhone(conversation.externalThreadId) ?? normalizePhone(conversation.title);
}

function isWithin24hWindow(lastMessageAt: string | null): boolean {
  if (!lastMessageAt) return false;
  const timestamp = new Date(lastMessageAt).getTime();
  if (!Number.isFinite(timestamp)) return false;
  return Date.now() - timestamp <= 24 * 60 * 60 * 1000;
}

function hasVersionedAutomationChange(input: z.infer<typeof updateAutomationBodySchema>): boolean {
  return (
    input.name !== undefined ||
    input.category !== undefined ||
    input.status !== undefined ||
    input.trigger !== undefined ||
    input.condition !== undefined ||
    input.actions !== undefined
  );
}

function appendAutomationHistory(
  metadata: Record<string, unknown>,
  snapshot: Record<string, unknown>,
): Record<string, unknown> {
  const history = Array.isArray(metadata.history) ? metadata.history : [];
  return {
    ...metadata,
    history: [
      ...history.slice(-9),
      {
        version: history.length + 1,
        capturedAt: new Date().toISOString(),
        snapshot,
      },
    ],
  };
}
