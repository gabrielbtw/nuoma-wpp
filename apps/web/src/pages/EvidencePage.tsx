import type { AppRouter } from "@nuoma/api";
import type { inferRouterOutputs } from "@trpc/server";
import { ExternalLink, FileJson, FileText, ImageIcon, RefreshCw, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";

import {
  Animate,
  Badge,
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  TimeAgo,
  cn,
} from "@nuoma/ui";

import { API_URL } from "../lib/api-url.js";
import { trpc } from "../lib/trpc.js";

type EvidenceList = inferRouterOutputs<AppRouter>["evidence"]["list"];
type EvidenceGroup = EvidenceList["groups"][number];
type EvidenceAsset = EvidenceGroup["assets"][number];

const categoryLabels: Record<EvidenceGroup["category"], string> = {
  "m303-proof": "M30.3",
  "screen-smoke": "screen smoke",
  "single-proof": "print",
  "wpp-smoke": "WhatsApp",
};

const categoryOrder: Array<EvidenceGroup["category"] | "all"> = [
  "all",
  "m303-proof",
  "screen-smoke",
  "wpp-smoke",
  "single-proof",
];

export function EvidencePage() {
  const [category, setCategory] = useState<(typeof categoryOrder)[number]>("all");
  const evidence = trpc.evidence.list.useQuery({ limit: 120 });

  const groups = useMemo(() => {
    const list = evidence.data?.groups ?? [];
    return category === "all" ? list : list.filter((group) => group.category === category);
  }, [category, evidence.data?.groups]);

  if (evidence.isLoading) {
    return (
      <div className="max-w-6xl mx-auto pt-10">
        <LoadingState description="Carregando evidências locais." />
      </div>
    );
  }

  if (evidence.error || !evidence.data) {
    return (
      <div className="max-w-6xl mx-auto pt-10">
        <ErrorState description={evidence.error?.message ?? "Evidence Center indisponível."} />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 pt-2">
      <Animate preset="rise-in">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="botforge-kicker [color:rgb(var(--color-brand-cyan))]">
              M37 Evidence Center
            </p>
            <h1 className="botforge-title mt-2 text-4xl md:text-5xl">
              Provas <span className="text-brand-cyan">navegáveis</span>.
            </h1>
            <p className="mt-3 max-w-2xl text-sm text-fg-muted">
              Relatórios, prints e arquivos `evidence.json` lidos do diretório local `data/`.
            </p>
          </div>
          <div className="flex flex-col gap-2 rounded-xl bg-bg-base px-4 py-3 shadow-flat sm:flex-row sm:items-center">
            <ShieldCheck className="h-4 w-4 text-semantic-success" />
            <div className="min-w-0">
              <div className="text-xs text-fg-primary">Raiz auditada</div>
              <div className="max-w-[28rem] truncate font-mono text-xs text-fg-primary">
                {evidence.data.dataRoot}
              </div>
            </div>
          </div>
        </header>
      </Animate>

      <Animate preset="rise-in" delaySeconds={0.05}>
        <section className="grid gap-3 md:grid-cols-5">
          <SummaryTile label="Grupos" value={evidence.data.summary.groups} />
          <SummaryTile label="Prints" value={evidence.data.summary.images} />
          <SummaryTile label="Reports" value={evidence.data.summary.reports} />
          <SummaryTile label="JSON" value={evidence.data.summary.json} />
          <SummaryTile
            label="Mais recente"
            value={
              evidence.data.summary.latestAt ? (
                <TimeAgo
                  date={evidence.data.summary.latestAt}
                  className="[color:rgb(var(--color-fg-primary))]"
                />
              ) : (
                "—"
              )
            }
            compact
          />
        </section>
      </Animate>

      <Animate preset="rise-in" delaySeconds={0.08}>
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-bg-base px-4 py-3 shadow-flat">
          <div className="flex flex-wrap gap-2">
            {categoryOrder.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setCategory(item)}
                className={cn(
                  "h-8 rounded-md px-3 font-mono text-[0.65rem] uppercase tracking-widest transition-shadow",
                  category === item
                    ? "bg-bg-surface text-brand-cyan shadow-pressed-sm"
                    : "text-fg-primary shadow-flat-subtle hover:shadow-raised-sm",
                )}
              >
                {item === "all" ? "todos" : categoryLabels[item]}
              </button>
            ))}
          </div>
          <Button
            size="sm"
            variant="soft"
            leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
            loading={evidence.isFetching}
            onClick={() => void evidence.refetch()}
          >
            Atualizar
          </Button>
        </section>
      </Animate>

      <Animate preset="rise-in" delaySeconds={0.1}>
        {groups.length === 0 ? (
          <div className="rounded-xl bg-bg-base p-8 shadow-flat">
            <EmptyState description="Nenhuma evidência encontrada para este filtro." />
          </div>
        ) : (
          <section data-testid="evidence-center-grid" className="grid gap-4 xl:grid-cols-2">
            {groups.map((group) => (
              <EvidenceGroupCard key={group.id} group={group} />
            ))}
          </section>
        )}
      </Animate>
    </div>
  );
}

