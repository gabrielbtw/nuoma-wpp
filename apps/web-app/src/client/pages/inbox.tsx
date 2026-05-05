import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ArrowUpRight, BookOpen, CheckCheck, ChevronLeft, ChevronRight, Clock, FileText, Globe2, Instagram,
  Image as ImageIcon, Mail, MessageCircleMore, Mic2, Paperclip, Pencil, Phone, Save, Search, SendHorizonal,
  Tag as TagIcon, Trash2, User, UserCircle, X, Zap
} from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch, toJsonBody } from "@/lib/api";
import { cn } from "@/lib/utils";

// ----- Types -----

const INBOX_PAGE_SIZE = 20;

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

type UnifiedInboxResponse = {
  items: UnifiedInboxEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

type UnifiedMessage = {
  id: string;
  conversationId: string;
  contactId: string | null;
  channel: "whatsapp" | "instagram";
  direction: "incoming" | "outgoing" | "system";
  contentType: string;
  body: string;
  mediaPath: string | null;
  createdAt: string;
  sentAt: string | null;
  status?: string;
};

type AttachmentCandidate = {
  id: string;
  contentType: "audio" | "image" | "video" | "file";
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  storagePath: string;
  caption: string | null;
  observedAt: string;
};

type AttachmentCandidatesResponse = {
  total: number;
  items: AttachmentCandidate[];
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
  if (channel === "instagram") return <Instagram style={{ width: size, height: size }} className="text-n-ig" />;
  return <MessageCircleMore style={{ width: size, height: size }} className="text-n-wa" />;
}

function AttachmentCandidateIcon({ type }: { type: AttachmentCandidate["contentType"] }) {
  if (type === "image") return <ImageIcon className="h-3 w-3 text-n-blue" />;
  if (type === "video") return <ArrowUpRight className="h-3 w-3 text-cmm-purple" />;
  if (type === "audio") return <Mic2 className="h-3 w-3 text-n-wa" />;
  return <FileText className="h-3 w-3 text-n-text-dim" />;
}

function formatAttachmentType(type: AttachmentCandidate["contentType"]) {
  if (type === "image") return "Imagem";
  if (type === "video") return "Video";
  if (type === "audio") return "Audio";
  return "Documento";
}

// ----- Contact Sidebar -----

type ContactDetail = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  instagram: string | null;
  cpf: string | null;
  status: string;
  procedureStatus: string;
  tags: string[];
  notes: string | null;
};

type TagRecord = { id: string; name: string; color: string };

