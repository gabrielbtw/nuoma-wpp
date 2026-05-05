import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { ApiEnv } from "@nuoma/config";
import type { Conversation } from "@nuoma/contracts";
import type { Repositories } from "@nuoma/db";

import { verifyAccessToken, type AuthUser } from "../trpc/auth.js";
import { ACCESS_COOKIE, readCookie } from "../trpc/cookies.js";

const pollMs = 2_000;

interface ChangedConversation {
  conversation: Conversation;
  previousRank: number | null;
  nextRank: number;
}

export async function registerInboxEventsRoutes(
  app: FastifyInstance,
  deps: { env: ApiEnv; repos: Repositories },
): Promise<void> {
  app.get("/api/inbox/events", async (request, reply) => {
    const user = await authenticateRequest(request, reply, deps.env);
    if (!user) return reply;
    const userId = user.id;

    const origin = request.headers.origin;
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
    reply.raw.write(": nuoma inbox stream\n\n");
    reply.hijack();

    let closed = false;
    let initialized = false;
    let lastSignature = new Map<number, string>();
    let lastRank = new Map<number, number>();

    const close = () => {
      closed = true;
      clearInterval(interval);
    };

    async function tick() {
      if (closed) return;
      try {
        const conversations = await deps.repos.conversations.list(userId, 200);
        const nextSignature = new Map<number, string>();
        const nextRank = new Map<number, number>();
        const changed: ChangedConversation[] = [];

        for (const [index, conversation] of conversations.entries()) {
          const signature = conversationSignature(conversation);
          nextSignature.set(conversation.id, signature);
          nextRank.set(conversation.id, index);
          if (initialized && lastSignature.get(conversation.id) !== signature) {
            changed.push({
              conversation,
              previousRank: lastRank.get(conversation.id) ?? null,
              nextRank: index,
            });
          }
        }

        const observedAt = new Date().toISOString();
        if (!initialized) {
          sendSse(reply, "inbox-ready", {
            conversationCount: conversations.length,
            pollMs,
            observedAt,
          });
          initialized = true;
        } else {
          for (const change of changed) {
            sendSse(reply, "message-added", {
              conversationId: change.conversation.id,
              channel: change.conversation.channel,
              title: change.conversation.title,
              lastMessageAt: change.conversation.lastMessageAt,
              unreadCount: change.conversation.unreadCount,
              preview: change.conversation.lastPreview,
              previousRank: change.previousRank,
              nextRank: change.nextRank,
              observedAt,
            });
          }
          if (changed.length === 0) {
            sendSse(reply, "heartbeat", { pollMs, observedAt });
          }
        }

        lastSignature = nextSignature;
        lastRank = nextRank;
      } catch (error) {
        sendSse(reply, "stream-error", {
          message: error instanceof Error ? error.message : "unknown_error",
          observedAt: new Date().toISOString(),
        });
      }
    }

    const interval = setInterval(() => void tick(), pollMs);
    request.raw.on("close", close);
    await tick();
  });
}

async function authenticateRequest(
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

function conversationSignature(conversation: Conversation): string {
  return [
    conversation.lastMessageAt ?? "",
    conversation.lastPreview ?? "",
    conversation.unreadCount,
    conversation.updatedAt,
  ].join("|");
}

function sendSse(reply: FastifyReply, event: string, data: unknown): void {
  if (reply.raw.destroyed || reply.raw.writableEnded) {
    return;
  }
  reply.raw.write(`event: ${event}\n`);
  reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
}