function EvidenceGroupCard({ group }: { group: EvidenceGroup }) {
  const previewAssets = group.assets.filter((asset) => asset.type === "image").slice(0, 4);

  return (
    <article className="rounded-xl bg-bg-base p-4 shadow-flat" data-testid="evidence-group">
      <div className="grid gap-4 md:grid-cols-[11rem_1fr]">
        <a
          href={group.cover ? assetUrl(group.cover) : undefined}
          target="_blank"
          rel="noreferrer"
          className={cn(
            "flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg bg-bg-surface shadow-pressed-sm",
            group.cover && "hover:shadow-raised-sm",
          )}
        >
          {group.cover ? (
            <img
              src={assetUrl(group.cover)}
              alt={group.title}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <ImageIcon className="h-8 w-8 text-fg-dim" />
          )}
        </a>

        <div className="min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                {group.version && <Badge variant="cyan">{group.version}</Badge>}
                <Badge variant={group.category === "m303-proof" ? "success" : "neutral"}>
                  {categoryLabels[group.category]}
                </Badge>
              </div>
              <h2 className="mt-2 truncate text-base font-semibold text-fg-primary">
                {group.title}
              </h2>
              <div className="mt-1 truncate font-mono text-[0.65rem] [color:rgb(var(--color-fg-primary))]">
                {group.relativeDir || "data"}
              </div>
            </div>
            <TimeAgo
              date={group.updatedAt}
              className="[color:rgb(var(--color-fg-primary))]"
            />
          </div>

          <div className="mt-4 grid grid-cols-4 gap-2 text-center">
            <MiniMetric label="assets" value={group.summary.totalAssets} />
            <MiniMetric label="prints" value={group.summary.images} />
            <MiniMetric label="reports" value={group.summary.reports} />
            <MiniMetric label="json" value={group.summary.json} />
          </div>

          {group.markdownPreview && (
            <pre className="mt-4 max-h-24 overflow-hidden rounded-lg bg-bg-surface p-3 text-[0.68rem] leading-5 text-fg-primary shadow-pressed-sm whitespace-pre-wrap">
              {group.markdownPreview}
            </pre>
          )}
        </div>
      </div>

      {previewAssets.length > 0 && (
        <div className="mt-4 grid grid-cols-4 gap-2">
          {previewAssets.map((asset) => (
            <a
              key={asset.relativePath}
              href={assetUrl(asset)}
              target="_blank"
              rel="noreferrer"
              className="aspect-video overflow-hidden rounded-md bg-bg-surface shadow-pressed-sm hover:shadow-raised-sm"
              title={asset.name}
            >
              <img
                src={assetUrl(asset)}
                alt={asset.name}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            </a>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {group.report && <AssetLink asset={group.report} label="REPORT" />}
        {group.evidenceJson && <AssetLink asset={group.evidenceJson} label="evidence.json" />}
        {group.cover && <AssetLink asset={group.cover} label="print fonte" />}
      </div>
    </article>
  );
}

function AssetLink({ asset, label }: { asset: EvidenceAsset; label: string }) {
  const Icon =
    asset.type === "markdown" ? FileText : asset.type === "json" ? FileJson : ImageIcon;
  return (
    <a
      href={assetUrl(asset)}
      target="_blank"
      rel="noreferrer"
      className="inline-flex h-8 items-center gap-2 rounded-md bg-bg-surface px-3 text-xs text-fg-primary shadow-flat transition-shadow hover:shadow-raised-sm"
    >
      <Icon className="h-3.5 w-3.5" />
      <span>{label}</span>
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}

function SummaryTile({
  label,
  value,
  compact = false,
}: {
  label: string;
  value: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className="rounded-xl bg-bg-base px-4 py-4 shadow-flat">
      <div className="text-xs text-fg-primary">{label}</div>
      <div
        className={cn(
          "mt-2 font-semibold text-fg-primary",
          compact ? "text-sm" : "text-3xl tracking-tight",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-bg-surface px-2 py-2 shadow-pressed-sm">
      <div className="font-mono text-sm text-fg-primary">{value}</div>
      <div className="mt-1 truncate font-mono text-[0.58rem] uppercase tracking-widest [color:rgb(var(--color-fg-primary))]">
        {label}
      </div>
    </div>
  );
}

function assetUrl(asset: EvidenceAsset): string {
  return `${API_URL}${asset.routePath}`;
}
