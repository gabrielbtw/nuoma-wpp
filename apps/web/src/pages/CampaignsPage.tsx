import { useMemo, useState } from "react";
import { Animate, Button, Tabs, TabsContent, TabsList, TabsTrigger, useToast } from "@nuoma/ui";

import { ConfirmDangerAction } from "../components/ConfirmDangerAction.js";
import {
  campaignSearchFromWindow,
  parseCampaignSearch,
  type CampaignTab,
} from "../campaigns/campaign-search.js";
import type { RouterInput, RouterOutput } from "../lib/api-types.js";
import { COPY } from "../lib/copy.js";
import { trpc } from "../lib/trpc.js";
import { CampaignFlowBuilder } from "../flow-builder/FlowBuilder.js";
import { CampaignsDispatchPanel } from "../campaigns/CampaignsDispatchPanel.js";
import { CampaignsOverviewPanel } from "../campaigns/CampaignsOverviewPanel.js";
import {
  CampaignsRecipientsPanel,
  isCampaignOverlayEnabled,
} from "../campaigns/CampaignsRecipientsPanel.js";

type CampaignTickResult = RouterOutput["campaigns"]["tick"];
type RemarketingBatchInput = RouterInput["campaigns"]["remarketingBatchReady"];
type RemarketingBatchDispatchResult = RouterOutput["campaigns"]["remarketingBatchDispatch"];
type CampaignListItem = RouterOutput["campaigns"]["list"]["campaigns"][number];
export function CampaignsPage() {
  const campaigns = trpc.campaigns.list.useQuery();
  const utils = trpc.useUtils();
  const [lastTick, setLastTick] = useState<CampaignTickResult | null>(null);
  const [lastBatchDispatch, setLastBatchDispatch] = useState<RemarketingBatchDispatchResult | null>(
    null,
  );
  const [safeCampaignId, setSafeCampaignId] = useState<string>(() => {
    const campaignId = campaignSearchFromWindow().campaignId;
    return campaignId ? String(campaignId) : "";
  });
  const [safeConfirm, setSafeConfirm] = useState("");
  const [safeBatchPhones, setSafeBatchPhones] = useState("");
  const [safeBatchAllowedPhone, setSafeBatchAllowedPhone] = useState("");
  const [safeBatchAllowedInstagram, setSafeBatchAllowedInstagram] = useState("");
  const [safeBatchConfirm, setSafeBatchConfirm] = useState("");
  const [globalTickConfirm, setGlobalTickConfirm] = useState("");
  const [batchReadyKey, setBatchReadyKey] = useState<string | null>(null);
  const toast = useToast();
  const intent = usePageIntent();
  const [activeTab, setActiveTab] = useState<CampaignTab>(() => campaignSearchFromWindow().tab);
  const builderImmersive = activeTab === "builder";
  const selectedSafeCampaignId = useMemo(() => {
    const parsed = Number(safeCampaignId);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
    return null;
  }, [safeCampaignId]);
  const selectedSafeCampaign = useMemo(
    () =>
      campaigns.data?.campaigns.find((campaign) => campaign.id === selectedSafeCampaignId) ?? null,
    [campaigns.data?.campaigns, selectedSafeCampaignId],
  );
  const currentBatchInput = useMemo(
    () =>
      selectedSafeCampaignId
        ? remarketingBatchInput({
            campaignId: selectedSafeCampaignId,
            channel: selectedSafeCampaign?.channel ?? "whatsapp",
            recipients: safeBatchPhones,
            allowedPhone: safeBatchAllowedPhone,
            allowedInstagram: safeBatchAllowedInstagram,
          })
        : null,
    [
      selectedSafeCampaignId,
      selectedSafeCampaign?.channel,
      safeBatchPhones,
      safeBatchAllowedPhone,
      safeBatchAllowedInstagram,
    ],
  );
  const currentBatchKey = currentBatchInput ? remarketingBatchRequestKey(currentBatchInput) : null;
  const readiness = trpc.campaigns.ready.useQuery(
    { campaignId: selectedSafeCampaignId ?? 1 },
    {
      enabled: false,
      retry: false,
    },
  );
  const batchReady = trpc.campaigns.remarketingBatchReady.useMutation({
    onSuccess(result, variables) {
      setBatchReadyKey(remarketingBatchRequestKey(variables));
      setSafeBatchConfirm("");
      toast.push({
        title: result.canDispatch ? "Lote pronto" : "Lote bloqueado",
        description: result.canDispatch
          ? `${result.summary.acceptedRecipients} destinatário(s), ${result.summary.plannedJobs} job(s) previstos.`
          : `${result.issues.filter((issue) => issue.severity === "error").length} bloqueio(s) no lote.`,
        variant: result.canDispatch ? "success" : "warning",
      });
    },
    onError(error) {
      toast.push({ title: "Falha ao validar lote", description: error.message, variant: "danger" });
    },
  });
  const currentBatchReady =
    batchReadyKey && currentBatchKey === batchReadyKey ? (batchReady.data ?? null) : null;
  const batchDispatch = trpc.campaigns.remarketingBatchDispatch.useMutation({
    async onSuccess(result) {
      setLastBatchDispatch(result);
      setBatchReadyKey(null);
      setSafeBatchConfirm("");
      await utils.campaigns.list.invalidate();
      toast.push({
        title: "Lote enfileirado",
        description: `${result.recipientsCreated} destinatário(s), ${result.scheduler.jobsCreated} job(s) criados.`,
        variant: "success",
      });
    },
    onError(error) {
      toast.push({ title: "Falha no lote real", description: error.message, variant: "danger" });
    },
  });
  const tick = trpc.campaigns.tick.useMutation({
    onSuccess(result) {
      setLastTick(result);
      void utils.campaigns.list.invalidate();
      toast.push({
        title: result.dryRun ? "Simulação calculada" : "Jobs criados",
        description: result.dryRun
          ? `${result.plannedJobs.length} job(s) seriam criados`
          : `${result.jobsCreated} job(s), ${result.recipientsCompleted} concluído(s), ${result.recipientsSkipped} pulado(s)`,
        variant: "success",
      });
    },
    onError(error) {
      toast.push({ title: "Falha no tick", description: error.message, variant: "danger" });
    },
  });
  const pauseCampaign = trpc.campaigns.pause.useMutation({
    async onSuccess(result) {
      await utils.campaigns.list.invalidate();
      toast.push({
        title: "Campanha pausada",
        description: result.campaign
          ? `${result.campaign.name} não será enfileirada até ser retomada.`
          : "Campanha atualizada.",
        variant: "success",
      });
    },
    onError(error) {
      toast.push({ title: "Falha ao pausar", description: error.message, variant: "danger" });
    },
  });
  const resumeCampaign = trpc.campaigns.resume.useMutation({
    async onSuccess(result) {
      await utils.campaigns.list.invalidate();
      toast.push({
        title: "Campanha retomada",
        description: result.campaign
          ? `${result.campaign.name} voltou para ${result.campaign.status}.`
          : "Campanha atualizada.",
        variant: "success",
      });
    },
    onError(error) {
      toast.push({ title: "Falha ao retomar", description: error.message, variant: "danger" });
    },
  });
  const updateCampaign = trpc.campaigns.update.useMutation({
    async onSuccess(result) {
      await utils.campaigns.list.invalidate();
      const enabled = isCampaignOverlayEnabled(result.campaign?.metadata ?? {});
      toast.push({
        title: enabled ? "Overlay liberado" : "Overlay removido",
        description: result.campaign
          ? `${result.campaign.name}: overlay ${enabled ? "sim" : "não"}.`
          : "Campanha atualizada.",
        variant: enabled ? "success" : "info",
      });
    },
    onError(error) {
      toast.push({
        title: "Falha ao atualizar overlay",
        description: error.message,
        variant: "danger",
      });
    },
  });

  const isGlobalTickPending = (dryRun: boolean) =>
    tick.isPending &&
    tick.variables?.campaignId === undefined &&
    (tick.variables?.dryRun ?? false) === dryRun;
  const isCampaignTickPending = (campaignId: number, dryRun: boolean) =>
    tick.isPending &&
    tick.variables?.campaignId === campaignId &&
    (tick.variables?.dryRun ?? false) === dryRun;
  const runSafeReady = async () => {
    if (!selectedSafeCampaignId) return;
    const result = await readiness.refetch();
    setSafeConfirm("");
    if (result.data) {
      toast.push({
        title: result.data.canEnqueue ? "Campanha pronta" : "Campanha bloqueada",
        description: result.data.canEnqueue
          ? `${result.data.summary.plannedJobs} job(s) prontos com guardrails aprovados.`
          : `${result.data.issues.filter((issue) => issue.severity === "error").length} bloqueio(s) encontrados.`,
        variant: result.data.canEnqueue ? "success" : "warning",
      });
    }
  };
  const runSafeEnqueue = () => {
    if (!selectedSafeCampaignId || !readiness.data?.canEnqueue) return;
    tick.mutate({
      dryRun: false,
      campaignId: selectedSafeCampaignId,
      confirmText: safeConfirm,
    });
    setSafeConfirm("");
  };
  const runConfirmedTick = (input: { campaignId?: number; label: string; confirmText: string }) => {
    if (!input.campaignId) {
      toast.push({
        title: "Selecione uma campanha",
        description: "Disparo real agora exige Campanha pronta por campanha.",
        variant: "warning",
      });
      return;
    }
    if (input.confirmText !== "DISPARAR") {
      toast.push({
        title: "Enfileiramento cancelado",
        description: "Confirmação textual obrigatória não foi preenchida.",
        variant: "warning",
      });
      return;
    }
    tick.mutate({ dryRun: false, campaignId: input.campaignId, confirmText: input.confirmText });
    setGlobalTickConfirm("");
  };
  const toggleCampaignOverlay = (campaign: CampaignListItem) => {
    const enabled = !isCampaignOverlayEnabled(campaign.metadata);
    updateCampaign.mutate({
      id: campaign.id,
      metadata: {
        ...campaign.metadata,
        overlayEnabled: enabled,
      },
    });
  };
  const runBatchReady = () => {
    if (!currentBatchInput) return;
    batchReady.mutate(currentBatchInput);
  };
  const runBatchDispatch = () => {
    if (!currentBatchInput || !currentBatchReady?.canDispatch) return;
    if (currentBatchKey !== batchReadyKey) {
      toast.push({
        title: "Revalide o lote",
        description: "O alvo, campanha ou allowlist mudou depois da última validação.",
        variant: "warning",
      });
      return;
    }
    batchDispatch.mutate({
      ...currentBatchInput,
      confirmText: safeBatchConfirm,
    });
  };
  const openCampaignTab = (tab: CampaignTab, campaignId?: number) => {
    if (campaignId) {
      setSafeCampaignId(String(campaignId));
      setSafeConfirm("");
      setGlobalTickConfirm("");
      setSafeBatchConfirm("");
      setBatchReadyKey(null);
    }
    setActiveTab(tab);
  };

  if (builderImmersive) {
    return (
      <div className="nuoma-campaign-immersive">
        <CampaignFlowBuilder onOpenCampaignTab={openCampaignTab} />
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-6.5rem)] w-full max-w-none flex-col gap-4 pt-0">
      <Animate preset="rise-in">
        <header className="nuoma-workspace-header flex items-center justify-between gap-6">
          <div>
            <p className="nuoma-compat-kicker">Campanhas</p>
            <h1 className="nuoma-compat-display mt-1 text-3xl md:text-4xl">
              Outbound <span className="nuoma-gradient-text">operacional</span>.
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-fg-muted">
              Builder, disparo, destinatários e auditoria em uma superfície compacta com guardrails
              fortes por canal.
            </p>
            {selectedSafeCampaign ? (
              <p className="mt-2 font-mono text-[0.68rem] uppercase tracking-widest text-fg-dim">
                Selecionada: {selectedSafeCampaign.name} · {selectedSafeCampaign.channel} ·{" "}
                {campaignStatusLabel(selectedSafeCampaign.status)}
              </p>
            ) : (
              <p className="mt-2 font-mono text-[0.68rem] uppercase tracking-widest text-semantic-warning">
                Selecione uma campanha para simular ou disparar.
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="soft"
              size="sm"
              loading={
                selectedSafeCampaignId
                  ? isCampaignTickPending(selectedSafeCampaignId, true)
                  : isGlobalTickPending(true)
              }
              disabled={!selectedSafeCampaignId}
              onClick={() => {
                if (!selectedSafeCampaignId) return;
                tick.mutate({ dryRun: true, campaignId: selectedSafeCampaignId });
              }}
            >
              Simular selecionada
            </Button>
            <ConfirmDangerAction
              buttonLabel={`${COPY.disparar} selecionada`}
              confirmText="DISPARAR"
              value={globalTickConfirm}
              onValueChange={setGlobalTickConfirm}
              loading={isGlobalTickPending(false)}
              disabled={!selectedSafeCampaignId}
              onConfirm={() =>
                runConfirmedTick({
                  campaignId: selectedSafeCampaignId ?? undefined,
                  label: selectedSafeCampaign?.name ?? "campanha selecionada",
                  confirmText: globalTickConfirm,
                })
              }
              description={
                selectedSafeCampaign
                  ? `Criará Jobs reais para ${selectedSafeCampaign.name}.`
                  : "Disparo real exige campanha selecionada e texto de confirmação."
              }
              testId="campaign-global-dispatch-confirm"
            />
          </div>
        </header>
      </Animate>

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as CampaignTab)}
        className="flex flex-col gap-4"
      >
        <TabsList className="nuoma-campaign-tabs">
          <TabsTrigger value="overview" data-testid="campaign-tab-overview">
            Visão geral
          </TabsTrigger>
          <TabsTrigger value="builder" data-testid="campaign-tab-builder">
            Builder
          </TabsTrigger>
          <TabsTrigger value="dispatch" data-testid="campaign-tab-dispatch">
            Disparo
          </TabsTrigger>
          <TabsTrigger value="recipients" data-testid="campaign-tab-recipients">
            Destinatários
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <CampaignsOverviewPanel
            campaigns={campaigns.data?.campaigns ?? []}
            loading={campaigns.isLoading}
            error={campaigns.error?.message ?? null}
            lastTick={lastTick}
          />
        </TabsContent>

        <TabsContent value="dispatch" className="space-y-4">
          <CampaignsDispatchPanel
            campaigns={campaigns.data?.campaigns ?? []}
            selectedCampaignId={selectedSafeCampaignId}
            selectedValue={safeCampaignId}
            onSelect={setSafeCampaignId}
            confirmation={safeConfirm}
            onConfirmationChange={setSafeConfirm}
            readiness={readiness.data ?? null}
            loadingReady={readiness.isFetching}
            readyError={readiness.error?.message ?? null}
            batchPhones={safeBatchPhones}
            onBatchPhonesChange={setSafeBatchPhones}
            batchAllowedPhone={safeBatchAllowedPhone}
            onBatchAllowedPhoneChange={setSafeBatchAllowedPhone}
            batchAllowedInstagram={safeBatchAllowedInstagram}
            onBatchAllowedInstagramChange={setSafeBatchAllowedInstagram}
            batchConfirmation={safeBatchConfirm}
            onBatchConfirmationChange={setSafeBatchConfirm}
            batchReady={currentBatchReady}
            batchReadyPending={batchReady.isPending}
            batchReadyError={batchReady.error?.message ?? null}
            batchDispatchPending={batchDispatch.isPending}
            lastBatchDispatch={lastBatchDispatch}
            enqueuePending={
              selectedSafeCampaignId ? isCampaignTickPending(selectedSafeCampaignId, false) : false
            }
            intent={intent}
            lastTick={lastTick}
            globalPreviewPending={isGlobalTickPending(true)}
            globalEnqueuePending={isGlobalTickPending(false)}
            globalEnqueueConfirmation={globalTickConfirm}
            onGlobalEnqueueConfirmationChange={setGlobalTickConfirm}
            onReady={runSafeReady}
            onEnqueue={runSafeEnqueue}
            onBatchReady={runBatchReady}
            onBatchDispatch={runBatchDispatch}
            onGlobalPreview={() => {
              if (!selectedSafeCampaignId) return;
              tick.mutate({ dryRun: true, campaignId: selectedSafeCampaignId });
            }}
            onGlobalEnqueue={() =>
              runConfirmedTick({
                campaignId: selectedSafeCampaignId ?? undefined,
                label: selectedSafeCampaign?.name ?? "campanha selecionada",
                confirmText: globalTickConfirm,
              })
            }
          />
        </TabsContent>

        <TabsContent value="builder" className="space-y-4">
          <Animate preset="rise-in" delaySeconds={0.1}>
            <CampaignFlowBuilder />
          </Animate>
        </TabsContent>

        <TabsContent value="recipients" className="space-y-4">
          <Animate preset="rise-in" delaySeconds={0.1}>
            <CampaignsRecipientsPanel
              campaigns={campaigns.data?.campaigns ?? []}
              loading={campaigns.isLoading}
              error={campaigns.error?.message ?? null}
              onPause={(campaignId) =>
                pauseCampaign.mutate({
                  id: campaignId,
                  reason: "manual_pause_v2.10.9",
                })
              }
              onResume={(campaignId) => resumeCampaign.mutate({ id: campaignId })}
              onToggleOverlay={toggleCampaignOverlay}
              onPreview={(campaignId) => tick.mutate({ dryRun: true, campaignId })}
              onEnqueue={(campaignId, label, confirmText) =>
                runConfirmedTick({ campaignId, label, confirmText })
              }
              isPausePending={(campaignId) =>
                pauseCampaign.isPending && pauseCampaign.variables?.id === campaignId
              }
              isResumePending={(campaignId) =>
                resumeCampaign.isPending && resumeCampaign.variables?.id === campaignId
              }
              isOverlayPending={(campaignId) =>
                updateCampaign.isPending && updateCampaign.variables?.id === campaignId
              }
              isPreviewPending={(campaignId) => isCampaignTickPending(campaignId, true)}
              isEnqueuePending={(campaignId) => isCampaignTickPending(campaignId, false)}
            />
          </Animate>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function campaignStatusLabel(status: string): string {
  if (status === "running") return "em execução";
  if (status === "scheduled") return "agendada";
  if (status === "paused") return "pausada";
  if (status === "draft") return "rascunho";
  if (status === "completed") return "concluída";
  if (status === "cancelled") return "cancelada";
  return status;
}

function usePageIntent() {
  return useMemo(() => {
    if (typeof window === "undefined") return null;
    return parseCampaignSearch(window.location.search).intent;
  }, []);
}

function remarketingBatchInput(input: {
  campaignId: number;
  channel: CampaignListItem["channel"];
  recipients: string;
  allowedPhone: string;
  allowedInstagram: string;
}): RemarketingBatchInput {
  const base = {
    campaignId: input.campaignId,
    rawPhones: "",
    phones: [],
    rawInstagramHandles: "",
    instagramHandles: [],
    contactIds: [],
    maxRecipients: 100,
  };
  if (input.channel === "instagram") {
    return {
      ...base,
      rawInstagramHandles: input.recipients,
      allowedInstagramHandle: input.allowedInstagram.trim() || undefined,
    };
  }
  return {
    ...base,
    rawPhones: input.recipients,
    allowedPhone: input.allowedPhone.trim() || undefined,
  };
}

function remarketingBatchRequestKey(input: RemarketingBatchInput): string {
  return JSON.stringify({
    campaignId: input.campaignId,
    rawPhones: normalizeBatchKeyText(input.rawPhones),
    phones: [...(input.phones ?? [])].map(normalizeBatchKeyText).sort(),
    rawInstagramHandles: normalizeBatchKeyText(input.rawInstagramHandles),
    instagramHandles: [...(input.instagramHandles ?? [])].map(normalizeBatchKeyText).sort(),
    contactIds: [...(input.contactIds ?? [])].sort((a, b) => a - b),
    allowedPhone: normalizeBatchKeyText(input.allowedPhone),
    allowedInstagramHandle: normalizeBatchKeyText(input.allowedInstagramHandle),
    maxRecipients: input.maxRecipients ?? 100,
  });
}

function normalizeBatchKeyText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim()
    .toLowerCase();
}
