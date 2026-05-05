import { forwardRef, type HTMLAttributes } from "react";

import { cn } from "../utils/cn.js";

/**
 * Contour — alias for the flat surface. Kept for legacy import compat.
 */
export interface ContourProps extends HTMLAttributes<HTMLDivElement> {
  intensity?: "subtle" | "normal" | "strong";
}

const INTENSITY: Record<NonNullable<ContourProps["intensity"]>, string> = {
  subtle: "shadow-flat-subtle",
  normal: "shadow-flat",
  strong: "shadow-raised-sm",
};

export const Contour = forwardRef<HTMLDivElement, ContourProps>(
  ({ intensity = "normal", className, ...props }, ref) => (
    <div
      ref={ref}
      data-contour={intensity}
      className={cn("bg-bg-base rounded-xl", INTENSITY[intensity], className)}
      {...props}
    />
  ),
);
Contour.displayName = "Contour";
