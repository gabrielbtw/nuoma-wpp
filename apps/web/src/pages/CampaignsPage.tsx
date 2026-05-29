import { useMemo, useState } from "react";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";

import type { AppRouter } from "@nuoma/api";
import {
  Animate,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  LoadingState,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useToast,
} from "@nuoma/ui";

import { trpc } from "../lib/trpc.js";
import { CampaignFlowBuilder } from "../flow-builder/FlowBuilder.js";
import { CampaignsOverviewPanel } from "../campaigns/CampaignsOverviewPanel.js";
import { SafeRemarketingConsole } from "../campaigns/SafeRemarketingConsole.js";
import {
  CampaignAbVariantsPanel,
  CampaignEvergreenPanel,
  CampaignMetric,
  CampaignPauseResumePanel,
  CampaignRecipientsVirtualTable,
  CampaignStepStatsPanel,
  Metric,
  evergreenEvaluationSummary,
  formatDuration,
  pauseResumeSummary,
} from "../campaigns/CampaignOperationalPanels.js";

type CampaignTickResult = inferRouterOutputs<AppRouter>["campaigns"]["tick"];
type RemarketingBatchInput = inferRouterInputs<AppRouter>["campaigns"]["remarketingBatchReady"];
type RemarketingBatchDispatchResult =
  inferRouterOutputs<AppRouter>["campaigns"]["remarketingBatchDispatch"];
type CampaignListItem = inferRouterOutputs<AppRouter>["campaigns"]["list"]["campaigns"][number];
type CampaignTab = "overview" | "builder" | "dispatch" | "recipients";

