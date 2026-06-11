import { cn } from "@/lib/utils";

export type ChromeTabItem<T extends string> = {
  value: T;
  label: string;
  badge?: string | number | null;
};

export function ChromeTabs<T extends string>({
  items,
  value,
  onChange,
  className
}: {
  items: ChromeTabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end gap-2 border-b border-white/8 px-4 pt-2", className)}>
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => onChange(item.value)}
            className={cn(
              "inline-flex items-center gap-2 rounded-t-[1.15rem] border border-b-0 px-4 py-2 text-sm transition",
              active
                ? "border-white/12 bg-[#101b2c] text-white shadow-[0_-12px_30px_rgba(8,17,29,0.18)]"
                : "border-transparent bg-white/[0.03] text-slate-400 hover:border-white/8 hover:text-slate-200"
            )}
          >
            <span>{item.label}</span>
            {item.badge != null ? (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[11px] font-medium",
                  active ? "bg-white/10 text-slate-100" : "bg-white/[0.06] text-slate-400"
                )}
              >
                {item.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
