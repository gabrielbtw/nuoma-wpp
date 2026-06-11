import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, ChevronLeft, ChevronRight, Download, Pencil, Plus, Search, SlidersHorizontal } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorPanel } from "@/components/shared/error-panel";
import { TagChipInput } from "@/components/tags/tag-chip-input";
import { TagPill } from "@/components/tags/tag-pill";
import { ChannelIndicators } from "@/components/contacts/channel-indicators";
import { apiFetch, toJsonBody } from "@/lib/api";
import { type ContactProcedureStatus, contactProcedureLabelMap, contactStatusLabelMap, contactStatusTone, formatInstagramRelationship } from "@/lib/contact-display";
import { cn } from "@/lib/utils";
import {
  formatChannelDisplayValue,
  formatCpfInput,
  formatPhoneForDisplay,
  formatPhoneForInput,
  isValidCpf,
  normalizeCpf,
  normalizePhoneForSubmission
} from "@/lib/contact-utils";

const CONTACTS_PER_PAGE = 60;

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
  cpf: string | null;
  email: string | null;
  instagram: string | null;
  notes: string | null;
  status: string;
  procedureStatus: "yes" | "no" | "unknown";
  tags: string[];
  channels: ContactChannel[];
  instagramFollowsMe: boolean | null;
  instagramFollowedByMe: boolean | null;
  instagramIncomingMessagesCount: number;
  instagramSentMoreThanThreeMessages: boolean;
  lastMessagePreview: string | null;
};

