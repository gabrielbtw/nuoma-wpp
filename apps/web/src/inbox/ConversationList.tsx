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
import { conversationDisplayTitle, conversationSearchText } from "./conversation-display.js";
import { trpc } from "../lib/trpc.js";
import { mediaAssetUrl } from "../lib/media-url.js";

interface ConversationListProps {
  selectedId: number | null;
  onSelect(id: number): void;
}

const FILTER_CHIPS: { id: ChannelOrAll; label: string }[] = [
  { id: "all", label: "Todas" },
  { id: "whatsapp", label: "WA" },
  { id: "instagram", label: "IG" },
  { id: "system", label: "Sys" },
];

type ChannelOrAll = "all" | "whatsapp" | "instagram" | "system";

export function ConversationList({ selectedId, onSelect }: ConversationListProps) {
  const conversations = trpc.conversations.list.useQuery(
    { limit: INBOX_CONVERSATION_LIMIT },
    { refetchInterval: 5_000 },
  );

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ChannelOrAll>("all");

  const filtered = useMemo(() => {
    const list = conversations.data?.conversations ?? [];
    const q = query.trim().toLowerCase();
    return list.filter((c) => {
      if (filter !== "all" && c.channel !== filter) return false;
      if (q && !conversationSearchText(c).toLowerCase().includes(q)) return false;
      return true;
    });
  }, [conversations.data, query, filter]);

  useEffect(() => {
    const selectedIsVisible = selectedId != null && filtered.some((item) => item.id === selectedId);
    if ((selectedId == null || !selectedIsVisible) && filtered.length > 0) {
      onSelect(filtered[0]!.id);
    }
  }, [filtered, selectedId, onSelect]);

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
  }, [filter, query, rowVirtualizer]);

  return (
    <aside
      data-testid="inbox-conversation-list"
      className="flex flex-col h-full rounded-xxl bg-bg-base shadow-raised-md overflow-hidden"
    >
      <div className="p-4 flex flex-col gap-3 border-b border-contour-line/40">
        <div className="flex items-center gap-2 px-3 h-10 rounded-lg bg-bg-base shadow-pressed-sm">
          <Search className="h-3.5 w-3.5 text-fg-dim shrink-0" />
          <input
            type="search"
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
                "px-2.5 h-7 rounded-md text-[0.65rem] font-mono uppercase tracking-widest transition-shadow",
                filter === chip.id
                  ? "bg-bg-base shadow-raised-sm text-fg-primary"
                  : "text-fg-muted shadow-flat-subtle hover:shadow-raised-sm hover:text-fg-primary",
              )}
            >
              {chip.label}
            </button>
          ))}
        </div>
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
                  className={cn(
                    "absolute left-2 right-2 flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors transition-shadow",
                    active
                      ? "bg-bg-base shadow-pressed-sm"
                      : "hover:bg-bg-base hover:shadow-flat",
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
                      {conv.unreadCount > 0 && <Badge variant="cyan">{conv.unreadCount}</Badge>}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div className="px-4 py-3 border-t border-contour-line/40 flex items-center justify-between text-[0.65rem] uppercase tracking-widest text-fg-dim font-mono">
        <span>{filtered.length} conversas</span>
        <span>↑↓ navegar · enter abrir</span>
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
