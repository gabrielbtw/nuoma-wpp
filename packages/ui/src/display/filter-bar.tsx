import { Filter, X } from "lucide-react";
import { type ReactNode } from "react";

import { Button } from "../controls/button.js";
import { cn } from "../utils/cn.js";

export interface FilterBarProps {
  children: ReactNode;
  activeCount?: number;
  onClear?: () => void;
  onApply?: () => void;
  className?: string;
}

export function FilterBar({
  children,
  activeCount = 0,
  onClear,
  onApply,
  className,
}: FilterBarProps) {
  return (
    <section
      aria-label="Filtros"
      className={cn(
        "grid gap-3 rounded-lg border border-line-hairline/40 bg-surface-1/78 p-3",
        "lg:grid-cols-[1fr_auto]",
        className,
      )}
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{children}</div>
      <div className="flex flex-wrap items-end justify-end gap-2">
        {activeCount > 0 ? (
          <span className="inline-flex h-9 items-center rounded-md bg-accent/12 px-3 text-xs font-medium text-accent">
            {activeCount} filtro(s)
          </span>
        ) : null}
        {onClear ? (
          <Button size="sm" variant="ghost" leftIcon={<X className="h-4 w-4" />} onClick={onClear}>
            Limpar
          </Button>
        ) : null}
        {onApply ? (
          <Button
            size="sm"
            variant="accent"
            leftIcon={<Filter className="h-4 w-4" />}
            onClick={onApply}
          >
            Aplicar
          </Button>
        ) : null}
      </div>
    </section>
  );
}
