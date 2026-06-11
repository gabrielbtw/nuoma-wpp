import { useVirtualizer } from "@tanstack/react-virtual";
import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  ChannelIcon,
  EmptyState,
  ErrorState,
  LoadingState,
  TimeAgo,
  cn,
} from "@nuoma/ui";

import {
  INBOX_CONVERSATION_LIMIT,
  INBOX_CONVERSATION_ROW_ESTIMATE,
} from "./conversation-list-config.js";
import { conversationDisplayTitle } from "./conversation-display.js";
import { trpc } from "../lib/trpc.js";
import { mediaAssetUrl } from "../lib/media-url.js";

interface ConversationListProps {
  selectedId: number | null;
  onSelect(id: number): void;
  autoSelect?: boolean;
}

const FILTER_CHIPS: { id: ChannelOrAll; label: string }[] = [
  { id: "all", label: "Todas" },
  { id: "whatsapp", label: "WA" },
  { id: "instagram", label: "IG" },
  { id: "system", label: "Sys" },
];

type ChannelOrAll = "all" | "whatsapp" | "instagram" | "system";
type OperationalFilter = "all" | "unread" | "failed";

const OPERATIONAL_FILTERS: { id: OperationalFilter; label: string }[] = [
  { id: "all", label: "Tudo" },
  { id: "unread", label: "Não lidas" },
  { id: "failed", label: "Falhas" },
];

