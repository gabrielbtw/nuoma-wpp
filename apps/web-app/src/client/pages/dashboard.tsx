import { useQuery } from "@tanstack/react-query";
import { Activity, AlertCircle, Bot, CheckCircle2, Clock, MessageSquare, Send, Users } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorPanel } from "@/components/shared/error-panel";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";

function MetricWidget({
  title,
  value,
  detail,
  icon: Icon,
  colorClass
}: {
  title: string;
  value: string | number;
  detail: string;
  icon: any;
  colorClass: string;
}) {
  return (
    <div className="group relative glass-card overflow-hidden rounded-[2rem] border-white/5 bg-white/[0.01] p-8 transition-all duration-500 hover:bg-white/[0.04] hover:scale-[1.02] hover:shadow-2xl hover:shadow-black/40">
      <div className={cn("absolute -right-6 -top-6 h-32 w-32 rounded-full opacity-[0.03] blur-3xl transition-opacity group-hover:opacity-10", colorClass.replace("text-", "bg-"))} />
      <div className="flex flex-col gap-6">
        <div className={cn("flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5 shadow-inner transition-colors group-hover:bg-white/10", colorClass)}>
          <Icon className="h-6 w-6" />
        </div>
        <div>
          <h3 className="font-display text-4xl font-bold tracking-tight text-white">{value}</h3>
          <p className="mt-1 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">{title}</p>
          <p className="mt-3 text-sm text-slate-400">{detail}</p>
        </div>
      </div>
    </div>
  );
}

function normalizeStatus(input?: string | null) {
  return (input ?? "unknown").toLowerCase();
}

function isHealthyStatus(input?: string | null) {
  return ["ok", "online", "authenticated", "connected", "active", "assisted"].includes(normalizeStatus(input));
}

function dashboardHeadline(status: string) {
  if (status === "ok") {
    return "Operação estável";
  }

  if (status === "unknown") {
    return "Aguardando leitura do ambiente";
  }

  return "Atenção operacional";
}

