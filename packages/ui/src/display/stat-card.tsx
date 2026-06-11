import { forwardRef, type ReactNode } from "react";

import { cn } from "../utils/cn.js";
import { Card, type CardProps } from "./card.js";

type DeltaDirection = "up" | "down" | "flat";
type DeltaTone = "positive" | "negative" | "neutral";

export interface StatDelta {
  value: ReactNode;
  direction: DeltaDirection;
  /** Overrides the colour. By default up=positive, down=negative, flat=neutral. */
  tone?: DeltaTone;
}

export interface StatCardProps extends Omit<CardProps, "title"> {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  delta?: StatDelta;
  /** Optional sparkline data — keep it meaningful, not decorative. */
  trend?: number[];
  hint?: ReactNode;
  icon?: ReactNode;
}

const TONE_TEXT: Record<DeltaTone, string> = {
  positive: "text-status-ok",
  negative: "text-status-error",
  neutral: "text-ink-soft",
};

const TONE_STROKE: Record<DeltaTone, string> = {
  positive: "rgb(var(--nw-status-ok))",
  negative: "rgb(var(--nw-status-error))",
  neutral: "rgb(var(--nw-ink-soft))",
};

const ARROW: Record<DeltaDirection, string> = {
  up: "M3 7.5 6 4l3 3.5",
  down: "M3 4.5 6 8l3-3.5",
  flat: "M2.5 6h7",
};

function resolveTone(delta: StatDelta): DeltaTone {
  if (delta.tone) return delta.tone;
  if (delta.direction === "up") return "positive";
  if (delta.direction === "down") return "negative";
  return "neutral";
}

function Sparkline({ data, stroke }: { data: number[]; stroke: string }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const w = 96;
  const h = 32;
  const points = data
    .map((value, index) => {
      const x = (index / (data.length - 1)) * w;
      const y = h - ((value - min) / span) * (h - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="h-8 w-24 shrink-0"
      fill="none"
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      <polyline
        points={points}
        stroke={stroke}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * StatCard — KPI tile. Composes Card with a label, large tabular value, an
 * optional delta chip and an optional sparkline. Numbers use tabular figures
 * so columns of StatCards stay aligned.
 */
export const StatCard = forwardRef<HTMLDivElement, StatCardProps>(
  (
    { label, value, unit, delta, trend, hint, icon, className, variant = "raised", ...props },
    ref,
  ) => {
    const tone = delta ? resolveTone(delta) : "neutral";
    return (
      <Card
        ref={ref}
        variant={variant}
        className={cn("flex flex-col gap-3 p-5", className)}
        {...props}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[0.7rem] uppercase tracking-wider text-ink-soft">
            {label}
          </span>
          {icon && <span className="text-ink-soft">{icon}</span>}
        </div>

        <div className="flex items-baseline gap-1">
          <span className="font-display text-3xl tabular-nums text-ink-strong">{value}</span>
          {unit && <span className="text-sm font-medium text-ink-soft">{unit}</span>}
        </div>

        <div className="mt-auto flex items-center justify-between gap-3">
          {delta ? (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5",
                "font-mono text-xs font-medium tabular-nums shadow-inset",
                TONE_TEXT[tone],
              )}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path
                  d={ARROW[delta.direction]}
                  stroke="currentColor"
                  strokeWidth={1.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {delta.value}
            </span>
          ) : (
            hint && <span className="text-xs text-ink-soft">{hint}</span>
          )}
          {trend && trend.length > 1 && (
            <Sparkline data={trend} stroke={TONE_STROKE[tone]} />
          )}
        </div>

        {delta && hint && <span className="text-xs text-ink-soft">{hint}</span>}
      </Card>
    );
  },
);
StatCard.displayName = "StatCard";

/** KpiCard — alias kept for naming parity with the design-system docs. */
export const KpiCard = StatCard;
