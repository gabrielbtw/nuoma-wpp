import type { AppRouter } from "@nuoma/api";
import type { inferRouterOutputs } from "@trpc/server";
import { useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Inbox,
  Radio,
  RefreshCw,
  Send,
  ServerCog,
  Settings,
} from "lucide-react";
import type { ReactNode } from "react";

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
  Skeleton,
  SkeletonText,
} from "@nuoma/ui";

import { trpc } from "../lib/trpc.js";

type SystemMetrics = inferRouterOutputs<AppRouter>["system"]["metrics"];
type BadgeTone = "success" | "warning" | "danger" | "info" | "neutral";
type SignalTone = "ok" | "warn" | "error" | "info";
type RouteTarget = "/jobs" | "/inbox" | "/operations" | "/settings";

type MetricTileData = {
  id: string;
  label: string;
  value: ReactNode;
  detail: string;
  tone: SignalTone;
  icon: ReactNode;
  loading?: boolean;
};

type PendingAction = {
  id: string;
  title: string;
  description: string;
  badge: string;
  route: RouteTarget;
  tone: BadgeTone;
  icon: ReactNode;
};

const numberFormatter = new Intl.NumberFormat("pt-BR");

export function DashboardPage() {
  const navigate = useNavigate();
  const metrics = trpc.system.metrics.useQuery(undefined, { refetchInterval: 10_000 });
  const unreadConversations = trpc.conversations.listUnified.useQuery(
    { channel: "all", limit: 5, operationalStatus: "unread" },
    { enabled: metrics.isSuccess, refetchInterval: 10_000 },
  );

  if (metrics.isLoading) return <DashboardSkeleton />;

  if (metrics.error || !metrics.data) {
    return (
      <div className="nw-dashboard-page flex min-h-[calc(100vh-6.5rem)] items-center justify-center">
        <ErrorState
          title="Painel indisponível"
          description={metricsErrorDescription(metrics.error)}
          action={
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<RefreshCw className="h-4 w-4" />}
              onClick={() => void metrics.refetch()}
            >
              Tentar de novo
            </Button>
          }
        />
      </div>
    );
  }

  const data = metrics.data;
  const unreadTotal = unreadConversations.data?.summary.total ?? null;
  const health = overallHealth(data);
  const metricTiles = buildMetricTiles(data, {
    error: unreadConversations.error?.message ?? null,
    loading: unreadConversations.isLoading,
    returned: unreadConversations.data?.summary.returned ?? 0,
    total: unreadTotal,
  });
  const actions = buildPendingActions(data, unreadTotal);
  const navigateTo = (route: RouteTarget) => void navigate({ to: route });

  return (
    <div
      className="nw-dashboard-page flex min-h-[calc(100vh-6.5rem)] w-full max-w-none flex-col gap-4 pt-0 text-ink-base"
      data-testid="dashboard-page"
    >
      <header className="nw-dashboard-hero">
        <div className="min-w-0">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-ink-faint">
            Operação
          </p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink-strong md:text-4xl">
            Painel
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-soft">
            Leitura direta da fila, workers, canais e pendências abertas nos dados reais do
            sistema.
          </p>
        </div>
        <div className="nw-dashboard-health" data-tone={health.tone}>
          <span className="nw-dashboard-status-dot" />
          <div>
            <span>{health.label}</span>
            <strong>Atualiza a cada 10s</strong>
          </div>
        </div>
      </header>

      <section className="nw-dashboard-metrics" data-testid="dashboard-operational-metrics">
        {metricTiles.map((tile) => (
          <MetricTile key={tile.id} tile={tile} />
        ))}
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(22rem,0.8fr)]">
        <section className="grid gap-4">
          <QueueCard data={data} />
          <ChannelHealthCard data={data} />
        </section>
        <PendingActionsCard
          actions={actions}
          unreadError={unreadConversations.error?.message ?? null}
          onNavigate={navigateTo}
        />
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="nw-dashboard-page flex min-h-[calc(100vh-6.5rem)] w-full max-w-none flex-col gap-4 pt-0">
      <header className="nw-dashboard-hero">
        <div className="w-full max-w-xl">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-4 h-10 w-52" />
          <SkeletonText className="mt-5 max-w-lg" lines={2} />
        </div>
        <Skeleton className="h-14 w-48 rounded-lg" variant="block" />
      </header>
      <section className="nw-dashboard-metrics">
        {Array.from({ length: 6 }).map((_, index) => (
          <Card key={index} variant="flat" className="nw-dashboard-tile">
            <CardContent className="p-0">
              <Skeleton className="h-8 w-8 rounded-lg" variant="block" />
              <Skeleton className="mt-6 h-3 w-28" />
              <Skeleton className="mt-3 h-8 w-20" />
              <Skeleton className="mt-3 h-3 w-36" />
            </CardContent>
          </Card>
        ))}
      </section>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(22rem,0.8fr)]">
        <Skeleton className="h-80 rounded-lg" variant="block" />
        <Skeleton className="h-80 rounded-lg" variant="block" />
      </div>
    </div>
  );
}

