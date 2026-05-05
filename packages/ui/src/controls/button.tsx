import { motion, useReducedMotion, type HTMLMotionProps } from "framer-motion";
import { forwardRef, type ReactNode } from "react";

import { cn } from "../utils/cn.js";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "soft"
  | "accent";
export type ButtonSize = "xs" | "sm" | "md" | "lg";

export interface ButtonProps extends HTMLMotionProps<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-bg-base text-fg-primary shadow-raised-sm hover:shadow-raised-md active:shadow-pressed-sm",
  secondary:
    "bg-bg-base text-fg-muted shadow-raised-sm hover:text-fg-primary hover:shadow-raised-md active:shadow-pressed-sm",
  soft:
    "bg-bg-base text-fg-muted shadow-flat hover:shadow-raised-sm hover:text-fg-primary active:shadow-pressed-sm",
  ghost:
    "bg-transparent text-fg-muted hover:bg-bg-base hover:shadow-raised-sm hover:text-fg-primary active:shadow-pressed-sm",
  accent:
    "bg-bg-base text-brand-cyan shadow-raised-sm hover:shadow-glow-cyan active:shadow-pressed-sm",
  danger:
    "bg-bg-base text-semantic-danger shadow-raised-sm hover:shadow-glow-danger active:shadow-pressed-sm",
};

const SIZES: Record<ButtonSize, string> = {
  xs: "h-7 px-3 text-xs gap-1.5 rounded-md",
  sm: "h-9 px-4 text-sm gap-1.5 rounded-md",
  md: "h-11 px-5 text-sm gap-2 rounded-lg",
  lg: "h-13 px-6 text-base gap-2.5 rounded-xl",
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
          "outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base",
          "transition-shadow duration-base ease-out",
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
    <svg
      className="animate-spin h-3.5 w-3.5"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
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
