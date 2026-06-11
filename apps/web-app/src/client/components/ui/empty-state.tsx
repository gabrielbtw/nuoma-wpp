import { type LucideIcon, Inbox } from "lucide-react";
import { Button } from "./button";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  actionLabel,
  onAction,
  className
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-16 text-center", className)}>
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/[0.04] mb-4">
        <Icon className="h-7 w-7 text-slate-600" />
      </div>
      <h4 className="text-sm font-bold text-slate-400 tracking-tight">{title}</h4>
      {description && <p className="mt-1.5 text-xs text-slate-600 max-w-xs">{description}</p>}
      {actionLabel && onAction && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
