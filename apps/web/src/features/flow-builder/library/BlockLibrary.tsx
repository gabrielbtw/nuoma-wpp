import type { ChannelType } from "@nuoma/contracts";
import { Search } from "lucide-react";
import { useMemo, useState, type DragEvent } from "react";

import { ChannelIcon, Input, cn } from "@nuoma/ui";

import { BLOCK_DRAG_MIME } from "../canvas/FlowCanvas.js";
import type { LibraryBlock, LibraryBlockKey } from "../config/action-registry.js";
import { LIBRARY_CATEGORIES } from "../config/step-registry.js";

const TONE_CHIP: Record<string, string> = {
  accent: "bg-accent/12 text-accent",
  wa: "bg-channel-wa/12 text-channel-wa",
  ig: "bg-channel-ig/12 text-channel-ig",
  info: "bg-status-info/12 text-status-info",
  ok: "bg-status-ok/12 text-status-ok",
  warn: "bg-status-warn/14 text-status-warn",
  danger: "bg-status-error/12 text-status-error",
  neutral: "bg-ink-strong/[0.06] text-ink-soft",
};

export interface BlockLibraryProps {
  blocks: LibraryBlock[];
  /** active flow channel; blocks without support get a hint */
  channel: ChannelType | "";
  onAdd: (block: LibraryBlockKey) => void;
}

export function BlockLibrary({ blocks, channel, onAdd }: BlockLibraryProps) {
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return blocks;
    return blocks.filter(
      (block) =>
        block.label.toLowerCase().includes(term) || block.description.toLowerCase().includes(term),
    );
  }, [blocks, query]);

  const sections = LIBRARY_CATEGORIES.map((category) => ({
    ...category,
    blocks: visible.filter((block) => block.category === category.id),
  })).filter((section) => section.blocks.length > 0);

  return (
    <div className="flex h-full flex-col" data-testid="block-library">
      <div className="border-b border-line-hairline px-4 pb-3 pt-4">
        <p className="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-ink-faint">
          Blocos
        </p>
        <div className="relative mt-2.5">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar bloco…"
            className="h-9 pl-9 text-xs"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-6 pt-3">
        {sections.length === 0 ? (
          <p className="px-2 pt-4 text-xs text-ink-faint">Nenhum bloco encontrado.</p>
        ) : (
          sections.map((section) => (
            <section key={section.id} className="mb-4">
              <h3 className="px-2 pb-1.5 text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                {section.label}
              </h3>
              <ul className="grid gap-1">
                {section.blocks.map((block) => {
                  const unsupported =
                    channel === "instagram" && !block.channels.includes("instagram");
                  const Icon = block.icon;
                  return (
                    <li key={block.key}>
                      <button
                        type="button"
                        draggable
                        data-testid={`library-block-${block.key}`}
                        onDragStart={(event: DragEvent<HTMLButtonElement>) => {
                          event.dataTransfer.setData(BLOCK_DRAG_MIME, block.key);
                          event.dataTransfer.effectAllowed = "copy";
                        }}
                        onClick={() => onAdd(block.key)}
                        className={cn(
                          "group flex w-full cursor-grab items-start gap-2.5 rounded-lg border border-transparent px-2 py-2 text-left",
                          "transition-colors duration-150 hover:border-line-hairline hover:bg-surface-2 active:cursor-grabbing",
                        )}
                        title={
                          unsupported
                            ? `${block.label} — sem suporte no Instagram`
                            : `${block.label} — clique ou arraste para o fluxo`
                        }
                      >
                        <span
                          className={cn(
                            "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
                            TONE_CHIP[block.tone],
                          )}
                        >
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-xs font-medium text-ink-strong">
                              {block.label}
                            </span>
                            {unsupported ? (
                              <ChannelIcon
                                channel="instagram"
                                className="h-3 w-3 opacity-40 grayscale"
                              />
                            ) : null}
                          </span>
                          <span className="mt-0.5 block truncate text-[0.68rem] leading-4 text-ink-faint">
                            {block.description}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
