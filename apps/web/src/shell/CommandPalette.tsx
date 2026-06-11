import { useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  Dialog,
  DialogContent,
  Input,
  KeyboardShortcut,
  VisuallyHidden,
  cn,
} from "@nuoma/ui";

import { getShellShortcutItems } from "./nav-registry.js";

interface Command {
  id: string;
  label: string;
  hint?: string;
  group: "Navegação" | "Ação";
  run(): void;
}

interface CommandPaletteProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  isAdmin: boolean;
}

export function CommandPalette({ open, onOpenChange, isAdmin }: CommandPaletteProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveIndex(0);
    } else {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const commands = useMemo<Command[]>(
    () => [
      ...getShellShortcutItems(isAdmin).map((item) => ({
        id: `go.${item.path}`,
        label: item.label,
        hint: item.shortcut,
        group: "Navegação" as const,
        run: () => navigate({ to: item.path }),
      })),
      {
        id: "action.contacts.create",
        label: "Criar contato",
        hint: "Novo",
        group: "Ação",
        run: () => navigate({ to: "/contacts", search: { intent: "create" } }),
      },
      {
        id: "action.campaigns.preview",
        label: "Preparar disparo de campanha",
        hint: "Seguro",
        group: "Ação",
        run: () => navigate({ to: "/campaigns", search: { intent: "enqueue" } }),
      },
      {
        id: "action.automations.trigger",
        label: "Testar automação manual",
        hint: "Simulação",
        group: "Ação",
        run: () => navigate({ to: "/automations", search: { intent: "trigger" } }),
      },
    ],
    [isAdmin, navigate],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((command) => command.label.toLowerCase().includes(q));
  }, [commands, query]);

  useEffect(() => {
    if (activeIndex >= filtered.length) setActiveIndex(0);
  }, [filtered.length, activeIndex]);

  function runCommand(command: Command) {
    command.run();
    onOpenChange(false);
  }

  function onKey(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const selected = filtered[activeIndex];
      if (selected) runCommand(selected);
    }
  }

  const grouped = useMemo(() => {
    const map = new Map<string, Command[]>();
    for (const command of filtered) {
      const list = map.get(command.group) ?? [];
      list.push(command);
      map.set(command.group, list);
    }
    return Array.from(map.entries());
  }, [filtered]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-xl overflow-hidden border border-line-hairline bg-surface-1 p-0 text-ink-strong"
        showClose={false}
        onKeyDown={onKey}
      >
        <VisuallyHidden>Paleta de comandos</VisuallyHidden>
        <div className="flex items-center gap-3 border-b border-line-hairline px-5 py-4">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-line-hairline bg-surface-0 text-accent">
            <Search className="h-4 w-4" />
          </span>
          <Input
            ref={inputRef}
            placeholder="Buscar comando..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-10 border-0 bg-transparent px-0 text-base text-ink-strong shadow-none focus:ring-0"
          />
          <KeyboardShortcut keys="Esc" />
        </div>
        <div className="max-h-[26rem] overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-ink-base">
              Nenhum comando encontrado
            </div>
          ) : (
            grouped.map(([group, items]) => (
              <div key={group} className="px-2">
                <div className="px-3 py-2 font-mono text-[0.65rem] uppercase text-ink-faint">
                  {group}
                </div>
                {items.map((command) => {
                  const index = filtered.indexOf(command);
                  const active = index === activeIndex;
                  return (
                    <button
                      key={command.id}
                      type="button"
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => runCommand(command)}
                      className={cn(
                        "flex w-full items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors",
                        active
                          ? "bg-surface-2 text-ink-strong"
                          : "text-ink-base hover:bg-surface-2 hover:text-ink-strong",
                      )}
                    >
                      <span>{command.label}</span>
                      {command.hint && <KeyboardShortcut keys={command.hint.split(" ")} />}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
