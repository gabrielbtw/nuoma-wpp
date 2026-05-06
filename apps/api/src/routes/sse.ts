import type { FastifyReply, FastifyRequest } from "fastify";

import type { ApiEnv } from "@nuoma/config";

import { verifyAccessToken, type AuthUser } from "../trpc/auth.js";
import { ACCESS_COOKIE, readCookie } from "../trpc/cookies.js";

export async function authenticateSseRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  env: ApiEnv,
): Promise<AuthUser | null> {
  const token = readCookie(request, ACCESS_COOKIE);
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

export function startSse(reply: FastifyReply, origin: unknown, comment: string): void {
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    Vary: "Origin",
    ...(typeof origin === "string"
      ? {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Credentials": "true",
        }
      : {}),
  });
  reply.raw.write(`: ${comment}\n\n`);
  reply.hijack();
}

export function sendSse(reply: FastifyReply, event: string, data: unknown, id?: string): void {
  if (reply.raw.destroyed || reply.raw.writableEnded) {
    return;
  }
  if (id) {
    reply.raw.write(`id: ${id}\n`);
  }
  reply.raw.write(`event: ${event}\n`);
  reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
}
