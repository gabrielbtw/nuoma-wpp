import { useQuery } from "@tanstack/react-query";
import {
  Activity, AlertTriangle, Clock3, Database, Globe, Instagram,
  MessageCircleMore, RefreshCw, ShieldAlert, ShieldCheck,
  Terminal as TerminalIcon, Wifi, WifiOff, type LucideIcon
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ErrorPanel } from "@/components/shared/error-panel";
import { apiFetch } from "@/lib/api";
import { formatChannelDisplayValue } from "@/lib/contact-utils";
import type { ChannelHealthRecord, HealthResponse, LogsResponse } from "@/lib/system-types";
import { cn } from "@/lib/utils";

type StatusLevel = "ok" | "warn" | "error" | "unknown";

function resolveStatus(status?: string): StatusLevel {
  if (!status) return "unknown";
  const s = status.toLowerCase();
  if (["authenticated", "online", "ok", "active", "connected", "assisted"].includes(s)) return "ok";
  if (["degraded", "disconnected", "paused", "warning", "starting"].includes(s)) return "warn";
  if (["error", "failed", "offline"].includes(s)) return "error";
  return "unknown";
}

const statusConfig: Record<StatusLevel, { dot: string; text: string; bg: string; border: string }> = {
  ok: { dot: "active", text: "text-n-wa", bg: "bg-n-wa/5", border: "border-n-wa/20" },
  warn: { dot: "warning", text: "text-n-amber", bg: "bg-n-amber/5", border: "border-n-amber/20" },
  error: { dot: "error", text: "text-n-red", bg: "bg-n-red/5", border: "border-n-red/20" },
  unknown: { dot: "idle", text: "text-n-text-dim", bg: "bg-n-surface-2", border: "border-n-border" }
};

function StatusRow({ label, value, status, detail, icon: Icon }: {
  label: string; value: string; status: StatusLevel; detail?: string; icon: LucideIcon;
}) {
  const cfg = statusConfig[status];
  return (
    <div className={cn("flex items-center gap-3 rounded-lg border p-3 transition-fast", cfg.border, cfg.bg)}>
      <Icon className={cn("h-4 w-4 shrink-0", cfg.text)} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-label text-n-text-muted">{label}</span>
          <span className={cn("signal-dot", cfg.dot)} />
        </div>
        <div className="flex items-baseline gap-2">
          <span className={cn("font-mono text-h4", cfg.text)}>{value}</span>
          {detail && <span className="text-micro text-n-text-dim truncate">{detail}</span>}
        </div>
      </div>
    </div>
  );
}

function MetricBox({ label, value, status }: { label: string; value: string | number; status?: StatusLevel }) {
  const cfg = statusConfig[status ?? "unknown"];
  return (
    <div className="rounded-lg border border-n-border bg-n-surface p-3">
      <p className="text-micro uppercase text-n-text-dim">{label}</p>
      <p className={cn("mt-1 font-mono text-h3", status && status !== "unknown" ? cfg.text : "text-n-text")}>{value}</p>
    </div>
  );
}

function formatIdentity(channel: ChannelHealthRecord) {
  const type = String(channel?.account?.type ?? channel?.label ?? "").toLowerCase();
  const id = typeof channel?.sessionIdentifier === "string" ? channel.sessionIdentifier.trim() : "";
  if (!id) return "Nao confirmado";
  return type.includes("instagram") ? (id.startsWith("@") ? id : `@${id}`) : formatChannelDisplayValue("whatsapp", id);
}

