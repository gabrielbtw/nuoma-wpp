import { forwardRef, type HTMLAttributes } from "react";

import { cn } from "../utils/cn.js";

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  variant?: "line" | "block" | "circle";
}

const VARIANTS = {
  line: "h-3 rounded-xs",
  block: "h-20 rounded-md",
  circle: "rounded-full aspect-square",
} as const;

/**
 * Skeleton — shimmer placeholder for loading content. The shimmer halts under
 * `prefers-reduced-motion`. Compose several to mirror the final layout.
 */
export const Skeleton = forwardRef<HTMLDivElement, SkeletonProps>(
  ({ variant = "line", className, ...props }, ref) => (
    <div
      ref={ref}
      aria-hidden="true"
      className={cn("nuoma-skeleton", VARIANTS[variant], className)}
      {...props}
    />
  ),
);
Skeleton.displayName = "Skeleton";

export interface SkeletonTextProps extends HTMLAttributes<HTMLDivElement> {
  lines?: number;
}

/** SkeletonText — a stack of shimmer lines with a shortened last line. */
export const SkeletonText = forwardRef<HTMLDivElement, SkeletonTextProps>(
  ({ lines = 3, className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col gap-2", className)} {...props}>
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton
          key={index}
          variant="line"
          className={index === lines - 1 ? "w-3/5" : "w-full"}
        />
      ))}
    </div>
  ),
);
SkeletonText.displayName = "SkeletonText";
