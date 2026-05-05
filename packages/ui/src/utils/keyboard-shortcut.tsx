import type { HTMLAttributes } from "react";

import { cn } from "./cn.js";

export interface KeyboardShortcutProps extends HTMLAttributes<HTMLElement> {
  keys: readonly string[] | string;
}

export function KeyboardShortcut({ keys, className, ...props }: KeyboardShortcutProps) {
  const list = typeof keys === "string" ? keys.split("+").map((s) => s.trim()) : keys;
  return (
    <kbd
      className={cn(
        "inline-flex items-center gap-1 font-mono text-[0.6rem] uppercase tracking-widest text-fg-dim",
        className,
      )}
      {...props}
    >
      {list.map((k, i) => (
        <span
          key={`${k}-${i}`}
          className="inline-flex h-5 min-w-[1.25rem] items-center justify-center px-1.5 rounded-sm bg-bg-base shadow-flat-subtle text-[0.65rem]"
        >
          {k}
        </span>
      ))}
    </kbd>
  );
}