function dbName(path?: string) {
  if (!path) return "N/A";
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

export function SystemHealthPage() {
  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: () => apiFetch<HealthResponse>("/health"),
    refetchInterval: 15_000
  });

  const logsQuery = useQuery({
    queryKey: ["logs", "recent"],
    queryFn: () => apiFetch<LogsResponse>("/logs?limit=30"),
    refetchInterval: 10_000
  });

  const data: HealthResponse = healthQuery.data ?? {};
  const worker = data.worker?.value ?? {};
  const scheduler = data.scheduler?.value ?? {};
  const channels = data.channels ?? {};
  const channelList: ChannelHealthRecord[] = Object.values(channels);
  const igStatus = channels.instagram?.worker?.status ?? channels.instagram?.mode ?? "unknown";
  const dbPath = typeof data.databasePath === "string" ? data.databasePath : "";
  const hasCritical = Boolean(worker.lastFailureSummary || worker.lastErrorType);

  const overallLevel = resolveStatus(String(data.overallStatus ?? ""));
  const workerLevel = resolveStatus(String(worker.status ?? ""));
  const schedulerLevel = resolveStatus(String(scheduler.status ?? ""));
  const igLevel = resolveStatus(String(igStatus));

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-h1 text-n-text">Saude do Sistema</h1>
          <p className="text-caption text-n-text-muted mt-0.5">Runtime, workers, banco, canais e eventos</p>
        </div>
        <button
          onClick={() => { healthQuery.refetch(); logsQuery.refetch(); }}
          className="flex items-center gap-2 rounded-lg border border-n-border bg-n-surface px-3 py-1.5 text-label text-n-text-muted transition-fast hover:bg-n-surface-2 hover:text-n-text"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", healthQuery.isFetching && "animate-spin")} />
          Atualizar
        </button>
      </div>

      {healthQuery.error && <ErrorPanel message={(healthQuery.error as Error).message} />}

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        {/* Left column */}
        <div className="space-y-4">
          {/* Status grid */}
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            <StatusRow icon={ShieldCheck} label="Sistema" value={String(data.overallStatus ?? "unknown").toUpperCase()} status={overallLevel} />
            <StatusRow icon={Clock3} label="Scheduler" value={String(scheduler.status ?? "offline").toUpperCase()} status={schedulerLevel} />
            <StatusRow icon={Database} label="SQLite" value="ONLINE" status="ok" detail={dbName(dbPath)} />
            <StatusRow icon={MessageCircleMore} label="WhatsApp" value={String(worker.status ?? "offline").toUpperCase()} status={workerLevel}
              detail={channels.whatsapp ? formatIdentity(channels.whatsapp) : undefined} />
            <StatusRow icon={Instagram} label="Instagram" value={String(igStatus).toUpperCase()} status={igLevel}
              detail={channels.instagram ? formatIdentity(channels.instagram) : undefined} />
            <StatusRow icon={Activity} label="Memoria" value={`${worker.memoryMb ?? 0} MB`} status={Number(worker.memoryMb ?? 0) > 600 ? "warn" : "ok"} />
          </div>

          {/* Metrics */}
          <div className="grid gap-2 md:grid-cols-4">
            <MetricBox label="Auth WA" value={String(worker.authStatus ?? "N/A")} status={worker.authStatus === "authenticated" ? "ok" : "warn"} />
            <MetricBox label="Falhas consecutivas" value={String(worker.consecutiveFailures ?? 0)} status={Number(worker.consecutiveFailures ?? 0) > 0 ? "warn" : "ok"} />
            <MetricBox label="Campanhas ativas" value={String(data.metrics?.activeCampaigns ?? 0)} />
            <MetricBox label="Conversas esperando" value={String(data.metrics?.waitingConversations ?? 0)} status={Number(data.metrics?.waitingConversations ?? 0) > 10 ? "warn" : undefined} />
          </div>

          {/* Channels detail */}
          {channelList.length > 0 && (
            <div className="rounded-xl border border-n-border bg-n-surface">
              <div className="flex items-center justify-between border-b border-n-border px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <Globe className="h-3.5 w-3.5 text-n-blue" />
                  <span className="text-label text-n-text">Canais</span>
                </div>
                <span className="text-micro text-n-text-dim">{channelList.length} configurados</span>
              </div>
              <div className="divide-y divide-n-border-subtle">
                {channelList.map((ch) => {
                  const isIg = String(ch.label ?? "").toLowerCase().includes("instagram");
                  const ChIcon = isIg ? Instagram : MessageCircleMore;
                  const chStatus = resolveStatus(ch.account?.status || ch.worker?.status || ch.mode);
                  const cfg = statusConfig[chStatus];
                  return (
                    <div key={ch.label} className="flex items-center gap-3 px-4 py-3">
                      <ChIcon className={cn("h-4 w-4", isIg ? "text-n-ig" : "text-n-wa")} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-body font-semibold text-n-text">{ch.label}</span>
                          <span className={cn("signal-dot", cfg.dot)} />
                          <span className={cn("text-micro", cfg.text)}>{ch.account?.status || ch.mode || "—"}</span>
                        </div>
                        <span className="text-caption text-n-text-muted">{formatIdentity(ch)}</span>
                      </div>
                      <div className="flex gap-4 text-right">
                        <div>
                          <p className="text-micro text-n-text-dim">Conversas</p>
                          <p className="font-mono text-body font-semibold text-n-text">{ch.mappedConversations ?? 0}</p>
                        </div>
                        <div>
                          <p className="text-micro text-n-text-dim">Canais</p>
                          <p className="font-mono text-body font-semibold text-n-text">{ch.mappedContactChannels ?? 0}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Critical failure */}
          {hasCritical && (
            <div className="rounded-xl border border-n-red/20 bg-n-red/5 p-4">
              <div className="flex items-start gap-3">
                <ShieldAlert className="h-4 w-4 text-n-red shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="text-label text-n-red">Ultima falha critica</p>
                  <p className="mt-1 text-body text-n-text">{worker.lastFailureSummary || "Sem detalhes"}</p>
                  <div className="mt-2 flex gap-4 text-caption text-n-text-muted">
                    <span>Tipo: {worker.lastErrorType || "N/A"}</span>
                    <span>Em: {worker.lastFailureAt ? new Date(String(worker.lastFailureAt)).toLocaleString() : "—"}</span>
                    <span>Consecutivas: {worker.consecutiveFailures ?? 0}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right column: Event log */}
        <div className="rounded-xl border border-n-border bg-n-surface overflow-hidden flex flex-col">
          <div className="flex items-center justify-between border-b border-n-border px-4 py-2.5">
            <div className="flex items-center gap-2">
              <TerminalIcon className="h-3.5 w-3.5 text-n-blue" />
              <span className="text-label text-n-text">Eventos recentes</span>
            </div>
            <span className="text-micro text-n-text-dim">{(logsQuery.data?.events ?? []).length}</span>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar max-h-[calc(100vh-16rem)]">
            <div className="p-3 space-y-0.5 font-mono text-caption">
              {(logsQuery.data?.events ?? []).map((event, i) => (
                <div key={event.id || i} className="flex gap-2 rounded px-2 py-1 hover:bg-n-surface-2 transition-fast">
                  <span className="shrink-0 text-n-text-dim">{new Date(event.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                  <span className={cn("shrink-0 text-micro uppercase w-10",
                    event.level === "error" ? "text-n-red" : event.level === "warn" ? "text-n-amber" : "text-n-blue"
                  )}>{event.level}</span>
                  <span className="text-n-text-muted truncate">{event.message}</span>
                </div>
              ))}
              {(logsQuery.data?.events ?? []).length === 0 && (
                <div className="py-8 text-center text-n-text-dim">Sem eventos recentes</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
