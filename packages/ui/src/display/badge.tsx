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
  neutral: "text-fg-muted shadow-pressed-sm",
  info: "text-semantic-info shadow-pressed-sm",
  success: "text-semantic-success shadow-pressed-sm",
  warning: "text-semantic-warning shadow-pressed-sm",
  danger: "text-semantic-danger shadow-pressed-sm",
  wa: "text-channel-whatsapp shadow-pressed-sm",
  ig: "text-channel-instagram shadow-pressed-sm",
  violet: "text-brand-violet shadow-pressed-sm",
  cyan: "text-brand-cyan shadow-pressed-sm",
};

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ variant = "neutral", className, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-bg-base text-[0.7rem] font-mono uppercase tracking-wider",
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  ),
);
Badge.displayName = "Badge";
