import { useQuery } from "@tanstack/react-query";
import { Activity, AlertCircle, ArrowRight, Bot, CheckCircle2, Clock, MessageSquare, Minus, Send, TrendingDown, TrendingUp, Users, type LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorPanel } from "@/components/shared/error-panel";
import { apiFetch } from "@/lib/api";
import type { ChannelHealthRecord, DashboardCounts, DashboardSummaryResponse, HealthResponse } from "@/lib/system-types";
import { cn } from "@/lib/utils";

function DashboardMetricCard({
  title,
  value,
  detail,
  icon: Icon,
  colorClass,
  accentColor,
  to,
  trend
}: {
  title: string;
  value: string | number;
  detail: string;
  icon: LucideIcon;
  colorClass: string;
  accentColor: string;
  to: string;
  trend?: "up" | "down" | "flat";
}) {
  return (
    <Link to={to} className="group relative overflow-hidden rounded-2xl border border-n-border/60 bg-n-surface p-5 cursor-pointer transition-all duration-300 hover:border-n-border hover:bg-n-surface-2 hover:shadow-lg hover:shadow-black/20">
      <div className={cn("absolute inset-x-0 top-0 h-[2px] opacity-0 transition-opacity duration-300 group-hover:opacity-100", accentColor)} />
      <div className="flex items-start justify-between">
        <div>
          <p className="text-micro uppercase tracking-wider text-n-text-dim">{title}</p>
          <span className="mt-1 flex items-center font-mono text-[2rem] font-bold leading-tight tracking-tight text-n-text">
            {value}
            {trend && (
              <span className={cn("ml-1 inline-flex",
                trend === "up" ? "text-n-wa" : trend === "down" ? "text-n-red" : "text-n-text-dim"
              )}>
                {trend === "up" ? <TrendingUp className="h-3.5 w-3.5" /> :
                 trend === "down" ? <TrendingDown className="h-3.5 w-3.5" /> :
                 <Minus className="h-3.5 w-3.5" />}
              </span>
            )}
          </span>
        </div>
        <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl bg-n-surface-2/80 ring-1 ring-white/[0.04]", colorClass)}>
          <Icon className="h-[18px] w-[18px]" />
        </div>
      </div>
      <p className="mt-3 text-caption text-n-text-muted">{detail}</p>
      <ArrowRight className="absolute bottom-4 right-4 h-4 w-4 text-n-text-dim opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
    </Link>
  );
}

function normalizeRuntimeStatus(input?: string | null) {
  return (input ?? "unknown").toLowerCase();
}

function isOperationalStatus(input?: string | null) {
  return ["ok", "online", "authenticated", "connected", "active", "assisted"].includes(normalizeRuntimeStatus(input));
}

function getDashboardHeadline(status: string) {
  if (status === "ok") {
    return "Operação estável";
  }

  if (status === "unknown") {
    return "Aguardando leitura do ambiente";
  }

  return "Atenção operacional";
}

function getDashboardDescription({
  overallStatus,
  workerStatus,
  schedulerStatus,
  activeChannelCount,
  pendingJobs
}: {
  overallStatus: string;
  workerStatus: string;
  schedulerStatus: string;
  activeChannelCount: number;
  pendingJobs: number;
}) {
  if (overallStatus === "ok") {
    return `Worker ${workerStatus}, scheduler ${schedulerStatus}, ${activeChannelCount} canal(is) operacionais e ${pendingJobs} job(s) pendente(s).`;
  }

  if (overallStatus === "unknown") {
    return "Ainda não houve leitura suficiente do runtime para declarar o estado geral do ambiente.";
  }

  return `Foi detectada uma degradação no runtime. Worker ${workerStatus}, scheduler ${schedulerStatus} e ${pendingJobs} job(s) pendente(s) aguardando revisão.`;
}

