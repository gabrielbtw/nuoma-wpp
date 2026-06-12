import { Handle, Position, type NodeProps } from "@xyflow/react";
import { TriangleAlert } from "lucide-react";

import { cn } from "@nuoma/ui";

import type { NodeTone } from "../config/step-registry.js";
import type { BuilderNode } from "./graph.js";

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

export function FlowNodeCard({ data, selected }: NodeProps<BuilderNode>) {
  const Icon = data.icon;
  const hasErrors = data.errors.length > 0;

  if (data.kind === "end") {
    return (
      <div
        className={cn(
          "nwfb-node-end flex h-[52px] w-[168px] items-center justify-center gap-2 rounded-full",
          "border border-line-soft bg-surface-1 text-xs font-medium uppercase tracking-[0.14em] text-ink-soft",
          selected && "border-accent text-ink-strong",
        )}
      >
        <Icon className="h-3.5 w-3.5" />
        {data.title}
        <Handle type="target" position={Position.Top} id="in" className="nwfb-handle" />
        <Handle type="target" position={Position.Right} id="branch-in" className="nwfb-handle" />
      </div>
    );
  }

  const isEntry = data.kind === "entry";

  return (
    <div
      data-testid={isEntry ? "flow-node-entry" : "flow-node-block"}
      className={cn(
        "nwfb-node group relative w-[312px] rounded-xl border bg-surface-2 text-left",
        "border-line-hairline shadow-raised transition-[border-color,box-shadow] duration-150",
        "hover:border-line-strong",
        selected && "border-accent shadow-lifted ring-1 ring-accent/60",
        hasErrors && !selected && "border-status-error/50",
      )}
    >
      <div className="flex items-start gap-3 px-4 pt-3.5">
        <span
          className={cn(
            "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
            TONE_CHIP[data.tone],
          )}
        >
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {isEntry ? (
              <span className="font-mono text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-accent">
                {data.kicker}
              </span>
            ) : (
              <span className="font-mono text-[0.6rem] font-semibold tabular-nums text-ink-faint">
                {String(data.order).padStart(2, "0")}
              </span>
            )}
            <span className="truncate text-[0.62rem] font-medium uppercase tracking-[0.12em] text-ink-faint">
              {data.typeLabel}
            </span>
          </div>
          <p className="mt-0.5 truncate font-display text-sm font-semibold text-ink-strong">
            {data.title}
          </p>
        </div>
        {hasErrors ? (
          <span
            data-testid="flow-node-errors"
            className="mt-1 flex shrink-0 items-center gap-1 rounded-md bg-status-error/12 px-1.5 py-0.5 text-[0.62rem] font-semibold text-status-error"
            title={data.errors.join("\n")}
          >
            <TriangleAlert className="h-3 w-3" />
            {data.errors.length}
          </span>
        ) : null}
      </div>

      {data.summary ? (
        <p className="nwfb-node-summary mt-2 px-4 text-xs leading-5 text-ink-soft">
          {data.summary}
        </p>
      ) : null}

      <div className="flex min-h-[34px] flex-wrap items-center gap-1.5 px-4 pb-3 pt-2">
        {data.badges.map((badge) => (
          <span
            key={badge}
            className="rounded-md bg-ink-strong/[0.05] px-1.5 py-0.5 font-mono text-[0.62rem] text-ink-soft"
          >
            {badge}
          </span>
        ))}
      </div>

      {!isEntry ? (
        <Handle type="target" position={Position.Top} id="in" className="nwfb-handle" />
      ) : null}
      <Handle type="source" position={Position.Bottom} id="out" className="nwfb-handle" />
      {!isEntry ? (
        <Handle
          type="target"
          position={Position.Right}
          id="branch-in"
          className="nwfb-handle nwfb-handle-side"
        />
      ) : null}
      {data.branchSource ? (
        <Handle
          type="source"
          position={Position.Right}
          id="branch"
          className="nwfb-handle nwfb-handle-branch"
          title="Arraste até outro bloco para criar um desvio"
        />
      ) : null}
    </div>
  );
}
