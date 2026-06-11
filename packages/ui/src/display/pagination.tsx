import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "../controls/button.js";
import { IconButton } from "../controls/icon-button.js";
import { cn } from "../utils/cn.js";

export interface PaginationProps {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  totalLabel?: string;
  pageSizeLabel?: string;
  className?: string;
}

export function Pagination({
  page,
  pageCount,
  onPageChange,
  totalLabel,
  pageSizeLabel,
  className,
}: PaginationProps) {
  const safePage = Math.min(Math.max(page, 1), Math.max(pageCount, 1));
  const pages = paginationWindow(safePage, pageCount);

  return (
    <nav
      aria-label="Paginação"
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 border-t border-line-hairline/40 px-3 py-3 text-sm",
        className,
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-3 text-xs text-ink-soft">
        {totalLabel ? <span>{totalLabel}</span> : null}
        {pageSizeLabel ? <span>{pageSizeLabel}</span> : null}
      </div>
      <div className="flex items-center gap-1">
        <IconButton
          label="Página anterior"
          icon={<ChevronLeft className="h-4 w-4" />}
          size="sm"
          variant="ghost"
          disabled={safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
        />
        {pages.map((item, index) =>
          item === "ellipsis" ? (
            <span
              key={`ellipsis-${index}`}
              className="flex h-9 min-w-9 items-center justify-center text-ink-soft"
            >
              ...
            </span>
          ) : (
            <Button
              key={item}
              size="sm"
              variant={item === safePage ? "accent" : "ghost"}
              aria-current={item === safePage ? "page" : undefined}
              className="min-w-9 px-3"
              onClick={() => onPageChange(item)}
            >
              {item}
            </Button>
          ),
        )}
        <IconButton
          label="Próxima página"
          icon={<ChevronRight className="h-4 w-4" />}
          size="sm"
          variant="ghost"
          disabled={safePage >= pageCount}
          onClick={() => onPageChange(safePage + 1)}
        />
      </div>
    </nav>
  );
}

function paginationWindow(page: number, pageCount: number): Array<number | "ellipsis"> {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index + 1);
  const pages = new Set([1, pageCount, page - 1, page, page + 1]);
  const sorted = [...pages].filter((item) => item >= 1 && item <= pageCount).sort((a, b) => a - b);
  return sorted.flatMap((item, index) => {
    const previous = sorted[index - 1];
    if (previous && item - previous > 1) return ["ellipsis" as const, item];
    return [item];
  });
}