export function DashboardPage() {
  const dashboardQuery = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => apiFetch<DashboardSummaryResponse>("/dashboard"),
    refetchInterval: 30_000
  });

  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: () => apiFetch<HealthResponse>("/health"),
    refetchInterval: 15_000
  });

  const counts: DashboardCounts = dashboardQuery.data?.counts ?? {};
  const failures = dashboardQuery.data?.failures;
  const overallStatus = normalizeRuntimeStatus(healthQuery.data?.overallStatus ?? null);
  const workerStatus = normalizeRuntimeStatus(String(healthQuery.data?.worker?.value?.status ?? ""));
  const schedulerStatus = normalizeRuntimeStatus(String(healthQuery.data?.scheduler?.value?.status ?? ""));
  const channels: ChannelHealthRecord[] = Object.values(healthQuery.data?.channels ?? {});
  const activeChannelCount = channels.filter((channel) =>
    isOperationalStatus(channel.account?.status) || isOperationalStatus(channel.worker?.status) || isOperationalStatus(channel.mode)
  ).length;
  const unreadConversations = Number(counts.unreadConversations ?? 0);
  const pendingJobs = Number(counts.pendingJobs ?? 0);

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-h1 text-n-text">Dashboard</h1>
          <p className="text-caption text-n-text-dim mt-1">Visao operacional em tempo real</p>
        </div>
        <div className="flex items-center gap-2">
          <div className={cn(
            "flex items-center gap-2 rounded-full px-3 py-1.5 text-label transition-fast",
            overallStatus === "ok"
              ? "bg-n-wa/8 text-n-wa ring-1 ring-n-wa/15"
              : "bg-n-amber/8 text-n-amber ring-1 ring-n-amber/15"
          )}>
            <span className={cn("signal-dot", overallStatus === "ok" ? "active" : "warning")} />
            {overallStatus === "ok" ? "Operacional" : "Atencao"}
          </div>
          {unreadConversations > 0 && (
            <div className="flex items-center gap-1.5 rounded-full bg-n-surface-2 px-3 py-1.5 text-label text-n-text-muted ring-1 ring-white/[0.04]">
              <MessageSquare className="h-3 w-3" />
              {unreadConversations} nao lidas
            </div>
          )}
        </div>
      </div>

      {dashboardQuery.error ? <ErrorPanel message={(dashboardQuery.error as Error).message} /> : null}
      {healthQuery.error ? <ErrorPanel message={(healthQuery.error as Error).message} /> : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <DashboardMetricCard
          title="Conversas"
          value={counts.conversations ?? 0}
          detail={`${unreadConversations} com pendência de leitura`}
          icon={MessageSquare}
          colorClass="text-n-blue"
          accentColor="bg-n-blue"
          to="/inbox"
          trend="flat"
        />
        <DashboardMetricCard
          title="Automações ativas"
          value={counts.activeAutomations ?? 0}
          detail="Regras ligadas no ambiente local"
          icon={Bot}
          colorClass="text-n-amber"
          accentColor="bg-n-amber"
          to="/automations"
          trend="flat"
        />
        <DashboardMetricCard
          title="Campanhas em curso"
          value={counts.campaignsRunning ?? 0}
          detail={`${pendingJobs} job(s) aguardando processamento`}
          icon={Send}
          colorClass="text-pink-400"
          accentColor="bg-pink-400"
          to="/campaigns"
          trend="flat"
        />
        <DashboardMetricCard
          title="Contatos"
          value={counts.contacts ?? 0}
          detail="Cadastros ativos na base"
          icon={Users}
          colorClass="text-n-wa"
          accentColor="bg-n-wa"
          to="/contacts"
          trend="flat"
        />
      </div>

      {/* Failure banner */}
      {failures && (Number(failures.recentFailedJobs ?? 0) > 0 || Number(failures.totalFailedRecipients ?? 0) > 0) && (
        <div className="rounded-2xl border border-n-red/20 bg-n-red/[0.04] p-4 animate-fade-in">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-n-red/10">
              <AlertCircle className="h-4.5 w-4.5 text-n-red" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-h4 text-n-red">Falhas detectadas</h3>
              <div className="flex gap-3 mt-0.5">
                {Number(failures.recentFailedJobs ?? 0) > 0 && (
                  <span className="text-caption text-n-red/70">{failures.recentFailedJobs} jobs falharam (24h)</span>
                )}
                {Number(failures.totalFailedRecipients ?? 0) > 0 && (
                  <span className="text-caption text-n-red/70">{failures.totalFailedRecipients} destinatarios com falha</span>
                )}
              </div>
            </div>
          </div>
          {failures.failedJobs && failures.failedJobs.length > 0 && (
            <div className="mt-3 space-y-1 max-h-[140px] overflow-y-auto custom-scrollbar">
              {failures.failedJobs.slice(0, 5).map((job) => (
                <div key={job.id} className="flex items-center justify-between rounded-lg bg-black/20 px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-micro uppercase text-n-red/80">{job.type}</span>
                    <span className="text-caption text-n-text-dim truncate">{job.error || "Sem detalhes"}</span>
                  </div>
                  <span className="text-micro text-n-text-dim shrink-0 ml-2">
                    {new Date(job.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid gap-3 xl:grid-cols-2">
        {/* Recent conversations */}
        <div className="flex flex-col rounded-2xl border border-n-border/60 bg-n-surface">
          <div className="flex items-center justify-between border-b border-n-border/40 px-5 py-3.5">
            <h3 className="text-h4 text-n-text">Conversas recentes</h3>
            <button
              type="button"
              onClick={() => { window.location.hash = "#/inbox"; }}
              className="text-caption text-n-blue hover:text-n-blue/80 transition-fast"
            >
              Ver todas
            </button>
          </div>
          <div className="max-h-[400px] divide-y divide-n-border/30 overflow-auto custom-scrollbar">
            {(dashboardQuery.data?.recentConversations ?? []).map((conversation) => {
              const conversationTitle = conversation.contact_name || conversation.title || "?";

              return (
                <div key={conversation.id} className="flex items-center gap-3.5 px-5 py-3 transition-fast hover:bg-n-surface-2/50">
                  <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-n-surface-2 text-body font-semibold text-n-text-muted ring-1 ring-white/[0.04]">
                    {conversationTitle.charAt(0).toUpperCase()}
                    {conversation.unread_count > 0 && (
                      <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-n-blue ring-2 ring-n-surface" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className={cn("text-body font-medium truncate", conversation.unread_count > 0 ? "text-n-text" : "text-n-text-muted")}>
                        {conversationTitle}
                      </span>
                      {conversation.unread_count > 0 && (
                        <span className="shrink-0 rounded-full bg-n-blue/15 px-2 py-0.5 text-micro text-n-blue">
                          {conversation.unread_count}
                        </span>
                      )}
                    </div>
                    <p className="line-clamp-1 text-caption text-n-text-dim mt-0.5">
                      {conversation.last_message_preview || "Sem prévia recente"}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Recent events */}
        <div className="flex flex-col rounded-2xl border border-n-border/60 bg-n-surface">
          <div className="flex items-center justify-between border-b border-n-border/40 px-5 py-3.5">
            <h3 className="text-h4 text-n-text">Eventos recentes</h3>
            <Activity className="h-3.5 w-3.5 text-n-text-dim" />
          </div>
          <div className="max-h-[400px] overflow-auto custom-scrollbar">
            <div className="space-y-px p-2">
              {(dashboardQuery.data?.recentEvents ?? []).map((event) => (
                <div key={event.id} className="flex items-start gap-3 rounded-xl px-3 py-2.5 transition-fast hover:bg-n-surface-2/50">
                  <div className={cn(
                    "mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full",
                    event.level === "error" ? "bg-n-red" : event.level === "warn" ? "bg-n-amber" : "bg-n-blue"
                  )} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className={cn(
                        "text-micro uppercase",
                        event.level === "error" ? "text-n-red" : event.level === "warn" ? "text-n-amber" : "text-n-blue"
                      )}>
                        {event.level}
                      </span>
                      <span className="text-micro text-n-text-dim">
                        {new Date(event.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    <p className="mt-0.5 text-caption text-n-text-muted leading-relaxed">{event.message}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
