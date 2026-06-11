import { Minus, Plus } from "lucide-react";
import { forwardRef, useEffect, useState, type ChangeEvent, type InputHTMLAttributes } from "react";

import { cn } from "../utils/cn.js";
import { IconButton } from "./icon-button.js";

export interface NumberInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "defaultValue" | "onChange"
> {
  value?: number | string;
  defaultValue?: number | string;
  onValueChange?: (value: number | null, rawValue: string) => void;
  step?: number;
  min?: number;
  max?: number;
  invalid?: boolean;
}

export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(
  (
    {
      value,
      defaultValue = "",
      onValueChange,
      step = 1,
      min,
      max,
      invalid,
      disabled,
      className,
      ...props
    },
    ref,
  ) => {
    const controlled = value !== undefined;
    const [internalValue, setInternalValue] = useState(String(defaultValue));
    const currentValue = controlled ? String(value) : internalValue;

    useEffect(() => {
      if (!controlled) setInternalValue(String(defaultValue));
    }, [controlled, defaultValue]);

    const commitValue = (rawValue: string) => {
      if (!controlled) setInternalValue(rawValue);
      const parsed = rawValue.trim() === "" ? null : Number(rawValue);
      onValueChange?.(Number.isFinite(parsed) ? parsed : null, rawValue);
    };

    const nudge = (direction: -1 | 1) => {
      const parsed = Number(currentValue);
      const base = Number.isFinite(parsed) ? parsed : 0;
      const next = clamp(base + step * direction, min, max);
      commitValue(String(next));
    };

    const onChange = (event: ChangeEvent<HTMLInputElement>) => {
      commitValue(event.target.value);
    };

    return (
      <div
        data-invalid={invalid || undefined}
        className={cn(
          "grid h-11 w-full grid-cols-[2.25rem_1fr_2.25rem] items-center rounded-lg",
          "bg-surface-deep/76 text-ink-strong shadow-inset",
          "focus-within:ring-2 focus-within:ring-accent/40",
          invalid && "ring-2 ring-status-error/60 focus-within:ring-status-error/60",
          disabled && "cursor-not-allowed opacity-50",
          className,
        )}
      >
        <IconButton
          label="Diminuir valor"
          icon={<Minus className="h-3.5 w-3.5" />}
          size="xs"
          variant="ghost"
          disabled={disabled}
          className="mx-1 h-8 w-8 min-w-8"
          onClick={() => nudge(-1)}
        />
        <input
          ref={ref}
          type="number"
          value={currentValue}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={onChange}
          className={cn(
            "h-full min-w-0 bg-transparent text-center text-sm tabular-nums outline-none",
            "placeholder:text-ink-soft disabled:cursor-not-allowed",
          )}
          {...props}
        />
        <IconButton
          label="Aumentar valor"
          icon={<Plus className="h-3.5 w-3.5" />}
          size="xs"
          variant="ghost"
          disabled={disabled}
          className="mx-1 h-8 w-8 min-w-8"
          onClick={() => nudge(1)}
        />
      </div>
    );
  },
);
NumberInput.displayName = "NumberInput";

function clamp(value: number, min?: number, max?: number): number {
  if (typeof min === "number" && value < min) return min;
  if (typeof max === "number" && value > max) return max;
  return value;
}
