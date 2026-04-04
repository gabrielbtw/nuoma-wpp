import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Instagram, LoaderCircle, MessageCircleMore } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/lib/api";
import { formatChannelDisplayValue } from "@/lib/contact-utils";
import type { HealthResponse, InstagramSessionResponse, RuntimeProcessState } from "@/lib/system-types";
import { cn } from "@/lib/utils";

type SessionViewModel = {
  key: "whatsapp" | "instagram";
  label: string;
  detail: string;
  state: "ready" | "attention" | "offline" | "loading";
  statusText: string;
  icon: typeof MessageCircleMore;
};

function readTrimmedText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function formatInstagramDetail(value: string) {
  const normalized = value.trim();
  if (!normalized) {
    return "Sessão indisponível";
  }

  if (normalized.startsWith("@")) {
    return normalized;
  }

  return normalized.includes(" ") ? normalized : `@${normalized}`;
}

function buildWhatsAppSessionViewModel(health: HealthResponse | undefined, loading: boolean): SessionViewModel {
  if (loading && !health) {
    return {
      key: "whatsapp",
      label: "WhatsApp",
      detail: "Consultando worker",
      state: "loading",
      statusText: "Verificando",
      icon: MessageCircleMore
    };
  }

  const worker: RuntimeProcessState = health?.worker?.value ?? health?.channels?.whatsapp?.worker ?? {};
  const phoneLabel =
    readTrimmedText(worker.sessionPhone) ||
    readTrimmedText(worker.phoneNumber) ||
    readTrimmedText(worker.phone) ||
    readTrimmedText(health?.channels?.whatsapp?.sessionIdentifier) ||
    "";
  const status = readTrimmedText(worker.status).toLowerCase();
  const authStatus = readTrimmedText(worker.authStatus).toLowerCase();
  const workerLive = worker.live !== false;
  const ready = workerLive && (authStatus === "authenticated" || status === "authenticated" || status === "degraded");
  const attention = workerLive && !ready && ["starting", "restarting", "connecting"].includes(status);
  const accountLabel = phoneLabel
    ? formatChannelDisplayValue("whatsapp", phoneLabel)
    : ready
      ? readTrimmedText(worker.profileName) || readTrimmedText(worker.sessionName) || "Sessão ativa"
      : "Sessão indisponível";

  return {
    key: "whatsapp",
    label: "WhatsApp",
    detail: accountLabel,
    state: ready ? "ready" : attention ? "attention" : "offline",
    statusText: ready ? "Logado" : attention ? "Inicializando" : "Desconectado",
    icon: MessageCircleMore
  };
}

function buildInstagramSessionViewModel(
  health: HealthResponse | undefined,
  session: InstagramSessionResponse | undefined,
  loading: boolean
): SessionViewModel {
  if (loading && !session && !health) {
    return {
      key: "instagram",
      label: "Instagram",
      detail: "Consultando sessao",
      state: "loading",
      statusText: "Verificando",
      icon: Instagram
    };
  }

  const worker: RuntimeProcessState = health?.channels?.instagram?.worker ?? {};
  const accountLabel =
    readTrimmedText(session?.username) ||
    readTrimmedText(session?.accountUsername) ||
    readTrimmedText(health?.channels?.instagram?.sessionIdentifier) ||
    "";
  const sessionStatus = readTrimmedText(session?.status).toLowerCase();
  const workerStatus = readTrimmedText(worker.status).toLowerCase();
  const ready = session?.authenticated === true || sessionStatus === "connected" || worker.authenticated === true || workerStatus === "connected";
  const attention = !ready && (sessionStatus === "assisted" || workerStatus === "assisted" || workerStatus === "starting");

  return {
    key: "instagram",
    label: "Instagram",
    detail: ready || attention ? formatInstagramDetail(accountLabel) : "Sessão indisponível",
    state: ready ? "ready" : attention ? "attention" : "offline",
    statusText: ready ? "Logado" : attention ? "Sessao aberta" : "Desconectado",
    icon: Instagram
  };
}

function SessionChip({ session, compact = false }: { session: SessionViewModel; compact?: boolean }) {
  const toneMap = {
    ready: {
      badge: "success" as const,
      text: "text-cmm-emerald",
      iconBox: "bg-cmm-emerald/10 text-cmm-emerald border-cmm-emerald/15"
    },
    attention: {
      badge: "warning" as const,
      text: "text-cmm-orange",
      iconBox: "bg-cmm-orange/10 text-cmm-orange border-cmm-orange/15"
    },
    offline: {
      badge: "danger" as const,
      text: "text-red-300",
      iconBox: "bg-red-500/10 text-red-300 border-red-500/15"
    },
    loading: {
      badge: "default" as const,
      text: "text-slate-300",
      iconBox: "bg-white/5 text-slate-300 border-n-border"
    }
  }[session.state];
  const Icon = session.state === "loading" ? LoaderCircle : session.icon;

  return (
    <div className={cn("flex items-center gap-2 rounded-lg border border-n-border bg-n-surface-2", compact ? "px-2 py-1" : "px-3 py-2")}>
      <div className="flex min-w-0 items-center gap-2">
        <div className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-md border", toneMap.iconBox)}>
          <Icon className={cn("h-3 w-3", session.state === "loading" && "animate-spin")} />
        </div>
        <div className="min-w-0">
          <p className={cn("truncate text-label font-semibold", toneMap.text)}>{session.statusText}</p>
        </div>
      </div>
      <span className={cn("signal-dot shrink-0", session.state === "ready" ? "active" : session.state === "attention" ? "warning" : session.state === "offline" ? "error" : "idle")} />
    </div>
  );
}

export function ChannelSessionStrip({ className, compact = false }: { className?: string; compact?: boolean }) {
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

  const hasError = healthQuery.isError || instagramSessionQuery.isError;

  return (
    <div className={cn("space-y-3", className)}>
      <div className={cn("grid gap-3", compact ? "xl:grid-cols-2" : "md:grid-cols-2")}>
        {sessions.map((session) => (
          <SessionChip key={session.key} session={session} compact={compact} />
        ))}
      </div>
      {hasError ? (
        <div className="flex items-center gap-2 rounded-2xl border border-cmm-orange/15 bg-cmm-orange/8 px-4 py-3 text-xs text-cmm-orange">
          <AlertTriangle className="h-4 w-4" />
          Falha ao atualizar o estado de sessao dos canais.
        </div>
      ) : null}
    </div>
  );
}