export function ConversationList({ selectedId, onSelect, autoSelect = true }: ConversationListProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ChannelOrAll>("all");
  const [operationalFilter, setOperationalFilter] = useState<OperationalFilter>("all");
  const [tagFilter, setTagFilter] = useState<number | "all">("all");
  const conversations = trpc.conversations.listUnified.useQuery(
    {
      limit: INBOX_CONVERSATION_LIMIT,
      channel: filter,
      operationalStatus: operationalFilter,
      tagId: tagFilter === "all" ? undefined : tagFilter,
      search: query.trim() || undefined,
    },
    { refetchInterval: 5_000 },
  );
  const tags = trpc.tags.list.useQuery(undefined, { staleTime: 30_000 });

  const filtered = useMemo(() => {
    return conversations.data?.conversations ?? [];
  }, [conversations.data]);

  useEffect(() => {
    const selectedIsVisible = selectedId != null && filtered.some((item) => item.id === selectedId);
    if (autoSelect && (selectedId == null || !selectedIsVisible) && filtered.length > 0) {
      onSelect(filtered[0]!.id);
    }
  }, [autoSelect, filtered, selectedId, onSelect]);

  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => INBOX_CONVERSATION_ROW_ESTIMATE,
    getItemKey: (index) => filtered[index]?.id ?? index,
    overscan: 6,
  });
  const virtualItems = rowVirtualizer.getVirtualItems();

  useEffect(() => {
    rowVirtualizer.scrollToOffset(0);
  }, [filter, operationalFilter, query, rowVirtualizer, tagFilter]);

  const hasActiveOperationalFilter =
    operationalFilter !== "all" || tagFilter !== "all" || filter !== "all" || query.trim() !== "";

  return (
    <aside
      data-testid="inbox-conversation-list"
      className="nuoma-compat-surface flex h-full flex-col overflow-hidden rounded-lg"
    >
      <div className="flex flex-col gap-3 border-b border-contour-line/30 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-fg-primary">Atendimento</div>
            <div className="font-mono text-[0.62rem] uppercase text-fg-dim">
              {filtered.length} conversas ativas
            </div>
          </div>
          <Badge variant="cyan">{conversations.data?.summary.total ?? 0}</Badge>
        </div>
        <div className="flex items-center gap-2 px-3 h-10 rounded-lg bg-bg-base shadow-pressed-sm focus-within:ring-2 focus-within:ring-brand-cyan/40">
          <Search className="h-3.5 w-3.5 text-fg-dim shrink-0" />
          <input
            type="search"
            aria-label="Buscar conversa"
            autoComplete="off"
            placeholder="Buscar conversa…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-fg-dim"
          />
        </div>
        <div className="flex gap-1.5">
          {FILTER_CHIPS.map((chip) => (
            <button
              key={chip.id}
              type="button"
              onClick={() => setFilter(chip.id)}
              className={cn(
                "h-7 rounded-md px-2.5 font-mono text-[0.65rem] uppercase tracking-widest transition-shadow",
                filter === chip.id
                  ? "bg-brand-cyan/12 text-brand-cyan shadow-glow-cyan"
                  : "text-fg-muted shadow-flat-subtle hover:shadow-raised-sm hover:text-fg-primary",
              )}
            >
              {chip.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          {OPERATIONAL_FILTERS.map((chip) => (
            <button
              key={chip.id}
              type="button"
              onClick={() => setOperationalFilter(chip.id)}
              data-testid="inbox-operational-filter"
              data-filter-value={chip.id}
              className={cn(
                "h-7 rounded-md px-2.5 font-mono text-[0.65rem] uppercase tracking-widest transition-shadow",
                operationalFilter === chip.id
                  ? chip.id === "failed"
                    ? "bg-semantic-danger/12 text-semantic-danger shadow-glow-danger"
                    : "bg-brand-gold/12 text-brand-gold shadow-glow-gold"
                  : "text-fg-muted shadow-flat-subtle hover:shadow-raised-sm hover:text-fg-primary",
              )}
            >
              {chip.label}
            </button>
          ))}
        </div>
        <label className="flex h-9 items-center gap-2 rounded-lg bg-bg-base px-3 shadow-pressed-sm">
          <span className="font-mono text-[0.62rem] uppercase tracking-widest text-fg-dim">
            Tag
          </span>
          <select
            value={tagFilter}
            onChange={(event) =>
              setTagFilter(event.target.value === "all" ? "all" : Number(event.target.value))
            }
            data-testid="inbox-tag-filter"
            className="min-w-0 flex-1 bg-transparent text-sm text-fg-primary outline-none"
          >
            <option value="all">Todas</option>
            {(tags.data?.tags ?? []).map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </select>
        </label>
        {hasActiveOperationalFilter && (
          <button
            type="button"
            onClick={() => {
              setFilter("all");
              setOperationalFilter("all");
              setTagFilter("all");
              setQuery("");
            }}
            data-testid="inbox-filter-clear"
            className="h-7 self-start rounded-md px-2.5 font-mono text-[0.65rem] uppercase tracking-widest text-fg-muted shadow-flat-subtle transition-shadow hover:text-fg-primary hover:shadow-raised-sm"
          >
            Limpar filtros
          </button>
        )}
      </div>
      <div
        ref={parentRef}
        data-testid="inbox-conversation-virtual-scroll"
        data-total-count={filtered.length}
        data-visible-count={virtualItems.length}
        data-virtualized="true"
        className="flex-1 overflow-y-auto"
      >
        {conversations.isLoading ? (
          <LoadingState />
        ) : conversations.error ? (
          <ErrorState description={conversations.error.message} />
        ) : filtered.length === 0 ? (
          <EmptyState description={query ? "Nada bate com o filtro." : "Sem conversas."} />
        ) : (
          <div
            data-testid="inbox-conversation-virtual-spacer"
            style={{
              height: rowVirtualizer.getTotalSize(),
              position: "relative",
              width: "100%",
            }}
          >
            {virtualItems.map((vi) => {
              const conv = filtered[vi.index];
              if (!conv) return null;
              const active = conv.id === selectedId;
              const displayTitle = conversationDisplayTitle(conv);
              const avatarUrl = mediaAssetUrl(conv.profilePhotoMediaAssetId);
              return (
                <button
                  key={vi.key}
                  type="button"
                  onClick={() => onSelect(conv.id)}
                  data-testid="inbox-conversation-row"
                  data-conv={conv.id}
                  data-virtual-index={vi.index}
                  data-active={active ? "true" : undefined}
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    "absolute left-2 right-2 flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors transition-shadow",
                    active
                      ? "bg-brand-cyan/10 shadow-glow-cyan"
                      : "hover:bg-bg-base/76 hover:shadow-flat",
                  )}
                  style={{
                    transform: `translateY(${vi.start}px)`,
                    height: vi.size,
                  }}
                >
                  <div className="relative shrink-0">
                    <Avatar className="h-10 w-10" data-testid="inbox-conversation-avatar">
                      {avatarUrl ? (
                        <AvatarImage
                          src={avatarUrl}
                          alt={displayTitle}
                          data-testid="inbox-conversation-avatar-image"
                        />
                      ) : null}
                      <AvatarFallback>{initialsForTitle(displayTitle)}</AvatarFallback>
                    </Avatar>
                    <div className="absolute -bottom-1 -right-1">
                      <ChannelIcon channel={conv.channel} variant="chip" />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <div
                        className={cn(
                          "text-sm truncate",
                          active ? "text-fg-primary" : "text-fg-primary",
                        )}
                      >
                        {displayTitle}
                      </div>
                      {conv.lastMessageAt && (
                        <TimeAgo date={conv.lastMessageAt} className="shrink-0" />
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <div className="font-mono text-[0.65rem] text-fg-dim truncate">
                        {conv.lastPreview ?? conv.externalThreadId}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {conv.hasFailedMessages && <Badge variant="danger">falha</Badge>}
                        {conv.unreadCount > 0 && <Badge variant="cyan">{conv.unreadCount}</Badge>}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between border-t border-contour-line/30 px-4 py-3 font-mono text-[0.65rem] uppercase tracking-widest text-fg-dim">
        <span>{filtered.length} conversas</span>
        <span>j/k navegar · Esc fechar</span>
      </div>
    </aside>
  );
}

function initialsForTitle(title: string): string {
  const parts = title
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  }
  return title.slice(0, 2).toUpperCase() || "??";
}
