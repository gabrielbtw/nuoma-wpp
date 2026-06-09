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
  neutral: "bg-fg-primary/[0.06] text-fg-muted",
  info: "bg-semantic-info/12 text-semantic-info",
  success: "bg-semantic-success/12 text-semantic-success",
  warning: "bg-semantic-warning/14 text-semantic-warning",
  danger: "bg-semantic-danger/12 text-semantic-danger",
  wa: "bg-channel-whatsapp/12 text-channel-whatsapp",
  ig: "bg-channel-instagram/12 text-channel-instagram",
  violet: "bg-accent/12 text-accent-strong",
  cyan: "bg-accent/12 text-accent-strong",
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
