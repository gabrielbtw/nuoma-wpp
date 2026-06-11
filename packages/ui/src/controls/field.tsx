import { type ReactNode } from "react";

import { cn } from "../utils/cn.js";

export interface FieldProps {
  label?: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
  labelClassName?: string;
}

export function Field({
  label,
  description,
  error,
  required,
  children,
  className,
  labelClassName,
}: FieldProps) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      {label ? (
        <span
          className={cn(
            "flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-ink-soft",
            labelClassName,
          )}
        >
          {label}
          {required ? <span className="text-status-error">*</span> : null}
        </span>
      ) : null}
      {children}
      {description && !error ? (
        <span className="text-xs leading-5 text-ink-soft">{description}</span>
      ) : null}
      {error ? <span className="text-xs leading-5 text-status-error">{error}</span> : null}
    </div>
  );
}