function ContactSidebar({ contactId, channels, lastMessageAt, messageCount, inSheet = false }: {
  contactId: string | null;
  channels: string[];
  lastMessageAt: string | null;
  messageCount: number;
  inSheet?: boolean;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<ContactDetail>>({});
  const [tagInput, setTagInput] = useState("");

  const contactQuery = useQuery({
    queryKey: ["contact-sidebar", contactId],
    queryFn: () => apiFetch<ContactDetail>(`/contacts/${contactId}`),
    enabled: Boolean(contactId)
  });

  const tagsQuery = useQuery({
    queryKey: ["tags"],
    queryFn: () => apiFetch<TagRecord[]>("/tags")
  });

  const attachmentCandidatesQuery = useQuery({
    queryKey: ["attachment-candidates", contactId],
    queryFn: () => apiFetch<AttachmentCandidatesResponse>(`/contacts/${contactId}/attachment-candidates?limit=3`),
    enabled: Boolean(contactId),
    refetchInterval: 15_000
  });

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiFetch(`/contacts/${contactId}`, { method: "PATCH", body: toJsonBody(data) }),
    onSuccess: async () => {
      setEditing(false);
      setDraft({});
      await queryClient.invalidateQueries({ queryKey: ["contact-sidebar"] });
      await queryClient.invalidateQueries({ queryKey: ["unified-inbox"] });
      await queryClient.invalidateQueries({ queryKey: ["contacts"] });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiFetch(`/contacts/${contactId}`, { method: "DELETE" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["unified-inbox"] });
      await queryClient.invalidateQueries({ queryKey: ["contacts"] });
    }
  });

  const contact = contactQuery.data;
  const attachmentCandidates = attachmentCandidatesQuery.data?.items ?? [];
  const attachmentTotal = attachmentCandidatesQuery.data?.total ?? 0;

  function startEdit() {
    if (!contact) return;
    setDraft({ name: contact.name, phone: contact.phone, email: contact.email, instagram: contact.instagram, cpf: contact.cpf, notes: contact.notes, tags: contact.tags });
    setEditing(true);
  }

  function saveEdit() {
    if (!draft) return;
    updateMutation.mutate(draft);
  }

  function addTag(tag: string) {
    const trimmed = tag.trim();
    if (!trimmed || draft.tags?.includes(trimmed)) return;
    setDraft({ ...draft, tags: [...(draft.tags ?? contact?.tags ?? []), trimmed] });
    setTagInput("");
  }

  function removeTag(tag: string) {
    setDraft({ ...draft, tags: (draft.tags ?? contact?.tags ?? []).filter((t) => t !== tag) });
  }

  // Reset editing state when contact changes, then populate draft with new contact data
  useEffect(() => {
    setTagInput("");
    if (contact) {
      setDraft({ name: contact.name, phone: contact.phone, email: contact.email, instagram: contact.instagram, cpf: contact.cpf, notes: contact.notes, tags: contact.tags });
      setEditing(true);
    } else {
      setEditing(false);
      setDraft({});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact?.id]);

  if (!contactId) {
    return (
      <div className={cn(inSheet ? "flex" : "hidden xl:flex", "flex-col items-center justify-center rounded-2xl border border-n-border/60 bg-n-surface p-6 text-n-text-dim")}>
        <User className="h-8 w-8 mb-2 opacity-30" />
        <p className="text-caption">Selecione um contato</p>
      </div>
    );
  }

  return (
    <div className={cn(inSheet ? "flex" : "hidden xl:flex", "flex-col gap-3 overflow-y-auto custom-scrollbar pr-1")}>
      {/* Profile card — Contact Detail style */}
      <div className="rounded-2xl border border-n-border/60 bg-n-surface p-4 space-y-4">
        {/* Avatar + Name (centered, like Contact Detail) */}
        <div className="flex flex-col items-center text-center gap-2">
          <div className={cn(
            "flex h-14 w-14 items-center justify-center rounded-2xl text-lg font-bold text-white shadow-lg",
            contact?.instagram ? "bg-gradient-to-br from-n-blue to-cmm-purple shadow-cmm-purple/15" : "bg-gradient-to-br from-n-blue to-blue-600 shadow-n-blue/15"
          )}>
            {(editing ? draft.name : contact?.name || "?")?.charAt(0).toUpperCase() || "?"}
          </div>

          {editing ? (
            <Input className="h-8 text-center text-h4 bg-n-bg border-n-border rounded-lg" value={draft.name ?? ""} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Nome do contato" />
          ) : (
            <h3 className="text-h4 text-n-text">{contact?.name || "..."}</h3>
          )}

          <Badge tone={contact?.status === "novo" ? "info" : contact?.status === "ativo" ? "success" : "default"} className="text-micro capitalize">
            {contact?.status ?? "novo"}
          </Badge>

          {/* Channel icons */}
          <div className="flex items-center gap-2">
            {channels.map((ch) => (
              <div key={ch} className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full ring-1",
                ch === "whatsapp" ? "bg-n-wa/8 text-n-wa ring-n-wa/20" : "bg-n-ig/8 text-n-ig ring-n-ig/20"
              )}>
                {ch === "whatsapp"
                  ? <MessageCircleMore className="h-3.5 w-3.5" />
                  : <Instagram className="h-3.5 w-3.5" />
                }
              </div>
            ))}
          </div>
        </div>

        {/* Editable fields — always visible */}
        <div className="space-y-2 pt-3 border-t border-n-border/40">
          <div className="space-y-1">
            <p className="text-micro uppercase tracking-wider text-n-text-dim">Telefone</p>
            {editing ? (
              <Input className="h-8 text-caption bg-n-bg border-n-border font-mono" value={draft.phone ?? ""} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} placeholder="5511999998888" />
            ) : (
              <div className="flex items-center gap-2 rounded-lg bg-n-bg px-2.5 py-1.5 ring-1 ring-white/[0.04]">
                <Phone className="h-3 w-3 text-n-wa shrink-0" />
                <span className="text-caption text-n-text font-mono">{contact?.phone || "—"}</span>
              </div>
            )}
          </div>

          <div className="space-y-1">
            <p className="text-micro uppercase tracking-wider text-n-text-dim">Email</p>
            {editing ? (
              <Input className="h-8 text-caption bg-n-bg border-n-border" value={draft.email ?? ""} onChange={(e) => setDraft({ ...draft, email: e.target.value })} placeholder="email@exemplo.com" />
            ) : (
              <div className="flex items-center gap-2 rounded-lg bg-n-bg px-2.5 py-1.5 ring-1 ring-white/[0.04]">
                <Mail className="h-3 w-3 text-n-text-dim shrink-0" />
                <span className="text-caption text-n-text">{contact?.email || "—"}</span>
              </div>
            )}
          </div>

          <div className="space-y-1">
            <p className="text-micro uppercase tracking-wider text-n-text-dim">Instagram</p>
            {editing ? (
              <Input className="h-8 text-caption bg-n-bg border-n-border" value={draft.instagram ?? ""} onChange={(e) => setDraft({ ...draft, instagram: e.target.value })} placeholder="@usuario" />
            ) : (
              <div className="flex items-center gap-2 rounded-lg bg-n-bg px-2.5 py-1.5 ring-1 ring-white/[0.04]">
                <Instagram className="h-3 w-3 text-n-ig shrink-0" />
                <span className="text-caption text-n-text">{contact?.instagram || "—"}</span>
              </div>
            )}
          </div>

          <div className="space-y-1">
            <p className="text-micro uppercase tracking-wider text-n-text-dim">CPF</p>
            {editing ? (
              <Input className="h-8 text-caption bg-n-bg border-n-border font-mono" value={draft.cpf ?? ""} onChange={(e) => setDraft({ ...draft, cpf: e.target.value })} placeholder="000.000.000-00" />
            ) : (
              <div className="flex items-center gap-2 rounded-lg bg-n-bg px-2.5 py-1.5 ring-1 ring-white/[0.04]">
                <span className="text-micro text-n-text-dim shrink-0">CPF</span>
                <span className="text-caption text-n-text font-mono">{contact?.cpf || "—"}</span>
              </div>
            )}
          </div>

          <div className="space-y-1">
            <p className="text-micro uppercase tracking-wider text-n-text-dim">Observacoes</p>
            {editing ? (
              <Textarea className="min-h-[48px] text-caption bg-n-bg border-n-border" value={draft.notes ?? ""} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="Notas internas..." />
            ) : (
              <p className="text-caption text-n-text-muted px-1">{contact?.notes || "—"}</p>
            )}
          </div>
        </div>

        {/* Tags */}
        <div className="pt-2 border-t border-n-border/40 space-y-1.5">
          <p className="text-micro uppercase tracking-wider text-n-text-dim">Tags</p>
          <div className="flex flex-wrap gap-1">
            {(editing ? draft.tags : contact?.tags)?.map((tag) => (
              <span key={tag} className="flex items-center gap-1 rounded-full bg-n-surface-2 px-2 py-0.5 text-micro text-n-text-muted ring-1 ring-white/[0.04]">
                {tag}
                {editing && (
                  <button onClick={() => removeTag(tag)} className="text-n-red hover:text-red-300 ml-0.5">
                    <X className="h-2.5 w-2.5" />
                  </button>
                )}
              </span>
            ))}
            {(editing ? draft.tags : contact?.tags)?.length === 0 && <span className="text-micro text-n-text-dim italic">Sem tags</span>}
          </div>
          {editing && (
            <div className="flex gap-1">
              <Input className="h-7 flex-1 text-micro bg-n-bg border-n-border rounded-lg" value={tagInput} onChange={(e) => setTagInput(e.target.value)} placeholder="Nova tag..."
                list="tag-suggestions"
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(tagInput); } }} />
              <datalist id="tag-suggestions">
                {(tagsQuery.data ?? []).map((t) => <option key={t.id} value={t.name} />)}
              </datalist>
              <button onClick={() => addTag(tagInput)} className="h-7 px-2 rounded-lg bg-n-surface-2 text-micro text-n-text-dim hover:text-n-text transition-fast ring-1 ring-white/[0.04]">+</button>
            </div>
          )}
        </div>

        {/* Visible attachment candidates */}
        <div className="pt-2 border-t border-n-border/40 space-y-2">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-micro uppercase tracking-wider text-n-text-dim">
              <Paperclip className="h-3 w-3" />
              Anexos capturados
            </span>
            <span className="rounded-full bg-n-blue/10 px-2 py-0.5 text-micro text-n-blue ring-1 ring-n-blue/15">
              {attachmentTotal}
            </span>
          </div>
          {attachmentCandidates.length > 0 ? (
            <div className="space-y-1">
              {attachmentCandidates.map((item) => (
                <div key={item.id} className="flex items-center gap-2 rounded-lg bg-n-bg px-2.5 py-1.5 ring-1 ring-white/[0.04]">
                  <AttachmentCandidateIcon type={item.contentType} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-caption text-n-text">{formatAttachmentType(item.contentType)}</p>
                    <p className="truncate font-mono text-micro text-n-text-dim">{item.sha256.slice(0, 12)}</p>
                  </div>
                  <span className="shrink-0 text-micro text-n-text-dim">{formatTime(item.observedAt)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-lg bg-n-bg px-2.5 py-2 text-caption text-n-text-dim ring-1 ring-white/[0.04]">
              Nenhum candidato capturado ainda
            </p>
          )}
        </div>

        {/* Meta info */}
        <div className="pt-2 border-t border-n-border/40 space-y-1">
          <div className="flex items-center justify-between text-micro text-n-text-dim">
            <span>Atividade</span>
            <span>{formatDate(lastMessageAt)}</span>
          </div>
          <div className="flex items-center justify-between text-micro text-n-text-dim">
            <span>Mensagens</span>
            <span>{messageCount}</span>
          </div>
          <div className="flex items-center justify-between text-micro text-n-text-dim">
            <span>Status</span>
            <span className="capitalize">{contact?.status ?? "?"}</span>
          </div>
        </div>

        {/* Save / Cancel / Actions */}
        <div className="pt-2 border-t border-n-border/40 space-y-2">
          {editing && (
            <div className="flex gap-1.5">
              <Button
                onClick={saveEdit}
                disabled={updateMutation.isPending}
                className="flex-1 h-8 rounded-lg bg-n-blue text-white text-micro hover:bg-n-blue/90 transition-fast"
              >
                <Save className="mr-1.5 h-3.5 w-3.5" />
                {updateMutation.isPending ? "Salvando..." : "Salvar"}
              </Button>
              <button onClick={() => { setEditing(false); setDraft({}); }} className="h-8 w-8 rounded-lg bg-n-surface-2 text-n-text-dim flex items-center justify-center hover:bg-n-surface-2 ring-1 ring-white/[0.04] transition-fast">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <div className="flex gap-1.5">
            <Link to={`/contacts/${contactId}`} className="flex-1">
              <Button variant="outline" className="w-full h-8 rounded-lg text-micro">
                Perfil completo
              </Button>
            </Link>
            <button
              onClick={() => { if (confirm("Excluir este contato?")) deleteMutation.mutate(); }}
              className="h-8 w-8 rounded-lg bg-n-surface-2 text-n-text-dim flex items-center justify-center ring-1 ring-white/[0.04] hover:bg-n-red/10 hover:text-n-red transition-fast">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ----- Component -----

export function InboxPage() {
  const queryClient = useQueryClient();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const [channel, setChannel] = useState("all");
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [composer, setComposer] = useState("");
  const [sendChannel, setSendChannel] = useState<"whatsapp" | "instagram">("whatsapp");
  const [attachment, setAttachment] = useState<{ file: File; path: string; type: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [zapOpen, setZapOpen] = useState(false);
  const [contactSheetOpen, setContactSheetOpen] = useState(false);
  const [page, setPage] = useState(1);
  const deferredSearch = useDeferredValue(search);

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [search, channel]);

  // Unified inbox query (grouped by contact)
  const inboxQuery = useQuery({
    queryKey: ["unified-inbox", deferredSearch, channel, page],
    queryFn: () =>
      apiFetch<UnifiedInboxResponse>(
        `/inbox/unified?channel=${encodeURIComponent(channel === "all" ? "" : channel)}&q=${encodeURIComponent(deferredSearch)}&page=${page}&pageSize=${INBOX_PAGE_SIZE}`
      ),
    refetchInterval: 10_000
  });

  const entries = inboxQuery.data?.items ?? [];
  const inboxTotal = inboxQuery.data?.total ?? 0;
  const inboxTotalPages = inboxQuery.data?.totalPages ?? 1;
  const inboxCurrentPage = inboxQuery.data?.page ?? page;
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
    mutationFn: ({ contactId, text, ch, mediaPath, contentType }: { contactId: string; text: string; ch: string; mediaPath?: string; contentType?: string }) =>
      apiFetch(`/conversations/send-to-contact`, {
        method: "POST",
        body: toJsonBody({ contactId, text, channel: ch, mediaPath, contentType })
      }),
    onMutate: async ({ contactId, text, ch, mediaPath, contentType }) => {
      await queryClient.cancelQueries({ queryKey: ["contact-messages", selectedEntry?.contactId] });
      const previousMessages = queryClient.getQueryData(["contact-messages", selectedEntry?.contactId]);
      queryClient.setQueryData(["contact-messages", selectedEntry?.contactId], (old: UnifiedMessage[] | undefined) => [
        ...(old ?? []),
        {
          id: `optimistic-${Date.now()}`,
          conversationId: "",
          contactId: contactId ?? null,
          channel: ch as "whatsapp" | "instagram",
          direction: "outgoing" as const,
          contentType: contentType ?? "text",
          body: text,
          mediaPath: mediaPath ?? null,
          createdAt: new Date().toISOString(),
          sentAt: null,
          status: "pending"
        }
      ]);
      return { previousMessages };
    },
    onError: (_err, _vars, context) => {
      if (context?.previousMessages) {
        queryClient.setQueryData(["contact-messages", selectedEntry?.contactId], context.previousMessages);
      }
    },
    onSuccess: async () => {
      setComposer("");
      setAttachment(null);
      await queryClient.invalidateQueries({ queryKey: ["unified-inbox"] });
      await queryClient.invalidateQueries({ queryKey: ["contact-messages"] });
    }
  });

  // Automations quick-reply
  const automationsQuery = useQuery({
    queryKey: ["automations-quick"],
    queryFn: () => apiFetch<Array<{ id: string; name: string; enabled: boolean; category: string }>>("/automations"),
    staleTime: 30_000
  });
  const enabledAutomations = useMemo(() => (automationsQuery.data ?? []).filter(a => a.enabled), [automationsQuery.data]);

  const triggerAutomationMutation = useMutation({
    mutationFn: (automationId: string) =>
      apiFetch(`/automations/${automationId}/trigger`, {
        method: "POST",
        body: toJsonBody({ contactId: selectedEntry?.contactId, conversationId: null })
      }),
    onSuccess: () => {
      setZapOpen(false);
    }
  });

  async function handleAttachment(file: File) {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("scope", "temp");
      const media = await apiFetch<Record<string, unknown>>("/uploads/media", { method: "POST", body: formData });
      const path = String(media.storage_path ?? media.storagePath ?? "");
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      const type = ["jpg","jpeg","png","gif","webp"].includes(ext) ? "image"
        : ["mp4","mov","avi","webm"].includes(ext) ? "video"
        : ["mp3","ogg","wav","m4a"].includes(ext) ? "audio" : "file";
      setAttachment({ file, path, type });
    } catch { /* ignore */ }
    setUploading(false);
  }

  function doSend() {
    if (!selectedEntry || (!composer.trim() && !attachment)) return;
    sendMutation.mutate({
      contactId: selectedEntry.contactId,
      text: composer.trim() || (attachment ? `[${attachment.type}]` : ""),
      ch: sendChannel,
      mediaPath: attachment?.path,
      contentType: attachment?.type ?? "text"
    });
  }

  const messages = messagesQuery.data ?? [];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  return (
    <div className="flex h-full flex-col overflow-hidden animate-fade-in" style={{ height: "calc(100vh - 3.5rem)" }}>
      <div className="grid flex-1 gap-0 overflow-hidden xl:grid-cols-[280px_1fr_260px]">
        {/* Contact list (left panel) */}
        <div className="flex flex-col overflow-hidden border-r border-n-border/40">
          {/* Search + filter row - single line */}
          <div className="flex items-center gap-1.5 border-b border-n-border/40 px-2.5 py-2">
            <div className="relative flex-1 group">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-n-text-dim group-focus-within:text-n-blue transition-fast" />
              <Input
                className="h-7 rounded-md border-n-border bg-n-surface pl-7 pr-2 text-caption text-n-text focus:border-n-blue/40 transition-fast"
                placeholder="Buscar..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-1.5">
              {[
                { value: "all", label: "Todos", icon: Globe2 },
                { value: "whatsapp", label: "WA", icon: MessageCircleMore },
                { value: "instagram", label: "IG", icon: Instagram }
              ].map((opt) => (
                <button key={opt.value} onClick={() => setChannel(opt.value)}
                  className={cn("h-7 w-7 rounded-md flex items-center justify-center transition-fast",
                    channel === opt.value ? "bg-n-blue/10 text-n-blue" : "text-n-text-dim hover:bg-n-surface-2")}>
                  <opt.icon className="h-3.5 w-3.5" />
                </button>
              ))}
            </div>
          </div>

          {/* Contact list */}
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            <div className="px-1 py-0.5">
              {entries.map((entry) => {
                const isSelected = selectedEntry?.contactId === entry.contactId;
                return (
                  <button key={entry.contactId} onClick={() => setSelectedContactId(entry.contactId)}
                    className={cn("group relative flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-all duration-200",
                      isSelected ? "bg-n-blue/10 text-n-text ring-1 ring-n-blue/15" : "hover:bg-n-surface-2/60")}>
                    <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-caption font-semibold transition-all duration-200",
                      isSelected ? "bg-n-blue text-white shadow-sm shadow-n-blue/20" : "bg-n-surface-2 text-n-text-dim ring-1 ring-white/[0.04]")}>
                      {(entry.contactName || "?").charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className={cn("truncate text-h4", isSelected ? "text-white" : "text-n-text")}>
                          {entry.contactName || entry.contactPhone || entry.contactInstagram || "Contato"}
                        </p>
                        <span className={cn("text-micro shrink-0", isSelected ? "text-blue-200" : "text-n-text-dim")}>
                          {formatTime(entry.lastMessageAt)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {/* Channel indicators */}
                        <div className="flex gap-1">
                          {entry.channels.map((ch) => (
                            <ChannelIcon key={ch} channel={ch} size={11} />
                          ))}
                        </div>
                        <p className={cn("truncate text-caption flex-1", isSelected ? "text-blue-100/70" : "text-n-text-muted")}>
                          {entry.lastMessagePreview || "..."}
                        </p>
                      </div>
                    </div>
                    {entry.totalUnread > 0 && !isSelected && (
                      <div className="flex h-5 min-w-5 items-center justify-center rounded-full bg-n-blue px-1.5 text-micro font-bold text-white">
                        {entry.totalUnread}
                      </div>
                    )}
                  </button>
                );
              })}
              {entries.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-center text-n-text-dim">
                  <BookOpen className="h-7 w-7 mb-2 opacity-30" />
                  <p className="text-caption">Nenhuma conversa encontrada</p>
                </div>
              )}
            </div>

            {/* Pagination */}
            {inboxTotalPages > 1 && (
              <div className="flex items-center justify-between px-3 py-2 border-t border-n-border bg-n-surface">
                <button
                  disabled={inboxCurrentPage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="h-7 w-7 rounded-lg border border-n-border bg-n-bg flex items-center justify-center text-n-text-dim hover:bg-n-surface-2 hover:text-n-text disabled:opacity-30 disabled:cursor-not-allowed transition-fast"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <span className="text-micro text-n-text-dim">
                  {inboxCurrentPage} / {inboxTotalPages}
                </span>
                <button
                  disabled={inboxCurrentPage >= inboxTotalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="h-7 w-7 rounded-lg border border-n-border bg-n-bg flex items-center justify-center text-n-text-dim hover:bg-n-surface-2 hover:text-n-text disabled:opacity-30 disabled:cursor-not-allowed transition-fast"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Chat area (center) - Mixed timeline */}
        <div className="flex flex-col bg-n-bg overflow-hidden relative">
          {/* Header */}
          <header className="px-5 py-3 border-b border-n-border/40 flex items-center justify-between bg-n-surface">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-n-surface-2 text-h4 text-n-text ring-1 ring-white/[0.04]">
                {(selectedEntry?.contactName || "?").charAt(0).toUpperCase()}
              </div>
              <div>
                <h3 className="text-h4 text-n-text">
                  {selectedEntry?.contactName || "Selecione um contato"}
                </h3>
                <div className="flex items-center gap-2 mt-0.5">
                  {selectedEntry?.channels.map((ch) => (
                    <span key={ch} className="flex items-center gap-1 text-micro uppercase text-n-text-dim">
                      <ChannelIcon channel={ch} size={10} />
                      {ch === "whatsapp" ? "WA" : "IG"}
                    </span>
                  ))}
                  {selectedEntry && (
                    <Badge tone="default" className="text-micro px-1.5 py-0">{selectedEntry.conversationCount} threads</Badge>
                  )}
                </div>
              </div>
            </div>
            {/* Contact panel button — only visible below xl where sidebar is hidden */}
            {selectedEntry && (
              <button
                onClick={() => setContactSheetOpen(true)}
                className="xl:hidden flex h-8 w-8 items-center justify-center rounded-lg border border-n-border bg-n-surface-2 text-n-text-dim hover:text-n-text hover:bg-n-surface transition-fast"
              >
                <UserCircle className="h-4 w-4" />
              </button>
            )}
          </header>

          {/* Messages timeline */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 custom-scrollbar">
            {messages.map((msg) => (
              <div key={msg.id} className={cn("flex flex-col gap-0.5", msg.direction === "outgoing" ? "items-end" : "items-start")}>
                {/* Channel indicator */}
                <div className="flex items-center gap-1 px-1">
                  <ChannelIcon channel={msg.channel} size={10} />
                  <span className="text-micro uppercase text-n-text-dim">
                    {msg.channel === "instagram" ? "IG" : "WA"}
                  </span>
                </div>
                {/* Message bubble */}
                <div className={cn(
                  "max-w-[70%] px-3.5 py-2.5 transition-fast shadow-sm",
                  msg.direction === "outgoing"
                    ? "bg-n-blue text-white rounded-2xl rounded-br-md shadow-n-blue/10"
                    : msg.direction === "system"
                      ? "bg-n-surface-2/60 text-n-text-dim rounded-lg text-center mx-auto italic text-caption shadow-none"
                      : "bg-n-surface text-n-text rounded-2xl rounded-bl-md ring-1 ring-n-border/40"
                )}>
                  {/* Media rendering */}
                  {msg.contentType === "image" && msg.mediaPath && (
                    <img src={`/uploads/media/${msg.mediaPath.split("/").pop()}`} alt="imagem" className="rounded-lg max-w-full max-h-60 mb-1.5" loading="lazy" />
                  )}
                  {msg.contentType === "video" && msg.mediaPath && (
                    <video controls className="rounded-lg max-w-full max-h-60 mb-1.5" preload="metadata">
                      <source src={`/uploads/media/${msg.mediaPath.split("/").pop()}`} />
                    </video>
                  )}
                  {msg.contentType === "audio" && msg.mediaPath && (
                    <audio controls className="max-w-full mb-1.5" preload="metadata">
                      <source src={`/uploads/media/${msg.mediaPath.split("/").pop()}`} />
                    </audio>
                  )}
                  {msg.contentType === "file" && msg.mediaPath && (
                    <a href={`/uploads/media/${msg.mediaPath.split("/").pop()}`} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-2 rounded-lg bg-black/20 px-3 py-2 mb-1.5 text-caption hover:bg-black/30 transition-fast">
                      <FileText className="h-4 w-4 shrink-0" />
                      <span className="truncate">{msg.mediaPath.split("/").pop()}</span>
                    </a>
                  )}
                  {/* Text content */}
                  {msg.body && <p className="text-body leading-relaxed">{msg.body}</p>}
                  <div className={cn("mt-1 flex items-center gap-1.5 text-micro opacity-50",
                    msg.direction === "outgoing" ? "flex-row-reverse" : "")}>
                    <span>{formatTime(msg.sentAt || msg.createdAt)}</span>
                    {msg.direction === "outgoing" && (
                      msg.status === "pending" ? (
                        <Clock className="h-3 w-3 animate-pulse" />
                      ) : (
                        <CheckCheck className="h-3 w-3" />
                      )
                    )}
                  </div>
                </div>
              </div>
            ))}
            {messages.length === 0 && selectedEntry && (
              <div className="flex flex-col items-center justify-center py-16 text-n-text-dim">
                <MessageCircleMore className="h-8 w-8 mb-2 opacity-20" />
                <p className="text-caption">Nenhuma mensagem encontrada</p>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Composer with channel selector */}
          <footer className="p-3 border-t border-n-border/40 bg-n-surface">
            <div className="flex items-end gap-2">
              {/* Channel toggle */}
              <div className="flex flex-col gap-1">
                {selectedEntry?.channels.includes("whatsapp") && (
                  <button onClick={() => setSendChannel("whatsapp")}
                    className={cn("h-8 w-8 rounded-lg flex items-center justify-center border transition-fast",
                      sendChannel === "whatsapp" ? "border-n-wa/40 bg-n-wa/10" : "border-n-border bg-n-surface hover:bg-n-surface-2")}>
                    <MessageCircleMore className={cn("h-3.5 w-3.5", sendChannel === "whatsapp" ? "text-n-wa" : "text-n-text-dim")} />
                  </button>
                )}
                {selectedEntry?.channels.includes("instagram") && (
                  <button onClick={() => setSendChannel("instagram")}
                    className={cn("h-8 w-8 rounded-lg flex items-center justify-center border transition-fast",
                      sendChannel === "instagram" ? "border-n-ig/40 bg-n-ig/10" : "border-n-border bg-n-surface hover:bg-n-surface-2")}>
                    <Instagram className={cn("h-3.5 w-3.5", sendChannel === "instagram" ? "text-n-ig" : "text-n-text-dim")} />
                  </button>
                )}
              </div>
              {/* Attachment button */}
              <div className="flex flex-col gap-1">
                <label className={cn("h-8 w-8 rounded-lg flex items-center justify-center border cursor-pointer transition-fast",
                  attachment ? "border-n-blue/40 bg-n-blue/10 text-n-blue" : "border-n-border bg-n-surface text-n-text-dim hover:bg-n-surface-2")}>
                  <Paperclip className="h-3.5 w-3.5" />
                  <input type="file" className="hidden" accept="image/*,video/*,audio/*,.pdf,.doc,.docx"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleAttachment(f); e.target.value = ""; }} />
                </label>
              </div>
              {/* Automation quick-reply */}
              {enabledAutomations.length > 0 && (
                <div className="relative flex flex-col gap-1">
                  <button
                    onClick={() => setZapOpen(!zapOpen)}
                    className={cn("h-8 w-8 rounded-lg flex items-center justify-center border cursor-pointer transition-fast",
                      zapOpen ? "border-n-blue/40 bg-n-blue/10 text-n-blue" : "border-n-border bg-n-surface text-n-text-dim hover:bg-n-surface-2")}
                  >
                    <Zap className="h-3.5 w-3.5" />
                  </button>
                  {zapOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setZapOpen(false)} />
                      <div className="absolute bottom-full left-0 mb-1 w-56 rounded-lg border border-n-border bg-n-surface shadow-panel z-50 max-h-48 overflow-y-auto custom-scrollbar">
                        <div className="px-3 py-1.5 border-b border-n-border">
                          <span className="text-micro text-n-text-dim font-medium">Disparar automacao</span>
                        </div>
                        {enabledAutomations.map(a => (
                          <button
                            key={a.id}
                            onClick={() => triggerAutomationMutation.mutate(a.id)}
                            disabled={triggerAutomationMutation.isPending}
                            className="w-full text-left px-3 py-2 text-caption text-n-text hover:bg-n-surface-2 transition-fast flex items-center gap-2"
                          >
                            <Zap className="h-3 w-3 text-n-blue shrink-0" />
                            <span className="truncate">{a.name}</span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
              {/* Input */}
              <div className="flex-1">
                {attachment && (
                  <div className="flex items-center gap-2 rounded-t-lg bg-n-surface-2 border border-b-0 border-n-border px-2 py-1.5">
                    <span className="text-micro text-n-blue">{attachment.type.toUpperCase()}</span>
                    <span className="text-caption text-n-text-muted truncate flex-1">{attachment.file.name}</span>
                    <button onClick={() => setAttachment(null)} className="text-n-text-dim hover:text-n-red text-micro">X</button>
                  </div>
                )}
                <Textarea
                  placeholder={uploading ? "Enviando arquivo..." : `Enviar via ${sendChannel === "whatsapp" ? "WhatsApp" : "Instagram"}...`}
                  className={cn("min-h-[48px] max-h-[100px] resize-none bg-n-surface border-n-border px-3 py-2 text-body text-n-text focus:border-n-blue/40 transition-fast",
                    attachment ? "rounded-b-lg rounded-t-none" : "rounded-lg")}
                  value={composer}
                  onChange={(e) => setComposer(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && (composer.trim() || attachment) && selectedEntry) {
                      e.preventDefault();
                      doSend();
                    }
                  }}
                />
              </div>
              {/* Send */}
              <button
                disabled={(!composer.trim() && !attachment) || !selectedEntry || sendMutation.isPending}
                onClick={doSend}
                className="h-10 w-10 shrink-0 rounded-xl bg-n-blue text-white flex items-center justify-center shadow-sm shadow-n-blue/25 disabled:opacity-20 disabled:shadow-none transition-all duration-200 hover:bg-n-blue/90 hover:shadow-md hover:shadow-n-blue/30 active:scale-95">
                <SendHorizonal className="h-4 w-4" />
              </button>
            </div>
          </footer>
        </div>

        {/* Context sidebar (right) - Editable contact panel — hidden below xl */}
        <ContactSidebar
          contactId={selectedEntry?.contactId ?? null}
          channels={selectedEntry?.channels ?? []}
          lastMessageAt={selectedEntry?.lastMessageAt ?? null}
          messageCount={messages.length}
        />
      </div>

      {/* Sheet drawer for contact panel on smaller screens (below xl) */}
      <Sheet open={contactSheetOpen} onOpenChange={setContactSheetOpen}>
        <SheetContent>
          <SheetTitle className="sr-only">Detalhes do contato</SheetTitle>
          <div className="p-4 overflow-y-auto h-full">
            <ContactSidebar
              contactId={selectedEntry?.contactId ?? null}
              channels={selectedEntry?.channels ?? []}
              lastMessageAt={selectedEntry?.lastMessageAt ?? null}
              messageCount={messages.length}
              inSheet
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
