import type { inferRouterOutputs } from "@trpc/server";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Database,
  Radio,
  ServerCog,
} from "lucide-react";
import type { ReactNode } from "react";

import type { AppRouter } from "@nuoma/api";
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

type SystemMetrics = inferRouterOutputs<AppRouter>["system"]["metrics"];
type WorkerItem = SystemMetrics["workers"]["items"][number];
type SendAuditEvent = inferRouterOutputs<AppRouter>["system"]["sendAuditEvents"]["events"][number];
type CriticalEvent = SystemMetrics["criticalEvents"][number];

export function OperationsPage() {
  const metrics = trpc.system.metrics.useQuery(undefined, {
    refetchInterval: 5_000,
  });
  const sendAudit = trpc.system.sendAuditEvents.useQuery(
    { limit: 12 },
    {
      refetchInterval: 5_000,
    },
  );

  if (metrics.isLoading) {
    return (
      <div className="mx-auto max-w-6xl pt-10">
        <LoadingState description="Carregando operação." />
      </div>
    );
  }

  if (metrics.error || !metrics.data) {
    return (
      <div className="mx-auto max-w-6xl pt-10">
        <ErrorState description={metrics.error?.message ?? "Operação indisponível."} />
      </div>
    );
  }

  const data = metrics.data;
  const health = operationHealth(data);
  const auditEvents = sendAudit.data?.events ?? [];

  return (
    <div className="flex min-h-[calc(100vh-6.5rem)] w-full max-w-none flex-col gap-4 pt-0">
      <Animate preset="rise-in">
        <header className="nuoma-workspace-header flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="botforge-kicker">Operations</p>
            <h1 className="botforge-display mt-2 text-3xl md:text-4xl">
              Saúde <span className="nuoma-gradient-text">do envio</span>.
            </h1>
            <p className="mt-3 max-w-2xl text-sm text-fg-muted">
              Worker, CDP, fila e auditoria de disparo em uma tela de plantão.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={health.variant}>{health.label}</Badge>
            <span className="inline-flex items-center gap-2 rounded-lg bg-bg-base px-3 py-2 text-xs text-fg-muted shadow-pressed-sm">
              <SignalDot status={health.signal} size="sm" />
              Atualiza a cada 5s
            </span>
          </div>
        </header>
      </Animate>

      <Animate preset="rise-in" delaySeconds={0.06}>
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <OperationTile
            icon={<Radio className="h-4 w-4" />}
            label="WhatsApp CDP"
            value={data.whatsapp.sessionStatus}
            detail={`${data.workers.browserConnected}/${data.workers.total} worker(s) com browser`}
            tone={data.whatsapp.cdpConnected ? "success" : "warning"}
          />
          <OperationTile
            icon={<ServerCog className="h-4 w-4" />}
            label="Workers"
            value={`${data.workers.online}/${data.workers.total}`}
            detail={`${data.workers.stale} stale · ${data.workers.withErrors} erro`}
            tone={data.workers.withErrors > 0 || data.workers.stale > 0 ? "warning" : "success"}
          />
          <OperationTile
            icon={<Database className="h-4 w-4" />}
            label="Fila"
            value={data.jobs.queued + data.jobs.active}
            detail={`${data.jobs.queued} queued · ${data.jobs.active} active`}
            tone={data.jobs.dead > 0 || data.jobs.failed > 0 ? "danger" : "info"}
          />
          <OperationTile
            icon={<Activity className="h-4 w-4" />}
            label="Throughput"
            value={`${data.operations.throughputPerHour}/h`}
            detail={`${data.operations.failureRatePct}% falha · ${formatMs(data.operations.avgRunLatencyMs)} run`}
            tone={data.operations.failureRatePct > 0 ? "warning" : "success"}
          />
        </section>
      </Animate>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Animate preset="rise-in" delaySeconds={0.12}>
          <section className="grid gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Workers</CardTitle>
                <CardDescription>
                  Heartbeat, memória e conexão de browser por processo.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {data.workers.items.length === 0 ? (
                  <EmptyState description="Nenhum worker reportou heartbeat." />
                ) : (
                  <div className="grid gap-2">
                    {data.workers.items.map((worker) => (
                      <WorkerRow key={worker.workerId} worker={worker} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Fila recente</CardTitle>
                <CardDescription>
                  Últimos jobs observados, com foco em claimed/running/failed.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {data.jobs.recent.length === 0 ? (
                  <EmptyState description="Sem jobs recentes." />
                ) : (
                  <div className="overflow-x-auto">
                    <div className="min-w-[44rem]">
                      <div className="grid grid-cols-[5rem_1fr_7rem_8rem_8rem] gap-3 border-b border-white/10 px-3 pb-2 font-mono text-[0.65rem] uppercase text-fg-dim">
                        <span>ID</span>
                        <span>Tipo</span>
                        <span>Status</span>
                        <span>Worker</span>
                        <span>Criado</span>
                      </div>
                      <div className="divide-y divide-white/10">
                        {data.jobs.recent.map((job) => (
                          <div
                            key={job.id}
                            className="grid grid-cols-[5rem_1fr_7rem_8rem_8rem] gap-3 px-3 py-2 text-sm"
                          >
                            <span className="font-mono text-fg-dim">#{job.id}</span>
                            <span className="truncate text-fg-primary">{job.type}</span>
                            <span>
                              <Badge variant={jobStatusVariant(job.status)}>{job.status}</Badge>
                            </span>
                            <span className="truncate text-fg-muted">{job.claimedBy ?? "—"}</span>
                            <span className="text-fg-muted">
                              <TimeAgo date={job.createdAt} />
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </section>
        </Animate>

        <Animate preset="rise-in" delaySeconds={0.18}>
          <aside className="grid content-start gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Readiness</CardTitle>
                <CardDescription>Gates mínimos antes de disparar.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-2">
                  <GateRow
                    ok={data.workers.online > 0}
                    label="Worker online"
                    detail={`${data.workers.online}/${data.workers.total}`}
                  />
                  <GateRow
                    ok={data.whatsapp.cdpConnected}
                    label="CDP conectado"
                    detail={data.whatsapp.sessionStatus}
                  />
                  <GateRow
                    ok={data.jobs.dead === 0 && data.jobs.failed === 0}
                    label="Sem DLQ/falha"
                    detail={`${data.jobs.dead} DLQ · ${data.jobs.failed} failed`}
                  />
                  <GateRow
                    ok={data.sendPolicy.apiAllowedPhonesConfigured}
                    label="Canário configurado"
                    detail={data.sendPolicy.apiMode}
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Send audit</CardTitle>
                <CardDescription>
                  Últimos eventos estruturados de envio.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {sendAudit.isLoading ? (
                  <LoadingState />
                ) : sendAudit.error ? (
                  <ErrorState description={sendAudit.error.message} />
                ) : auditEvents.length === 0 ? (
                  <EmptyState description="Sem eventos de envio." />
                ) : (
                  <div className="grid gap-2">
                    {auditEvents.map((event) => (
                      <AuditRow key={event.id} event={event} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Alertas</CardTitle>
                <CardDescription>Warn/error mais recentes.</CardDescription>
              </CardHeader>
              <CardContent>
                {data.criticalEvents.length === 0 ? (
                  <EmptyState description="Sem alerta recente." />
                ) : (
                  <div className="grid gap-2">
                    {data.criticalEvents.slice(0, 6).map((event) => (
                      <CriticalEventRow key={event.id} event={event} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </aside>
        </Animate>
      </div>
    </div>
  );
}

function OperationTile({
  icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  detail: string;
  tone: "success" | "warning" | "danger" | "info";
}) {
  return (
    <Card variant="flat">
      <CardContent className="flex min-h-28 flex-col justify-between p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-bg-base text-fg-muted shadow-pressed-sm">
            {icon}
          </span>
          <Badge variant={tone}>{tone}</Badge>
        </div>
        <div>
          <p className="font-mono text-[0.65rem] uppercase text-fg-dim">{label}</p>
          <div className="mt-1 text-2xl font-semibold text-fg-primary">{value}</div>
          <p className="mt-1 text-xs text-fg-muted">{detail}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function WorkerRow({ worker }: { worker: WorkerItem }) {
  const status = workerStatus(worker);
  return (
    <div className="grid gap-3 rounded-lg border border-white/10 bg-bg-surface/40 p-3 md:grid-cols-[minmax(0,1fr)_7rem_7rem_8rem] md:items-center">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <SignalDot status={status.signal} size="sm" />
          <span className="truncate font-medium text-fg-primary">{worker.workerId}</span>
        </div>
        <p className="mt-1 truncate text-xs text-fg-muted">
          {worker.lastError ?? `pid ${worker.pid ?? "—"} · heartbeat ${worker.heartbeatAgeSeconds}s`}
        </p>
      </div>
      <Badge variant={status.variant}>{worker.status}</Badge>
      <span className="text-sm text-fg-muted">{worker.rssMb ?? "—"} MB</span>
      <span className="text-sm text-fg-muted">
        <TimeAgo date={worker.heartbeatAt} />
      </span>
    </div>
  );
}

function GateRow({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  const Icon = ok ? CheckCircle2 : AlertTriangle;
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-bg-surface/40 px-3 py-2">
      <span className="inline-flex min-w-0 items-center gap-2 text-sm text-fg-primary">
        <Icon className={ok ? "h-4 w-4 text-semantic-success" : "h-4 w-4 text-semantic-warning"} />
        <span className="truncate">{label}</span>
      </span>
      <span className="shrink-0 text-xs text-fg-muted">{detail}</span>
    </div>
  );
}

function AuditRow({ event }: { event: SendAuditEvent }) {
  return (
    <div className="rounded-lg border border-white/10 bg-bg-surface/40 p-3">
      <div className="flex items-center justify-between gap-3">
        <Badge variant={sendAuditVariant(event.phase)}>{event.phase}</Badge>
        <span className="text-xs text-fg-muted">
          <TimeAgo date={event.occurredAt} />
        </span>
      </div>
      <p className="mt-2 text-sm text-fg-primary">
        {event.channel} · job #{event.jobId ?? "—"}
      </p>
      <p className="mt-1 line-clamp-2 text-xs text-fg-muted">
        {event.errorCode ?? event.errorMessage ?? event.payloadHash ?? "sem detalhe"}
      </p>
    </div>
  );
}

function CriticalEventRow({ event }: { event: CriticalEvent }) {
  return (
    <div className="rounded-lg border border-white/10 bg-bg-surface/40 p-3">
      <div className="flex items-center justify-between gap-3">
        <Badge variant={event.severity === "error" ? "danger" : "warning"}>{event.severity}</Badge>
        <span className="text-xs text-fg-muted">
          <TimeAgo date={event.createdAt} />
        </span>
      </div>
      <p className="mt-2 truncate text-sm text-fg-primary">{event.type}</p>
    </div>
  );
}

function operationHealth(data: SystemMetrics): {
  label: string;
  variant: "success" | "warning" | "danger";
  signal: "active" | "degraded" | "error";
} {
  if (data.jobs.dead > 0 || data.workers.withErrors > 0) {
    return { label: "atenção crítica", variant: "danger", signal: "error" };
  }
  if (!data.whatsapp.cdpConnected || data.workers.stale > 0 || data.jobs.failed > 0) {
    return { label: "degradado", variant: "warning", signal: "degraded" };
  }
  return { label: "operacional", variant: "success", signal: "active" };
}

function workerStatus(worker: WorkerItem): {
  signal: "active" | "degraded" | "error";
  variant: "success" | "warning" | "danger" | "info";
} {
  if (worker.status === "error" || worker.lastError) {
    return { signal: "error", variant: "danger" };
  }
  if (worker.stale || !worker.browserConnected) {
    return { signal: "degraded", variant: "warning" };
  }
  if (worker.status === "busy") {
    return { signal: "active", variant: "info" };
  }
  return { signal: "active", variant: "success" };
}

function jobStatusVariant(status: string) {
  if (status === "completed") return "success";
  if (status === "failed" || status === "cancelled") return "danger";
  if (status === "claimed" || status === "running") return "info";
  return "neutral";
}

function sendAuditVariant(phase: SendAuditEvent["phase"]) {
  if (phase === "failed" || phase === "policy_block") return "danger";
  if (phase === "duplicate") return "warning";
  if (phase === "sent" || phase === "delivered" || phase === "read") return "success";
  return "info";
}

function formatMs(value: number | null) {
  if (value === null) return "—";
  if (value < 1_000) return `${value}ms`;
  return `${Math.round(value / 100) / 10}s`;
}
