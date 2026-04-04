import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { apiFetch } from "@/lib/api";
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
    <div className="flex items-center justify-between border-t border-white/6 px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-500">
      <span>Página {page + 1}</span>
      <div className="flex items-center gap-2">
        <button
          className="rounded-xl border border-white/10 px-3 py-2 text-slate-300 transition hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-40"
          onClick={onPrevious}
          disabled={page === 0}
        >
          Anterior
        </button>
        <button
          className="rounded-xl border border-white/10 px-3 py-2 text-slate-300 transition hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-40"
          onClick={onNext}
          disabled={!hasNext}
        >
          Próxima
        </button>
      </div>
    </div>
  );
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
    <div className="space-y-8">
      <PageHeader
        eyebrow="Observabilidade"
        title="Logs"
        description="Eventos recentes e jobs recentes com paginação independente, sem poluir a leitura do restante da tela."
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Eventos recentes</CardTitle>
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Máximo de 20 por página</span>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-[580px] divide-y divide-white/6 overflow-y-auto custom-scrollbar">
              {events.map((event) => (
                <div key={event.id} className="px-6 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <Badge tone={event.level === "error" ? "danger" : event.level === "warn" ? "warning" : "info"}>{event.level}</Badge>
                    <span className="text-xs text-slate-500">{new Date(event.created_at).toLocaleString()}</span>
                  </div>
                  <div className="mt-2 text-sm leading-relaxed text-slate-200">{event.message}</div>
                </div>
              ))}
              {!logsQuery.isLoading && events.length === 0 ? <div className="px-6 py-12 text-sm text-slate-400">Nenhum evento encontrado.</div> : null}
            </div>
            <LogsPager
              page={eventsPage}
              hasNext={hasNextEvents}
              onPrevious={() => setEventsPage((current) => Math.max(0, current - 1))}
              onNext={() => setEventsPage((current) => current + 1)}
            />
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Jobs recentes</CardTitle>
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Máximo de 20 por página</span>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-[580px] divide-y divide-white/6 overflow-y-auto custom-scrollbar">
              {jobs.map((job) => (
                <div key={job.id} className="flex items-center justify-between gap-3 px-6 py-4">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-white">{job.type}</div>
                    <div className="text-xs text-slate-500">{new Date(job.updated_at).toLocaleString()}</div>
                  </div>
                  <Badge tone={job.status === "done" ? "success" : job.status === "failed" ? "danger" : "info"}>{job.status}</Badge>
                </div>
              ))}
              {!logsQuery.isLoading && jobs.length === 0 ? <div className="px-6 py-12 text-sm text-slate-400">Nenhum job encontrado.</div> : null}
            </div>
            <LogsPager
              page={jobsPage}
              hasNext={hasNextJobs}
              onPrevious={() => setJobsPage((current) => Math.max(0, current - 1))}
              onNext={() => setJobsPage((current) => current + 1)}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
