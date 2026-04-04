import { type ChangeEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Eye, Instagram, MessageCircleMore, PauseCircle, PlayCircle, Plus, Search, StopCircle, Trash2, Upload } from "lucide-react";
import { WorkflowViewer } from "@/components/campaigns/workflow-viewer";
import { CampaignBuilder } from "@/components/campaigns/builder";
import { ChannelSessionStrip } from "@/components/shared/channel-session-strip";
import { ConfirmActionDialog } from "@/components/shared/confirm-action-dialog";
import { ErrorPanel } from "@/components/shared/error-panel";
import { PageHeader } from "@/components/shared/page-header";
import { ChromeTabs } from "@/components/ui/chrome-tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch, toJsonBody } from "@/lib/api";
import {
  campaignStatusOptions,
  emptyCampaignDraft,
  formatCampaignDateTime,
  getCampaignActivationIssues,
  normalizeCampaignDraft,
  statusLabel,
  statusTone,
  type CampaignDraft
} from "@/lib/campaign-utils";
import { formatChannelDisplayValue } from "@/lib/contact-utils";
import { cn } from "@/lib/utils";

type CampaignRecord = CampaignDraft & {
  id: string;
  csvPath: string | null;
  totalRecipients: number;
  processedRecipients: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type CampaignRecipientRecord = {
  id: string;
  campaign_id: string;
  contact_id: string | null;
  channel: "whatsapp" | "instagram" | string;
  phone: string | null;
  instagram: string | null;
  target_display_value: string | null;
  target_normalized_value: string | null;
  name: string;
  status: string;
  step_index: number;
  next_run_at: string | null;
  last_attempt_at: string | null;
  last_error: string | null;
  extra_json?: string | null;
};

type UploadedCsvResponse = {
  uploadId: string;
  headers: string[];
  preview: Array<Record<string, string> & { _normalizedPhone?: string | null; _phoneLooksValid?: boolean }>;
  totalRows: number;
};

type CsvPreviewRow = Record<string, string | string[]> & {
  _normalizedPhone: string;
  _normalizedInstagram: string;
  _resolvedPhone: string;
  _resolvedInstagram: string;
  _resolvedChannel: "" | "whatsapp" | "instagram";
  _resolvedTargetDisplay: string;
  _resolvedTargetNormalized: string;
  _resolvedName: string;
  _matchType: "" | "phone" | "instagram" | "phone+instagram";
  _exists: "existing" | "eligible" | "new_contact" | "needs_review" | "insufficient_link" | "invalid";
  _reason: string;
  _contactId: string;
  _tags: string[];
};

type CsvValidationResponse = {
  uploadId: string;
  headers: string[];
  preview: CsvPreviewRow[];
  summary: {
    total: number;
    existing: number;
    eligible: number;
    new_contact: number;
    needs_review: number;
    insufficient_link: number;
    invalid: number;
  };
  totalRows: number;
};

type PendingCampaignCommand =
  | {
    action: "activate" | "pause" | "cancel" | "delete";
    campaignId: string;
    campaignName: string;
  }
  | null;

const recipientStatusLabels: Record<string, string> = {
  sent: "Executado",
  pending: "Pendente",
  processing: "Em fila",
  failed: "Falhou",
  blocked_by_rule: "Bloqueado"
};
const RECIPIENTS_PER_PAGE = 20;

function guessHeader(headers: string[], aliases: string[]) {
  const normalizedAliases = aliases.map((alias) => alias.toLowerCase());
  return (
    headers.find((header) => normalizedAliases.includes(header.toLowerCase())) ??
    headers.find((header) => normalizedAliases.some((alias) => header.toLowerCase().includes(alias))) ??
    ""
  );
}

function previewTone(status: CsvPreviewRow["_exists"]): "success" | "warning" | "danger" | "info" | "default" {
  switch (status) {
    case "existing":
      return "info";
    case "eligible":
      return "warning";
    case "new_contact":
      return "success";
    case "needs_review":
    case "insufficient_link":
      return "warning";
    case "invalid":
      return "danger";
    default:
      return "default";
  }
}

function previewLabel(status: CsvPreviewRow["_exists"]) {
  switch (status) {
    case "existing":
      return "Existente";
    case "eligible":
      return "Vinculável";
    case "new_contact":
      return "Novo cadastro";
    case "needs_review":
      return "Revisar";
    case "insufficient_link":
      return "Link insuficiente";
    case "invalid":
      return "Inválido";
    default:
      return status;
  }
}

function recipientTone(status: string): "success" | "warning" | "danger" | "info" | "default" {
  switch (status) {
    case "sent":
      return "success";
    case "failed":
      return "danger";
    case "blocked_by_rule":
      return "warning";
    case "processing":
      return "info";
    default:
      return "default";
  }
}

function previewCellValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value.join(", ");
  }

  return value ?? "";
}

function formatRecipientTarget(recipient: CampaignRecipientRecord) {
  const rawTarget =
    recipient.target_display_value ||
    (recipient.channel === "instagram" ? recipient.instagram : recipient.phone) ||
    recipient.target_normalized_value ||
    "";

  return formatChannelDisplayValue(recipient.channel, rawTarget);
}

function importableCount(summary?: CsvValidationResponse["summary"]) {
  if (!summary) {
    return 0;
  }

  return summary.existing + summary.eligible + summary.new_contact;
}

function campaignCompletion(campaign: CampaignRecord) {
  if (!campaign.totalRecipients) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round((campaign.processedRecipients / campaign.totalRecipients) * 100)));
}

