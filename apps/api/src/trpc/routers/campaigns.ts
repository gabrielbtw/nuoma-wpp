import {
  createCampaignInputSchema,
  updateCampaignInputSchema,
  type Campaign,
  type ChannelType,
} from "@nuoma/contracts";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { readCampaignAbConfig } from "../../services/campaign-ab-variants.js";
import { runCampaignSchedulerTick } from "../../services/campaign-scheduler.js";
import {
  evaluateApiRealSendTarget,
  normalizeClientAllowedPhoneOverride,
  normalizePhone,
  resolveApiSendPolicy,
} from "../../services/send-policy.js";
import { adminCsrfProcedure, protectedCsrfProcedure, protectedProcedure, router } from "../init.js";

const createCampaignBodySchema = createCampaignInputSchema.omit({ userId: true });
const updateCampaignBodySchema = updateCampaignInputSchema.omit({ userId: true });
const listForConversationInputSchema = z.object({
  conversationId: z.number().int().positive(),
  search: z.string().trim().min(1).optional(),
  onlyEligible: z.boolean().default(false),
  limit: z.number().int().min(1).max(50).default(25),
});
const executeCampaignBodySchema = z.object({
  campaignId: z.number().int().positive(),
  conversationId: z.number().int().positive().optional(),
  contactIds: z.array(z.number().int().positive()).default([]),
  phones: z.array(z.string().min(8)).default([]),
  dryRun: z.boolean().default(true),
  allowedPhone: z.string().min(8).optional(),
  maxRecipients: z.number().int().min(1).max(500).default(100),
});
const pauseCampaignBodySchema = z.object({
  id: z.number().int().positive(),
  reason: z.string().trim().max(240).optional(),
});
const resumeCampaignBodySchema = z.object({
  id: z.number().int().positive(),
  startsAt: z.string().datetime({ offset: true }).nullable().optional(),
});
const tickCampaignBodySchema = z
  .object({
    dryRun: z.boolean().optional(),
    campaignId: z.number().int().positive().optional(),
  })
  .optional();

interface CampaignExecuteCandidate {
  contactId: number | null;
  phone: string;
  source: "contact" | "phone" | "conversation";
}

