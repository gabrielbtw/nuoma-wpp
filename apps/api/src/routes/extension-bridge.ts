import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import type { ApiEnv } from "@nuoma/config";
import { normalizePhone, normalizeWaJid } from "@nuoma/contracts";
import type { Repositories } from "@nuoma/db";

import { buildExtensionOverlaySnapshot } from "../services/extension-overlay.js";
import { isWithin24hWindow, runOverlayAutomationNow } from "../services/overlay-automations.js";
import { runOverlayCampaignNow } from "../services/overlay-campaigns.js";
import {
  applyOverlayQuickAction,
  listOverlayAutomationHistory,
  type OverlayQuickActionName,
} from "../services/overlay-quick-actions.js";
import { resolveApiSendPolicy } from "../services/send-policy.js";
import { verifyAccessToken, type AuthUser } from "../trpc/auth.js";
import { ACCESS_COOKIE, readCookie } from "../trpc/cookies.js";

const overlayRequestSchema = z.object({
  id: z.string().min(1).max(200),
  method: z.string().min(1).max(80),
  params: z.record(z.string(), z.unknown()).optional().default({}),
  mutation: z
    .object({
      nonce: z.string().optional(),
      idempotencyKey: z.string().optional(),
      confirmed: z.boolean().optional(),
    })
    .passthrough()
    .nullable()
    .optional(),
  version: z.string().max(120).optional(),
  requestedAt: z.string().max(120).optional(),
});

type OverlayRequest = z.infer<typeof overlayRequestSchema>;

