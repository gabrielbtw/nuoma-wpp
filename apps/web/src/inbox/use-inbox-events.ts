import { useEffect, useState } from "react";

import { API_URL } from "../lib/api-url.js";
import { trpc } from "../lib/trpc.js";
import { INBOX_CONVERSATION_LIMIT } from "./conversation-list-config.js";

interface MessageAddedEvent {
  conversationId: number;
  channel?: string;
  title?: string;
  lastMessageAt: string | null;
  unreadCount: number;
  preview: string | null;
  previousRank: number | null;
  nextRank: number;
  observedAt: string;
}

interface GlobalEventEnvelope {
  channel: string;
  type: string;
  payload: unknown;
  observedAt: string;
}

export interface InboxRealtimeState {
  status: "connecting" | "live" | "error" | "unsupported";
  conversationCount: number | null;
  messageEvents: number;
  lastConversationId: number | null;
  lastEventAt: string | null;
}

export function useInboxEvents(selectedConversationId: number | null): InboxRealtimeState {
  const utils = trpc.useUtils();
  const [state, setState] = useState<InboxRealtimeState>({
    status: "connecting",
    conversationCount: null,
    messageEvents: 0,
    lastConversationId: null,
    lastEventAt: null,
  });

  useEffect(() => {
    if (typeof EventSource === "undefined") {
      setState((current) => ({ ...current, status: "unsupported" }));
      return;
    }

    const events = new EventSource(`${API_URL}/api/events?channels=inbox`, {
      withCredentials: true,
    });
    let closed = false;

    events.addEventListener("events-ready", (event) => {
      const payload = parseEventsReady(event);
      if (closed) return;
      setState((current) => ({
        ...current,
        status: "live",
        conversationCount: payload?.conversationCount ?? current.conversationCount,
        lastEventAt: payload?.observedAt ?? new Date().toISOString(),
      }));
    });

    events.addEventListener("nuoma-event", (event) => {
      const envelope = parseGlobalEvent(event);
      if (envelope?.channel !== "inbox" || envelope.type !== "message-added") return;
      const payload = parseMessageAddedPayload(envelope.payload);
      if (!payload || closed) return;
      reorderConversationCache(utils, payload);
      void utils.conversations.list.invalidate();
      if (payload?.conversationId === selectedConversationId) {
        void utils.messages.listByConversation.invalidate({
          conversationId: selectedConversationId,
        });
      }
      setState((current) => ({
        ...current,
        status: "live",
        messageEvents: current.messageEvents + 1,
        lastConversationId: payload.conversationId,
        lastEventAt: payload.observedAt,
      }));
    });

    events.addEventListener("events-heartbeat", (event) => {
      const payload = parseObservedAt(event);
      if (closed) return;
      setState((current) => ({
        ...current,
        status: current.status === "error" ? "error" : "live",
        lastEventAt: payload ?? current.lastEventAt,
      }));
    });

    events.addEventListener("stream-error", () => {
      if (closed) return;
      setState((current) => ({ ...current, status: "error", lastEventAt: new Date().toISOString() }));
      void utils.conversations.list.invalidate();
    });

    events.onerror = () => {
      if (closed) return;
      setState((current) => ({ ...current, status: "error", lastEventAt: new Date().toISOString() }));
    };

    return () => {
      closed = true;
      events.close();
    };
  }, [selectedConversationId, utils]);

  return state;
}

function parseGlobalEvent(event: Event): GlobalEventEnvelope | null {
  const parsed = parseJsonEvent(event);
  if (
    typeof parsed?.channel !== "string" ||
    typeof parsed.type !== "string" ||
    typeof parsed.observedAt !== "string"
  ) {
    return null;
  }
  return {
    channel: parsed.channel,
    type: parsed.type,
    payload: parsed.payload,
    observedAt: parsed.observedAt,
  };
}

function parseMessageAddedPayload(payload: unknown): MessageAddedEvent | null {
  try {
    const parsed = payload as Partial<MessageAddedEvent>;
    return typeof parsed.conversationId === "number" &&
      typeof parsed.nextRank === "number" &&
      typeof parsed.unreadCount === "number" &&
      typeof parsed.observedAt === "string"
      ? {
          conversationId: parsed.conversationId,
          channel: parsed.channel,
          title: parsed.title,
          lastMessageAt: parsed.lastMessageAt ?? null,
          unreadCount: parsed.unreadCount,
          preview: parsed.preview ?? null,
          previousRank: parsed.previousRank ?? null,
          nextRank: parsed.nextRank,
          observedAt: parsed.observedAt,
        }
      : null;
  } catch {
    return null;
  }
}

function parseEventsReady(event: Event): { conversationCount?: number; observedAt: string } | null {
  const parsed = parseJsonEvent(event);
  return typeof parsed?.observedAt === "string"
    ? {
        conversationCount:
          typeof parsed.conversationCount === "number" ? parsed.conversationCount : undefined,
        observedAt: parsed.observedAt,
      }
    : null;
}

function parseObservedAt(event: Event): string | null {
  const parsed = parseJsonEvent(event);
  return typeof parsed?.observedAt === "string" ? parsed.observedAt : null;
}

function parseJsonEvent(event: Event): Record<string, unknown> | null {
  if (!(event instanceof MessageEvent) || typeof event.data !== "string") {
    return null;
  }
  try {
    const parsed = JSON.parse(event.data) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function reorderConversationCache(
  utils: ReturnType<typeof trpc.useUtils>,
  payload: MessageAddedEvent,
): void {
  utils.conversations.list.setData({ limit: INBOX_CONVERSATION_LIMIT }, (current) => {
    if (!current) return current;
    const conversations = current.conversations.map((conversation) =>
      conversation.id === payload.conversationId
        ? {
            ...conversation,
            lastMessageAt: payload.lastMessageAt,
            lastPreview: payload.preview,
            unreadCount: payload.unreadCount,
            updatedAt: payload.observedAt,
          }
        : conversation,
    );
    conversations.sort((a, b) => {
      const aTime = Date.parse(a.lastMessageAt ?? "");
      const bTime = Date.parse(b.lastMessageAt ?? "");
      if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) {
        return bTime - aTime;
      }
      if (Number.isFinite(aTime) !== Number.isFinite(bTime)) {
        return Number.isFinite(bTime) ? 1 : -1;
      }
      return b.id - a.id;
    });
    return { conversations };
  });
}
