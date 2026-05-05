import { useEffect, useState, type HTMLAttributes } from "react";

import { cn } from "../utils/cn.js";

export interface TimeAgoProps extends HTMLAttributes<HTMLTimeElement> {
  date: Date | string | number;
  refreshIntervalMs?: number;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function formatRelative(target: number, now: number): string {
  const diff = target - now;
  const abs = Math.abs(diff);
  if (abs < MINUTE) return diff < 0 ? "agora" : "instantes";
  if (abs < HOUR) return `${Math.round(abs / MINUTE)}m`;
  if (abs < DAY) return `${Math.round(abs / HOUR)}h`;
  if (abs < DAY * 7) return `${Math.round(abs / DAY)}d`;
  return new Date(target).toLocaleDateString("pt-BR");
}

export function TimeAgo({ date, refreshIntervalMs = 60_000, className, ...props }: TimeAgoProps) {
  const target = typeof date === "object" ? date.getTime() : new Date(date).getTime();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), refreshIntervalMs);
    return () => clearInterval(id);
  }, [refreshIntervalMs]);

  const iso = new Date(target).toISOString();
  return (
    <time
      dateTime={iso}
      title={iso}
      className={cn("font-mono tabular-nums text-fg-dim text-xs", className)}
      {...props}
    >
      {formatRelative(target, now)}
    </time>
  );
}