export async function registerExtensionBridgeRoutes(
  app: FastifyInstance,
  deps: { env: ApiEnv; repos: Repositories },
): Promise<void> {
  app.post("/api/extension/overlay", async (request, reply) => {
    const user = await authenticateRequest(request, reply, deps.env);
    if (!user) {
      return reply;
    }

    const parsed = overlayRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      await auditExtensionOverlayRequest({
        repos: deps.repos,
        userId: user.id,
        request: null,
        ok: false,
        latencyMs: 0,
        errorCode: "invalid_payload",
        errorMessage: parsed.error.message,
      });
      return reply.code(400).send({
        ok: false,
        error: { code: "invalid_payload", message: "Invalid extension overlay payload" },
      });
    }

    const startedAt = Date.now();
    const overlayRequest = parsed.data;
    const phone = stringValue(overlayRequest.params.phone);
    const waJid = stringValue(overlayRequest.params.waJid);
    const targetIdentity = resolveOverlayRequestIdentity(phone, waJid);
    const targetPhone = targetIdentity.ok ? targetIdentity.phone : null;
    const phoneSource = stringValue(overlayRequest.params.phoneSource);
    const sendPolicy = resolveApiSendPolicy(deps.env);
    try {
      if (overlayRequest.method === "ping") {
        await auditExtensionOverlayRequest({
          repos: deps.repos,
          userId: user.id,
          request: overlayRequest,
          ok: true,
          latencyMs: Date.now() - startedAt,
          phone,
          waJid,
          phoneSource,
        });
        return reply.send({
          ok: true,
          data: {
            pong: true,
            source: "chrome-extension-api",
            version: overlayRequest.version ?? null,
            observedAtUtc: new Date().toISOString(),
          },
        });
      }

      if (overlayRequest.method === "contactSummary") {
        const snapshot = await buildExtensionOverlaySnapshot({
          repos: deps.repos,
          userId: user.id,
          phone,
          waJid,
          phoneSource,
          title: stringValue(overlayRequest.params.title),
          reason: stringValue(overlayRequest.params.reason) ?? "chrome-extension",
          sendPolicy,
        });
        await auditExtensionOverlayRequest({
          repos: deps.repos,
          userId: user.id,
          request: overlayRequest,
          ok: true,
          latencyMs: Date.now() - startedAt,
          phone: snapshot.phone,
          phoneSource: snapshot.phoneSource,
          waJid: snapshot.waJid,
        });
        return reply.send({
          ok: true,
          data: {
            ...snapshot,
            apiStatus: "online",
            apiLastMethod: overlayRequest.method,
            apiLastError: null,
          },
        });
      }

      if (overlayRequest.method === "automationHistory") {
        if (!targetIdentity.ok) {
          await auditExtensionOverlayRequest({
            repos: deps.repos,
            userId: user.id,
            request: overlayRequest,
            ok: false,
            latencyMs: Date.now() - startedAt,
            phone,
            waJid,
            phoneSource,
            errorCode: targetIdentity.errorCode,
            errorMessage: targetIdentity.errorMessage,
          });
          return reply.code(400).send({
            ok: false,
            error: {
              code: targetIdentity.errorCode,
              message: targetIdentity.errorMessage,
            },
          });
        }
        const automationHistory = await listOverlayAutomationHistory({
          repos: deps.repos,
          userId: user.id,
          phone: targetPhone,
          limit: positiveIntegerValue(overlayRequest.params.limit) ?? 5,
        });
        await auditExtensionOverlayRequest({
          repos: deps.repos,
          userId: user.id,
          request: overlayRequest,
          ok: true,
          latencyMs: Date.now() - startedAt,
          phone: targetPhone,
          waJid,
          phoneSource,
        });
        return reply.send({
          ok: true,
          data: {
            automationHistory,
            apiStatus: "online",
            apiLastMethod: overlayRequest.method,
            apiLastError: null,
          },
        });
      }

      if (overlayRequest.method === "runCampaignForPhone") {
        const mutationCheck = validateOverlayMutation(overlayRequest);
        if (!mutationCheck.ok) {
          await auditExtensionOverlayRequest({
            repos: deps.repos,
            userId: user.id,
            request: overlayRequest,
            ok: false,
            latencyMs: Date.now() - startedAt,
            phone,
            waJid,
            phoneSource,
            errorCode: mutationCheck.errorCode,
            errorMessage: mutationCheck.errorMessage,
          });
          return reply.code(400).send({
            ok: false,
            error: {
              code: mutationCheck.errorCode,
              message: mutationCheck.errorMessage,
            },
          });
        }
        if (!targetIdentity.ok) {
          await auditExtensionOverlayRequest({
            repos: deps.repos,
            userId: user.id,
            request: overlayRequest,
            ok: false,
            latencyMs: Date.now() - startedAt,
            phone,
            waJid,
            phoneSource,
            errorCode: targetIdentity.errorCode,
            errorMessage: targetIdentity.errorMessage,
          });
          return reply.code(400).send({
            ok: false,
            error: {
              code: targetIdentity.errorCode,
              message: targetIdentity.errorMessage,
            },
          });
        }
        const campaignId = positiveIntegerValue(overlayRequest.params.campaignId);
        if (!campaignId) {
          return reply.code(400).send({
            ok: false,
            error: { code: "invalid_campaign", message: "Campaign id is required" },
          });
        }
        const result = await runOverlayCampaignNow({
          repos: deps.repos,
          userId: user.id,
          campaignId,
          phone: targetPhone,
          sendPolicy,
          ownerId: `extension-overlay:${user.id}`,
          source: "extension.overlay",
          idempotencyKey: overlayRequest.mutation?.idempotencyKey ?? null,
        });
        const snapshot = await buildExtensionOverlaySnapshot({
          repos: deps.repos,
          userId: user.id,
          phone: result.phone ?? targetPhone,
          waJid,
          phoneSource,
          title: stringValue(overlayRequest.params.title),
          reason: "chrome-extension:runCampaignForPhone",
          sendPolicy,
        });
        const ok = result.rejected.length === 0 && result.recipientsCreated > 0;
        await auditExtensionOverlayRequest({
          repos: deps.repos,
          userId: user.id,
          request: overlayRequest,
          ok,
          latencyMs: Date.now() - startedAt,
          phone: result.phone ?? targetPhone,
          phoneSource,
          errorCode: ok ? undefined : (result.rejected[0]?.reason ?? "campaign_blocked"),
          errorMessage: ok ? undefined : "Overlay campaign dispatch blocked",
        });
        return reply.send({
          ok,
          data: {
            result,
            snapshot: {
              ...snapshot,
              apiStatus: ok ? "online" : "error",
              apiLastMethod: overlayRequest.method,
              apiLastError: ok ? null : (result.rejected[0]?.reason ?? "campaign_blocked"),
            },
          },
          ...(ok
            ? {}
            : {
                error: {
                  code: result.rejected[0]?.reason ?? "campaign_blocked",
                  message: "Campanha bloqueada pelos guardrails.",
                },
              }),
        });
      }

      if (overlayRequest.method === "runAutomationForPhone") {
        const mutationCheck = validateOverlayMutation(overlayRequest);
        if (!mutationCheck.ok) {
          await auditExtensionOverlayRequest({
            repos: deps.repos,
            userId: user.id,
            request: overlayRequest,
            ok: false,
            latencyMs: Date.now() - startedAt,
            phone,
            waJid,
            phoneSource,
            errorCode: mutationCheck.errorCode,
            errorMessage: mutationCheck.errorMessage,
          });
          return reply.code(400).send({
            ok: false,
            error: {
              code: mutationCheck.errorCode,
              message: mutationCheck.errorMessage,
            },
          });
        }
        if (!targetIdentity.ok) {
          await auditExtensionOverlayRequest({
            repos: deps.repos,
            userId: user.id,
            request: overlayRequest,
            ok: false,
            latencyMs: Date.now() - startedAt,
            phone,
            waJid,
            phoneSource,
            errorCode: targetIdentity.errorCode,
            errorMessage: targetIdentity.errorMessage,
          });
          return reply.code(400).send({
            ok: false,
            error: {
              code: targetIdentity.errorCode,
              message: targetIdentity.errorMessage,
            },
          });
        }
        const automationId = positiveIntegerValue(overlayRequest.params.automationId);
        if (!automationId) {
          return reply.code(400).send({
            ok: false,
            error: { code: "invalid_automation", message: "Automation id is required" },
          });
        }
        const conversation = await findExtensionOverlayConversation({
          repos: deps.repos,
          userId: user.id,
          phone: targetPhone,
          waJid,
        });
        const result = await runOverlayAutomationNow({
          repos: deps.repos,
          userId: user.id,
          automationId,
          phone: targetPhone,
          sendPolicy,
          conversationId: conversation?.id ?? null,
          within24hWindow: isWithin24hWindow(conversation?.lastMessageAt),
          source: "extension.overlay",
          idempotencyKey: overlayRequest.mutation?.idempotencyKey ?? null,
        });
        const snapshot = await buildExtensionOverlaySnapshot({
          repos: deps.repos,
          userId: user.id,
          phone: result.phone ?? targetPhone,
          waJid,
          phoneSource,
          title: stringValue(overlayRequest.params.title),
          reason: "chrome-extension:runAutomationForPhone",
          sendPolicy,
        });
        const ok = result.eligible && result.rejected.length === 0;
        await auditExtensionOverlayRequest({
          repos: deps.repos,
          userId: user.id,
          request: overlayRequest,
          ok,
          latencyMs: Date.now() - startedAt,
          phone: result.phone ?? targetPhone,
          phoneSource,
          errorCode: ok ? undefined : (result.rejected[0]?.reason ?? "automation_blocked"),
          errorMessage: ok ? undefined : "Overlay automation dispatch blocked",
        });
        return reply.send({
          ok,
          data: {
            result,
            snapshot: {
              ...snapshot,
              apiStatus: ok ? "online" : "error",
              apiLastMethod: overlayRequest.method,
              apiLastError: ok ? null : (result.rejected[0]?.reason ?? "automation_blocked"),
              automationRunStatus: ok ? "done" : "error",
              automationRunLastResult: result,
              automationRunLastError: ok
                ? null
                : (result.rejected[0]?.reason ?? "automation_blocked"),
            },
          },
          ...(ok
            ? {}
            : {
                error: {
                  code: result.rejected[0]?.reason ?? "automation_blocked",
                  message: "Automacao bloqueada pelos guardrails.",
                },
              }),
        });
      }

      if (isOverlayQuickActionMethod(overlayRequest.method)) {
        const mutationCheck = validateOverlayMutation(overlayRequest);
        if (!mutationCheck.ok) {
          await auditExtensionOverlayRequest({
            repos: deps.repos,
            userId: user.id,
            request: overlayRequest,
            ok: false,
            latencyMs: Date.now() - startedAt,
            phone,
            waJid,
            phoneSource,
            errorCode: mutationCheck.errorCode,
            errorMessage: mutationCheck.errorMessage,
          });
          return reply.code(400).send({
            ok: false,
            error: {
              code: mutationCheck.errorCode,
              message: mutationCheck.errorMessage,
            },
          });
        }
        if (!targetIdentity.ok) {
          await auditExtensionOverlayRequest({
            repos: deps.repos,
            userId: user.id,
            request: overlayRequest,
            ok: false,
            latencyMs: Date.now() - startedAt,
            phone,
            waJid,
            phoneSource,
            errorCode: targetIdentity.errorCode,
            errorMessage: targetIdentity.errorMessage,
          });
          return reply.code(400).send({
            ok: false,
            error: {
              code: targetIdentity.errorCode,
              message: targetIdentity.errorMessage,
            },
          });
        }
        const result = await applyOverlayQuickAction({
          repos: deps.repos,
          userId: user.id,
          phone: targetPhone,
          waJid,
          action: overlayRequest.method,
          tagId: positiveIntegerValue(overlayRequest.params.tagId),
          status: stringValue(overlayRequest.params.status),
          reminderTitle: stringValue(overlayRequest.params.title),
          reminderDueAt: stringValue(overlayRequest.params.dueAt),
          reminderNotes: stringValue(overlayRequest.params.notes),
          source: "extension.overlay",
        });
        const snapshot = await buildExtensionOverlaySnapshot({
          repos: deps.repos,
          userId: user.id,
          phone: targetPhone,
          waJid,
          phoneSource,
          title: stringValue(overlayRequest.params.threadTitle),
          reason: `chrome-extension:${overlayRequest.method}`,
          sendPolicy,
        });
        await auditExtensionOverlayRequest({
          repos: deps.repos,
          userId: user.id,
          request: overlayRequest,
          ok: result.ok,
          latencyMs: Date.now() - startedAt,
          phone: targetPhone,
          waJid,
          phoneSource,
          errorCode: result.ok ? undefined : (result.rejected[0]?.reason ?? "quick_action_blocked"),
          errorMessage: result.ok ? undefined : "Overlay quick action blocked",
        });
        return reply.send({
          ok: result.ok,
          data: {
            result,
            snapshot: {
              ...snapshot,
              apiStatus: result.ok ? "online" : "error",
              apiLastMethod: overlayRequest.method,
              apiLastError: result.ok
                ? null
                : (result.rejected[0]?.reason ?? "quick_action_blocked"),
            },
          },
          ...(result.ok
            ? {}
            : {
                error: {
                  code: result.rejected[0]?.reason ?? "quick_action_blocked",
                  message: "Acao rapida bloqueada para este contato.",
                },
              }),
        });
      }

      await auditExtensionOverlayRequest({
        repos: deps.repos,
        userId: user.id,
        request: overlayRequest,
        ok: false,
        latencyMs: Date.now() - startedAt,
        phone,
        waJid,
        phoneSource,
        errorCode: "unsupported_method",
        errorMessage: `Unsupported extension companion overlay method: ${overlayRequest.method}`,
      });
      return reply.send({
        ok: false,
        error: {
          code: "unsupported_method",
          message:
            "O companion de extensao aceita resumo e disparos guardados de campanha/automacao no numero atual.",
        },
      });
    } catch (error) {
      await auditExtensionOverlayRequest({
        repos: deps.repos,
        userId: user.id,
        request: overlayRequest,
        ok: false,
        latencyMs: Date.now() - startedAt,
        phone,
        waJid,
        phoneSource,
        errorCode: "handler_error",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      return reply.code(500).send({
        ok: false,
        error: { code: "handler_error", message: "Extension overlay bridge failed" },
      });
    }
  });
}

async function authenticateRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  env: ApiEnv,
): Promise<AuthUser | null> {
  const token = readCookie(request, ACCESS_COOKIE) ?? bearerToken(request);
  if (!token) {
    reply.code(401).send({ error: "Unauthorized" });
    return null;
  }
  try {
    return await verifyAccessToken(env, token);
  } catch {
    reply.code(401).send({ error: "Unauthorized" });
    return null;
  }
}

function bearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  if (!value?.startsWith("Bearer ")) {
    return undefined;
  }
  return value.slice("Bearer ".length).trim() || undefined;
}

async function auditExtensionOverlayRequest(input: {
  repos: Repositories;
  userId: number;
  request: OverlayRequest | null;
  ok: boolean;
  latencyMs: number;
  phone?: string | null;
  waJid?: string | null;
  phoneSource?: string | null;
  errorCode?: string;
  errorMessage?: string;
}): Promise<void> {
  await input.repos.systemEvents.create({
    userId: input.userId,
    type: "extension.overlay_api.request",
    severity: input.ok ? "info" : "warn",
    payload: JSON.stringify({
      requestId: input.request?.id ?? null,
      method: input.request?.method ?? null,
      version: input.request?.version ?? null,
      hasMutationGuard: Boolean(input.request?.mutation),
      phone: input.phone ?? null,
      waJid: input.waJid ?? null,
      phoneSource: input.phoneSource ?? null,
      ok: input.ok,
      latencyMs: input.latencyMs,
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
      auditedAtUtc: new Date().toISOString(),
    }),
  });
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function positiveIntegerValue(value: unknown): number | null {
  const numeric =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function isOverlayQuickActionMethod(method: string): method is OverlayQuickActionName {
  return (
    method === "applyTag" ||
    method === "removeTag" ||
    method === "setStatus" ||
    method === "createReminder"
  );
}

function resolveOverlayRequestIdentity(
  phoneValue: string | null,
  waJidValue: string | null,
):
  | { ok: true; phone: string | null; waJid: string | null }
  | { ok: false; errorCode: string; errorMessage: string } {
  const waJid = normalizeWaJid(waJidValue ?? phoneValue);
  const phone = normalizePhone(phoneValue) ?? normalizePhone(waJid);
  const requestedPhone = normalizePhone(phoneValue);
  const waJidPhone = normalizePhone(waJid);
  if (requestedPhone && waJidPhone && requestedPhone !== waJidPhone) {
    return {
      ok: false,
      errorCode: "overlay_thread_mismatch",
      errorMessage: "Requested phone does not match requested WhatsApp identity",
    };
  }
  if (!phone && !waJid) {
    return {
      ok: false,
      errorCode: "invalid_phone",
      errorMessage: "Overlay request does not expose a valid phone",
    };
  }
  return { ok: true, phone, waJid };
}

async function findExtensionOverlayConversation(input: {
  repos: Repositories;
  userId: number;
  phone: string | null;
  waJid: string | null;
}) {
  const waJid = normalizeWaJid(input.waJid ?? input.phone);
  const phone = normalizePhone(input.phone) ?? normalizePhone(waJid);
  if (waJid) {
    const conversation = await input.repos.conversations.findByWaJid({
      userId: input.userId,
      waJid,
    });
    if (conversation) return conversation;
  }
  const conversations = await input.repos.conversations.list(input.userId, 100);
  return (
    conversations.find((conversation) => {
      if (waJid) {
        const conversationWaJid =
          normalizeWaJid(conversation.waJid) ?? normalizeWaJid(conversation.externalThreadId);
        if (conversationWaJid === waJid) {
          return true;
        }
      }
      return Boolean(phone && normalizePhone(conversation.externalThreadId) === phone);
    }) ?? null
  );
}

function validateOverlayMutation(
  request: OverlayRequest,
): { ok: true } | { ok: false; errorCode: string; errorMessage: string } {
  if (!request.mutation) {
    return {
      ok: false,
      errorCode: "mutation_guard_required",
      errorMessage: "Sensitive overlay methods require mutation guard metadata",
    };
  }
  if (!request.mutation.confirmed) {
    return {
      ok: false,
      errorCode: "mutation_confirmation_required",
      errorMessage: "Sensitive overlay methods require explicit confirmation",
    };
  }
  if (!request.mutation.nonce || !request.mutation.idempotencyKey) {
    return {
      ok: false,
      errorCode: "mutation_idempotency_required",
      errorMessage: "Sensitive overlay methods require nonce and idempotency key",
    };
  }
  return { ok: true };
}
