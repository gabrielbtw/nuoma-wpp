import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
    files: number;
    created: number;
    updated: number;
    unchanged: number;
    processedThreads: number;
    processedFollowers: number;
    processedFollowing: number;
    phonesDiscovered: number;
    whatsappCsvMatches: number;
    whatsappCsvNamesApplied: number;
    namesFromPhones: number;
    deletedSources: number;
  };
  fileRuns: ImportEvent[];
};

function asNumber(input: unknown) {
  return Number(input ?? 0);
}

export function ImportsPage() {
  const query = useQuery({
    queryKey: ["imports"],
    queryFn: () => apiFetch<ImportsResponse>("/imports"),
    refetchInterval: 15_000
  });

  const latestBatch = query.data?.latestBatch ?? null;
  const batchAggregate = latestBatch?.meta.aggregate ?? {};
  const batchWhatsappCsvImport = latestBatch?.meta.whatsappCsvImport ?? {};
  const batchWhatsappConversationEnrichment = latestBatch?.meta.whatsappConversationEnrichment ?? {};
  const batchWhatsappMessageEnrichment = latestBatch?.meta.whatsappMessageEnrichment ?? {};
  const batchBackfill = latestBatch?.meta.backfill ?? {};
  const fileRuns = query.data?.fileRuns ?? [];
  const totals = query.data?.totals;

  return (
    <div>
      <PageHeader
        eyebrow="Operações"
        title="Importações"
        description="Resumo persistido das importações do Instagram, com matching pelo CSV do WhatsApp, enriquecimento por conversas e limpeza dos artefatos após processamento."
      />
      {query.error ? <ErrorPanel message={(query.error as Error).message} /> : null}

      <div className="grid gap-4 lg:grid-cols-4">
        {[
          ["Arquivos processados", asNumber(batchAggregate.processedFiles || totals?.files)],
          ["Contatos criados", asNumber(batchAggregate.created || totals?.created)],
          ["Contatos atualizados", asNumber(batchAggregate.updated || totals?.updated)],
          ["Fontes removidas", asNumber(batchAggregate.deletedSources || totals?.deletedSources)]
        ].map(([label, value]) => (
          <Card key={String(label)}>
            <CardContent>
              <div className="text-xs uppercase tracking-[0.16em] text-slate-500">{label}</div>
              <div className="mt-3 text-3xl font-semibold text-white">{String(value)}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <CardHeader>
            <CardTitle>Último lote</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {latestBatch ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={latestBatch.level === "error" ? "danger" : latestBatch.level === "warn" ? "warning" : "info"}>{latestBatch.level}</Badge>
                  <span className="text-sm text-slate-300">{latestBatch.message}</span>
                </div>
                <div className="text-xs text-slate-500">{new Date(latestBatch.created_at).toLocaleString()}</div>
                <div className="grid gap-3 md:grid-cols-2">
                  {[
                    ["Threads lidas", asNumber(batchAggregate.processedThreads)],
                    ["Seguidores criados/avaliados", asNumber(batchAggregate.processedFollowers)],
                    ["Seguindo criados/avaliados", asNumber(batchAggregate.processedFollowing)],
                    ["Telefones encontrados", asNumber(batchAggregate.phonesDiscovered)],
                    ["Matches no CSV", asNumber(batchAggregate.whatsappCsvMatches)],
                    ["Nomes aplicados do CSV", asNumber(batchAggregate.whatsappCsvNamesApplied)],
                    ["Nomes definidos pelo telefone", asNumber(batchAggregate.namesFromPhones)],
                    ["Arquivos sem JSON útil", asNumber(batchAggregate.skippedNoSupportedData)]
                  ].map(([label, value]) => (
                    <div key={String(label)} className="rounded-2xl border border-white/6 bg-white/[0.03] px-4 py-3">
                      <div className="text-xs uppercase tracking-[0.16em] text-slate-500">{label}</div>
                      <div className="mt-2 text-sm text-slate-200">{String(value)}</div>
                    </div>
                  ))}
                </div>
                {latestBatch.meta.csvPath ? (
                  <div className="rounded-2xl border border-white/6 bg-white/[0.03] px-4 py-3 text-sm text-slate-300">
                    CSV usado: {latestBatch.meta.csvPath}
                  </div>
                ) : null}
                {(asNumber(batchWhatsappCsvImport.created) > 0 || asNumber(batchWhatsappCsvImport.updated) > 0) ? (
                  <div className="rounded-2xl border border-sky-400/15 bg-sky-500/10 px-4 py-3 text-sm text-sky-100">
                    CSV de WhatsApp: {asNumber(batchWhatsappCsvImport.created)} contatos criados, {asNumber(batchWhatsappCsvImport.updated)} atualizados, {asNumber(batchWhatsappCsvImport.whatsappConversationNamesApplied)} nomes vindos de conversas e {asNumber(batchWhatsappCsvImport.phoneNamesApplied)} contatos salvos com o telefone.
                  </div>
                ) : null}
                {asNumber(batchWhatsappConversationEnrichment.updatedContacts) > 0 ? (
                  <div className="rounded-2xl border border-cyan-400/15 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">
                    Enriquecimento via conversas do WhatsApp: {asNumber(batchWhatsappConversationEnrichment.updatedContacts)} contatos atualizados em uma nova passada.
                  </div>
                ) : null}
                {asNumber(batchWhatsappMessageEnrichment.updatedContacts) > 0 ? (
                  <div className="rounded-2xl border border-fuchsia-400/15 bg-fuchsia-500/10 px-4 py-3 text-sm text-fuchsia-100">
                    Enriquecimento por mensagens recebidas: {asNumber(batchWhatsappMessageEnrichment.updatedContacts)} contatos atualizados, {asNumber(batchWhatsappMessageEnrichment.namesApplied)} nomes confirmados pela própria pessoa, {asNumber(batchWhatsappMessageEnrichment.cpfsApplied)} CPF(s) e {asNumber(batchWhatsappMessageEnrichment.emailsApplied)} e-mail(s).
                  </div>
                ) : null}
                {(asNumber(batchBackfill.updatedContacts) > 0 || asNumber(batchBackfill.whatsappCsvNamesApplied) > 0 || asNumber(batchBackfill.namesFromPhones) > 0) ? (
                  <div className="rounded-2xl border border-emerald-400/15 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                    Backfill pós-importação: {asNumber(batchBackfill.updatedContacts)} contatos revisitados, {asNumber(batchBackfill.whatsappCsvNamesApplied)} nomes vindos do CSV, {asNumber(batchBackfill.whatsappContactNamesApplied)} nomes vindos de contatos do WhatsApp, {asNumber(batchBackfill.cpfsApplied)} CPF(s), {asNumber(batchBackfill.emailsApplied)} e {asNumber(batchBackfill.namesFromPhones)} nomes substituídos pelo telefone.
                  </div>
                ) : null}
                {(latestBatch.meta.pendingIncompleteFiles ?? []).length > 0 ? (
                  <div className="rounded-2xl border border-amber-400/15 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                    Arquivos ainda incompletos e não importados: {(latestBatch.meta.pendingIncompleteFiles ?? []).length}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="text-sm text-slate-400">Nenhum lote registrado ainda.</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Arquivos recentes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {fileRuns.length > 0 ? (
              fileRuns.slice(0, 24).map((event) => {
                const summary = event.meta.summary ?? {};
                return (
                  <div key={event.id} className="rounded-2xl border border-white/6 bg-white/[0.03] px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-white">{event.meta.sourcePath?.split("/").pop() ?? event.message}</div>
                        <div className="mt-1 text-xs text-slate-500">{new Date(event.created_at).toLocaleString()}</div>
                      </div>
                      <Badge tone={asNumber(summary.skippedNoSupportedData) > 0 ? "warning" : "success"}>
                        {asNumber(summary.skippedNoSupportedData) > 0 ? "sem JSON útil" : "importado"}
                      </Badge>
                    </div>
                    <div className="mt-3 grid gap-2 text-sm text-slate-300 sm:grid-cols-2">
                      <div>Criados: {asNumber(summary.created)}</div>
                      <div>Atualizados: {asNumber(summary.updated)}</div>
                      <div>Threads: {asNumber(summary.processedThreads)}</div>
                      <div>Telefones: {asNumber(summary.phonesDiscovered)}</div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="text-sm text-slate-400">Nenhum arquivo processado ainda.</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