export function CampaignsPage() {
  const campaigns = trpc.campaigns.list.useQuery();
  const utils = trpc.useUtils();
  const [lastTick, setLastTick] = useState<CampaignTickResult | null>(null);
  const [lastBatchDispatch, setLastBatchDispatch] = useState<RemarketingBatchDispatchResult | null>(
    null,
  );
  const [safeCampaignId, setSafeCampaignId] = useState<string>(() => initialCampaignIdFromUrl());
  const [safeConfirm, setSafeConfirm] = useState("");
  const [safeBatchPhones, setSafeBatchPhones] = useState("");
  const [safeBatchAllowedPhone, setSafeBatchAllowedPhone] = useState("5531982066263");
  const [safeBatchAllowedInstagram, setSafeBatchAllowedInstagram] = useState("gabriell_braga");
  const [safeBatchConfirm, setSafeBatchConfirm] = useState("");
  const [batchReadyKey, setBatchReadyKey] = useState<string | null>(null);
  const toast = useToast();
  const intent = usePageIntent();
  const [activeTab, setActiveTab] = useState<CampaignTab>(initialCampaignTabFromUrl(intent));
  const builderImmersive = activeTab === "builder";
  const selectedSafeCampaignId = useMemo(() => {
    const parsed = Number(safeCampaignId);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
    return campaigns.data?.campaigns[0]?.id ?? null;
  }, [campaigns.data?.campaigns, safeCampaignId]);
  const selectedSafeCampaign = useMemo(
    () =>
      campaigns.data?.campaigns.find((campaign) => campaign.id === selectedSafeCampaignId) ??
      campaigns.data?.campaigns[0] ??
      null,
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
          ? `${result.summary.acceptedRecipients} recipient(s), ${result.summary.plannedJobs} job(s) previstos.`
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
        description: `${result.recipientsCreated} recipient(s), ${result.scheduler.jobsCreated} job(s) criados.`,
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
        title: result.dryRun ? "Prévia calculada" : "Tick executado",
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
      const enabled = isOverlayEnabled(result.campaign?.metadata ?? {});
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
  const runConfirmedTick = (input: { campaignId?: number; label: string }) => {
    if (!input.campaignId) {
      toast.push({
        title: "Selecione uma campanha",
        description: "Disparo real agora exige Campanha pronta por campanha.",
        variant: "warning",
      });
      return;
    }
    const confirmation = window.prompt(`Digite DISPARAR para enfileirar ${input.label}.`);
    if (confirmation !== "DISPARAR") {
      toast.push({
        title: "Enfileiramento cancelado",
        description: "Confirmação textual obrigatória não foi preenchida.",
        variant: "warning",
      });
      return;
    }
    tick.mutate({ dryRun: false, campaignId: input.campaignId, confirmText: confirmation });
  };
  const toggleCampaignOverlay = (campaign: CampaignListItem) => {
    const enabled = !isOverlayEnabled(campaign.metadata);
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

  if (builderImmersive) {
    return (
      <div className="nuoma-campaign-immersive">
        <CampaignFlowBuilder onOpenCampaignTab={setActiveTab} />
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-6.5rem)] w-full max-w-none flex-col gap-4 pt-0">
      <Animate preset="rise-in">
        <header className="nuoma-workspace-header flex items-center justify-between gap-6">
          <div>
            <p className="botforge-kicker">Campanhas</p>
            <h1 className="botforge-display mt-1 text-3xl md:text-4xl">
              Outbound <span className="nuoma-gradient-text">operacional</span>.
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-fg-muted">
              Builder, disparo, recipients e auditoria em uma superfície compacta com guardrails
              fortes por canal.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="soft"
              size="sm"
              loading={isGlobalTickPending(true)}
              onClick={() => tick.mutate({ dryRun: true })}
            >
              Prévia
            </Button>
            <Button
              variant="soft"
              size="sm"
              loading={isGlobalTickPending(false)}
              onClick={() => runConfirmedTick({ label: "todas as campanhas elegíveis" })}
            >
              Enfileirar
            </Button>
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
            Recipients
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
          <SafeRemarketingConsole
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
            onReady={runSafeReady}
            onEnqueue={runSafeEnqueue}
            onBatchReady={runBatchReady}
            onBatchDispatch={runBatchDispatch}
          />

          {intent === "enqueue" && (
            <Animate preset="rise-in" delaySeconds={0.08}>
              <Card>
                <CardHeader>
                  <CardTitle>Preparar disparo</CardTitle>
                  <CardDescription>
                    A paleta abriu este fluxo em modo seguro. Use prévia antes de enfileirar.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-3">
                  <Button
                    variant="accent"
                    loading={isGlobalTickPending(true)}
                    onClick={() => tick.mutate({ dryRun: true })}
                  >
                    Rodar prévia
                  </Button>
                  <Button
                    variant="soft"
                    loading={isGlobalTickPending(false)}
                    onClick={() => runConfirmedTick({ label: "campanhas elegíveis" })}
                  >
                    Enfileirar elegíveis
                  </Button>
                </CardContent>
              </Card>
            </Animate>
          )}

          {lastTick && (
            <Animate preset="rise-in" delaySeconds={0.08}>
              <Card>
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle>Último tick</CardTitle>
                      <CardDescription>
                        {lastTick.dryRun
                          ? `${lastTick.plannedJobs.length} job(s) planejado(s), sem alterar fila`
                          : `${lastTick.jobsCreated} job(s) criado(s)`}
                      </CardDescription>
                    </div>
                    <Badge variant={lastTick.dryRun ? "warning" : "success"}>
                      {lastTick.dryRun ? "prévia" : "enfileirado"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-3 md:grid-cols-5">
                    <Metric label="Campanhas" value={lastTick.campaignsScanned} />
                    <Metric label="Recipients" value={lastTick.recipientsScanned} />
                    <Metric
                      label="Jobs"
                      value={lastTick.jobsCreated || lastTick.plannedJobs.length}
                    />
                    <Metric
                      label="Evergreen"
                      value={
                        lastTick.evergreenRecipientsCreated || lastTick.evergreenRecipientsPlanned
                      }
                    />
                    <Metric label="Pulados" value={lastTick.recipientsSkipped} />
                  </div>
                  {lastTick.evergreenCampaignsScanned > 0 && (
                    <div
                      className="mt-4 grid gap-2 rounded-lg bg-bg-base p-3 shadow-pressed-sm sm:grid-cols-4"
                      data-testid="campaign-evergreen-last-tick"
                      data-planned={lastTick.evergreenRecipientsPlanned}
                      data-created={lastTick.evergreenRecipientsCreated}
                    >
                      <CampaignMetric
                        label="evergreen campanhas"
                        value={lastTick.evergreenCampaignsScanned}
                      />
                      <CampaignMetric
                        label="contatos lidos"
                        value={lastTick.evergreenContactsScanned}
                      />
                      <CampaignMetric
                        label="planejados"
                        value={lastTick.evergreenRecipientsPlanned}
                      />
                      <CampaignMetric label="criados" value={lastTick.evergreenRecipientsCreated} />
                    </div>
                  )}
                  {lastTick.plannedJobs.length > 0 && (
                    <ul className="mt-4 flex flex-col gap-1">
                      {lastTick.plannedJobs.map((job) => (
                        <li
                          key={`${job.campaignId}-${job.recipientId}-${job.stepId}`}
                          className="grid gap-2 rounded-lg bg-bg-base px-3 py-2.5 text-xs shadow-flat md:grid-cols-[1fr_auto_auto]"
                        >
                          <div className="min-w-0">
                            <span className="font-mono text-fg-dim">
                              #{job.campaignId}/{job.recipientId}
                            </span>{" "}
                            <span className="text-fg-primary">{job.stepId}</span>
                            {job.variantId && (
                              <span className="ml-2 inline-flex rounded-full bg-brand-violet/15 px-2 py-0.5 font-mono text-[0.65rem] text-brand-violet">
                                A/B {job.variantLabel ?? job.variantId}
                              </span>
                            )}
                          </div>
                          <span className="font-mono text-fg-muted">{job.phone}</span>
                          <span className="font-mono text-fg-muted">{job.scheduledAt}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {lastTick.errors.length > 0 && (
                    <ul className="mt-4 flex flex-col gap-1">
                      {lastTick.errors.map((error) => (
                        <li
                          key={`${error.recipientId}-${error.error}`}
                          className="text-xs text-semantic-danger"
                        >
                          #{error.recipientId}: {error.error}
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </Animate>
          )}
        </TabsContent>

        <TabsContent value="builder" className="space-y-4">
          <Animate preset="rise-in" delaySeconds={0.1}>
            <CampaignFlowBuilder />
          </Animate>
        </TabsContent>

        <TabsContent value="recipients" className="space-y-4">
          <Animate preset="rise-in" delaySeconds={0.1}>
            <Card>
              <CardHeader>
                <CardTitle>Existentes</CardTitle>
                <CardDescription>
                  {campaigns.data ? `${campaigns.data.campaigns.length} campanhas` : "—"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {campaigns.isLoading ? (
                  <LoadingState />
                ) : campaigns.error ? (
                  <ErrorState description={campaigns.error.message} />
                ) : !campaigns.data || campaigns.data.campaigns.length === 0 ? (
                  <EmptyState
                    title="Nenhuma campanha"
                    description="Crie um rascunho no builder acima."
                  />
                ) : (
                  <ul className="flex flex-col gap-1">
                    {campaigns.data.campaigns.map((c) => (
                      <li
                        key={c.id}
                        className="rounded-lg px-3 py-3 transition-shadow hover:bg-bg-base hover:shadow-flat"
                        data-testid="campaign-list-item"
                        data-campaign-id={c.id}
                        data-campaign-status={c.status}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm">{c.name}</div>
                            <div className="font-mono text-xs text-fg-dim">
                              {c.steps.length} step(s) · {c.recipients.length} recipient(s)
                            </div>
                          </div>
                          <div className="flex shrink-0 flex-wrap justify-end gap-1">
                            {c.evergreen && <Badge variant="cyan">evergreen</Badge>}
                            <Badge variant={isOverlayEnabled(c.metadata) ? "success" : "neutral"}>
                              overlay {isOverlayEnabled(c.metadata) ? "sim" : "não"}
                            </Badge>
                            <Badge variant={c.status === "running" ? "success" : "neutral"}>
                              {c.status}
                            </Badge>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                          {isPausableCampaign(c.status) && (
                            <Button
                              variant="ghost"
                              size="xs"
                              data-testid="campaign-pause-button"
                              data-campaign-id={c.id}
                              loading={
                                pauseCampaign.isPending && pauseCampaign.variables?.id === c.id
                              }
                              onClick={() =>
                                pauseCampaign.mutate({
                                  id: c.id,
                                  reason: "manual_pause_v2.10.9",
                                })
                              }
                            >
                              Pausar
                            </Button>
                          )}
                          {isResumableCampaign(c.status) && (
                            <Button
                              variant="accent"
                              size="xs"
                              data-testid="campaign-resume-button"
                              data-campaign-id={c.id}
                              loading={
                                resumeCampaign.isPending && resumeCampaign.variables?.id === c.id
                              }
                              onClick={() => resumeCampaign.mutate({ id: c.id })}
                            >
                              Retomar
                            </Button>
                          )}
                          <Button
                            variant={isOverlayEnabled(c.metadata) ? "soft" : "accent"}
                            size="xs"
                            data-testid="campaign-overlay-toggle"
                            data-campaign-id={c.id}
                            loading={
                              updateCampaign.isPending && updateCampaign.variables?.id === c.id
                            }
                            onClick={() => toggleCampaignOverlay(c)}
                          >
                            Overlay {isOverlayEnabled(c.metadata) ? "não" : "sim"}
                          </Button>
                          <Button
                            variant="soft"
                            size="xs"
                            data-testid="campaign-preview-button"
                            data-campaign-id={c.id}
                            loading={isCampaignTickPending(c.id, true)}
                            onClick={() => tick.mutate({ dryRun: true, campaignId: c.id })}
                          >
                            Prévia
                          </Button>
                          <Button
                            variant="soft"
                            size="xs"
                            data-testid="campaign-enqueue-button"
                            data-campaign-id={c.id}
                            disabled={!isPausableCampaign(c.status)}
                            loading={isCampaignTickPending(c.id, false)}
                            onClick={() => runConfirmedTick({ campaignId: c.id, label: c.name })}
                          >
                            Enfileirar
                          </Button>
                        </div>
                        <CampaignPauseResumePanel
                          campaignId={c.id}
                          summary={pauseResumeSummary(c.metadata)}
                        />
                        <div className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
                          <CampaignMetric label="eventos" value={c.metrics.timelineEvents} />
                          <CampaignMetric label="ok" value={c.metrics.completedSteps} />
                          <CampaignMetric label="falhas" value={c.metrics.failedSteps} />
                          <CampaignMetric label="navegou" value={c.metrics.navigatedSteps} />
                          <CampaignMetric label="reuso" value={c.metrics.reusedOpenChatSteps} />
                          <CampaignMetric
                            label="tempo"
                            value={formatDuration(c.metrics.durationSeconds)}
                          />
                        </div>
                        {c.stepStats.length > 0 && (
                          <CampaignStepStatsPanel campaignId={c.id} stats={c.stepStats} />
                        )}
                        {c.abTest && (
                          <CampaignAbVariantsPanel campaignId={c.id} abTest={c.abTest} />
                        )}
                        {c.evergreen && (
                          <CampaignEvergreenPanel
                            campaignId={c.id}
                            summary={evergreenEvaluationSummary(c.metadata)}
                          />
                        )}
                        {c.recipients.length > 0 && (
                          <CampaignRecipientsVirtualTable
                            campaignId={c.id}
                            recipients={c.recipients}
                          />
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </Animate>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function usePageIntent() {
  return useMemo(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("intent");
  }, []);
}

function isOverlayEnabled(metadata: Record<string, unknown>): boolean {
  return metadata.overlayEnabled === true;
}

function initialCampaignIdFromUrl() {
  if (typeof window === "undefined") return "";
  const value = new URLSearchParams(window.location.search).get("campaignId");
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? String(parsed) : "";
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

function initialCampaignTabFromUrl(intent: string | null): CampaignTab {
  if (typeof window !== "undefined") {
    const tab = new URLSearchParams(window.location.search).get("tab");
    if (tab === "overview" || tab === "builder" || tab === "dispatch" || tab === "recipients") {
      return tab;
    }
  }
  if (intent === "enqueue") return "dispatch";
  return initialCampaignIdFromUrl() ? "dispatch" : "builder";
}

function isPausableCampaign(status: string) {
  return status === "running" || status === "scheduled";
}

function isResumableCampaign(status: string) {
  return status === "paused" || status === "draft";
}
