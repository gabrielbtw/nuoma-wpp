import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, CheckCheck, Instagram, MessageCircleMore, MessageSquareText,
  Phone, Mail, User, Hash, Calendar, FileText
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorPanel } from "@/components/shared/error-panel";
import { ChannelIndicators } from "@/components/contacts/channel-indicators";
import { TagPill } from "@/components/tags/tag-pill";
import { apiFetch } from "@/lib/api";
import { contactProcedureLabelMap, contactStatusLabelMap, contactStatusTone } from "@/lib/contact-display";
import { formatPhoneForDisplay } from "@/lib/contact-utils";
import { cn } from "@/lib/utils";

type ContactChannel = {
  id: string;
  type: "whatsapp" | "instagram" | string;
  displayValue: string;
  normalizedValue: string | null;
  isPrimary: boolean;
  isActive: boolean;
};

type ContactRecord = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  instagram: string | null;
  cpf: string | null;
  notes: string | null;
  status: string;
  procedureStatus: "yes" | "no" | "unknown";
  tags: string[];
  channels: ContactChannel[];
  instagramFollowsMe: boolean | null;
  instagramFollowedByMe: boolean | null;
  instagramIncomingMessagesCount: number;
  instagramSentMoreThanThreeMessages: boolean;
  createdAt: string;
  updatedAt: string;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
};

type TagRecord = { id: string; name: string; color: string };

