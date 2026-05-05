import { motion, useReducedMotion } from "framer-motion";
import {
  AlertCircle,
  CalendarDays,
  Check,
  CheckCheck,
  Clock,
  Copy,
  Download,
  FileText,
  Forward,
  History,
  Image as ImageIcon,
  Info,
  RefreshCw,
  Reply,
  Search,
  Video,
  Volume2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { Message, MessageContentType, MessageStatus } from "@nuoma/contracts";
import {
  Animate,
  Badge,
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
  useToast,
} from "@nuoma/ui";

import { trpc } from "../lib/trpc.js";
import { mediaAssetUrl } from "../lib/media-url.js";
import {
  createMessageActionDraft,
  messageActionText,
  type MessageActionDraft,
} from "./message-action-draft.js";
import { isOptimisticMessage, mergeOptimisticMessages } from "./optimistic-message.js";
import { QueueIndicator, type ConversationQueueSummary } from "./QueueIndicator.js";

const MESSAGE_BUBBLE_MAX_WIDTH = "min(72%, 42rem)";
const MEDIA_CONTENT_TYPES = new Set<MessageContentType>([
  "image",
  "audio",
  "voice",
  "video",
  "document",
  "sticker",
]);

type TimelineDateFilter = "all" | "today" | "yesterday";
type TimelineTypeFilter = "all" | MessageContentType;

const DATE_FILTERS: { id: TimelineDateFilter; label: string }[] = [
  { id: "all", label: "Todas" },
  { id: "today", label: "Hoje" },
  { id: "yesterday", label: "Ontem" },
];

const TYPE_FILTERS: { id: TimelineTypeFilter; label: string }[] = [
  { id: "all", label: "Todos" },
  { id: "text", label: "Texto" },
  { id: "image", label: "Imagem" },
  { id: "video", label: "Video" },
  { id: "voice", label: "Voz" },
  { id: "audio", label: "Audio" },
  { id: "document", label: "Doc" },
  { id: "link", label: "Link" },
];

interface DeliveryStatusMeta {
  label: string;
  stage: "clock" | "single-check" | "double-check" | "blue-double-check" | "failed";
  Icon: LucideIcon;
  iconClassName: string;
  shellClassName: string;
}

const DELIVERY_STATUS_META: Partial<Record<MessageStatus, DeliveryStatusMeta>> = {
  pending: {
    label: "Pendente",
    stage: "clock",
    Icon: Clock,
    iconClassName: "text-amber-200",
    shellClassName: "border-amber-300/20 bg-amber-300/10",
  },
  sent: {
    label: "Enviada",
    stage: "single-check",
    Icon: Check,
    iconClassName: "text-cyan-50/70",
    shellClassName: "border-cyan-50/10 bg-slate-950/20",
  },
  delivered: {
    label: "Entregue",
    stage: "double-check",
    Icon: CheckCheck,
    iconClassName: "text-cyan-50/75",
    shellClassName: "border-cyan-50/15 bg-slate-950/24",
  },
  read: {
    label: "Lida",
    stage: "blue-double-check",
    Icon: CheckCheck,
    iconClassName: "text-brand-cyan",
    shellClassName: "border-brand-cyan/45 bg-brand-cyan/12 shadow-[0_0_14px_rgba(55,214,211,0.28)]",
  },
  failed: {
    label: "Falhou",
    stage: "failed",
    Icon: AlertCircle,
    iconClassName: "text-semantic-danger",
    shellClassName: "border-semantic-danger/35 bg-semantic-danger/10",
  },
};

interface MessageTimelineProps {
  conversationId: number | null;
  conversationTitle?: string;
  onForceSync?: () => void;
  forceSyncing?: boolean;
  onForceHistorySync?: (maxScrolls: number) => void;
  historySyncing?: boolean;
  onMessageAction?: (draft: MessageActionDraft) => void;
  onRetryMessage?: (message: Message) => void;
  optimisticMessages?: Message[];
  retryingMessageIds?: number[];
  queueSummary?: ConversationQueueSummary;
  queueLoading?: boolean;
  queueError?: string | null;
}

export function MessageTimeline({
  conversationId,
  conversationTitle,
  onForceSync,
  forceSyncing,
  onForceHistorySync,
  historySyncing,
  onMessageAction,
  onRetryMessage,
  optimisticMessages = [],
  retryingMessageIds = [],
  queueSummary,
  queueLoading,
  queueError,
}: MessageTimelineProps) {
  const toast = useToast();
  const messages = trpc.messages.listByConversation.useQuery(
    { conversationId: conversationId ?? 0, limit: 200 },
    { enabled: conversationId != null, refetchInterval: 5_000 },
  );

  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState<TimelineDateFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TimelineTypeFilter>("all");
  const [mediaOnly, setMediaOnly] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [historyDepth, setHistoryDepth] = useState(3);
  const [copiedMessageId, setCopiedMessageId] = useState<number | null>(null);
  const retryingMessageIdSet = useMemo(() => new Set(retryingMessageIds), [retryingMessageIds]);

  const allMessages = useMemo(
    () =>
      mergeOptimisticMessages(
        messages.data?.messages ?? [],
        optimisticMessages,
        conversationId,
      ).sort((a, b) => timelineMs(a) - timelineMs(b)),
    [conversationId, messages.data, optimisticMessages],
  );

  const filtered = useMemo(() => {
    const today = localDateKey(new Date());
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterday = localDateKey(yesterdayDate);
    const q = search.trim().toLowerCase();
    return allMessages.filter((message) => {
      if (dateFilter !== "all") {
        const key = localDateKey(message.waDisplayedAt ?? message.observedAtUtc);
        if (dateFilter === "today" && key !== today) return false;
        if (dateFilter === "yesterday" && key !== yesterday) return false;
      }
      if (typeFilter !== "all" && message.contentType !== typeFilter) return false;
      if (mediaOnly && !messageHasMedia(message)) return false;
      if (
        q &&
        !`${message.body ?? ""} ${message.externalId ?? ""} ${message.status} ${message.contentType}`
          .toLowerCase()
          .includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [allMessages, dateFilter, mediaOnly, search, typeFilter]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTypingTarget =
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      const isMod = event.metaKey || event.ctrlKey;
      if (isMod && event.key === "f" && conversationId != null) {
        event.preventDefault();
        setSearchOpen((v) => !v);
        return;
      }
      if (event.key === "Escape" && (searchOpen || selectedMessage)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setSearchOpen(false);
        setSearch("");
        setSelectedMessage(null);
        return;
      }
      if (isTypingTarget || conversationId == null) {
        return;
      }
      const activeMessage = selectedMessage ?? filtered.at(-1) ?? null;
      if (event.key.toLowerCase() === "r" && activeMessage) {
        event.preventDefault();
        startMessageAction("reply", activeMessage);
      } else if (event.key.toLowerCase() === "e" && activeMessage) {
        event.preventDefault();
        startMessageAction("edit", activeMessage);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [conversationId, filtered, searchOpen, selectedMessage]);

  useEffect(() => {
    if (!selectedMessage) return;
    const next = filtered.find((message) => message.id === selectedMessage.id);
    setSelectedMessage(next ?? null);
  }, [filtered, selectedMessage]);

  // group by date for sticky dividers
  const groups = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    for (const msg of filtered) {
      const d = (msg.waDisplayedAt ?? msg.observedAtUtc).slice(0, 10);
      const list = map.get(d) ?? [];
      list.push(msg);
      map.set(d, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filtered.length, conversationId]);

  async function copyMessage(message: Message) {
    const text = messageActionText(message);
    try {
      await writeClipboard(text);
      setCopiedMessageId(message.id);
      toast.push({ title: "Mensagem copiada", variant: "success" });
      window.setTimeout(
        () => setCopiedMessageId((current) => (current === message.id ? null : current)),
        1_500,
      );
    } catch (error) {
      toast.push({
        title: "Falha ao copiar",
        description: error instanceof Error ? error.message : "Clipboard indisponível.",
        variant: "danger",
      });
    }
  }

  function startMessageAction(kind: "reply" | "forward" | "edit", message: Message) {
    onMessageAction?.(createMessageActionDraft(kind, message));
    toast.push({
      title:
        kind === "reply"
          ? "Resposta preparada"
          : kind === "edit"
            ? "Edição preparada"
            : "Encaminhamento preparado",
      variant: "info",
    });
  }

  if (conversationId == null) {
    return (
      <div
        data-testid="inbox-message-timeline"
        className="flex-1 flex items-center justify-center rounded-xxl bg-bg-base shadow-raised-md"
      >
        <EmptyState
          title="Selecione uma conversa"
          description="Escolha uma conversa na lista à esquerda para ver as mensagens."
        />
      </div>
    );
  }

  return (
    <div
      data-testid="inbox-message-timeline"
      className="flex h-full min-h-0 overflow-hidden rounded-xxl bg-bg-base shadow-raised-md"
    >
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between gap-4 px-5 py-4 border-b border-contour-line/40">
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">{conversationTitle ?? "Conversa"}</div>
            <div className="text-[0.65rem] uppercase tracking-widest text-fg-dim font-mono mt-0.5">
              #{conversationId} · {messages.data?.messages.length ?? 0} mensagens
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {queueSummary ? (
              <QueueIndicator summary={queueSummary} loading={queueLoading} error={queueError} />
            ) : null}
            <button
              type="button"
              data-testid="timeline-search-toggle"
              onClick={() => setSearchOpen((v) => !v)}
              className={cn(
                "inline-flex h-9 w-9 items-center justify-center rounded-lg text-fg-muted transition-shadow",
                searchOpen
                  ? "bg-bg-base shadow-pressed-sm text-brand-cyan"
                  : "shadow-flat hover:shadow-raised-sm hover:text-fg-primary",
              )}
              aria-label="Buscar"
              title="Buscar (⌘F)"
            >
              <Search className="h-3.5 w-3.5" />
            </button>
            {onForceSync && (
                <Button
                  size="xs"
                  variant="soft"
                  loading={forceSyncing}
                  leftIcon={<RefreshCw className="h-3 w-3" />}
                  onClick={onForceSync}
                  data-testid="timeline-force-sync"
                >
                  Ressincronizar
                </Button>
            )}
            {onForceHistorySync && (
              <>
                <label
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-md bg-bg-base px-2 text-xs text-fg-muted shadow-flat",
                    "focus-within:ring-2 focus-within:ring-brand-cyan/50",
                  )}
                  title="Profundidade do histórico"
                >
                  <History className="h-3 w-3" />
                  <select
                    value={historyDepth}
                    onChange={(event) => setHistoryDepth(Number(event.target.value))}
                    className="h-6 bg-transparent text-xs outline-none"
                    aria-label="Profundidade do histórico"
                  >
                    <option value={3}>3 janelas</option>
                    <option value={10}>10 janelas</option>
                    <option value={25}>25 janelas</option>
                  </select>
                </label>
                <Button
                  size="xs"
                  variant="soft"
                  loading={historySyncing}
                  leftIcon={<History className="h-3 w-3" />}
                  onClick={() => onForceHistorySync(historyDepth)}
                >
                  Histórico
                </Button>
              </>
            )}
          </div>
        </header>
        <div
          data-testid="timeline-filter-bar"
          className="flex flex-wrap items-center gap-2 border-b border-contour-line/40 px-5 py-2"
        >
          <div className="flex items-center gap-1.5">
            <CalendarDays className="h-3.5 w-3.5 text-fg-dim" />
            {DATE_FILTERS.map((filter) => (
              <TimelineFilterChip
                key={filter.id}
                label={filter.label}
                active={dateFilter === filter.id}
                testId="timeline-filter-date"
                value={filter.id}
                onClick={() => setDateFilter(filter.id)}
              />
            ))}
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {TYPE_FILTERS.map((filter) => (
              <TimelineFilterChip
                key={filter.id}
                label={filter.label}
                active={typeFilter === filter.id}
                testId="timeline-filter-type"
                value={filter.id}
                onClick={() => setTypeFilter(filter.id)}
              />
            ))}
          </div>
          <TimelineFilterChip
            label="Com midia"
            active={mediaOnly}
            testId="timeline-filter-media"
            value="with-media"
            onClick={() => setMediaOnly((value) => !value)}
          />
          <span
            data-testid="timeline-filter-count"
            className="ml-auto font-mono text-[0.62rem] uppercase tracking-widest text-fg-dim"
          >
            {filtered.length}/{allMessages.length}
          </span>
          {(dateFilter !== "all" || typeFilter !== "all" || mediaOnly || search) && (
            <button
              type="button"
              data-testid="timeline-filter-clear"
              onClick={() => {
                setDateFilter("all");
                setTypeFilter("all");
                setMediaOnly(false);
                setSearch("");
              }}
              className="rounded-md px-2 py-1 font-mono text-[0.62rem] uppercase tracking-widest text-fg-muted shadow-flat-subtle transition hover:text-fg-primary hover:shadow-raised-sm"
            >
              Limpar
            </button>
          )}
        </div>
        {searchOpen && (
          <div className="px-5 py-2 border-b border-contour-line/40 flex items-center gap-2">
            <Search className="h-3.5 w-3.5 text-fg-dim" />
            <input
              type="search"
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar nesta conversa…"
              data-testid="timeline-search-input"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-fg-dim"
            />
            {search && (
              <span
                data-testid="timeline-search-count"
                className="text-[0.65rem] uppercase tracking-widest text-fg-dim font-mono"
              >
                {filtered.length} encontradas
              </span>
            )}
          </div>
        )}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4">
          {messages.isLoading ? (
            <LoadingState />
          ) : messages.error ? (
            <ErrorState description={messages.error.message} />
          ) : filtered.length === 0 ? (
            <EmptyState
              title={search ? "Nada encontrado" : "Sem mensagens"}
              description={
                search ? "Tente outra busca." : "Mensagens sincronizadas vão aparecer aqui."
              }
            />
          ) : (
            <div className="flex flex-col gap-5">
              {groups.map(([date, items]) => (
                <section key={date} className="flex flex-col gap-2.5">
                  <DateDivider date={date} messageCount={items.length} />
                  {items.map((msg, index) => (
                    <MessageBubble
                      key={msg.id}
                      message={msg}
                      delay={Math.min(index * 0.02, 0.2)}
                      selected={selectedMessage?.id === msg.id}
                      copied={copiedMessageId === msg.id}
                      onSelect={() => setSelectedMessage(msg)}
                      onCopy={() => void copyMessage(msg)}
                      onReply={() => startMessageAction("reply", msg)}
                      onForward={() => startMessageAction("forward", msg)}
                      onRetry={onRetryMessage ? () => onRetryMessage(msg) : undefined}
                      retrying={retryingMessageIdSet.has(msg.id)}
                    />
                  ))}
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
      {selectedMessage ? (
        <MessageInspector message={selectedMessage} onClose={() => setSelectedMessage(null)} />
      ) : null}
    </div>
  );
}

function DateDivider({ date, messageCount }: { date: string; messageCount: number }) {
  const formatted = new Date(`${date}T12:00:00Z`).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  return (
    <div
      className="sticky top-0 z-10 flex justify-center py-1"
      data-testid="timeline-date-divider"
      data-date={date}
      data-message-count={messageCount}
    >
      <span className="px-3 py-1 rounded-full bg-bg-base/95 shadow-pressed-sm text-[0.65rem] uppercase tracking-widest text-fg-dim font-mono backdrop-blur-xl">
        {formatted} · {messageCount}
      </span>
    </div>
  );
}

function TimelineFilterChip({
  label,
  active,
  testId,
  value,
  onClick,
}: {
  label: string;
  active: boolean;
  testId: string;
  value: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      data-filter-value={value}
      data-active={active ? "true" : undefined}
      onClick={onClick}
      className={cn(
        "h-7 rounded-md px-2.5 font-mono text-[0.62rem] uppercase tracking-widest transition-shadow",
        active
          ? "bg-bg-base text-fg-primary shadow-raised-sm"
          : "text-fg-muted shadow-flat-subtle hover:text-fg-primary hover:shadow-raised-sm",
      )}
    >
      {label}
    </button>
  );
}

interface MessageBubbleProps {
  message: Message;
  delay: number;
  selected: boolean;
  copied: boolean;
  onSelect: () => void;
  onCopy: () => void;
  onReply: () => void;
  onForward: () => void;
  onRetry?: () => void;
  retrying?: boolean;
}

function MessageBubble({
  message,
  delay,
  selected,
  copied,
  onSelect,
  onCopy,
  onReply,
  onForward,
  onRetry,
  retrying,
}: MessageBubbleProps) {
  const outgoing = message.direction === "outbound";
  const failed = message.status === "failed";
  const retryable =
    failed &&
    outgoing &&
    message.contentType === "text" &&
    Boolean(message.body?.trim()) &&
    Boolean(onRetry);
  return (
    <Animate
      preset="rise-in"
      delaySeconds={delay}
      className={cn("flex", outgoing ? "justify-end" : "justify-start")}
    >
      <motion.div
        onClick={onSelect}
        whileHover={{ y: -1 }}
        transition={{ type: "spring", stiffness: 300, damping: 22 }}
        className={cn(
          "group relative isolate overflow-hidden px-4 py-3 outline-none transition-all duration-200",
          "border backdrop-blur-xl",
          outgoing
            ? [
                "rounded-[1.35rem] rounded-br-md border-brand-cyan/25 text-fg-primary",
                "bg-[linear-gradient(135deg,rgba(28,180,172,0.34),rgba(8,98,116,0.42)_44%,rgba(98,74,170,0.26))]",
                "shadow-[0_16px_42px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(255,255,255,0.18)]",
                "after:absolute after:-right-1 after:bottom-3 after:h-3 after:w-3 after:rotate-45 after:rounded-[2px] after:border-r after:border-b after:border-brand-cyan/20 after:bg-[rgba(8,98,116,0.42)]",
              ]
            : [
                "rounded-[1.35rem] rounded-bl-md border-white/[0.08] bg-white/[0.055] text-fg-primary",
                "shadow-[0_14px_34px_rgba(0,0,0,0.22),inset_0_1px_0_rgba(255,255,255,0.08)]",
                "after:absolute after:-left-1 after:bottom-3 after:h-3 after:w-3 after:rotate-45 after:rounded-[2px] after:border-l after:border-b after:border-white/[0.08] after:bg-[rgba(255,255,255,0.055)]",
              ],
          "hover:-translate-y-0.5 hover:border-brand-cyan/30",
          failed && "border-semantic-danger/40 shadow-glow-danger",
          selected && "ring-2 ring-brand-cyan/55",
        )}
        style={{ maxWidth: MESSAGE_BUBBLE_MAX_WIDTH }}
        data-testid="inbox-message-bubble"
        data-direction={message.direction}
        data-content-type={message.contentType}
        data-has-media={messageHasMedia(message) ? "true" : undefined}
        data-selected={selected ? "true" : undefined}
        data-glass="true"
        data-gradient={outgoing ? "outgoing" : undefined}
        data-optimistic={isOptimisticMessage(message) ? "true" : undefined}
      >
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-x-3 top-0 h-px",
            outgoing
              ? "bg-gradient-to-r from-transparent via-brand-cyan/55 to-transparent"
              : "bg-gradient-to-r from-transparent via-white/25 to-transparent",
          )}
        />
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {message.deletedAt && <Badge variant="danger">deletada</Badge>}
            {message.editedAt && <Badge variant="violet">editada</Badge>}
            {message.raw?.isForwarded === true && <Badge>encaminhada</Badge>}
            {message.raw?.isReply === true && <Badge>reply</Badge>}
            {message.raw?.reactionText ? <Badge>reaction</Badge> : null}
            {isOptimisticMessage(message) && (
              <Badge variant={message.status === "failed" ? "danger" : "warning"}>
                {message.status === "failed" ? "falha local" : "local"}
              </Badge>
            )}
            {message.timestampPrecision !== "unknown" && (
              <span
                className={cn(
                  "font-mono text-[0.6rem] uppercase tracking-widest",
                  outgoing ? "text-cyan-50/65" : "text-fg-dim",
                )}
              >
                {message.timestampPrecision}
              </span>
            )}
          </div>
          <MessageActions
            copied={copied}
            outgoing={outgoing}
            messageId={message.id}
            onCopy={onCopy}
            onReply={onReply}
            onForward={onForward}
          />
        </div>
        {message.contentType !== "text" && (
          <div
            className={cn(
              "mb-1 font-mono text-[0.65rem] uppercase tracking-widest",
              outgoing ? "text-cyan-50/70" : "text-fg-dim",
            )}
          >
            {message.contentType}
          </div>
        )}
        {messageHasMedia(message) ? <MediaPreviewCard message={message} outgoing={outgoing} /> : null}
        {message.body ? (
          <div className="text-sm leading-relaxed whitespace-pre-wrap break-words">
            {message.body}
          </div>
        ) : !messageHasMedia(message) ? (
          <div className="text-sm leading-relaxed whitespace-pre-wrap break-words">
            <span className="italic text-fg-muted">[{message.contentType}]</span>
          </div>
        ) : null}
        <div className="flex items-center justify-end gap-1.5 mt-1">
          {retryable && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  data-testid="message-retry-inline"
                  data-retrying={retrying ? "true" : undefined}
                  disabled={retrying}
                  onClick={(event) => {
                    event.stopPropagation();
                    onRetry?.();
                  }}
                  className={cn(
                    "inline-flex h-6 items-center gap-1 rounded-md border px-2 font-mono text-[0.62rem] uppercase tracking-widest",
                    "outline-none transition focus-visible:ring-2 focus-visible:ring-brand-cyan/45",
                    "border-semantic-danger/35 bg-semantic-danger/10 text-semantic-danger",
                    "hover:border-semantic-danger/55 hover:bg-semantic-danger/15",
                    retrying && "cursor-wait opacity-70",
                  )}
                >
                  <RefreshCw className={cn("h-3 w-3", retrying && "animate-spin")} />
                  {retrying ? "Tentando" : "Retry"}
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {retrying ? "Retry em andamento" : "Tentar enviar esta mensagem novamente"}
              </TooltipContent>
            </Tooltip>
          )}
          {failed && !retryable && (
            <Badge variant="danger">
              <AlertCircle className="h-2.5 w-2.5 mr-1" />
              falhou
            </Badge>
          )}
          <span
            className={cn(
              "font-mono text-[0.65rem] tabular-nums",
              outgoing ? "text-cyan-50/70" : "text-fg-dim",
            )}
          >
            {formatTimeWithSeconds(message.waDisplayedAt ?? message.observedAtUtc)}
          </span>
          <Info className={cn("h-3 w-3", outgoing ? "text-cyan-50/55" : "text-fg-dim")} />
          {outgoing && (
            <>
              <ReadReceiptPill message={message} />
              <DeliveryStatusIndicator status={message.status} />
            </>
          )}
        </div>
      </motion.div>
    </Animate>
  );
}

function MediaPreviewCard({ message, outgoing }: { message: Message; outgoing: boolean }) {
  const media = message.media;
  const type = media?.type ?? mediaTypeFromContentType(message.contentType);
  const url = mediaAssetUrl(media?.mediaAssetId);
  const fileName = media?.fileName ?? message.body ?? `${message.contentType} #${message.id}`;
  const size = media?.sizeBytes != null ? formatFileSize(media.sizeBytes) : null;
  const duration = media?.durationMs != null ? formatDuration(media.durationMs) : null;
  const Icon = mediaIcon(type);

  return (
    <div
      className={cn(
        "mb-2 overflow-hidden rounded-xl border shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl",
        outgoing ? "border-cyan-50/12 bg-slate-950/18" : "border-white/[0.08] bg-black/14",
      )}
      data-testid="message-media-card"
      data-media-type={type}
      data-media-asset-id={media?.mediaAssetId ?? undefined}
    >
      {type === "image" && url ? (
        <img
          src={url}
          alt={fileName}
          loading="lazy"
          className="max-h-72 w-full rounded-t-xl object-cover"
          data-testid="message-media-image"
        />
      ) : type === "video" && url ? (
        <video
          src={url}
          controls
          preload="metadata"
          className="max-h-72 w-full rounded-t-xl bg-black/35"
          data-testid="message-media-video"
        />
      ) : type === "audio" || type === "voice" ? (
        url ? (
          <div className="p-3">
            <audio
              src={url}
              controls
              preload="metadata"
              className="h-9 w-full"
              data-testid="message-media-audio"
            />
          </div>
        ) : null
      ) : null}

      <div className="flex min-w-0 items-center gap-3 px-3 py-2.5">
        <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-bg-base/80 text-brand-cyan shadow-pressed-sm">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-fg-primary">{fileName}</div>
          <div className="mt-0.5 flex flex-wrap gap-1.5 font-mono text-[0.6rem] uppercase tracking-widest text-fg-dim">
            <span>{type}</span>
            {media?.mimeType ? <span>{media.mimeType}</span> : null}
            {size ? <span>{size}</span> : null}
            {duration ? <span>{duration}</span> : null}
          </div>
        </div>
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            title="Abrir mídia"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-fg-muted outline-none transition hover:bg-white/[0.07] hover:text-fg-primary focus-visible:ring-2 focus-visible:ring-brand-cyan/45"
          >
            <Download className="h-3.5 w-3.5" />
          </a>
        ) : null}
      </div>
    </div>
  );
}

function ReadReceiptPill({ message }: { message: Message }) {
  const receipt = readReceiptState(message);
  if (!receipt) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-testid="message-read-receipt"
          data-read-receipt={receipt.state}
          data-read-receipt-source={receipt.source}
          className={cn(
            "inline-flex h-5 items-center gap-1 rounded-full border px-1.5 font-mono text-[0.58rem] uppercase tracking-widest",
            receipt.state === "read"
              ? "border-brand-cyan/45 bg-brand-cyan/12 text-brand-cyan"
              : "border-cyan-50/12 bg-slate-950/18 text-cyan-50/70",
          )}
        >
          <CheckCheck className="h-3 w-3" />
          {receipt.label}
        </span>
      </TooltipTrigger>
      <TooltipContent>{receipt.tooltip}</TooltipContent>
    </Tooltip>
  );
}

interface MessageActionsProps {
  copied: boolean;
  outgoing: boolean;
  messageId: number;
  onCopy: () => void;
  onReply: () => void;
  onForward: () => void;
}

function MessageActions({
  copied,
  outgoing,
  messageId,
  onCopy,
  onReply,
  onForward,
}: MessageActionsProps) {
  return (
    <div
      data-testid="message-actions-toolbar"
      className={cn(
        "flex shrink-0 items-center gap-1 rounded-lg border p-0.5 opacity-85 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]",
        "transition-opacity group-hover:opacity-100 group-focus-within:opacity-100",
        outgoing ? "border-cyan-50/10 bg-slate-950/20" : "border-white/[0.08] bg-black/15",
      )}
    >
      <MessageActionButton
        icon={copied ? Check : Copy}
        label={`Copiar mensagem #${messageId}`}
        testId="message-action-copy"
        active={copied}
        onClick={onCopy}
      />
      <MessageActionButton
        icon={Reply}
        label={`Responder mensagem #${messageId}`}
        testId="message-action-reply"
        onClick={onReply}
      />
      <MessageActionButton
        icon={Forward}
        label={`Encaminhar mensagem #${messageId}`}
        testId="message-action-forward"
        onClick={onForward}
      />
    </div>
  );
}

interface MessageActionButtonProps {
  icon: typeof Copy;
  label: string;
  testId: string;
  active?: boolean;
  onClick: () => void;
}

function MessageActionButton({
  icon: Icon,
  label,
  testId,
  active,
  onClick,
}: MessageActionButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          data-testid={testId}
          data-active={active ? "true" : undefined}
          onClick={(event) => {
            event.stopPropagation();
            onClick();
          }}
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded-md text-fg-muted outline-none transition",
            "hover:bg-white/[0.08] hover:text-fg-primary focus-visible:ring-2 focus-visible:ring-brand-cyan/45",
            active && "bg-brand-cyan/12 text-brand-cyan",
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) {
    throw new Error("Clipboard indisponível.");
  }
}

function MessageInspector({ message, onClose }: { message: Message; onClose: () => void }) {
  const raw = message.raw ?? {};
  return (
    <aside
      data-testid="message-inspector"
      className="hidden w-[360px] shrink-0 flex-col border-l border-contour-line/40 xl:flex"
    >
      <div className="flex items-center justify-between border-b border-contour-line/40 px-4 py-3">
        <div>
          <div className="text-sm font-medium">Detalhe da mensagem</div>
          <div className="mt-0.5 font-mono text-[0.65rem] uppercase tracking-widest text-fg-dim">
            #{message.id}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          data-testid="message-inspector-close"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-fg-muted shadow-flat hover:text-fg-primary hover:shadow-raised-sm"
          aria-label="Fechar detalhe"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <InspectorSection title="Identidade">
          <InspectorField
            label="External ID"
            value={message.externalId ?? "sem external id"}
            mono
          />
          <InspectorField label="Direção" value={message.direction} mono />
          <InspectorField label="Tipo" value={message.contentType} mono />
          <InspectorField label="Status" value={message.status} mono />
        </InspectorSection>

        <InspectorSection title="Tempo">
          <InspectorField label="WPP exibiu" value={formatDateTime(message.waDisplayedAt)} mono />
          <InspectorField label="Precisão" value={message.timestampPrecision} mono />
          <InspectorField label="Segundo real" value={nullableNumber(message.messageSecond)} mono />
          <InspectorField
            label="Segundo inferido"
            value={nullableNumber(message.waInferredSecond)}
            mono
          />
          <InspectorField label="Capturado" value={formatDateTime(message.observedAtUtc)} mono />
        </InspectorSection>

        <InspectorSection title="Flags">
          <div className="flex flex-wrap gap-1.5">
            {message.editedAt ? <Badge variant="violet">editada</Badge> : null}
            {message.deletedAt ? <Badge variant="danger">deletada</Badge> : null}
            {raw.isForwarded === true ? <Badge>encaminhada</Badge> : null}
            {raw.isReply === true ? <Badge>reply</Badge> : null}
            {raw.isPoll === true ? <Badge>poll</Badge> : null}
            {raw.isLocation === true ? <Badge>location</Badge> : null}
            {raw.reactionText ? <Badge>reaction</Badge> : null}
            {!message.editedAt &&
            !message.deletedAt &&
            raw.isForwarded !== true &&
            raw.isReply !== true &&
            raw.isPoll !== true &&
            raw.isLocation !== true &&
            !raw.reactionText ? (
              <span className="text-xs text-fg-dim">Sem flags especiais.</span>
            ) : null}
          </div>
          {typeof raw.quotedText === "string" && raw.quotedText.length > 0 ? (
            <pre className="max-h-24 overflow-auto rounded-lg bg-bg-base p-2 text-xs text-fg-muted shadow-pressed-sm">
              {raw.quotedText}
            </pre>
          ) : null}
        </InspectorSection>

        <InspectorSection title="Conteúdo">
          <pre className="max-h-40 overflow-auto rounded-lg bg-bg-base p-3 text-xs leading-relaxed text-fg-primary shadow-pressed-sm">
            {message.body ?? `[${message.contentType}]`}
          </pre>
        </InspectorSection>

        {Array.isArray(raw.editHistory) && raw.editHistory.length > 0 ? (
          <InspectorSection title="Histórico de edição">
            <pre className="max-h-44 overflow-auto rounded-lg bg-bg-base p-3 text-xs text-fg-muted shadow-pressed-sm">
              {JSON.stringify(raw.editHistory, null, 2)}
            </pre>
          </InspectorSection>
        ) : null}

        <InspectorSection title="Raw">
          <pre className="max-h-64 overflow-auto rounded-lg bg-bg-base p-3 text-xs text-fg-muted shadow-pressed-sm">
            {JSON.stringify(raw, null, 2)}
          </pre>
        </InspectorSection>
      </div>
    </aside>
  );
}

function InspectorSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="font-mono text-[0.65rem] uppercase tracking-widest text-fg-dim">{title}</div>
      {children}
    </section>
  );
}

