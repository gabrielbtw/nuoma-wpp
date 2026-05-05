import { useEffect, useMemo, useState } from "react";

import { Badge, SignalDot, TimeAgo, cn, useToast } from "@nuoma/ui";
import type { Message } from "@nuoma/contracts";

import { Composer } from "../inbox/Composer.js";
import { ContactSidebar } from "../inbox/ContactSidebar.js";
import { ConversationList } from "../inbox/ConversationList.js";
import { MessageTimeline } from "../inbox/MessageTimeline.js";
import { INBOX_CONVERSATION_LIMIT } from "../inbox/conversation-list-config.js";
import { conversationDisplayTitle } from "../inbox/conversation-display.js";
import type { MessageActionDraft } from "../inbox/message-action-draft.js";
import { createOptimisticTextMessage, isOptimisticMessage } from "../inbox/optimistic-message.js";
import { summarizeConversationQueue } from "../inbox/QueueIndicator.js";
import { type InboxRealtimeState, useInboxEvents } from "../inbox/use-inbox-events.js";
import { trpc } from "../lib/trpc.js";

export function InboxPage() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [messageActionDraft, setMessageActionDraft] = useState<MessageActionDraft | null>(null);
  const [optimisticMessages, setOptimisticMessages] = useState<Message[]>([]);
  const [retryingMessageIds, setRetryingMessageIds] = useState<number[]>([]);
  const conversations = trpc.conversations.list.useQuery({ limit: INBOX_CONVERSATION_LIMIT });
  const jobs = trpc.jobs.list.useQuery(
    {},
    {
      enabled: selectedId != null,
      refetchInterval: 3_000,
    },
  );
  const utils = trpc.useUtils();
  const toast = useToast();

  const conversation = conversations.data?.conversations.find((c) => c.id === selectedId);
  const queueSummary = useMemo(
    () => summarizeConversationQueue(jobs.data?.jobs ?? [], selectedId),
    [jobs.data?.jobs, selectedId],
  );
  const realtime = useInboxEvents(selectedId);

  useEffect(() => {
    setMessageActionDraft(null);
  }, [selectedId]);

  const forceSync = trpc.conversations.forceSync.useMutation({
    onSuccess() {
      toast.push({ title: "Sincronização enfileirada", variant: "success" });
      void utils.conversations.list.invalidate();
      void utils.messages.listByConversation.invalidate();
    },
    onError(error) {
      toast.push({ title: "Falha", description: error.message, variant: "danger" });
    },
  });
  const forceHistorySync = trpc.conversations.forceHistorySync.useMutation({
    onSuccess() {
      toast.push({ title: "Histórico enfileirado", variant: "success" });
      void utils.conversations.list.invalidate();
      void utils.messages.listByConversation.invalidate();
    },
    onError(error) {
      toast.push({ title: "Falha", description: error.message, variant: "danger" });
    },
  });
  const retrySend = trpc.messages.send.useMutation();

  // j/k navigate, esc close
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        if (event.key === "Escape") {
          (target as HTMLElement).blur();
        }
        return;
      }
      const list = conversations.data?.conversations ?? [];
      if (list.length === 0) return;
      const idx = list.findIndex((c) => c.id === selectedId);
      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        const next = list[Math.min(idx + 1, list.length - 1)];
        if (next) setSelectedId(next.id);
      } else if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        const prev = list[Math.max(idx - 1, 0)];
        if (prev) setSelectedId(prev.id);
      } else if (event.key === "Escape") {
        if (messageActionDraft) {
          event.preventDefault();
          setMessageActionDraft(null);
          return;
        }
        setSelectedId(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [conversations.data, messageActionDraft, selectedId]);

  function onForceSync() {
    if (!conversation) return;
    const phone = conversation.externalThreadId.replace(/\D/g, "");
    forceSync.mutate({
      id: conversation.id,
      phone: phone.length >= 10 ? phone : undefined,
    });
  }

  function onForceHistorySync(maxScrolls: number) {
    if (!conversation) return;
    const phone = conversation.externalThreadId.replace(/\D/g, "");
    forceHistorySync.mutate({
      id: conversation.id,
      phone: phone.length >= 10 ? phone : undefined,
      maxScrolls,
    });
  }

  function createOptimisticSend(input: { conversationId: number; body: string }) {
    const targetConversation = conversations.data?.conversations.find(
      (item) => item.id === input.conversationId,
    );
    const optimistic = createOptimisticTextMessage({
      body: input.body,
      contactId: targetConversation?.contactId ?? null,
      conversationId: input.conversationId,
    });
    setOptimisticMessages((current) => [...current, optimistic.message]);
    utils.conversations.list.setData({ limit: INBOX_CONVERSATION_LIMIT }, (current) => {
      if (!current) return current;
      const conversations = current.conversations.map((item) =>
        item.id === input.conversationId
          ? {
              ...item,
              lastMessageAt: optimistic.message.observedAtUtc,
              lastPreview: input.body,
              updatedAt: optimistic.message.observedAtUtc,
            }
          : item,
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
    return optimistic;
  }

  function markOptimisticSendQueued(clientMutationId: string, jobId: number) {
    setOptimisticMessages((current) =>
      current.map((message) =>
        message.raw?.clientMutationId === clientMutationId
          ? {
              ...message,
              updatedAt: new Date().toISOString(),
              raw: {
                ...message.raw,
                jobId,
                optimisticQueued: true,
              },
            }
          : message,
      ),
    );
  }

  function markOptimisticSendFailed(clientMutationId: string, errorMessage: string) {
    setOptimisticMessages((current) =>
      current.map((message) =>
        message.raw?.clientMutationId === clientMutationId
          ? {
              ...message,
              status: "failed",
              updatedAt: new Date().toISOString(),
              raw: {
                ...message.raw,
                optimisticFailed: true,
                error: errorMessage,
              },
            }
          : message,
      ),
    );
  }

  function markOptimisticMessagePending(messageId: number) {
    const retriedAt = new Date().toISOString();
    setOptimisticMessages((current) =>
      current.map((message) =>
        message.id === messageId
          ? {
              ...message,
              status: "pending",
              updatedAt: retriedAt,
              raw: {
                ...message.raw,
                error: null,
                optimisticFailed: false,
                optimisticRetrying: true,
                lastRetryAt: retriedAt,
                retryCount: numericRawValue(message.raw?.retryCount) + 1,
              },
            }
          : message,
      ),
    );
  }

  function markOptimisticMessageFailed(messageId: number, errorMessage: string) {
    setOptimisticMessages((current) =>
      current.map((message) =>
        message.id === messageId
          ? {
              ...message,
              status: "failed",
              updatedAt: new Date().toISOString(),
              raw: {
                ...message.raw,
                error: errorMessage,
                optimisticFailed: true,
                optimisticRetrying: false,
              },
            }
          : message,
      ),
    );
  }

  function retryFailedMessage(message: Message) {
    const body = message.body?.trim();
    if (
      !body ||
      message.direction !== "outbound" ||
      message.contentType !== "text" ||
      message.status !== "failed"
    ) {
      toast.push({
        title: "Retry indisponível",
        description: "Nesta fase o retry inline cobre apenas mensagens de texto outbound falhadas.",
        variant: "warning",
      });
      return;
    }
    if (retryingMessageIds.includes(message.id)) {
      return;
    }

    setRetryingMessageIds((current) => [...current, message.id]);
    const optimisticRetry = isOptimisticMessage(message)
      ? null
      : createOptimisticSend({ conversationId: message.conversationId, body });
    if (isOptimisticMessage(message)) {
      markOptimisticMessagePending(message.id);
    }

    retrySend.mutate(
      { conversationId: message.conversationId, body },
      {
        onSuccess(result) {
          setRetryingMessageIds((current) => current.filter((id) => id !== message.id));
          if (isOptimisticMessage(message) && result.job) {
            markOptimisticSendQueued(String(message.raw?.clientMutationId ?? ""), result.job.id);
          } else if (optimisticRetry && result.job) {
            markOptimisticSendQueued(optimisticRetry.clientMutationId, result.job.id);
          }
          void utils.conversations.list.invalidate();
          void utils.jobs.list.invalidate();
          toast.push({ title: "Retry enfileirado", variant: "success" });
        },
        onError(error) {
          setRetryingMessageIds((current) => current.filter((id) => id !== message.id));
          if (isOptimisticMessage(message)) {
            markOptimisticMessageFailed(message.id, error.message);
          } else if (optimisticRetry) {
            markOptimisticSendFailed(optimisticRetry.clientMutationId, error.message);
          }
          toast.push({ title: "Retry falhou", description: error.message, variant: "danger" });
        },
      },
    );
  }

  return (
    <div className="flex h-[calc(100vh-7rem)] min-h-[620px] flex-col gap-3 -mt-2 overflow-hidden">
      <header
        data-testid="inbox-realtime-header"
        className="flex min-h-12 flex-wrap items-center justify-between gap-3 rounded-xxl bg-bg-base px-4 py-2.5 shadow-raised-md"
      >
        <div className="min-w-0">
          <div className="text-sm font-medium text-fg-primary">Inbox</div>
          <div className="mt-0.5 truncate font-mono text-[0.65rem] uppercase tracking-widest text-fg-dim">
            {conversations.data?.conversations.length ?? 0} conversas · realtime SSE
          </div>
        </div>
        <RealtimeStatus state={realtime} />
      </header>
      <div
        data-testid="inbox-grid"
        className="grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)_320px]"
      >
        <ConversationList selectedId={selectedId} onSelect={setSelectedId} />
        <div className="flex min-w-0 flex-col gap-3 overflow-hidden">
          <MessageTimeline
            conversationId={selectedId}
            conversationTitle={conversation ? conversationDisplayTitle(conversation) : undefined}
            optimisticMessages={optimisticMessages}
            retryingMessageIds={retryingMessageIds}
            queueSummary={queueSummary}
            queueLoading={jobs.isLoading || jobs.isFetching}
            queueError={jobs.error?.message ?? null}
            onForceSync={selectedId != null ? onForceSync : undefined}
            forceSyncing={forceSync.isPending}
            onForceHistorySync={selectedId != null ? onForceHistorySync : undefined}
            historySyncing={forceHistorySync.isPending}
            onMessageAction={setMessageActionDraft}
            onRetryMessage={retryFailedMessage}
          />
          <Composer
            conversationId={selectedId}
            onCreateOptimisticSend={createOptimisticSend}
            onOptimisticSendFailed={markOptimisticSendFailed}
            onOptimisticSendQueued={markOptimisticSendQueued}
            actionDraft={messageActionDraft}
            onClearActionDraft={() => setMessageActionDraft(null)}
          />
        </div>
        <div className="hidden min-w-0 xl:block">
          <ContactSidebar conversationId={selectedId} />
        </div>
      </div>
    </div>
  );
}

function numericRawValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function RealtimeStatus({ state }: { state: InboxRealtimeState }) {
  const tone = state.status === "live" ? "active" : state.status === "error" ? "error" : "idle";
  return (
    <div
      className={cn(
        "flex min-h-9 items-center gap-3 rounded-lg bg-bg-base px-3 shadow-flat",
        state.status === "error" && "shadow-glow-danger",
      )}
    >
      <SignalDot status={tone} size="sm" />
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-fg-primary">{statusLabel(state.status)}</span>
          {state.messageEvents > 0 ? (
            <Badge variant="cyan">{state.messageEvents} eventos</Badge>
          ) : null}
        </div>
        <div className="font-mono text-[0.62rem] uppercase tracking-widest text-fg-dim">
          {state.lastEventAt ? (
            <>
              atualizado <TimeAgo date={state.lastEventAt} className="text-[0.62rem]" />
              {state.lastConversationId ? ` · conv #${state.lastConversationId}` : ""}
            </>
          ) : (
            `${state.conversationCount ?? "—"} conversas observadas`
          )}
        </div>
      </div>
    </div>
  );
}

function statusLabel(status: InboxRealtimeState["status"]): string {
  if (status === "live") return "Tempo real ativo";
  if (status === "error") return "Tempo real instável";
  if (status === "unsupported") return "Tempo real indisponível";
  return "Conectando tempo real";
}