export const campaignsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const campaigns = await ctx.repos.campaigns.list(ctx.user.id);
    const events = await ctx.repos.systemEvents.list({
      userId: ctx.user.id,
      limit: 1_000,
    });
    const campaignsWithRecipients = await Promise.all(
      campaigns.map(async (campaign) => {
        const campaignEvents = events.filter((event) =>
          campaignEventMatches(event.payload, campaign.id),
        );
        const recipients = await ctx.repos.campaignRecipients.listByCampaign({
          userId: ctx.user.id,
          campaignId: campaign.id,
          limit: 500,
        });
        return {
          ...campaign,
          metrics: summarizeCampaignEvents(campaignEvents),
          stepStats: summarizeCampaignStepStats({
            steps: campaign.steps,
            recipients,
            events: campaignEvents,
          }),
          abTest: summarizeCampaignAbVariants({
            campaign,
            recipients,
            events: campaignEvents,
          }),
          recipients: recipients.map((recipient) => ({
            ...recipient,
            timeline: events
              .filter((event) =>
                campaignRecipientEventMatches(event.payload, campaign.id, recipient.id),
              )
              .slice(0, 8)
              .map((event) => ({
                id: event.id,
                type: event.type,
                severity: event.severity,
                payload: event.payload,
                createdAt: event.createdAt,
              })),
          })),
        };
      }),
    );
    return { campaigns: campaignsWithRecipients };
  }),

  get: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const campaign = await ctx.repos.campaigns.findById({
        userId: ctx.user.id,
        id: input.id,
      });
      if (!campaign) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Campaign not found" });
      }
      return { campaign };
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
      const sendPolicy = resolveApiSendPolicy(ctx.env);
      const realDispatchDecision =
        conversation.channel !== "whatsapp"
          ? ({ allowed: false, reason: "channel_not_supported" } as const)
          : phone
            ? evaluateApiRealSendTarget(sendPolicy, phone)
            : ({ allowed: false, reason: "invalid_phone" } as const);
      const search = input.search?.toLocaleLowerCase("pt-BR");
      const campaignCandidates = (await ctx.repos.campaigns.list(ctx.user.id)).filter(
        (campaign) =>
          !search ||
          `${campaign.name} ${campaign.status} ${campaign.channel}`
            .toLocaleLowerCase("pt-BR")
            .includes(search),
      );

      const evaluated = await Promise.all(
        campaignCandidates.map(async (campaign) => {
          const evaluation = await evaluateCampaignForConversation({
            campaign,
            conversation: {
              channel: conversation.channel,
              contactId: conversation.contactId,
              id: conversation.id,
              phone,
            },
            existingRecipients: await ctx.repos.campaignRecipients.listByCampaign({
              userId: ctx.user.id,
              campaignId: campaign.id,
              limit: 1_000,
            }),
          });
          return evaluation;
        }),
      );

      const campaigns = evaluated
        .filter((item) => !input.onlyEligible || item.eligible)
        .sort((a, b) => {
          const eligibleScore = Number(b.eligible) - Number(a.eligible);
          if (eligibleScore !== 0) return eligibleScore;
          const runnableScore =
            Number(isCampaignRunnableForManualDispatch(b.campaign)) -
            Number(isCampaignRunnableForManualDispatch(a.campaign));
          if (runnableScore !== 0) return runnableScore;
          return a.campaign.name.localeCompare(b.campaign.name, "pt-BR");
        })
        .slice(0, input.limit);

      return {
        conversation: {
          id: conversation.id,
          channel: conversation.channel,
          title: conversation.title,
          phone,
          contactId: conversation.contactId,
          canDispatchReal: realDispatchDecision.allowed,
          realDispatchBlockedReason: realDispatchDecision.allowed
            ? null
            : realDispatchDecision.reason,
        },
        campaigns,
      };
    }),

  create: protectedCsrfProcedure
    .input(createCampaignBodySchema)
    .mutation(async ({ ctx, input }) => {
      const campaign = await ctx.repos.campaigns.create({
        userId: ctx.user.id,
        name: input.name,
        channel: input.channel,
        status: "draft",
        evergreen: input.evergreen,
        startsAt: input.startsAt ?? null,
        metadata: input.metadata,
        segment: input.segment ?? null,
        steps: input.steps,
      });
      return { campaign };
    }),

  update: protectedCsrfProcedure
    .input(updateCampaignBodySchema)
    .mutation(async ({ ctx, input }) => {
      const campaign = await ctx.repos.campaigns.update({
        ...input,
        userId: ctx.user.id,
      });
      return { campaign };
    }),

  pause: protectedCsrfProcedure
    .input(pauseCampaignBodySchema)
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.repos.campaigns.findById({
        userId: ctx.user.id,
        id: input.id,
      });
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Campaign not found" });
      }
      if (existing.status === "archived" || existing.status === "completed") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Campaign cannot be paused from status ${existing.status}`,
        });
      }

      const now = new Date().toISOString();
      const campaign = await ctx.repos.campaigns.update({
        userId: ctx.user.id,
        id: existing.id,
        status: "paused",
        metadata: {
          ...existing.metadata,
          pauseResume: {
            ...objectRecord(existing.metadata.pauseResume),
            lastAction: "paused",
            pausedAt: now,
            pausedByUserId: ctx.user.id,
            pauseReason: input.reason?.trim() || null,
          },
        },
      });
      await ctx.repos.auditLogs.create({
        userId: ctx.user.id,
        actorUserId: ctx.user.id,
        action: "campaigns.pause",
        targetTable: "campaigns",
        targetId: existing.id,
        before: JSON.stringify({ status: existing.status }),
        after: JSON.stringify({ status: campaign?.status, reason: input.reason ?? null }),
        ipAddress: ctx.req.ip,
        userAgent: ctx.req.headers["user-agent"] ?? null,
      });
      return { campaign, ok: Boolean(campaign) };
    }),

  resume: protectedCsrfProcedure
    .input(resumeCampaignBodySchema)
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.repos.campaigns.findById({
        userId: ctx.user.id,
        id: input.id,
      });
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Campaign not found" });
      }
      if (existing.status === "archived" || existing.status === "completed") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Campaign cannot be resumed from status ${existing.status}`,
        });
      }

      const now = new Date();
      const nowIso = now.toISOString();
      const startsAt = input.startsAt ?? existing.startsAt ?? nowIso;
      const status = new Date(startsAt).getTime() > now.getTime() ? "scheduled" : "running";
      const campaign = await ctx.repos.campaigns.update({
        userId: ctx.user.id,
        id: existing.id,
        status,
        startsAt,
        completedAt: null,
        metadata: {
          ...existing.metadata,
          pauseResume: {
            ...objectRecord(existing.metadata.pauseResume),
            lastAction: "resumed",
            resumedAt: nowIso,
            resumedByUserId: ctx.user.id,
            resumeStartsAt: startsAt,
          },
        },
      });
      await ctx.repos.auditLogs.create({
        userId: ctx.user.id,
        actorUserId: ctx.user.id,
        action: "campaigns.resume",
        targetTable: "campaigns",
        targetId: existing.id,
        before: JSON.stringify({ status: existing.status }),
        after: JSON.stringify({ status: campaign?.status, startsAt }),
        ipAddress: ctx.req.ip,
        userAgent: ctx.req.headers["user-agent"] ?? null,
      });
      return { campaign, ok: Boolean(campaign) };
    }),

  softDelete: protectedCsrfProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const campaign = await ctx.repos.campaigns.update({
        userId: ctx.user.id,
        id: input.id,
        status: "archived",
      });
      return { campaign, ok: Boolean(campaign) };
    }),

  restore: protectedCsrfProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        status: z.enum(["draft", "paused", "scheduled"]).default("draft"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const campaign = await ctx.repos.campaigns.update({
        userId: ctx.user.id,
        id: input.id,
        status: input.status,
        completedAt: null,
      });
      return { campaign, ok: Boolean(campaign) };
    }),

  execute: protectedCsrfProcedure
    .input(executeCampaignBodySchema)
    .mutation(async ({ ctx, input }) => {
      const campaign = await ctx.repos.campaigns.findById({
        userId: ctx.user.id,
        id: input.campaignId,
      });
      if (!campaign) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Campaign not found" });
      }

      const sendPolicy = resolveApiSendPolicy(ctx.env, [
        normalizeClientAllowedPhoneOverride(input.allowedPhone),
      ]);
      const candidates: CampaignExecuteCandidate[] = [];
      const rejected: Array<{ source: string; value: string | number; reason: string }> = [];
      const conversation = input.conversationId
        ? await ctx.repos.conversations.findById({
            id: input.conversationId,
            userId: ctx.user.id,
          })
        : null;
      if (input.conversationId && !conversation) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }

      if (conversation) {
        const phone = deriveConversationPhone(conversation);
        if (conversation.channel !== "whatsapp") {
          rejected.push({
            source: "conversation",
            value: conversation.id,
            reason: "channel_not_supported",
          });
        } else if (campaign.channel !== conversation.channel) {
          rejected.push({
            source: "conversation",
            value: conversation.id,
            reason: "channel_mismatch",
          });
        } else if (!phone) {
          rejected.push({
            source: "conversation",
            value: conversation.id,
            reason: "invalid_phone",
          });
        } else {
          candidates.push({
            contactId: conversation.contactId ?? null,
            phone,
            source: "conversation",
          });
        }
      }

      for (const contactId of input.contactIds.slice(0, input.maxRecipients)) {
        const contact = await ctx.repos.contacts.findById(contactId);
        if (!contact || contact.userId !== ctx.user.id) {
          rejected.push({ source: "contact", value: contactId, reason: "not_found" });
          continue;
        }
        const phone = normalizePhone(contact.phone);
        if (!phone) {
          rejected.push({ source: "contact", value: contactId, reason: "missing_phone" });
          continue;
        }
        candidates.push({ contactId: contact.id, phone, source: "contact" });
      }

      for (const rawPhone of input.phones.slice(0, input.maxRecipients)) {
        const phone = normalizePhone(rawPhone);
        if (!phone) {
          rejected.push({ source: "phone", value: rawPhone, reason: "invalid_phone" });
          continue;
        }
        candidates.push({ contactId: null, phone, source: "phone" });
      }

      const uniqueCandidates = dedupeCandidates(candidates).slice(0, input.maxRecipients);
      const existingRecipients = await ctx.repos.campaignRecipients.listByCampaign({
        userId: ctx.user.id,
        campaignId: campaign.id,
        limit: 1_000,
      });
      const existingKeys = new Set(
        existingRecipients.map((recipient) =>
          recipient.contactId
            ? `contact:${recipient.contactId}`
            : `phone:${normalizePhone(recipient.phone)}`,
        ),
      );

      const accepted = [];
      for (const candidate of uniqueCandidates) {
        const key = candidate.contactId
          ? `contact:${candidate.contactId}`
          : `phone:${candidate.phone}`;
        if (existingKeys.has(key)) {
          rejected.push({
            source: candidate.source,
            value: candidate.phone,
            reason: "duplicate_recipient",
          });
          continue;
        }
        if (!input.dryRun) {
          const decision = evaluateApiRealSendTarget(sendPolicy, candidate.phone);
          if (decision.allowed) {
            accepted.push(candidate);
            continue;
          }
          rejected.push({
            source: candidate.source,
            value: candidate.phone,
            reason: decision.reason,
          });
          continue;
        }
        accepted.push(candidate);
      }

      if (input.dryRun) {
        return {
          dryRun: true,
          campaign,
          recipientsPlanned: accepted.length,
          recipientsCreated: 0,
          rejected,
          scheduler: null,
        };
      }

      const updatedCampaign = await ctx.repos.campaigns.update({
        id: campaign.id,
        userId: ctx.user.id,
        status: "running",
        startsAt: campaign.startsAt ?? new Date().toISOString(),
        metadata: {
          ...campaign.metadata,
          lastExecutedAt: new Date().toISOString(),
          lastExecutedBy: ctx.user.id,
        },
      });
      if (!updatedCampaign) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Campaign update failed" });
      }

      let recipientsCreated = 0;
      for (const candidate of accepted) {
        await ctx.repos.campaignRecipients.create({
          userId: ctx.user.id,
          campaignId: campaign.id,
          contactId: candidate.contactId,
          phone: candidate.phone,
          channel: campaign.channel,
          status: "queued",
          currentStepId: null,
          lastError: null,
          metadata: {
            source: "campaigns.execute",
            candidateSource: candidate.source,
          },
        });
        recipientsCreated += 1;
      }

      const scheduler = await runCampaignSchedulerTick({
        repos: ctx.repos,
        userId: ctx.user.id,
        ownerId: `api:${ctx.user.id}:campaigns.execute`,
        campaignId: campaign.id,
        limit: input.maxRecipients,
        dryRun: false,
      });

      await ctx.repos.auditLogs.create({
        userId: ctx.user.id,
        actorUserId: ctx.user.id,
        action: "campaigns.execute",
        targetTable: "campaigns",
        targetId: campaign.id,
        after: JSON.stringify({ recipientsCreated, rejected, scheduler }),
        ipAddress: ctx.req.ip,
        userAgent: ctx.req.headers["user-agent"] ?? null,
      });

      return {
        dryRun: false,
        campaign: updatedCampaign,
        recipientsPlanned: accepted.length,
        recipientsCreated,
        rejected,
        scheduler,
      };
    }),

  tick: adminCsrfProcedure
    .input(tickCampaignBodySchema)
    .mutation(async ({ ctx, input }) => {
      const result = await runCampaignSchedulerTick({
        repos: ctx.repos,
        userId: ctx.user.id,
        ownerId: `api:${ctx.user.id}`,
        campaignId: input?.campaignId,
        dryRun: input?.dryRun ?? false,
      });
      await ctx.repos.auditLogs.create({
        userId: ctx.user.id,
        actorUserId: ctx.user.id,
        action: "campaigns.scheduler.tick",
        targetTable: "campaigns",
        after: JSON.stringify(result),
        ipAddress: ctx.req.ip,
        userAgent: ctx.req.headers["user-agent"] ?? null,
      });
      return result;
    }),
});

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function dedupeCandidates(candidates: CampaignExecuteCandidate[]): CampaignExecuteCandidate[] {
  const seen = new Set<string>();
  const deduped: CampaignExecuteCandidate[] = [];
  for (const candidate of candidates) {
    const key = candidate.contactId ? `contact:${candidate.contactId}` : `phone:${candidate.phone}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(candidate);
  }
  return deduped;
}

async function evaluateCampaignForConversation(input: {
  campaign: Campaign;
  conversation: {
    id: number;
    channel: ChannelType;
    contactId: number | null;
    phone: string | null;
  };
  existingRecipients: Array<{ contactId: number | null; phone: string | null }>;
}) {
  const reasons: string[] = [];
  const firstStep = input.campaign.steps[0] ?? null;
  const existingKeys = new Set(
    input.existingRecipients.map((recipient) =>
      recipient.contactId
        ? `contact:${recipient.contactId}`
        : `phone:${normalizePhone(recipient.phone)}`,
    ),
  );
  const recipientKey = input.conversation.contactId
    ? `contact:${input.conversation.contactId}`
    : input.conversation.phone
      ? `phone:${input.conversation.phone}`
      : null;

  if (!isCampaignRunnableForManualDispatch(input.campaign)) {
    reasons.push("status_not_runnable");
  }
  if (input.conversation.channel !== "whatsapp") {
    reasons.push("channel_not_supported");
  }
  if (input.campaign.channel !== input.conversation.channel) {
    reasons.push("channel_mismatch");
  }
  if (!input.conversation.phone) {
    reasons.push("invalid_phone");
  }
  if (recipientKey && existingKeys.has(recipientKey)) {
    reasons.push("duplicate_recipient");
  }

  const eligible = reasons.length === 0;
  return {
    campaign: input.campaign,
    eligible,
    reasons,
    stepsCount: input.campaign.steps.length,
    firstStepType: firstStep?.type ?? null,
    recipientsPlanned: eligible ? 1 : 0,
    rejected: eligible
      ? []
      : reasons.map((reason) => ({
          source: "conversation",
          value: input.conversation.phone ?? input.conversation.id,
          reason,
        })),
  };
}

function isCampaignRunnableForManualDispatch(campaign: Campaign): boolean {
  return campaign.status !== "archived" && campaign.status !== "completed";
}

function deriveConversationPhone(
  conversation: { externalThreadId: string; title: string } | null,
): string | null {
  if (!conversation) return null;
  return normalizePhone(conversation.externalThreadId) ?? normalizePhone(conversation.title);
}

function summarizeCampaignEvents(
  events: Array<{ type: string; payload: unknown; createdAt: string }>,
) {
  const timestamps = events
    .map((event) => new Date(event.createdAt).getTime())
    .filter((timestamp) => Number.isFinite(timestamp));
  const first = timestamps.length > 0 ? Math.min(...timestamps) : null;
  const last = timestamps.length > 0 ? Math.max(...timestamps) : null;
  return {
    timelineEvents: events.length,
    completedSteps: events.filter((event) => event.type === "sender.campaign_step.completed")
      .length,
    failedSteps: events.filter((event) => event.type === "sender.campaign_step.failed").length,
    navigatedSteps: events.filter(
      (event) => payloadField(event.payload, "navigationMode") === "navigated",
    ).length,
    reusedOpenChatSteps: events.filter(
      (event) => payloadField(event.payload, "navigationMode") === "reused-open-chat",
    ).length,
    durationSeconds:
      first !== null && last !== null ? Math.max(0, Math.round((last - first) / 1000)) : null,
  };
}

function summarizeCampaignStepStats(input: {
  steps: Campaign["steps"];
  recipients: Array<{
    id: number;
    status: string;
    currentStepId: string | null;
    metadata: Record<string, unknown>;
  }>;
  events: Array<{ type: string; payload: unknown; createdAt: string }>;
}) {
  const totalRecipients = input.recipients.length;
  return input.steps.map((step, index) => {
    const stepEvents = input.events.filter((event) => payloadField(event.payload, "stepId") === step.id);
    const completedEvents = stepEvents.filter((event) => event.type === "sender.campaign_step.completed");
    const failedEvents = stepEvents.filter((event) => event.type === "sender.campaign_step.failed");
    const completedRecipients = uniqueNumericPayloadValues(completedEvents, "recipientId");
    const failedRecipients = uniqueNumericPayloadValues(failedEvents, "recipientId");
    const currentRecipients = input.recipients.filter((recipient) => recipient.currentStepId === step.id);
    const awaitingRecipients = input.recipients.filter(
      (recipient) => recipient.metadata.awaitingStepId === step.id,
    );
    const navigationCounts = {
      navigated: stepEvents.filter((event) => payloadField(event.payload, "navigationMode") === "navigated")
        .length,
      reusedOpenChat: stepEvents.filter(
        (event) => payloadField(event.payload, "navigationMode") === "reused-open-chat",
      ).length,
    };
    const timestamps = stepEvents
      .map((event) => new Date(event.createdAt).getTime())
      .filter((timestamp) => Number.isFinite(timestamp));
    const lastTimestamp = timestamps.length > 0 ? Math.max(...timestamps) : null;
    const completedCount = completedRecipients.size;
    const failedCount = failedRecipients.size;
    return {
      stepId: step.id,
      label: step.label,
      type: step.type,
      order: index + 1,
      delaySeconds: step.delaySeconds,
      totalRecipients,
      completedRecipients: completedCount,
      failedRecipients: failedCount,
      currentRecipients: currentRecipients.length,
      awaitingRecipients: awaitingRecipients.length,
      completionRate: totalRecipients > 0 ? completedCount / totalRecipients : 0,
      failureRate: totalRecipients > 0 ? failedCount / totalRecipients : 0,
      eventsCount: stepEvents.length,
      completedEvents: completedEvents.length,
      failedEvents: failedEvents.length,
      navigatedSteps: navigationCounts.navigated,
      reusedOpenChatSteps: navigationCounts.reusedOpenChat,
      lastEventAt: lastTimestamp !== null ? new Date(lastTimestamp).toISOString() : null,
    };
  });
}

function summarizeCampaignAbVariants(input: {
  campaign: Campaign;
  recipients: Array<{
    id: number;
    metadata: Record<string, unknown>;
  }>;
  events: Array<{ type: string; payload: unknown; createdAt: string }>;
}) {
  const config = readCampaignAbConfig(input.campaign.metadata);
  if (!config) {
    return null;
  }

  const recipientVariantById = new Map(
    input.recipients.map((recipient) => [
      recipient.id,
      stringField(recipient.metadata, "abVariantId"),
    ]),
  );
  const variantSummaries = config.variants.map((variant) => {
    const assignedRecipients = input.recipients.filter(
      (recipient) => stringField(recipient.metadata, "abVariantId") === variant.id,
    );
    const variantEvents = input.events.filter((event) => {
      const payloadVariantId = stringPayloadField(event.payload, "variantId");
      if (payloadVariantId) {
        return payloadVariantId === variant.id;
      }
      const recipientId = numericPayloadField(event.payload, "recipientId");
      return recipientId ? recipientVariantById.get(recipientId) === variant.id : false;
    });
    const completedEvents = variantEvents.filter(
      (event) => event.type === "sender.campaign_step.completed",
    );
    const failedEvents = variantEvents.filter(
      (event) => event.type === "sender.campaign_step.failed",
    );
    const completedRecipients = uniqueNumericPayloadValues(completedEvents, "recipientId");
    const failedRecipients = uniqueNumericPayloadValues(failedEvents, "recipientId");
    const timestamps = variantEvents
      .map((event) => new Date(event.createdAt).getTime())
      .filter((timestamp) => Number.isFinite(timestamp));
    const lastTimestamp = timestamps.length > 0 ? Math.max(...timestamps) : null;
    return {
      id: variant.id,
      label: variant.label,
      weight: variant.weight,
      assignedRecipients: assignedRecipients.length,
      completedRecipients: completedRecipients.size,
      failedRecipients: failedRecipients.size,
      completionRate:
        assignedRecipients.length > 0 ? completedRecipients.size / assignedRecipients.length : 0,
      failureRate:
        assignedRecipients.length > 0 ? failedRecipients.size / assignedRecipients.length : 0,
      eventsCount: variantEvents.length,
      lastEventAt: lastTimestamp !== null ? new Date(lastTimestamp).toISOString() : null,
    };
  });

  const assignedVariantIds = new Set(config.variants.map((variant) => variant.id));
  return {
    enabled: true,
    assignment: config.assignment,
    totalAssigned: input.recipients.filter((recipient) => {
      const variantId = stringField(recipient.metadata, "abVariantId");
      return variantId ? assignedVariantIds.has(variantId) : false;
    }).length,
    unassignedRecipients: input.recipients.filter((recipient) => {
      const variantId = stringField(recipient.metadata, "abVariantId");
      return !variantId || !assignedVariantIds.has(variantId);
    }).length,
    variants: variantSummaries,
  };
}

function campaignEventMatches(payload: unknown, campaignId: number): boolean {
  return payloadField(payload, "campaignId") === campaignId;
}

function campaignRecipientEventMatches(
  payload: unknown,
  campaignId: number,
  recipientId: number,
): boolean {
  return (
    campaignEventMatches(payload, campaignId) &&
    payloadField(payload, "recipientId") === recipientId
  );
}

function payloadField(payload: unknown, key: string): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }
  return (payload as Record<string, unknown>)[key];
}

function stringPayloadField(payload: unknown, key: string): string | null {
  const value = payloadField(payload, key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numericPayloadField(payload: unknown, key: string): number | null {
  const value = payloadField(payload, key);
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function uniqueNumericPayloadValues(
  events: Array<{ payload: unknown }>,
  key: string,
): Set<number> {
  const values = new Set<number>();
  for (const event of events) {
    const value = payloadField(event.payload, key);
    const number = typeof value === "number" ? value : Number(value);
    if (Number.isInteger(number) && number > 0) {
      values.add(number);
    }
  }
  return values;
}
