import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Clock3, Database, Globe, Instagram, MessageCircleMore, RefreshCw, ShieldAlert, ShieldCheck, Terminal as TerminalIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorPanel } from "@/components/shared/error-panel";
import { apiFetch } from "@/lib/api";
import { formatChannelDisplayValue } from "@/lib/contact-utils";
import { cn } from "@/lib/utils";

function stateTone(status?: string) {
  if (!status) return "default";
  const normalized = status.toLowerCase();
  if (["authenticated", "online", "ok", "active", "connected", "assisted"].includes(normalized)) return "success";
  if (["degraded", "disconnected", "paused", "warning", "starting"].includes(normalized)) return "warning";
  if (["error", "failed", "offline"].includes(normalized)) return "danger";
  return "info";
}

function HealthWidget({
  label,
  value,
  status,
  icon: Icon,
  subvalue
}: {
  label: string;
  value: string;
  status: string;
  icon: any;
  subvalue?: string;
}) {
  const tone = stateTone(status);
  const colors = {
    success: "text-cmm-emerald shadow-emerald-500/20",
    warning: "text-cmm-orange shadow-cmm-orange-500/20",
    danger: "text-red-400 shadow-red-500/20",
    info: "text-cmm-blue shadow-cmm-blue-500/20",
    default: "text-slate-400 shadow-none"
  };

  return (
    <div className="glass-card group relative overflow-hidden rounded-[2rem] border-white/5 bg-white/[0.01] p-6 transition-all hover:bg-white/[0.03]">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">{label}</p>
          <h4 className={cn("text-2xl font-black tracking-tighter text-white", tone !== "default" && colors[tone])}>{value}</h4>
          {subvalue ? <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{subvalue}</p> : null}
        </div>
        <div className={cn("flex h-12 w-12 items-center justify-center rounded-2xl border border-white/5 bg-white/5 shadow-inner transition-transform group-hover:scale-110", tone !== "default" && colors[tone])}>
          <Icon className="h-6 w-6" />
        </div>
      </div>
      <div
        className={cn(
          "absolute -bottom-8 -right-8 h-16 w-16 rounded-full opacity-20 blur-2xl transition-opacity group-hover:opacity-40",
          tone === "success" ? "bg-cmm-emerald" : tone === "warning" ? "bg-cmm-orange" : tone === "danger" ? "bg-red-500" : "bg-cmm-blue"
        )}
      />
    </div>
  );
}

function basename(value?: string) {
  if (!value) {
    return "não configurado";
  }

  const parts = value.split("/");
  return parts[parts.length - 1] || value;
}

function channelIdentity(channel: any) {
  const type = String(channel?.account?.type ?? channel?.label ?? "").toLowerCase();
  const identifier = typeof channel?.sessionIdentifier === "string" ? channel.sessionIdentifier.trim() : "";

  if (!identifier) {
    return "Sessão não confirmada";
  }

  return type.includes("instagram") ? (identifier.startsWith("@") ? identifier : `@${identifier}`) : formatChannelDisplayValue("whatsapp", identifier);
}

function channelVisual(channel: any) {
  const identity = String(channel?.label ?? channel?.mode ?? "").toLowerCase();

  if (identity.includes("instagram")) {
    return {
      icon: Instagram,
      accent: "text-pink-300",
      glow: "from-pink-500/18 via-transparent to-cmm-blue/10",
      metricTone: "text-pink-200"
    };
  }

  return {
    icon: MessageCircleMore,
    accent: "text-cmm-emerald",
    glow: "from-cmm-emerald/18 via-transparent to-cmm-blue/10",
    metricTone: "text-cmm-emerald"
  };
}

