import { useCallback, useRef, type KeyboardEvent, type ReactNode } from "react";

import { cn } from "../utils/cn.js";

export interface SegmentedOption {
  value: string;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface SegmentedControlProps {
  options: SegmentedOption[];
  value: string;
  onValueChange: (value: string) => void;
  size?: "sm" | "md";
  className?: string;
  "aria-label"?: string;
}

const SIZES = {
  sm: "h-8 p-0.5 text-xs",
  md: "h-10 p-1 text-sm",
} as const;

const ITEM_SIZES = {
  sm: "px-2.5 gap-1.5",
  md: "px-3.5 gap-2",
} as const;

/**
 * SegmentedControl — single-select compact toggle with roving keyboard
 * navigation. The active segment lifts onto an elevated surface.
 */
export function SegmentedControl({
  options,
  value,
  onValueChange,
  size = "md",
  className,
  "aria-label": ariaLabel,
}: SegmentedControlProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const focusAt = useCallback((index: number) => {
    const count = options.length;
    let next = index;
    for (let step = 0; step < count; step += 1) {
      const candidate = options[((next % count) + count) % count];
      if (candidate && !candidate.disabled) {
        const node = refs.current[((next % count) + count) % count];
        node?.focus();
        onValueChange(candidate.value);
        return;
      }
      next += 1;
    }
  }, [options, onValueChange]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        focusAt(index + 1);
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        focusAt(index - 1);
      } else if (event.key === "Home") {
        event.preventDefault();
        focusAt(0);
      } else if (event.key === "End") {
        event.preventDefault();
        focusAt(options.length - 1);
      }
    },
    [focusAt, options.length],
  );

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-lg bg-bg-sunken/80 shadow-pressed-sm",
        SIZES[size],
        className,
      )}
    >
      {options.map((option, index) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={option.disabled}
            tabIndex={active || (value === "" && index === 0) ? 0 : -1}
            onClick={() => onValueChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              "inline-flex h-full items-center justify-center rounded-md font-medium",
              "outline-none transition-[color,background,box-shadow] duration-fast ease-out",
              "focus-visible:ring-2 focus-visible:ring-brand-cyan/60 focus-visible:ring-offset-1 focus-visible:ring-offset-bg-base",
              "disabled:cursor-not-allowed disabled:opacity-40",
              ITEM_SIZES[size],
              active
                ? "bg-bg-elevated text-fg-primary shadow-raised-sm"
                : "text-fg-dim hover:text-fg-muted",
            )}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
SegmentedControl.displayName = "SegmentedControl";
