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
  /** Copper hairline emphasis for the headline cell only. */
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
 * BentoItem — a single cell. Solid Carvão & Cobre surface by default; pass
 * `plain` for an unstyled cell that hosts another component.
 */
export const BentoItem = forwardRef<HTMLDivElement, BentoItemProps>(
  ({ colSpan = 1, rowSpan = 1, aura, plain, className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "relative isolate overflow-hidden",
        !plain && "rounded-lg bg-surface-2 p-5 shadow-raised",
        COL_SPAN[colSpan],
        ROW_SPAN[rowSpan],
        className,
      )}
      {...props}
    >
      {aura && !plain && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 rounded-lg border border-accent/25"
        />
      )}
      {children}
    </div>
  ),
);
BentoItem.displayName = "BentoItem";
