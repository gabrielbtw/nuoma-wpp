import type { inferRouterOutputs } from "@trpc/server";

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
} from "@nuoma/ui";

import { CampaignMetric, Metric } from "./CampaignOperationalPanels.js";
import { SafeRemarketingConsole } from "./SafeRemarketingConsole.js";

type CampaignListItem = inferRouterOutputs<AppRouter>["campaigns"]["list"]["campaigns"][number];
type CampaignReadyResult = inferRouterOutputs<AppRouter>["campaigns"]["ready"];
type CampaignTickResult = inferRouterOutputs<AppRouter>["campaigns"]["tick"];
type RemarketingBatchReadyResult =
  inferRouterOutputs<AppRouter>["campaigns"]["remarketingBatchReady"];
type RemarketingBatchDispatchResult =
  inferRouterOutputs<AppRouter>["campaigns"]["remarketingBatchDispatch"];

type CampaignsDispatchPanelProps = {
  campaigns: CampaignListItem[];
  selectedCampaignId: number | null;
  selectedValue: string;
  onSelect: (value: string) => void;
  confirmation: string;
  onConfirmationChange: (value: string) => void;
  readiness: CampaignReadyResult | null;
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
  batchReady: RemarketingBatchReadyResult | null;
  batchReadyPending: boolean;
  batchReadyError: string | null;
  batchDispatchPending: boolean;
  lastBatchDispatch: RemarketingBatchDispatchResult | null;
  enqueuePending: boolean;
  intent: string | null;
  lastTick: CampaignTickResult | null;
  globalPreviewPending: boolean;
  globalEnqueuePending: boolean;
  onReady: () => void;
  onEnqueue: () => void;
  onBatchReady: () => void;
  onBatchDispatch: () => void;
  onGlobalPreview: () => void;
  onGlobalEnqueue: () => void;
};

export function CampaignsDispatchPanel({
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
  intent,
  lastTick,
  globalPreviewPending,
  globalEnqueuePending,
  onReady,
  onEnqueue,
  onBatchReady,
  onBatchDispatch,
  onGlobalPreview,
  onGlobalEnqueue,
}: CampaignsDispatchPanelProps) {
  return (
    <>
      <SafeRemarketingConsole
        campaigns={campaigns}
        selectedCampaignId={selectedCampaignId}
        selectedValue={selectedValue}
        onSelect={onSelect}
        confirmation={confirmation}
        onConfirmationChange={onConfirmationChange}
        readiness={readiness}
        loadingReady={loadingReady}
        readyError={readyError}
        batchPhones={batchPhones}
        onBatchPhonesChange={onBatchPhonesChange}
        batchAllowedPhone={batchAllowedPhone}
        onBatchAllowedPhoneChange={onBatchAllowedPhoneChange}
        batchAllowedInstagram={batchAllowedInstagram}
        onBatchAllowedInstagramChange={onBatchAllowedInstagramChange}
        batchConfirmation={batchConfirmation}
        onBatchConfirmationChange={onBatchConfirmationChange}
        batchReady={batchReady}
        batchReadyPending={batchReadyPending}
        batchReadyError={batchReadyError}
        batchDispatchPending={batchDispatchPending}
        lastBatchDispatch={lastBatchDispatch}
        enqueuePending={enqueuePending}
        onReady={onReady}
        onEnqueue={onEnqueue}
        onBatchReady={onBatchReady}
        onBatchDispatch={onBatchDispatch}
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
              <Button variant="accent" loading={globalPreviewPending} onClick={onGlobalPreview}>
                Rodar prévia
              </Button>
              <Button variant="soft" loading={globalEnqueuePending} onClick={onGlobalEnqueue}>
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
    </>
  );
}
