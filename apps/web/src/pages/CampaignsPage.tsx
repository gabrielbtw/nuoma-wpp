import { useMemo, useRef, useState, type CSSProperties } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import { useVirtualizer } from "@tanstack/react-virtual";

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
  Textarea,
  useToast,
} from "@nuoma/ui";

import { trpc } from "../lib/trpc.js";
import { CampaignFlowBuilder } from "../flow-builder/FlowBuilder.js";

type CampaignTickResult = inferRouterOutputs<AppRouter>["campaigns"]["tick"];
type CampaignReadyReport = inferRouterOutputs<AppRouter>["campaigns"]["ready"];
type RemarketingBatchReadyReport =
  inferRouterOutputs<AppRouter>["campaigns"]["remarketingBatchReady"];
type RemarketingBatchDispatchResult =
  inferRouterOutputs<AppRouter>["campaigns"]["remarketingBatchDispatch"];
type CampaignListItem = inferRouterOutputs<AppRouter>["campaigns"]["list"]["campaigns"][number];
type CampaignRecipientItem = CampaignListItem["recipients"][number];
type CampaignBlockIssue = CampaignReadyReport["issues"][number];
type RemarketingBatchRejected = RemarketingBatchReadyReport["rejected"][number];

export function CampaignsPage() {
  const campaigns = trpc.campaigns.list.useQuery();
  const utils = trpc.useUtils();
  const [lastTick, setLastTick] = useState<CampaignTickResult | null>(null);
  const [lastBatchDispatch, setLastBatchDispatch] =
    useState<RemarketingBatchDispatchResult | null>(null);
  const [safeCampaignId, setSafeCampaignId] = useState<string>(() => initialCampaignIdFromUrl());
  const [safeConfirm, setSafeConfirm] = useState("");
  const [safeBatchPhones, setSafeBatchPhones] = useState("");
  const [safeBatchConfirm, setSafeBatchConfirm] = useState("");
  const toast = useToast();
  const intent = usePageIntent();
  const selectedSafeCampaignId = useMemo(() => {
    const parsed = Number(safeCampaignId);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
    return campaigns.data?.campaigns[0]?.id ?? null;
  }, [campaigns.data?.campaigns, safeCampaignId]);
  const readiness = trpc.campaigns.ready.useQuery(
    { campaignId: selectedSafeCampaignId ?? 1 },
    {
      enabled: false,
      retry: false,
    },
  );
  const batchReady = trpc.campaigns.remarketingBatchReady.useMutation({
    onSuccess(result) {
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
  const batchDispatch = trpc.campaigns.remarketingBatchDispatch.useMutation({
    async onSuccess(result) {
      setLastBatchDispatch(result);
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
    tick.mutate({ dryRun: false, campaignId: selectedSafeCampaignId });
    setSafeConfirm("");
  };
  const runBatchReady = () => {
    if (!selectedSafeCampaignId) return;
    batchReady.mutate({
      campaignId: selectedSafeCampaignId,
      rawPhones: safeBatchPhones,
      allowedPhone: "5531982066263",
    });
  };
  const runBatchDispatch = () => {
    if (!selectedSafeCampaignId || !batchReady.data?.canDispatch) return;
    batchDispatch.mutate({
      campaignId: selectedSafeCampaignId,
      rawPhones: safeBatchPhones,
      allowedPhone: "5531982066263",
      confirmText: safeBatchConfirm,
    });
  };

  return (
    <div className="flex flex-col gap-7 max-w-5xl mx-auto pt-2">
      <Animate preset="rise-in">
        <header className="flex items-end justify-between gap-6">
          <div>
            <p className="botforge-kicker">
              Campanhas
            </p>
            <h1 className="botforge-title mt-2 text-5xl md:text-6xl">
              Outbound <span className="text-brand-violet">orquestrado</span>.
            </h1>
            <p className="text-sm text-fg-muted mt-3 max-w-xl">
              Construtor compartilhado por canal. Steps: text, voice, document, link.
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
              onClick={() => tick.mutate({ dryRun: false })}
            >
              Enfileirar
            </Button>
          </div>
        </header>
      </Animate>

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
        batchConfirmation={safeBatchConfirm}
        onBatchConfirmationChange={setSafeBatchConfirm}
        batchReady={batchReady.data ?? null}
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
                onClick={() => tick.mutate({ dryRun: false })}
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
                <Metric label="Jobs" value={lastTick.jobsCreated || lastTick.plannedJobs.length} />
                <Metric
                  label="Evergreen"
                  value={lastTick.evergreenRecipientsCreated || lastTick.evergreenRecipientsPlanned}
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
                  <CampaignMetric label="planejados" value={lastTick.evergreenRecipientsPlanned} />
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

      <Animate preset="rise-in" delaySeconds={0.1}>
        <CampaignFlowBuilder />
      </Animate>

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
                          loading={pauseCampaign.isPending && pauseCampaign.variables?.id === c.id}
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
                        onClick={() => tick.mutate({ dryRun: false, campaignId: c.id })}
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
                    {c.abTest && <CampaignAbVariantsPanel campaignId={c.id} abTest={c.abTest} />}
                    {c.evergreen && (
                      <CampaignEvergreenPanel
                        campaignId={c.id}
                        summary={evergreenEvaluationSummary(c.metadata)}
                      />
                    )}
                    {c.recipients.length > 0 && (
                      <CampaignRecipientsVirtualTable campaignId={c.id} recipients={c.recipients} />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </Animate>
    </div>
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
                  Valida allowlist, lote inteiro e temporaryMessages 24h/90d antes de criar jobs.
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
              placeholder="5531982066263"
              data-testid="safe-batch-phones-input"
              onChange={(event) => onBatchPhonesChange(event.target.value)}
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
            {batchReadyError && <div className="text-xs text-semantic-danger">{batchReadyError}</div>}
            {batchReady && (
              <div
                className="grid gap-3"
                data-testid="safe-batch-report"
                data-can-dispatch={batchReady.canDispatch}
                data-accepted={batchReady.summary.acceptedRecipients}
                data-planned-jobs={batchReady.summary.plannedJobs}
              >
                <div className="grid gap-2 sm:grid-cols-6">
                  <CampaignMetric label="cand." value={batchReady.summary.candidates} />
                  <CampaignMetric label="aceitos" value={batchReady.summary.acceptedRecipients} />
                  <CampaignMetric label="rejeit." value={batchReady.summary.rejectedRecipients} />
                  <CampaignMetric label="jobs" value={batchReady.summary.plannedJobs} />
                  <CampaignMetric label="policy" value={batchReady.summary.policyMode} />
                  <CampaignMetric
                    label="temp"
                    value={
                      batchReady.temporaryMessages.enabled
                        ? `${batchReady.temporaryMessages.beforeSendDuration}/${batchReady.temporaryMessages.afterCompletionDuration}`
                        : "off"
                    }
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
                {lastBatchDispatch.recipientsCreated} · jobs {lastBatchDispatch.scheduler.jobsCreated}
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

function initialCampaignIdFromUrl() {
  if (typeof window === "undefined") return "";
  const value = new URLSearchParams(window.location.search).get("campaignId");
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? String(parsed) : "";
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
      return "Use uma campanha WhatsApp para este fluxo seguro.";
    case "campaign_without_steps":
      return "Adicione pelo menos um step com conteúdo antes de validar novamente.";
    case "empty_message_step":
      return "Preencha os steps de texto/link sem mensagem útil.";
    case "no_active_recipients":
      return "Inclua recipients queued/running ou use o lote real para criar novos alvos.";
    case "invalid_recipient_phone":
      return "Corrija os telefones dos recipients para números WhatsApp válidos.";
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
    case "temporary_messages_m303_required":
      return "Configure temporaryMessages com 24h antes do envio e restauração 90d.";
    case "send_policy_allowlist_required":
      return "Informe allowlist explícita para lote real.";
    case "active_campaign_step_jobs":
      return "Finalize ou limpe campaign_step ativos antes de abrir outro lote real.";
    case "active_campaign_recipients":
      return "Conclua recipients ativos antes de criar um novo lote para a campanha.";
    case "empty_batch":
      return "Informe ao menos um telefone ou contato no lote.";
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
    case "invalid_phone":
      return "Telefone inválido";
    case "duplicate_candidate":
      return "Telefone duplicado no lote";
    case "duplicate_recipient":
      return "Já existe recipient para este alvo";
    case "not_allowlisted_for_test_execution":
      return "Fora da allowlist de teste";
    case "not_in_production_canary_allowlist":
      return "Fora da allowlist canária";
    default:
      if (reason.startsWith("contact_") && reason.endsWith("_suppressed")) {
        return "Contato suprimido por status";
      }
      return reason.replaceAll("_", " ");
  }
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-bg-base px-3 py-3 shadow-pressed-sm">
      <div className="text-[0.65rem] uppercase tracking-widest text-fg-dim font-mono">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}

function CampaignPauseResumePanel({
  campaignId,
  summary,
}: {
  campaignId: number;
  summary: PauseResumeSummary | null;
}) {
  if (!summary) {
    return null;
  }
  return (
    <div
      className="mt-3 rounded-lg bg-bg-deep p-2 shadow-pressed-sm"
      data-testid="campaign-pause-resume-panel"
      data-campaign-id={campaignId}
      data-last-action={summary.lastAction}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-2">
        <div>
          <div className="font-mono text-[0.62rem] uppercase tracking-widest text-fg-dim">
            Pause/resume
          </div>
          <div className="mt-0.5 text-xs text-fg-muted">
            {summary.lastAction === "paused"
              ? `pausada ${formatTime(summary.pausedAt)}`
              : `retomada ${formatTime(summary.resumedAt)}`}
          </div>
        </div>
        <Badge variant={summary.lastAction === "paused" ? "warning" : "success"}>V2.10.9</Badge>
      </div>
    </div>
  );
}

function CampaignStepStatsPanel({
  campaignId,
  stats,
}: {
  campaignId: number;
  stats: CampaignListItem["stepStats"];
}) {
  return (
    <div
      className="mt-3 rounded-lg bg-bg-deep p-2 shadow-pressed-sm"
      data-testid="campaign-step-stats"
      data-campaign-id={campaignId}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-2 pb-2">
        <div>
          <div className="font-mono text-[0.62rem] uppercase tracking-widest text-fg-dim">
            Per-step stats
          </div>
          <div className="mt-0.5 text-xs text-fg-muted">
            {stats.length} step(s) com conclusão, falha, navegação e último evento.
          </div>
        </div>
        <Badge variant="violet">V2.10.6</Badge>
      </div>
      <div className="grid gap-2 xl:grid-cols-3">
        {stats.map((step) => (
          <div
            key={step.stepId}
            className="rounded-md bg-bg-base px-3 py-3 shadow-flat"
            data-testid="campaign-step-stat-row"
            data-step-id={step.stepId}
            data-completed={step.completedRecipients}
            data-failed={step.failedRecipients}
            data-completion-rate={step.completionRate}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-fg-primary">
                  {step.order}. {step.label}
                </div>
                <div className="mt-0.5 font-mono text-[0.65rem] text-fg-dim">
                  {step.type} · delay {step.delaySeconds}s
                </div>
              </div>
              <Badge variant={step.failedRecipients > 0 ? "warning" : "success"}>
                {formatPercent(step.completionRate)}
              </Badge>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-1.5">
              <MiniMetric label="ok" value={step.completedRecipients} />
              <MiniMetric label="fail" value={step.failedRecipients} />
              <MiniMetric label="atual" value={step.currentRecipients} />
              <MiniMetric label="eventos" value={step.eventsCount} />
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Badge variant="neutral">nav {step.navigatedSteps}</Badge>
              <Badge variant="cyan">reuso {step.reusedOpenChatSteps}</Badge>
              <Badge variant="neutral">aguard. {step.awaitingRecipients}</Badge>
            </div>
            <div className="mt-3 truncate font-mono text-[0.65rem] text-fg-dim">
              último: {step.lastEventAt ? formatTime(step.lastEventAt) : "—"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CampaignRecipientsVirtualTable({
  campaignId,
  recipients,
}: {
  campaignId: number;
  recipients: CampaignRecipientItem[];
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: recipients.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 150,
    getItemKey: (index) => recipients[index]?.id ?? index,
    overscan: 4,
  });
  const virtualItems = rowVirtualizer.getVirtualItems();
  return (
    <div className="mt-3 rounded-lg bg-bg-deep p-2 shadow-pressed-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 px-2 pb-2">
        <div>
          <div className="font-mono text-[0.62rem] uppercase tracking-widest text-fg-dim">
            Recipients virtualizados
          </div>
          <div className="mt-0.5 text-xs text-fg-muted">
            {recipients.length} recipient(s) · {virtualItems.length} visíveis
          </div>
        </div>
        <Badge variant="cyan">virtual</Badge>
      </div>
      <div
        ref={parentRef}
        data-testid="campaign-recipients-virtual-scroll"
        data-campaign-id={campaignId}
        data-total-count={recipients.length}
        data-visible-count={virtualItems.length}
        data-virtualized="true"
        role="region"
        aria-label={`Recipients da campanha ${campaignId}`}
        tabIndex={0}
        className="max-h-[26rem] overflow-y-auto rounded-md"
        style={{ height: Math.min(416, Math.max(156, recipients.length * 150)) }}
      >
        <div
          data-testid="campaign-recipients-virtual-spacer"
          style={{
            height: rowVirtualizer.getTotalSize(),
            position: "relative",
            width: "100%",
          }}
        >
          {virtualItems.map((virtualItem) => {
            const recipient = recipients[virtualItem.index];
            if (!recipient) return null;
            return (
              <RecipientTimelineItem
                key={virtualItem.key}
                recipient={recipient}
                style={{
                  height: virtualItem.size,
                  transform: `translateY(${virtualItem.start}px)`,
                }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function CampaignEvergreenPanel({
  campaignId,
  summary,
}: {
  campaignId: number;
  summary: EvergreenEvaluationSummary | null;
}) {
  return (
    <div
      className="mt-3 rounded-lg bg-bg-deep p-2 shadow-pressed-sm"
      data-testid="campaign-evergreen-panel"
      data-campaign-id={campaignId}
      data-created={summary?.recipientsCreated ?? 0}
      data-planned={summary?.recipientsPlanned ?? 0}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-2 pb-2">
        <div>
          <div className="font-mono text-[0.62rem] uppercase tracking-widest text-fg-dim">
            Evergreen auto
          </div>
          <div className="mt-0.5 text-xs text-fg-muted">
            {summary
              ? `última avaliação ${formatTime(summary.at)}`
              : "aguardando primeira avaliação persistida"}
          </div>
        </div>
        <Badge variant="cyan">V2.10.8</Badge>
      </div>
      <div className="grid gap-1.5 sm:grid-cols-4">
        <MiniMetric label="contatos" value={summary?.contactsScanned ?? 0} />
        <MiniMetric label="plan." value={summary?.recipientsPlanned ?? 0} />
        <MiniMetric label="criados" value={summary?.recipientsCreated ?? 0} />
        <MiniMetric label="skip" value={summary?.recipientsSkipped ?? 0} />
      </div>
    </div>
  );
}

function CampaignAbVariantsPanel({
  campaignId,
  abTest,
}: {
  campaignId: number;
  abTest: NonNullable<CampaignListItem["abTest"]>;
}) {
  return (
    <div
      className="mt-3 rounded-lg bg-bg-deep p-2 shadow-pressed-sm"
      data-testid="campaign-ab-variants"
      data-campaign-id={campaignId}
      data-assignment={abTest.assignment}
      data-total-assigned={abTest.totalAssigned}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-2 pb-2">
        <div>
          <div className="font-mono text-[0.62rem] uppercase tracking-widest text-fg-dim">
            A/B variants
          </div>
          <div className="mt-0.5 text-xs text-fg-muted">
            {abTest.variants.length} variante(s) · {abTest.totalAssigned} atribuídos ·{" "}
            {abTest.unassignedRecipients} sem variante.
          </div>
        </div>
        <Badge variant="violet">V2.10.7</Badge>
      </div>
      <div className="grid gap-2 xl:grid-cols-2">
        {abTest.variants.map((variant) => (
          <div
            key={variant.id}
            className="rounded-md bg-bg-base px-3 py-3 shadow-flat"
            data-testid="campaign-ab-variant-row"
            data-variant-id={variant.id}
            data-assigned={variant.assignedRecipients}
            data-completed={variant.completedRecipients}
            data-failed={variant.failedRecipients}
            data-completion-rate={variant.completionRate}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-fg-primary">{variant.label}</div>
                <div className="mt-0.5 font-mono text-[0.65rem] text-fg-dim">
                  id {variant.id} · peso {variant.weight}
                </div>
              </div>
              <Badge variant={variant.failedRecipients > 0 ? "warning" : "success"}>
                {formatPercent(variant.completionRate)}
              </Badge>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-1.5">
              <MiniMetric label="atr." value={variant.assignedRecipients} />
              <MiniMetric label="ok" value={variant.completedRecipients} />
              <MiniMetric label="fail" value={variant.failedRecipients} />
              <MiniMetric label="eventos" value={variant.eventsCount} />
            </div>
            <div className="mt-3 truncate font-mono text-[0.65rem] text-fg-dim">
              último: {variant.lastEventAt ? formatTime(variant.lastEventAt) : "—"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RecipientTimelineItem({
  recipient,
  style,
}: {
  recipient: CampaignRecipientItem;
  style: CSSProperties;
}) {
  return (
    <div
      className="absolute left-0 right-0 px-1 pb-2"
      data-testid="campaign-recipient-row"
      data-recipient-id={recipient.id}
      data-status={recipient.status}
      style={style}
    >
      <div className="h-full overflow-hidden rounded-md bg-bg-deep px-3 py-2.5 shadow-pressed-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="font-mono text-xs text-fg-primary">
              #{recipient.id} · {recipient.phone ?? recipient.channel}
            </div>
            <div className="mt-0.5 truncate text-xs text-fg-dim">
              step {recipient.currentStepId ?? "—"}
              {recipient.lastError ? ` · ${recipient.lastError}` : ""}
            </div>
          </div>
          <Badge variant={recipientStatusVariant(recipient.status)}>{recipient.status}</Badge>
        </div>
        {recipient.timeline.length > 0 ? (
          <ol className="mt-3 grid gap-1.5">
            {recipient.timeline.slice(0, 2).map((event) => (
              <li
                key={event.id}
                className="grid gap-2 rounded-md bg-bg-base px-3 py-2 text-xs md:grid-cols-[8rem_1fr_auto]"
              >
                <time className="font-mono text-fg-dim">{formatTime(event.createdAt)}</time>
                <div className="min-w-0">
                  <div className="truncate text-fg-primary">{eventTitle(event.type)}</div>
                  <div className="truncate font-mono text-[0.7rem] text-fg-dim">
                    {eventMeta(event.payload)}
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-1">
                  {navigationBadge(event.payload)}
                  <Badge variant={event.severity === "warn" ? "warning" : "neutral"}>
                    {event.severity}
                  </Badge>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <div className="mt-3 text-xs text-fg-dim">Sem eventos auditáveis ainda.</div>
        )}
      </div>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-bg-deep px-2 py-1.5 shadow-pressed-sm">
      <div className="font-mono text-[0.55rem] uppercase tracking-widest text-fg-dim">{label}</div>
      <div className="mt-0.5 font-mono text-xs text-fg-primary">{value}</div>
    </div>
  );
}

function CampaignMetric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md bg-bg-base px-2.5 py-2 shadow-pressed-sm">
      <div className="font-mono text-[0.6rem] uppercase tracking-widest text-fg-dim">{label}</div>
      <div className="mt-0.5 truncate font-mono text-xs text-fg-primary">{value}</div>
    </div>
  );
}

function recipientStatusVariant(status: string) {
  if (status === "completed") return "success";
  if (status === "failed") return "danger";
  if (status === "skipped") return "warning";
  if (status === "running") return "info";
  return "neutral";
}

function eventTitle(type: string) {
  return type.replace(/^sender\./, "").replaceAll("_", " ");
}

function eventMeta(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return "payload vazio";
  }
  const record = payload as Record<string, unknown>;
  const parts = [
    stringPart("job", record.jobId),
    stringPart("step", record.stepId),
    stringPart("type", record.stepType),
    stringPart("var", record.variantId),
    stringPart("batch", batchPart(record)),
    stringPart("temp", tempPart(record)),
    stringPart("nav", record.navigationMode),
    stringPart("external", record.externalId),
    stringPart("message", record.messageId),
    stringPart("error", record.error),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "payload sem resumo";
}

function stringPart(label: string, value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  return `${label}:${String(value)}`;
}

function batchPart(record: Record<string, unknown>) {
  if (record.campaignBatchIndex === null || record.campaignBatchIndex === undefined) {
    return null;
  }
  const index = Number(record.campaignBatchIndex);
  const size = Number(record.campaignBatchSize);
  if (!Number.isFinite(index) || !Number.isFinite(size)) {
    return null;
  }
  return `${index + 1}/${size}`;
}

function tempPart(record: Record<string, unknown>) {
  if (record.phase === null || record.phase === undefined) {
    return null;
  }
  const mode = record.executionMode === "whatsapp_real" ? "real" : "audit";
  const verified = record.verified === true ? "ok" : record.verified === false ? "falhou" : null;
  return [mode, String(record.phase), String(record.verifiedDuration ?? record.duration ?? ""), verified]
    .filter(Boolean)
    .join(":");
}

function navigationBadge(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const mode = (payload as Record<string, unknown>).navigationMode;
  if (mode === "reused-open-chat") {
    return <Badge variant="cyan">reuso</Badge>;
  }
  if (mode === "navigated") {
    return <Badge variant="neutral">navegou</Badge>;
  }
  const record = payload as Record<string, unknown>;
  const phase = record.phase;
  if (record.executionMode === "whatsapp_real" && record.verified === false) {
    return <Badge variant="danger">24h falhou</Badge>;
  }
  if (record.executionMode === "whatsapp_real" && phase === "before_send" && record.verified === true) {
    return <Badge variant="success">24h verificado</Badge>;
  }
  if (
    record.executionMode === "whatsapp_real" &&
    typeof phase === "string" &&
    phase.includes("restore") &&
    record.verified === true
  ) {
    return <Badge variant="success">restaurado {String(record.verifiedDuration ?? record.duration)}</Badge>;
  }
  if (typeof phase === "string" && phase.includes("restore")) {
    return <Badge variant="warning">24h/90d</Badge>;
  }
  if (phase === "before_send" || phase === "step_completed_keep_window") {
    return <Badge variant="cyan">24h</Badge>;
  }
  return null;
}

function isPausableCampaign(status: string) {
  return status === "running" || status === "scheduled";
}

function isResumableCampaign(status: string) {
  return status === "paused" || status === "draft";
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function formatDuration(value: number | null) {
  if (value === null) {
    return "—";
  }
  if (value < 60) {
    return `${value}s`;
  }
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return `${minutes}m ${seconds}s`;
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

interface PauseResumeSummary {
  lastAction: "paused" | "resumed";
  pausedAt: string;
  resumedAt: string;
}

function pauseResumeSummary(metadata: Record<string, unknown>): PauseResumeSummary | null {
  const raw = metadata.pauseResume;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const lastAction = record.lastAction;
  const pausedAt = typeof record.pausedAt === "string" ? record.pausedAt : "";
  const resumedAt = typeof record.resumedAt === "string" ? record.resumedAt : "";
  if (lastAction === "paused" && pausedAt) {
    return { lastAction, pausedAt, resumedAt };
  }
  if (lastAction === "resumed" && resumedAt) {
    return { lastAction, pausedAt, resumedAt };
  }
  return null;
}

interface EvergreenEvaluationSummary {
  at: string;
  contactsScanned: number;
  recipientsPlanned: number;
  recipientsCreated: number;
  recipientsSkipped: number;
}

function evergreenEvaluationSummary(
  metadata: Record<string, unknown>,
): EvergreenEvaluationSummary | null {
  const raw = metadata.lastEvergreenEvaluation;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const at = typeof record.at === "string" ? record.at : null;
  if (!at) {
    return null;
  }
  return {
    at,
    contactsScanned: numberFromUnknown(record.contactsScanned),
    recipientsPlanned: numberFromUnknown(record.recipientsPlanned),
    recipientsCreated: numberFromUnknown(record.recipientsCreated),
    recipientsSkipped: numberFromUnknown(record.recipientsSkipped),
  };
}

function numberFromUnknown(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}
