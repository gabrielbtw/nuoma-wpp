import { useQuery } from "@tanstack/react-query";
import { Activity, AlertCircle, Bot, CheckCircle2, Clock, MessageSquare, Send, Users, type LucideIcon } from "lucide-react";
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
  colorClass
}: {
  title: string;
  value: string | number;
  detail: string;
  icon: LucideIcon;
  colorClass: string;
}) {
  return (
    <div className="group rounded-xl border border-n-border bg-n-surface p-4 transition-fast hover:border-n-border hover:bg-n-surface-2">
      <div className="flex items-center gap-3">
        <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-n-surface-2", colorClass)}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-micro uppercase text-n-text-dim">{title}</p>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-h2 text-n-text">{value}</span>
          </div>
        </div>
      </div>
      <p className="mt-2 text-caption text-n-text-muted">{detail}</p>
    </div>
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
      {/* Compact status bar */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-h1 text-n-text">Dashboard</h1>
          <p className="text-caption text-n-text-muted mt-0.5">Visao operacional em tempo real</p>
        </div>
        <div className="flex items-center gap-3">
          <div className={cn(
            "flex items-center gap-2 rounded-lg border px-3 py-1.5 transition-fast",
            overallStatus === "ok" ? "border-n-wa/20 bg-n-wa/5" : "border-n-amber/20 bg-n-amber/5"
          )}>
            <span className={cn("signal-dot", overallStatus === "ok" ? "active" : "warning")} />
            <span className={cn("text-label", overallStatus === "ok" ? "text-n-wa" : "text-n-amber")}>
              {overallStatus === "ok" ? "Operacional" : "Atencao"}
            </span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-n-border px-3 py-1.5">
            <Clock className="h-3.5 w-3.5 text-n-text-dim" />
            <span className="text-label text-n-text-muted">{unreadConversations} nao lidas</span>
          </div>
          <button
            type="button"
            onClick={() => { window.location.hash = "#/health"; }}
            className="rounded-lg bg-n-blue px-3 py-1.5 text-label text-white transition-fast hover:bg-n-blue/90"
          >
            Saude
          </button>
        </div>
      </div>

      {dashboardQuery.error ? <ErrorPanel message={(dashboardQuery.error as Error).message} /> : null}
      {healthQuery.error ? <ErrorPanel message={(healthQuery.error as Error).message} /> : null}

      <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
        <DashboardMetricCard
          title="Conversas"
          value={counts.conversations ?? 0}
          detail={`${unreadConversations} com pendência de leitura`}
          icon={MessageSquare}
          colorClass="text-cmm-blue"
        />
        <DashboardMetricCard
          title="Automações ativas"
          value={counts.activeAutomations ?? 0}
          detail="Regras ligadas no ambiente local"
          icon={Bot}
          colorClass="text-cmm-orange"
        />
        <DashboardMetricCard
          title="Campanhas em curso"
          value={counts.campaignsRunning ?? 0}
          detail={`${pendingJobs} job(s) aguardando processamento`}
          icon={Send}
          colorClass="text-pink-400"
        />
        <DashboardMetricCard
          title="Contatos"
          value={counts.contacts ?? 0}
          detail="Cadastros ativos na base"
          icon={Users}
          colorClass="text-cmm-emerald"
        />
      </div>

      {/* Failure badge */}
      {failures && (Number(failures.recentFailedJobs ?? 0) > 0 || Number(failures.totalFailedRecipients ?? 0) > 0) && (
        <div className="rounded-[2rem] border border-red-500/20 bg-red-500/5 p-6 animate-in slide-in-from-top-2 duration-500">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-red-500/10">
              <AlertCircle className="h-6 w-6 text-red-400" />
            </div>
            <div className="flex-1">
              <h3 className="font-display text-lg font-bold text-red-300 tracking-tight">Falhas detectadas</h3>
              <div className="flex gap-4 mt-1">
                {Number(failures.recentFailedJobs ?? 0) > 0 && (
                  <span className="text-xs font-bold text-red-400">{failures.recentFailedJobs} jobs falharam (24h)</span>
                )}
                {Number(failures.totalFailedRecipients ?? 0) > 0 && (
                  <span className="text-xs font-bold text-red-400">{failures.totalFailedRecipients} destinatarios com falha</span>
                )}
              </div>
            </div>
          </div>
          {failures.failedJobs && failures.failedJobs.length > 0 && (
            <div className="mt-4 space-y-1.5 max-h-[160px] overflow-y-auto custom-scrollbar">
              {failures.failedJobs.slice(0, 5).map((job) => (
                <div key={job.id} className="flex items-center justify-between rounded-xl bg-black/20 px-4 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] font-bold uppercase tracking-widest text-red-500">{job.type}</span>
                    <span className="text-xs text-slate-400 truncate max-w-[300px]">{job.error || "Sem detalhes"}</span>
                  </div>
                  <span className="text-[9px] text-slate-600 shrink-0">{new Date(job.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid gap-8 xl:grid-cols-2">
        <div className="group glass-card flex flex-col rounded-[2.5rem] border-white/5 bg-white/[0.01] transition-all duration-500 hover:bg-white/[0.03]">
          <div className="flex items-center justify-between border-b border-white/5 px-10 py-8">
            <div className="flex items-center gap-3">
              <div className="h-2 w-2 rounded-full bg-cmm-blue animate-pulse" />
              <h3 className="text-sm font-black uppercase tracking-[0.2em] text-slate-400">Conversas recentes</h3>
            </div>
            <button
              type="button"
              onClick={() => {
                window.location.hash = "#/inbox";
              }}
              className="text-[10px] font-black uppercase tracking-widest text-cmm-blue hover:underline"
            >
              Abrir inbox
            </button>
          </div>
          <div className="max-h-[500px] space-y-4 overflow-auto p-8 custom-scrollbar">
            {(dashboardQuery.data?.recentConversations ?? []).map((conversation) => {
              const conversationTitle = conversation.contact_name || conversation.title || "?";

              return (
                <div key={conversation.id} className="flex items-center justify-between rounded-3xl p-5 transition-all hover:bg-black/30">
                  <div className="flex items-center gap-5">
                    <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-gradient-to-br from-slate-800 to-slate-900 text-lg font-bold text-slate-300 shadow-xl">
                      {conversationTitle.charAt(0)}
                      {conversation.unread_count > 0 ? <span className="absolute -right-1 -top-1 h-4 w-4 rounded-full bg-cmm-blue border-2 border-slate-900" /> : null}
                    </div>
                    <div className="space-y-1">
                      <div className="font-bold tracking-tight text-white">{conversationTitle}</div>
                      <div className="line-clamp-1 text-xs font-medium text-slate-500">{conversation.last_message_preview || "Sem prévia recente"}</div>
                    </div>
                  </div>
                  <div className="text-right text-[9px] font-black uppercase tracking-widest text-slate-600">
                    {conversation.unread_count > 0 ? `${conversation.unread_count} não lida(s)` : "Sem pendência"}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="group glass-card flex flex-col rounded-[2.5rem] border-white/5 bg-white/[0.01] transition-all duration-500 hover:bg-white/[0.03]">
          <div className="flex items-center justify-between border-b border-white/5 px-10 py-8">
            <div className="flex items-center gap-3">
              <Activity className="h-4 w-4 text-slate-500" />
              <h3 className="text-sm font-black uppercase tracking-[0.2em] text-slate-400">Eventos recentes</h3>
            </div>
            <Clock className="h-4 w-4 text-slate-700" />
          </div>
          <div className="max-h-[500px] space-y-6 overflow-auto p-10 custom-scrollbar">
            {(dashboardQuery.data?.recentEvents ?? []).map((event) => (
              <div key={event.id} className="relative border-l border-white/5 py-1 pl-10">
                <div className="absolute left-[-5px] top-3 h-2 w-2 rounded-full border border-white/10 bg-slate-800" />
                <div className="mb-2 flex items-center justify-between gap-4">
                  <span
                    className={cn(
                      "rounded-full border px-3 py-1 text-[8px] font-black uppercase tracking-[0.2em]",
                      event.level === "error" ? "border-cmm-orange/20 bg-cmm-orange/5 text-cmm-orange" : "border-cmm-blue/20 bg-cmm-blue/5 text-cmm-blue"
                    )}
                  >
                    {event.level}
                  </span>
                  <span className="text-[9px] font-black uppercase tracking-widest text-slate-600">
                    {new Date(event.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                <p className="font-mono text-xs font-bold leading-relaxed tracking-tighter text-slate-400">{event.message}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
