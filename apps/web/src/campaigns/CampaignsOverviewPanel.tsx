import type { inferRouterOutputs } from "@trpc/server";

import type { AppRouter } from "@nuoma/api";
import {
  Animate,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ErrorState,
} from "@nuoma/ui";

import {
  CampaignEvergreenPanel,
  CampaignMetric,
  evergreenEvaluationSummary,
} from "./CampaignOperationalPanels.js";

type CampaignTickResult = inferRouterOutputs<AppRouter>["campaigns"]["tick"];
type CampaignListItem = inferRouterOutputs<AppRouter>["campaigns"]["list"]["campaigns"][number];

type CampaignsOverviewPanelProps = {
  campaigns: CampaignListItem[];
  loading: boolean;
  error: string | null;
  lastTick: CampaignTickResult | null;
};

export function CampaignsOverviewPanel({
  campaigns,
  loading,
  error,
  lastTick,
}: CampaignsOverviewPanelProps) {
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
            <CampaignMetric label="em execução" value={runningCampaigns} />
            <CampaignMetric label="destinatários ativos" value={activeRecipients} />
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
                <div className="text-sm font-medium text-fg-primary">Última execução</div>
                <div className="font-mono text-xs text-fg-dim">
                  {lastTick.dryRun ? "simulação" : "execução real"} · {lastTick.plannedJobs.length}{" "}
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
                      destinatários
                    </div>
                  </div>
                  <Badge variant={campaign.status === "running" ? "cyan" : "neutral"}>
                    {campaignStatusLabel(campaign.status)}
                  </Badge>
                  <span className="font-mono text-xs text-fg-muted">
                    ok {campaign.metrics.completedSteps}
                  </span>
                  <span className="font-mono text-xs text-fg-muted">
                    falha {campaign.metrics.failedSteps}
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

function campaignStatusLabel(status: string): string {
  if (status === "running") return "em execução";
  if (status === "scheduled") return "agendada";
  if (status === "paused") return "pausada";
  if (status === "draft") return "rascunho";
  if (status === "completed") return "concluída";
  if (status === "cancelled") return "cancelada";
  return status;
}
