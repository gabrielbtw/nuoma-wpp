import { motion, useReducedMotion, type HTMLMotionProps } from "framer-motion";
import { forwardRef, type ReactNode } from "react";

import { cn } from "../utils/cn.js";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "soft" | "accent";
export type ButtonSize = "xs" | "sm" | "md" | "lg";

export interface ButtonProps extends HTMLMotionProps<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

const VARIANTS: Record<ButtonVariant, string> = {
  // Primary action — copper fill with dark ink.
  primary:
    "border border-accent/90 bg-accent text-accent-on shadow-flat hover:border-accent-hover hover:bg-accent-hover",
  secondary:
    "border border-line-hairline bg-surface-2 text-ink hover:border-line-soft hover:bg-surface-3 hover:text-ink-strong",
  soft: "border border-transparent bg-ink-strong/[0.05] text-ink hover:border-line-hairline hover:bg-ink-strong/[0.09] hover:text-ink-strong",
  ghost:
    "border border-transparent bg-transparent text-ink hover:border-line-hairline hover:bg-ink-strong/[0.06] hover:text-ink-strong",
  accent:
    "border border-accent/90 bg-accent text-accent-on shadow-flat hover:border-accent-hover hover:bg-accent-hover",
  danger:
    "border border-status-error/30 bg-status-error/10 text-status-error hover:bg-status-error/16",
};

const SIZES: Record<ButtonSize, string> = {
  xs: "h-7 gap-1.5 rounded-lg px-3 text-xs",
  sm: "h-9 gap-1.5 rounded-lg px-4 text-sm",
  md: "h-10 gap-2 rounded-xl px-5 text-sm",
  lg: "h-12 gap-2.5 rounded-xl px-6 text-[0.95rem]",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      loading,
      leftIcon,
      rightIcon,
      disabled,
      className,
      children,
      type = "button",
      ...props
    },
    ref,
  ) => {
    const shouldReduceMotion = useReducedMotion();
    return (
      <motion.button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        data-loading={loading || undefined}
        whileHover={disabled || loading || shouldReduceMotion ? undefined : { y: -1 }}
        whileTap={disabled || loading || shouldReduceMotion ? undefined : { y: 1, scale: 0.985 }}
        transition={{ type: "spring", stiffness: 400, damping: 24 }}
        className={cn(
          "inline-flex items-center justify-center font-medium tracking-[-0.01em]",
          "whitespace-nowrap",
          "outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0",
          "transition-colors duration-fast ease-out",
          "disabled:cursor-not-allowed disabled:opacity-50",
          VARIANTS[variant],
          SIZES[size],
          className,
        )}
        {...props}
      >
        {loading ? <Spinner /> : leftIcon}
        {children != null && <span>{children as React.ReactNode}</span>}
        {!loading && rightIcon}
      </motion.button>
    );
  },
);
Button.displayName = "Button";

function Spinner() {
  return (
    <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path
        d="M22 12a10 10 0 0 1-10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