function InspectorField({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 text-xs">
      <span className="shrink-0 text-fg-dim">{label}</span>
      <span className={cn("min-w-0 break-all text-right text-fg-primary", mono && "font-mono")}>
        {value}
      </span>
    </div>
  );
}

function DeliveryStatusIndicator({ status }: { status: MessageStatus }) {
  const shouldReduceMotion = useReducedMotion();
  const meta = DELIVERY_STATUS_META[status];
  if (!meta) {
    return null;
  }

  const Icon = meta.Icon;
  const isPending = status === "pending";
  const isRead = status === "read";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <motion.span
          role="img"
          tabIndex={0}
          aria-label={`Status de entrega: ${meta.label}`}
          data-testid="message-delivery-status"
          data-delivery-status={status}
          data-delivery-stage={meta.stage}
          data-delivery-animated="true"
          className={cn(
            "relative inline-flex h-5 min-w-5 items-center justify-center rounded-full border px-0.5",
            "outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-brand-cyan/45",
            meta.shellClassName,
          )}
          initial={false}
          animate={
            isPending && !shouldReduceMotion
              ? { opacity: [0.72, 1, 0.72], scale: [0.98, 1.04, 0.98] }
              : { opacity: 1, scale: 1 }
          }
          transition={
            isPending && !shouldReduceMotion
              ? { duration: 1.35, repeat: Infinity, ease: "easeInOut" }
              : { duration: 0.18 }
          }
        >
          {isRead && !shouldReduceMotion ? (
            <motion.span
              aria-hidden="true"
              data-testid="message-delivery-read-pulse"
              className="absolute inset-0 rounded-full border border-brand-cyan/40"
              initial={{ opacity: 0.55, scale: 0.82 }}
              animate={{ opacity: 0, scale: 1.55 }}
              transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
            />
          ) : null}
          <motion.span
            key={status}
            aria-hidden="true"
            className={cn("relative z-10 inline-flex", meta.iconClassName)}
            initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.72, y: 2 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 460, damping: 24 }}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={2.4} />
          </motion.span>
        </motion.span>
      </TooltipTrigger>
      <TooltipContent>{meta.label}</TooltipContent>
    </Tooltip>
  );
}

