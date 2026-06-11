import { useState, useMemo } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type DataTableColumn<T> = {
  key: string;
  header: string;
  render: (row: T, index: number) => React.ReactNode;
  className?: string;
  sortable?: boolean;
};

export function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  pageSize = 20,
  onRowClick,
  selectedId,
  idKey = "id",
  emptyMessage = "Nenhum resultado encontrado.",
  className
}: {
  columns: DataTableColumn<T>[];
  data: T[];
  pageSize?: number;
  onRowClick?: (row: T) => void;
  selectedId?: string | null;
  idKey?: string;
  emptyMessage?: string;
  className?: string;
}) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(data.length / pageSize));
  const safePage = Math.min(page, totalPages);

  const pagedData = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return data.slice(start, start + pageSize);
  }, [data, safePage, pageSize]);

  return (
    <div className={cn("rounded-2xl border border-white/5 bg-white/[0.01] overflow-hidden", className)}>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-white/5 bg-white/[0.02]">
              {columns.map((col) => (
                <th key={col.key} className={cn("px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-500", col.className)}>
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.03]">
            {pagedData.map((row, index) => {
              const rowId = String(row[idKey] ?? index);
              const isSelected = selectedId === rowId;
              return (
                <tr
                  key={rowId}
                  onClick={() => onRowClick?.(row)}
                  className={cn(
                    "transition-colors duration-200",
                    onRowClick && "cursor-pointer",
                    isSelected ? "bg-cmm-blue/5" : "hover:bg-white/[0.02]"
                  )}
                >
                  {columns.map((col) => (
                    <td key={col.key} className={cn("px-4 py-3 text-sm text-slate-300", col.className)}>
                      {col.render(row, (safePage - 1) * pageSize + index)}
                    </td>
                  ))}
                </tr>
              );
            })}
            {pagedData.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-12 text-center text-xs text-slate-600">
                  {emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-white/5 px-4 py-2.5">
          <span className="text-[10px] font-bold text-slate-600">
            {data.length} total | Pagina {safePage}/{totalPages}
          </span>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(1)} disabled={safePage <= 1}
              className="h-7 w-7 flex items-center justify-center rounded-lg text-slate-500 hover:bg-white/[0.04] disabled:opacity-30">
              <ChevronsLeft className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => setPage(safePage - 1)} disabled={safePage <= 1}
              className="h-7 w-7 flex items-center justify-center rounded-lg text-slate-500 hover:bg-white/[0.04] disabled:opacity-30">
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => setPage(safePage + 1)} disabled={safePage >= totalPages}
              className="h-7 w-7 flex items-center justify-center rounded-lg text-slate-500 hover:bg-white/[0.04] disabled:opacity-30">
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => setPage(totalPages)} disabled={safePage >= totalPages}
              className="h-7 w-7 flex items-center justify-center rounded-lg text-slate-500 hover:bg-white/[0.04] disabled:opacity-30">
              <ChevronsRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
