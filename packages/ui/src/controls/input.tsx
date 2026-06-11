import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";

import { cn } from "../utils/cn.js";

const baseField = cn(
  "w-full bg-surface-1 text-ink-strong placeholder:text-ink-faint",
  "rounded-md border border-line-soft outline-none",
  "focus:border-accent focus:ring-2 focus:ring-accent/30",
  "transition-colors duration-fast ease-out",
  "disabled:opacity-50 disabled:cursor-not-allowed",
);

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  monospace?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ invalid, monospace, className, type = "text", ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      data-invalid={invalid || undefined}
      className={cn(
        baseField,
        "h-11 px-4 text-sm",
        monospace && "font-mono",
        invalid && "ring-2 ring-status-error/60 focus:ring-status-error/60",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  monospace?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ invalid, monospace, className, rows = 3, ...props }, ref) => (
    <textarea
      ref={ref}
      rows={rows}
      data-invalid={invalid || undefined}
      className={cn(
        baseField,
        "px-4 py-3 text-sm resize-y min-h-[72px]",
        monospace && "font-mono",
        invalid && "ring-2 ring-status-error/60 focus:ring-status-error/60",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";