type TimelineMessage = {
  id: string;
  channel: "whatsapp" | "instagram";
  direction: "incoming" | "outgoing" | "system";
  contentType: string;
  body: string;
  mediaPath: string | null;
  createdAt: string;
  sentAt: string | null;
};

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function formatDateOnly(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" }).format(new Date(value));
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function ChannelIcon({ channel }: { channel: string }) {
  if (channel === "instagram") return <Instagram className="h-3 w-3 text-cmm-orange" />;
  return <MessageCircleMore className="h-3 w-3 text-cmm-emerald" />;
}

/** Group messages by date for timeline sections */
function groupByDate(messages: TimelineMessage[]): Array<{ date: string; messages: TimelineMessage[] }> {
  const groups: Record<string, TimelineMessage[]> = {};
  for (const msg of messages) {
    const date = (msg.sentAt || msg.createdAt).split("T")[0];
    if (!groups[date]) groups[date] = [];
    groups[date].push(msg);
  }
  return Object.entries(groups).map(([date, msgs]) => ({ date, messages: msgs }));
}

export function ContactDetailPage() {
  const navigate = useNavigate();
  const { id } = useParams();

  const query = useQuery({
    queryKey: ["contact", id],
    queryFn: () => apiFetch<ContactRecord>(`/contacts/${id}`),
    enabled: Boolean(id)
  });

  const tagsQuery = useQuery({
    queryKey: ["tags"],
    queryFn: () => apiFetch<TagRecord[]>("/tags")
  });

  const messagesQuery = useQuery({
    queryKey: ["contact-messages", id],
    queryFn: () => apiFetch<TimelineMessage[]>(`/inbox/contact/${id}/messages?limit=300`),
    enabled: Boolean(id)
  });

  const colorMap = useMemo(
    () => new Map((tagsQuery.data ?? []).map((item) => [item.name.trim().toLowerCase(), item.color])),
    [tagsQuery.data]
  );

  const contact = query.data;
  const messages = messagesQuery.data ?? [];
  const dateGroups = useMemo(() => groupByDate(messages), [messages]);

  function goBack() {
    if (window.history.length > 1) { void navigate(-1); return; }
    void navigate("/contacts");
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-700">
      <PageHeader
        eyebrow="CRM"
        title={contact?.name || "Contato"}
        description="Narrative Ledger - Timeline completa de mensagens do contato."
        actions={
          <Button variant="ghost" onClick={goBack}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
          </Button>
        }
      />

      {query.error && <ErrorPanel message={(query.error as Error).message} />}

      {contact && (
        <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
          {/* Left: Contact card */}
          <div className="space-y-3">
            {/* Profile card */}
            <div className="rounded-2xl border border-n-border/60 bg-n-surface p-5 space-y-4">
              <div className="flex flex-col items-center text-center gap-3">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-n-blue to-cmm-purple text-xl font-bold text-white shadow-lg shadow-n-blue/15">
                  {(contact.name || "?").charAt(0).toUpperCase()}
                </div>
                <div>
                  <h3 className="text-h2 text-n-text">{contact.name || "Sem nome"}</h3>
                  <Badge tone={contactStatusTone(contact.status)} className="mt-1">
                    {contactStatusLabelMap[contact.status] ?? contact.status}
                  </Badge>
                </div>
                <ChannelIndicators phone={contact.phone} instagram={contact.instagram} channels={contact.channels} />
              </div>

              {/* Quick info */}
              <div className="space-y-1.5 pt-3 border-t border-n-border/40">
                {contact.phone && (
                  <div className="flex items-center gap-2.5 rounded-xl bg-n-bg px-3 py-2 ring-1 ring-white/[0.04]">
                    <Phone className="h-3.5 w-3.5 text-n-wa" />
                    <span className="text-body font-medium text-n-text font-mono">{formatPhoneForDisplay(contact.phone)}</span>
                  </div>
                )}
                {contact.instagram && (
                  <div className="flex items-center gap-2.5 rounded-xl bg-n-bg px-3 py-2 ring-1 ring-white/[0.04]">
                    <Instagram className="h-3.5 w-3.5 text-n-ig" />
                    <span className="text-body font-medium text-n-text">{contact.instagram}</span>
                  </div>
                )}
                {contact.email && (
                  <div className="flex items-center gap-2.5 rounded-xl bg-n-bg px-3 py-2 ring-1 ring-white/[0.04]">
                    <Mail className="h-3.5 w-3.5 text-n-text-dim" />
                    <span className="text-body font-medium text-n-text">{contact.email}</span>
                  </div>
                )}
              </div>

              {/* Tags */}
              {contact.tags.length > 0 && (
                <div className="pt-3 border-t border-n-border/40">
                  <p className="text-micro uppercase tracking-wider text-n-text-dim mb-2">Tags</p>
                  <div className="flex flex-wrap gap-1.5">
                    {contact.tags.map((tag) => (
                      <TagPill key={tag} name={tag} color={colorMap.get(tag.trim().toLowerCase())} />
                    ))}
                  </div>
                </div>
              )}

              {/* Meta */}
              <div className="pt-3 border-t border-n-border/40 space-y-1.5">
                <div className="flex items-center gap-2 text-micro text-n-text-dim">
                  <Calendar className="h-3 w-3" /> Criado {formatDateTime(contact.createdAt)}
                </div>
                <div className="flex items-center gap-2 text-micro text-n-text-dim">
                  <FileText className="h-3 w-3" /> Procedimento: {contactProcedureLabelMap[contact.procedureStatus]}
                </div>
              </div>

              {/* Notes */}
              {contact.notes && (
                <div className="pt-3 border-t border-n-border/40">
                  <p className="text-micro uppercase tracking-wider text-n-text-dim mb-1.5">Observacoes</p>
                  <p className="text-caption text-n-text-muted leading-relaxed">{contact.notes}</p>
                </div>
              )}
            </div>

            {/* Stats */}
            <div className="rounded-2xl border border-n-border/60 bg-n-surface p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-micro uppercase tracking-wider text-n-text-dim">Total mensagens</span>
                <span className="text-h4 text-n-text">{messages.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-micro uppercase tracking-wider text-n-text-dim">Incoming</span>
                <span className="text-h4 text-n-text-muted">{messages.filter((m) => m.direction === "incoming").length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-micro uppercase tracking-wider text-n-text-dim">Outgoing</span>
                <span className="text-h4 text-n-text-muted">{messages.filter((m) => m.direction === "outgoing").length}</span>
              </div>
            </div>
          </div>

          {/* Right: Narrative Ledger (message timeline) */}
          <div className="rounded-2xl border border-n-border/60 bg-n-surface overflow-hidden flex flex-col">
            <div className="px-5 py-3.5 border-b border-n-border/40 flex items-center gap-3">
              <MessageSquareText className="h-4 w-4 text-n-blue" />
              <h3 className="text-h4 text-n-text">Narrative Ledger</h3>
              <Badge tone="default" className="ml-auto">{messages.length} mensagens</Badge>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5 custom-scrollbar space-y-5 max-h-[calc(100vh-20rem)]">
              {dateGroups.map((group) => (
                <div key={group.date}>
                  {/* Date separator */}
                  <div className="flex items-center gap-3 mb-3">
                    <div className="h-px flex-1 bg-n-border/30" />
                    <span className="text-micro uppercase tracking-wider text-n-text-dim shrink-0">
                      {formatDateOnly(group.date)}
                    </span>
                    <div className="h-px flex-1 bg-n-border/30" />
                  </div>

                  {/* Messages for this date */}
                  <div className="space-y-3">
                    {group.messages.map((msg) => (
                      <div key={msg.id} className={cn("flex flex-col gap-1", msg.direction === "outgoing" ? "items-end" : "items-start")}>
                        {/* Channel + time indicator */}
                        <div className="flex items-center gap-1.5 px-1">
                          <ChannelIcon channel={msg.channel} />
                          <span className="text-micro uppercase text-n-text-dim">
                            {msg.channel === "instagram" ? "IG" : "WA"}
                          </span>
                          <span className="text-micro text-n-text-dim">{formatTime(msg.sentAt || msg.createdAt)}</span>
                        </div>

                        {/* Bubble */}
                        <div className={cn(
                          "max-w-[75%] px-3.5 py-2.5 text-body leading-relaxed shadow-sm",
                          msg.direction === "outgoing"
                            ? "bg-n-blue text-white rounded-2xl rounded-br-md shadow-n-blue/10"
                            : msg.direction === "system"
                              ? "bg-n-surface-2/60 text-n-text-dim rounded-lg text-center mx-auto italic text-caption shadow-none"
                              : "bg-n-surface-2 text-n-text rounded-2xl rounded-bl-md ring-1 ring-n-border/40"
                        )}>
                          {msg.contentType === "image" && msg.mediaPath && (
                            <img src={`/uploads/media/${msg.mediaPath.split("/").pop()}`} alt="" className="rounded-lg max-w-full max-h-48 mb-1" loading="lazy" />
                          )}
                          {msg.contentType === "video" && msg.mediaPath && (
                            <video controls className="rounded-lg max-w-full max-h-48 mb-1" preload="metadata"><source src={`/uploads/media/${msg.mediaPath.split("/").pop()}`} /></video>
                          )}
                          {msg.contentType === "audio" && msg.mediaPath && (
                            <audio controls className="max-w-full mb-1" preload="metadata"><source src={`/uploads/media/${msg.mediaPath.split("/").pop()}`} /></audio>
                          )}
                          {msg.body}
                          {msg.direction === "outgoing" && (
                            <div className="mt-1 flex justify-end opacity-40">
                              <CheckCheck className="h-3 w-3" />
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 text-n-text-dim">
                  <MessageSquareText className="h-8 w-8 mb-3 opacity-20" />
                  <p className="text-caption font-medium">Nenhuma mensagem encontrada para este contato.</p>
                  <p className="text-micro text-n-text-dim mt-1">As mensagens aparecem apos o sync do worker.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
