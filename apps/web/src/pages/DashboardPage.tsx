import type { AppRouter } from "@nuoma/api";
import type { inferRouterOutputs } from "@trpc/server";
import {
  Activity,
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock3,
  HardDrive,
  MoreVertical,
  Radio,
  Send,
  ServerCog,
  ShieldCheck,
} from "lucide-react";
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
type SendAuditEventItem =
  inferRouterOutputs<AppRouter>["system"]["sendAuditEvents"]["events"][number];
type AuditListItem = {
  id?: number;
  type: string;
  createdAt?: string;
  scheduledAt?: string;
};

const OptionalCartographicHero = lazy(() => import("../visuals/OptionalCartographicHero.js"));

export function DashboardPage() {
  const optionalVisual = useOptionalVisualMode();
  const metrics = trpc.system.metrics.useQuery(undefined, {
    refetchInterval: 10_000,
  });
  const sendAudit = trpc.system.sendAuditEvents.useQuery(
    { limit: 4 },
    {
      refetchInterval: 10_000,
    },
  );

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
  const sendAuditItems = sendAudit.data?.events ?? [];
  const health = overallHealth(data);
  const signalRows = [
    {
      signal: "Sessão WhatsApp",
      group: "Canal",
      status: data.whatsapp.cdpConnected ? "positivo" : "atenção",
      trend: data.workers.browserConnected,
      value: `${data.workers.browserConnected}/${data.workers.total}`,
      change: data.whatsapp.cdpConnected ? "+3%" : "-4%",
      impact: data.whatsapp.cdpConnected ? "Ativo" : "Revisar CDP",
      action: data.whatsapp.cdpConnected ? "Manter ritmo" : "Reconectar sessão",
    },
    {
      signal: "Fila operacional",
      group: "Infraestrutura",
      status: data.jobs.queued + data.jobs.active > 0 ? "atenção" : "positivo",
      trend: data.jobs.queued + data.jobs.active,
      value: String(data.jobs.queued + data.jobs.active),
      change: data.jobs.active > 0 ? "+8%" : "+0%",
      impact: `${data.jobs.queued} queued`,
      action: "Acompanhar janela",
    },
    {
      signal: "Workers disponíveis",
      group: "Runtime",
      status: data.workers.withErrors > 0 || data.workers.stale > 0 ? "atenção" : "positivo",
      trend: data.workers.online,
      value: `${data.workers.online}/${data.workers.total}`,
      change: data.workers.withErrors > 0 ? "-8%" : "+12%",
      impact: `${data.workers.stale} stale`,
      action: data.workers.withErrors > 0 ? "Investigar falhas" : "Manter cobertura",
    },
    {
      signal: "DLQ e falhas",
      group: "Safety",
      status: data.jobs.dead > 0 || data.jobs.failed > 0 ? "negativo" : "positivo",
      trend: data.jobs.dead + data.jobs.failed,
      value: String(data.jobs.dead),
      change: data.jobs.dead > 0 ? "-11%" : "+5%",
      impact: `${data.jobs.failed} failed`,
      action: data.jobs.dead > 0 ? "Reduzir backlog" : "Sem ação",
    },
    {
      signal: "Política de envio",
      group: "Compliance",
      status: data.sendPolicy.apiMode === "test" ? "atenção" : "positivo",
      trend: data.operations.throughputPerHour,
      value: data.sendPolicy.apiMode,
      change: data.sendPolicy.apiAllowedPhonesConfigured ? "+6%" : "-2%",
      impact: data.sendPolicy.apiAllowedPhonesConfigured ? "Canário ok" : "Sem canário",
      action: data.sendPolicy.apiAllowedPhonesConfigured ? "Preparar envio" : "Configurar canário",
    },
  ];
  const readinessGates = [
    { label: "Políticas & Compliance", detail: "Todas as regras atendidas", ok: true },
    {
      label: "Qualidade de audiência",
      detail: data.sendPolicy.apiAllowedPhonesConfigured
        ? "Canário configurado"
        : "Canário pendente",
      ok: data.sendPolicy.apiAllowedPhonesConfigured,
    },
    {
      label: "Capacidade de envio",
      detail: `${data.workers.online} worker(s) online`,
      ok: data.workers.online > 0,
    },
    {
      label: "Risco de saturação",
      detail: "Frequência dentro do limite",
      ok: data.jobs.dead === 0,
    },
    { label: "Aprovação final", detail: health.label, ok: health.signal === "active" },
  ];
  const projectedImpact = [
    { label: "Throughput", value: `${data.operations.throughputPerHour}/h`, delta: "+22%" },
    {
      label: "Conversão operacional",
      value: `${100 - data.operations.failureRatePct}%`,
      delta: "+0,9 p.p.",
    },
    {
      label: "Execução média",
      value: formatDurationMs(data.operations.avgRunLatencyMs),
      delta: "estável",
    },
  ];
  const auditItems: AuditListItem[] =
    data.criticalEvents.length > 0
      ? data.criticalEvents.slice(0, 4).map((event) => ({
          id: event.id,
          type: event.type,
          createdAt: event.createdAt,
        }))
      : data.jobs.recent.slice(0, 4).map((job) => ({
          id: job.id,
          type: job.type,
          scheduledAt: job.scheduledAt,
        }));

  return (
    <div className="nuoma-dashboard-v2 flex min-h-[calc(100vh-6.5rem)] w-full max-w-none flex-col gap-4 pt-0">
      <Animate preset="rise-in">
        <header className="nuoma-workspace-header flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="botforge-kicker">Operação</p>
            <h1 className="botforge-display mt-2 text-3xl md:text-4xl">
              Implantação <span className="nuoma-gradient-text">sob controle</span>.
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

      <Animate preset="rise-in" delaySeconds={0.04}>
        <section className="nuoma-signal-board" data-testid="dashboard-signal-board">
          <div className="nuoma-signal-titlebar">
            <div>
              <div className="nuoma-signal-breadcrumb">
                Executivo / Operação local / Signal Board
              </div>
              <div className="nuoma-signal-heading">
                <h2>Operação Nuoma</h2>
                <Badge variant={health.signal === "active" ? "success" : "warning"}>
                  {health.label}
                </Badge>
              </div>
            </div>
            <div className="nuoma-signal-actions">
              <button type="button">
                01 - 28 Mai 2026
                <CalendarDays className="h-4 w-4" />
              </button>
              <button type="button">Comparar</button>
              <button type="button" aria-label="Mais ações">
                <MoreVertical className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="nuoma-signal-tabs" aria-label="Seções do signal board" tabIndex={0}>
            <span className="is-active">Visão Geral</span>
            <span>Sinais</span>
            <span>Audiências</span>
            <span>Mensagens</span>
            <span>Receitas</span>
            <span>Disparos</span>
            <span>Performance</span>
          </div>

          <div className="nuoma-signal-layout">
            <div className="nuoma-signal-main">
              <section className="nuoma-signal-panel nuoma-signal-table-panel">
                <div className="nuoma-signal-panel-head">
                  <h3>Sinais principais</h3>
                  <div className="nuoma-signal-legend">
                    <span>
                      <i className="positive" /> Positivo
                    </span>
                    <span>
                      <i className="warning" /> Atenção
                    </span>
                    <span>
                      <i className="negative" /> Negativo
                    </span>
                  </div>
                </div>
                <div className="nuoma-signal-table">
                  <div className="nuoma-signal-row nuoma-signal-row-head">
                    <span>Sinal</span>
                    <span>Status</span>
                    <span>Tendência (7d)</span>
                    <span>Valor atual</span>
                    <span>Impacto</span>
                    <span>Ação recomendada</span>
                  </div>
                  {signalRows.map((row, index) => (
                    <div key={row.signal} className="nuoma-signal-row">
                      <span className="nuoma-signal-name">
                        <i data-tone={row.status}>{index + 1}</i>
                        <span>
                          <strong>{row.signal}</strong>
                          <em>{row.group}</em>
                        </span>
                      </span>
                      <span>
                        <Badge
                          variant={
                            row.status === "negativo"
                              ? "danger"
                              : row.status === "atenção"
                                ? "warning"
                                : "success"
                          }
                        >
                          {row.status}
                        </Badge>
                      </span>
                      <span className="nuoma-sparkline" data-tone={row.status}>
                        <svg viewBox="0 0 120 28" aria-hidden="true">
                          <polyline
                            points={`0,20 12,${18 - index} 24,21 36,${10 + index} 48,16 60,${8 + index} 72,13 84,${7 + index} 96,12 108,${14 - index} 120,${9 + index}`}
                          />
                        </svg>
                      </span>
                      <span className="nuoma-signal-value">{row.value}</span>
                      <span className={row.change.startsWith("-") ? "is-negative" : "is-positive"}>
                        {row.change}
                      </span>
                      <button type="button">
                        {row.action}
                        <ChevronDown className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </section>

              <div className="nuoma-signal-lower-grid">
                <section className="nuoma-signal-panel">
                  <h3>Readiness Gates</h3>
                  <div className="nuoma-readiness-list">
                    {readinessGates.map((gate) => (
                      <div key={gate.label}>
                        <span className={gate.ok ? "is-ok" : "is-attention"}>
                          {gate.ok ? (
                            <CheckCircle2 className="h-4 w-4" />
                          ) : (
                            <AlertTriangle className="h-4 w-4" />
                          )}
                        </span>
                        <span>
                          <strong>{gate.label}</strong>
                          <em>{gate.detail}</em>
                        </span>
                        <b>{gate.ok ? "OK" : "ATENÇÃO"}</b>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="nuoma-signal-panel">
                  <h3>Disparo seguro</h3>
                  <div className="nuoma-safe-form">
                    <label>
                      Público<span>Todos os contatos elegíveis</span>
                    </label>
                    <label>
                      Canal<span>WhatsApp</span>
                    </label>
                    <label>
                      Throttle<span>{data.operations.throughputPerHour || 250} msg/h</span>
                    </label>
                    <label>
                      Prioridade<span>{data.jobs.dead > 0 ? "Alta" : "Normal"}</span>
                    </label>
                  </div>
                  <div className="nuoma-safe-check">
                    <ShieldCheck className="h-5 w-5" />
                    <span>
                      <strong>
                        {data.jobs.dead > 0
                          ? "Bloqueio operacional identificado."
                          : "Nenhum bloqueio identificado."}
                      </strong>
                      <em>
                        {data.jobs.dead > 0 ? "Revise DLQ antes do envio." : "Pronto para envio."}
                      </em>
                    </span>
                    <button type="button">Preparar disparo</button>
                  </div>
                </section>

                <section className="nuoma-signal-panel">
                  <h3>Impacto projetado</h3>
                  <div className="nuoma-impact-list">
                    {projectedImpact.map((item, index) => (
                      <div key={item.label}>
                        <span>
                          <em>{item.label}</em>
                          <strong>{item.value}</strong>
                          <b>{item.delta}</b>
                        </span>
                        <svg viewBox="0 0 150 38" aria-hidden="true">
                          <polyline
                            points={`0,28 15,${24 - index * 3} 30,26 45,${18 - index} 60,20 75,${12 + index} 90,16 105,${10 + index} 120,18 135,12 150,${7 + index}`}
                          />
                        </svg>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </div>

            <aside className="nuoma-signal-side">
              <section className="nuoma-signal-panel">
                <div className="nuoma-signal-panel-head">
                  <h3>Auditoria de envio</h3>
                  <button type="button">Ver tudo</button>
                </div>
                <div className="nuoma-audit-list">
                  {sendAudit.isLoading ? (
                    <div>
                      <i>...</i>
                      <span>
                        <strong>Carregando</strong>
                        <em>send_audit_events</em>
                      </span>
                    </div>
                  ) : sendAudit.error ? (
                    <div>
                      <i>!</i>
                      <span>
                        <strong>Auditoria indisponível</strong>
                        <em>{sendAudit.error.message}</em>
                      </span>
                      <Badge variant="danger">erro</Badge>
                    </div>
                  ) : sendAuditItems.length > 0 ? (
                    sendAuditItems.map((event) => (
                      <SendAuditCompactRow key={event.id} event={event} />
                    ))
                  ) : (
                    auditItems.map((item, index) => (
                      <div key={"id" in item ? item.id : index}>
                        <i>{index + 1}</i>
                        <span>
                          <strong>{item.type}</strong>
                          <em>
                            <TimeAgo date={item.createdAt ?? item.scheduledAt ?? ""} />
                          </em>
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </section>

              <section className="nuoma-signal-panel">
                <div className="nuoma-signal-panel-head">
                  <h3>Safety Rails</h3>
                  <button type="button">Configurar</button>
                </div>
                <div className="nuoma-rails-list">
                  {[
                    [
                      "Taxa de falha",
                      `${data.operations.failureRatePct}%`,
                      data.operations.failureRatePct <= 5,
                    ],
                    [
                      "Workers online",
                      `${data.workers.online}/${data.workers.total}`,
                      data.workers.online > 0,
                    ],
                    ["DLQ", String(data.jobs.dead), data.jobs.dead === 0],
                    [
                      "Canário API",
                      data.sendPolicy.apiAllowedPhonesConfigured ? "OK" : "Pendente",
                      data.sendPolicy.apiAllowedPhonesConfigured,
                    ],
                  ].map(([label, value, ok]) => (
                    <div key={String(label)}>
                      <span>
                        <strong>{label}</strong>
                        <em>{value}</em>
                      </span>
                      <b className={ok ? "is-positive" : "is-negative"}>{ok ? "OK" : "Atenção"}</b>
                    </div>
                  ))}
                </div>
              </section>

              <section className="nuoma-signal-panel nuoma-status-card">
                <ShieldCheck className="h-8 w-8" />
                <span>
                  <strong>
                    {health.signal === "active"
                      ? "Tudo seguro para operação"
                      : "Operação requer revisão"}
                  </strong>
                  <em>Última verificação: {formatClock(new Date().toISOString())}</em>
                </span>
              </section>
            </aside>
          </div>

          <div className="nuoma-signal-timeline" tabIndex={0}>
            {[
              "Planejamento",
              "Construção",
              "Testes",
              "Readiness",
              "Disparo",
              "Análise",
              "Aprendizado",
            ].map((item, index) => (
              <span key={item} className={index <= 3 ? "is-done" : ""}>
                <i>{index + 1}</i>
                {item}
              </span>
            ))}
          </div>
        </section>
      </Animate>

      {optionalVisual.enabled && (
        <Animate preset="rise-in" delaySeconds={0.05}>
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

function SendAuditCompactRow({ event }: { event: SendAuditEventItem }) {
  return (
    <div>
      <i>{sendAuditPhaseGlyph(event.phase)}</i>
      <span>
        <strong>
          {sendAuditPhaseLabel(event.phase)} · {event.channel}
        </strong>
        <em>
          <TimeAgo date={event.occurredAt} />
          {event.jobId ? ` · job #${event.jobId}` : ""}
          {event.latencyMs != null ? ` · ${formatDurationMs(event.latencyMs)}` : ""}
        </em>
      </span>
      <Badge variant={sendAuditPhaseVariant(event.phase)}>{event.phase}</Badge>
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
      <div className="text-[0.65rem] uppercase tracking-widest text-fg-dim font-mono">{label}</div>
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
    <div className="nuoma-glass-panel rounded-xl px-4 py-4 shadow-raised-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-bg-base text-brand-cyan shadow-pressed-sm">
          {icon}
        </span>
        <SignalDot status={signal} size="sm" />
      </div>
      <div className="mt-4 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-fg-muted">
        {label}
      </div>
      <div className="botforge-display mt-1 min-h-9 text-2xl tabular-nums">{value}</div>
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

function sendAuditPhaseVariant(
  phase: string,
): "neutral" | "info" | "success" | "warning" | "danger" {
  if (phase === "failed" || phase === "policy_block") return "danger";
  if (phase === "duplicate") return "warning";
  if (phase === "sent" || phase === "delivered" || phase === "read") return "success";
  if (phase === "dispatching") return "info";
  return "neutral";
}

function sendAuditPhaseGlyph(phase: string): string {
  if (phase === "failed" || phase === "policy_block") return "!";
  if (phase === "duplicate") return "2x";
  if (phase === "sent" || phase === "delivered" || phase === "read") return "ok";
  if (phase === "dispatching") return ">";
  return "q";
}

function sendAuditPhaseLabel(phase: string): string {
  if (phase === "policy_block") return "bloqueio de política";
  if (phase === "duplicate") return "duplicado bloqueado";
  if (phase === "dispatching") return "em envio";
  if (phase === "sent") return "enviado";
  if (phase === "delivered") return "entregue";
  if (phase === "read") return "lido";
  if (phase === "failed") return "falhou";
  return "enfileirado";
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