export function SystemHealthPage() {
  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: () => apiFetch<any>("/health"),
    refetchInterval: 15_000
  });

  const logsQuery = useQuery({
    queryKey: ["logs", "recent"],
    queryFn: () => apiFetch<any>("/logs?limit=20"),
    refetchInterval: 10_000
  });

  const data = healthQuery.data ?? {};
  const worker = data.worker?.value ?? {};
  const scheduler = data.scheduler?.value ?? {};
  const channels = data.channels ?? {};
  const channelList = Object.values(channels) as any[];
  const instagramWorkerStatus = channels.instagram?.worker?.status ?? channels.instagram?.mode ?? "unknown";
  const databasePath = typeof data.databasePath === "string" ? data.databasePath : "";
  const hasCriticalFailure = Boolean(worker.lastFailureSummary || worker.lastErrorType || worker.lastFailureAt);

  return (
    <div className="space-y-10 pb-20 animate-in fade-in duration-700">
      <PageHeader
        eyebrow="Operacional"
        title="Saúde do Sistema"
        description="Leitura factual do runtime local: workers, scheduler, banco, filas e eventos recentes."
        actions={
          <div className="flex items-center gap-3 rounded-2xl border border-white/5 bg-white/5 p-1.5 backdrop-blur-md">
            <Button variant="ghost" size="sm" className="h-10 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-white" onClick={() => healthQuery.refetch()}>
              <RefreshCw className={cn("mr-2 h-3.5 w-3.5", healthQuery.isFetching && "animate-spin")} />
              Atualizar
            </Button>
            <div className="h-4 w-px bg-white/10" />
            <Button
              variant="secondary"
              size="sm"
              className="h-10 rounded-xl px-5 text-[10px] font-black uppercase tracking-widest bg-cmm-blue text-white shadow-lg shadow-blue-500/20"
              onClick={() => {
                window.location.hash = "#/logs";
              }}
            >
              Abrir logs
            </Button>
          </div>
        }
      />

      {healthQuery.error ? <ErrorPanel message={(healthQuery.error as Error).message} /> : null}
      {logsQuery.error ? <ErrorPanel message={(logsQuery.error as Error).message} /> : null}

      <div className="space-y-6">
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          <HealthWidget label="Saúde do sistema" value={String(data.overallStatus ?? "unknown").toUpperCase()} status={data.overallStatus ?? "unknown"} icon={ShieldCheck} subvalue="Leitura consolidada" />
          <HealthWidget label="Scheduler" value={String(scheduler.status ?? "offline").toUpperCase()} status={scheduler.status ?? "offline"} icon={Clock3} subvalue="Execução da fila" />
          <HealthWidget label="Banco local" value="SQLITE" status="online" icon={Database} subvalue={basename(databasePath)} />
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <HealthWidget label="Worker WhatsApp" value={String(worker.status ?? "offline").toUpperCase()} status={worker.status ?? "offline"} icon={MessageCircleMore} subvalue={channels.whatsapp ? channelIdentity(channels.whatsapp) : `${worker.memoryMb ?? 0} MB em memória`} />
          <HealthWidget label="Instagram assistido" value={String(instagramWorkerStatus).toUpperCase()} status={instagramWorkerStatus} icon={Instagram} subvalue={channels.instagram ? channelIdentity(channels.instagram) : "Sessão não confirmada"} />
        </div>
      </div>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.95fr)]">
        <div className="space-y-8">
          <div className="glass-card overflow-hidden rounded-[2.5rem] border-white/5 bg-black/40 backdrop-blur-3xl">
            <div className="flex items-center justify-between border-b border-white/5 bg-white/[0.02] px-8 py-5">
              <div className="flex items-center gap-3">
                <TerminalIcon className="h-5 w-5 text-cmm-blue" />
                <h3 className="text-xs font-black uppercase tracking-[0.2em] text-slate-300">Eventos recentes</h3>
              </div>
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">{(logsQuery.data?.events ?? []).length} em tela</span>
            </div>
            <div className="h-[500px] overflow-auto p-8 font-mono text-[13px] leading-relaxed custom-scrollbar selection:bg-cmm-blue selection:text-white">
              <div className="space-y-2">
                {(logsQuery.data?.events ?? []).map((event: any, index: number) => (
                  <div key={event.id || index} className="group flex gap-4 animate-in fade-in slide-in-from-left-2 duration-300">
                    <span className="shrink-0 text-slate-600">[{new Date(event.created_at).toLocaleTimeString()}]</span>
                    <span
                      className={cn(
                        "mt-1 shrink-0 text-[10px] font-black uppercase tracking-widest",
                        event.level === "error" ? "text-red-400" : event.level === "warn" ? "text-cmm-orange" : "text-cmm-blue"
                      )}
                    >
                      {event.level}
                    </span>
                    <span className="text-slate-300 transition-colors group-hover:text-white">{event.message}</span>
                  </div>
                ))}
                {logsQuery.isLoading ? (
                  <div className="flex items-center gap-2 py-4 italic text-slate-500">
                    <RefreshCw className="h-3 w-3 animate-spin" />
                    Carregando eventos...
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="glass-card rounded-[2.5rem] border-white/5 bg-white/[0.01] p-10">
            <div className="mb-8 flex items-center gap-4">
              <Globe className="h-6 w-6 text-cmm-emerald" />
              <h3 className="text-sm font-black uppercase tracking-[0.2em] text-slate-300">Indicadores operacionais</h3>
            </div>
            <div className="grid gap-6 md:grid-cols-2">
              {[
                { label: "Autenticação WhatsApp", value: worker.authStatus || "N/A", status: worker.authStatus === "authenticated" ? "online" : "warning" },
                { label: "Falhas consecutivas", value: worker.consecutiveFailures ?? 0, status: (worker.consecutiveFailures || 0) > 0 ? "warning" : "ok" },
                { label: "Campanhas em execução", value: data.metrics?.activeCampaigns ?? 0, status: "info" },
                { label: "Conversas aguardando", value: data.metrics?.waitingConversations ?? 0, status: (data.metrics?.waitingConversations || 0) > 10 ? "warning" : "ok" }
              ].map((metric) => (
                <div key={metric.label} className="flex h-32 flex-col justify-between rounded-3xl border border-white/5 bg-white/[0.02] p-6">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">{metric.label}</span>
                  <div className="flex items-end justify-between">
                    <span className="text-2xl font-black tracking-tighter text-white">{metric.value}</span>
                    <Badge tone={stateTone(metric.status)} className="rounded-full px-3 py-0.5 text-[9px] font-black uppercase tracking-widest">
                      {metric.status.toUpperCase()}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-8">
          <div className="glass-card rounded-[2.5rem] border-white/5 bg-white/[0.01] p-8">
            <div className="mb-8 flex items-start justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/5 bg-cmm-blue/10 text-cmm-blue shadow-[0_12px_40px_rgba(0,122,255,0.18)]">
                  <Globe className="h-6 w-6" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-black uppercase tracking-[0.2em] text-slate-300">Canais disponíveis</h3>
                  <p className="text-sm text-slate-400">Conectividade, conta ativa e volume mapeado por canal.</p>
                </div>
              </div>
              <Badge tone="info" className="rounded-full px-3 py-1 text-[9px] font-black uppercase tracking-widest">
                {channelList.length} canais
              </Badge>
            </div>
            <div className="space-y-5">
              {channelList.map((channel) => {
                const visual = channelVisual(channel);
                const ChannelIcon = visual.icon;

                return (
                  <div
                    key={channel.label}
                    className={cn(
                      "group relative overflow-hidden rounded-[2rem] border border-white/5 bg-white/[0.02] p-6 transition-all hover:bg-white/[0.04]",
                      "before:absolute before:inset-0 before:bg-gradient-to-br before:opacity-100 before:content-['']",
                      visual.glow
                    )}
                  >
                    <div className="relative space-y-5">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-center gap-4">
                          <div className={cn("flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-black/20", visual.accent)}>
                            <ChannelIcon className="h-5 w-5" />
                          </div>
                          <div className="space-y-1">
                            <h4 className="font-display text-lg font-bold tracking-tight text-white">{channel.label}</h4>
                            <p className="text-sm text-slate-400">{channelIdentity(channel)}</p>
                          </div>
                        </div>
                        <Badge tone={stateTone(channel.account?.status || channel.worker?.status || channel.mode)} className="rounded-full px-3 py-0.5 text-[9px] font-black uppercase tracking-widest">
                          {channel.account?.status || channel.worker?.status || channel.mode}
                        </Badge>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div className="rounded-2xl border border-white/5 bg-black/20 p-4">
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Modo</p>
                          <p className="mt-2 text-sm font-semibold uppercase tracking-wide text-slate-100">{channel.mode || "—"}</p>
                        </div>
                        <div className="rounded-2xl border border-white/5 bg-black/20 p-4">
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Conversas</p>
                          <p className={cn("mt-2 text-2xl font-black tracking-tighter", visual.metricTone)}>{channel.mappedConversations ?? 0}</p>
                        </div>
                        <div className="rounded-2xl border border-white/5 bg-black/20 p-4">
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Canais mapeados</p>
                          <p className="mt-2 text-2xl font-black tracking-tighter text-white">{channel.mappedContactChannels ?? 0}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className={cn("glass-card rounded-[2.5rem] border-white/5 p-8", hasCriticalFailure ? "bg-red-500/[0.03]" : "bg-emerald-500/[0.03]")}>
            <div className="mb-8 flex items-start justify-between gap-4">
              <div className="flex items-center gap-4">
                <div
                  className={cn(
                    "flex h-12 w-12 items-center justify-center rounded-2xl border border-white/5 shadow-[0_12px_40px_rgba(15,23,42,0.25)]",
                    hasCriticalFailure ? "bg-red-500/12 text-red-300" : "bg-cmm-emerald/10 text-cmm-emerald"
                  )}
                >
                  {hasCriticalFailure ? <ShieldAlert className="h-6 w-6" /> : <ShieldCheck className="h-6 w-6" />}
                </div>
                <div className="space-y-1">
                  <h3 className={cn("text-sm font-black uppercase tracking-[0.2em]", hasCriticalFailure ? "text-red-300" : "text-emerald-300")}>Última falha crítica</h3>
                  <p className="text-sm text-slate-400">Resumo do incidente mais recente e sinais de recuperação do worker.</p>
                </div>
              </div>
              <Badge tone={hasCriticalFailure ? "danger" : "success"} className="rounded-full px-3 py-1 text-[9px] font-black uppercase tracking-widest">
                {hasCriticalFailure ? "Atenção necessária" : "Sem incidentes ativos"}
              </Badge>
            </div>
            <div className="space-y-5">
              <div
                className={cn(
                  "rounded-[2rem] border p-6",
                  hasCriticalFailure ? "border-red-500/20 bg-red-500/10" : "border-emerald-500/20 bg-emerald-500/10"
                )}
              >
                <div className="flex items-start gap-4">
                  <div
                    className={cn(
                      "mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/10",
                      hasCriticalFailure ? "bg-red-500/15 text-red-300" : "bg-cmm-emerald/15 text-cmm-emerald"
                    )}
                  >
                    <AlertTriangle className="h-4.5 w-4.5" />
                  </div>
                  <div className="space-y-2">
                    <p className={cn("text-base font-bold leading-relaxed", hasCriticalFailure ? "text-red-100" : "text-emerald-100")}>
                      {worker.lastFailureSummary || "Nenhuma falha crítica registrada no momento."}
                    </p>
                    <p className="text-sm leading-relaxed text-slate-400">
                      {hasCriticalFailure
                        ? "Use os eventos recentes para rastrear a sequência completa do erro antes de reenfileirar novas ações."
                        : "O worker está operacional e não há registro recente de falha crítica pendente de ação."}
                    </p>
                  </div>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-white/5 bg-black/20 p-4">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Tipo</p>
                  <p className="mt-2 text-sm font-semibold text-slate-100">{worker.lastErrorType || "N/A"}</p>
                </div>
                <div className="rounded-2xl border border-white/5 bg-black/20 p-4">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Registro</p>
                  <p className="mt-2 text-sm font-semibold text-slate-100">{worker.lastFailureAt ? new Date(worker.lastFailureAt).toLocaleString() : "Sem horário"}</p>
                </div>
                <div className="rounded-2xl border border-white/5 bg-black/20 p-4">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Falhas consecutivas</p>
                  <p className={cn("mt-2 text-2xl font-black tracking-tighter", (worker.consecutiveFailures || 0) > 0 ? "text-cmm-orange" : "text-cmm-emerald")}>
                    {worker.consecutiveFailures ?? 0}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
