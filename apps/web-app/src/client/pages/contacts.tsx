import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, ChevronLeft, ChevronRight, Pencil, Plus, Search, SlidersHorizontal } from "lucide-react";
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
import { contactProcedureLabelMap, contactStatusLabelMap, contactStatusTone, formatInstagramRelationship } from "@/lib/contact-display";
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
  procedureStatus: "yes" | "no" | "unknown";
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
    <div className="divide-y divide-white/6">
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className="grid gap-3 px-4 py-3 lg:grid-cols-[minmax(0,2fr)_minmax(14rem,1.35fr)_auto] lg:items-center">
          <div className="space-y-2">
            <div className="h-4 w-44 rounded-full bg-white/8" />
            <div className="h-3.5 w-64 rounded-full bg-white/6" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1.5">
              <div className="h-7 w-7 rounded-full bg-white/6" />
              <div className="h-7 w-7 rounded-full bg-white/6" />
            </div>
            <div className="h-6 w-20 rounded-full bg-white/6" />
            <div className="h-6 w-16 rounded-full bg-white/6" />
            <div className="flex gap-2">
              <div className="h-6 w-20 rounded-full bg-white/6" />
              <div className="h-6 w-16 rounded-full bg-white/6" />
            </div>
          </div>
          <div className="flex gap-2">
            <div className="h-9 w-10 rounded-xl bg-white/6" />
            <div className="h-9 w-20 rounded-xl bg-white/6" />
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
  const [status, setStatus] = useState("all");
  const [tag, setTag] = useState("all");
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [search, status, tag]);

  const contactsQuery = useQuery({
    queryKey: ["contacts", deferredSearch, status, tag, page],
    queryFn: () =>
      apiFetch<ContactsResponse>(
        `/contacts?q=${encodeURIComponent(deferredSearch)}&status=${encodeURIComponent(status === "all" ? "" : status)}&tag=${encodeURIComponent(
          tag === "all" ? "" : tag
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

  const cpfError = draft.cpf.trim().length > 0 && !isValidCpf(draft.cpf) ? "CPF inválido. Confira o número digitado antes de salvar." : null;
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

  const total = contactsQuery.data?.total ?? 0;
  const totalPages = contactsQuery.data?.totalPages ?? 1;
  const currentPage = contactsQuery.data?.page ?? page;
  const pageStart = total === 0 ? 0 : (currentPage - 1) * CONTACTS_PER_PAGE + 1;
  const pageEnd = total === 0 ? 0 : Math.min(total, pageStart + CONTACTS_PER_PAGE - 1);

  return (
    <div className="space-y-8 pb-20 animate-in fade-in duration-700">
      <PageHeader
        eyebrow="CRM Operacional"
        title="Gestão de Contatos"
        description="Consulte, filtre e atualize sua base de contatos com foco em leitura rápida, canais ativos e histórico consistente."
        actions={
          <div className="flex items-center gap-3 bg-white/5 p-1.5 rounded-2xl border border-white/5 backdrop-blur-md">
            <Button variant="ghost" size="sm" className="h-10 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-white" onClick={goBack}>
              <ArrowLeft className="mr-2 h-3.5 w-3.5" />
              Voltar
            </Button>
            <div className="h-4 w-px bg-white/10" />
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={openForCreate} className="h-10 rounded-xl bg-cmm-blue px-6 text-[10px] font-black uppercase tracking-widest shadow-lg shadow-blue-500/20 hover:scale-[1.02] transition-transform">
                <Plus className="mr-2 h-3.5 w-3.5" />
                Novo Contato
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl border-white/10 bg-slate-950/90 backdrop-blur-3xl rounded-[2.5rem] p-0 overflow-hidden shadow-2xl">
              <div className="p-10 space-y-8">
                <div className="flex items-start justify-between">
                  <div className="space-y-2">
                    <DialogTitle className="font-display text-3xl font-bold text-white tracking-tight">{editingId ? "Editar Perfil" : "Criar Registro"}</DialogTitle>
                    <DialogDescription className="text-sm font-medium text-slate-400">
                      Preencha os dados principais do contato. O cadastro exige ao menos um canal ativo.
                    </DialogDescription>
                  </div>
                  <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-5 text-right backdrop-blur-xl">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Preview</p>
                      <p className="mt-1 text-base font-bold text-white tracking-tight">{draft.name || "Sem Nome"}</p>
                      <p className="text-[11px] font-bold text-cmm-blue tracking-tighter">{draft.phone || draft.instagram || "Aguardando canal..."}</p>
                    </div>
                  </div>

                  {saveContactMutation.error ? <ErrorPanel message={(saveContactMutation.error as Error).message} /> : null}

                  <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
                    <div className="space-y-6">
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="md:col-span-2 space-y-1.5">
                          <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-500">Nome Completo</label>
                          <Input className="h-12 rounded-2xl border-white/5 bg-white/[0.02] px-4 font-bold tracking-tight text-white focus:border-cmm-blue/30 focus:bg-white/[0.04]" placeholder="Ex: Gabriel Braga" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                        </div>
                        <div className="space-y-1.5">
                          <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-500">Telefone</label>
                          <Input className="h-12 rounded-2xl border-white/5 bg-white/[0.02] px-4 font-bold tracking-tight text-white focus:border-cmm-blue/30" placeholder="55 31 9..." value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: formatPhoneForInput(e.target.value) })} />
                        </div>
                        <div className="space-y-1.5">
                          <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-500">CPF</label>
                          <Input className="h-12 rounded-2xl border-white/5 bg-white/[0.02] px-4 font-bold tracking-tight text-white focus:border-cmm-blue/30" placeholder="000.000.000-00" value={draft.cpf} onChange={(e) => setDraft({ ...draft, cpf: formatCpfInput(e.target.value) })} />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-500">Instagram Handle</label>
                        <Input className="h-12 rounded-2xl border-white/5 bg-white/[0.02] px-4 font-bold tracking-tight text-white focus:border-cmm-blue/30" placeholder="@usuario" value={draft.instagram} onChange={(e) => setDraft({ ...draft, instagram: e.target.value })} />
                      </div>
                      <div className="space-y-1.5">
                        <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-500">Classificação (Tags)</label>
                        <TagChipInput value={draft.tags} onChange={(v) => setDraft({ ...draft, tags: v })} options={tagsQuery.data ?? []} />
                      </div>
                    </div>

                    <div className="space-y-6">
                      <div className="rounded-[2rem] border border-white/5 bg-white/[0.02] p-6 space-y-6">
                        <div className="space-y-1.5">
                          <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-500">Ciclo de Atendimento</label>
                          <select className="w-full h-12 rounded-2xl border border-white/5 bg-black/20 px-4 text-sm font-bold text-white outline-none focus:border-cmm-blue/30" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
                            {Object.entries(contactStatusLabelMap).map(([v, l]) => <option key={v} value={v} className="bg-slate-900">{l}</option>)}
                          </select>
                        </div>
                        <div className="space-y-1.5">
                          <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-500">Já Fez Procedimento?</label>
                          <select className="w-full h-12 rounded-2xl border border-white/5 bg-black/20 px-4 text-sm font-bold text-white outline-none focus:border-cmm-blue/30" value={draft.procedureStatus} onChange={(e) => setDraft({ ...draft, procedureStatus: e.target.value as any })}>
                            <option value="unknown" className="bg-slate-900">Não Definido</option>
                            <option value="yes" className="bg-slate-900">Sim</option>
                            <option value="no" className="bg-slate-900">Não</option>
                          </select>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-500">Anotações Internas</label>
                        <Textarea className="min-h-[120px] rounded-[1.5rem] border-white/5 bg-white/[0.02] px-4 py-3 font-medium text-slate-300 focus:border-cmm-blue/30" placeholder="Detalhes estratégicos..." value={draft.notes || ""} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between border-t border-white/5 pt-8">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1 italic">
                      {hasPrimaryChannel ? "Dados prontos para processamento" : "Um canal (WPP/IG) é obrigatório"}
                    </p>
                    <div className="flex gap-4">
                      <Button variant="ghost" className="h-12 rounded-2xl px-8 text-xs font-black uppercase tracking-widest text-slate-400 hover:bg-white/5" onClick={() => setDialogOpen(false)}>Cancelar</Button>
                      <Button className="h-12 rounded-2xl bg-cmm-blue px-10 text-xs font-black uppercase tracking-widest shadow-xl shadow-blue-500/20" disabled={saveContactMutation.isPending || !hasPrimaryChannel || Boolean(cpfError)} onClick={() => saveContactMutation.mutate(draft)}>
                        {saveContactMutation.isPending ? "PROCESSANDO..." : editingId ? "SALVAR ALTERAÇÕES" : "CADASTRAR REGISTRO"}
                      </Button>
                    </div>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      <div className="glass-card rounded-[2.5rem] border-white/5 bg-white/[0.01] p-8 space-y-8 shadow-2xl">
        <div className="grid gap-6 items-center lg:grid-cols-[1fr_auto]">
          <div className="grid gap-6 md:grid-cols-3">
            <div className="relative group">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 group-focus-within:text-cmm-blue transition-colors" />
              <Input
                className="h-14 rounded-2xl border-white/5 bg-white/[0.02] pl-12 pr-4 font-bold text-white tracking-tight focus:border-cmm-blue/30 focus:bg-white/[0.04] shadow-inner transition-all"
                placeholder="Filtrar por nome, handle ou tag..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select className="h-14 rounded-2xl border border-white/5 bg-white/[0.02] px-6 text-sm font-bold text-slate-300 outline-none transition hover:bg-white/[0.04] focus:border-cmm-blue/30" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all" className="bg-slate-900">Todos os Status</option>
              {Object.entries(contactStatusLabelMap).map(([v, l]) => <option key={v} value={v} className="bg-slate-900">{l}</option>)}
            </select>
            <select className="h-14 rounded-2xl border border-white/5 bg-white/[0.02] px-6 text-sm font-bold text-slate-300 outline-none transition hover:bg-white/[0.04] focus:border-cmm-blue/30" value={tag} onChange={(e) => setTag(e.target.value)}>
              <option value="all" className="bg-slate-900">Todas as Tags</option>
              {(tagsQuery.data ?? []).map((item) => <option key={item.id} value={item.name} className="bg-slate-900">{item.name}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-6 px-4">
            <div className="text-right">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Total Base</p>
              <p className="text-xl font-bold text-white tracking-tighter">{total}</p>
            </div>
            <div className="h-10 w-px bg-white/5" />
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5 text-slate-500">
              <SlidersHorizontal className="h-5 w-5" />
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-[2rem] border border-white/5 bg-black/20 backdrop-blur-md">
          <div className="max-h-[700px] overflow-auto custom-scrollbar">
            <table className="w-full text-left">
              <thead className="sticky top-0 z-10 bg-slate-950/80 backdrop-blur-3xl border-b border-white/5 font-display text-[10px] font-black uppercase tracking-widest text-slate-500">
                <tr>
                  <th className="px-8 py-5">Perfil e Identificação</th>
                  <th className="px-8 py-5">Status e Ciclos</th>
                  <th className="px-8 py-5">Contexto Operacional</th>
                  <th className="px-8 py-5 text-right">Controles</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {contactsQuery.isLoading ? (
                  <tr><td colSpan={4}><LoadingRows /></td></tr>
                ) : (contactsQuery.data?.items ?? []).map((contact) => (
                  <tr key={contact.id} className="group hover:bg-white/[0.02] transition-colors">
                    <td className="px-8 py-6">
                      <div className="flex items-center gap-6">
                        <div className={cn("flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5 text-xl font-black transition-transform group-hover:scale-105",
                          contact.instagram ? "text-cmm-orange" : "text-cmm-emerald"
                        )}>
                          {contact.name?.charAt(0) || contact.phone?.charAt(0) || "?"}
                        </div>
                        <div className="min-w-0 space-y-1">
                          <h4 className="truncate font-display text-lg font-bold text-white tracking-tight leading-tight">{contact.name || "Sem Nome"}</h4>
                          <p className="truncate text-xs font-bold text-slate-500 uppercase tracking-widest">{channelSummary(contact)}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-8 py-6">
                      <div className="space-y-3">
                        <Badge className="rounded-full px-3 py-0.5 text-[9px] font-black uppercase tracking-widest" tone={contactStatusTone(contact.status)}>
                          {contactStatusLabelMap[contact.status] ?? contact.status}
                        </Badge>
                        <div className="flex flex-wrap gap-1.5 opacity-60 group-hover:opacity-100 transition-opacity">
                          {contact.tags.slice(0, 2).map((item) => (
                            <TagPill key={`${contact.id}-${item}`} name={item} color={tagColorMap.get(item.trim().toLowerCase())} className="scale-90 origin-left" />
                          ))}
                          {contact.tags.length > 2 && <span className="text-[10px] font-bold text-slate-500">+{contact.tags.length - 2}</span>}
                        </div>
                      </div>
                    </td>
                    <td className="px-8 py-6">
                      <div className="flex flex-wrap items-center gap-3">
                        <ChannelIndicators compact phone={contact.phone} instagram={contact.instagram} channels={contact.channels} />
                        <div className="h-4 w-px bg-white/5" />
                        <div className="flex flex-col">
                          <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest">{contactProcedureLabelMap[contact.procedureStatus]} Proc.</span>
                          {contact.instagram && <span className="text-[9px] font-bold text-cmm-blue uppercase tracking-widest mt-0.5">{formatInstagramRelationship(contact)}</span>}
                        </div>
                      </div>
                    </td>
                    <td className="px-8 py-6 text-right">
                      <div className="flex items-center justify-end gap-3 opacity-0 group-hover:opacity-100 transition-all duration-300 translate-x-4 group-hover:translate-x-0">
                        <Button variant="ghost" className="h-10 w-10 rounded-xl bg-white/5 hover:bg-cmm-blue/20 hover:text-cmm-blue" onClick={() => openForEdit(contact)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Link to={`/contacts/${contact.id}`}>
                          <Button className="h-10 rounded-xl border border-white/5 bg-white/5 px-5 text-[10px] font-black uppercase tracking-widest hover:bg-white/10 transition-all" variant="secondary">
                            Dossiê
                          </Button>
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}

                {!contactsQuery.isLoading && (contactsQuery.data?.items ?? []).length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-8 py-20 text-center">
                      <div className="mx-auto h-20 w-20 rounded-3xl bg-white/5 flex items-center justify-center mb-6">
                        <Search className="h-8 w-8 text-slate-600" />
                      </div>
                      <h4 className="font-display text-xl font-bold text-white tracking-tight">Nenhum Filtro Ativo</h4>
                      <p className="text-sm font-medium text-slate-500 mt-2">Ajuste sua busca ou cadastre um novo paciente para operar.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-6 pt-4 border-t border-white/5">
          <div className="space-y-1">
            <p className="text-[11px] font-black text-slate-500 uppercase tracking-widest">Navegação da Base</p>
            <div className="flex items-center gap-3">
              <Badge tone="default" className="rounded-full px-3 py-1 text-[10px] font-black bg-white/5 border-white/5">
                Página {currentPage} de {totalPages}
              </Badge>
              <span className="text-xs font-medium text-slate-500 italic">Visualizando {pageStart}-{pageEnd} registros</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              disabled={currentPage <= 1}
              onClick={() => setPage((c) => Math.max(1, c - 1))}
              className="h-12 rounded-2xl bg-white/5 px-6 text-xs font-black uppercase tracking-widest hover:bg-white/10"
            >
              <ChevronLeft className="mr-2 h-4 w-4" />
              Voltar
            </Button>
            <Button
              variant="secondary"
              disabled={currentPage >= totalPages}
              onClick={() => setPage((c) => c + 1)}
              className="h-12 rounded-2xl bg-white/5 px-6 text-xs font-black uppercase tracking-widest hover:bg-white/10"
            >
              Seguir
              <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