type ContactsResponse = {
  items: ContactRecord[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

type TagRecord = {
  id: string;
  name: string;
  color: string;
  type: string;
  active: boolean;
  contactCount: number;
};

type ContactDraft = {
  name: string;
  phone: string;
  cpf: string;
  email: string;
  instagram: string;
  notes: string;
  status: string;
  procedureStatus: ContactProcedureStatus;
  tags: string[];
};

const emptyContact: ContactDraft = {
  name: "",
  phone: "",
  cpf: "",
  email: "",
  instagram: "",
  notes: "",
  status: "novo",
  procedureStatus: "unknown",
  tags: []
};

function channelSummary(contact: ContactRecord) {
  if (contact.channels.length > 0) {
    return contact.channels
      .map((channel) => formatChannelDisplayValue(channel.type, channel.displayValue))
      .filter(Boolean)
      .join(" • ");
  }

  return [contact.phone ? formatPhoneForDisplay(contact.phone) : null, formatChannelDisplayValue("instagram", contact.instagram)].filter(Boolean).join(" • ");
}

function LoadingRows() {
  return (
    <div className="divide-y divide-n-border-subtle">
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className="grid gap-3 px-4 py-3 lg:grid-cols-[minmax(0,2fr)_minmax(14rem,1.35fr)_auto] lg:items-center">
          <div className="space-y-2">
            <div className="h-4 w-44 rounded-full bg-n-surface-2" />
            <div className="h-3.5 w-64 rounded-full bg-n-surface-2" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1.5">
              <div className="h-7 w-7 rounded-full bg-n-surface-2" />
              <div className="h-7 w-7 rounded-full bg-n-surface-2" />
            </div>
            <div className="h-6 w-20 rounded-full bg-n-surface-2" />
            <div className="h-6 w-16 rounded-full bg-n-surface-2" />
            <div className="flex gap-2">
              <div className="h-6 w-20 rounded-full bg-n-surface-2" />
              <div className="h-6 w-16 rounded-full bg-n-surface-2" />
            </div>
          </div>
          <div className="flex gap-2">
            <div className="h-8 w-10 rounded-lg bg-n-surface-2" />
            <div className="h-8 w-20 rounded-lg bg-n-surface-2" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ContactsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<ContactDraft>(emptyContact);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [statusFilter, setStatusFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("all");
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, tagFilter]);

  const contactsQuery = useQuery({
    queryKey: ["contacts", deferredSearch, statusFilter, tagFilter, page],
    queryFn: () =>
      apiFetch<ContactsResponse>(
        `/contacts?q=${encodeURIComponent(deferredSearch)}&status=${encodeURIComponent(statusFilter === "all" ? "" : statusFilter)}&tag=${encodeURIComponent(
          tagFilter === "all" ? "" : tagFilter
        )}&page=${page}&pageSize=${CONTACTS_PER_PAGE}`
      )
  });

  const tagsQuery = useQuery({
    queryKey: ["tags"],
    queryFn: () => apiFetch<TagRecord[]>("/tags")
  });

  useEffect(() => {
    if (contactsQuery.data && contactsQuery.data.page !== page) {
      setPage(contactsQuery.data.page);
    }
  }, [contactsQuery.data, page]);

  const saveContactMutation = useMutation({
    mutationFn: (payload: ContactDraft) =>
      apiFetch(editingId ? `/contacts/${editingId}` : "/contacts", {
        method: editingId ? "PATCH" : "POST",
        body: toJsonBody({
          ...payload,
          phone: normalizePhoneForSubmission(payload.phone),
          cpf: normalizeCpf(payload.cpf)
        })
      }),
    onSuccess: async () => {
      setDraft(emptyContact);
      setEditingId(null);
      setDialogOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["contacts"] });
      await queryClient.invalidateQueries({ queryKey: ["contact"] });
      await queryClient.invalidateQueries({ queryKey: ["contact-history"] });
      await queryClient.invalidateQueries({ queryKey: ["tags"] });
    }
  });

  const tagColorMap = useMemo(
    () => new Map((tagsQuery.data ?? []).map((item) => [item.name.trim().toLowerCase(), item.color])),
    [tagsQuery.data]
  );

  const cpfError = draft.cpf.trim().length > 0 && !isValidCpf(draft.cpf) ? "CPF invalido. Confira o numero digitado antes de salvar." : null;
  const hasPrimaryChannel = draft.phone.trim().length > 0 || draft.instagram.trim().length > 0;

  function goBack() {
    if (window.history.length > 1) {
      void navigate(-1);
      return;
    }

    void navigate("/dashboard");
  }

  function openForCreate() {
    setEditingId(null);
    setDraft(emptyContact);
    setDialogOpen(true);
  }

  function openForEdit(contact: ContactRecord) {
    setEditingId(contact.id);
    setDraft({
      name: contact.name ?? "",
      phone: formatPhoneForInput(contact.phone),
      cpf: formatCpfInput(contact.cpf ?? ""),
      email: contact.email ?? "",
      instagram: contact.instagram ?? "",
      notes: contact.notes ?? "",
      status: contact.status,
      procedureStatus: contact.procedureStatus,
      tags: contact.tags ?? []
    });
    setDialogOpen(true);
  }

  function exportContactsCsv() {
    const items = contactsQuery.data?.items ?? [];
    if (items.length === 0) return;

    const headers = ["Nome", "Telefone", "Email", "Instagram", "CPF", "Status", "Tags"];
    const rows = items.map(c => [
      c.name || "",
      c.phone || "",
      c.email || "",
      c.instagram || "",
      c.cpf || "",
      c.status || "",
      (c.tags || []).join("; ")
    ]);

    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `contatos-nuoma-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const total = contactsQuery.data?.total ?? 0;
  const totalPages = contactsQuery.data?.totalPages ?? 1;
  const currentPage = contactsQuery.data?.page ?? page;
  const pageStart = total === 0 ? 0 : (currentPage - 1) * CONTACTS_PER_PAGE + 1;
  const pageEnd = total === 0 ? 0 : Math.min(total, pageStart + CONTACTS_PER_PAGE - 1);

  return (
    <div className="space-y-5 pb-16 animate-fade-in">
      <PageHeader
        eyebrow="CRM Operacional"
        title="Gestao de Contatos"
        description="Consulte, filtre e atualize sua base de contatos com foco em leitura rapida, canais ativos e historico consistente."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="h-8 rounded-lg text-micro uppercase text-n-text-muted hover:text-n-text" onClick={goBack}>
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
              Voltar
            </Button>
            <Link to="/contacts/lab/client-tab">
              <Button variant="ghost" size="sm" className="h-8 rounded-lg border border-n-border bg-n-surface text-micro uppercase text-n-text-muted hover:text-n-text transition-fast">
                Ver 4 versoes
              </Button>
            </Link>
            <Button variant="outline" size="sm" onClick={exportContactsCsv} className="h-8 rounded-lg">
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Exportar
            </Button>
            <div className="h-4 w-px bg-n-border" />
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={openForCreate} className="h-8 rounded-lg bg-n-blue px-4 text-micro uppercase text-white hover:bg-n-blue/90 transition-fast">
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Novo Contato
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl border border-n-border bg-n-surface rounded-xl p-0 overflow-hidden shadow-panel">
              <div className="p-6 space-y-6">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <DialogTitle className="text-h2 text-n-text">{editingId ? "Editar Perfil" : "Criar Registro"}</DialogTitle>
                    <DialogDescription className="text-caption text-n-text-muted">
                      Preencha os dados principais do contato. O cadastro exige ao menos um canal ativo.
                    </DialogDescription>
                  </div>
                  <div className="rounded-lg border border-n-border bg-n-surface-2 p-3 text-right">
                      <p className="text-micro uppercase text-n-text-dim">Preview</p>
                      <p className="mt-0.5 text-h4 text-n-text">{draft.name || "Sem Nome"}</p>
                      <p className="text-caption text-n-blue">{draft.phone || draft.instagram || "Aguardando canal..."}</p>
                    </div>
                  </div>

                  {saveContactMutation.error ? <ErrorPanel message={(saveContactMutation.error as Error).message} /> : null}

                  <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
                    <div className="space-y-4">
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="md:col-span-2 space-y-1">
                          <label className="text-label text-n-text-dim">Nome Completo</label>
                          <Input className="h-9 rounded-lg border-n-border bg-n-surface-2 px-3 text-body text-n-text focus:border-n-blue/40" placeholder="Ex: Gabriel Braga" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                        </div>
                        <div className="space-y-1">
                          <label className="text-label text-n-text-dim">Telefone</label>
                          <Input className="h-9 rounded-lg border-n-border bg-n-surface-2 px-3 text-body text-n-text focus:border-n-blue/40" placeholder="55 31 9..." value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: formatPhoneForInput(e.target.value) })} />
                        </div>
                        <div className="space-y-1">
                          <label className="text-label text-n-text-dim">CPF</label>
                          <Input className="h-9 rounded-lg border-n-border bg-n-surface-2 px-3 text-body text-n-text focus:border-n-blue/40" placeholder="000.000.000-00" value={draft.cpf} onChange={(e) => setDraft({ ...draft, cpf: formatCpfInput(e.target.value) })} />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-label text-n-text-dim">Instagram Handle</label>
                        <Input className="h-9 rounded-lg border-n-border bg-n-surface-2 px-3 text-body text-n-text focus:border-n-blue/40" placeholder="@usuario" value={draft.instagram} onChange={(e) => setDraft({ ...draft, instagram: e.target.value })} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-label text-n-text-dim">Classificacao (Tags)</label>
                        <TagChipInput value={draft.tags} onChange={(v) => setDraft({ ...draft, tags: v })} options={tagsQuery.data ?? []} />
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="rounded-xl border border-n-border bg-n-surface-2 p-4 space-y-4">
                        <div className="space-y-1">
                          <label className="text-label text-n-text-dim">Ciclo de Atendimento</label>
                          <select className="w-full h-9 rounded-lg border border-n-border bg-n-bg px-3 text-body text-n-text outline-none focus:border-n-blue/40" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
                            {Object.entries(contactStatusLabelMap).map(([v, l]) => <option key={v} value={v} className="bg-n-bg">{l}</option>)}
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-label text-n-text-dim">Ja Fez Procedimento?</label>
                          <select className="w-full h-9 rounded-lg border border-n-border bg-n-bg px-3 text-body text-n-text outline-none focus:border-n-blue/40" value={draft.procedureStatus} onChange={(e) => setDraft({ ...draft, procedureStatus: e.target.value as ContactProcedureStatus })}>
                            <option value="unknown" className="bg-n-bg">Nao Definido</option>
                            <option value="yes" className="bg-n-bg">Sim</option>
                            <option value="no" className="bg-n-bg">Nao</option>
                          </select>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-label text-n-text-dim">Anotacoes Internas</label>
                        <Textarea className="min-h-[100px] rounded-xl border-n-border bg-n-surface-2 px-3 py-2 text-body text-n-text-muted focus:border-n-blue/40" placeholder="Detalhes estrategicos..." value={draft.notes || ""} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between border-t border-n-border pt-6">
                    <p className="text-micro text-n-text-dim italic">
                      {hasPrimaryChannel ? "Dados prontos para processamento" : "Um canal (WPP/IG) e obrigatorio"}
                    </p>
                    <div className="flex gap-3">
                      <Button variant="ghost" className="h-9 rounded-lg px-4 text-label text-n-text-muted hover:bg-n-surface-2" onClick={() => setDialogOpen(false)}>Cancelar</Button>
                      <Button className="h-9 rounded-lg bg-n-blue px-6 text-label text-white hover:bg-n-blue/90 transition-fast" disabled={saveContactMutation.isPending || !hasPrimaryChannel || Boolean(cpfError)} onClick={() => saveContactMutation.mutate(draft)}>
                        {saveContactMutation.isPending ? "Processando..." : editingId ? "Salvar Alteracoes" : "Cadastrar Registro"}
                      </Button>
                    </div>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      <div className="rounded-2xl border border-n-border/60 bg-n-surface p-4 space-y-4">
        <div className="grid gap-3 items-center lg:grid-cols-[1fr_auto]">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="relative group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-n-text-dim group-focus-within:text-n-blue transition-fast" />
              <Input
                className="h-9 rounded-lg border-n-border bg-n-surface-2 pl-9 pr-3 text-body text-n-text focus:border-n-blue/40 transition-fast"
                placeholder="Filtrar por nome, handle ou tag..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select className="h-9 rounded-lg border border-n-border bg-n-surface-2 px-3 text-body text-n-text-muted outline-none transition-fast hover:bg-n-surface-2 focus:border-n-blue/40" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all" className="bg-n-bg">Todos os Status</option>
              {Object.entries(contactStatusLabelMap).map(([v, l]) => <option key={v} value={v} className="bg-n-bg">{l}</option>)}
            </select>
            <select className="h-9 rounded-lg border border-n-border bg-n-surface-2 px-3 text-body text-n-text-muted outline-none transition-fast hover:bg-n-surface-2 focus:border-n-blue/40" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
              <option value="all" className="bg-n-bg">Todas as Tags</option>
              {(tagsQuery.data ?? []).map((item) => <option key={item.id} value={item.name} className="bg-n-bg">{item.name}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-4 px-2">
            <div className="text-right">
              <p className="text-micro uppercase text-n-text-dim">Total Base</p>
              <p className="font-mono text-h3 text-n-text">{total}</p>
            </div>
            <div className="h-8 w-px bg-n-border" />
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-n-surface-2 text-n-text-dim">
              <SlidersHorizontal className="h-4 w-4" />
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-n-border/40 bg-n-bg">
          <div className="max-h-[700px] overflow-auto custom-scrollbar">
            <table className="w-full text-left">
              <thead className="sticky top-0 z-10 bg-n-surface border-b border-n-border/40 text-micro uppercase tracking-wider text-n-text-dim">
                <tr>
                  <th className="px-4 py-3">Perfil e Identificacao</th>
                  <th className="px-4 py-3">Status e Ciclos</th>
                  <th className="px-4 py-3">Contexto Operacional</th>
                  <th className="px-4 py-3 text-right">Controles</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-n-border/30">
                {contactsQuery.isLoading ? (
                  <tr><td colSpan={4}><LoadingRows /></td></tr>
                ) : (contactsQuery.data?.items ?? []).map((contact) => (
                  <tr key={contact.id} className="group transition-all duration-200 hover:bg-n-surface-2/50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-body font-semibold transition-all duration-200 ring-1",
                          contact.instagram ? "bg-n-ig/8 text-n-ig ring-n-ig/15" : "bg-n-wa/8 text-n-wa ring-n-wa/15"
                        )}>
                          {(contact.name?.charAt(0) || contact.phone?.charAt(0) || "?").toUpperCase()}
                        </div>
                        <div className="min-w-0 space-y-0.5">
                          <h4 className="truncate text-h4 text-n-text leading-tight">{contact.name || "Sem Nome"}</h4>
                          <p className="truncate text-micro uppercase text-n-text-dim">{channelSummary(contact)}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="space-y-2">
                        <Badge className="rounded-full px-2 py-0.5 text-micro" tone={contactStatusTone(contact.status)}>
                          {contactStatusLabelMap[contact.status] ?? contact.status}
                        </Badge>
                        <div className="flex flex-wrap gap-1 opacity-70 group-hover:opacity-100 transition-fast">
                          {contact.tags.slice(0, 2).map((item) => (
                            <TagPill key={`${contact.id}-${item}`} name={item} color={tagColorMap.get(item.trim().toLowerCase())} className="scale-90 origin-left" />
                          ))}
                          {contact.tags.length > 2 && <span className="text-micro text-n-text-dim">+{contact.tags.length - 2}</span>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <ChannelIndicators compact phone={contact.phone} instagram={contact.instagram} channels={contact.channels} />
                        <div className="h-4 w-px bg-n-border-subtle" />
                        <div className="flex flex-col">
                          <span className="text-micro text-n-text-dim">{contactProcedureLabelMap[contact.procedureStatus]} Proc.</span>
                          {contact.instagram && <span className="text-micro text-n-blue mt-0.5">{formatInstagramRelationship(contact)}</span>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-fast">
                        <Button variant="ghost" className="h-8 w-8 rounded-lg bg-n-surface-2 hover:bg-n-blue/10 hover:text-n-blue transition-fast" onClick={() => openForEdit(contact)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Link to={`/contacts/${contact.id}`}>
                          <Button className="h-8 rounded-lg border border-n-border bg-n-surface-2 px-3 text-micro uppercase text-n-text-muted hover:bg-n-surface-2 hover:text-n-text transition-fast" variant="secondary">
                            Dossie
                          </Button>
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}

                {!contactsQuery.isLoading && (contactsQuery.data?.items ?? []).length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-16 text-center">
                      <div className="mx-auto h-14 w-14 rounded-xl bg-n-surface-2 flex items-center justify-center mb-4">
                        <Search className="h-6 w-6 text-n-text-dim" />
                      </div>
                      <h4 className="text-h3 text-n-text">Nenhum Filtro Ativo</h4>
                      <p className="text-caption text-n-text-muted mt-1">Ajuste sua busca ou cadastre um novo paciente para operar.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 pt-3 border-t border-n-border/40">
          <div className="space-y-0.5">
            <p className="text-micro uppercase text-n-text-dim">Navegacao da Base</p>
            <div className="flex items-center gap-2">
              <Badge tone="default" className="rounded-full px-2 py-0.5 text-micro bg-n-surface-2 border-n-border">
                Pagina {currentPage} de {totalPages}
              </Badge>
              <span className="text-caption text-n-text-muted italic">Visualizando {pageStart}-{pageEnd} registros</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              disabled={currentPage <= 1}
              onClick={() => setPage((c) => Math.max(1, c - 1))}
              className="h-8 rounded-lg bg-n-surface-2 border border-n-border px-4 text-label text-n-text-muted hover:bg-n-surface-2 hover:text-n-text transition-fast"
            >
              <ChevronLeft className="mr-1.5 h-3.5 w-3.5" />
              Voltar
            </Button>
            <Button
              variant="secondary"
              disabled={currentPage >= totalPages}
              onClick={() => setPage((c) => c + 1)}
              className="h-8 rounded-lg bg-n-surface-2 border border-n-border px-4 text-label text-n-text-muted hover:bg-n-surface-2 hover:text-n-text transition-fast"
            >
              Seguir
              <ChevronRight className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
