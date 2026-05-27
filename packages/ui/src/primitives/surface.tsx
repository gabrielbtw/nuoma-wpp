import { forwardRef, type HTMLAttributes } from "react";

import { cn } from "../utils/cn.js";

/**
 * Surface — foundational Nuoma premium primitive.
 *
 * `raised`: satin operational panel with a gold contour edge.
 * `pressed`: inset panel for inputs and active navigation.
 * `flat`: one-line contour for compact chips and dividers.
 * `glass`: tiered transparent surface for product chrome.
 * `floating`: lifted glass for modals and command palette.
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
    sm: "shadow-raised-sm",
    md: "shadow-raised-md",
    lg: "shadow-raised-lg",
    xl: "shadow-raised-xl",
  },
  pressed: {
    sm: "shadow-pressed-sm",
    md: "shadow-pressed-md",
    lg: "shadow-pressed-lg",
    xl: "shadow-pressed-lg",
  },
  flat: {
    sm: "shadow-flat-subtle",
    md: "shadow-flat",
    lg: "shadow-flat",
    xl: "shadow-flat",
  },
  glass: {
    sm: "shadow-flat-subtle",
    md: "shadow-raised-sm",
    lg: "shadow-raised-md",
    xl: "shadow-lift",
  },
  floating: {
    sm: "shadow-lift",
    md: "shadow-lift",
    lg: "shadow-lift",
    xl: "shadow-lift",
  },
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
        variant === "glass" || variant === "floating"
          ? `nuoma-glass-${glassLevel}`
          : "bg-bg-surface",
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
 * Glass alias for product chrome and floating layers.
 */
export const Glass = forwardRef<HTMLDivElement, SurfaceProps & { level?: GlassLevel }>(
  ({ level = "panel", glassLevel, ...rest }, ref) => (
    <Surface ref={ref} variant="glass" glassLevel={glassLevel ?? level} {...rest} />
  ),
);
Glass.displayName = "Glass";
