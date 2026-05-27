import { useMemo } from "react";

type HealthSignal = "active" | "idle" | "error" | "degraded";

interface OptionalCartographicHeroProps {
  healthLabel: string;
  healthSignal: HealthSignal;
  cdpConnected: boolean;
  workersOnline: number;
  workersTotal: number;
  queueDepth: number;
  dlqCount: number;
  throughputPerHour: number;
  failureRatePct: number;
}

interface BarDatum {
  key: string;
  label: string;
  value: string;
  width: number;
  tone: "cyan" | "gold" | "neutral" | "danger";
}

const SIGNAL_TONES: Record<HealthSignal, BarDatum["tone"]> = {
  active: "cyan",
  idle: "neutral",
  degraded: "gold",
  error: "danger",
};

export default function OptionalCartographicHero({
  healthLabel,
  healthSignal,
  cdpConnected,
  workersOnline,
  workersTotal,
  queueDepth,
  dlqCount,
  throughputPerHour,
  failureRatePct,
}: OptionalCartographicHeroProps) {
  const bars = useMemo<BarDatum[]>(
    () => [
      {
        key: "cdp",
        label: "CDP",
        value: cdpConnected ? "online" : "off",
        width: cdpConnected ? 96 : 36,
        tone: cdpConnected ? "cyan" : "gold",
      },
      {
        key: "workers",
        label: "Workers",
        value: `${workersOnline}/${workersTotal}`,
        width: scaleRatio(workersOnline, Math.max(1, workersTotal), 24, 100),
        tone: "neutral",
      },
      {
        key: "queue",
        label: "Fila",
        value: String(queueDepth),
        width: scaleCount(queueDepth, 18, 100),
        tone: queueDepth > 0 ? "gold" : "cyan",
      },
      {
        key: "throughput",
        label: "Throughput",
        value: `${throughputPerHour}/h`,
        width: scaleCount(throughputPerHour, 22, 100),
        tone: "neutral",
      },
      {
        key: "dlq",
        label: "DLQ",
        value: String(dlqCount),
        width: dlqCount > 0 ? scaleCount(dlqCount + 2, 30, 100) : 14,
        tone: dlqCount > 0 || failureRatePct > 0 ? "danger" : "cyan",
      },
    ],
    [
      cdpConnected,
      dlqCount,
      failureRatePct,
      queueDepth,
      throughputPerHour,
      workersOnline,
      workersTotal,
    ],
  );
  const signalTone = SIGNAL_TONES[healthSignal];

  return (
    <section
      className="relative isolate overflow-hidden rounded-xl border border-border-subtle bg-bg-sunken shadow-raised-lg"
      data-testid="v214a-cartographic-hero"
      data-status={healthSignal}
      data-enabled="true"
    >
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:28px_28px]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_84%_18%,rgba(210,169,94,0.08),transparent_28%),linear-gradient(135deg,rgba(18,20,26,0.96),rgba(8,9,13,0.98))]" />

      <div className="relative z-10 grid gap-6 p-5 md:grid-cols-[minmax(0,1fr)_20rem] md:p-7">
        <div className="min-w-0">
          <p className="font-mono text-[0.64rem] uppercase tracking-[0.18em] text-fg-dim">
            V2.14a · Visual opcional
          </p>
          <h2 className="mt-2 max-w-2xl text-3xl font-semibold leading-tight tracking-normal text-fg-primary md:text-5xl">
            Operação em relevo matte.
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-6 text-fg-muted">
            API, CDP, workers, fila e DLQ em uma leitura compacta, sem camada 3D e sem
            alterar guardrails de envio.
          </p>
        </div>

        <div className="grid content-start gap-3">
          <div
            className="rounded-lg border border-border-subtle bg-surface-overlay/82 px-3 py-3 shadow-flat"
            data-testid="v214a-hero-status"
            data-signal={healthSignal}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-fg-dim">
                status
              </span>
              <span className={toneClass(signalTone)} />
            </div>
            <div className="mt-2 text-sm font-semibold text-fg-primary">{healthLabel}</div>
          </div>

          <div className="grid gap-2" data-testid="v214a-hero-metrics">
            {bars.map((bar) => (
              <div key={bar.key} className="rounded-lg bg-bg-base/72 px-3 py-2 shadow-flat">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-[0.6rem] uppercase tracking-[0.16em] text-fg-dim">
                    {bar.label}
                  </span>
                  <span className="text-sm font-semibold tabular-nums text-fg-primary">{bar.value}</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-bg-deep shadow-pressed-sm">
                  <div
                    className={barClass(bar.tone)}
                    style={{ width: `${bar.width}%` }}
                    aria-hidden="true"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function toneClass(tone: BarDatum["tone"]) {
  const base = "h-2.5 w-2.5 rounded-full shadow-[0_0_0_3px_rgba(255,255,255,0.04)]";
  if (tone === "cyan") return `${base} bg-brand-cyan`;
  if (tone === "gold") return `${base} bg-brand-gold`;
  if (tone === "danger") return `${base} bg-semantic-danger`;
  return `${base} bg-fg-muted`;
}

function barClass(tone: BarDatum["tone"]) {
  const base = "h-full rounded-full";
  if (tone === "cyan") return `${base} bg-brand-cyan/78`;
  if (tone === "gold") return `${base} bg-brand-gold/78`;
  if (tone === "danger") return `${base} bg-semantic-danger/78`;
  return `${base} bg-fg-muted/72`;
}

function scaleRatio(value: number, max: number, min: number, maxWidth: number) {
  const ratio = Math.max(0, Math.min(1, value / max));
  return Math.round(min + ratio * (maxWidth - min));
}

function scaleCount(value: number, min: number, maxWidth: number) {
  if (value <= 0) return min;
  const ratio = Math.min(1, Math.log10(value + 1) / 2);
  return Math.round(min + ratio * (maxWidth - min));
}
