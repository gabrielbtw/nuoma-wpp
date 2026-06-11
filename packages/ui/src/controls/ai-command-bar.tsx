import {
  forwardRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { cn } from "../utils/cn.js";

export interface AICommandBarProps {
  placeholder?: string;
  /** Controlled value. Omit for uncontrolled use. */
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
  /** Suggestion prompts shown below the bar. */
  suggestions?: string[];
  onSuggestionSelect?: (suggestion: string) => void;
  busy?: boolean;
  icon?: ReactNode;
  className?: string;
}

/**
 * AICommandBar — conversational input. Presentational only: it surfaces a
 * prompt field, a copper affordance and optional suggestion pills. It does
 * NOT replace the shell CommandPalette (Cmd+K) — that stays for navigation.
 */
export const AICommandBar = forwardRef<HTMLInputElement, AICommandBarProps>(
  (
    {
      placeholder = "Pergunte ou comande…",
      value,
      defaultValue = "",
      onValueChange,
      onSubmit,
      suggestions,
      onSuggestionSelect,
      busy,
      icon,
      className,
    },
    ref,
  ) => {
    const [internal, setInternal] = useState(defaultValue);
    const isControlled = value !== undefined;
    const current = isControlled ? value : internal;

    const setValue = (next: string) => {
      if (!isControlled) setInternal(next);
      onValueChange?.(next);
    };

    const submit = () => {
      const trimmed = current.trim();
      if (trimmed.length > 0) onSubmit?.(trimmed);
    };

    const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submit();
      }
    };

    const onFormSubmit = (event: FormEvent) => {
      event.preventDefault();
      submit();
    };

    return (
      <div className={cn("flex flex-col gap-2.5", className)}>
        <form
          onSubmit={onFormSubmit}
          className={cn(
            "flex items-center gap-3 rounded-lg px-3.5 py-2.5",
            "bg-surface-2 shadow-raised",
            "ring-1 ring-line-hairline focus-within:ring-accent/55",
            "transition-[box-shadow,outline] duration-base ease-out",
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-accent-on",
              busy && "animate-pulse",
            )}
          >
            {icon}
          </span>
          <input
            ref={ref}
            type="text"
            value={current}
            placeholder={placeholder}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={onKeyDown}
            aria-label={placeholder}
            className={cn(
              "min-w-0 flex-1 bg-transparent text-sm text-ink-strong outline-none",
              "placeholder:text-ink-soft",
            )}
          />
          <kbd
            className={cn(
              "hidden shrink-0 rounded-xs bg-surface-4 px-1.5 py-0.5 sm:inline",
              "font-mono text-[0.6rem] text-ink-faint shadow-inset",
            )}
          >
            ⏎
          </kbd>
        </form>

        {suggestions && suggestions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => {
                  setValue(suggestion);
                  onSuggestionSelect?.(suggestion);
                }}
                className={cn(
                  "rounded-full px-3 py-1 text-xs text-ink",
                  "bg-surface-2/60 shadow-flat",
                  "outline-none transition-[color,box-shadow] duration-fast ease-out",
                  "hover:text-ink-strong hover:shadow-raised",
                  "focus-visible:ring-2 focus-visible:ring-accent/60",
                )}
              >
                <span aria-hidden="true" className="text-accent">
                  ✦{" "}
                </span>
                {suggestion}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  },
);
AICommandBar.displayName = "AICommandBar";
