import { Activity, AlertCircle, Clock3, ListChecks, Loader2 } from "lucide-react";

import type { Job, JobStatus } from "@nuoma/contracts";
import { cn } from "@nuoma/ui";

const activeQueueStatuses = new Set<JobStatus>(["queued", "claimed", "running"]);

export interface ConversationQueueSummary {
  total: number;
  queued: number;
  claimed: number;
  running: number;
  nextScheduledAt: string | null;
}

export function summarizeConversationQueue(
  jobs: Job[],
  conversationId: number | null,
): ConversationQueueSummary {
  if (conversationId == null || jobs.length === 0) {
    return emptyQueueSummary();
  }

  let queued = 0;
  let claimed = 0;
  let running = 0;
  let nextScheduledAt: string | null = null;

  for (const job of jobs) {
    if (!activeQueueStatuses.has(job.status)) continue;
    if (numberFromPayload(job.payload.conversationId) !== conversationId) continue;

    if (job.status === "queued") queued += 1;
    if (job.status === "claimed") claimed += 1;
    if (job.status === "running") running += 1;
    if (!nextScheduledAt || job.scheduledAt < nextScheduledAt) {
      nextScheduledAt = job.scheduledAt;
    }
  }

  return {
    total: queued + claimed + running,
    queued,
    claimed,
    running,
    nextScheduledAt,
  };
}

export function QueueIndicator({
  summary,
  loading,
  error,
}: {
  summary: ConversationQueueSummary;
  loading?: boolean;
  error?: string | null;
}) {
  const hasJobs = summary.total > 0;
  const Icon = error ? AlertCircle : loading ? Loader2 : hasJobs ? ListChecks : Clock3;

  return (
    <div
      data-testid="conversation-queue-indicator"
      data-queue-count={summary.total}
      data-queue-queued={summary.queued}
      data-queue-claimed={summary.claimed}
      data-queue-running={summary.running}
      className={cn(
        "inline-flex h-9 max-w-full items-center gap-2 rounded-lg border px-2.5 text-xs shadow-flat",
        "transition-shadow hover:shadow-raised-sm",
        hasJobs
          ? "border-brand-cyan/35 bg-brand-cyan/10 text-brand-cyan"
          : "border-contour-line/50 bg-bg-base text-fg-muted",
        error && "border-semantic-danger/35 bg-semantic-danger/10 text-semantic-danger",
      )}
      title={queueTitle(summary, error)}
      aria-label={queueTitle(summary, error)}
    >
      <Icon className={cn("h-3.5 w-3.5 shrink-0", loading && "animate-spin")} />
      <span className="font-mono uppercase tracking-widest">
        Fila {summary.total} {summary.total === 1 ? "job" : "jobs"}
      </span>
      {hasJobs ? (
        <span className="hidden items-center gap-1.5 text-[0.65rem] text-fg-muted md:inline-flex">
          <QueuePart label="Q" value={summary.queued} />
          <QueuePart label="C" value={summary.claimed} />
          <QueuePart label="R" value={summary.running} />
        </span>
      ) : null}
      {hasJobs ? <Activity className="h-3 w-3 shrink-0 opacity-75" /> : null}
    </div>
  );
}

function QueuePart({ label, value }: { label: string; value: number }) {
  return (
    <span className="font-mono tabular-nums">
      {label}:{value}
    </span>
  );
}

function queueTitle(summary: ConversationQueueSummary, error?: string | null): string {
  if (error) return `Falha ao ler fila: ${error}`;
  if (summary.total === 0) return "Fila sem jobs ativos para esta conversa";
  const next = summary.nextScheduledAt
    ? ` · próximo ${new Date(summary.nextScheduledAt).toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })}`
    : "";
  return `Fila com ${summary.total} jobs: ${summary.queued} queued, ${summary.claimed} claimed, ${summary.running} running${next}`;
}

function emptyQueueSummary(): ConversationQueueSummary {
  return {
    total: 0,
    queued: 0,
    claimed: 0,
    running: 0,
    nextScheduledAt: null,
  };
}

function numberFromPayload(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}
