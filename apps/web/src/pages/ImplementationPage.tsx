import {
  CheckCircle2,
  Circle,
  CircleDashed,
  FileText,
  GitBranch,
  ListChecks,
  TerminalSquare,
} from "lucide-react";

import { Animate, Badge, ErrorState, LoadingState, cn } from "@nuoma/ui";

import { trpc } from "../lib/trpc.js";

type ImplementationStatus = "done" | "partial" | "pending";

const STATUS_META: Record<
  ImplementationStatus,
  {
    label: string;
    tone: "success" | "warning" | "neutral";
    icon: typeof CheckCircle2;
    columnTitle: string;
  }
> = {
  done: {
    label: "feito",
    tone: "success",
    icon: CheckCircle2,
    columnTitle: "Feito",
  },
  partial: {
    label: "parcial",
    tone: "warning",
    icon: CircleDashed,
    columnTitle: "Parcial",
  },
  pending: {
    label: "falta",
    tone: "neutral",
    icon: Circle,
    columnTitle: "Falta",
  },
};

export function ImplementationPage() {
  const status = trpc.implementation.status.useQuery();

  if (status.isLoading) {
    return (
      <div className="max-w-6xl mx-auto pt-10">
        <LoadingState description="Carregando status de implementação." />
      </div>
    );
  }

  if (status.error || !status.data) {
    return (
      <div className="max-w-6xl mx-auto pt-10">
        <ErrorState description={status.error?.message ?? "Status indisponível."} />
      </div>
    );
  }

  const itemsByStatus = groupByStatus(status.data.items);
  const total =
    status.data.summary.done + status.data.summary.partial + status.data.summary.pending;
  const donePercent = total === 0 ? 0 : Math.round((status.data.summary.done / total) * 100);

  return (
    <div className="flex min-h-[calc(100vh-6.5rem)] w-full max-w-none flex-col gap-4 pt-0">
      <Animate preset="rise-in">
        <header className="nuoma-workspace-header flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="nuoma-compat-kicker">Implementação</p>
            <h1 className="nuoma-compat-display mt-2 text-3xl md:text-4xl">
              Execução <span className="nuoma-gradient-text">visível</span>.
            </h1>
            <p className="text-sm text-fg-muted mt-3 max-w-2xl">
              Status derivado do Markdown versionado em `README.md`.
            </p>
          </div>
          <div className="flex items-center gap-3 rounded-xl bg-bg-base px-4 py-3 shadow-flat">
            <FileText className="h-4 w-4 text-accent" />
            <div className="min-w-0">
              <div className="text-xs text-fg-muted">Fonte</div>
              <div className="text-xs font-mono text-fg-primary truncate max-w-[26rem]">
                {status.data.markdownPath}
              </div>
            </div>
          </div>
        </header>
      </Animate>

      <Animate preset="rise-in" delaySeconds={0.1}>
        <section className="nuoma-implementation-v2">
          <aside className="nuoma-implementation-rail">
            <section>
              <div className="nuoma-ops-panel-head">
                <div>
                  <h2>Progresso</h2>
                  <p>Status consolidado do README.</p>
                </div>
                <TerminalSquare className="h-4 w-4" />
              </div>
              <div className="nuoma-implementation-progress">
                <strong>{donePercent}%</strong>
                <span>concluído</span>
              </div>
            </section>

            <section className="nuoma-implementation-summary">
              <SummaryTile label="Feito" value={status.data.summary.done} accent="success" />
              <SummaryTile label="Parcial" value={status.data.summary.partial} accent="warning" />
              <SummaryTile label="Falta" value={status.data.summary.pending} accent="neutral" />
            </section>

            <section>
              <div className="nuoma-ops-panel-head">
                <div>
                  <h2>Fonte</h2>
                  <p>Contrato vivo da execução.</p>
                </div>
                <GitBranch className="h-4 w-4" />
              </div>
              <div className="nuoma-implementation-source-path">
                <FileText className="h-4 w-4" />
                <span>{status.data.markdownPath}</span>
              </div>
            </section>
          </aside>

          <main className="nuoma-implementation-board">
            <div className="nuoma-implementation-board-head">
              <div>
                <h2>Board de execução</h2>
                <p>Feito, parcial e falta em colunas escaneáveis.</p>
              </div>
              <Badge variant="cyan">{total} itens</Badge>
            </div>
            <div className="nuoma-implementation-columns">
              {(["done", "partial", "pending"] as const).map((itemStatus) => (
                <StatusColumn
                  key={itemStatus}
                  status={itemStatus}
                  items={itemsByStatus[itemStatus]}
                />
              ))}
            </div>
          </main>

          <aside className="nuoma-implementation-markdown">
            <div className="nuoma-ops-panel-head">
              <div>
                <h2>Markdown bruto</h2>
                <p>Espelho da fonte para revisão rápida.</p>
              </div>
              <ListChecks className="h-4 w-4" />
            </div>
            <pre
              tabIndex={0}
              aria-label="Markdown bruto do status de implementação"
              className="nuoma-implementation-pre focus:outline-none focus:ring-2 focus:ring-accent/50"
            >
              {status.data.markdown}
            </pre>
          </aside>
        </section>
      </Animate>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent: "cyan" | "success" | "warning" | "neutral";
}) {
  return (
    <div className="nuoma-implementation-tile">
      <div>{label}</div>
      <div
        className={cn(
          "mt-2 text-3xl font-semibold",
          accent === "cyan" && "text-accent",
          accent === "success" && "text-semantic-success",
          accent === "warning" && "text-semantic-warning",
          accent === "neutral" && "text-fg-primary",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function StatusColumn({
  status,
  items,
}: {
  status: ImplementationStatus;
  items: Array<{
    id: string | null;
    title: string;
    description: string | null;
    section: string;
    status: ImplementationStatus;
  }>;
}) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;

  return (
    <section className="nuoma-implementation-column" data-status={status}>
      <div className="nuoma-implementation-column-head">
        <div>
          <h3>{meta.columnTitle}</h3>
          <span>{items.length} item(ns)</span>
        </div>
        <Badge variant={meta.tone}>{meta.label}</Badge>
      </div>
      <ul tabIndex={0} aria-label={`Itens com status ${meta.columnTitle}`}>
        {items.map((item) => (
          <li key={`${item.section}-${item.title}`}>
            <div className="flex items-start gap-3">
              <Icon
                className={cn(
                  "mt-0.5 h-4 w-4 shrink-0",
                  status === "done" && "text-semantic-success",
                  status === "partial" && "text-semantic-warning",
                  status === "pending" && "text-fg-dim",
                )}
              />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  {item.id && (
                    <span className="font-mono text-[0.65rem] text-fg-dim">{item.id}</span>
                  )}
                  <span className="text-sm font-medium text-fg-primary">{item.title}</span>
                </div>
                {item.description && (
                  <p className="mt-1 text-xs leading-5 text-fg-muted">{item.description}</p>
                )}
                <div className="mt-2 text-[0.65rem] uppercase text-fg-dim font-mono">
                  {item.section}
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function groupByStatus<T extends { status: ImplementationStatus }>(items: T[]) {
  return {
    done: items.filter((item) => item.status === "done"),
    partial: items.filter((item) => item.status === "partial"),
    pending: items.filter((item) => item.status === "pending"),
  };
}
