import {
  campaignTemporaryMessagesConfigSchema,
  createCampaignInputSchema,
  updateCampaignInputSchema,
  type Campaign,
  type ChannelType,
  type Contact,
  type Job,
} from "@nuoma/contracts";
import type { Repositories } from "@nuoma/db";
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
    confirmText: z.string().trim().optional(),
  })
  .optional();
const readyCampaignBodySchema = z.object({
  campaignId: z.number().int().positive(),
  maxRecipients: z.number().int().min(1).max(500).default(250),
});
const remarketingBatchBaseBodySchema = z.object({
  campaignId: z.number().int().positive(),
  rawPhones: z.string().max(20_000).default(""),
  phones: z.array(z.string().min(8)).default([]),
  rawInstagramHandles: z.string().max(20_000).default(""),
  instagramHandles: z.array(z.string().min(1)).default([]),
  contactIds: z.array(z.number().int().positive()).default([]),
  allowedPhone: z.string().min(8).optional(),
  allowedInstagramHandle: z.string().min(1).optional(),
  maxRecipients: z.number().int().min(1).max(500).default(100),
});
const remarketingBatchDispatchBodySchema = remarketingBatchBaseBodySchema.extend({
  confirmText: z.string().trim().min(1),
});

interface CampaignExecuteCandidate {
  contactId: number | null;
  phone: string;
  source: "contact" | "phone" | "conversation";
}

