import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowUpRight, CheckCheck, Instagram, Search, SendHorizonal, User, Phone, Info, Zap } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch, toJsonBody } from "@/lib/api";
import { cn } from "@/lib/utils";

type ConversationRecord = {
  id: string;
  channel: "whatsapp" | "instagram" | string;
  contactId: string | null;
  title: string;
  unreadCount: number;
  internalStatus: "open" | "waiting" | "closed" | string;
  lastMessagePreview: string;
  lastMessageAt: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactInstagram?: string | null;
};

type MessageRecord = {
  id: string;
  direction: "incoming" | "outgoing" | "system" | string;
  contentType: "text" | "audio" | "image" | "video" | "file" | "summary" | string;
  body: string;
  createdAt: string;
  sentAt: string | null;
};

const inboxStatusOptions = [
  { value: "all", label: "Todos" },
  { value: "open", label: "Abertos" },
  { value: "waiting", label: "Aguardando" },
  { value: "closed", label: "Fechados" }
] as const;

function formatDateTime(value?: string | null) {
  if (!value) {
    return "Sem atividade recente";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

function statusLabel(status: string) {
  switch (status) {
    case "open":
      return "Aberta";
    case "waiting":
      return "Aguardando";
    case "closed":
      return "Fechada";
    default:
      return status;
  }
}

function channelLabel(channel: string) {
  return channel === "instagram" ? "Instagram" : "WhatsApp";
}

export function InboxPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [channel, setChannel] = useState("all");
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [composer, setComposer] = useState("");
  const deferredSearch = useDeferredValue(search);

  const conversationsQuery = useQuery({
    queryKey: ["conversations", deferredSearch, status, channel],
    queryFn: () =>
      apiFetch<ConversationRecord[]>(
        `/conversations?channel=${encodeURIComponent(channel === "all" ? "" : channel)}&status=${encodeURIComponent(
          status === "all" ? "" : status
        )}&q=${encodeURIComponent(deferredSearch)}`
      ),
    refetchInterval: 10_000
  });

  const conversations = conversationsQuery.data ?? [];
  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedConversationId) ?? conversations[0] ?? null,
    [conversations, selectedConversationId]
  );

  const messagesQuery = useQuery({
    queryKey: ["conversation-messages", selectedConversation?.id],
    queryFn: () => apiFetch<MessageRecord[]>(`/conversations/${selectedConversation?.id}/messages`),
    enabled: Boolean(selectedConversation?.id),
    refetchInterval: 8_000
  });

  useEffect(() => {
    if (!conversations.length) {
      if (selectedConversationId) {
        setSelectedConversationId(null);
      }
      return;
    }

    if (!selectedConversationId || !conversations.some((conversation) => conversation.id === selectedConversationId)) {
      setSelectedConversationId(conversations[0].id);
    }
  }, [conversations, selectedConversationId]);

  const statusMutation = useMutation({
    mutationFn: ({ conversationId, internalStatus }: { conversationId: string; internalStatus: "open" | "waiting" | "closed" }) =>
      apiFetch<ConversationRecord>(`/conversations/${conversationId}`, {
        method: "PATCH",
        body: toJsonBody({
          internalStatus
        })
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
    }
  });

  const sendMessageMutation = useMutation({
    mutationFn: ({ conversationId, text }: { conversationId: string; text: string }) =>
      apiFetch(`/conversations/${conversationId}/messages`, {
        method: "POST",
        body: toJsonBody({
          text
        })
      }),
    onSuccess: async () => {
      setComposer("");
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
      await queryClient.invalidateQueries({ queryKey: ["conversation-messages"] });
    }
  });

  return (
    <div className="flex h-full flex-col gap-8 overflow-hidden animate-in fade-in duration-700">
      <PageHeader
        eyebrow="Atendimento"
        title="Inbox"
        description="Acompanhe conversas por canal, altere o status interno e responda sem sair do histórico."
      />

      <div className="grid flex-1 gap-8 overflow-hidden xl:grid-cols-[400px_1fr_340px]">
        {/* conversations List */}
        <div className="flex flex-col gap-6 overflow-hidden">
          <div className="flex flex-col gap-4">
            <div className="relative group">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 group-focus-within:text-cmm-blue transition-colors" />
              <Input
                className="h-12 rounded-[1.25rem] border-white/5 bg-white/[0.02] pl-12 pr-4 font-bold text-white tracking-tight focus:border-cmm-blue/30 focus:bg-white/[0.04] shadow-inner transition-all"
                placeholder="Filtrar conversas..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <select className="flex-1 h-10 rounded-xl border border-white/5 bg-white/[0.02] px-4 text-[10px] font-black uppercase tracking-widest text-slate-500 outline-none hover:bg-white/[0.04]" value={channel} onChange={(e) => setChannel(e.target.value)}>
                <option value="all" className="bg-slate-900">Todos Canais</option>
                <option value="whatsapp" className="bg-slate-900">WhatsApp</option>
                <option value="instagram" className="bg-slate-900">Instagram</option>
              </select>
              <select className="flex-1 h-10 rounded-xl border border-white/5 bg-white/[0.02] px-4 text-[10px] font-black uppercase tracking-widest text-slate-500 outline-none hover:bg-white/[0.04]" value={status} onChange={(e) => setStatus(e.target.value)}>
                {inboxStatusOptions.map((opt) => <option key={opt.value} value={opt.value} className="bg-slate-900">{opt.label}</option>)}
              </select>
            </div>
          </div>

          <div className="glass-card flex-1 rounded-[2.5rem] border-white/5 bg-white/[0.01] overflow-hidden flex flex-col shadow-2xl">
            <div className="px-8 py-6 border-b border-white/5 flex items-center justify-between">
              <h3 className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">Conversas recentes</h3>
              <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">{conversations.length} em tela</span>
            </div>
            <div className="flex-1 overflow-y-auto space-y-1.5 p-4 custom-scrollbar">
              {conversations.map((conv) => {
                const isSelected = selectedConversation?.id === conv.id;
                return (
                  <button
                    key={conv.id}
                    onClick={() => setSelectedConversationId(conv.id)}
                    className={cn(
                      "group relative flex w-full items-center gap-5 rounded-[1.75rem] p-5 text-left transition-all duration-300",
                      isSelected ? "bg-cmm-blue text-white shadow-xl shadow-blue-500/20 scale-[1.02] z-10" : "hover:bg-white/[0.04] grayscale opacity-70 hover:grayscale-0 hover:opacity-100"
                    )}
                  >
                    <div className={cn(
                      "flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-xl font-black shadow-2xl border transition-colors",
                      isSelected ? "bg-white/20 border-white/10 text-white" : "bg-black/40 border-white/5 text-slate-500 group-hover:bg-cmm-blue/10 group-hover:text-cmm-blue"
                    )}>
                      {(conv.contactName || conv.title || "?").charAt(0)}
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center justify-between">
                        <p className={cn("truncate font-bold tracking-tight text-sm", isSelected ? "text-white" : "text-slate-200")}>
                          {conv.contactName || conv.title}
                        </p>
                        <span className={cn("text-[9px] font-black uppercase tracking-wider", isSelected ? "text-blue-200" : "text-slate-600")}>
                          {conv.lastMessageAt ? new Date(conv.lastMessageAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                        </span>
                      </div>
                      <p className={cn("truncate text-xs font-medium opacity-70", isSelected ? "text-blue-50" : "text-slate-500")}>
                        {conv.lastMessagePreview || "Inicie uma conversa..."}
                      </p>
                    </div>
                    {conv.unreadCount > 0 && !isSelected && (
                      <div className="h-2 w-2 rounded-full bg-cmm-blue shadow-[0_0_10px_rgba(0,122,255,1)]" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Chat Area */}
        <div className="glass-card flex flex-col rounded-[3rem] border-white/5 bg-white/[0.01] overflow-hidden relative shadow-2xl">
          <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-cmm-blue/[0.04] to-transparent pointer-events-none" />

          <header className="px-10 py-7 border-b border-white/5 flex items-center justify-between relative z-10 backdrop-blur-md bg-white/[0.01]">
            <div className="flex items-center gap-5">
              <div className="relative">
                <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-cmm-blue to-cmm-purple p-0.5 shadow-xl">
                  <div className="h-full w-full rounded-[0.9rem] bg-slate-950 flex items-center justify-center font-bold text-white">
                    {(selectedConversation?.contactName || selectedConversation?.title || "?").charAt(0)}
                  </div>
                </div>
                <div className="absolute -bottom-1 -right-1 h-3.5 w-3.5 rounded-full border-2 border-slate-950 bg-cmm-emerald shadow-lg" />
              </div>
              <div>
                <h3 className="font-display text-xl font-bold text-white tracking-tight leading-tight">{selectedConversation?.title || "Selecione um fio"}</h3>
                <div className="flex items-center gap-3">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">{channelLabel(selectedConversation?.channel || 'WA')}</p>
                  <div className="h-1 w-1 rounded-full bg-slate-800" />
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-cmm-emerald">{statusLabel(selectedConversation?.internalStatus || "open")}</p>
                </div>
              </div>
            </div>
            <div className="flex gap-2.5">
              {(["open", "waiting", "closed"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => statusMutation.mutate({ conversationId: selectedConversation!.id, internalStatus: s })}
                  className={cn(
                    "h-9 px-5 rounded-full text-[9px] font-black uppercase tracking-[0.15em] border transition-all duration-300 hover:scale-105 active:scale-95",
                    selectedConversation?.internalStatus === s
                      ? "bg-cmm-blue border-transparent text-white shadow-lg shadow-blue-500/20"
                      : "bg-white/[0.04] border-white/5 text-slate-500 hover:bg-white/[0.08] hover:text-slate-300"
                  )}
                >
                  {statusLabel(s)}
                </button>
              ))}
            </div>
          </header>

          <div className="flex-1 overflow-y-auto px-10 py-12 space-y-8 relative z-10 custom-scrollbar scroll-smooth">
            {messagesQuery.data?.map((msg) => (
              <div key={msg.id} className={cn("flex flex-col gap-2", msg.direction === "outgoing" ? "items-end" : "items-start")}>
                <div className={cn(
                  "group relative max-w-[75%] px-6 py-4 transition-all duration-500 hover:scale-[1.01]",
                  msg.direction === "outgoing"
                    ? "bg-gradient-to-br from-cmm-blue to-cmm-blue/80 text-white rounded-[2rem] rounded-br-lg shadow-[0_10px_40px_-10px_rgba(59,130,246,0.3)]"
                    : "bg-white/[0.04] text-slate-200 rounded-[2rem] rounded-bl-lg border border-white/5 backdrop-blur-xl shadow-xl"
                )}>
                  <p className="text-sm font-medium leading-relaxed tracking-tight">{msg.body}</p>
                  <div className={cn("mt-2 flex items-center gap-2 opacity-40 text-[8px] font-black uppercase tracking-widest", msg.direction === "outgoing" ? "flex-row-reverse" : "")}>
                    <span>{new Date(msg.sentAt || msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    {msg.direction === "outgoing" && <CheckCheck className="h-3 w-3" />}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <footer className="p-8 relative z-10 bg-black/40 backdrop-blur-3xl border-t border-white/5">
            <div className="relative group flex items-end gap-4">
              <div className="flex-1 relative">
                <Textarea
                  placeholder="Compor mensagem estratégica..."
                  className="min-h-[64px] max-h-[120px] resize-none rounded-[1.75rem] bg-white/[0.02] border-white/5 px-8 py-5 text-sm font-medium tracking-tight focus:bg-white/[0.04] focus:border-cmm-blue/30 focus:ring-0 transition-all custom-scrollbar"
                  value={composer}
                  onChange={(e) => setComposer(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if (composer.trim()) sendMessageMutation.mutate({ conversationId: selectedConversation!.id, text: composer.trim() });
                    }
                  }}
                />
              </div>
              <button
                disabled={!composer.trim() || sendMessageMutation.isPending}
                onClick={() => sendMessageMutation.mutate({ conversationId: selectedConversation!.id, text: composer.trim() })}
                className="h-16 w-16 rounded-[1.5rem] bg-cmm-blue text-white flex items-center justify-center shadow-2xl shadow-blue-500/20 active:scale-90 disabled:opacity-20 disabled:scale-100 transition-all group-hover:shadow-blue-500/40"
              >
                <SendHorizonal className="h-6 w-6" />
              </button>
            </div>
          </footer>
        </div>

        {/* Context Sidebar */}
        <div className="hidden xl:flex flex-col gap-8 overflow-y-auto custom-scrollbar pr-2">
          <div className="glass-card rounded-[2.5rem] border-white/5 bg-white/[0.01] p-10 space-y-8 flex flex-col items-center">
            <div className="relative group">
              <div className="h-28 w-28 rounded-[2.5rem] bg-gradient-to-br from-slate-800 to-slate-900 border border-white/10 p-1.5 shadow-2xl transition-transform duration-500 group-hover:rotate-6">
                <div className="h-full w-full rounded-[2rem] bg-black/40 flex items-center justify-center">
                  <User className="h-12 w-12 text-slate-600 group-hover:text-cmm-blue transition-colors" />
                </div>
              </div>
              <div className="absolute -bottom-2 -right-2 h-8 w-8 rounded-2xl bg-cmm-blue flex items-center justify-center text-white shadow-xl border-2 border-slate-950">
                <Zap className="h-4 w-4" />
              </div>
            </div>

            <div className="text-center space-y-2">
              <h4 className="font-display text-2xl font-bold text-white tracking-tight">{selectedConversation?.contactName || selectedConversation?.title}</h4>
              <div className="flex flex-wrap justify-center gap-2">
                <Badge className="rounded-full border-none bg-cmm-blue/10 text-cmm-blue text-[8px] font-black uppercase tracking-widest px-3 py-1">
                  {selectedConversation?.contactId ? "Contato vinculado" : "Sem vínculo no CRM"}
                </Badge>
                <Badge className="rounded-full border-none bg-white/10 text-slate-300 text-[8px] font-black uppercase tracking-widest px-3 py-1">
                  {channelLabel(selectedConversation?.channel || "whatsapp")}
                </Badge>
              </div>
            </div>

            <div className="w-full space-y-4 pt-4 border-t border-white/5">
              <div className="group glass-card rounded-2xl border-white/5 bg-black/20 p-5 space-y-2 hover:bg-black/40 transition-colors">
                <div className="flex items-center gap-3 text-slate-600">
                  <Phone className="h-3 w-3" />
                  <span className="text-[9px] font-black uppercase tracking-[0.2em]">WhatsApp vinculado</span>
                </div>
                <p className="text-sm font-bold text-white tracking-tight">{selectedConversation?.contactPhone || "Não informado"}</p>
              </div>
              <div className="group glass-card rounded-2xl border-white/5 bg-black/20 p-5 space-y-2 hover:bg-black/40 transition-colors">
                <div className="flex items-center gap-3 text-slate-600">
                  <Instagram className="h-3 w-3" />
                  <span className="text-[9px] font-black uppercase tracking-[0.2em]">Instagram vinculado</span>
                </div>
                <p className="text-sm font-bold text-white tracking-tight">{selectedConversation?.contactInstagram || "Não vinculado"}</p>
              </div>
            </div>
          </div>

          <div className="glass-card flex-1 rounded-[2.5rem] border-white/5 bg-white/[0.01] p-10 space-y-8 flex flex-col shadow-2xl">
            <div className="flex items-center gap-3">
              <Info className="h-4 w-4 text-cmm-blue" />
              <h4 className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-500">Resumo da conversa</h4>
            </div>

            <div className="flex-1 space-y-6">
              {[
                { label: "Status interno", value: statusLabel(selectedConversation?.internalStatus || ""), color: "text-cmm-blue", dot: "bg-cmm-blue" },
                { label: "Última Interação", value: formatDateTime(selectedConversation?.lastMessageAt), color: "text-slate-400", dot: "bg-slate-700" },
                { label: "Mensagens carregadas", value: `${messagesQuery.data?.length || 0} mensagem(ns)`, color: "text-slate-400", dot: "bg-slate-700" }
              ].map((item) => (
                <div key={item.label} className="space-y-2">
                  <p className="text-[9px] font-black text-slate-600 uppercase tracking-widest">{item.label}</p>
                  <div className="flex items-center gap-3">
                    <div className={cn("h-1.5 w-1.5 rounded-full", item.dot)} />
                    <p className={cn("text-xs font-bold tracking-tight", item.color)}>{item.value}</p>
                  </div>
                </div>
              ))}
            </div>

            <Link to={selectedConversation?.contactId ? `/contacts/${selectedConversation.contactId}` : '#'} className="block">
              <Button className="w-full h-14 rounded-2xl bg-white/[0.02] border-white/5 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 hover:bg-cmm-blue hover:text-white hover:border-transparent transition-all duration-500 group">
                Perfil Operacional
                <ArrowUpRight className="ml-2 h-3.5 w-3.5 group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
