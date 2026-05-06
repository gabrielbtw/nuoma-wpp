import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";

import { cn } from "../utils/cn.js";

const baseField = cn(
  "w-full bg-bg-sunken/76 text-fg-primary placeholder:text-fg-dim",
  "rounded-lg shadow-pressed-sm",
  "border-0 outline-none",
  "focus:shadow-pressed-md focus:ring-2 focus:ring-brand-cyan/40",
  "transition-shadow duration-base ease-out",
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
        invalid && "ring-2 ring-semantic-danger/60 focus:ring-semantic-danger/60",
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
        invalid && "ring-2 ring-semantic-danger/60 focus:ring-semantic-danger/60",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";