export function CampaignsPage() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<CampaignDraft>(emptyCampaignDraft());
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [editorCampaign, setEditorCampaign] = useState<CampaignDraft | null>(null);
  const [pendingCommand, setPendingCommand] = useState<PendingCampaignCommand>(null);
  const [selectedRecipientId, setSelectedRecipientId] = useState<string | null>(null);
  const [recipientFilter, setRecipientFilter] = useState("all");
  const [recipientPage, setRecipientPage] = useState(1);
  const [csvUpload, setCsvUpload] = useState<UploadedCsvResponse | null>(null);
  const [csvValidation, setCsvValidation] = useState<CsvValidationResponse | null>(null);
  const [csvValidating, setCsvValidating] = useState(false);
  const [mapping, setMapping] = useState({ phone: "", name: "", instagram: "", tags: "" });
  const [activeTab, setActiveTab] = useState<"campaign" | "status">("campaign");
  const [filters, setFilters] = useState({ query: "", status: "all" });
  const [flashMessage, setFlashMessage] = useState<string | null>(null);
  const [manualInput, setManualInput] = useState("");
  const [manualChannel, setManualChannel] = useState<"whatsapp" | "instagram">("whatsapp");
  const [viewerCampaignId, setViewerCampaignId] = useState<string | null>(null);

  const campaignsQuery = useQuery({
    queryKey: ["campaigns"],
    queryFn: () => apiFetch<CampaignRecord[]>("/campaigns")
  });

  const filteredCampaigns = useMemo(() => {
    const items = campaignsQuery.data ?? [];
    const query = filters.query.trim().toLowerCase();

    return items.filter((campaign) => {
      const matchesQuery = query ? campaign.name.toLowerCase().includes(query) : true;
      const matchesStatus = filters.status === "all" ? true : campaign.status === filters.status;
      return matchesQuery && matchesStatus;
    });
  }, [campaignsQuery.data, filters.query, filters.status]);

  const selectedCampaign = useMemo(
    () => filteredCampaigns.find((campaign) => campaign.id === selectedCampaignId) ?? filteredCampaigns[0] ?? null,
    [filteredCampaigns, selectedCampaignId]
  );

  const viewerCampaign = useMemo(
    () => (campaignsQuery.data ?? []).find((c) => c.id === viewerCampaignId) ?? null,
    [campaignsQuery.data, viewerCampaignId]
  );

  const recipientsQuery = useQuery({
    queryKey: ["campaign-recipients", selectedCampaign?.id],
    queryFn: () => apiFetch<CampaignRecipientRecord[]>(`/campaigns/${selectedCampaign?.id}/recipients`),
    enabled: Boolean(selectedCampaign?.id),
    refetchInterval: 8_000
  });

  useEffect(() => {
    if (!filteredCampaigns.length) {
      setSelectedCampaignId(null);
      return;
    }

    if (!selectedCampaignId || !filteredCampaigns.some((campaign) => campaign.id === selectedCampaignId)) {
      setSelectedCampaignId(filteredCampaigns[0].id);
    }
  }, [filteredCampaigns, selectedCampaignId]);

  useEffect(() => {
    if (selectedCampaign) {
      setEditorCampaign(normalizeCampaignDraft(selectedCampaign));
    }
  }, [selectedCampaign]);

  useEffect(() => {
    if (!csvUpload?.headers.length) {
      return;
    }

    setMapping((current) => ({
      phone: csvUpload.headers.includes(current.phone) ? current.phone : guessHeader(csvUpload.headers, ["phone", "telefone", "celular", "numero", "número", "whatsapp"]),
      name: csvUpload.headers.includes(current.name) ? current.name : guessHeader(csvUpload.headers, ["name", "nome"]),
      instagram: csvUpload.headers.includes(current.instagram) ? current.instagram : guessHeader(csvUpload.headers, ["instagram", "ig", "insta"]),
      tags: csvUpload.headers.includes(current.tags) ? current.tags : guessHeader(csvUpload.headers, ["tag", "tags", "etiqueta", "etiquetas"])
    }));
  }, [csvUpload]);

  useEffect(() => {
    if (!csvUpload || !selectedCampaign?.id) {
      setCsvValidation(null);
      return;
    }

    if (!mapping.phone && !mapping.instagram) {
      setCsvValidation(null);
      return;
    }

    let active = true;
    setCsvValidating(true);

    apiFetch<CsvValidationResponse>(`/campaigns/${selectedCampaign.id}/preview-import`, {
      method: "POST",
      body: toJsonBody({
        uploadId: csvUpload.uploadId,
        mapping
      })
    })
      .then((response) => {
        if (active) {
          setCsvValidation(response);
        }
      })
      .catch(() => {
        if (active) {
          setCsvValidation(null);
        }
      })
      .finally(() => {
        if (active) {
          setCsvValidating(false);
        }
      });

    return () => {
      active = false;
    };
  }, [csvUpload, mapping, selectedCampaign?.id]);

  useEffect(() => {
    setCsvUpload(null);
    setCsvValidation(null);
  }, [selectedCampaign?.id]);

  useEffect(() => {
    setRecipientPage(1);
  }, [recipientFilter, selectedCampaign?.id]);

  useEffect(() => {
    if (!flashMessage) {
      return;
    }

    const timeout = window.setTimeout(() => setFlashMessage(null), 3500);
    return () => window.clearTimeout(timeout);
  }, [flashMessage]);

  const filteredRecipients = useMemo(() => {
    const items = recipientsQuery.data ?? [];
    return recipientFilter === "all" ? items : items.filter((recipient) => recipient.status === recipientFilter);
  }, [recipientFilter, recipientsQuery.data]);

  const recipientTotalPages = Math.max(1, Math.ceil(filteredRecipients.length / RECIPIENTS_PER_PAGE));

  useEffect(() => {
    if (recipientPage > recipientTotalPages) {
      setRecipientPage(recipientTotalPages);
    }
  }, [recipientPage, recipientTotalPages]);

  const pagedRecipients = useMemo(() => {
    const start = (recipientPage - 1) * RECIPIENTS_PER_PAGE;
    return filteredRecipients.slice(start, start + RECIPIENTS_PER_PAGE);
  }, [filteredRecipients, recipientPage]);

  useEffect(() => {
    const recipients = pagedRecipients;
    if (!recipients.length) {
      setSelectedRecipientId(null);
      return;
    }

    if (!selectedRecipientId || !recipients.some((recipient) => recipient.id === selectedRecipientId)) {
      setSelectedRecipientId(recipients[0].id);
    }
  }, [pagedRecipients, selectedRecipientId]);

  const selectedRecipient =
    pagedRecipients.find((recipient) => recipient.id === selectedRecipientId) ??
    filteredRecipients.find((recipient) => recipient.id === selectedRecipientId) ??
    null;

  const recipientCounts = useMemo(() => {
    const items = recipientsQuery.data ?? [];
    return {
      all: items.length,
      sent: items.filter((item) => item.status === "sent").length,
      pending: items.filter((item) => item.status === "pending").length,
      processing: items.filter((item) => item.status === "processing").length,
      failed: items.filter((item) => item.status === "failed").length,
      blocked_by_rule: items.filter((item) => item.status === "blocked_by_rule").length
    };
  }, [recipientsQuery.data]);

  const createMutation = useMutation({
    mutationFn: (payload: CampaignDraft) =>
      apiFetch<CampaignRecord>("/campaigns", {
        method: "POST",
        body: toJsonBody(payload)
      }),
    onSuccess: async (campaign) => {
      setCreateOpen(false);
      setDraft(emptyCampaignDraft());
      setFlashMessage("Rascunho salvo com sucesso.");
      await queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      if (campaign?.id) {
        setSelectedCampaignId(campaign.id);
      }
    }
  });

  const commandMutation = useMutation({
    mutationFn: ({ campaignId, action }: NonNullable<PendingCampaignCommand>) => {
      if (action === "delete") {
        return apiFetch(`/campaigns/${campaignId}`, {
          method: "DELETE"
        });
      }

      return apiFetch<CampaignRecord>(`/campaigns/${campaignId}/${action}`, {
        method: "POST"
      });
    },
    onSuccess: async (_result, variables) => {
      if (variables.action === "delete" && selectedCampaignId === variables.campaignId) {
        setSelectedCampaignId(null);
      }

      setFlashMessage(
        variables.action === "activate"
          ? "Campanha ativada."
          : variables.action === "pause"
            ? "Campanha pausada."
            : variables.action === "cancel"
              ? "Campanha cancelada."
              : "Campanha excluída."
      );
      setPendingCommand(null);
      await queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      await queryClient.invalidateQueries({ queryKey: ["campaign-recipients"] });
    }
  });

  const duplicateMutation = useMutation({
    mutationFn: (campaignId: string) =>
      apiFetch<CampaignRecord>(`/campaigns/${campaignId}/duplicate`, {
        method: "POST"
      }),
    onSuccess: async (campaign) => {
      await queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      if (campaign?.id) {
        setSelectedCampaignId(campaign.id);
      }
      setFlashMessage("Campanha duplicada como rascunho.");
    }
  });

  const saveExistingMutation = useMutation({
    mutationFn: (payload: CampaignDraft) =>
      apiFetch<CampaignRecord>(`/campaigns/${payload.id}`, {
        method: "PATCH",
        body: toJsonBody(payload)
      }),
    onSuccess: async () => {
      setFlashMessage("Campanha atualizada.");
      await queryClient.invalidateQueries({ queryKey: ["campaigns"] });
    }
  });

  const importRecipientsMutation = useMutation({
    mutationFn: ({ campaignId, payload }: { campaignId: string; payload: { uploadId: string; mapping: typeof mapping } }) =>
      apiFetch(`/campaigns/${campaignId}/import-recipients`, {
        method: "POST",
        body: toJsonBody(payload)
      }),
    onSuccess: async () => {
      setFlashMessage("Destinatários importados e vinculados com sucesso.");
      setActiveTab("status");
      await queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      await queryClient.invalidateQueries({ queryKey: ["campaign-recipients"] });
    }
  });

  const addManualMutation = useMutation({
    mutationFn: ({ campaignId, entries }: { campaignId: string; entries: Array<{ value: string; channel: "whatsapp" | "instagram"; name?: string }> }) =>
      apiFetch(`/campaigns/${campaignId}/add-recipients`, {
        method: "POST",
        body: toJsonBody({ entries })
      }),
    onSuccess: async () => {
      setFlashMessage("Destinatarios adicionados manualmente.");
      setManualInput("");
      await queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      await queryClient.invalidateQueries({ queryKey: ["campaign-recipients"] });
    }
  });

  const activationIssues = getCampaignActivationIssues(editorCampaign ?? selectedCampaign);
  const hasCsvMapping = Boolean(mapping.phone || mapping.instagram);
  const canActivateCampaign = Boolean(selectedCampaign && activationIssues.length === 0 && !["active", "completed", "cancelled"].includes(selectedCampaign.status));
  const canPauseCampaign = selectedCampaign?.status === "active";
  const canCancelCampaign = Boolean(selectedCampaign && !["cancelled", "completed"].includes(selectedCampaign.status));
  const importableRecipients = importableCount(csvValidation?.summary);
  const canImportRecipients = Boolean(selectedCampaign?.id && csvUpload?.uploadId && hasCsvMapping && !csvValidating && importableRecipients > 0);

  async function handleCsvUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    const response = await apiFetch<UploadedCsvResponse>("/uploads/csv", {
      method: "POST",
      body: formData
    });
    setCsvUpload(response);
    setCsvValidation(null);
    event.target.value = "";
  }

  const commandConfig = pendingCommand
    ? {
      activate: {
        title: "Ativar campanha",
        description: `Ativar ${pendingCommand.campaignName} agora? Os destinatários elegíveis entram na fila de execução.`,
        confirmLabel: "Confirmar ativação",
        confirmVariant: "default" as const
      },
      pause: {
        title: "Pausar campanha",
        description: `Pausar ${pendingCommand.campaignName}? Os destinatários permanecem vinculados e a campanha pode ser retomada.`,
        confirmLabel: "Confirmar pausa",
        confirmVariant: "secondary" as const
      },
      cancel: {
        title: "Cancelar campanha",
        description: `Cancelar ${pendingCommand.campaignName}? Essa ação interrompe a operação atual.`,
        confirmLabel: "Confirmar cancelamento",
        confirmVariant: "danger" as const
      },
      delete: {
        title: "Excluir campanha",
        description: `Excluir ${pendingCommand.campaignName}? O builder e os destinatários deixam de aparecer no painel.`,
        confirmLabel: "Excluir campanha",
        confirmVariant: "danger" as const
      }
    }[pendingCommand.action]
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Campanhas omnichannel"
        title="Campanhas"
        description="Fluxos com steps de mensagem, mídia e tag, base importada com vínculo automático e leitura operacional mais direta."
        actions={
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Nova campanha
              </Button>
            </DialogTrigger>
            <DialogContent className="h-[min(94dvh,980px)] w-[min(1280px,96vw)] overflow-hidden p-0">
              <div className="flex h-full flex-col">
                <div className="border-b border-white/8 px-6 py-5">
                  <DialogTitle className="font-display text-2xl text-white">Nova campanha omnichannel</DialogTitle>
                  <DialogDescription className="mt-1 text-sm text-slate-400">
                    Monte o fluxo, salve o rascunho e depois importe ou vincule os destinatários no painel principal.
                  </DialogDescription>
                </div>
                <div className="flex-1 overflow-y-auto px-6 py-6">
                  {createMutation.error ? <ErrorPanel message={(createMutation.error as Error).message} /> : null}
                  <CampaignBuilder value={draft} onChange={(next) => setDraft(normalizeCampaignDraft(next))} />
                </div>
                <div className="flex items-center justify-between border-t border-white/8 px-6 py-4">
                  <div className="text-sm text-slate-400">Ao salvar, o rascunho entra na lista principal e fica pronto para importação.</div>
                  <Button disabled={createMutation.isPending} onClick={() => createMutation.mutate(draft)}>
                    {createMutation.isPending ? "Salvando..." : "Salvar rascunho"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        }
      />

      {flashMessage ? (
        <div className="rounded-[1.25rem] border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{flashMessage}</div>
      ) : null}
      {campaignsQuery.error ? <ErrorPanel message={(campaignsQuery.error as Error).message} /> : null}

      <ChannelSessionStrip compact />

      <div className="grid gap-8 xl:grid-cols-[380px_1fr]">
        <div className="space-y-6">
          <div className="glass-card rounded-[2.5rem] border-white/5 bg-white/[0.01] p-8">
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-bold uppercase tracking-[0.2em] text-slate-500">Catálogo</h3>
                <p className="mt-1 text-[11px] font-medium text-slate-400">Total de {filteredCampaigns.length} campanhas exibidas com busca e status aplicados.</p>
              </div>

              <div className="space-y-4">
                <div className="relative group">
                  <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 transition-colors group-focus-within:text-cmm-blue" />
                  <Input
                    className="h-12 border-white/5 bg-white/[0.02] pl-11 rounded-2xl focus:border-cmm-blue/30 focus:ring-cmm-blue/10"
                    placeholder="Buscar por nome..."
                    value={filters.query}
                    onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
                  />
                </div>

                <div className="grid grid-cols-1 gap-3">
                  <select
                    className="h-12 rounded-2xl border border-white/5 bg-white/[0.02] px-4 text-sm font-bold text-slate-300 outline-none transition hover:bg-white/[0.04] focus:border-cmm-blue/30"
                    value={filters.status}
                    onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}
                  >
                    <option value="all" className="bg-slate-900">Todos os status</option>
                    {campaignStatusOptions.map((option) => (
                      <option key={option.value} value={option.value} className="bg-slate-900">
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex justify-end">
                  <Button variant="ghost" size="sm" className="text-[10px] font-bold uppercase tracking-widest text-slate-500 hover:text-white" onClick={() => setFilters({ query: "", status: "all" })}>
                    Limpar Filtros
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <div className="glass-card overflow-hidden rounded-[2.5rem] border-white/5 bg-white/[0.01]">
            <div className="max-h-[calc(100dvh-24rem)] divide-y divide-white/5 overflow-y-auto custom-scrollbar">
              {filteredCampaigns.map((campaign) => {
                const isSelected = selectedCampaign?.id === campaign.id;
                const completion = campaignCompletion(campaign);
                return (
                  <div
                    key={campaign.id}
                    className={cn(
                      "group relative flex flex-col p-6 text-left transition-all duration-300",
                      isSelected ? "bg-cmm-blue/5" : "hover:bg-white/[0.03]"
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <button type="button" onClick={() => setSelectedCampaignId(campaign.id)} className="min-w-0 flex-1 text-left">
                        <div className="flex items-center gap-3">
                          <div className={cn("h-2 w-2 rounded-full",
                            campaign.status === 'active' ? 'bg-cmm-emerald animate-pulse' :
                              campaign.status === 'completed' ? 'bg-cmm-blue' : 'bg-slate-500'
                          )} />
                          <h4 className="truncate font-display text-lg font-bold text-white tracking-tight">{campaign.name}</h4>
                        </div>
                        <p className="mt-2 line-clamp-1 text-xs font-medium text-slate-400 group-hover:text-slate-300">{campaign.description || "Sem resumo informado."}</p>
                      </button>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          aria-label={`Ver fluxo ${campaign.name}`}
                          className="flex h-9 w-9 items-center justify-center rounded-full border border-white/8 bg-white/[0.03] text-slate-400 transition hover:border-cmm-purple/30 hover:bg-cmm-purple/10 hover:text-cmm-purple"
                          onClick={(event) => {
                            event.stopPropagation();
                            setViewerCampaignId(campaign.id);
                          }}
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Duplicar ${campaign.name}`}
                          className="flex h-9 w-9 items-center justify-center rounded-full border border-white/8 bg-white/[0.03] text-slate-400 transition hover:border-cmm-blue/30 hover:bg-cmm-blue/10 hover:text-cmm-blue"
                          onClick={(event) => {
                            event.stopPropagation();
                            duplicateMutation.mutate(campaign.id);
                          }}
                        >
                          <Copy className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Excluir ${campaign.name}`}
                          className="flex h-9 w-9 items-center justify-center rounded-full border border-white/8 bg-white/[0.03] text-slate-400 transition hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-300"
                          onClick={(event) => {
                            event.stopPropagation();
                            setPendingCommand({ action: "delete", campaignId: campaign.id, campaignName: campaign.name });
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                        {isSelected && <div className="h-2 w-2 rounded-full bg-cmm-blue" />}
                      </div>
                    </div>

                    <button type="button" onClick={() => setSelectedCampaignId(campaign.id)} className="mt-4 text-left">
                      <div className="flex items-center justify-between">
                        <div className="flex gap-3 text-[9px] font-bold uppercase tracking-widest text-slate-500">
                          <span>{campaign.steps.length} Steps</span>
                          <span className="opacity-30">•</span>
                          <span>{campaign.totalRecipients} Contatos</span>
                        </div>
                        <Badge tone={statusTone(campaign.status)} className="rounded-full px-3 py-0.5 text-[9px] font-black uppercase tracking-widest">
                          {statusLabel(campaign.status)}
                        </Badge>
                      </div>

                      <div className="mt-4 space-y-2">
                        <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all",
                              campaign.status === "completed" ? "bg-cmm-emerald" : campaign.status === "active" ? "bg-cmm-blue" : "bg-slate-600"
                            )}
                            style={{ width: `${completion}%` }}
                          />
                        </div>
                        <div className="flex items-center justify-between text-[9px] font-bold uppercase tracking-widest text-slate-500">
                          <span>{campaign.processedRecipients} processados</span>
                          <span>{completion}%</span>
                        </div>
                      </div>
                    </button>
                  </div>
                );
              })}

              {!campaignsQuery.isLoading && filteredCampaigns.length === 0 ? (
                <div className="px-8 py-12 text-center">
                  <p className="text-sm font-medium text-slate-500 italic">Nenhuma campanha encontrada.</p>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          {selectedCampaign ? (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="glass-card rounded-[2rem] border-white/5 bg-white/[0.01] p-7">
                <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.9fr)_270px]">
                  <div className="min-w-0">
                    <div className="space-y-3">
                      <div className="flex items-start gap-3">
                        <h2 className="min-w-0 flex-1 font-display text-[2.15rem] font-bold leading-[0.95] text-white tracking-tight">{selectedCampaign.name}</h2>
                        <Badge tone={statusTone(selectedCampaign.status)} className="mt-1 shrink-0 rounded-full px-2.5 py-0.5 text-[8px] font-black uppercase tracking-[0.18em]">
                          {statusLabel(selectedCampaign.status)}
                        </Badge>
                      </div>
                      <p className="text-[13px] font-medium leading-6 text-slate-400">
                        {selectedCampaign.description || "Sem resumo operacional informado."}
                      </p>
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="flex items-center gap-2">
                          {[
                            { key: "whatsapp", icon: MessageCircleMore, active: selectedCampaign.eligibleChannels.includes("whatsapp"), tone: "text-cmm-emerald border-cmm-emerald/25 bg-cmm-emerald/10" },
                            { key: "instagram", icon: Instagram, active: selectedCampaign.eligibleChannels.includes("instagram"), tone: "text-cmm-orange border-cmm-orange/25 bg-cmm-orange/10" }
                          ].map((channel) => {
                            const Icon = channel.icon;
                            return (
                              <div
                                key={channel.key}
                                className={cn(
                                  "flex h-10 w-10 items-center justify-center rounded-full border transition-all",
                                  channel.active ? channel.tone : "border-white/8 bg-white/[0.02] text-slate-600"
                                )}
                                title={channel.key === "instagram" ? "Instagram" : "WhatsApp"}
                              >
                                <Icon className="h-4 w-4" />
                              </div>
                            );
                          })}
                        </div>
                        <div className="h-5 w-px bg-white/8" />
                        <div className="flex flex-wrap items-center gap-2">
                          {[
                            { label: "Steps", value: selectedCampaign.steps.length },
                            { label: "Contatos", value: selectedCampaign.totalRecipients },
                            { label: "Processados", value: selectedCampaign.processedRecipients }
                          ].map((item) => (
                            <div key={item.label} className="rounded-full border border-white/5 bg-white/[0.02] px-3 py-1.5">
                              <span className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">{item.label}</span>
                              <span className="ml-2 text-sm font-bold tracking-tight text-white">{item.value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[1.4rem] border border-white/5 bg-black/20 p-3.5">
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Janela operacional</p>
                      <p className="text-[15px] font-bold tracking-tight text-white">{selectedCampaign.sendWindowStart}h - {selectedCampaign.sendWindowEnd}h</p>
                      <p className="text-xs text-slate-500">{selectedCampaign.rateLimitCount} envios a cada {selectedCampaign.rateLimitWindowMinutes} minutos</p>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        className={cn("h-10 rounded-[1.15rem] px-3.5 text-[13px] font-bold shadow-lg", canActivateCampaign ? "bg-cmm-blue text-white hover:bg-cmm-blue/90" : "bg-white/5 text-slate-500")}
                        disabled={!canActivateCampaign}
                        onClick={() => setPendingCommand({ action: "activate", campaignId: selectedCampaign.id, campaignName: selectedCampaign.name })}
                      >
                        <PlayCircle className="mr-2 h-4 w-4" />
                        Iniciar
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        className={cn("h-10 rounded-[1.15rem] px-3.5 text-[13px] font-bold", canPauseCampaign ? "bg-white/10 text-white hover:bg-white/20" : "bg-white/5 text-slate-500")}
                        disabled={!canPauseCampaign}
                        onClick={() => setPendingCommand({ action: "pause", campaignId: selectedCampaign.id, campaignName: selectedCampaign.name })}
                      >
                        <PauseCircle className="mr-2 h-4 w-4" />
                        Pausar
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        className={cn("h-10 rounded-[1.15rem] px-3.5 text-[13px] font-bold", canCancelCampaign ? "bg-cmm-orange/12 text-cmm-orange hover:bg-cmm-orange/20" : "bg-white/5 text-slate-500")}
                        disabled={!canCancelCampaign}
                        onClick={() => setPendingCommand({ action: "cancel", campaignId: selectedCampaign.id, campaignName: selectedCampaign.name })}
                      >
                        <StopCircle className="mr-2 h-4 w-4" />
                        Cancelar
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-10 rounded-[1.15rem] bg-red-500/12 px-3.5 text-[13px] font-bold text-red-200 hover:bg-red-500/20"
                        onClick={() => setPendingCommand({ action: "delete", campaignId: selectedCampaign.id, campaignName: selectedCampaign.name })}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Excluir
                      </Button>
                    </div>
                  </div>
                </div>

              </div>

              <div className="glass-card overflow-hidden rounded-[2.5rem] border-white/5 bg-white/[0.01]">
                <div className="border-b border-white/5 px-4 bg-white/[0.02]">
                  <ChromeTabs
                    value={activeTab}
                    onChange={setActiveTab}
                    items={[
                      { value: "campaign", label: "Workflow do Builder", badge: editorCampaign?.steps.length ?? selectedCampaign.steps.length },
                      { value: "status", label: "Status de contatos", badge: recipientCounts.all }
                    ]}
                  />
                </div>

                {activeTab === "campaign" ? (
                  <div className="animate-in space-y-9 p-8 fade-in duration-500">
                    <div className="space-y-8">
                      {editorCampaign ? <CampaignBuilder value={editorCampaign} onChange={(next) => setEditorCampaign(normalizeCampaignDraft(next))} /> : null}
                      <div className="flex justify-end border-t border-white/5 pt-5">
                        <Button
                          className="h-12 rounded-2xl bg-cmm-blue px-8 text-sm font-bold shadow-xl shadow-blue-500/20 transition-transform hover:scale-[1.02]"
                          disabled={!editorCampaign?.id || saveExistingMutation.isPending}
                          onClick={() => editorCampaign && saveExistingMutation.mutate(editorCampaign)}
                        >
                          {saveExistingMutation.isPending ? "Processando..." : "PUBLICAR ALTERAÇÕES"}
                        </Button>
                      </div>
                    </div>

                    <div className="border-t border-white/5 pt-12">
                      <div className="flex flex-wrap items-center justify-between gap-6">
                        <div className="space-y-1">
                          <h3 className="font-display text-2xl font-bold text-white tracking-tight">Importação de Base</h3>
                          <p className="text-sm font-medium text-slate-400">Arraste seu arquivo CSV para processar e vincular contatos automaticamente.</p>
                        </div>
                        <label className="group flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-8 py-4 transition-all hover:bg-white/[0.04] hover:border-cmm-blue/50">
                          <Upload className="h-5 w-5 text-slate-500 group-hover:text-cmm-blue transition-colors" />
                          <span className="text-sm font-bold text-slate-300">CARREGAR CSV</span>
                          <input className="hidden" type="file" accept=".csv,text/csv" onChange={handleCsvUpload} />
                        </label>
                      </div>

                      {csvUpload ? (
                        <div className="mt-8 space-y-8 animate-in slide-in-from-top-4 duration-500">
                          <div className="grid gap-4 xl:grid-cols-4">
                            {[
                              { label: "Telefone", value: mapping.phone, key: 'phone' },
                              { label: "Nome", value: mapping.name, key: 'name' },
                              { label: "Instagram", value: mapping.instagram, key: 'instagram' },
                              { label: "Tags", value: mapping.tags, key: 'tags' }
                            ].map((field) => (
                              <div key={field.key} className="space-y-1.5">
                                <label className="ml-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">{field.label}</label>
                                <select
                                  className="w-full h-12 rounded-2xl border border-white/5 bg-white/[0.02] px-4 text-sm font-bold text-slate-300 outline-none transition hover:bg-white/[0.04] focus:border-cmm-blue/30"
                                  value={field.value}
                                  onChange={(event) => setMapping((current) => ({ ...current, [field.key]: event.target.value }))}
                                >
                                  <option value="" className="bg-slate-900">{field.label} (opcional)</option>
                                  {csvUpload.headers.map((header) => (
                                    <option key={header} value={header} className="bg-slate-900">{header}</option>
                                  ))}
                                </select>
                              </div>
                            ))}
                          </div>

                          <div className="flex flex-wrap gap-3">
                            <Badge tone="default" className="bg-white/5 border-white/5 text-[10px] uppercase font-bold tracking-widest px-3 py-1">{csvUpload.totalRows} linhas no arquivo</Badge>
                            <Badge tone="default" className="bg-cmm-blue/10 border-cmm-blue/20 text-cmm-blue text-[10px] uppercase font-bold tracking-widest px-3 py-1">{selectedCampaign.eligibleChannels.join(" + ")}</Badge>
                            {csvValidating ? <Badge tone="info" className="animate-pulse">Validando…</Badge> : null}
                          </div>

                          {csvValidation ? (
                            <div className="space-y-6">
                              <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
                                {[
                                  { label: "Existentes", value: csvValidation.summary.existing, tone: "info" as const },
                                  { label: "Vinculáveis", value: csvValidation.summary.eligible, tone: "warning" as const },
                                  { label: "Novos", value: csvValidation.summary.new_contact, tone: "success" as const },
                                  { label: "Revisar", value: csvValidation.summary.needs_review, tone: "warning" as const },
                                  { label: "Parcial", value: csvValidation.summary.insufficient_link, tone: "warning" as const },
                                  { label: "Inválidos", value: csvValidation.summary.invalid, tone: "danger" as const }
                                ].map((item) => (
                                  <div key={item.label} className="rounded-3xl border border-white/5 bg-white/[0.01] p-5">
                                    <div className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-500">{item.label}</div>
                                    <div className="mt-2 text-2xl font-bold text-white tracking-tighter">{item.value}</div>
                                  </div>
                                ))}
                              </div>

                              <div className="overflow-hidden rounded-3xl border border-white/5 bg-white/[0.01]">
                                <div className="max-h-[30rem] overflow-auto">
                                  <table className="w-full text-left text-sm">
                                    <thead className="sticky top-0 bg-slate-950 border-b border-white/5 text-[10px] font-black uppercase tracking-widest text-slate-500">
                                      <tr>
                                        {csvValidation.headers.map((header) => <th key={header} className="px-6 py-4">{header}</th>)}
                                        <th className="px-6 py-4">Canal</th>
                                        <th className="px-6 py-4 text-right">Status</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/5">
                                      {csvValidation.preview.map((row, index) => (
                                        <tr key={index} className="group hover:bg-white/[0.02] transition-colors">
                                          {csvValidation.headers.map((header) => (
                                            <td key={header} className="px-6 py-4 text-xs font-medium text-slate-300">{previewCellValue(row[header]) || "-"}</td>
                                          ))}
                                          <td className="px-6 py-4 text-xs font-bold text-cmm-blue">{row._resolvedChannel ? formatChannelDisplayValue(row._resolvedChannel, row._resolvedTargetDisplay) : "-"}</td>
                                          <td className="px-6 py-4 text-right">
                                            <Badge tone={previewTone(row._exists)} className="text-[9px] uppercase font-black tracking-widest">{previewLabel(row._exists)}</Badge>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>

                              <div className="flex items-center justify-between gap-6 pt-4">
                                <p className="text-xs font-medium text-slate-500 italic">{importableRecipients} destinatários prontos para importação automática.</p>
                                <Button
                                  variant="secondary"
                                  className="h-12 rounded-2xl bg-white/10 px-8 text-xs font-bold uppercase tracking-widest text-white hover:bg-white/20"
                                  disabled={!canImportRecipients || importRecipientsMutation.isPending}
                                  onClick={() => importRecipientsMutation.mutate({ campaignId: selectedCampaign.id, payload: { uploadId: csvUpload.uploadId, mapping } })}
                                >
                                  {importRecipientsMutation.isPending ? "IMPORTANDO..." : "IMPORTAR E VINCULAR"}
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.01] px-6 py-10 text-center text-xs font-medium text-slate-500 uppercase tracking-widest">
                              Defina o mapeamento acima para ver o preview omnichannel.
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="mt-8 rounded-3xl border border-dashed border-white/5 bg-white/[0.01] px-6 py-12 text-center">
                          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-white/5 text-slate-500">
                            <Upload className="h-8 w-8" />
                          </div>
                          <p className="mt-4 text-xs font-bold text-slate-500 uppercase tracking-widest italic">Nenhum CSV carregado. Arraste ou selecione um arquivo para começar.</p>
                        </div>
                      )}
                    </div>

                    {/* Manual recipient input */}
                    <div className="border-t border-white/5 pt-12">
                      <div className="space-y-1 mb-6">
                        <h3 className="font-display text-2xl font-bold text-white tracking-tight">Adicionar manualmente</h3>
                        <p className="text-sm font-medium text-slate-400">Digite numeros de WhatsApp ou usernames do Instagram, um por linha.</p>
                      </div>
                      <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
                        <div className="space-y-3">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setManualChannel("whatsapp")}
                              className={cn(
                                "flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-bold transition-all",
                                manualChannel === "whatsapp"
                                  ? "border-cmm-emerald/40 bg-cmm-emerald/10 text-cmm-emerald"
                                  : "border-white/10 bg-white/[0.02] text-slate-400 hover:bg-white/[0.04]"
                              )}
                            >
                              <MessageCircleMore className="h-4 w-4" />
                              WhatsApp
                            </button>
                            <button
                              type="button"
                              onClick={() => setManualChannel("instagram")}
                              className={cn(
                                "flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-bold transition-all",
                                manualChannel === "instagram"
                                  ? "border-cmm-orange/40 bg-cmm-orange/10 text-cmm-orange"
                                  : "border-white/10 bg-white/[0.02] text-slate-400 hover:bg-white/[0.04]"
                              )}
                            >
                              <Instagram className="h-4 w-4" />
                              Instagram
                            </button>
                          </div>
                          <Textarea
                            className="min-h-[120px] rounded-2xl border-white/5 bg-white/[0.03] px-4 py-3 text-sm font-mono"
                            placeholder={manualChannel === "whatsapp" ? "5511999998888\n5521988887777\n5531977776666" : "@usuario1\n@usuario2\n@usuario3"}
                            value={manualInput}
                            onChange={(e) => setManualInput(e.target.value)}
                          />
                          <p className="text-[10px] text-slate-500">
                            {manualInput.split("\n").filter((l) => l.trim()).length} {manualChannel === "whatsapp" ? "numeros" : "usernames"} digitados
                          </p>
                        </div>
                        <div className="flex items-end">
                          <Button
                            variant="secondary"
                            className="h-12 rounded-2xl bg-white/10 px-6 text-xs font-bold uppercase tracking-widest text-white hover:bg-white/20"
                            disabled={!manualInput.trim() || !selectedCampaign?.id || addManualMutation.isPending}
                            onClick={() => {
                              if (!selectedCampaign?.id) return;
                              const lines = manualInput.split("\n").map((l) => l.trim()).filter(Boolean);
                              const entries = lines.map((value) => ({ value, channel: manualChannel }));
                              addManualMutation.mutate({ campaignId: selectedCampaign.id, entries });
                            }}
                          >
                            {addManualMutation.isPending ? "ADICIONANDO..." : "ADICIONAR"}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="animate-in fade-in duration-500">
                    <div className="flex flex-wrap items-center gap-2 border-b border-white/5 bg-white/[0.01] p-3.5">
                      {[
                        { key: "all", label: "Geral", count: recipientCounts.all },
                        { key: "sent", label: "Executados", count: recipientCounts.sent },
                        { key: "pending", label: "Pendentes", count: recipientCounts.pending },
                        { key: "failed", label: "Falhas", count: recipientCounts.failed }
                      ].map((item) => (
                        <button
                          key={item.key}
                          onClick={() => setRecipientFilter(item.key)}
                          className={cn(
                            "group flex items-center gap-2 rounded-2xl border px-3 py-1.5 transition-all duration-300",
                            recipientFilter === item.key ? "border-cmm-blue/30 bg-cmm-blue/10 text-white" : "border-white/5 bg-white/[0.02] text-slate-400 hover:bg-white/[0.04]"
                          )}
                        >
                          <span className="text-[10px] font-black uppercase tracking-widest">{item.label}</span>
                          <span className={cn("text-[10px] font-black opacity-40 px-2 py-0.5 rounded-full bg-white/10", recipientFilter === item.key && "bg-cmm-blue text-white opacity-100")}>{item.count}</span>
                        </button>
                      ))}
                    </div>

                    <div className="grid gap-px bg-white/5 xl:grid-cols-[1fr_400px]">
                      <div className="bg-slate-950/40 min-h-[420px]">
                        <div className="max-h-[520px] divide-y divide-white/5 overflow-y-auto custom-scrollbar">
                          {pagedRecipients.map((recipient) => {
                            const isSelected = selectedRecipientId === recipient.id;
                            return (
                              <button
                                key={recipient.id}
                                onClick={() => setSelectedRecipientId(recipient.id)}
                                className={cn(
                                  "group relative flex w-full items-center justify-between px-4 py-3.5 text-left transition-all duration-300",
                                  isSelected ? "bg-cmm-blue/5" : "hover:bg-white/[0.02]"
                                )}
                              >
                                <div className="flex min-w-0 items-center gap-3">
                                  <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl text-sm font-black",
                                    recipient.channel === "instagram" ? "bg-cmm-orange/10 text-cmm-orange" : "bg-cmm-emerald/10 text-cmm-emerald"
                                  )}>
                                    {recipient.name?.charAt(0) || recipient.target_display_value?.charAt(0) || "?"}
                                  </div>
                                  <div className="min-w-0">
                                    <h4 className="truncate font-display text-[15px] font-bold text-white tracking-tight">{recipient.name || "Sem identificação"}</h4>
                                    <p className="mt-0.5 truncate text-[11px] font-bold text-slate-500 uppercase tracking-widest">{formatRecipientTarget(recipient) || "Alvo não determinado"}</p>
                                  </div>
                                </div>
                                <div className="flex shrink-0 flex-col items-end gap-2">
                                  <Badge tone={recipientTone(recipient.status)} className="rounded-full px-2.5 py-0.5 text-[8px] font-black uppercase tracking-widest">
                                    {recipientStatusLabels[recipient.status] ?? recipient.status}
                                  </Badge>
                                  <span className="text-[9px] font-black text-slate-600 uppercase tracking-widest">STEP {Math.max(Number(recipient.step_index), 0) + 1}</span>
                                </div>
                                {isSelected && <div className="absolute left-0 top-1/2 -translate-y-1/2 h-10 w-1 bg-cmm-blue rounded-r-full shadow-[0_0_20px_rgba(59,130,246,0.5)]" />}
                              </button>
                            );
                          })}

                          {filteredRecipients.length === 0 && (
                            <div className="p-20 text-center">
                              <p className="text-xs font-bold text-slate-500 uppercase tracking-widest italic opacity-40">Nenhum contato encontrado no filtro.</p>
                            </div>
                          )}
                        </div>
                        {filteredRecipients.length > 0 ? (
                          <div className="flex items-center justify-between border-t border-white/5 px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-slate-500">
                            <span>
                              Mostrando {(recipientPage - 1) * RECIPIENTS_PER_PAGE + 1}
                              {" - "}
                              {Math.min(recipientPage * RECIPIENTS_PER_PAGE, filteredRecipients.length)}
                              {" de "}
                              {filteredRecipients.length}
                            </span>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setRecipientPage((current) => Math.max(1, current - 1))}
                                disabled={recipientPage === 1}
                                className="rounded-xl border border-white/10 px-3 py-1.5 text-slate-300 transition hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                Anterior
                              </button>
                              <span>Página {recipientPage} de {recipientTotalPages}</span>
                              <button
                                type="button"
                                onClick={() => setRecipientPage((current) => Math.min(recipientTotalPages, current + 1))}
                                disabled={recipientPage === recipientTotalPages}
                                className="rounded-xl border border-white/10 px-3 py-1.5 text-slate-300 transition hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                Próxima
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>

                      <div className="border-l border-white/5 bg-slate-950/60 p-5">
                        <h5 className="mb-4 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Detalhes do contato</h5>
                        {selectedRecipient ? (
                          <div className="animate-in space-y-6 fade-in slide-in-from-right-4 duration-500">
                            <div>
                              <h3 className="font-display text-lg font-bold text-white tracking-tight">{selectedRecipient.name || "Sem Nome"}</h3>
                              <p className="mt-1 text-sm font-medium text-slate-400">{formatRecipientTarget(selectedRecipient)}</p>
                            </div>

                            <div className="grid grid-cols-2 gap-2.5">
                              <div className="rounded-2xl border border-white/5 bg-white/5 p-3.5">
                                <div className="text-[9px] font-black text-slate-600 uppercase tracking-widest">Status</div>
                                <Badge tone={recipientTone(selectedRecipient.status)} className="mt-2 text-[9px] uppercase font-black">{recipientStatusLabels[selectedRecipient.status]}</Badge>
                              </div>
                              <div className="rounded-2xl border border-white/5 bg-white/5 p-3.5">
                                <div className="text-[9px] font-black text-slate-600 uppercase tracking-widest">Step Atual</div>
                                <div className="mt-2 text-lg font-bold text-white tracking-tighter">#{Math.max(Number(selectedRecipient.step_index), 0) + 1}</div>
                              </div>
                            </div>

                            <div className="space-y-3">
                              {[
                                { label: "Última Tentativa", value: formatCampaignDateTime(selectedRecipient.last_attempt_at) },
                                { label: "Próximo Agendamento", value: formatCampaignDateTime(selectedRecipient.next_run_at) },
                                { label: "Canal Ativo", value: selectedRecipient.channel === 'instagram' ? 'Instagram' : 'WhatsApp' }
                              ].map(item => (
                                <div key={item.label} className="flex items-center justify-between border-b border-white/5 py-2">
                                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{item.label}</span>
                                  <span className="text-xs font-bold text-slate-300">{item.value}</span>
                                </div>
                              ))}
                            </div>

                            {selectedRecipient.last_error && (
                              <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-3.5">
                                <div className="text-[9px] font-black text-red-400 uppercase tracking-widest">Último Log de Erro</div>
                                <p className="mt-2 text-[11px] font-medium text-red-200 leading-relaxed">{selectedRecipient.last_error}</p>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="h-full flex flex-col items-center justify-center text-center opacity-30">
                            <div className="h-20 w-20 rounded-full border-2 border-dashed border-white/20 flex items-center justify-center">
                              <Search className="h-8 w-8" />
                            </div>
                            <p className="mt-6 text-[10px] font-bold uppercase tracking-widest">Selecione um contato para ver detalhes</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="glass-card flex flex-col items-center justify-center p-20 text-center rounded-[2.5rem] border-white/5 bg-white/[0.01]">
              <div className="h-24 w-24 rounded-3xl bg-white/5 flex items-center justify-center mb-8">
                <Plus className="h-10 w-10 text-slate-600" />
              </div>
              <h3 className="font-display text-2xl font-bold text-white tracking-tight">Comece sua Campanha</h3>
              <p className="mt-2 text-sm font-medium text-slate-400 max-w-sm">Crie uma nova ou selecione ao lado para gerenciar fluxos e destinatários.</p>
            </div>
          )}
        </div>
      </div>

      {pendingCommand && commandConfig ? (
        <ConfirmActionDialog
          open
          title={commandConfig.title}
          description={commandConfig.description}
          confirmLabel={commandConfig.confirmLabel}
          confirmVariant={commandConfig.confirmVariant}
          pending={commandMutation.isPending}
          onCancel={() => setPendingCommand(null)}
          onConfirm={async () => {
            if (!pendingCommand) {
              return;
            }
            await commandMutation.mutateAsync(pendingCommand);
          }}
        />
      ) : null}

      {/* Workflow Viewer Dialog */}
      <Dialog open={Boolean(viewerCampaignId)} onOpenChange={(open) => !open && setViewerCampaignId(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-[#0c0c0e] border-white/10">
          <DialogTitle className="sr-only">Visualizador de Workflow</DialogTitle>
          <DialogDescription className="sr-only">Fluxo visual da campanha com estatisticas por etapa</DialogDescription>
          {viewerCampaign && (
            <WorkflowViewer
              campaignId={viewerCampaign.id}
              steps={viewerCampaign.steps as unknown as import("@/lib/campaign-utils").CampaignStepDraft[]}
              campaignName={viewerCampaign.name}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
