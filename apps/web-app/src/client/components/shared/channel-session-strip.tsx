import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Clock, Globe2,
  History, Instagram, LoaderCircle, MessageCircleMore, Power,
  RefreshCw, Shield, Wifi, WifiOff, Zap
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { formatChannelDisplayValue } from "@/lib/contact-utils";
import type { HealthResponse, InstagramSessionResponse, RuntimeProcessState } from "@/lib/system-types";
import { cn } from "@/lib/utils";

// ── Types ──

type SessionViewModel = {
  key: "whatsapp" | "instagram";
  label: string;
  detail: string;
  state: "ready" | "attention" | "offline" | "loading";
  statusText: string;
  icon: typeof MessageCircleMore;
  profileName: string;
  lastSyncAgo: string;
  uptimeLabel: string;
  authDetail: string;
  isSyncing: boolean;
};

// ── Helpers ──

function readTrimmedText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function formatInstagramDetail(value: string) {
  const normalized = value.trim();
  if (!normalized) return "Sessao indisponivel";
  if (normalized.startsWith("@")) return normalized;
  return normalized.includes(" ") ? normalized : `@${normalized}`;
}

function timeAgo(isoOrMs: string | number | undefined | null): string {
  if (!isoOrMs) return "nunca";
  const ms = typeof isoOrMs === "number" ? isoOrMs : new Date(isoOrMs).getTime();
  const diff = Math.max(0, Date.now() - ms);
  if (diff < 60_000) return "agora";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

function formatUptime(seconds: number | undefined | null): string {
  if (!seconds || seconds <= 0) return "—";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}min`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}min`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}

// ── View Model Builders ──

function buildWhatsAppSessionViewModel(health: HealthResponse | undefined, loading: boolean): SessionViewModel {
  if (loading && !health) {
    return {
      key: "whatsapp", label: "WhatsApp", detail: "Consultando worker",
      state: "loading", statusText: "Verificando", icon: MessageCircleMore,
      profileName: "", lastSyncAgo: "", uptimeLabel: "", authDetail: "", isSyncing: false
    };
  }

  const worker: RuntimeProcessState = health?.worker?.value ?? health?.channels?.whatsapp?.worker ?? {};
  const phoneLabel =
    readTrimmedText(worker.sessionPhone) ||
    readTrimmedText(worker.phoneNumber) ||
    readTrimmedText(worker.phone) ||
    readTrimmedText(health?.channels?.whatsapp?.sessionIdentifier) || "";
  const status = readTrimmedText(worker.status).toLowerCase();
  const authStatus = readTrimmedText(worker.authStatus).toLowerCase();
  const workerLive = worker.live !== false;
  const ready = workerLive && (authStatus === "authenticated" || status === "authenticated" || status === "degraded");
  const attention = workerLive && !ready && ["starting", "restarting", "connecting"].includes(status);
  const accountLabel = phoneLabel
    ? formatChannelDisplayValue("whatsapp", phoneLabel)
    : ready
      ? readTrimmedText(worker.profileName) || readTrimmedText(worker.sessionName) || "Sessao ativa"
      : "Sessao indisponivel";

  const profileName = readTrimmedText(worker.profileName) || readTrimmedText(worker.sessionName) || "";
  const lastSyncAt = worker.lastSyncAt ?? worker.updatedAt ?? null;
  const uptimeSec = typeof worker.uptimeSec === "number" ? worker.uptimeSec : null;
  const isSyncing = status === "syncing" || worker.browserTask === "sync";

  return {
    key: "whatsapp", label: "WhatsApp", detail: accountLabel,
    state: ready ? "ready" : attention ? "attention" : "offline",
    statusText: ready ? "Logado" : attention ? "Inicializando" : "Desconectado",
    icon: MessageCircleMore, profileName,
    lastSyncAgo: timeAgo(lastSyncAt as string | null),
    uptimeLabel: formatUptime(uptimeSec),
    authDetail: authStatus || status || "unknown",
    isSyncing: Boolean(isSyncing)
  };
}

