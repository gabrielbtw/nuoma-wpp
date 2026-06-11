import { forwardRef, type HTMLAttributes } from "react";

import { cn } from "../utils/cn.js";

/**
 * Surface — foundational Nuoma Carvão & Cobre primitive.
 *
 * `raised`: solid operational panel with a restrained hairline edge.
 * `pressed`: inset panel for inputs and active navigation.
 * `flat`: one-line contour for compact chips and dividers.
 * `glass`: compatibility alias rendered as a flat panel.
 * `floating`: compatibility alias rendered as a raised panel.
 */
export type SurfaceVariant = "raised" | "pressed" | "flat" | "glass" | "floating";
export type SurfaceSize = "sm" | "md" | "lg" | "xl";
export type GlassLevel = "subtle" | "panel" | "elevated" | "modal";

export interface SurfaceProps extends HTMLAttributes<HTMLDivElement> {
  variant?: SurfaceVariant;
  size?: SurfaceSize;
  glassLevel?: GlassLevel;
  interactive?: boolean;
}

const VARIANT_BY_SIZE: Record<SurfaceVariant, Record<SurfaceSize, string>> = {
  raised: {
    sm: "shadow-raised",
    md: "shadow-raised",
    lg: "shadow-lifted",
    xl: "shadow-lifted",
  },
  pressed: {
    sm: "shadow-inset",
    md: "shadow-inset",
    lg: "shadow-inset",
    xl: "shadow-inset",
  },
  flat: {
    sm: "shadow-flat",
    md: "shadow-flat",
    lg: "shadow-flat",
    xl: "shadow-flat",
  },
  glass: {
    sm: "shadow-flat",
    md: "shadow-raised",
    lg: "shadow-raised",
    xl: "shadow-lifted",
  },
  floating: {
    sm: "shadow-raised",
    md: "shadow-lifted",
    lg: "shadow-lifted",
    xl: "shadow-lifted",
  },
};

const SURFACE_BY_VARIANT: Record<SurfaceVariant, string> = {
  raised: "bg-surface-2",
  pressed: "bg-surface-deep",
  flat: "bg-surface-1",
  glass: "bg-surface-2",
  floating: "bg-surface-3",
};

export const Surface = forwardRef<HTMLDivElement, SurfaceProps>(
  (
    {
      variant = "raised",
      size = "md",
      glassLevel = variant === "floating" ? "modal" : "panel",
      interactive,
      className,
      ...props
    },
    ref,
  ) => (
    <div
      ref={ref}
      data-surface={variant}
      data-glass-level={variant === "glass" || variant === "floating" ? glassLevel : undefined}
      className={cn(
        "rounded-sm",
        SURFACE_BY_VARIANT[variant],
        VARIANT_BY_SIZE[variant][size],
        interactive && "transition-shadow duration-base ease-out",
        className,
      )}
      {...props}
    />
  ),
);
Surface.displayName = "Surface";

/**
 * Glass alias kept for API compatibility; renders as a solid surface.
 */
export const Glass = forwardRef<HTMLDivElement, SurfaceProps & { level?: GlassLevel }>(
  ({ level = "panel", glassLevel, ...rest }, ref) => (
    <Surface ref={ref} variant="glass" glassLevel={glassLevel ?? level} {...rest} />
  ),
);
Glass.displayName = "Glass";
