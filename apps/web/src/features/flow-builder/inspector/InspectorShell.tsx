import { Copy, Trash2, type LucideIcon } from "lucide-react";
import { motion } from "framer-motion";
import type { ReactNode } from "react";

import { IconButton, cn } from "@nuoma/ui";

import type { NodeTone } from "../config/step-registry.js";

const TONE_CHIP: Record<NodeTone, string> = {
  accent: "bg-accent/12 text-accent",
  wa: "bg-channel-wa/12 text-channel-wa",
  ig: "bg-channel-ig/12 text-channel-ig",
  info: "bg-status-info/12 text-status-info",
  ok: "bg-status-ok/12 text-status-ok",
  warn: "bg-status-warn/14 text-status-warn",
  danger: "bg-status-error/12 text-status-error",
  neutral: "bg-ink-strong/[0.06] text-ink-soft",
};

export interface InspectorShellProps {
  panelKey: string;
  icon: LucideIcon;
  tone: NodeTone;
  kicker: string;
  title: string;
  onDuplicate?: () => void;
  onDelete?: () => void;
  children: ReactNode;
}

/** Right-sidebar frame: animated header + scrollable body. */
export function InspectorShell({
  panelKey,
  icon: Icon,
  tone,
  kicker,
  title,
  onDuplicate,
  onDelete,
  children,
}: InspectorShellProps) {
  return (
    <motion.div
      key={panelKey}
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className="flex h-full flex-col"
      data-testid="builder-inspector"
    >
      <header className="flex items-center gap-3 border-b border-line-hairline px-4 py-3.5">
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
            TONE_CHIP[tone],
          )}
        >
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-ink-faint">
            {kicker}
          </p>
          <p className="truncate font-display text-sm font-semibold text-ink-strong">{title}</p>
        </div>
        {onDuplicate ? (
          <IconButton
            label="Duplicar bloco"
            size="sm"
            icon={<Copy className="h-4 w-4" />}
            onClick={onDuplicate}
          />
        ) : null}
        {onDelete ? (
          <IconButton
            label="Excluir bloco"
            size="sm"
            className="text-status-error hover:text-status-error"
            icon={<Trash2 className="h-4 w-4" />}
            onClick={onDelete}
          />
        ) : null}
      </header>
      <div className="flex-1 overflow-y-auto px-4 pb-8 pt-4">{children}</div>
    </motion.div>
  );
}
