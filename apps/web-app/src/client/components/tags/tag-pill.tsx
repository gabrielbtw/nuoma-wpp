import { X } from "lucide-react";
import { cn } from "@/lib/utils";

function withAlpha(color: string, alpha: string) {
  if (/^#[0-9a-f]{6}$/i.test(color)) {
    return `${color}${alpha}`;
  }

  return color;
}

export function TagPill({
  name,
  color,
  muted,
  removable,
  onRemove,
  className
}: {
  name: string;
  color?: string | null;
  muted?: boolean;
  removable?: boolean;
  onRemove?: () => void;
  className?: string;
}) {
  const resolvedColor = color ?? "#38bdf8";
  const styles = muted
    ? undefined
    : {
        color: resolvedColor,
        borderColor: withAlpha(resolvedColor, "55"),
        backgroundColor: withAlpha(resolvedColor, "14")
      };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium tracking-[0.01em] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]",
        muted ? "border-white/10 bg-white/6 text-slate-300" : undefined,
        className
      )}
      style={styles}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{
          backgroundColor: muted ? "#94a3b8" : resolvedColor
        }}
      />
      <span>{name}</span>
      {removable ? (
        <button type="button" className="rounded-full p-0.5 transition hover:bg-black/15" onClick={onRemove} aria-label={`Remover tag ${name}`}>
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </span>
  );
}
