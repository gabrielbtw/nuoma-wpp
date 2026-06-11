import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { ErrorPanel } from "@/components/shared/error-panel";
import { PageHeader } from "@/components/shared/page-header";
import { apiFetch } from "@/lib/api";

type ImportEvent = {
  id: string;
  level: string;
  message: string;
  created_at: string;
  meta: {
    eventType?: "file" | "batch";
    sourcePath?: string;
    deletedSource?: boolean;
    csvPath?: string | null;
    summary?: Record<string, unknown>;
    aggregate?: Record<string, unknown>;
    whatsappCsvImport?: Record<string, unknown>;
    whatsappConversationEnrichment?: Record<string, unknown>;
    whatsappMessageEnrichment?: Record<string, unknown>;
    backfill?: Record<string, unknown>;
    pendingIncompleteFiles?: string[];
  };
};

type ImportsResponse = {
  latestBatch: ImportEvent | null;
  totals: {
    files: number; created: number; updated: number; unchanged: number;
    processedThreads: number; processedFollowers: number; processedFollowing: number;
    phonesDiscovered: number; whatsappCsvMatches: number; whatsappCsvNamesApplied: number;
    namesFromPhones: number; deletedSources: number;
  };
  fileRuns: ImportEvent[];
};

function n(input: unknown) { return Number(input ?? 0); }

export function ImportsPage() {
  const query = useQuery({
    queryKey: ["imports"],
    queryFn: () => apiFetch<ImportsResponse>("/imports"),
    refetchInterval: 15_000
  });

  const batch = query.data?.latestBatch ?? null;
  const agg = batch?.meta.aggregate ?? {};
  const csvImport = batch?.meta.whatsappCsvImport ?? {};
  const convEnrich = batch?.meta.whatsappConversationEnrichment ?? {};
  const msgEnrich = batch?.meta.whatsappMessageEnrichment ?? {};
  const backfill = batch?.meta.backfill ?? {};
  const fileRuns = query.data?.fileRuns ?? [];
  const totals = query.data?.totals;

  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader eyebrow="Operacoes" title="Importacoes" description="Instagram import, CSV matching, enriquecimento e limpeza." />
      {query.error && <ErrorPanel message={(query.error as Error).message} />}

      {/* Summary metrics */}
      <div className="grid gap-2 md:grid-cols-4">
        {[
          ["Arquivos", n(agg.processedFiles || totals?.files)],
          ["Criados", n(agg.created || totals?.created)],
          ["Atualizados", n(agg.updated || totals?.updated)],
          ["Removidos", n(agg.deletedSources || totals?.deletedSources)]
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-xl border border-n-border bg-n-surface p-3">
            <p className="text-micro uppercase text-n-text-dim">{label}</p>
            <p className="mt-1 font-mono text-h2 text-n-text">{String(value)}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        {/* Batch detail */}
        <div className="rounded-xl border border-n-border bg-n-surface overflow-hidden">
          <div className="border-b border-n-border px-4 py-2.5">
            <h3 className="text-label text-n-text">Ultimo lote</h3>
          </div>
          <div className="p-4 space-y-3">
            {batch ? (
              <>
                <div className="flex items-center gap-2">
                  <Badge tone={batch.level === "error" ? "danger" : batch.level === "warn" ? "warning" : "info"}>{batch.level}</Badge>
                  <span className="text-body text-n-text-muted">{batch.message}</span>
                  <span className="ml-auto text-micro text-n-text-dim">{new Date(batch.created_at).toLocaleString()}</span>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  {[
                    ["Threads", n(agg.processedThreads)], ["Seguidores", n(agg.processedFollowers)],
                    ["Seguindo", n(agg.processedFollowing)], ["Telefones", n(agg.phonesDiscovered)],
                    ["CSV matches", n(agg.whatsappCsvMatches)], ["Nomes CSV", n(agg.whatsappCsvNamesApplied)],
                    ["Nomes tel", n(agg.namesFromPhones)], ["Sem JSON", n(agg.skippedNoSupportedData)]
                  ].map(([label, value]) => (
                    <div key={String(label)} className="flex items-center justify-between rounded-lg bg-n-surface-2 px-3 py-2">
                      <span className="text-caption text-n-text-muted">{label}</span>
                      <span className="font-mono text-body font-semibold text-n-text">{String(value)}</span>
                    </div>
                  ))}
                </div>
                {batch.meta.csvPath && <div className="rounded-lg bg-n-surface-2 px-3 py-2 text-caption text-n-text-muted">CSV: {batch.meta.csvPath}</div>}
                {(n(csvImport.created) > 0 || n(csvImport.updated) > 0) && (
                  <div className="rounded-lg border border-n-blue/20 bg-n-blue/5 px-3 py-2 text-caption text-n-text">
                    CSV WA: {n(csvImport.created)} criados, {n(csvImport.updated)} atualizados
                  </div>
                )}
                {n(convEnrich.updatedContacts) > 0 && (
                  <div className="rounded-lg border border-n-cyan/20 bg-n-cyan/5 px-3 py-2 text-caption text-n-text">
                    Conversas WA: {n(convEnrich.updatedContacts)} contatos enriquecidos
                  </div>
                )}
                {n(msgEnrich.updatedContacts) > 0 && (
                  <div className="rounded-lg border border-n-ig/20 bg-n-ig/5 px-3 py-2 text-caption text-n-text">
                    Mensagens: {n(msgEnrich.updatedContacts)} contatos, {n(msgEnrich.namesApplied)} nomes, {n(msgEnrich.cpfsApplied)} CPFs
                  </div>
                )}
                {(n(backfill.updatedContacts) > 0) && (
                  <div className="rounded-lg border border-n-wa/20 bg-n-wa/5 px-3 py-2 text-caption text-n-text">
                    Backfill: {n(backfill.updatedContacts)} revisitados
                  </div>
                )}
              </>
            ) : (
              <p className="py-8 text-center text-caption text-n-text-dim">Nenhum lote registrado</p>
            )}
          </div>
        </div>

        {/* File runs */}
        <div className="rounded-xl border border-n-border bg-n-surface overflow-hidden">
          <div className="border-b border-n-border px-4 py-2.5">
            <h3 className="text-label text-n-text">Arquivos recentes</h3>
          </div>
          <div className="max-h-[calc(100vh-18rem)] overflow-y-auto custom-scrollbar divide-y divide-n-border-subtle">
            {fileRuns.length > 0 ? fileRuns.slice(0, 24).map((event) => {
              const summary = event.meta.summary ?? {};
              return (
                <div key={event.id} className="px-4 py-2.5 hover:bg-n-surface-2/50 transition-fast">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-body font-medium text-n-text truncate">{event.meta.sourcePath?.split("/").pop() ?? event.message}</span>
                    <Badge tone={n(summary.skippedNoSupportedData) > 0 ? "warning" : "success"} className="shrink-0 text-micro">
                      {n(summary.skippedNoSupportedData) > 0 ? "skip" : "ok"}
                    </Badge>
                  </div>
                  <div className="flex gap-3 mt-1 text-micro text-n-text-dim">
                    <span>+{n(summary.created)}</span>
                    <span>~{n(summary.updated)}</span>
                    <span>{n(summary.processedThreads)} threads</span>
                    <span className="ml-auto">{new Date(event.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                </div>
              );
            }) : <p className="py-8 text-center text-caption text-n-text-dim">Nenhum arquivo processado</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