type ReadinessSeverity = "info" | "warning" | "error";
type RemarketingBatchIssue = {
  code: string;
  severity: ReadinessSeverity;
  message: string;
  count?: number;
};
type RemarketingBatchCandidate = {
  contactId: number | null;
  phone: string | null;
  instagramHandle: string | null;
  source: "contact" | "phone" | "instagram";
  value: string | number;
};
type RemarketingBatchRejected = {
  source: "contact" | "phone" | "instagram";
  value: string | number;
  reason: string;
};
type InstagramSessionPreflight = {
  status: string;
  authenticated: boolean;
  username: string | null;
  pageUrl: string | null;
  lastSyncAt: string | null;
  workerId: string | null;
  workerStatus: string | null;
  heartbeatAgeSeconds: number | null;
  stale: boolean;
  browserConnected: boolean;
  lastError: string | null;
};
type RemarketingBatchPlan = {
  campaign: Campaign;
  generatedAt: string;
  canDispatch: boolean;
  confirmText: string;
  temporaryMessages: {
    enabled: boolean;
    beforeSendDuration: string | null;
    afterCompletionDuration: string | null;
    restoreOnFailure: boolean | null;
    controlSteps: Array<{ stepId: string; label: string; duration: string }>;
  };
  summary: {
    candidates: number;
    acceptedRecipients: number;
    rejectedRecipients: number;
    plannedJobs: number;
    steps: number;
    policyMode: string;
    allowedPhones: number;
    activeCampaignStepJobs: number;
    activeRecipients: number;
    instagramSession: InstagramSessionPreflight | null;
  };
  accepted: RemarketingBatchCandidate[];
  rejected: RemarketingBatchRejected[];
  issues: RemarketingBatchIssue[];
};

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
          recipients: recipients.map((recipient) => {
            const eventTimeline = events
              .filter((event) =>
                campaignRecipientEventMatches(event.payload, campaign.id, recipient.id),
              )
              .map((event) => ({
                id: event.id,
                type: event.type,
                severity: event.severity,
                payload: event.payload,
                createdAt: event.createdAt,
              }));
            const materializedAudit = materializedRecipientAuditTimeline(
              recipient.metadata,
              recipient.id,
              campaign.id,
            );
            return {
              ...recipient,
              materializedAudit,
              timeline: [...eventTimeline, ...materializedAudit]
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                .slice(0, 8),
            };
          }),
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

  ready: protectedProcedure.input(readyCampaignBodySchema).query(async ({ ctx, input }) => {
    return buildCampaignReadinessPreflight({
      repos: ctx.repos,
      env: ctx.env,
      userId: ctx.user.id,
      campaignId: input.campaignId,
      maxRecipients: input.maxRecipients,
      ownerId: `api:${ctx.user.id}:campaigns.ready`,
    });
  }),

  remarketingBatchReady: protectedCsrfProcedure
    .input(remarketingBatchBaseBodySchema)
    .mutation(async ({ ctx, input }) => {
      return buildRemarketingBatchPlan({
        repos: ctx.repos,
        env: ctx.env,
        userId: ctx.user.id,
        input,
      });
    }),

  remarketingBatchDispatch: protectedCsrfProcedure
    .input(remarketingBatchDispatchBodySchema)
    .mutation(async ({ ctx, input }) => {
      const plan = await buildRemarketingBatchPlan({
        repos: ctx.repos,
        env: ctx.env,
        userId: ctx.user.id,
        input,
      });
      if (input.confirmText !== plan.confirmText) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Confirmação inválida. Digite ${plan.confirmText}.`,
        });
      }
      if (!plan.canDispatch) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Lote bloqueado: ${plan.issues
            .filter((issue) => issue.severity === "error")
            .map((issue) => issue.code)
            .join(", ")}`,
        });
      }

      const now = new Date();
      const nowIso = now.toISOString();
      const batchDispatchId = `remarketing:${plan.campaign.id}:${now.getTime()}`;
      const updatedCampaign = await ctx.repos.campaigns.update({
        id: plan.campaign.id,
        userId: ctx.user.id,
        status: "running",
        startsAt: plan.campaign.startsAt ?? nowIso,
        metadata: {
          ...plan.campaign.metadata,
          lastRemarketingBatch: {
            id: batchDispatchId,
            at: nowIso,
            byUserId: ctx.user.id,
            recipientsAccepted: plan.accepted.length,
            rejectedRecipients: plan.rejected.length,
            temporaryMessages: plan.temporaryMessages,
            instagramSession: plan.summary.instagramSession,
          },
        },
      });
      if (!updatedCampaign) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Campaign update failed" });
      }

      let recipientsCreated = 0;
      for (const candidate of plan.accepted) {
        await ctx.repos.campaignRecipients.create({
          userId: ctx.user.id,
          campaignId: plan.campaign.id,
          contactId: candidate.contactId,
          phone: candidate.phone,
          channel: plan.campaign.channel,
          status: "queued",
          currentStepId: null,
          lastError: null,
          metadata: {
            source: "campaigns.remarketing_batch",
            batchDispatchId,
            candidateSource: candidate.source,
            instagramHandle: candidate.instagramHandle,
            variables: {
              telefone: candidate.phone ?? "",
              phone: candidate.phone ?? "",
              instagram: candidate.instagramHandle ?? "",
              instagramHandle: candidate.instagramHandle ?? "",
            },
          },
        });
        recipientsCreated += 1;
      }

      const scheduler = await runCampaignSchedulerTick({
        repos: ctx.repos,
        userId: ctx.user.id,
        ownerId: `api:${ctx.user.id}:campaigns.remarketing_batch`,
        campaignId: plan.campaign.id,
        limit: plan.accepted.length,
        dryRun: false,
      });

      await ctx.repos.systemEvents.create({
        userId: ctx.user.id,
        type: "campaign.remarketing_batch.dispatched",
        severity: "info",
        payload: JSON.stringify({
          campaignId: plan.campaign.id,
          batchDispatchId,
          recipientsCreated,
          rejectedRecipients: plan.rejected.length,
          jobsCreated: scheduler.jobsCreated,
          plannedJobs: scheduler.plannedJobs.length,
          temporaryMessages: plan.temporaryMessages,
          executionMode: plan.campaign.channel === "instagram" ? "instagram_real" : "whatsapp_real",
          guardrails: {
            allowlist: true,
            temporaryMessagesM303: plan.campaign.channel === "whatsapp",
            activeJobsBlocked: true,
            partialBatchBlocked: true,
            instagramSessionReady:
              plan.campaign.channel === "instagram"
                ? Boolean(plan.summary.instagramSession?.authenticated)
                : null,
          },
        }),
      });
      await ctx.repos.auditLogs.create({
        userId: ctx.user.id,
        actorUserId: ctx.user.id,
        action: "campaigns.remarketing_batch.dispatch",
        targetTable: "campaigns",
        targetId: plan.campaign.id,
        after: JSON.stringify({
          batchDispatchId,
          recipientsCreated,
          rejected: plan.rejected,
          scheduler,
        }),
        ipAddress: ctx.req.ip,
        userAgent: ctx.req.headers["user-agent"] ?? null,
      });

      return {
        dryRun: false,
        campaign: updatedCampaign,
        batchDispatchId,
        recipientsCreated,
        rejected: plan.rejected,
        scheduler,
        guardrails: plan.summary,
      };
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
      const instagramHandle = deriveConversationInstagramHandle(conversation);
      const sendPolicy = resolveApiSendPolicy(ctx.env);
      const realDispatchDecision =
        conversation.channel === "whatsapp"
          ? phone
            ? evaluateApiRealSendTarget(sendPolicy, phone)
            : ({ allowed: false, reason: "invalid_phone" } as const)
          : conversation.channel === "instagram" && instagramHandle
            ? ({ allowed: true, reason: "allowed" } as const)
            : ({ allowed: false, reason: "channel_not_supported" } as const);
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
              instagramHandle,
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
          instagramHandle,
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
      assertCampaignStepsSupportedForChannel({
        channel: input.channel,
        steps: input.steps,
      });
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
      if (input.channel !== undefined || input.steps !== undefined) {
        const existing = await ctx.repos.campaigns.findById({
          userId: ctx.user.id,
          id: input.id,
        });
        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Campaign not found" });
        }
        assertCampaignStepsSupportedForChannel({
          channel: input.channel ?? existing.channel,
          steps: input.steps ?? existing.steps,
        });
      }
      const campaign = await ctx.repos.campaigns.update({
        ...input,
        userId: ctx.user.id,
      });
      return { campaign };
    }),

  pause: protectedCsrfProcedure.input(pauseCampaignBodySchema).mutation(async ({ ctx, input }) => {
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
      if (!input.dryRun && !isCampaignRunnableForManualDispatch(campaign)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Campanha está em ${campaign.status}; execução real exige running ou scheduled.`,
        });
      }
      if (!input.dryRun && campaign.channel !== "whatsapp") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Execução real por botão está liberada apenas para WhatsApp.",
        });
      }

      if (!input.dryRun && campaign.channel === "whatsapp") {
        const temporaryMessagesIssue = campaignTemporaryMessagesGateIssue(
          campaign,
          "Execução real",
        );
        if (temporaryMessagesIssue) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: temporaryMessagesIssue.message,
          });
        }
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
        const contact = conversation.contactId
          ? await ctx.repos.contacts.findById(conversation.contactId)
          : null;
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
        } else if (contact && !isContactRemarketingAllowed(contact)) {
          rejected.push({
            source: "conversation",
            value: conversation.id,
            reason: `contact_${contact.status}_suppressed`,
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
        if (!isContactRemarketingAllowed(contact)) {
          rejected.push({
            source: "contact",
            value: contactId,
            reason: `contact_${contact.status}_suppressed`,
          });
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
        const activePipeline = await ctx.repos.campaignRecipients.findActiveByPhone({
          userId: ctx.user.id,
          phone: candidate.phone,
          channel: "whatsapp",
        });
        if (activePipeline) {
          rejected.push({
            source: candidate.source,
            value: candidate.phone,
            reason: "active_pipeline_for_phone",
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

      if (accepted.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Execução real bloqueada: ${rejected[0]?.reason ?? "no_accepted_recipients"}.`,
        });
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

  tick: adminCsrfProcedure.input(tickCampaignBodySchema).mutation(async ({ ctx, input }) => {
    const dryRun = input?.dryRun ?? false;
    if (!dryRun && input?.confirmText !== "DISPARAR") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Confirmação inválida. Digite DISPARAR.",
      });
    }
    if (!dryRun) {
      if (!input?.campaignId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Disparo real exige selecionar uma campanha e validar Campanha pronta.",
        });
      }
      const readiness = await buildCampaignReadinessPreflight({
        repos: ctx.repos,
        env: ctx.env,
        userId: ctx.user.id,
        campaignId: input.campaignId,
        maxRecipients: 500,
        ownerId: `api:${ctx.user.id}:campaigns.tick.guard`,
      });
      if (!readiness.canEnqueue) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Enfileiramento bloqueado: ${readiness.issues
            .filter((issue) => issue.severity === "error")
            .map((issue) => issue.code)
            .join(", ")}`,
        });
      }
    }
    const result = await runCampaignSchedulerTick({
      repos: ctx.repos,
      userId: ctx.user.id,
      ownerId: `api:${ctx.user.id}`,
      campaignId: input?.campaignId,
      dryRun,
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

async function buildCampaignReadinessPreflight(input: {
  repos: Repositories;
  env: Parameters<typeof resolveApiSendPolicy>[0];
  userId: number;
  campaignId: number;
  maxRecipients: number;
  ownerId: string;
}): Promise<ReturnType<typeof buildCampaignReadinessReport>> {
  const campaign = await input.repos.campaigns.findById({
    userId: input.userId,
    id: input.campaignId,
  });
  if (!campaign) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Campaign not found" });
  }

  const recipients = await input.repos.campaignRecipients.listByCampaign({
    userId: input.userId,
    campaignId: campaign.id,
    statuses: ["queued", "running"],
    limit: input.maxRecipients,
  });
  const contactsById = new Map<number, Contact>();
  for (const contactId of recipients
    .map((recipient) => recipient.contactId)
    .filter((contactId): contactId is number => Boolean(contactId))) {
    if (contactsById.has(contactId)) continue;
    const contact = await input.repos.contacts.findById(contactId);
    if (contact && contact.userId === input.userId) {
      contactsById.set(contact.id, contact);
    }
  }
  const scheduler = await runCampaignSchedulerTick({
    repos: input.repos,
    userId: input.userId,
    ownerId: input.ownerId,
    campaignId: campaign.id,
    limit: input.maxRecipients,
    dryRun: true,
  });
  const sendPolicy = resolveApiSendPolicy(input.env);
  const instagramSession =
    campaign.channel === "instagram" ? await readInstagramSessionPreflight(input.repos) : null;

  return buildCampaignReadinessReport({
    campaign,
    recipients,
    contactsById,
    sendPolicy,
    scheduler,
    instagramSession,
  });
}

function buildCampaignReadinessReport(input: {
  campaign: Campaign;
  recipients: Array<{
    id: number;
    contactId: number | null;
    phone: string | null;
    channel: ChannelType;
    status: string;
    metadata: Record<string, unknown>;
  }>;
  contactsById: Map<number, Contact>;
  sendPolicy: ReturnType<typeof resolveApiSendPolicy>;
  scheduler: Awaited<ReturnType<typeof runCampaignSchedulerTick>>;
  instagramSession: InstagramSessionPreflight | null;
}) {
  const issues: Array<{
    code: string;
    severity: ReadinessSeverity;
    message: string;
    count?: number;
  }> = [];
  const error = (code: string, message: string, count?: number) =>
    issues.push({ code, severity: "error", message, ...(count !== undefined ? { count } : {}) });
  const info = (code: string, message: string, count?: number) =>
    issues.push({ code, severity: "info", message, ...(count !== undefined ? { count } : {}) });

  if (!isCampaignReadyForEnqueue(input.campaign)) {
    error(
      "campaign_status_not_runnable",
      `Campanha está em ${input.campaign.status}; use running ou scheduled para enfileirar.`,
    );
  }
  if (input.campaign.channel !== "whatsapp" && input.campaign.channel !== "instagram") {
    error(
      "channel_not_supported",
      "Remarketing seguro está liberado apenas para WhatsApp e Instagram.",
    );
  }
  if (input.campaign.steps.length === 0) {
    error("campaign_without_steps", "Campanha não tem steps configurados.");
  }
  const emptyTextSteps = input.campaign.steps.filter(
    (step) =>
      (step.type === "text" && !step.template.trim()) ||
      (step.type === "link" && !step.text.trim()),
  );
  if (emptyTextSteps.length > 0) {
    error("empty_message_step", "Há step de texto/link sem mensagem útil.", emptyTextSteps.length);
  }
  if (input.campaign.channel === "whatsapp") {
    const temporaryMessagesIssue = campaignTemporaryMessagesGateIssue(
      input.campaign,
      "Enfileiramento real",
    );
    if (temporaryMessagesIssue) {
      error(temporaryMessagesIssue.code, temporaryMessagesIssue.message);
    }
  }
  if (input.campaign.channel === "instagram") {
    const unsupportedSteps = input.campaign.steps.filter(
      (step) => !isInstagramCampaignStepSupported(step),
    );
    if (unsupportedSteps.length > 0) {
      error(
        "unsupported_instagram_steps",
        "Instagram na régua suporta texto, link, imagem e vídeo; remova temporárias, voz ou documento.",
        unsupportedSteps.length,
      );
    }
    const sessionIssue = instagramSessionBlockingIssue(input.instagramSession);
    if (sessionIssue) {
      error(sessionIssue.code, sessionIssue.message);
    }
  }

  const activeRecipients = input.recipients.filter(
    (recipient) => recipient.status === "queued" || recipient.status === "running",
  );
  if (activeRecipients.length === 0) {
    error("no_active_recipients", "Não há recipients queued/running para avaliar.");
  }

  const normalizedPhones = activeRecipients.map((recipient) => normalizePhone(recipient.phone));
  const normalizedInstagramHandles = activeRecipients.map((recipient) =>
    normalizeInstagramHandle(
      stringField(objectRecord(recipient.metadata), "instagramHandle") ??
        stringField(objectRecord(recipient.metadata), "instagram"),
    ),
  );
  if (input.campaign.channel === "whatsapp") {
    const invalidPhones = normalizedPhones.filter((phone) => !phone).length;
    if (invalidPhones > 0) {
      error("invalid_recipient_phone", "Recipients sem telefone WhatsApp válido.", invalidPhones);
    }
  }
  if (input.campaign.channel === "instagram") {
    const invalidHandles = normalizedInstagramHandles.filter((handle) => !handle).length;
    if (invalidHandles > 0) {
      error("invalid_recipient_instagram", "Recipients sem Instagram válido.", invalidHandles);
    }
  }

  const blockedContacts = activeRecipients.filter((recipient) => {
    const contact = recipient.contactId ? input.contactsById.get(recipient.contactId) : null;
    return contact ? !isContactRemarketingAllowed(contact) : false;
  });
  if (blockedContacts.length > 0) {
    error(
      "suppressed_contact",
      "Recipients ligados a contatos blocked/archived foram bloqueados para remarketing.",
      blockedContacts.length,
    );
  }

  if (input.campaign.channel === "whatsapp") {
    const duplicatePhones = countDuplicatePhones(normalizedPhones);
    if (duplicatePhones > 0) {
      error(
        "duplicate_recipient_phone",
        "Há mais de um recipient ativo para o mesmo telefone.",
        duplicatePhones,
      );
    }
  }

  const awaitingRecipients = activeRecipients.filter(
    (recipient) =>
      numberFromUnknown(recipient.metadata.awaitingJobId) > 0 ||
      arrayLength(recipient.metadata.awaitingJobIds) > 0,
  );
  if (awaitingRecipients.length > 0) {
    info(
      "recipient_already_waiting",
      "Alguns recipients já aguardam jobs anteriores e não serão reenfileirados agora.",
      awaitingRecipients.length,
    );
  }

  const allowedPhones = new Set(input.sendPolicy.allowedPhones);
  const eligiblePhones = normalizedPhones.filter((phone): phone is string => Boolean(phone));
  if (input.campaign.channel === "whatsapp") {
    const policyBlocked =
      input.sendPolicy.mode === "test"
        ? eligiblePhones.filter((phone) => !allowedPhones.has(phone)).length
        : allowedPhones.size > 0
          ? eligiblePhones.filter((phone) => !allowedPhones.has(phone)).length
          : 0;
    if (policyBlocked > 0) {
      error(
        "send_policy_blocks_recipients",
        "Política atual da API bloquearia parte dos telefones em envio real.",
        policyBlocked,
      );
    }
    if (input.sendPolicy.mode === "production" && allowedPhones.size === 0) {
      error(
        "production_without_canary_allowlist",
        "Produção sem allowlist canária bloqueia enfileiramento real.",
      );
    }
  }
  if (input.scheduler.plannedJobs.length === 0) {
    error("dry_run_without_jobs", "Dry-run forte não encontrou nenhum job pronto para enfileirar.");
  }
  for (const schedulerError of input.scheduler.errors) {
    error("scheduler_preview_error", schedulerError.error);
  }

  const errors = issues.filter((issue) => issue.severity === "error").length;
  return {
    campaign: input.campaign,
    generatedAt: new Date().toISOString(),
    canEnqueue: errors === 0,
    confirmText: "DISPARAR",
    summary: {
      steps: input.campaign.steps.length,
      recipientsActive: activeRecipients.length,
      phonesUnique: new Set(eligiblePhones).size,
      instagramUnique: new Set(
        normalizedInstagramHandles.filter((handle): handle is string => Boolean(handle)),
      ).size,
      plannedJobs: input.scheduler.plannedJobs.length,
      policyMode: input.sendPolicy.mode,
      allowedPhones: input.sendPolicy.allowedPhones.length,
      instagramSessionStatus: input.instagramSession?.status ?? null,
      instagramAuthenticated: input.instagramSession?.authenticated ?? null,
      instagramUsername: input.instagramSession?.username ?? null,
    },
    issues,
    scheduler: input.scheduler,
  };
}

async function buildRemarketingBatchPlan(input: {
  repos: Repositories;
  env: Parameters<typeof resolveApiSendPolicy>[0];
  userId: number;
  input: z.infer<typeof remarketingBatchBaseBodySchema>;
}): Promise<RemarketingBatchPlan> {
  const campaign = await input.repos.campaigns.findById({
    userId: input.userId,
    id: input.input.campaignId,
  });
  if (!campaign) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Campaign not found" });
  }

  const sendPolicy = resolveApiSendPolicy(input.env, [
    normalizeClientAllowedPhoneOverride(input.input.allowedPhone),
  ]);
  const existingRecipients = await input.repos.campaignRecipients.listByCampaign({
    userId: input.userId,
    campaignId: campaign.id,
    limit: 10_000,
  });
  const activeRecipients = existingRecipients.filter(
    (recipient) => recipient.status === "queued" || recipient.status === "running",
  );
  const activeCampaignStepJobs = (await input.repos.jobs.list(input.userId)).filter(
    (job) =>
      job.type === "campaign_step" &&
      (job.status === "queued" || job.status === "claimed" || job.status === "running") &&
      campaignStepJobMatchesChannel(job, campaign.channel),
  ).length;
  const instagramSession =
    campaign.channel === "instagram" ? await readInstagramSessionPreflight(input.repos) : null;
  const { accepted, candidates, rejected } = await collectRemarketingBatchCandidates({
    repos: input.repos,
    userId: input.userId,
    campaign,
    batch: input.input,
    existingRecipients,
    sendPolicy,
  });
  const issues = remarketingBatchIssues({
    campaign,
    sendPolicy,
    activeCampaignStepJobs,
    activeRecipients: activeRecipients.length,
    candidates: candidates.length,
    accepted: accepted.length,
    rejected,
    instagramAllowlistConfigured: Boolean(
      normalizeInstagramHandle(input.input.allowedInstagramHandle),
    ),
    instagramSession,
  });
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const temporaryMessages = temporaryMessagesSummary(campaign);

  return {
    campaign,
    generatedAt: new Date().toISOString(),
    canDispatch: errors === 0,
    confirmText: `DISPARAR LOTE ${accepted.length}`,
    temporaryMessages,
    summary: {
      candidates: candidates.length,
      acceptedRecipients: accepted.length,
      rejectedRecipients: rejected.length,
      plannedJobs: accepted.length * campaign.steps.length,
      steps: campaign.steps.length,
      policyMode: sendPolicy.mode,
      allowedPhones: sendPolicy.allowedPhones.length,
      activeCampaignStepJobs,
      activeRecipients: activeRecipients.length,
      instagramSession,
    },
    accepted,
    rejected,
    issues,
  };
}

async function collectRemarketingBatchCandidates(input: {
  repos: Repositories;
  userId: number;
  campaign: Campaign;
  batch: z.infer<typeof remarketingBatchBaseBodySchema>;
  existingRecipients: Array<{
    contactId: number | null;
    phone: string | null;
    metadata?: Record<string, unknown>;
  }>;
  sendPolicy: ReturnType<typeof resolveApiSendPolicy>;
}): Promise<{
  candidates: RemarketingBatchCandidate[];
  accepted: RemarketingBatchCandidate[];
  rejected: RemarketingBatchRejected[];
}> {
  const candidates: RemarketingBatchCandidate[] = [];
  const rejected: RemarketingBatchRejected[] = [];
  const instagramAllowedHandle = normalizeInstagramHandle(input.batch.allowedInstagramHandle);
  const addCandidate = (candidate: RemarketingBatchCandidate) => {
    candidates.push(candidate);
  };
  for (const contactId of input.batch.contactIds) {
    const contact = await input.repos.contacts.findById(contactId);
    if (!contact || contact.userId !== input.userId) {
      rejected.push({ source: "contact", value: contactId, reason: "not_found" });
      continue;
    }
    if (!isContactRemarketingAllowed(contact)) {
      rejected.push({
        source: "contact",
        value: contactId,
        reason: `contact_${contact.status}_suppressed`,
      });
      continue;
    }
    if (input.campaign.channel === "instagram") {
      const instagramHandle = normalizeInstagramHandle(contact.instagramHandle);
      if (!instagramHandle) {
        rejected.push({ source: "contact", value: contactId, reason: "missing_instagram" });
        continue;
      }
      addCandidate({
        contactId: contact.id,
        phone: null,
        instagramHandle,
        source: "contact",
        value: contact.id,
      });
    } else {
      const phone = normalizePhone(contact.phone);
      if (!phone) {
        rejected.push({ source: "contact", value: contactId, reason: "missing_phone" });
        continue;
      }
      addCandidate({
        contactId: contact.id,
        phone,
        instagramHandle: normalizeInstagramHandle(contact.instagramHandle),
        source: "contact",
        value: contact.id,
      });
    }
  }

  if (input.campaign.channel === "instagram") {
    for (const rawHandle of [
      ...splitRemarketingHandles(input.batch.rawInstagramHandles),
      ...input.batch.instagramHandles,
    ]) {
      const instagramHandle = normalizeInstagramHandle(rawHandle);
      if (!instagramHandle) {
        rejected.push({ source: "instagram", value: rawHandle, reason: "invalid_instagram" });
        continue;
      }
      addCandidate({
        contactId: null,
        phone: null,
        instagramHandle,
        source: "instagram",
        value: rawHandle,
      });
    }
  } else {
    for (const rawPhone of [
      ...splitRemarketingPhones(input.batch.rawPhones),
      ...input.batch.phones,
    ]) {
      const phone = normalizePhone(rawPhone);
      if (!phone) {
        rejected.push({ source: "phone", value: rawPhone, reason: "invalid_phone" });
        continue;
      }
      addCandidate({
        contactId: null,
        phone,
        instagramHandle: null,
        source: "phone",
        value: rawPhone,
      });
    }
  }

  const existingKeys = new Set(
    input.existingRecipients.map((recipient) => remarketingCandidateKey(recipient)),
  );
  const seen = new Set<string>();
  const accepted: RemarketingBatchCandidate[] = [];
  for (const candidate of candidates) {
    const key = remarketingCandidateKey(candidate);
    if (seen.has(key)) {
      rejected.push({
        source: candidate.source,
        value: candidate.value,
        reason: "duplicate_candidate",
      });
      continue;
    }
    seen.add(key);
    if (existingKeys.has(key)) {
      rejected.push({
        source: candidate.source,
        value: candidate.value,
        reason: "duplicate_recipient",
      });
      continue;
    }
    if (input.campaign.channel === "instagram") {
      if (!candidate.instagramHandle) {
        rejected.push({
          source: candidate.source,
          value: candidate.value,
          reason: "missing_instagram",
        });
        continue;
      }
      if (!instagramAllowedHandle) {
        rejected.push({
          source: candidate.source,
          value: candidate.value,
          reason: "instagram_allowlist_required",
        });
        continue;
      }
      if (candidate.instagramHandle !== instagramAllowedHandle) {
        rejected.push({
          source: candidate.source,
          value: candidate.value,
          reason: "instagram_handle_not_allowed",
        });
        continue;
      }
      const activePipeline = await input.repos.campaignRecipients.findActiveByInstagramHandle({
        userId: input.userId,
        instagramHandle: candidate.instagramHandle,
      });
      if (activePipeline) {
        rejected.push({
          source: candidate.source,
          value: candidate.value,
          reason: "active_pipeline_for_instagram",
        });
        continue;
      }
    } else {
      if (!candidate.phone) {
        rejected.push({
          source: candidate.source,
          value: candidate.value,
          reason: "missing_phone",
        });
        continue;
      }
      const activePipeline = await input.repos.campaignRecipients.findActiveByPhone({
        userId: input.userId,
        phone: candidate.phone,
        channel: "whatsapp",
      });
      if (activePipeline) {
        rejected.push({
          source: candidate.source,
          value: candidate.value,
          reason: "active_pipeline_for_phone",
        });
        continue;
      }
      const decision = evaluateApiRealSendTarget(input.sendPolicy, candidate.phone);
      if (!decision.allowed) {
        rejected.push({
          source: candidate.source,
          value: candidate.value,
          reason: decision.reason,
        });
        continue;
      }
    }
    if (accepted.length >= input.batch.maxRecipients) {
      rejected.push({
        source: candidate.source,
        value: candidate.value,
        reason: "max_recipients_exceeded",
      });
      continue;
    }
    accepted.push(candidate);
  }
  return { accepted, candidates, rejected };
}

function remarketingBatchIssues(input: {
  campaign: Campaign;
  sendPolicy: ReturnType<typeof resolveApiSendPolicy>;
  activeCampaignStepJobs: number;
  activeRecipients: number;
  candidates: number;
  accepted: number;
  rejected: RemarketingBatchRejected[];
  instagramAllowlistConfigured: boolean;
  instagramSession: InstagramSessionPreflight | null;
}): RemarketingBatchIssue[] {
  const issues: RemarketingBatchIssue[] = [];
  const error = (code: string, message: string, count?: number) =>
    issues.push({ code, severity: "error", message, ...(count !== undefined ? { count } : {}) });
  const info = (code: string, message: string, count?: number) =>
    issues.push({ code, severity: "info", message, ...(count !== undefined ? { count } : {}) });

  if (!isCampaignRunnableForManualDispatch(input.campaign)) {
    error(
      "campaign_status_not_runnable",
      `Campanha está em ${input.campaign.status}; lote real não dispara archived/completed.`,
    );
  }
  if (input.campaign.channel !== "whatsapp" && input.campaign.channel !== "instagram") {
    error(
      "channel_not_supported",
      "Remarketing em lote real está liberado apenas para WhatsApp e Instagram.",
    );
  }
  if (input.campaign.steps.length === 0) {
    error("campaign_without_steps", "Campanha não tem steps configurados.");
  }
  const emptyTextSteps = input.campaign.steps.filter(
    (step) =>
      (step.type === "text" && !step.template.trim()) ||
      (step.type === "link" && !step.text.trim()),
  );
  if (emptyTextSteps.length > 0) {
    error("empty_message_step", "Há step de texto/link sem mensagem útil.", emptyTextSteps.length);
  }
  if (input.campaign.channel === "instagram") {
    const unsupportedSteps = input.campaign.steps.filter(
      (step) => !isInstagramCampaignStepSupported(step),
    );
    if (unsupportedSteps.length > 0) {
      error(
        "unsupported_instagram_steps",
        "Instagram na régua suporta texto, link, imagem e vídeo; remova temporárias, voz ou documento.",
        unsupportedSteps.length,
      );
    }
    if (!input.instagramAllowlistConfigured) {
      error(
        "instagram_allowlist_required",
        "Lote real Instagram exige allowlist canária explícita.",
      );
    }
    const sessionIssue = instagramSessionBlockingIssue(input.instagramSession);
    if (sessionIssue) {
      error(sessionIssue.code, sessionIssue.message);
    }
  }

  if (input.campaign.channel === "whatsapp") {
    const temporaryMessages = temporaryMessagesSummary(input.campaign);
    const hasTemporaryMessagesControl = temporaryMessages.controlSteps.length > 0;
    if (!hasTemporaryMessagesControl && !temporaryMessages.enabled) {
      error(
        "temporary_messages_audit_only",
        "Lote real exige step ou configuração temporaryMessages M30.3 antes do envio.",
      );
    } else if (
      !hasTemporaryMessagesControl &&
      (temporaryMessages.beforeSendDuration !== "24h" ||
        temporaryMessages.afterCompletionDuration !== "90d")
    ) {
      error(
        "temporary_messages_global_not_m303",
        "temporaryMessages global precisa estar em 24h antes e 90d após conclusão.",
      );
    }
    if (input.sendPolicy.allowedPhones.length === 0) {
      error("send_policy_allowlist_required", "Lote real exige allowlist explícita de telefone.");
    }
    if (input.sendPolicy.mode === "production" && input.sendPolicy.allowedPhones.length === 0) {
      error(
        "production_without_canary_allowlist",
        "Produção sem allowlist canária bloqueia lote real.",
      );
    }
  }
  if (input.activeCampaignStepJobs > 0) {
    error(
      "active_campaign_step_jobs",
      "Há campaign_step queued/claimed/running; finalize ou limpe a fila antes do lote.",
      input.activeCampaignStepJobs,
    );
  }
  if (input.activeRecipients > 0) {
    error(
      "active_campaign_recipients",
      "A campanha já tem recipients queued/running; use o enfileiramento seguro existente antes de novo lote.",
      input.activeRecipients,
    );
  }
  if (input.candidates === 0) {
    error("empty_batch", "Informe ao menos um telefone, Instagram ou contato para o lote.");
  }
  if (input.rejected.length > 0) {
    error(
      "batch_has_rejections",
      "Lote parcial bloqueado; corrija todos os rejeitados.",
      input.rejected.length,
    );
  }
  if (input.accepted === 0) {
    error("no_accepted_recipients", "Nenhum recipient aceito pelos guardrails.");
  }
  if (input.accepted > 0) {
    info("accepted_recipients", "Recipients aceitos para enfileiramento real.", input.accepted);
  }
  return issues;
}

function splitRemarketingPhones(rawPhones: string): string[] {
  return rawPhones
    .split(/[\s,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function splitRemarketingHandles(rawHandles: string): string[] {
  return rawHandles
    .split(/[\s,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeInstagramHandle(value: string | null | undefined): string | null {
  const cleaned = String(value ?? "")
    .trim()
    .replace(/^ig:/i, "")
    .replace(/^@+/, "")
    .toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(cleaned) ? cleaned : null;
}

async function readInstagramSessionPreflight(
  repos: Repositories,
): Promise<InstagramSessionPreflight | null> {
  const workers = await repos.workerState.list();
  const now = Date.now();
  for (const worker of workers) {
    const heartbeatAgeSeconds = Math.max(
      0,
      Math.round((now - Date.parse(worker.heartbeatAt)) / 1000),
    );
    const stale = heartbeatAgeSeconds > 90;
    if (stale) continue;
    const instagram = objectRecord(worker.metrics.instagram);
    const session = objectRecord(instagram.session);
    if (Object.keys(session).length === 0) continue;
    return {
      status: stringField(session, "status") ?? "unknown",
      authenticated: session.authenticated === true,
      username: stringField(session, "username"),
      pageUrl: stringField(session, "pageUrl"),
      lastSyncAt: stringField(session, "lastSyncAt"),
      workerId: worker.workerId,
      workerStatus: worker.status,
      heartbeatAgeSeconds,
      stale,
      browserConnected: worker.browserConnected,
      lastError:
        stringField(instagram, "lastError") ??
        stringField(session, "errorMessage") ??
        worker.lastError,
    };
  }
  return null;
}

function instagramSessionBlockingIssue(
  session: InstagramSessionPreflight | null,
): { code: string; message: string } | null {
  if (!session) {
    return {
      code: "instagram_session_unavailable",
      message: "Nenhum worker online publicou sessão Instagram para validar o lote real.",
    };
  }
  if (session.lastError) {
    return {
      code: "instagram_session_error",
      message: `Sessão Instagram reportou erro: ${session.lastError}`,
    };
  }
  if (session.stale || !session.browserConnected) {
    return {
      code: "instagram_session_disconnected",
      message: "Sessão Instagram sem CDP conectado em worker online.",
    };
  }
  if (!session.authenticated || session.status !== "connected") {
    return {
      code: "instagram_session_not_authenticated",
      message: "Instagram precisa estar autenticado na sessão compartilhada antes do lote real.",
    };
  }
  return null;
}

function remarketingCandidateKey(input: {
  contactId: number | null;
  phone?: string | null;
  instagramHandle?: string | null;
  metadata?: Record<string, unknown>;
}): string {
  const phone = normalizePhone(input.phone ?? null);
  if (phone) {
    return `phone:${phone}`;
  }
  const instagramHandle = normalizeInstagramHandle(
    input.instagramHandle ??
      stringField(objectRecord(input.metadata), "instagramHandle") ??
      stringField(objectRecord(input.metadata), "instagram"),
  );
  if (instagramHandle) {
    return `instagram:${instagramHandle}`;
  }
  if (input.contactId) {
    return `contact:${input.contactId}`;
  }
  return "empty";
}

function campaignTemporaryMessagesGateIssue(
  campaign: Campaign,
  label: string,
): { code: string; message: string } | null {
  const temporaryMessages = temporaryMessagesSummary(campaign);
  const hasTemporaryMessagesControl = temporaryMessages.controlSteps.length > 0;
  if (hasTemporaryMessagesControl) {
    return null;
  }
  if (!temporaryMessages.enabled) {
    return {
      code: "temporary_messages_audit_only",
      message: `${label} exige step ou configuracao temporaryMessages M30.3 antes do envio.`,
    };
  }
  if (
    temporaryMessages.beforeSendDuration !== "24h" ||
    temporaryMessages.afterCompletionDuration !== "90d"
  ) {
    return {
      code: "temporary_messages_global_not_m303",
      message: `${label} exige temporaryMessages global em 24h antes e 90d apos conclusao.`,
    };
  }
  return null;
}

function temporaryMessagesSummary(campaign: Campaign): RemarketingBatchPlan["temporaryMessages"] {
  const controlSteps = campaign.steps
    .filter(
      (step): step is Extract<Campaign["steps"][number], { type: "temporary_messages" }> =>
        step.type === "temporary_messages",
    )
    .map((step) => ({ stepId: step.id, label: step.label, duration: step.duration }));
  const parsed = campaignTemporaryMessagesConfigSchema.safeParse(
    campaign.metadata.temporaryMessages,
  );
  if (!parsed.success || !parsed.data.enabled) {
    return {
      enabled: false,
      beforeSendDuration: null,
      afterCompletionDuration: null,
      restoreOnFailure: null,
      controlSteps,
    };
  }
  return {
    enabled: true,
    beforeSendDuration: parsed.data.beforeSendDuration,
    afterCompletionDuration: parsed.data.afterCompletionDuration,
    restoreOnFailure: parsed.data.restoreOnFailure,
    controlSteps,
  };
}

async function evaluateCampaignForConversation(input: {
  campaign: Campaign;
  conversation: {
    id: number;
    channel: ChannelType;
    contactId: number | null;
    phone: string | null;
    instagramHandle: string | null;
  };
  existingRecipients: Array<{
    contactId: number | null;
    phone: string | null;
    metadata?: Record<string, unknown>;
  }>;
}) {
  const reasons: string[] = [];
  const firstStep = input.campaign.steps[0] ?? null;
  const existingKeys = new Set(
    input.existingRecipients.map((recipient) => remarketingCandidateKey(recipient)),
  );
  const recipientKey = input.conversation.contactId
    ? `contact:${input.conversation.contactId}`
    : input.conversation.channel === "instagram" && input.conversation.instagramHandle
      ? `instagram:${input.conversation.instagramHandle}`
      : input.conversation.phone
        ? `phone:${input.conversation.phone}`
        : null;

  if (!isCampaignRunnableForManualDispatch(input.campaign)) {
    reasons.push("status_not_runnable");
  }
  if (input.conversation.channel !== "whatsapp" && input.conversation.channel !== "instagram") {
    reasons.push("channel_not_supported");
  }
  if (input.campaign.channel !== input.conversation.channel) {
    reasons.push("channel_mismatch");
  }
  if (input.conversation.channel === "whatsapp" && !input.conversation.phone) {
    reasons.push("invalid_phone");
  }
  if (input.conversation.channel === "instagram" && !input.conversation.instagramHandle) {
    reasons.push("invalid_instagram");
  }
  if (
    input.conversation.channel === "instagram" &&
    input.campaign.steps.some((step) => !isInstagramCampaignStepSupported(step))
  ) {
    reasons.push("unsupported_instagram_step");
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
          value:
            input.conversation.instagramHandle ?? input.conversation.phone ?? input.conversation.id,
          reason,
        })),
  };
}

function isCampaignRunnableForManualDispatch(campaign: Campaign): boolean {
  return campaign.status === "running" || campaign.status === "scheduled";
}

function isCampaignReadyForEnqueue(campaign: Campaign): boolean {
  return campaign.status === "running" || campaign.status === "scheduled";
}

function assertCampaignStepsSupportedForChannel(input: {
  channel: ChannelType;
  steps: Campaign["steps"];
}): void {
  if (input.channel !== "instagram") {
    return;
  }
  const unsupportedSteps = input.steps.filter((step) => !isInstagramCampaignStepSupported(step));
  if (unsupportedSteps.length > 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Instagram na régua suporta texto, link, imagem e vídeo; remova temporárias, voz ou documento.",
    });
  }
}

function isContactRemarketingAllowed(contact: Contact): boolean {
  return contact.status !== "blocked" && contact.status !== "archived" && !contact.deletedAt;
}

function countDuplicatePhones(phones: Array<string | null>): number {
  const counts = new Map<string, number>();
  for (const phone of phones) {
    if (!phone) continue;
    counts.set(phone, (counts.get(phone) ?? 0) + 1);
  }
  return [...counts.values()].filter((count) => count > 1).length;
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function numberFromUnknown(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}

function deriveConversationPhone(
  conversation: { externalThreadId: string; title: string; waJid?: string | null } | null,
): string | null {
  if (!conversation) return null;
  return normalizePhone(conversation.waJid) ?? normalizePhone(conversation.externalThreadId);
}

function deriveConversationInstagramHandle(
  conversation: { channel: ChannelType; externalThreadId: string; title: string } | null,
): string | null {
  if (!conversation || conversation.channel !== "instagram") return null;
  return normalizeInstagramHandle(conversation.externalThreadId);
}

function isInstagramCampaignStepSupported(step: Campaign["steps"][number]): boolean {
  return (
    step.type === "text" || step.type === "link" || step.type === "image" || step.type === "video"
  );
}

function campaignStepJobMatchesChannel(job: Job, channel: ChannelType): boolean {
  if (channel === "instagram") {
    return Boolean(
      normalizeInstagramHandle(
        typeof job.payload.instagramHandle === "string" ? job.payload.instagramHandle : null,
      ),
    );
  }
  if (channel === "whatsapp") {
    return Boolean(
      normalizePhone(typeof job.payload.phone === "string" ? job.payload.phone : null),
    );
  }
  return true;
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
    const stepEvents = input.events.filter(
      (event) => payloadField(event.payload, "stepId") === step.id,
    );
    const completedEvents = stepEvents.filter(
      (event) => event.type === "sender.campaign_step.completed",
    );
    const failedEvents = stepEvents.filter((event) => event.type === "sender.campaign_step.failed");
    const completedRecipients = uniqueNumericPayloadValues(completedEvents, "recipientId");
    const failedRecipients = uniqueNumericPayloadValues(failedEvents, "recipientId");
    const currentRecipients = input.recipients.filter(
      (recipient) => recipient.currentStepId === step.id,
    );
    const awaitingRecipients = input.recipients.filter(
      (recipient) => recipient.metadata.awaitingStepId === step.id,
    );
    const navigationCounts = {
      navigated: stepEvents.filter(
        (event) => payloadField(event.payload, "navigationMode") === "navigated",
      ).length,
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

function materializedRecipientAuditTimeline(
  metadata: Record<string, unknown>,
  recipientId: number,
  campaignId: number,
) {
  const auditTrail = Array.isArray(metadata.auditTrail) ? metadata.auditTrail : [];
  return auditTrail.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }
    const payload = entry as Record<string, unknown>;
    const createdAt =
      typeof payload.at === "string" && payload.at.trim()
        ? payload.at
        : typeof payload.createdAt === "string" && payload.createdAt.trim()
          ? payload.createdAt
          : new Date(0).toISOString();
    const severity =
      payload.status === "failed" || payload.terminal === true
        ? "error"
        : payload.status === "skipped" || payload.status === "warn" || payload.verified === false
          ? "warn"
          : "info";
    return [
      {
        id: -(recipientId * 10_000 + index + 1),
        type: `campaign.recipient.${String(payload.event ?? "audit")}`,
        severity,
        payload: {
          campaignId,
          recipientId,
          materialized: true,
          ...payload,
        },
        createdAt,
      },
    ];
  });
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

function uniqueNumericPayloadValues(events: Array<{ payload: unknown }>, key: string): Set<number> {
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
