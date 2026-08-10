import { type ReactNode } from "react";

import { Checkbox } from "../controls/checkbox.js";
import { EmptyState } from "./states.js";
import { cn } from "../utils/cn.js";

export interface DataTableColumn<T> {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: "left" | "center" | "right";
  className?: string;
  width?: string;
}

export interface DataTableProps<T> {
  columns: ReadonlyArray<DataTableColumn<T>>;
  rows: readonly T[];
  getRowKey: (row: T) => string | number;
  selectedKeys?: Array<string | number>;
  onSelectedKeysChange?: (keys: Array<string | number>) => void;
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
}

export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  selectedKeys,
  onSelectedKeysChange,
  emptyTitle = "Nenhum resultado encontrado",
  emptyDescription = "Ajuste os filtros ou tente outro termo.",
  className,
}: DataTableProps<T>) {
  const selectable = Boolean(selectedKeys && onSelectedKeysChange);
  const selectedSet = new Set(selectedKeys ?? []);
  const allSelected = rows.length > 0 && rows.every((row) => selectedSet.has(getRowKey(row)));

  const toggleAll = () => {
    if (!onSelectedKeysChange) return;
    onSelectedKeysChange(allSelected ? [] : rows.map(getRowKey));
  };

  const toggleRow = (key: string | number) => {
    if (!onSelectedKeysChange) return;
    const next = new Set(selectedSet);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onSelectedKeysChange([...next]);
  };

  if (rows.length === 0) {
    return (
      <div
        className={cn(
          "rounded-[1.125rem] border border-line-hairline bg-surface-deep/40",
          className,
        )}
      >
        <EmptyState title={emptyTitle} description={emptyDescription} className="py-12" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-[1.125rem] border border-line-hairline bg-surface-1 shadow-flat",
        className,
      )}
    >
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse text-left text-sm">
          <thead className="bg-surface-deep/72 text-xs uppercase tracking-[0.1em] text-ink-soft">
            <tr>
              {selectable ? (
                <th className="w-11 px-3 py-3">
                  <Checkbox
                    checked={allSelected}
                    aria-label="Selecionar todas as linhas"
                    onCheckedChange={toggleAll}
                  />
                </th>
              ) : null}
              {columns.map((column) => (
                <th
                  key={column.id}
                  style={column.width ? { width: column.width } : undefined}
                  className={cn(
                    "px-3 py-3 font-semibold",
                    alignClass(column.align),
                    column.className,
                  )}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line-hairline/70 bg-surface-1/72">
            {rows.map((row) => {
              const key = getRowKey(row);
              return (
                <tr key={key} className="transition-colors hover:bg-surface-3/62">
                  {selectable ? (
                    <td className="w-11 px-3 py-3">
                      <Checkbox
                        checked={selectedSet.has(key)}
                        aria-label="Selecionar linha"
                        onCheckedChange={() => toggleRow(key)}
                      />
                    </td>
                  ) : null}
                  {columns.map((column) => (
                    <td
                      key={column.id}
                      className={cn(
                        "px-3 py-3 text-ink",
                        alignClass(column.align),
                        column.className,
                      )}
                    >
                      {column.cell(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function alignClass(align: DataTableColumn<unknown>["align"]) {
  if (align === "center") return "text-center";
  if (align === "right") return "text-right";
  return "text-left";
}