function dashboardDescription({
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
    queryFn: () => apiFetch<any>("/dashboard"),
    refetchInterval: 30_000
  });

  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: () => apiFetch<any>("/health"),
    refetchInterval: 15_000
  });

  const counts = dashboardQuery.data?.counts ?? {};
  const overallStatus = normalizeStatus(healthQuery.data?.overallStatus ?? null);
  const workerStatus = normalizeStatus(healthQuery.data?.worker?.value?.status ?? null);
  const schedulerStatus = normalizeStatus(healthQuery.data?.scheduler?.value?.status ?? null);
  const channels = Object.values(healthQuery.data?.channels ?? {}) as Array<{
    mode?: string;
    worker?: { status?: string };
    account?: { status?: string };
  }>;
  const activeChannelCount = channels.filter((channel) =>
    isHealthyStatus(channel.account?.status) || isHealthyStatus(channel.worker?.status) || isHealthyStatus(channel.mode)
  ).length;
  const unreadConversations = Number(counts.unreadConversations ?? 0);
  const pendingJobs = Number(counts.pendingJobs ?? 0);

  return (
    <div className="space-y-12 pb-20 animate-in fade-in duration-1000">
      <PageHeader
        eyebrow="Visão Operacional"
        title="Dashboard"
        description="Resumo factual da operação local: canais, filas, campanhas e conversas mais recentes."
      />

      {dashboardQuery.error ? <ErrorPanel message={(dashboardQuery.error as Error).message} /> : null}
      {healthQuery.error ? <ErrorPanel message={(healthQuery.error as Error).message} /> : null}

      <section className="relative overflow-hidden rounded-[3rem] border border-white/5 bg-white/[0.01] p-12 shadow-2xl lg:p-20">
        <div className="absolute inset-0 bg-gradient-to-br from-cmm-blue/5 via-transparent to-cmm-emerald/5 opacity-70" />

        <div className="relative flex flex-col items-center gap-16 lg:flex-row lg:gap-24">
          <div className="relative flex h-80 w-80 shrink-0 items-center justify-center">
            <div
              className={cn(
                "absolute inset-0 rounded-full border-[2px] opacity-10 transition-colors duration-1000",
                overallStatus === "ok" ? "animate-pulse border-cmm-blue" : "border-cmm-orange"
              )}
            />
            <div
              className={cn(
                "absolute inset-10 rounded-full border border-dashed opacity-20 transition-colors duration-1000",
                overallStatus === "ok" ? "border-cmm-blue" : "border-cmm-orange"
              )}
            />
            <div
              className={cn(
                "absolute h-56 w-56 rounded-full blur-[60px] opacity-30 transition-all duration-1000",
                overallStatus === "ok" ? "bg-cmm-blue shadow-[0_0_100px_rgba(59,130,246,0.3)]" : "bg-cmm-orange shadow-[0_0_100px_rgba(245,158,11,0.3)]"
              )}
            />
            <div className="relative flex h-60 w-60 flex-col items-center justify-center rounded-full border border-white/10 bg-white/[0.03] shadow-[inset_0_0_40px_rgba(255,255,255,0.05)] backdrop-blur-3xl">
              {overallStatus === "ok" ? <CheckCircle2 className="h-20 w-20 text-cmm-blue" /> : <AlertCircle className="h-20 w-20 text-cmm-orange" />}
              <div className="mt-4 text-center">
                <p className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-500">Estado atual</p>
                <p className={cn("text-sm font-black tracking-widest", overallStatus === "ok" ? "text-cmm-blue" : "text-cmm-orange")}>
                  {overallStatus === "ok" ? "SEM ALERTAS" : overallStatus.toUpperCase()}
                </p>
              </div>
            </div>
          </div>

          <div className="flex-1 space-y-8 text-center lg:text-left">
            <div className="space-y-4">
              <h2 className="font-display text-4xl font-bold leading-tight tracking-tight text-white lg:text-5xl">{dashboardHeadline(overallStatus)}</h2>
              <p className="max-w-2xl text-lg font-medium leading-relaxed text-slate-400">
                {dashboardDescription({
                  overallStatus,
                  workerStatus,
                  schedulerStatus,
                  activeChannelCount,
                  pendingJobs
                })}
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-6 lg:justify-start">
              <button
                type="button"
                onClick={() => {
                  window.location.hash = "#/health";
                }}
                className="h-16 rounded-[2rem] bg-cmm-blue px-10 text-xs font-black uppercase tracking-[0.2em] text-white shadow-2xl shadow-blue-500/20 transition-all hover:scale-105 active:scale-95"
              >
                Abrir saúde do sistema
              </button>
              <div className="flex h-16 items-center gap-3 rounded-[2rem] border border-white/5 bg-white/[0.02] px-6 text-[10px] font-black uppercase tracking-widest text-slate-500">
                <Clock className="h-4 w-4 text-cmm-orange" />
                {unreadConversations} conversa(s) não lida(s)
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
        <MetricWidget
          title="Conversas"
          value={counts.conversations ?? 0}
          detail={`${unreadConversations} com pendência de leitura`}
          icon={MessageSquare}
          colorClass="text-cmm-blue"
        />
        <MetricWidget
          title="Automações ativas"
          value={counts.activeAutomations ?? 0}
          detail="Regras ligadas no ambiente local"
          icon={Bot}
          colorClass="text-cmm-orange"
        />
        <MetricWidget
          title="Campanhas em curso"
          value={counts.campaignsRunning ?? 0}
          detail={`${pendingJobs} job(s) aguardando processamento`}
          icon={Send}
          colorClass="text-pink-400"
        />
        <MetricWidget
          title="Contatos"
          value={counts.contacts ?? 0}
          detail="Cadastros ativos na base"
          icon={Users}
          colorClass="text-cmm-emerald"
        />
      </div>

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
            {(dashboardQuery.data?.recentConversations ?? []).map((item: any) => (
              <div key={item.id} className="flex items-center justify-between rounded-3xl p-5 transition-all hover:bg-black/30">
                <div className="flex items-center gap-5">
                  <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-gradient-to-br from-slate-800 to-slate-900 text-lg font-bold text-slate-300 shadow-xl">
                    {(item.contact_name || item.title || "?").charAt(0)}
                    {item.unread_count > 0 ? <span className="absolute -right-1 -top-1 h-4 w-4 rounded-full bg-cmm-blue border-2 border-slate-900" /> : null}
                  </div>
                  <div className="space-y-1">
                    <div className="font-bold tracking-tight text-white">{item.contact_name || item.title}</div>
                    <div className="line-clamp-1 text-xs font-medium text-slate-500">{item.last_message_preview || "Sem prévia recente"}</div>
                  </div>
                </div>
                <div className="text-right text-[9px] font-black uppercase tracking-widest text-slate-600">
                  {item.unread_count > 0 ? `${item.unread_count} não lida(s)` : "Sem pendência"}
                </div>
              </div>
            ))}
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
            {(dashboardQuery.data?.recentEvents ?? []).map((event: any) => (
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
