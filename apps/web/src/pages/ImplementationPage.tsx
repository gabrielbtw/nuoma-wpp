import { CheckCircle2, Circle, CircleDashed, FileText } from "lucide-react";

import {
  Animate,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ErrorState,
  LoadingState,
  cn,
} from "@nuoma/ui";

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
    <div className="flex flex-col gap-7 max-w-7xl mx-auto pt-2">
      <Animate preset="rise-in">
        <header className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="botforge-kicker">
              Implementação
            </p>
            <h1 className="botforge-title mt-2 text-5xl md:text-6xl">
              Execução <span className="text-brand-cyan">visível</span>.
            </h1>
            <p className="text-sm text-fg-muted mt-3 max-w-2xl">
              Status derivado de Markdown versionado em `docs/IMPLEMENTATION_STATUS.md`.
            </p>
          </div>
          <div className="flex items-center gap-3 rounded-xl bg-bg-base px-4 py-3 shadow-flat">
            <FileText className="h-4 w-4 text-brand-cyan" />
            <div className="min-w-0">
              <div className="text-xs text-fg-muted">Fonte</div>
              <div className="text-xs font-mono text-fg-primary truncate max-w-[26rem]">
                {status.data.markdownPath}
              </div>
            </div>
          </div>
        </header>
      </Animate>

      <Animate preset="rise-in" delaySeconds={0.05}>
        <section className="grid gap-3 md:grid-cols-4">
          <SummaryTile label="Progresso" value={`${donePercent}%`} accent="cyan" />
          <SummaryTile label="Feito" value={status.data.summary.done} accent="success" />
          <SummaryTile label="Parcial" value={status.data.summary.partial} accent="warning" />
          <SummaryTile label="Falta" value={status.data.summary.pending} accent="neutral" />
        </section>
      </Animate>

      <Animate preset="rise-in" delaySeconds={0.1}>
        <section className="grid gap-4 xl:grid-cols-3">
          {(["done", "partial", "pending"] as const).map((itemStatus) => (
            <StatusColumn
              key={itemStatus}
              status={itemStatus}
              items={itemsByStatus[itemStatus]}
            />
          ))}
        </section>
      </Animate>

      <Animate preset="rise-in" delaySeconds={0.15}>
        <Card>
          <CardHeader>
            <CardTitle>Markdown bruto</CardTitle>
            <CardDescription>Espelho da fonte de execução para revisão rápida.</CardDescription>
          </CardHeader>
          <CardContent>
            <pre
              tabIndex={0}
              aria-label="Markdown bruto do status de implementação"
              className="max-h-[28rem] overflow-auto rounded-lg bg-bg-base p-4 text-xs leading-6 text-fg-muted shadow-pressed-sm whitespace-pre-wrap focus:outline-none focus:ring-2 focus:ring-brand-cyan/50"
            >
              {status.data.markdown}
            </pre>
          </CardContent>
        </Card>
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
    <div className="rounded-xl bg-bg-base px-4 py-4 shadow-flat">
      <div className="text-xs text-fg-muted">{label}</div>
      <div
        className={cn(
          "mt-2 text-3xl font-semibold tracking-tight",
          accent === "cyan" && "text-brand-cyan",
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
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>{meta.columnTitle}</CardTitle>
            <CardDescription>{items.length} item(ns)</CardDescription>
          </div>
          <Badge variant={meta.tone}>{meta.label}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li
              key={`${item.section}-${item.title}`}
              className="rounded-lg bg-bg-base px-3 py-3 shadow-flat"
            >
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
                  <div className="mt-2 text-[0.65rem] uppercase tracking-widest text-fg-dim font-mono">
                    {item.section}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function groupByStatus<T extends { status: ImplementationStatus }>(items: T[]) {
  return {
    done: items.filter((item) => item.status === "done"),
    partial: items.filter((item) => item.status === "partial"),
    pending: items.filter((item) => item.status === "pending"),
  };
}
