import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ArrowUpRight, BookOpen, CheckCheck, Globe2, Instagram, MessageCircleMore,
  Phone, Search, SendHorizonal, Tag as TagIcon, User, Zap
} from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch, toJsonBody } from "@/lib/api";
import { cn } from "@/lib/utils";

// ----- Types -----

type UnifiedInboxEntry = {
  contactId: string;
  contactName: string;
  contactPhone: string | null;
  contactInstagram: string | null;
  contactStatus: string;
  channels: string[];
  lastMessageAt: string | null;
  lastMessagePreview: string;
  lastMessageChannel: string | null;
  totalUnread: number;
  conversationCount: number;
};

type UnifiedMessage = {
  id: string;
  conversationId: string;
  contactId: string | null;
  channel: "whatsapp" | "instagram";
  direction: "incoming" | "outgoing" | "system";
  contentType: string;
  body: string;
  createdAt: string;
  sentAt: string | null;
};

// ----- Helpers -----

function formatTime(value?: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDate(value?: string | null) {
  if (!value) return "Sem atividade";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function ChannelIcon({ channel, size = 14 }: { channel: string; size?: number }) {
  if (channel === "instagram") return <Instagram style={{ width: size, height: size }} className="text-cmm-orange" />;
  return <MessageCircleMore style={{ width: size, height: size }} className="text-cmm-emerald" />;
}

// ----- Component -----

export function InboxPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [channel, setChannel] = useState("all");
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [composer, setComposer] = useState("");
  const [sendChannel, setSendChannel] = useState<"whatsapp" | "instagram">("whatsapp");
  const deferredSearch = useDeferredValue(search);

  // Unified inbox query (grouped by contact)
  const inboxQuery = useQuery({
    queryKey: ["unified-inbox", deferredSearch, channel],
    queryFn: () =>
      apiFetch<UnifiedInboxEntry[]>(
        `/inbox/unified?channel=${encodeURIComponent(channel === "all" ? "" : channel)}&q=${encodeURIComponent(deferredSearch)}`
      ),
    refetchInterval: 10_000
  });

  const entries = inboxQuery.data ?? [];
  const selectedEntry = useMemo(
    () => entries.find((e) => e.contactId === selectedContactId) ?? entries[0] ?? null,
    [entries, selectedContactId]
  );

  // Messages for selected contact (mixed WA + IG)
  const messagesQuery = useQuery({
    queryKey: ["contact-messages", selectedEntry?.contactId],
    queryFn: () => apiFetch<UnifiedMessage[]>(`/inbox/contact/${selectedEntry!.contactId}/messages`),
    enabled: Boolean(selectedEntry?.contactId),
    refetchInterval: 8_000
  });

  // Auto-select first entry
  useEffect(() => {
    if (!entries.length) { if (selectedContactId) setSelectedContactId(null); return; }
    if (!selectedContactId || !entries.some((e) => e.contactId === selectedContactId)) {
      setSelectedContactId(entries[0].contactId);
    }
  }, [entries, selectedContactId]);

  // Auto-set send channel based on selected contact's available channels
  useEffect(() => {
    if (!selectedEntry) return;
    if (selectedEntry.channels.includes("whatsapp")) setSendChannel("whatsapp");
    else if (selectedEntry.channels.includes("instagram")) setSendChannel("instagram");
  }, [selectedEntry?.contactId]);

  const sendMutation = useMutation({
    mutationFn: ({ contactId, text, ch }: { contactId: string; text: string; ch: string }) =>
      apiFetch(`/conversations/send-to-contact`, {
        method: "POST",
        body: toJsonBody({ contactId, text, channel: ch })
      }),
    onSuccess: async () => {
      setComposer("");
      await queryClient.invalidateQueries({ queryKey: ["unified-inbox"] });
      await queryClient.invalidateQueries({ queryKey: ["contact-messages"] });
    }
  });

  const messages = messagesQuery.data ?? [];

  return (
    <div className="flex h-full flex-col gap-6 overflow-hidden animate-in fade-in duration-700">
      <PageHeader
        eyebrow="Atendimento Omnichannel"
        title="Inbox Unificada"
        description="Todas as conversas de WhatsApp e Instagram em uma timeline unica por contato."
      />

      <div className="grid flex-1 gap-6 overflow-hidden xl:grid-cols-[380px_1fr_320px]">
        {/* Contact list (left panel) */}
        <div className="flex flex-col gap-4 overflow-hidden">
          <div className="flex flex-col gap-3">
            <div className="relative group">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 group-focus-within:text-cmm-blue transition-colors" />
              <Input
                className="h-11 rounded-2xl border-white/5 bg-white/[0.02] pl-11 pr-4 font-bold text-white tracking-tight focus:border-cmm-blue/30"
                placeholder="Buscar contato..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              {[
                { value: "all", label: "Todos", icon: Globe2 },
                { value: "whatsapp", label: "WA", icon: MessageCircleMore },
                { value: "instagram", label: "IG", icon: Instagram }
              ].map((opt) => (
                <button key={opt.value} onClick={() => setChannel(opt.value)}
                  className={cn("flex-1 flex items-center justify-center gap-1.5 h-9 rounded-xl border text-[10px] font-bold uppercase tracking-widest transition-all",
                    channel === opt.value ? "border-cmm-blue/30 bg-cmm-blue/10 text-cmm-blue" : "border-white/5 bg-white/[0.02] text-slate-500 hover:bg-white/[0.04]")}>
                  <opt.icon className="h-3.5 w-3.5" />
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="glass-card flex-1 rounded-[2rem] border-white/5 bg-white/[0.01] overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
              <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Contatos</h3>
              <span className="text-[9px] font-bold text-slate-600">{entries.length}</span>
            </div>
            <div className="flex-1 overflow-y-auto space-y-1 p-3 custom-scrollbar">
              {entries.map((entry) => {
                const isSelected = selectedEntry?.contactId === entry.contactId;
                return (
                  <button key={entry.contactId} onClick={() => setSelectedContactId(entry.contactId)}
                    className={cn("group relative flex w-full items-center gap-4 rounded-2xl p-4 text-left transition-all duration-300",
                      isSelected ? "bg-cmm-blue text-white shadow-xl shadow-blue-500/20" : "hover:bg-white/[0.04] opacity-70 hover:opacity-100")}>
                    <div className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-lg font-black border transition-colors",
                      isSelected ? "bg-white/20 border-white/10" : "bg-black/40 border-white/5 text-slate-500")}>
                      {(entry.contactName || "?").charAt(0)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className={cn("truncate font-bold text-sm tracking-tight", isSelected ? "text-white" : "text-slate-200")}>
                          {entry.contactName || entry.contactPhone || entry.contactInstagram || "Contato"}
                        </p>
                        <span className={cn("text-[9px] font-bold shrink-0", isSelected ? "text-blue-200" : "text-slate-600")}>
                          {formatTime(entry.lastMessageAt)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        {/* Channel indicators */}
                        <div className="flex gap-1">
                          {entry.channels.map((ch) => (
                            <ChannelIcon key={ch} channel={ch} size={11} />
                          ))}
                        </div>
                        <p className={cn("truncate text-xs font-medium flex-1", isSelected ? "text-blue-100/70" : "text-slate-500")}>
                          {entry.lastMessagePreview || "..."}
                        </p>
                      </div>
                    </div>
                    {entry.totalUnread > 0 && !isSelected && (
                      <div className="flex h-5 min-w-5 items-center justify-center rounded-full bg-cmm-blue px-1.5 text-[9px] font-black text-white">
                        {entry.totalUnread}
                      </div>
                    )}
                  </button>
                );
              })}
              {entries.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 text-center text-slate-600">
                  <BookOpen className="h-8 w-8 mb-3 opacity-30" />
                  <p className="text-xs font-bold">Nenhuma conversa encontrada</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Chat area (center) - Mixed timeline */}
        <div className="glass-card flex flex-col rounded-[2.5rem] border-white/5 bg-white/[0.01] overflow-hidden relative">
          {/* Header */}
          <header className="px-8 py-5 border-b border-white/5 flex items-center justify-between backdrop-blur-md bg-white/[0.01]">
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-cmm-blue to-cmm-purple p-0.5">
                  <div className="h-full w-full rounded-[0.6rem] bg-slate-950 flex items-center justify-center font-bold text-white">
                    {(selectedEntry?.contactName || "?").charAt(0)}
                  </div>
                </div>
              </div>
              <div>
                <h3 className="font-display text-lg font-bold text-white tracking-tight">
                  {selectedEntry?.contactName || "Selecione um contato"}
                </h3>
                <div className="flex items-center gap-2 mt-0.5">
                  {selectedEntry?.channels.map((ch) => (
                    <span key={ch} className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-slate-500">
                      <ChannelIcon channel={ch} size={10} />
                      {ch === "whatsapp" ? "WA" : "IG"}
                    </span>
                  ))}
                  {selectedEntry && (
                    <Badge tone="default" className="text-[8px] px-2 py-0">{selectedEntry.conversationCount} threads</Badge>
                  )}
                </div>
              </div>
            </div>
          </header>

          {/* Messages timeline */}
          <div className="flex-1 overflow-y-auto px-8 py-8 space-y-4 custom-scrollbar">
            {messages.map((msg) => (
              <div key={msg.id} className={cn("flex flex-col gap-1", msg.direction === "outgoing" ? "items-end" : "items-start")}>
                {/* Channel indicator */}
                <div className="flex items-center gap-1.5 px-2">
                  <ChannelIcon channel={msg.channel} size={10} />
                  <span className="text-[8px] font-bold uppercase tracking-widest text-slate-600">
                    {msg.channel === "instagram" ? "IG" : "WA"}
                  </span>
                </div>
                {/* Message bubble */}
                <div className={cn(
                  "max-w-[75%] px-5 py-3 transition-all",
                  msg.direction === "outgoing"
                    ? "bg-gradient-to-br from-cmm-blue to-cmm-blue/80 text-white rounded-2xl rounded-br-md shadow-lg shadow-blue-500/10"
                    : msg.direction === "system"
                      ? "bg-white/[0.02] text-slate-500 rounded-xl text-center mx-auto italic text-xs"
                      : "bg-white/[0.04] text-slate-200 rounded-2xl rounded-bl-md border border-white/5"
                )}>
                  <p className="text-sm leading-relaxed">{msg.body}</p>
                  <div className={cn("mt-1.5 flex items-center gap-2 text-[8px] font-bold uppercase tracking-widest opacity-50",
                    msg.direction === "outgoing" ? "flex-row-reverse" : "")}>
                    <span>{formatTime(msg.sentAt || msg.createdAt)}</span>
                    {msg.direction === "outgoing" && <CheckCheck className="h-3 w-3" />}
                  </div>
                </div>
              </div>
            ))}
            {messages.length === 0 && selectedEntry && (
              <div className="flex flex-col items-center justify-center py-20 text-slate-600">
                <MessageCircleMore className="h-10 w-10 mb-3 opacity-20" />
                <p className="text-xs font-bold">Nenhuma mensagem encontrada</p>
              </div>
            )}
          </div>

          {/* Composer with channel selector */}
          <footer className="p-6 border-t border-white/5 bg-black/30 backdrop-blur-xl">
            <div className="flex items-end gap-3">
              {/* Channel toggle */}
              <div className="flex flex-col gap-1">
                {selectedEntry?.channels.includes("whatsapp") && (
                  <button onClick={() => setSendChannel("whatsapp")}
                    className={cn("h-8 w-8 rounded-lg flex items-center justify-center border transition-all",
                      sendChannel === "whatsapp" ? "border-cmm-emerald/40 bg-cmm-emerald/10" : "border-white/5 bg-white/[0.02] hover:bg-white/[0.04]")}>
                    <MessageCircleMore className={cn("h-3.5 w-3.5", sendChannel === "whatsapp" ? "text-cmm-emerald" : "text-slate-500")} />
                  </button>
                )}
                {selectedEntry?.channels.includes("instagram") && (
                  <button onClick={() => setSendChannel("instagram")}
                    className={cn("h-8 w-8 rounded-lg flex items-center justify-center border transition-all",
                      sendChannel === "instagram" ? "border-cmm-orange/40 bg-cmm-orange/10" : "border-white/5 bg-white/[0.02] hover:bg-white/[0.04]")}>
                    <Instagram className={cn("h-3.5 w-3.5", sendChannel === "instagram" ? "text-cmm-orange" : "text-slate-500")} />
                  </button>
                )}
              </div>
              {/* Input */}
              <div className="flex-1">
                <Textarea
                  placeholder={`Enviar via ${sendChannel === "whatsapp" ? "WhatsApp" : "Instagram"}...`}
                  className="min-h-[56px] max-h-[100px] resize-none rounded-2xl bg-white/[0.02] border-white/5 px-5 py-3 text-sm focus:border-cmm-blue/30"
                  value={composer}
                  onChange={(e) => setComposer(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && composer.trim() && selectedEntry) {
                      e.preventDefault();
                      sendMutation.mutate({ contactId: selectedEntry.contactId, text: composer.trim(), ch: sendChannel });
                    }
                  }}
                />
              </div>
              {/* Send */}
              <button
                disabled={!composer.trim() || !selectedEntry || sendMutation.isPending}
                onClick={() => selectedEntry && sendMutation.mutate({ contactId: selectedEntry.contactId, text: composer.trim(), ch: sendChannel })}
                className="h-14 w-14 rounded-2xl bg-cmm-blue text-white flex items-center justify-center shadow-xl disabled:opacity-20 transition-all active:scale-90">
                <SendHorizonal className="h-5 w-5" />
              </button>
            </div>
          </footer>
        </div>

        {/* Context sidebar (right) */}
        <div className="hidden xl:flex flex-col gap-6 overflow-y-auto custom-scrollbar pr-2">
          <div className="glass-card rounded-[2rem] border-white/5 bg-white/[0.01] p-8 space-y-6 flex flex-col items-center">
            <div className="h-20 w-20 rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 border border-white/10 flex items-center justify-center">
              <User className="h-10 w-10 text-slate-600" />
            </div>

            <div className="text-center space-y-2">
              <h4 className="font-display text-xl font-bold text-white tracking-tight">
                {selectedEntry?.contactName || "Sem contato"}
              </h4>
              <div className="flex flex-wrap justify-center gap-1.5">
                {selectedEntry?.channels.map((ch) => (
                  <Badge key={ch} tone={ch === "whatsapp" ? "success" : "warning"} className="text-[8px] px-2 py-0.5">
                    {ch === "whatsapp" ? "WhatsApp" : "Instagram"}
                  </Badge>
                ))}
              </div>
            </div>

            <div className="w-full space-y-3 pt-4 border-t border-white/5">
              {selectedEntry?.contactPhone && (
                <div className="rounded-xl bg-black/20 p-4 space-y-1">
                  <div className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-widest text-slate-600">
                    <Phone className="h-3 w-3" /> WhatsApp
                  </div>
                  <p className="text-sm font-bold text-white">{selectedEntry.contactPhone}</p>
                </div>
              )}
              {selectedEntry?.contactInstagram && (
                <div className="rounded-xl bg-black/20 p-4 space-y-1">
                  <div className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-widest text-slate-600">
                    <Instagram className="h-3 w-3" /> Instagram
                  </div>
                  <p className="text-sm font-bold text-white">{selectedEntry.contactInstagram}</p>
                </div>
              )}
              <div className="rounded-xl bg-black/20 p-4 space-y-1">
                <p className="text-[9px] font-bold uppercase tracking-widest text-slate-600">Ultima atividade</p>
                <p className="text-xs font-bold text-slate-400">{formatDate(selectedEntry?.lastMessageAt)}</p>
              </div>
              <div className="rounded-xl bg-black/20 p-4 space-y-1">
                <p className="text-[9px] font-bold uppercase tracking-widest text-slate-600">Mensagens carregadas</p>
                <p className="text-xs font-bold text-slate-400">{messages.length}</p>
              </div>
            </div>
          </div>

          {selectedEntry?.contactId && (
            <Link to={`/contacts/${selectedEntry.contactId}`}>
              <Button className="w-full h-12 rounded-2xl bg-white/[0.02] border-white/5 text-[10px] font-bold uppercase tracking-widest text-slate-500 hover:bg-cmm-blue hover:text-white transition-all group">
                Ver perfil completo
                <ArrowUpRight className="ml-2 h-3.5 w-3.5 group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
              </Button>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
