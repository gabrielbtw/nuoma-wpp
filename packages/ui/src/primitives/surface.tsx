import { forwardRef, type HTMLAttributes } from "react";

import { cn } from "../utils/cn.js";

/**
 * Surface — the foundational cartographic primitive.
 *
 * `raised`: flat operational panel with contour edge.
 * `pressed`: inset panel for inputs and active navigation.
 * `flat`: one-line contour for chips and dividers.
 * `floating`: selective glass/lift for modals and command palette.
 */
export type SurfaceVariant = "raised" | "pressed" | "flat" | "floating";
export type SurfaceSize = "sm" | "md" | "lg" | "xl";

export interface SurfaceProps extends HTMLAttributes<HTMLDivElement> {
  variant?: SurfaceVariant;
  size?: SurfaceSize;
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
  floating: {
    sm: "shadow-lift",
    md: "shadow-lift",
    lg: "shadow-lift",
    xl: "shadow-lift",
  },
};

export const Surface = forwardRef<HTMLDivElement, SurfaceProps>(
  ({ variant = "raised", size = "md", interactive, className, ...props }, ref) => (
    <div
      ref={ref}
      data-surface={variant}
      className={cn(
        "bg-bg-base rounded-xl",
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
 * Selective glass alias for floating layers. Keep list cards flat.
 */
export const Glass = forwardRef<HTMLDivElement, SurfaceProps & { level?: unknown }>(
  ({ level: _level, ...rest }, ref) => <Surface ref={ref} variant="floating" {...rest} />,
);
Glass.displayName = "Glass";
