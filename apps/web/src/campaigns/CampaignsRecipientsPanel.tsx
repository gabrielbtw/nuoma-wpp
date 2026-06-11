import type { inferRouterOutputs } from "@trpc/server";

import type { AppRouter } from "@nuoma/api";
import {
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
} from "@nuoma/ui";
import { useState } from "react";

import { ConfirmDangerAction } from "../components/ConfirmDangerAction.js";
import {
  CampaignAbVariantsPanel,
  CampaignEvergreenPanel,
  CampaignMetric,
  CampaignPauseResumePanel,
  CampaignRecipientsVirtualTable,
  CampaignStepStatsPanel,
  evergreenEvaluationSummary,
  formatDuration,
  pauseResumeSummary,
} from "./CampaignOperationalPanels.js";

type CampaignListItem = inferRouterOutputs<AppRouter>["campaigns"]["list"]["campaigns"][number];

type CampaignsRecipientsPanelProps = {
  campaigns: CampaignListItem[];
  loading: boolean;
  error: string | null;
  onPause: (campaignId: number) => void;
  onResume: (campaignId: number) => void;
  onToggleOverlay: (campaign: CampaignListItem) => void;
  onPreview: (campaignId: number) => void;
  onEnqueue: (campaignId: number, label: string, confirmText: string) => void;
  isPausePending: (campaignId: number) => boolean;
  isResumePending: (campaignId: number) => boolean;
  isOverlayPending: (campaignId: number) => boolean;
  isPreviewPending: (campaignId: number) => boolean;
  isEnqueuePending: (campaignId: number) => boolean;
};

export function CampaignsRecipientsPanel({
  campaigns,
  loading,
  error,
  onPause,
  onResume,
  onToggleOverlay,
  onPreview,
  onEnqueue,
  isPausePending,
  isResumePending,
  isOverlayPending,
  isPreviewPending,
  isEnqueuePending,
}: CampaignsRecipientsPanelProps) {
  const [confirmByCampaign, setConfirmByCampaign] = useState<Record<number, string>>({});
  const updateConfirm = (campaignId: number, value: string) =>
    setConfirmByCampaign((current) => ({ ...current, [campaignId]: value }));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Existentes</CardTitle>
        <CardDescription>
          {campaigns.length > 0 ? `${campaigns.length} campanhas` : "—"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState description={error} />
        ) : campaigns.length === 0 ? (
          <EmptyState title="Nenhuma campanha" description="Crie um rascunho no builder acima." />
        ) : (
          <ul className="flex flex-col gap-1">
            {campaigns.map((campaign) => (
              <li
                key={campaign.id}
                className="rounded-lg px-3 py-3 transition-shadow hover:bg-bg-base hover:shadow-flat"
                data-testid="campaign-list-item"
                data-campaign-id={campaign.id}
                data-campaign-status={campaign.status}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm">{campaign.name}</div>
                    <div className="font-mono text-xs text-fg-dim">
                      {campaign.steps.length} step(s) · {campaign.recipients.length} destinatário(s)
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-1">
                    {campaign.evergreen && <Badge variant="cyan">evergreen</Badge>}
                    <Badge
                      variant={isCampaignOverlayEnabled(campaign.metadata) ? "success" : "neutral"}
                    >
                      overlay {isCampaignOverlayEnabled(campaign.metadata) ? "sim" : "não"}
                    </Badge>
                    <Badge variant={campaign.status === "running" ? "success" : "neutral"}>
                      {campaign.status}
                    </Badge>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                  {isPausableCampaign(campaign.status) && (
                    <Button
                      variant="ghost"
                      size="xs"
                      data-testid="campaign-pause-button"
                      data-campaign-id={campaign.id}
                      loading={isPausePending(campaign.id)}
                      onClick={() => onPause(campaign.id)}
                    >
                      Pausar
                    </Button>
                  )}
                  {isResumableCampaign(campaign.status) && (
                    <Button
                      variant="accent"
                      size="xs"
                      data-testid="campaign-resume-button"
                      data-campaign-id={campaign.id}
                      loading={isResumePending(campaign.id)}
                      onClick={() => onResume(campaign.id)}
                    >
                      Retomar
                    </Button>
                  )}
                  <Button
                    variant={isCampaignOverlayEnabled(campaign.metadata) ? "soft" : "accent"}
                    size="xs"
                    data-testid="campaign-overlay-toggle"
                    data-campaign-id={campaign.id}
                    loading={isOverlayPending(campaign.id)}
                    onClick={() => onToggleOverlay(campaign)}
                  >
                    Overlay {isCampaignOverlayEnabled(campaign.metadata) ? "não" : "sim"}
                  </Button>
                  <Button
                    variant="soft"
                    size="xs"
                    data-testid="campaign-preview-button"
                    data-campaign-id={campaign.id}
                    loading={isPreviewPending(campaign.id)}
                    onClick={() => onPreview(campaign.id)}
                  >
                    Simular
                  </Button>
                  <ConfirmDangerAction
                    buttonLabel="Disparar"
                    confirmText="DISPARAR"
                    value={confirmByCampaign[campaign.id] ?? ""}
                    onValueChange={(value) => updateConfirm(campaign.id, value)}
                    disabled={!isPausableCampaign(campaign.status)}
                    loading={isEnqueuePending(campaign.id)}
                    onConfirm={() => onEnqueue(campaign.id, campaign.name, confirmByCampaign[campaign.id] ?? "")}
                    description={`Criará Jobs reais para ${campaign.name}.`}
                    testId="campaign-enqueue-confirm"
                  />
                </div>
                <CampaignPauseResumePanel
                  campaignId={campaign.id}
                  summary={pauseResumeSummary(campaign.metadata)}
                />
                <div className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
                  <CampaignMetric label="eventos" value={campaign.metrics.timelineEvents} />
                  <CampaignMetric label="ok" value={campaign.metrics.completedSteps} />
                  <CampaignMetric label="falhas" value={campaign.metrics.failedSteps} />
                  <CampaignMetric label="navegou" value={campaign.metrics.navigatedSteps} />
                  <CampaignMetric label="reuso" value={campaign.metrics.reusedOpenChatSteps} />
                  <CampaignMetric
                    label="tempo"
                    value={formatDuration(campaign.metrics.durationSeconds)}
                  />
                </div>
                {campaign.stepStats.length > 0 && (
                  <CampaignStepStatsPanel campaignId={campaign.id} stats={campaign.stepStats} />
                )}
                {campaign.abTest && (
                  <CampaignAbVariantsPanel campaignId={campaign.id} abTest={campaign.abTest} />
                )}
                {campaign.evergreen && (
                  <CampaignEvergreenPanel
                    campaignId={campaign.id}
                    summary={evergreenEvaluationSummary(campaign.metadata)}
                  />
                )}
                {campaign.recipients.length > 0 && (
                  <CampaignRecipientsVirtualTable
                    campaignId={campaign.id}
                    recipients={campaign.recipients}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function isCampaignOverlayEnabled(metadata: Record<string, unknown>): boolean {
  return metadata.overlayEnabled === true;
}

function isPausableCampaign(status: string) {
  return status === "running" || status === "scheduled";
}

function isResumableCampaign(status: string) {
  return status === "paused" || status === "draft";
}
