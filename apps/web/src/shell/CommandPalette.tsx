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
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
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
      { id: "go.dashboard", label: "Dashboard", hint: "G D", group: "Navegação", run: () => navigate({ to: "/" }) },
      { id: "go.inbox", label: "Inbox", hint: "G I", group: "Navegação", run: () => navigate({ to: "/inbox" }) },
      { id: "go.contacts", label: "Contatos", group: "Navegação", run: () => navigate({ to: "/contacts" }) },
      { id: "go.campaigns", label: "Campanhas", group: "Navegação", run: () => navigate({ to: "/campaigns" }) },
      { id: "go.automations", label: "Automações", group: "Navegação", run: () => navigate({ to: "/automations" }) },
      { id: "go.chatbots", label: "Chatbots", group: "Navegação", run: () => navigate({ to: "/chatbots" }) },
      { id: "go.jobs", label: "Jobs", group: "Navegação", run: () => navigate({ to: "/jobs" }) },
      { id: "go.implementation", label: "Implementação", group: "Navegação", run: () => navigate({ to: "/implementation" }) },
      { id: "go.evidence", label: "Evidências", hint: "M37", group: "Navegação", run: () => navigate({ to: "/evidence" }) },
      { id: "go.settings", label: "Configurações", group: "Navegação", run: () => navigate({ to: "/settings" }) },
      { id: "go.dev", label: "Dev / Componentes", group: "Ação", run: () => navigate({ to: "/dev/components" }) },
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
        hint: "Dry-run",
        group: "Ação",
        run: () => navigate({ to: "/automations", search: { intent: "trigger" } }),
      },
    ],
    [navigate],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(q));
  }, [commands, query]);

  useEffect(() => {
    if (activeIndex >= filtered.length) setActiveIndex(0);
  }, [filtered.length, activeIndex]);

  function runCommand(cmd: Command) {
    cmd.run();
    onOpenChange(false);
  }

  function onKey(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const selected = filtered[activeIndex];
      if (selected) runCommand(selected);
    }
  }

  // group commands
  const grouped = useMemo(() => {
    const map = new Map<string, Command[]>();
    for (const cmd of filtered) {
      const list = map.get(cmd.group) ?? [];
      list.push(cmd);
      map.set(cmd.group, list);
    }
    return Array.from(map.entries());
  }, [filtered]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl p-0 overflow-hidden" showClose={false} onKeyDown={onKey}>
        <VisuallyHidden>Command palette</VisuallyHidden>
        <div className="flex items-center gap-3 px-5 py-4 border-b border-contour-line">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-bg-base shadow-pressed-sm text-fg-muted">
            <Search className="h-4 w-4" />
          </span>
          <Input
            ref={inputRef}
            placeholder="Buscar comando…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="border-0 bg-transparent shadow-none h-10 px-0 focus:ring-0 focus:shadow-none text-base"
          />
          <KeyboardShortcut keys="Esc" />
        </div>
        <div className="max-h-[26rem] overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-fg-muted">
              Nenhum comando encontrado
            </div>
          ) : (
            grouped.map(([group, items]) => (
              <div key={group} className="px-2">
                <div className="px-3 py-2 text-[0.65rem] uppercase tracking-widest text-fg-dim font-mono">
                  {group}
                </div>
                {items.map((cmd) => {
                  const idx = filtered.indexOf(cmd);
                  const active = idx === activeIndex;
                  return (
                    <button
                      key={cmd.id}
                      type="button"
                      onMouseEnter={() => setActiveIndex(idx)}
                      onClick={() => runCommand(cmd)}
                      className={cn(
                        "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-shadow",
                        active
                          ? "bg-bg-base shadow-raised-sm text-fg-primary"
                          : "text-fg-muted hover:text-fg-primary",
                      )}
                    >
                      <span>{cmd.label}</span>
                      {cmd.hint && <KeyboardShortcut keys={cmd.hint.split(" ")} />}
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