function buildInstagramSessionViewModel(
  health: HealthResponse | undefined,
  session: InstagramSessionResponse | undefined,
  loading: boolean
): SessionViewModel {
  if (loading && !session && !health) {
    return {
      key: "instagram", label: "Instagram", detail: "Consultando sessao",
      state: "loading", statusText: "Verificando", icon: Instagram,
      profileName: "", lastSyncAgo: "", uptimeLabel: "", authDetail: "", isSyncing: false
    };
  }

  const worker: RuntimeProcessState = health?.channels?.instagram?.worker ?? {};
  const accountLabel =
    readTrimmedText(session?.username) ||
    readTrimmedText(session?.accountUsername) ||
    readTrimmedText(health?.channels?.instagram?.sessionIdentifier) || "";
  const sessionStatus = readTrimmedText(session?.status).toLowerCase();
  const workerStatus = readTrimmedText(worker.status).toLowerCase();
  const ready = session?.authenticated === true || sessionStatus === "connected" || worker.authenticated === true || workerStatus === "connected";
  const attention = !ready && (sessionStatus === "assisted" || workerStatus === "assisted" || workerStatus === "starting");

  return {
    key: "instagram", label: "Instagram",
    detail: ready || attention ? formatInstagramDetail(accountLabel) : "Sessao indisponivel",
    state: ready ? "ready" : attention ? "attention" : "offline",
    statusText: ready ? "Logado" : attention ? "Sessao aberta" : "Desconectado",
    icon: Instagram, profileName: accountLabel,
    lastSyncAgo: timeAgo(worker.lastSyncAt as string | null ?? worker.updatedAt as string | null),
    uptimeLabel: formatUptime(typeof worker.uptimeSec === "number" ? worker.uptimeSec : null),
    authDetail: sessionStatus || workerStatus || "unknown",
    isSyncing: workerStatus === "syncing" || worker.browserTask === "sync"
  };
}

// ── Tone map ──

const toneMap = {
  ready: {
    bg: "bg-n-wa/[0.06]",
    ring: "ring-n-wa/15",
    text: "text-n-wa",
    iconBox: "bg-n-wa/10 text-n-wa",
    dot: "active" as const,
    barColor: "bg-n-wa"
  },
  attention: {
    bg: "bg-n-amber/[0.06]",
    ring: "ring-n-amber/15",
    text: "text-n-amber",
    iconBox: "bg-n-amber/10 text-n-amber",
    dot: "warning" as const,
    barColor: "bg-n-amber"
  },
  offline: {
    bg: "bg-n-red/[0.04]",
    ring: "ring-n-red/15",
    text: "text-n-red",
    iconBox: "bg-n-red/10 text-n-red",
    dot: "error" as const,
    barColor: "bg-n-red"
  },
  loading: {
    bg: "bg-n-surface-2",
    ring: "ring-white/[0.04]",
    text: "text-n-text-dim",
    iconBox: "bg-n-surface-2 text-n-text-dim",
    dot: "idle" as const,
    barColor: "bg-n-text-dim"
  }
};

// ── Session Card ──

