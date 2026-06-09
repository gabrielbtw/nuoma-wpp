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
  // Neutral default action — solid surface + hairline, no fill.
  primary:
    "border border-border-muted bg-bg-elevated text-fg-primary hover:border-fg-faint hover:bg-bg-subtle",
  secondary:
    "border border-border-subtle bg-bg-surface text-fg-muted hover:border-border-muted hover:bg-bg-elevated hover:text-fg-primary",
  soft: "bg-fg-primary/[0.05] text-fg-muted hover:bg-fg-primary/[0.09] hover:text-fg-primary",
  ghost: "bg-transparent text-fg-muted hover:bg-fg-primary/[0.06] hover:text-fg-primary",
  // The real CTA — filled electric indigo.
  accent: "bg-accent text-white hover:bg-accent-strong",
  danger:
    "border border-semantic-danger/30 bg-semantic-danger/10 text-semantic-danger hover:bg-semantic-danger/16",
};

const SIZES: Record<ButtonSize, string> = {
  xs: "h-7 px-3 text-xs gap-1.5 rounded-md",
  sm: "h-9 px-4 text-sm gap-1.5 rounded-md",
  md: "h-10 px-5 text-sm gap-2 rounded-md",
  lg: "h-12 px-6 text-[0.95rem] gap-2.5 rounded-lg",
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
          "inline-flex items-center justify-center font-medium tracking-tight",
          "whitespace-nowrap",
          "outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-canvas",
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
