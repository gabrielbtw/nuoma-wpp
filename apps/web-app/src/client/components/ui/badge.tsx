import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const toneClassMap: Record<string, string> = {
  success: "bg-n-wa/10 text-n-wa ring-n-wa/20",
  warning: "bg-n-amber/10 text-n-amber ring-n-amber/20",
  danger: "bg-n-red/10 text-n-red ring-n-red/20",
  info: "bg-n-blue/10 text-n-blue ring-n-blue/20",
  default: "bg-n-surface-2 text-n-text-muted ring-white/[0.06]"
};

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof toneClassMap }) {
  const tone = (props as { tone?: keyof typeof toneClassMap }).tone ?? "default";
  return (
    <span
      className={cn("inline-flex items-center rounded-full ring-1 px-2 py-0.5 text-caption font-medium", toneClassMap[tone], className)}
      {...props}
    />
  );
}
