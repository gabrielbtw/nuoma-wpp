import type { AppRouter } from "@nuoma/api";
import type { inferRouterOutputs } from "@trpc/server";
import { Activity, AlertTriangle, Clock3, HardDrive, Radio, Send, ServerCog } from "lucide-react";
import { lazy, Suspense, type ReactNode } from "react";

import {
  Animate,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  LoadingState,
  SignalDot,
  TimeAgo,
} from "@nuoma/ui";

import { trpc } from "../lib/trpc.js";
import { useOptionalVisualMode } from "../visuals/optional-visual-mode.js";

type SystemMetrics = inferRouterOutputs<AppRouter>["system"]["metrics"];
type WorkerItem = SystemMetrics["workers"]["items"][number];

const OptionalCartographicHero = lazy(() => import("../visuals/OptionalCartographicHero.js"));

export function DashboardPage() {
  const optionalVisual = useOptionalVisualMode();
  const metrics = trpc.system.metrics.useQuery(undefined, {
    refetchInterval: 10_000,
  });

  if (metrics.isLoading) {
    return (
      <div className="max-w-6xl mx-auto pt-10">
        <LoadingState description="Carregando painel operacional." />
      </div>
    );
  }

  if (metrics.error || !metrics.data) {
    return (
      <div className="max-w-6xl mx-auto pt-10">
        <ErrorState description={metrics.error?.message ?? "Dashboard indisponível."} />
      </div>
    );
  }

  const data = metrics.data;
  const health = overallHealth(data);

  return (
    <div className="flex flex-col gap-7 max-w-7xl mx-auto pt-2">
      {optionalVisual.enabled && (
        <Animate preset="rise-in">
          <Suspense fallback={<OptionalHeroFallback />}>
            <OptionalCartographicHero
              healthLabel={health.label}
              healthSignal={health.signal}
              cdpConnected={data.whatsapp.cdpConnected}
              workersOnline={data.workers.online}
              workersTotal={data.workers.total}
              queueDepth={data.jobs.queued + data.jobs.active}
              dlqCount={data.jobs.dead}
              throughputPerHour={data.operations.throughputPerHour}
              failureRatePct={data.operations.failureRatePct}
            />
          </Suspense>
        </Animate>
      )}

      <Animate preset="rise-in">
        <header className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="botforge-kicker">
              Operação
            </p>
            <h1 className="botforge-title mt-2 text-5xl md:text-6xl">
              Implantação <span className="text-brand-cyan">sob controle</span>.
            </h1>
            <p className="text-sm text-fg-muted mt-3 max-w-2xl">
              Saúde da API, workers, sessão WhatsApp, fila, DLQ e eventos críticos.
            </p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-xl bg-bg-base px-4 py-3 shadow-flat text-xs font-mono text-fg-muted">
            <SignalDot status={health.signal} size="xs" />
            {health.label} · atualizado{" "}
            {new Date().toLocaleTimeString("pt-BR", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </div>
        </header>
      </Animate>

      <Animate preset="rise-in" delaySeconds={0.05}>
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <MetricTile
            icon={<Activity className="h-4 w-4" />}
            label="API"
            value={formatUptime(data.health.uptimeSeconds)}
            detail={data.health.version}
            signal="active"
          />
          <MetricTile
            icon={<Radio className="h-4 w-4" />}
            label="WhatsApp/CDP"
            value={sessionLabel(data.whatsapp.sessionStatus)}
            detail={`${data.workers.browserConnected}/${data.workers.total} conectado(s)`}
            signal={data.whatsapp.cdpConnected ? "active" : "degraded"}
          />
          <MetricTile
            icon={<ServerCog className="h-4 w-4" />}
            label="Workers"
            value={`${data.workers.online}/${data.workers.total}`}
            detail={`${data.workers.stale} stale · ${data.workers.withErrors} erro(s)`}
            signal={
              data.workers.withErrors > 0 ? "error" : data.workers.stale > 0 ? "degraded" : "active"
            }
          />
          <MetricTile
            icon={<Clock3 className="h-4 w-4" />}
            label="Fila"
            value={data.jobs.queued + data.jobs.active}
            detail={`${data.jobs.queued} queued · ${data.jobs.active} active`}
            signal={data.jobs.active > 0 ? "idle" : "active"}
          />
          <MetricTile
            icon={<AlertTriangle className="h-4 w-4" />}
            label="DLQ"
            value={data.jobs.dead}
            detail={`${data.jobs.failed} failed no job table`}
            signal={data.jobs.dead > 0 || data.jobs.failed > 0 ? "degraded" : "active"}
          />
          <MetricTile
            icon={<Send className="h-4 w-4" />}
            label="Envio"
            value={data.sendPolicy.apiMode}
            detail={
              data.sendPolicy.apiAllowedPhonesConfigured ? "canário configurado" : "sem canário API"
            }
            signal={data.sendPolicy.apiMode === "test" ? "idle" : "active"}
          />
        </section>
      </Animate>

      <Animate preset="rise-in" delaySeconds={0.08}>
        <Card data-testid="operational-metrics-panel">
          <CardHeader>
            <CardTitle>Métricas operacionais</CardTitle>
            <CardDescription>
              Throughput, falhas e latências calculados pela fila na última hora.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <OperationalMetric
                label="Throughput"
                value={`${data.operations.throughputPerHour}/h`}
                detail={`${data.operations.terminalLastHour} terminal(is) desde ${formatClock(data.operations.since)}`}
              />
              <OperationalMetric
                label="Falha"
                value={`${data.operations.failureRatePct}%`}
                detail={`${data.operations.failedLastHour} falha(s) · ${data.operations.completedLastHour} ok`}
              />
              <OperationalMetric
                label="Espera média"
                value={formatDurationMs(data.operations.avgQueueLatencyMs)}
                detail="scheduled_at → claimed_at"
              />
              <OperationalMetric
                label="Execução média"
                value={formatDurationMs(data.operations.avgRunLatencyMs)}
                detail={`pior ${formatDurationMs(data.operations.maxRunLatencyMs)}`}
              />
            </div>
          </CardContent>
        </Card>
      </Animate>

      <section className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <Animate preset="rise-in" delaySeconds={0.1}>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle>Workers e sessão</CardTitle>
                  <CardDescription>
                    Heartbeat, CDP, memória e job atual de cada runtime.
                  </CardDescription>
                </div>
                <Badge variant={data.workers.browserConnected > 0 ? "success" : "warning"}>
                  {data.whatsapp.cdpConnected ? "CDP ativo" : "CDP ausente"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {data.workers.items.length === 0 ? (
                <EmptyState description="Nenhum worker reportou heartbeat." />
              ) : (
                <ul className="flex flex-col gap-2">
                  {data.workers.items.map((worker) => (
                    <WorkerRow key={worker.workerId} worker={worker} />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </Animate>

        <Animate preset="rise-in" delaySeconds={0.15}>
          <Card>
            <CardHeader>
              <CardTitle>Eventos críticos</CardTitle>
              <CardDescription>Últimos `warn` e `error` de `system_events`.</CardDescription>
            </CardHeader>
            <CardContent>
              {data.criticalEvents.length === 0 ? (
                <EmptyState description="Sem evento crítico recente." />
              ) : (
                <ul className="flex flex-col gap-2">
                  {data.criticalEvents.map((event) => (
                    <li key={event.id} className="rounded-lg bg-bg-base px-3 py-3 shadow-flat">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <SignalDot
                              status={event.severity === "error" ? "error" : "degraded"}
                              size="xs"
                            />
                            <span className="truncate text-sm font-medium">{event.type}</span>
                          </div>
                          <div className="mt-1 font-mono text-[0.65rem] text-fg-dim">
                            <TimeAgo date={event.createdAt} />
                          </div>
                        </div>
                        <Badge variant={event.severity === "error" ? "danger" : "warning"}>
                          {event.severity}
                        </Badge>
                      </div>
                      <PayloadPreview payload={event.payload} />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </Animate>
      </section>

      <section className="grid gap-5 xl:grid-cols-[0.85fr_1.15fr]">
        <Animate preset="rise-in" delaySeconds={0.2}>
          <Card>
            <CardHeader>
              <CardTitle>Fila e DLQ</CardTitle>
              <CardDescription>Contagem por status persistida no SQLite.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(data.jobsByStatus).length === 0 ? (
                  <div className="col-span-2">
                    <EmptyState description="Nenhum job persistido." />
                  </div>
                ) : (
                  Object.entries(data.jobsByStatus).map(([status, count]) => (
                    <div key={status} className="rounded-lg bg-bg-base px-3 py-3 shadow-flat">
                      <div className="text-[0.65rem] uppercase tracking-widest text-fg-dim font-mono">
                        {status}
                      </div>
                      <div className="mt-1 text-2xl font-semibold tabular-nums">{count}</div>
                    </div>
                  ))
                )}
                <div className="rounded-lg bg-bg-base px-3 py-3 shadow-flat">
                  <div className="text-[0.65rem] uppercase tracking-widest text-fg-dim font-mono">
                    jobs_dead
                  </div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums">{data.jobs.dead}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </Animate>

        <Animate preset="rise-in" delaySeconds={0.25}>
          <Card>
            <CardHeader>
              <CardTitle>Jobs recentes</CardTitle>
              <CardDescription>Últimos registros da fila operacional.</CardDescription>
            </CardHeader>
            <CardContent>
              {data.jobs.recent.length === 0 ? (
                <EmptyState description="Sem jobs recentes." />
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {data.jobs.recent.map((job) => (
                    <li
                      key={job.id}
                      className="grid grid-cols-[4rem_1fr_auto] items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-bg-base hover:shadow-flat"
                    >
                      <span className="font-mono text-xs text-fg-dim">#{job.id}</span>
                      <div className="min-w-0">
                        <div className="truncate text-sm">{job.type}</div>
                        <div className="text-[0.65rem] text-fg-dim font-mono">
                          <TimeAgo date={job.scheduledAt} />
                        </div>
                      </div>
                      <Badge variant={jobStatusVariant(job.status)}>{job.status}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </Animate>
      </section>
    </div>
  );
}

function OptionalHeroFallback() {
  return (
    <section
      className="min-h-[18rem] rounded-xl bg-bg-sunken shadow-flat"
      data-testid="v214a-cartographic-hero-loading"
    />
  );
}

function OperationalMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: ReactNode;
  detail: string;
}) {
  return (
    <div className="rounded-lg bg-bg-base px-3 py-3 shadow-flat">
      <div className="text-[0.65rem] uppercase tracking-widest text-fg-dim font-mono">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      <div className="mt-1 min-h-4 text-xs text-fg-muted">{detail}</div>
    </div>
  );
}

function MetricTile({
  icon,
  label,
  value,
  detail,
  signal,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  detail: string;
  signal: "active" | "idle" | "error" | "degraded";
}) {
  return (
    <div className="rounded-xl bg-bg-base px-4 py-4 shadow-flat">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-bg-base text-brand-cyan shadow-pressed-sm">
          {icon}
        </span>
        <SignalDot status={signal} size="sm" />
      </div>
      <div className="mt-4 text-[0.65rem] uppercase tracking-[0.2em] text-fg-muted font-mono">
        {label}
      </div>
      <div className="mt-1 min-h-9 text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
      <div className="mt-1 min-h-4 text-xs text-fg-muted">{detail}</div>
    </div>
  );
}

function WorkerRow({ worker }: { worker: WorkerItem }) {
  const status = worker.stale ? "stale" : worker.status;
  return (
    <li className="rounded-lg bg-bg-base px-3 py-3 shadow-flat">
      <div className="grid gap-3 md:grid-cols-[1.1fr_0.9fr_0.7fr] md:items-center">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <SignalDot status={workerSignal(worker)} size="sm" />
            <span className="truncate text-sm font-medium">{worker.workerId}</span>
            <Badge variant={workerStatusVariant(status)}>{status}</Badge>
          </div>
          <div className="mt-1 font-mono text-[0.65rem] text-fg-dim">
            heartbeat há {worker.heartbeatAgeSeconds}s · pid {worker.pid ?? "—"}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant={worker.cdpConnected && !worker.stale ? "success" : "warning"}>
            CDP {worker.cdpConnected && !worker.stale ? "conectado" : "off"}
          </Badge>
          <Badge variant={worker.currentJobId ? "info" : "neutral"}>
            job {worker.currentJobId ?? "nenhum"}
          </Badge>
        </div>
        <div className="flex items-center gap-2 text-xs text-fg-muted md:justify-end">
          <HardDrive className="h-3.5 w-3.5 text-fg-dim" />
          <span>{worker.rssMb ?? "—"} MB</span>
        </div>
      </div>
      {worker.lastError && (
        <div className="mt-2 rounded-md bg-semantic-danger/10 px-2 py-1.5 text-xs text-semantic-danger">
          {worker.lastError}
        </div>
      )}
    </li>
  );
}

function PayloadPreview({ payload }: { payload: unknown }) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const text = JSON.stringify(payload);
  if (!text || text === "{}") return null;
  return (
    <pre className="mt-2 max-h-20 overflow-hidden rounded-md bg-bg-elevated px-2 py-1.5 text-[0.65rem] leading-4 text-fg-dim">
      {text}
    </pre>
  );
}

function overallHealth(data: SystemMetrics): {
  label: string;
  signal: "active" | "idle" | "error" | "degraded";
} {
  if (
    data.workers.withErrors > 0 ||
    data.criticalEvents.some((event) => event.severity === "error")
  ) {
    return { label: "atenção", signal: "error" };
  }
  if (!data.whatsapp.cdpConnected || data.jobs.dead > 0 || data.workers.stale > 0) {
    return { label: "degradado", signal: "degraded" };
  }
  return { label: "saudável", signal: "active" };
}

function workerSignal(worker: WorkerItem): "active" | "idle" | "error" | "degraded" {
  if (worker.status === "error" || worker.lastError) return "error";
  if (worker.stale) return "degraded";
  if (worker.status === "busy") return "idle";
  return "active";
}

function workerStatusVariant(
  status: string,
): "neutral" | "info" | "success" | "warning" | "danger" {
  if (status === "error") return "danger";
  if (status === "busy") return "info";
  if (status === "idle") return "success";
  if (status === "stale" || status === "stopping") return "warning";
  return "neutral";
}

function jobStatusVariant(status: string): "neutral" | "info" | "success" | "warning" | "danger" {
  if (status === "completed") return "success";
  if (status === "failed" || status === "cancelled") return "danger";
  if (status === "claimed" || status === "running") return "info";
  if (status === "queued") return "warning";
  return "neutral";
}

function sessionLabel(status: string): string {
  if (status === "connected") return "conectado";
  if (status === "no_worker") return "sem worker";
  return "desconectado";
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}

function formatDurationMs(value: number | null): string {
  if (value == null) return "—";
  if (value < 1_000) return `${value}ms`;
  const seconds = value / 1_000;
  if (seconds < 60) return `${seconds.toFixed(seconds >= 10 ? 0 : 1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m${remainingSeconds.toString().padStart(2, "0")}s`;
}

function formatClock(value: string): string {
  return new Date(value).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
