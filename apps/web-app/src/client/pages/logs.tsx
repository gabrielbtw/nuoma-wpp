import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/page-header";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { LogsResponse } from "@/lib/system-types";

const LOGS_PAGE_SIZE = 20;

function LogsPager({
  page,
  hasNext,
  onPrevious,
  onNext
}: {
  page: number;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex items-center justify-between border-t border-n-border px-3 py-2 text-micro text-n-text-dim">
      <span>Pagina {page + 1}</span>
      <div className="flex items-center gap-2">
        <button
          className="rounded-lg border border-n-border px-2.5 py-1.5 text-caption text-n-text-muted transition-fast hover:bg-n-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
          onClick={onPrevious}
          disabled={page === 0}
        >
          Anterior
        </button>
        <button
          className="rounded-lg border border-n-border px-2.5 py-1.5 text-caption text-n-text-muted transition-fast hover:bg-n-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
          onClick={onNext}
          disabled={!hasNext}
        >
          Proxima
        </button>
      </div>
    </div>
  );
}

function levelToBadgeTone(level: string) {
  if (level === "error") return "danger";
  if (level === "warn") return "warning";
  return "info";
}

function jobStatusDot(status: string) {
  if (status === "done") return "active";
  if (status === "failed") return "error";
  if (status === "processing") return "warning";
  return "idle";
}

export function LogsPage() {
  const [eventsPage, setEventsPage] = useState(0);
  const [jobsPage, setJobsPage] = useState(0);

  const logsQuery = useQuery({
    queryKey: ["logs", eventsPage, jobsPage],
    queryFn: () =>
      apiFetch<LogsResponse>(
        `/logs?limit=${LOGS_PAGE_SIZE}&eventsOffset=${eventsPage * LOGS_PAGE_SIZE}&jobsOffset=${jobsPage * LOGS_PAGE_SIZE}`
      ),
    refetchInterval: 20_000
  });

  const events = logsQuery.data?.events ?? [];
  const jobs = logsQuery.data?.jobs ?? [];
  const hasNextEvents = events.length === LOGS_PAGE_SIZE;
  const hasNextJobs = jobs.length === LOGS_PAGE_SIZE;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Observabilidade"
        title="Logs"
        description="Eventos recentes e jobs recentes com paginacao independente."
      />

      <div className="grid gap-4 xl:grid-cols-2">
        {/* Events panel */}
        <div className="rounded-xl border border-n-border bg-n-surface overflow-hidden">
          <div className="flex items-center justify-between border-b border-n-border px-3 py-2">
            <h3 className="text-label text-n-text">Eventos recentes</h3>
            <span className="text-micro text-n-text-dim">Max 20/pag</span>
          </div>

          <div className="max-h-[560px] overflow-y-auto custom-scrollbar divide-y divide-n-border-subtle">
            {events.map((event) => (
              <div key={event.id} className="px-3 py-2 flex items-start gap-3">
                <span className="text-caption font-mono text-n-text-dim shrink-0 pt-0.5">
                  {new Date(event.created_at).toLocaleTimeString()}
                </span>
                <Badge tone={levelToBadgeTone(event.level)} className="shrink-0 text-micro">
                  {event.level}
                </Badge>
                <span className="text-caption font-mono text-n-text break-all leading-relaxed">
                  {event.message}
                </span>
              </div>
            ))}
            {!logsQuery.isLoading && events.length === 0 ? (
              <div className="px-3 py-10 text-caption text-n-text-muted text-center">
                Nenhum evento encontrado.
              </div>
            ) : null}
          </div>

          <LogsPager
            page={eventsPage}
            hasNext={hasNextEvents}
            onPrevious={() => setEventsPage((current) => Math.max(0, current - 1))}
            onNext={() => setEventsPage((current) => current + 1)}
          />
        </div>

        {/* Jobs panel */}
        <div className="rounded-xl border border-n-border bg-n-surface overflow-hidden">
          <div className="flex items-center justify-between border-b border-n-border px-3 py-2">
            <h3 className="text-label text-n-text">Jobs recentes</h3>
            <span className="text-micro text-n-text-dim">Max 20/pag</span>
          </div>

          <div className="max-h-[560px] overflow-y-auto custom-scrollbar divide-y divide-n-border-subtle">
            {jobs.map((job) => (
              <div key={job.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className={cn("signal-dot", jobStatusDot(job.status))} />
                  <div className="min-w-0">
                    <div className="text-caption font-mono text-n-text truncate">{job.type}</div>
                    <div className="text-micro text-n-text-dim">
                      {new Date(job.updated_at).toLocaleString()}
                    </div>
                  </div>
                </div>
                <Badge
                  tone={job.status === "done" ? "success" : job.status === "failed" ? "danger" : "info"}
                  className="shrink-0 text-micro"
                >
                  {job.status}
                </Badge>
              </div>
            ))}
            {!logsQuery.isLoading && jobs.length === 0 ? (
              <div className="px-3 py-10 text-caption text-n-text-muted text-center">
                Nenhum job encontrado.
              </div>
            ) : null}
          </div>

          <LogsPager
            page={jobsPage}
            hasNext={hasNextJobs}
            onPrevious={() => setJobsPage((current) => Math.max(0, current - 1))}
            onNext={() => setJobsPage((current) => current + 1)}
          />
        </div>
      </div>
    </div>
  );
}
