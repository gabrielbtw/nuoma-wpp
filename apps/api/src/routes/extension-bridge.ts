import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import type { ApiEnv } from "@nuoma/config";
import type { Repositories } from "@nuoma/db";

import { buildExtensionOverlaySnapshot } from "../services/extension-overlay.js";
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
    const phoneSource = stringValue(overlayRequest.params.phoneSource);
    try {
      if (overlayRequest.method === "ping") {
        await auditExtensionOverlayRequest({
          repos: deps.repos,
          userId: user.id,
          request: overlayRequest,
          ok: true,
          latencyMs: Date.now() - startedAt,
          phone,
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
          phoneSource,
          title: stringValue(overlayRequest.params.title),
          reason: stringValue(overlayRequest.params.reason) ?? "chrome-extension",
        });
        await auditExtensionOverlayRequest({
          repos: deps.repos,
          userId: user.id,
          request: overlayRequest,
          ok: true,
          latencyMs: Date.now() - startedAt,
          phone: snapshot.phone,
          phoneSource: snapshot.phoneSource,
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

      await auditExtensionOverlayRequest({
        repos: deps.repos,
        userId: user.id,
        request: overlayRequest,
        ok: false,
        latencyMs: Date.now() - startedAt,
        phone,
        phoneSource,
        errorCode: "unsupported_method",
        errorMessage: `Unsupported Chrome extension overlay method: ${overlayRequest.method}`,
      });
      return reply.send({
        ok: false,
        error: {
          code: "unsupported_method",
          message:
            "A extensao Chrome M38 aceita apenas metodos de leitura. Mutacoes continuam no worker/CDP.",
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