function SessionCard({
  session,
  compact = false,
  onReconnect
}: {
  session: SessionViewModel;
  compact?: boolean;
  onReconnect?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const tone = toneMap[session.state];
  const Icon = session.state === "loading" ? LoaderCircle : session.icon;

  if (compact) {
    return (
      <div className={cn(
        "flex items-center gap-2 rounded-xl px-2.5 py-1.5 ring-1 transition-all duration-200",
        tone.bg, tone.ring
      )}>
        <div className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-lg", tone.iconBox)}>
          <Icon className={cn("h-3 w-3", session.state === "loading" && "animate-spin")} />
        </div>
        <div className="min-w-0 flex-1">
          <p className={cn("truncate text-label font-medium", tone.text)}>{session.statusText}</p>
        </div>
        {/* Melhoria 4: Animacao de pulso quando sincronizando */}
        <span className={cn(
          "signal-dot shrink-0",
          `${tone.dot}`,
          session.isSyncing && "animate-pulse"
        )} />
      </div>
    );
  }

  return (
    <div className={cn(
      "rounded-2xl ring-1 transition-all duration-300 overflow-hidden",
      tone.bg, tone.ring,
      expanded && "shadow-lg shadow-black/10"
    )}>
      {/* Melhoria 8: Health bar visual no topo */}
      <div className={cn("h-[2px] transition-all duration-500", tone.barColor, session.state === "loading" && "animate-pulse")} />

      <div className="px-4 py-3">
        {/* Main row */}
        <div className="flex items-center gap-3">
          <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ring-white/[0.04]", tone.iconBox)}>
            <Icon className={cn("h-4 w-4", session.state === "loading" && "animate-spin")} />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className={cn("text-h4", tone.text)}>{session.statusText}</span>
              {/* Melhoria 4: Pulso de syncing */}
              <span className={cn(
                "signal-dot shrink-0",
                `${tone.dot}`,
                session.isSyncing && "animate-pulse"
              )} />
            </div>
            {/* Melhoria 1: Mostrar detail (phone/handle) + profile name */}
            <p className="text-caption text-n-text-dim truncate mt-0.5">
              {session.detail}
              {session.profileName && session.profileName !== session.detail && (
                <span className="text-n-text-muted"> · {session.profileName}</span>
              )}
            </p>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Melhoria 2: Botao reconectar (offline only) */}
            {session.state === "offline" && onReconnect && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onReconnect(); }}
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-n-surface-2 text-n-text-dim ring-1 ring-white/[0.04] transition-all duration-200 hover:bg-n-blue/10 hover:text-n-blue"
                title="Reconectar canal"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            )}
            {/* Melhoria 5: Expandir detalhes */}
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="flex h-7 w-7 items-center justify-center rounded-lg bg-n-surface-2/50 text-n-text-dim transition-all duration-200 hover:bg-n-surface-2"
            >
              {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        {/* Melhoria 3: Ultimo sync + Melhoria 5: Detalhes expandidos */}
        {!expanded && session.state !== "loading" && (
          <div className="flex items-center gap-3 mt-2 ml-12">
            <div className="flex items-center gap-1 text-micro text-n-text-dim">
              <Clock className="h-2.5 w-2.5" />
              Sync: {session.lastSyncAgo}
            </div>
            {session.uptimeLabel && session.uptimeLabel !== "—" && (
              <div className="flex items-center gap-1 text-micro text-n-text-dim">
                <Zap className="h-2.5 w-2.5" />
                Up: {session.uptimeLabel}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Expanded details panel — Melhoria 5: Tooltip/detalhes completos */}
      {expanded && (
        <div className="border-t border-n-border/30 px-4 py-3 space-y-2 animate-slide-down">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-n-bg/50 px-3 py-2">
              <p className="text-micro uppercase tracking-wider text-n-text-dim">Auth Status</p>
              <p className="text-caption text-n-text-muted mt-0.5 capitalize">{session.authDetail}</p>
            </div>
            <div className="rounded-lg bg-n-bg/50 px-3 py-2">
              <p className="text-micro uppercase tracking-wider text-n-text-dim">Ultimo Sync</p>
              <p className="text-caption text-n-text-muted mt-0.5">{session.lastSyncAgo}</p>
            </div>
            <div className="rounded-lg bg-n-bg/50 px-3 py-2">
              <p className="text-micro uppercase tracking-wider text-n-text-dim">Uptime</p>
              <p className="text-caption text-n-text-muted mt-0.5">{session.uptimeLabel || "—"}</p>
            </div>
            <div className="rounded-lg bg-n-bg/50 px-3 py-2">
              <p className="text-micro uppercase tracking-wider text-n-text-dim">Canal</p>
              <p className="text-caption text-n-text-muted mt-0.5">{session.label}</p>
            </div>
          </div>
          {/* Melhoria 10: Mini historico de sessao */}
          <div className="flex items-center gap-2 text-micro text-n-text-dim pt-1">
            <History className="h-3 w-3" />
            <span>Sessao iniciada {session.uptimeLabel ? `ha ${session.uptimeLabel}` : "—"}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Onboarding Banner — Melhoria 6 ──

function OnboardingBanner() {
  return (
    <div className="rounded-2xl border border-dashed border-n-border/60 bg-n-surface p-5 text-center space-y-3 animate-fade-in">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-n-blue/10">
        <Globe2 className="h-6 w-6 text-n-blue" />
      </div>
      <div>
        <h3 className="text-h4 text-n-text">Conecte seus canais</h3>
        <p className="text-caption text-n-text-dim mt-1 max-w-sm mx-auto">
          Inicie o worker para conectar WhatsApp Web e Instagram. Os canais serao detectados automaticamente.
        </p>
      </div>
      <div className="flex items-center justify-center gap-3 text-micro text-n-text-dim">
        <div className="flex items-center gap-1.5">
          <MessageCircleMore className="h-3 w-3 text-n-wa" />
          WhatsApp Web
        </div>
        <div className="h-3 w-px bg-n-border/40" />
        <div className="flex items-center gap-1.5">
          <Instagram className="h-3 w-3 text-n-ig" />
          Instagram DM
        </div>
      </div>
    </div>
  );
}

// ── Disconnection Toast — Melhoria 9 ──

function DisconnectionToast({ channel, onReconnect, onDismiss }: {
  channel: string;
  onReconnect: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-2xl border border-n-red/20 bg-n-surface px-4 py-3 shadow-panel animate-slide-up">
      <WifiOff className="h-4 w-4 text-n-red shrink-0" />
      <div className="min-w-0">
        <p className="text-caption font-medium text-n-text">{channel} desconectado</p>
        <p className="text-micro text-n-text-dim">Canal perdeu a conexao</p>
      </div>
      <button
        onClick={onReconnect}
        className="shrink-0 rounded-lg bg-n-blue px-3 py-1.5 text-micro font-medium text-white transition-all duration-200 hover:bg-n-blue/90"
      >
        Reconectar
      </button>
      <button onClick={onDismiss} className="text-n-text-dim hover:text-n-text text-micro">✕</button>
    </div>
  );
}

// ── Rate Limit Indicator — Melhoria 12 ──

function RateLimitIndicator({ health }: { health: HealthResponse | undefined }) {
  const workerState = health?.worker?.value as RuntimeProcessState | undefined;
  const isCooldown = workerState?.rateLimited === true || workerState?.cooldownUntil != null;
  if (!isCooldown) return null;

  return (
    <div className="flex items-center gap-2 rounded-xl bg-n-amber/[0.06] px-3 py-2 ring-1 ring-n-amber/15">
      <Shield className="h-3.5 w-3.5 text-n-amber" />
      <span className="text-caption text-n-amber">Rate limit ativo — envios pausados temporariamente</span>
    </div>
  );
}

// ── Main Component ──

export function ChannelSessionStrip({ className, compact = false }: { className?: string; compact?: boolean }) {
  const queryClient = useQueryClient();
  const [dismissedDisconnect, setDismissedDisconnect] = useState<string | null>(null);
  const prevStatesRef = useRef<Record<string, string>>({});

  const healthQuery = useQuery({
    queryKey: ["health", "channel-sessions"],
    queryFn: () => apiFetch<HealthResponse>("/health"),
    refetchInterval: 15_000
  });

  const instagramSessionQuery = useQuery({
    queryKey: ["instagram-session", "channel-sessions"],
    queryFn: () => apiFetch<InstagramSessionResponse>("/instagram/session"),
    refetchInterval: 15_000
  });

  const sessions = useMemo(
    () => [
      buildWhatsAppSessionViewModel(healthQuery.data, healthQuery.isLoading),
      buildInstagramSessionViewModel(healthQuery.data, instagramSessionQuery.data, instagramSessionQuery.isLoading)
    ],
    [healthQuery.data, healthQuery.isLoading, instagramSessionQuery.data, instagramSessionQuery.isLoading]
  );

  // Melhoria 9: Detectar desconexao
  const disconnectedChannel = useMemo(() => {
    for (const s of sessions) {
      const prevState = prevStatesRef.current[s.key];
      if (prevState === "ready" && s.state === "offline" && dismissedDisconnect !== s.key) {
        return s;
      }
    }
    return null;
  }, [sessions, dismissedDisconnect]);

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const s of sessions) { next[s.key] = s.state; }
    prevStatesRef.current = next;
  }, [sessions]);

  // Melhoria 2: Reconectar via restart-worker job
  const reconnectMutation = useMutation({
    mutationFn: () => apiFetch("/jobs/restart-worker", { method: "POST" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["health"] });
    }
  });

  const handleReconnect = useCallback(() => {
    reconnectMutation.mutate();
    setDismissedDisconnect(null);
  }, [reconnectMutation]);

  const hasError = healthQuery.isError || instagramSessionQuery.isError;
  const allOffline = sessions.every((s) => s.state === "offline") && !healthQuery.isLoading;

  // Melhoria 11: Multi-conta preview — layout ja preparado (grid cols)
  // Melhoria 7: QR code — depende do worker expor screenshot, placeholder no expanded details

  return (
    <div className={cn("space-y-2", className)}>
      {/* Melhoria 6: Onboarding quando todos offline e nao loading */}
      {allOffline && !compact ? (
        <OnboardingBanner />
      ) : (
        <>
          {/* Melhoria 11: Grid preparado para multi-conta */}
          <div className={cn("grid gap-2", compact ? "xl:grid-cols-2" : "md:grid-cols-2")}>
            {sessions.map((session) => (
              <SessionCard
                key={session.key}
                session={session}
                compact={compact}
                onReconnect={session.state === "offline" ? handleReconnect : undefined}
              />
            ))}
          </div>

          {/* Melhoria 12: Rate limit indicator */}
          {!compact && <RateLimitIndicator health={healthQuery.data} />}
        </>
      )}

      {/* Error banner */}
      {hasError && (
        <div className="flex items-center gap-2 rounded-xl bg-n-amber/[0.06] px-3 py-2 ring-1 ring-n-amber/15 text-caption text-n-amber">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Falha ao atualizar o estado de sessao dos canais.
        </div>
      )}

      {/* Melhoria 9: Notificacao de desconexao */}
      {disconnectedChannel && !compact && (
        <DisconnectionToast
          channel={disconnectedChannel.label}
          onReconnect={handleReconnect}
          onDismiss={() => setDismissedDisconnect(disconnectedChannel.key)}
        />
      )}
    </div>
  );
}
