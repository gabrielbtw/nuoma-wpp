import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const toneClassMap: Record<string, string> = {
  success: "bg-emerald-500/15 text-emerald-300 border-emerald-400/20",
  warning: "bg-amber-500/15 text-amber-300 border-amber-400/20",
  danger: "bg-rose-500/15 text-rose-300 border-rose-400/20",
  info: "bg-sky-500/15 text-sky-300 border-sky-400/20",
  default: "bg-white/8 text-slate-200 border-white/10"
};

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof toneClassMap }) {
  const tone = (props as { tone?: keyof typeof toneClassMap }).tone ?? "default";
  return (
    <span
      className={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium", toneClassMap[tone], className)}
      {...props}
    />
  );
}
