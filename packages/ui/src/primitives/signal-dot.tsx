import { motion, useReducedMotion } from "framer-motion";
import { forwardRef, type HTMLAttributes } from "react";

import { cn } from "../utils/cn.js";

/**
 * SignalDot - recessed operational dot with a luminous core.
 * `active` breathes; others are static.
 */
export type SignalStatus = "active" | "idle" | "error" | "degraded";

export interface SignalDotProps extends Omit<HTMLAttributes<HTMLSpanElement>, "title"> {
  status?: SignalStatus;
  size?: "xs" | "sm" | "md";
  label?: string;
}

const STATUS_CORE: Record<SignalStatus, string> = {
  active: "bg-signal-active shadow-glow-lime",
  idle: "bg-signal-idle",
  error: "bg-signal-error shadow-glow-danger",
  degraded: "bg-signal-degraded",
};

const SIZES: Record<NonNullable<SignalDotProps["size"]>, { wrap: string; core: string }> = {
  xs: { wrap: "w-3 h-3", core: "w-1.5 h-1.5" },
  sm: { wrap: "w-3.5 h-3.5", core: "w-2 h-2" },
  md: { wrap: "w-4 h-4", core: "w-2.5 h-2.5" },
};

export const SignalDot = forwardRef<HTMLSpanElement, SignalDotProps>(
  ({ status = "idle", size = "sm", label, className, ...props }, ref) => {
    const dimensions = SIZES[size];
    const shouldReduceMotion = useReducedMotion();
    return (
      <span
        ref={ref}
        role={label ? "status" : undefined}
        aria-label={label}
        data-signal={status}
        className={cn(
          "inline-flex items-center justify-center rounded-full",
          "shadow-pressed-sm bg-bg-deep",
          dimensions.wrap,
          className,
        )}
        {...props}
      >
        <motion.span
          aria-hidden="true"
          className={cn("rounded-full", STATUS_CORE[status], dimensions.core)}
          animate={
            status === "active" && !shouldReduceMotion
              ? { scale: [1, 1.18, 1], opacity: [0.85, 1, 0.85] }
              : undefined
          }
          transition={
            status === "active"
              ? { duration: 1.8, repeat: Infinity, ease: "easeInOut" }
              : undefined
          }
        />
      </span>
    );
  },
);
SignalDot.displayName = "SignalDot";
