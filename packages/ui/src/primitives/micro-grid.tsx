import { forwardRef, type HTMLAttributes } from "react";

import { cn } from "../utils/cn.js";
/**
 * MicroGrid - subtle dotted grid for cartographic operational context.
 */
export interface MicroGridProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
  fade?: boolean;
}

export const MicroGrid = forwardRef<HTMLDivElement, MicroGridProps>(
  ({ size, fade = true, className, style, ...props }, ref) => {
    const gridSize = typeof size === "number" ? `${size}px` : "28px";
    const gridStyle: React.CSSProperties = {
      ...style,
      backgroundImage:
        "radial-gradient(rgb(var(--color-contour-grid) / 0.9) 1px, transparent 1px)",
      backgroundSize: `${gridSize} ${gridSize}`,
      maskImage: fade
        ? "radial-gradient(ellipse at center, black 40%, transparent 100%)"
        : undefined,
      WebkitMaskImage: fade
        ? "radial-gradient(ellipse at center, black 40%, transparent 100%)"
        : undefined,
    };
    return (
      <div
        ref={ref}
        aria-hidden="true"
        className={cn("absolute inset-0 pointer-events-none", className)}
        style={gridStyle}
        {...props}
      />
    );
  },
);
MicroGrid.displayName = "MicroGrid";
