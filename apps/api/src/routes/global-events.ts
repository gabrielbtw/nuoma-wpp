import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { ApiEnv } from "@nuoma/config";
import type { Conversation } from "@nuoma/contracts";
import type { Repositories } from "@nuoma/db";

import { authenticateSseRequest, sendSse, startSse } from "./sse.js";

const pollMs = 2_000;
const supportedChannels = new Set(["inbox", "system"]);

interface ChangedConversation {
  conversation: Conversation;
  previousRank: number | null;
  nextRank: number;
}

interface StreamCursor {
  systemEventId: number;
}

interface GlobalEventsQuery {
  channels?: string;
  sinceSystemEventId?: string;
}

export async function registerGlobalEventsRoutes(
  app: FastifyInstance,
  deps: { env: ApiEnv; repos: Repositories },
): Promise<void> {
  app.get("/api/events", async (request, reply) => {
    const user = await authenticateSseRequest(request, reply, deps.env);
    if (!user) return reply;
    const userId = user.id;

    const channels = parseChannels((request.query as GlobalEventsQuery).channels);
    const cursor = parseCursor(request);

    startSse(reply, request.headers.origin, "nuoma global event stream");

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
      const observedAt = new Date().toISOString();
      try {
        if (!initialized) {
          const conversationCount = channels.includes("inbox")
            ? (await deps.repos.conversations.list(userId, 200)).length
            : undefined;
          sendSse(reply, "events-ready", {
            channels,
            conversationCount,
            cursor: { systemEventId: cursor.systemEventId },
            pollMs,
            observedAt,
          });
          initialized = true;
        }

        if (channels.includes("system")) {
          await emitSystemEvents(reply, deps.repos, userId, cursor, observedAt);
        }
        if (channels.includes("inbox")) {
          const next = await collectInboxChanges(deps.repos, userId, {
            initialized: lastSignature.size > 0,
            lastSignature,
            lastRank,
          });
          lastSignature = next.signature;
          lastRank = next.rank;
          for (const change of next.changed) {
            sendGlobalEvent(
              reply,
              {
                channel: "inbox",
                type: "message-added",
                observedAt,
                payload: {
                  conversationId: change.conversation.id,
                  channel: change.conversation.channel,
                  title: change.conversation.title,
                  lastMessageAt: change.conversation.lastMessageAt,
                  unreadCount: change.conversation.unreadCount,
                  preview: change.conversation.lastPreview,
                  previousRank: change.previousRank,
                  nextRank: change.nextRank,
                  observedAt,
                },
              },
              `inbox:${change.conversation.id}:${change.conversation.updatedAt}`,
            );
          }
        }

        sendSse(reply, "events-heartbeat", {
          channels,
          cursor: { systemEventId: cursor.systemEventId },
          pollMs,
          observedAt,
        });
      } catch (error) {
        sendSse(reply, "stream-error", {
          channel: "global",
          message: error instanceof Error ? error.message : "unknown_error",
          observedAt,
        });
      }
    }

    const interval = setInterval(() => void tick(), pollMs);
    request.raw.on("close", close);
    await tick();
  });
}

async function emitSystemEvents(
  reply: FastifyReply,
  repos: Repositories,
  userId: number,
  cursor: StreamCursor,
  observedAt: string,
): Promise<void> {
  const events = await repos.systemEvents.list({
    userId,
    afterId: cursor.systemEventId,
    order: "asc",
    limit: 100,
  });
  for (const event of events) {
    cursor.systemEventId = Math.max(cursor.systemEventId, event.id);
    sendGlobalEvent(
      reply,
      {
        channel: "system",
        type: event.type,
        observedAt,
        payload: {
          id: event.id,
          severity: event.severity,
          payload: event.payload,
          createdAt: event.createdAt,
        },
      },
      `system:${event.id}`,
    );
  }
}

async function collectInboxChanges(
  repos: Repositories,
  userId: number,
  state: {
    initialized: boolean;
    lastSignature: Map<number, string>;
    lastRank: Map<number, number>;
  },
): Promise<{
  signature: Map<number, string>;
  rank: Map<number, number>;
  changed: ChangedConversation[];
}> {
  const conversations = await repos.conversations.list(userId, 200);
  const signature = new Map<number, string>();
  const rank = new Map<number, number>();
  const changed: ChangedConversation[] = [];

  for (const [index, conversation] of conversations.entries()) {
    const currentSignature = conversationSignature(conversation);
    signature.set(conversation.id, currentSignature);
    rank.set(conversation.id, index);
    if (state.initialized && state.lastSignature.get(conversation.id) !== currentSignature) {
      changed.push({
        conversation,
        previousRank: state.lastRank.get(conversation.id) ?? null,
        nextRank: index,
      });
    }
  }

  return { signature, rank, changed };
}

function sendGlobalEvent(
  reply: FastifyReply,
  event: {
    channel: "inbox" | "system";
    type: string;
    observedAt: string;
    payload: unknown;
  },
  id: string,
): void {
  sendSse(reply, "nuoma-event", event, id);
}

function parseChannels(value: string | undefined): Array<"inbox" | "system"> {
  const channels = (value ?? "inbox,system")
    .split(",")
    .map((channel) => channel.trim())
    .filter((channel) => supportedChannels.has(channel));
  return channels.length > 0 ? (channels as Array<"inbox" | "system">) : ["inbox", "system"];
}

function parseCursor(request: FastifyRequest): StreamCursor {
  const query = request.query as GlobalEventsQuery;
  const eventId = parseLastEventId(request.headers["last-event-id"]);
  return {
    systemEventId:
      parsePositiveInt(query.sinceSystemEventId) ?? eventId.systemEventId ?? Number.MAX_SAFE_INTEGER,
  };
}

function parseLastEventId(value: string | string[] | undefined): Partial<StreamCursor> {
  const lastEventId = Array.isArray(value) ? value.at(-1) : value;
  if (!lastEventId?.startsWith("system:")) {
    return {};
  }
  return { systemEventId: parsePositiveInt(lastEventId.slice("system:".length)) ?? 0 };
}

function parsePositiveInt(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function conversationSignature(conversation: Conversation): string {
  return [
    conversation.lastMessageAt ?? "",
    conversation.lastPreview ?? "",
    conversation.unreadCount,
    conversation.updatedAt,
  ].join("|");
}
