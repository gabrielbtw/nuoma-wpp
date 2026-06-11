import { forwardRef, type HTMLAttributes } from "react";

import { cn } from "../utils/cn.js";

export type BadgeVariant =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "wa"
  | "ig"
  | "violet"
  | "cyan";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const VARIANTS: Record<BadgeVariant, string> = {
  neutral: "bg-ink-strong/[0.06] text-ink",
  info: "bg-status-info/12 text-status-info",
  success: "bg-status-ok/12 text-status-ok",
  warning: "bg-status-warn/14 text-status-warn",
  danger: "bg-status-error/12 text-status-error",
  wa: "bg-channel-wa/12 text-channel-wa",
  ig: "bg-channel-ig/12 text-channel-ig",
  violet: "bg-status-info/12 text-status-info",
  cyan: "bg-status-info/12 text-status-info",
};

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ variant = "neutral", className, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.66rem] font-mono uppercase tracking-wider",
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  ),
);
Badge.displayName = "Badge";