function MetricTile({ tile }: { tile: MetricTileData }) {
  return (
    <Card variant="flat" className="nw-dashboard-tile" data-tone={tile.tone}>
      <CardContent className="p-0">
        <div className="nw-dashboard-tile-icon">{tile.icon}</div>
        <p className="mt-5 font-mono text-[0.68rem] uppercase tracking-[0.16em] text-ink-faint">
          {tile.label}
        </p>
        <div className="mt-2 min-h-10 font-mono text-3xl font-semibold tabular-nums text-ink-strong">
          {tile.loading ? <Skeleton className="h-8 w-20" /> : tile.value}
        </div>
        <p className="mt-2 min-h-5 text-xs leading-5 text-ink-soft">{tile.detail}</p>
      </CardContent>
    </Card>
  );
}

function QueueCard({ data }: { data: SystemMetrics }) {
  const rows = [
    ["Pendente", data.jobs.queued, "queued", data.jobs.queued > 0 ? "warn" : "ok"],
    ["Processando", data.jobs.active, "claimed/running", data.jobs.active > 0 ? "info" : "ok"],
    [
      "Falha",
      data.jobs.failed + data.jobs.dead,
      `${data.jobs.failed} failed · ${data.jobs.dead} DLQ`,
      data.jobs.failed + data.jobs.dead > 0 ? "error" : "ok",
    ],
  ] satisfies Array<[string, number, string, SignalTone]>;

  return (
    <Card variant="flat" className="nw-dashboard-panel" data-testid="dashboard-queue-card">
      <CardHeader className="mb-4">
        <CardTitle className="text-ink-strong">Estado da fila de envio</CardTitle>
        <CardDescription className="text-ink-soft">
          Contagens persistidas em jobs por status atual.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div className="nw-dashboard-queue">
          {rows.map(([label, value, detail, tone]) => (
            <div key={label} className="nw-dashboard-queue-row" data-tone={tone}>
              <div>
                <p>{label}</p>
                <span>{detail}</span>
              </div>
              <strong>{formatNumber(value)}</strong>
            </div>
          ))}
        </div>
        <div className="nw-dashboard-panel-note">
          Total atual: <strong>{formatNumber(data.jobs.total)}</strong> jobs.
        </div>
      </CardContent>
    </Card>
  );
}

