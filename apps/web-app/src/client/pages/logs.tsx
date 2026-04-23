import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
  const [levelFilter, setLevelFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);

  const logsQuery = useQuery({
    queryKey: ["logs", eventsPage, jobsPage],
    queryFn: () =>
      apiFetch<LogsResponse>(
        `/logs?limit=${LOGS_PAGE_SIZE}&eventsOffset=${eventsPage * LOGS_PAGE_SIZE}&jobsOffset=${jobsPage * LOGS_PAGE_SIZE}`
      ),
    refetchInterval: autoRefresh ? 20_000 : false
  });

  const events = logsQuery.data?.events ?? [];
  const jobs = logsQuery.data?.jobs ?? [];
  const hasNextEvents = events.length === LOGS_PAGE_SIZE;
  const hasNextJobs = jobs.length === LOGS_PAGE_SIZE;

  const filteredEvents = useMemo(() => {
    let filtered = events;
    if (levelFilter !== "all") filtered = filtered.filter(e => e.level === levelFilter);
    if (searchTerm.trim()) filtered = filtered.filter(e => e.message.toLowerCase().includes(searchTerm.toLowerCase()));
    return filtered;
  }, [events, levelFilter, searchTerm]);

  return (
    <div className="space-y-5">
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
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-micro text-n-text-dim cursor-pointer">
                <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} className="rounded" />
                Auto-refresh
              </label>
              <span className="text-micro text-n-text-dim">Max 20/pag</span>
            </div>
          </div>

          <div className="flex items-center gap-2 px-3 py-2 border-b border-n-border-subtle">
            <div className="relative flex-1 group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-n-text-dim" />
              <Input className="h-8 pl-9 pr-3 text-caption" placeholder="Buscar nos logs..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
            </div>
            <select className="h-8 rounded-xl border border-n-border bg-n-bg px-3 text-caption text-n-text-muted" value={levelFilter} onChange={(e) => setLevelFilter(e.target.value)}>
              <option value="all">Todos</option>
              <option value="error">Errors</option>
              <option value="warn">Warnings</option>
              <option value="info">Info</option>
              <option value="debug">Debug</option>
            </select>
          </div>

          <div className="max-h-[560px] overflow-y-auto custom-scrollbar divide-y divide-n-border-subtle">
            {filteredEvents.map((event) => (
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
            {!logsQuery.isLoading && filteredEvents.length === 0 ? (
              <div className="px-3 py-10 text-caption text-n-text-muted text-center">
                {events.length === 0 ? "Nenhum evento encontrado." : "Nenhum evento corresponde aos filtros."}
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
