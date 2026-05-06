import type { FastifyInstance } from "fastify";

import type { ApiEnv } from "@nuoma/config";
import type { Conversation } from "@nuoma/contracts";
import type { Repositories } from "@nuoma/db";

import { authenticateSseRequest, sendSse, startSse } from "./sse.js";

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
    const user = await authenticateSseRequest(request, reply, deps.env);
    if (!user) return reply;
    const userId = user.id;

    startSse(reply, request.headers.origin, "nuoma inbox stream");

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

function conversationSignature(conversation: Conversation): string {
  return [
    conversation.lastMessageAt ?? "",
    conversation.lastPreview ?? "",
    conversation.unreadCount,
    conversation.updatedAt,
  ].join("|");
}
