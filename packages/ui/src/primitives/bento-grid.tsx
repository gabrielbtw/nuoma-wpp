import { forwardRef, type HTMLAttributes } from "react";

import { cn } from "../utils/cn.js";

export interface BentoGridProps extends HTMLAttributes<HTMLDivElement> {
  columns?: 2 | 3 | 4;
}

const COLUMNS: Record<NonNullable<BentoGridProps["columns"]>, string> = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-2 lg:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
};

/**
 * BentoGrid — modular dashboard layout. Cells span columns and rows to build
 * an asymmetric composition. Pair with `BentoItem`.
 */
export const BentoGrid = forwardRef<HTMLDivElement, BentoGridProps>(
  ({ columns = 4, className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "grid grid-cols-1 gap-3 auto-rows-[minmax(7.5rem,auto)]",
        COLUMNS[columns],
        className,
      )}
      {...props}
    />
  ),
);
BentoGrid.displayName = "BentoGrid";

export interface BentoItemProps extends HTMLAttributes<HTMLDivElement> {
  colSpan?: 1 | 2 | 3 | 4;
  rowSpan?: 1 | 2;
  /** Soft aura glow in the corner — for the headline cell only. */
  aura?: boolean;
  /** Render a bare grid cell with no surface styling. */
  plain?: boolean;
}

const COL_SPAN: Record<NonNullable<BentoItemProps["colSpan"]>, string> = {
  1: "",
  2: "sm:col-span-2",
  3: "sm:col-span-2 lg:col-span-3",
  4: "sm:col-span-2 lg:col-span-4",
};

const ROW_SPAN: Record<NonNullable<BentoItemProps["rowSpan"]>, string> = {
  1: "",
  2: "row-span-2",
};

/**
 * BentoItem — a single cell. Layered glass feature surface by default; pass
 * `plain` for an unstyled cell that hosts another component.
 */
export const BentoItem = forwardRef<HTMLDivElement, BentoItemProps>(
  ({ colSpan = 1, rowSpan = 1, aura, plain, className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "relative isolate overflow-hidden",
        !plain && "nuoma-glass-panel rounded-lg p-5 shadow-raised-sm",
        COL_SPAN[colSpan],
        ROW_SPAN[rowSpan],
        className,
      )}
      {...props}
    >
      {aura && !plain && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-10 -top-10 -z-10 h-40 w-40 rounded-full bg-gradient-aura blur-2xl"
        />
      )}
      {children}
    </div>
  ),
);
BentoItem.displayName = "BentoItem";