function mediaTypeFromContentType(contentType: MessageContentType) {
  if (contentType === "image") return "image";
  if (contentType === "video") return "video";
  if (contentType === "voice") return "voice";
  if (contentType === "audio") return "audio";
  if (contentType === "document") return "document";
  return "document";
}

function mediaIcon(type: ReturnType<typeof mediaTypeFromContentType>): LucideIcon {
  if (type === "image") return ImageIcon;
  if (type === "video") return Video;
  if (type === "audio" || type === "voice") return Volume2;
  return FileText;
}

function readReceiptState(message: Message): {
  state: "sent" | "delivered" | "read";
  source: "observer" | "status";
  label: string;
  tooltip: string;
} | null {
  if (message.direction !== "outbound") return null;
  const rawReceipt = stringRawValue(message.raw?.readReceipt);
  const rawDelivery = stringRawValue(message.raw?.deliveryStatus);
  const rawAck = stringRawValue(message.raw?.ack);
  const rawLabel = stringRawValue(message.raw?.statusLabel);
  const source = rawReceipt || rawDelivery || rawAck || rawLabel ? "observer" : "status";
  const probe = `${rawReceipt} ${rawDelivery} ${rawAck} ${rawLabel}`.toLowerCase();
  if (message.status === "read" || probe.includes("read") || probe.includes("lida")) {
    return {
      state: "read",
      source,
      label: "lida",
      tooltip:
        source === "observer"
          ? "Leitura capturada pelo observer do WhatsApp"
          : "Mensagem marcada como lida pelo status persistido",
    };
  }
  if (message.status === "delivered" || probe.includes("delivered") || probe.includes("entreg")) {
    return {
      state: "delivered",
      source,
      label: "entregue",
      tooltip:
        source === "observer"
          ? "Entrega capturada pelo observer do WhatsApp"
          : "Mensagem marcada como entregue pelo status persistido",
    };
  }
  if (message.status === "sent" || probe.includes("sent") || probe.includes("envi")) {
    return {
      state: "sent",
      source,
      label: "enviada",
      tooltip:
        source === "observer"
          ? "Envio capturado pelo observer do WhatsApp"
          : "Mensagem marcada como enviada pelo status persistido",
    };
  }
  return null;
}

function stringRawValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatTimeWithSeconds(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "não exposto";
  return new Date(iso).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "medium",
  });
}

function nullableNumber(value: number | null): string {
  return value === null ? "NULL" : String(value).padStart(2, "0");
}

function messageHasMedia(message: Message): boolean {
  return Boolean(message.media) || MEDIA_CONTENT_TYPES.has(message.contentType);
}

function localDateKey(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function timelineMs(message: Message): number {
  const base = Date.parse(message.waDisplayedAt ?? message.observedAtUtc);
  const inferredSecond =
    message.messageSecond ??
    message.waInferredSecond ??
    new Date(message.observedAtUtc).getSeconds();
  if (!Number.isFinite(base)) {
    return Date.parse(message.observedAtUtc);
  }
  const date = new Date(base);
  date.setSeconds(inferredSecond, 0);
  return date.getTime();
}