function ChannelHealthCard({ data }: { data: SystemMetrics }) {
  return (
    <Card variant="flat" className="nw-dashboard-panel" data-testid="dashboard-channel-health">
      <CardHeader className="mb-4">
        <CardTitle className="text-ink-strong">Saúde dos canais</CardTitle>
        <CardDescription className="text-ink-soft">
          Sessão e runtime reportados pelo worker.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div className="nw-dashboard-channel-list">
          {buildChannelRows(data).map((row) => (
            <div key={row.id} className="nw-dashboard-channel-row" data-channel={row.channel}>
              <div className="nw-dashboard-channel-mark">{row.short}</div>
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <p className="truncate font-medium text-ink-strong">{row.label}</p>
                  <Badge variant={row.variant}>{row.status}</Badge>
                </div>
                <p className="mt-1 truncate text-xs text-ink-soft">{row.detail}</p>
              </div>
              <span className="text-right font-mono text-[0.68rem] uppercase tracking-[0.14em] text-ink-faint">
                {row.meta}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function PendingActionsCard({
  actions,
  onNavigate,
  unreadError,
}: {
  actions: PendingAction[];
  unreadError: string | null;
  onNavigate: (route: RouteTarget) => void;
}) {
  return (
    <Card variant="flat" className="nw-dashboard-panel" data-testid="dashboard-pending-actions">
      <CardHeader className="mb-4">
        <CardTitle className="text-ink-strong">Pendências acionáveis</CardTitle>
        <CardDescription className="text-ink-soft">
          Apenas itens com rota de resolução no produto.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {actions.length === 0 ? (
          <EmptyState description="Sem pendência acionável nos dados atuais." />
        ) : (
          <div className="grid gap-2">
            {actions.map((action) => (
              <button
                key={action.id}
                type="button"
                className="nw-dashboard-action"
                onClick={() => onNavigate(action.route)}
              >
                <span className="nw-dashboard-action-icon">{action.icon}</span>
                <span className="min-w-0 flex-1 text-left">
                  <span className="block truncate font-medium text-ink-strong">
                    {action.title}
                  </span>
                  <span className="mt-1 block truncate text-xs text-ink-soft">
                    {action.description}
                  </span>
                </span>
                <Badge variant={action.tone}>{action.badge}</Badge>
                <ArrowRight className="h-4 w-4 text-accent" />
              </button>
            ))}
          </div>
        )}
        {unreadError ? (
          <p className="nw-dashboard-inline-error">
            Conversas não lidas indisponíveis: {unreadError}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function buildMetricTiles(
  data: SystemMetrics,
  unread: { error: string | null; loading: boolean; returned: number; total: number | null },
): MetricTileData[] {
  const failed = data.jobs.failed + data.jobs.dead;
  return [
    tile("queued", "Fila pendente", data.jobs.queued, "jobs aguardando execução", data.jobs.queued > 0 ? "warn" : "ok", <Clock3 className="h-4 w-4" />),
    tile("active", "Processando", data.jobs.active, "claimed/running no SQLite", data.jobs.active > 0 ? "info" : "ok", <Send className="h-4 w-4" />),
    tile("failed", "Falhas", failed, `${data.jobs.failed} failed · ${data.jobs.dead} DLQ`, failed > 0 ? "error" : "ok", <AlertTriangle className="h-4 w-4" />),
    tile("workers", "Workers online", `${formatNumber(data.workers.online)}/${formatNumber(data.workers.total)}`, `${data.workers.browserConnected} com browser conectado`, data.workers.withErrors > 0 || data.workers.stale > 0 ? "warn" : "ok", <ServerCog className="h-4 w-4" />),
    tile("throughput", "Throughput 1h", `${formatNumber(data.operations.throughputPerHour)}/h`, `${data.operations.failureRatePct}% falha na janela`, data.operations.failureRatePct > 0 ? "warn" : "ok", <CheckCircle2 className="h-4 w-4" />),
    tile("unread", "Não lidas", unread.error ? "erro" : unread.total == null ? "—" : formatNumber(unread.total), unread.error ? "consulta do inbox falhou" : `${formatNumber(unread.returned)} conversas carregadas`, unread.error ? "error" : unread.total && unread.total > 0 ? "warn" : "ok", <Inbox className="h-4 w-4" />, unread.loading),
  ];
}

function tile(
  id: string,
  label: string,
  value: ReactNode,
  detail: string,
  tone: SignalTone,
  icon: ReactNode,
  loading?: boolean,
): MetricTileData {
  return { id, label, value: typeof value === "number" ? formatNumber(value) : value, detail, tone, icon, loading };
}

function buildPendingActions(data: SystemMetrics, unreadTotal: number | null): PendingAction[] {
  const actions: PendingAction[] = [];
  const add = (action: PendingAction) => actions.push(action);
  if (data.jobs.dead > 0) add(action("dead-jobs", "Revisar DLQ", "Jobs mortos precisam de análise antes de reenfileirar.", `${data.jobs.dead} DLQ`, "/jobs", "danger", <AlertTriangle className="h-4 w-4" />));
  if (data.jobs.failed > 0) add(action("failed-jobs", "Investigar jobs com falha", "Há falhas persistidas na fila atual.", `${data.jobs.failed} failed`, "/jobs", "warning", <Clock3 className="h-4 w-4" />));
  if (unreadTotal != null && unreadTotal > 0) add(action("unread-conversations", "Responder conversas não lidas", "Inbox possui conversas com contador unread_count.", `${unreadTotal} inbox`, "/inbox", "info", <Inbox className="h-4 w-4" />));
  if (!data.whatsapp.cdpConnected) add(action("whatsapp-session", "Ver sessão WhatsApp", `Status atual: ${sessionLabel(data.whatsapp.sessionStatus)}.`, "canal", "/operations", "warning", <Radio className="h-4 w-4" />));
  if (data.workers.withErrors > 0 || data.workers.stale > 0) add(action("workers", "Checar workers", `${data.workers.withErrors} com erro · ${data.workers.stale} sem heartbeat recente.`, "worker", "/operations", "warning", <ServerCog className="h-4 w-4" />));
  if (!data.sendPolicy.apiAllowedPhonesConfigured) add(action("send-policy", "Configurar canário de envio", `Política atual: ${data.sendPolicy.apiMode}.`, "setup", "/settings", "neutral", <Settings className="h-4 w-4" />));
  return actions.slice(0, 6);
}

function action(
  id: string,
  title: string,
  description: string,
  badge: string,
  route: RouteTarget,
  tone: BadgeTone,
  icon: ReactNode,
): PendingAction {
  return { id, title, description, badge, route, tone, icon };
}

function buildChannelRows(data: SystemMetrics) {
  return [
    {
      id: "whatsapp",
      label: "WhatsApp",
      short: "WA",
      channel: "wa",
      status: sessionLabel(data.whatsapp.sessionStatus),
      detail: `${data.workers.browserConnected}/${data.workers.total} worker(s) com browser`,
      meta: data.whatsapp.cdpConnected ? "CDP ok" : "CDP off",
      variant: data.whatsapp.cdpConnected ? "success" : "danger",
    },
    {
      id: "instagram",
      label: "Instagram",
      short: "IG",
      channel: "ig",
      status: sessionLabel(data.instagram.sessionStatus),
      detail: data.instagram.username
        ? `@${data.instagram.username}`
        : data.instagram.pageUrl ?? "sem sessão autenticada",
      meta: data.instagram.lastSyncAt ? `sync ${formatClock(data.instagram.lastSyncAt)}` : "sem sync",
      variant: data.instagram.authenticated ? "success" : "warning",
    },
    {
      id: "system",
      label: "Sistema",
      short: "SYS",
      channel: "sys",
      status: data.health.ok ? "ok" : "erro",
      detail: `${data.health.service} · ${data.health.version}`,
      meta: `up ${formatUptime(data.health.uptimeSeconds)}`,
      variant: data.health.ok ? "success" : "danger",
    },
  ] satisfies Array<{
    id: string;
    label: string;
    short: string;
    channel: "wa" | "ig" | "sys";
    status: string;
    detail: string;
    meta: string;
    variant: BadgeTone;
  }>;
}

function overallHealth(data: SystemMetrics): { label: string; tone: SignalTone } {
  if (data.jobs.dead > 0 || data.workers.withErrors > 0 || data.criticalEvents.some((event) => event.severity === "error")) {
    return { label: "atenção crítica", tone: "error" };
  }
  if (!data.whatsapp.cdpConnected || data.jobs.failed > 0 || data.workers.stale > 0) {
    return { label: "degradado", tone: "warn" };
  }
  return { label: "operacional", tone: "ok" };
}

function metricsErrorDescription(
  error: { message: string; data?: { code?: string } | null } | null,
) {
  if (error?.data?.code === "FORBIDDEN" || error?.data?.code === "UNAUTHORIZED") {
    return "Não foi possível carregar system.metrics. Seu usuário não tem permissão para ver este painel administrativo.";
  }
  return `Não foi possível carregar system.metrics. ${error?.message ?? "Tente novamente."}`;
}

function sessionLabel(status: string): string {
  if (status === "connected") return "conectado";
  if (status === "no_worker") return "sem worker";
  if (status === "unknown") return "desconhecido";
  return "desconectado";
}

function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}

function formatClock(value: string): string {
  return new Date(value).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
