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
  Input,
  LoadingState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  useToast,
} from "@nuoma/ui";

import { trpc } from "../lib/trpc.js";
import { CampaignFlowBuilder } from "../flow-builder/FlowBuilder.js";
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
  formatTime,
  pauseResumeSummary,
} from "../campaigns/CampaignOperationalPanels.js";

type CampaignTickResult = inferRouterOutputs<AppRouter>["campaigns"]["tick"];
type CampaignReadyReport = inferRouterOutputs<AppRouter>["campaigns"]["ready"];
type RemarketingBatchInput = inferRouterInputs<AppRouter>["campaigns"]["remarketingBatchReady"];
type RemarketingBatchReadyReport =
  inferRouterOutputs<AppRouter>["campaigns"]["remarketingBatchReady"];
type RemarketingBatchDispatchResult =
  inferRouterOutputs<AppRouter>["campaigns"]["remarketingBatchDispatch"];
type CampaignListItem = inferRouterOutputs<AppRouter>["campaigns"]["list"]["campaigns"][number];
type CampaignBlockIssue = CampaignReadyReport["issues"][number];
type RemarketingBatchRejected = RemarketingBatchReadyReport["rejected"][number];
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

function CampaignsOverviewPanel({
  campaigns,
  loading,
  error,
  lastTick,
}: {
  campaigns: CampaignListItem[];
  loading: boolean;
  error: string | null;
  lastTick: CampaignTickResult | null;
}) {
  const activeRecipients = campaigns.reduce(
    (total, campaign) =>
      total +
      campaign.recipients.filter(
        (recipient) => recipient.status === "queued" || recipient.status === "running",
      ).length,
    0,
  );
  const completedSteps = campaigns.reduce(
    (total, campaign) => total + campaign.metrics.completedSteps,
    0,
  );
  const failedSteps = campaigns.reduce(
    (total, campaign) => total + campaign.metrics.failedSteps,
    0,
  );
  const runningCampaigns = campaigns.filter((campaign) => campaign.status === "running").length;
  const visibleCampaigns = [...campaigns].sort((a, b) => b.id - a.id).slice(0, 12);

  return (
    <Animate preset="rise-in" delaySeconds={0.04}>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Visão operacional</CardTitle>
              <CardDescription>
                Campanhas, filas e sinais de envio em linhas compactas.
              </CardDescription>
            </div>
            <Badge variant={failedSteps > 0 ? "warning" : "cyan"}>
              {failedSteps > 0 ? "atenção" : "estável"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <CampaignMetric label="campanhas" value={loading ? "..." : campaigns.length} />
            <CampaignMetric label="running" value={runningCampaigns} />
            <CampaignMetric label="recipients ativos" value={activeRecipients} />
            <CampaignMetric label="steps ok" value={completedSteps} />
            <CampaignMetric label="falhas" value={failedSteps} />
          </div>
          {error ? <ErrorState description={error} /> : null}
          {lastTick ? (
            <div
              className="grid gap-2 rounded-lg bg-bg-base px-3 py-3 shadow-pressed-sm md:grid-cols-[1fr_auto_auto_auto]"
              data-testid={
                lastTick.evergreenCampaignsScanned > 0
                  ? "campaign-evergreen-last-tick"
                  : "campaign-last-tick"
              }
              data-planned={lastTick.evergreenRecipientsPlanned}
              data-created={lastTick.evergreenRecipientsCreated}
            >
              <div>
                <div className="text-sm font-medium text-fg-primary">Último tick</div>
                <div className="font-mono text-xs text-fg-dim">
                  {lastTick.dryRun ? "prévia" : "execução real"} · {lastTick.plannedJobs.length}{" "}
                  planejados
                </div>
              </div>
              <CampaignMetric
                label="jobs"
                value={lastTick.jobsCreated || lastTick.plannedJobs.length}
              />
              <CampaignMetric label="pulados" value={lastTick.recipientsSkipped} />
              <CampaignMetric label="erros" value={lastTick.errors.length} />
            </div>
          ) : null}
          {!loading && campaigns.length > 0 ? (
            <div className="flex flex-col gap-1">
              {visibleCampaigns.map((campaign) => (
                <div
                  key={campaign.id}
                  className="grid gap-2 rounded-lg bg-bg-sunken/82 px-3 py-2.5 shadow-flat md:grid-cols-[minmax(0,1fr)_auto_auto_auto]"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm text-fg-primary">{campaign.name}</div>
                    <div className="font-mono text-[0.68rem] text-fg-dim">
                      #{campaign.id} · {campaign.steps.length} steps · {campaign.recipients.length}{" "}
                      recipients
                    </div>
                  </div>
                  <Badge variant={campaign.status === "running" ? "cyan" : "neutral"}>
                    {campaign.status}
                  </Badge>
                  <span className="font-mono text-xs text-fg-muted">
                    ok {campaign.metrics.completedSteps}
                  </span>
                  <span className="font-mono text-xs text-fg-muted">
                    fail {campaign.metrics.failedSteps}
                  </span>
                  {campaign.evergreen ? (
                    <div className="md:col-span-4">
                      <CampaignEvergreenPanel
                        campaignId={campaign.id}
                        summary={evergreenEvaluationSummary(campaign.metadata)}
                      />
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </Animate>
  );
}

function SafeRemarketingConsole({
  campaigns,
  selectedCampaignId,
  selectedValue,
  onSelect,
  confirmation,
  onConfirmationChange,
  readiness,
  loadingReady,
  readyError,
  batchPhones,
  onBatchPhonesChange,
  batchAllowedPhone,
  onBatchAllowedPhoneChange,
  batchAllowedInstagram,
  onBatchAllowedInstagramChange,
  batchConfirmation,
  onBatchConfirmationChange,
  batchReady,
  batchReadyPending,
  batchReadyError,
  batchDispatchPending,
  lastBatchDispatch,
  enqueuePending,
  onReady,
  onEnqueue,
  onBatchReady,
  onBatchDispatch,
}: {
  campaigns: CampaignListItem[];
  selectedCampaignId: number | null;
  selectedValue: string;
  onSelect: (value: string) => void;
  confirmation: string;
  onConfirmationChange: (value: string) => void;
  readiness: CampaignReadyReport | null;
  loadingReady: boolean;
  readyError: string | null;
  batchPhones: string;
  onBatchPhonesChange: (value: string) => void;
  batchAllowedPhone: string;
  onBatchAllowedPhoneChange: (value: string) => void;
  batchAllowedInstagram: string;
  onBatchAllowedInstagramChange: (value: string) => void;
  batchConfirmation: string;
  onBatchConfirmationChange: (value: string) => void;
  batchReady: RemarketingBatchReadyReport | null;
  batchReadyPending: boolean;
  batchReadyError: string | null;
  batchDispatchPending: boolean;
  lastBatchDispatch: RemarketingBatchDispatchResult | null;
  enqueuePending: boolean;
  onReady: () => void;
  onEnqueue: () => void;
  onBatchReady: () => void;
  onBatchDispatch: () => void;
}) {
  const canConfirm = Boolean(readiness?.canEnqueue && confirmation === readiness.confirmText);
  const canConfirmBatch = Boolean(
    batchReady?.canDispatch && batchConfirmation === batchReady.confirmText,
  );
  const selected =
    campaigns.find((campaign) => campaign.id === selectedCampaignId) ?? campaigns[0] ?? null;
  const batchChannel = selected?.channel === "instagram" ? "instagram" : "whatsapp";
  const batchPlaceholder = batchChannel === "instagram" ? "gabriell_braga" : "5531982066263";
  const batchAllowlistValue =
    batchChannel === "instagram" ? batchAllowedInstagram : batchAllowedPhone;
  const batchAllowlistChange =
    batchChannel === "instagram" ? onBatchAllowedInstagramChange : onBatchAllowedPhoneChange;
  return (
    <Animate preset="rise-in" delaySeconds={0.06}>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Console seguro de remarketing</CardTitle>
              <CardDescription>
                Dry-run forte, serialização por telefone e confirmação explícita antes de
                enfileirar.
              </CardDescription>
            </div>
            <Badge variant={readiness?.canEnqueue ? "success" : "warning"}>
              {readiness?.canEnqueue ? "campanha pronta" : "guardrails"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto]">
            <Select value={selectedValue || String(selected?.id ?? "")} onValueChange={onSelect}>
              <SelectTrigger
                aria-label="Campanha para remarketing seguro"
                data-testid="safe-dispatch-campaign-select"
              >
                <SelectValue placeholder="Selecione a campanha" />
              </SelectTrigger>
              <SelectContent>
                {campaigns.map((campaign) => (
                  <SelectItem key={campaign.id} value={String(campaign.id)}>
                    {campaign.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="accent"
              loading={loadingReady}
              disabled={!selectedCampaignId}
              data-testid="safe-dispatch-ready-button"
              onClick={onReady}
            >
              Campanha pronta
            </Button>
            <Button
              variant="soft"
              loading={enqueuePending}
              disabled={!canConfirm}
              title={
                readiness && !canConfirm
                  ? readiness.canEnqueue
                    ? `Digite ${readiness.confirmText} para liberar.`
                    : "Corrija os bloqueios críticos antes de disparar."
                  : undefined
              }
              data-testid="safe-dispatch-enqueue-button"
              onClick={onEnqueue}
            >
              Disparar
            </Button>
          </div>

          {readyError && <div className="text-xs text-semantic-danger">{readyError}</div>}

          {readiness && (
            <div
              className="grid gap-3"
              data-testid="safe-dispatch-report"
              data-can-enqueue={readiness.canEnqueue}
              data-planned-jobs={readiness.summary.plannedJobs}
            >
              <div className="grid gap-2 sm:grid-cols-6">
                <CampaignMetric label="steps" value={readiness.summary.steps} />
                <CampaignMetric label="recipients" value={readiness.summary.recipientsActive} />
                <CampaignMetric label="telefones" value={readiness.summary.phonesUnique} />
                <CampaignMetric label="jobs" value={readiness.summary.plannedJobs} />
                <CampaignMetric label="política" value={readiness.summary.policyMode} />
                <CampaignMetric label="allowlist" value={readiness.summary.allowedPhones} />
              </div>
              <CampaignBlockingUxPanel
                title="Bloqueios do disparo"
                label="M40 campanhas"
                canProceed={readiness.canEnqueue}
                issues={readiness.issues}
                generatedAt={readiness.generatedAt}
                emptyMessage="Campanha pronta para enfileirar: nenhum bloqueio crítico encontrado."
                nextAction={
                  readiness.canEnqueue
                    ? `Digite ${readiness.confirmText} para liberar o disparo.`
                    : "Resolva os bloqueios críticos abaixo e rode Campanha pronta novamente."
                }
                data-testid="safe-dispatch-blocking-ux"
              />
              <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_17rem]">
                <ul className="grid max-h-44 gap-1 overflow-y-auto rounded-lg bg-bg-deep p-2 shadow-pressed-sm">
                  {readiness.issues.map((issue) => (
                    <li
                      key={`${issue.severity}-${issue.code}-${issue.count ?? 0}`}
                      className="grid gap-1 rounded-md bg-bg-base px-3 py-2 text-xs shadow-flat sm:grid-cols-[6rem_1fr_auto]"
                    >
                      <Badge
                        variant={
                          issue.severity === "error"
                            ? "danger"
                            : issue.severity === "warning"
                              ? "warning"
                              : "neutral"
                        }
                      >
                        {issue.severity}
                      </Badge>
                      <span className="text-fg-muted">{issue.message}</span>
                      <span className="font-mono text-fg-dim">{issue.count ?? issue.code}</span>
                    </li>
                  ))}
                  {readiness.issues.length === 0 && (
                    <li className="rounded-md bg-bg-base px-3 py-2 text-xs text-fg-muted shadow-flat">
                      Guardrails sem bloqueios.
                    </li>
                  )}
                </ul>
                <div className="grid content-start gap-2 rounded-lg bg-bg-deep p-2 shadow-pressed-sm">
                  <div className="px-1 font-mono text-[0.62rem] uppercase tracking-widest text-fg-dim">
                    Confirmação
                  </div>
                  <Input
                    monospace
                    value={confirmation}
                    placeholder={readiness.confirmText}
                    disabled={!readiness.canEnqueue}
                    data-testid="safe-dispatch-confirm-input"
                    onChange={(event) => onConfirmationChange(event.target.value)}
                  />
                  <div className="px-1 text-xs text-fg-muted">
                    Digite {readiness.confirmText} para liberar o botão de disparo.
                  </div>
                  {!readiness.canEnqueue && (
                    <div
                      className="rounded-md bg-bg-base px-3 py-2 text-xs text-semantic-warning shadow-flat"
                      data-testid="safe-dispatch-disabled-reason"
                    >
                      Disparo real bloqueado por {countIssues(readiness.issues, "error")}{" "}
                      bloqueio(s) crítico(s).
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <div
            className="grid gap-3 rounded-lg bg-bg-deep p-3 shadow-pressed-sm"
            data-testid="safe-batch-dispatch-panel"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-mono text-[0.62rem] uppercase tracking-widest text-fg-dim">
                  Lote real
                </div>
                <div className="mt-0.5 text-xs text-fg-muted">
                  {batchChannel === "instagram"
                    ? "Valida allowlist, lote inteiro e sessão Instagram antes de criar jobs."
                    : "Valida allowlist, lote inteiro e temporaryMessages 24h/90d antes de criar jobs."}
                </div>
              </div>
              <Badge variant={batchReady?.canDispatch ? "success" : "warning"}>
                {batchReady?.canDispatch ? "lote pronto" : "V2.10.36"}
              </Badge>
            </div>
            <Textarea
              rows={4}
              monospace
              value={batchPhones}
              placeholder={batchPlaceholder}
              data-testid="safe-batch-phones-input"
              onChange={(event) => onBatchPhonesChange(event.target.value)}
            />
            <Input
              monospace
              value={batchAllowlistValue}
              placeholder={batchPlaceholder}
              aria-label={
                batchChannel === "instagram"
                  ? "Instagram liberado para teste"
                  : "Telefone liberado para teste"
              }
              data-testid="safe-batch-allowlist-input"
              onChange={(event) => batchAllowlistChange(event.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="accent"
                size="sm"
                loading={batchReadyPending}
                disabled={!selectedCampaignId || batchPhones.trim().length === 0}
                data-testid="safe-batch-ready-button"
                onClick={onBatchReady}
              >
                Validar lote
              </Button>
              <Button
                variant="soft"
                size="sm"
                loading={batchDispatchPending}
                disabled={!canConfirmBatch}
                title={
                  batchReady && !canConfirmBatch
                    ? batchReady.canDispatch
                      ? `Digite ${batchReady.confirmText} para liberar o lote.`
                      : "Corrija o lote inteiro antes de disparar."
                    : undefined
                }
                data-testid="safe-batch-dispatch-button"
                onClick={onBatchDispatch}
              >
                Disparar lote real
              </Button>
            </div>
            {batchReadyError && (
              <div className="text-xs text-semantic-danger">{batchReadyError}</div>
            )}
            {batchReady && (
              <div
                className="grid gap-3"
                data-testid="safe-batch-report"
                data-can-dispatch={batchReady.canDispatch}
                data-accepted={batchReady.summary.acceptedRecipients}
                data-planned-jobs={batchReady.summary.plannedJobs}
              >
                <div className="grid gap-2 sm:grid-cols-6 lg:grid-cols-8">
                  <CampaignMetric label="cand." value={batchReady.summary.candidates} />
                  <CampaignMetric label="aceitos" value={batchReady.summary.acceptedRecipients} />
                  <CampaignMetric label="rejeit." value={batchReady.summary.rejectedRecipients} />
                  <CampaignMetric label="jobs" value={batchReady.summary.plannedJobs} />
                  <CampaignMetric label="policy" value={batchReady.summary.policyMode} />
                  <CampaignMetric
                    label="temp"
                    value={
                      batchReady.temporaryMessages.controlSteps.length > 0
                        ? `${batchReady.temporaryMessages.controlSteps.length} step(s)`
                        : batchReady.temporaryMessages.enabled
                          ? `${batchReady.temporaryMessages.beforeSendDuration}/${batchReady.temporaryMessages.afterCompletionDuration}`
                          : "off"
                    }
                  />
                  <CampaignMetric
                    label="ig"
                    value={
                      batchReady.summary.instagramSession
                        ? batchReady.summary.instagramSession.authenticated
                          ? "on"
                          : batchReady.summary.instagramSession.status
                        : batchChannel === "instagram"
                          ? "off"
                          : "n/a"
                    }
                  />
                  <CampaignMetric
                    label="ativos"
                    value={`${batchReady.summary.activeCampaignStepJobs}/${batchReady.summary.activeRecipients}`}
                  />
                </div>
                <CampaignBlockingUxPanel
                  title="Bloqueios do lote real"
                  label="M40 lote"
                  canProceed={batchReady.canDispatch}
                  issues={batchReady.issues}
                  rejected={batchReady.rejected}
                  generatedAt={batchReady.generatedAt}
                  emptyMessage="Lote íntegro: nenhum telefone rejeitado e guardrails aprovados."
                  nextAction={
                    batchReady.canDispatch
                      ? `Digite ${batchReady.confirmText} para liberar o lote real.`
                      : "Corrija todos os rejeitados; lote parcial continua bloqueado."
                  }
                  data-testid="safe-batch-blocking-ux"
                />
                <ul className="grid max-h-40 gap-1 overflow-y-auto rounded-lg bg-bg-base p-2 shadow-pressed-sm">
                  {batchReady.issues.map((issue) => (
                    <li
                      key={`${issue.severity}-${issue.code}-${issue.count ?? 0}`}
                      className="grid gap-1 rounded-md bg-bg-deep px-3 py-2 text-xs shadow-flat sm:grid-cols-[6rem_1fr_auto]"
                    >
                      <Badge
                        variant={
                          issue.severity === "error"
                            ? "danger"
                            : issue.severity === "warning"
                              ? "warning"
                              : "neutral"
                        }
                      >
                        {issue.severity}
                      </Badge>
                      <span className="text-fg-muted">{issue.message}</span>
                      <span className="font-mono text-fg-dim">{issue.count ?? issue.code}</span>
                    </li>
                  ))}
                </ul>
                <div className="grid gap-2 rounded-lg bg-bg-base p-2 shadow-pressed-sm md:grid-cols-[minmax(0,1fr)_16rem]">
                  <div className="grid gap-1">
                    {batchReady.rejected.slice(0, 4).map((item) => (
                      <div
                        key={`${item.source}-${item.value}-${item.reason}`}
                        className="truncate rounded-md bg-bg-deep px-3 py-2 font-mono text-[0.7rem] text-fg-dim"
                      >
                        {item.source}:{item.value} · {item.reason}
                      </div>
                    ))}
                    {batchReady.rejected.length === 0 && (
                      <div className="rounded-md bg-bg-deep px-3 py-2 text-xs text-fg-muted">
                        Nenhum rejeitado no lote.
                      </div>
                    )}
                  </div>
                  <div className="grid content-start gap-2">
                    <Input
                      monospace
                      value={batchConfirmation}
                      placeholder={batchReady.confirmText}
                      disabled={!batchReady.canDispatch}
                      data-testid="safe-batch-confirm-input"
                      onChange={(event) => onBatchConfirmationChange(event.target.value)}
                    />
                    <div className="px-1 text-xs text-fg-muted">
                      Digite {batchReady.confirmText} para liberar o lote real.
                    </div>
                    {!batchReady.canDispatch && (
                      <div
                        className="rounded-md bg-bg-deep px-3 py-2 text-xs text-semantic-warning shadow-flat"
                        data-testid="safe-batch-disabled-reason"
                      >
                        Lote travado por {countIssues(batchReady.issues, "error")} bloqueio(s) e{" "}
                        {batchReady.rejected.length} rejeitado(s).
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
            {lastBatchDispatch && (
              <div
                className="rounded-lg bg-bg-base px-3 py-2 text-xs text-fg-muted shadow-flat"
                data-testid="safe-batch-last-dispatch"
              >
                lote {lastBatchDispatch.batchDispatchId} · recipients{" "}
                {lastBatchDispatch.recipientsCreated} · jobs{" "}
                {lastBatchDispatch.scheduler.jobsCreated}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </Animate>
  );
}

function CampaignBlockingUxPanel({
  title,
  label,
  canProceed,
  issues,
  rejected = [],
  generatedAt,
  emptyMessage,
  nextAction,
  "data-testid": testId,
}: {
  title: string;
  label: string;
  canProceed: boolean;
  issues: CampaignBlockIssue[];
  rejected?: RemarketingBatchRejected[];
  generatedAt: string;
  emptyMessage: string;
  nextAction: string;
  "data-testid": string;
}) {
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  const infos = issues.filter((issue) => issue.severity === "info");
  const primaryIssue = errors[0] ?? warnings[0] ?? infos[0] ?? null;
  const rejectedGroups = groupRejected(rejected);

  return (
    <section
      className="rounded-lg bg-bg-base p-3 shadow-flat"
      data-testid={testId}
      data-status={canProceed ? "ready" : "blocked"}
      data-errors={errors.length}
      data-warnings={warnings.length}
      data-infos={infos.length}
      data-rejected={rejected.length}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-mono text-[0.62rem] uppercase tracking-widest text-fg-dim">
            {label}
          </div>
          <div className="mt-1 text-sm font-semibold text-fg-primary">{title}</div>
          <div className="mt-1 text-xs text-fg-muted">
            Gerado {formatTime(generatedAt)} · {nextAction}
          </div>
        </div>
        <Badge variant={canProceed ? "success" : "danger"}>
          {canProceed ? "liberado" : "bloqueado"}
        </Badge>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        <CampaignMetric label="críticos" value={errors.length} />
        <CampaignMetric label="atenções" value={warnings.length} />
        <CampaignMetric label="infos" value={infos.length} />
        <CampaignMetric label="rejeitados" value={rejected.length} />
      </div>

      <div className="mt-3 rounded-md bg-bg-deep px-3 py-2 shadow-pressed-sm">
        <div className="font-mono text-[0.6rem] uppercase tracking-widest text-fg-dim">
          Próximo passo
        </div>
        <div className="mt-1 text-xs text-fg-primary">
          {primaryIssue ? issueResolution(primaryIssue) : emptyMessage}
        </div>
      </div>

      {issues.length > 0 && (
        <div className="mt-3 grid gap-2 lg:grid-cols-2">
          {issues.slice(0, 4).map((issue) => (
            <div
              key={`${issue.severity}-${issue.code}-${issue.count ?? 0}`}
              className="rounded-md bg-bg-deep px-3 py-2 shadow-pressed-sm"
              data-testid="campaign-blocking-issue"
              data-code={issue.code}
              data-severity={issue.severity}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Badge variant={issueVariant(issue.severity)}>{issue.severity}</Badge>
                <span className="font-mono text-[0.65rem] text-fg-dim">
                  {issue.count ?? issue.code}
                </span>
              </div>
              <div className="mt-2 text-xs text-fg-primary">{issue.message}</div>
              <div className="mt-1 text-xs text-fg-muted">{issueResolution(issue)}</div>
            </div>
          ))}
        </div>
      )}

      {rejectedGroups.length > 0 && (
        <div className="mt-3 grid gap-1.5" data-testid="campaign-rejected-reasons">
          {rejectedGroups.slice(0, 5).map((group) => (
            <div
              key={group.reason}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-bg-deep px-3 py-2 text-xs shadow-pressed-sm"
              data-testid="campaign-rejected-reason"
              data-reason={group.reason}
              data-count={group.count}
            >
              <span className="text-fg-primary">{rejectedReasonLabel(group.reason)}</span>
              <span className="font-mono text-fg-dim">
                {group.count} · {group.sample}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
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

function countIssues(issues: CampaignBlockIssue[], severity: CampaignBlockIssue["severity"]) {
  return issues.filter((issue) => issue.severity === severity).length;
}

function issueVariant(severity: CampaignBlockIssue["severity"]) {
  if (severity === "error") return "danger";
  if (severity === "warning") return "warning";
  return "info";
}

function issueResolution(issue: CampaignBlockIssue) {
  switch (issue.code) {
    case "campaign_status_not_runnable":
      return "Retome a campanha ou altere o status para running/scheduled antes de disparar.";
    case "channel_not_supported":
      return "Use uma campanha WhatsApp ou Instagram para este fluxo seguro.";
    case "campaign_without_steps":
      return "Adicione pelo menos um step com conteúdo antes de validar novamente.";
    case "empty_message_step":
      return "Preencha os steps de texto/link sem mensagem útil.";
    case "no_active_recipients":
      return "Inclua recipients queued/running ou use o lote real para criar novos alvos.";
    case "invalid_recipient_phone":
      return "Corrija os telefones dos recipients para números WhatsApp válidos.";
    case "invalid_recipient_instagram":
      return "Corrija os Instagram dos recipients antes de disparar.";
    case "unsupported_instagram_steps":
      return "Mantenha na campanha Instagram apenas texto, link, imagem ou vídeo.";
    case "suppressed_contact":
      return "Remova contatos blocked/archived do disparo ou regularize o status do contato.";
    case "duplicate_recipient_phone":
      return "Mantenha apenas um recipient ativo por telefone.";
    case "recipient_already_waiting":
      return "Aguarde os jobs anteriores finalizarem antes de reenfileirar.";
    case "send_policy_blocks_recipients":
      return "Ajuste a allowlist ou retire os telefones fora da política atual.";
    case "production_without_canary_allowlist":
      return "Defina uma allowlist canária explícita antes do envio real.";
    case "dry_run_without_jobs":
      return "Confira status, steps, delays e recipients: a prévia não encontrou job pronto.";
    case "scheduler_preview_error":
      return "Resolva o erro retornado pela prévia do scheduler e rode a validação novamente.";
    case "temporary_messages_audit_only":
      return "Adicione um step de mensagens temporárias se quiser prova operacional antes do envio.";
    case "temporary_messages_global_not_m303":
      return "Revise o global antigo ou migre para steps explícitos de mensagens temporárias.";
    case "send_policy_allowlist_required":
      return "Informe allowlist explícita para lote real.";
    case "instagram_allowlist_required":
      return "Informe o Instagram canário autorizado antes de liberar o lote.";
    case "instagram_session_unavailable":
      return "Suba o worker com sessão Instagram antes de validar o lote.";
    case "instagram_session_error":
      return "Corrija o erro da sessão Instagram no worker e valide novamente.";
    case "instagram_session_disconnected":
      return "Reconecte o CDP/worker usado pelo Instagram.";
    case "instagram_session_not_authenticated":
      return "Autentique o Instagram na sessão compartilhada do worker.";
    case "active_campaign_step_jobs":
      return "Finalize ou limpe campaign_step ativos antes de abrir outro lote real.";
    case "active_campaign_recipients":
      return "Conclua recipients ativos antes de criar um novo lote para a campanha.";
    case "empty_batch":
      return "Informe ao menos um telefone, Instagram ou contato no lote.";
    case "batch_has_rejections":
      return "Corrija todos os rejeitados; o sistema bloqueia lote parcial.";
    case "no_accepted_recipients":
      return "Nenhum alvo passou nos guardrails; revise telefones, contatos e allowlist.";
    case "accepted_recipients":
      return "Alvos aceitos para a próxima etapa de confirmação.";
    default:
      return issue.severity === "error"
        ? "Resolva este bloqueio antes de tentar o envio real."
        : "Revise esta condição antes de executar.";
  }
}

function groupRejected(rejected: RemarketingBatchRejected[]) {
  const groups = new Map<string, { reason: string; count: number; sample: string }>();
  for (const item of rejected) {
    const existing = groups.get(item.reason);
    if (existing) {
      existing.count += 1;
      continue;
    }
    groups.set(item.reason, {
      reason: item.reason,
      count: 1,
      sample: `${item.source}:${item.value}`,
    });
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

function rejectedReasonLabel(reason: string) {
  switch (reason) {
    case "not_found":
      return "Contato não encontrado";
    case "missing_phone":
      return "Contato sem telefone";
    case "missing_instagram":
      return "Contato sem Instagram";
    case "invalid_phone":
      return "Telefone inválido";
    case "invalid_instagram":
      return "Instagram inválido";
    case "duplicate_candidate":
      return "Alvo duplicado no lote";
    case "duplicate_recipient":
      return "Já existe recipient para este alvo";
    case "not_allowlisted_for_test_execution":
      return "Fora da allowlist de teste";
    case "not_in_production_canary_allowlist":
      return "Fora da allowlist canária";
    case "instagram_allowlist_required":
      return "Allowlist Instagram ausente";
    case "instagram_handle_not_allowed":
      return "Instagram fora da allowlist";
    case "active_pipeline_for_instagram":
      return "Pipeline ativo para este Instagram";
    default:
      if (reason.startsWith("contact_") && reason.endsWith("_suppressed")) {
        return "Contato suprimido por status";
      }
      return reason.replaceAll("_", " ");
  }
}

function isPausableCampaign(status: string) {
  return status === "running" || status === "scheduled";
}

function isResumableCampaign(status: string) {
  return status === "paused" || status === "draft";
}
