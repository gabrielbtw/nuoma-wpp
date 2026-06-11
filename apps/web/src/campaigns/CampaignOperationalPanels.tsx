import { useRef, type CSSProperties } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { inferRouterOutputs } from "@trpc/server";

import type { AppRouter } from "@nuoma/api";
import { Badge } from "@nuoma/ui";

type CampaignListItem = inferRouterOutputs<AppRouter>["campaigns"]["list"]["campaigns"][number];
type CampaignRecipientItem = CampaignListItem["recipients"][number];

export interface PauseResumeSummary {
  lastAction: "paused" | "resumed";
  pausedAt: string;
  resumedAt: string;
}

export interface EvergreenEvaluationSummary {
  at: string;
  contactsScanned: number;
  recipientsPlanned: number;
  recipientsCreated: number;
  recipientsSkipped: number;
}

export function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-bg-base px-3 py-3 shadow-pressed-sm">
      <div className="text-[0.65rem] uppercase tracking-widest text-fg-dim font-mono">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}

export function CampaignMetric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md bg-bg-base px-2.5 py-2 shadow-pressed-sm">
      <div className="font-mono text-[0.6rem] uppercase tracking-widest text-fg-dim">{label}</div>
      <div className="mt-0.5 truncate font-mono text-xs text-fg-primary">{value}</div>
    </div>
  );
}

export function CampaignPauseResumePanel({
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

export function CampaignStepStatsPanel({
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
            Estatísticas por Step
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
                  {step.type} · espera {step.delaySeconds}s
                </div>
              </div>
              <Badge variant={step.failedRecipients > 0 ? "warning" : "success"}>
                {formatPercent(step.completionRate)}
              </Badge>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-1.5">
              <MiniMetric label="ok" value={step.completedRecipients} />
              <MiniMetric label="falha" value={step.failedRecipients} />
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

export function CampaignRecipientsVirtualTable({
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
            Destinatários virtualizados
          </div>
          <div className="mt-0.5 text-xs text-fg-muted">
            {recipients.length} destinatário(s) · {virtualItems.length} visíveis
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
        aria-label={`Destinatários da campanha ${campaignId}`}
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

export function CampaignEvergreenPanel({
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
        <MiniMetric label="planej." value={summary?.recipientsPlanned ?? 0} />
        <MiniMetric label="criados" value={summary?.recipientsCreated ?? 0} />
        <MiniMetric label="pulados" value={summary?.recipientsSkipped ?? 0} />
      </div>
    </div>
  );
}

export function CampaignAbVariantsPanel({
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
            Variantes A/B
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
              <MiniMetric label="falha" value={variant.failedRecipients} />
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
          <Badge variant={recipientStatusVariant(recipient.status)}>
            {recipientStatusLabel(recipient.status)}
          </Badge>
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
                    {event.severity === "warn" ? "aviso" : event.severity}
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

function recipientStatusVariant(status: string) {
  if (status === "completed") return "success";
  if (status === "failed") return "danger";
  if (status === "skipped") return "warning";
  if (status === "running") return "info";
  return "neutral";
}

function recipientStatusLabel(status: string): string {
  if (status === "queued") return "na fila";
  if (status === "running") return "em execução";
  if (status === "completed") return "concluído";
  if (status === "failed") return "com falha";
  if (status === "skipped") return "pulado";
  if (status === "waiting") return "aguardando";
  return status;
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
  return [
    mode,
    String(record.phase),
    String(record.verifiedDuration ?? record.duration ?? ""),
    verified,
  ]
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
  if (
    record.executionMode === "whatsapp_real" &&
    phase === "before_send" &&
    record.verified === true
  ) {
    return <Badge variant="success">24h verificado</Badge>;
  }
  if (
    record.executionMode === "whatsapp_real" &&
    typeof phase === "string" &&
    phase.includes("restore") &&
    record.verified === true
  ) {
    return (
      <Badge variant="success">
        restaurado {String(record.verifiedDuration ?? record.duration)}
      </Badge>
    );
  }
  if (typeof phase === "string" && phase.includes("restore")) {
    return <Badge variant="warning">24h/90d</Badge>;
  }
  if (phase === "before_send" || phase === "step_completed_keep_window") {
    return <Badge variant="cyan">24h</Badge>;
  }
  return null;
}

export function formatTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

export function formatDuration(value: number | null) {
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

export function pauseResumeSummary(metadata: Record<string, unknown>): PauseResumeSummary | null {
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

export function evergreenEvaluationSummary(
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
