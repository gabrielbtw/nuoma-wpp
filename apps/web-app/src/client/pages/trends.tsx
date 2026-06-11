import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorPanel } from "@/components/shared/error-panel";
import { PageHeader } from "@/components/shared/page-header";
import { apiFetch, toJsonBody } from "@/lib/api";

type OverviewResponse = {
  providerConfigured: boolean;
  provider: {
    mode: string;
    audioProvider: string;
    imageProvider: string;
    openAiAvailable: boolean;
    localWhisperAvailable: boolean;
  };
  countsByKind: Record<string, number>;
  countsByStatus: Record<string, number>;
  sources: Array<{
    id: string;
    label: string;
    rootPath: string;
    sourceType: string;
    lastScanAt: string | null;
  }>;
  latestReport: {
    id: string;
    summaryText: string;
    topKeywords: Array<{ term: string; count: number }>;
    topBigrams: Array<{ term: string; count: number }>;
    topSenders: Array<{ term: string; count: number }>;
    topThreads: Array<{ term: string; count: number }>;
    intentSignals: Array<{ key: string; label: string; count: number; sample: string | null }>;
    timeline: Array<{ date: string; count: number }>;
    totals: Record<string, number>;
    createdAt: string;
  } | null;
  recentAssets: Array<{
    id: string;
    assetKind: string;
    title: string;
    sourceType: string;
    capturedAt: string | null;
  }>;
  pendingAssets: Array<{
    id: string;
    assetKind: string;
    title: string;
    enrichmentStatus: string;
    enrichmentError: string | null;
    capturedAt: string | null;
  }>;
};

type RunResponse = {
  summary: {
    databaseMessagesIndexed: number;
    instagramArchiveThreads: number;
    instagramArchiveMessages: number;
    mediaFilesIndexed: number;
    pendingAiAssets: number;
    enrichmentSummary: {
      provider: string;
      processed: number;
      transcriptsCompleted: number;
      imagesDescribed: number;
      failed: number;
      pendingProvider: number;
    };
  };
};

function formatDateTime(input?: string | null) {
  if (!input) {
    return "ainda não executado";
  }

  return new Date(input).toLocaleString();
}

function asNumber(input: unknown) {
  return Number(input ?? 0);
}

export function TrendsPage() {
  const queryClient = useQueryClient();
  const overviewQuery = useQuery({
    queryKey: ["data-lake"],
    queryFn: () => apiFetch<OverviewResponse>("/data-lake"),
    refetchInterval: 20_000
  });

  const runMutation = useMutation({
    mutationFn: () =>
      apiFetch<RunResponse>("/data-lake/run", {
        method: "POST",
        body: toJsonBody({})
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["data-lake"] });
    }
  });

  const overview = overviewQuery.data;
  const report = overview?.latestReport ?? null;
  const pendingAssets = overview?.pendingAssets ?? [];

  return (
    <div>
      <PageHeader
        eyebrow="Insights"
        title="Tendências"
        description="Data lake local para consolidar conversas, áudios e imagens do app, com análise de sinais recorrentes e preparação para transcrição com IA."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone={overview?.providerConfigured ? "success" : "warning"}>
              {overview?.providerConfigured ? "IA disponível" : "IA pendente"}
            </Badge>
            <Button onClick={() => runMutation.mutate()} disabled={runMutation.isPending}>
              {runMutation.isPending ? "Processando..." : "Rodar pipeline"}
            </Button>
          </div>
        }
      />

      {overviewQuery.error ? <ErrorPanel message={(overviewQuery.error as Error).message} /> : null}
      {runMutation.error ? <ErrorPanel message={(runMutation.error as Error).message} /> : null}

      <div className="grid gap-4 lg:grid-cols-4">
        {[
          ["Mensagens indexadas", asNumber(overview?.countsByKind.conversation_message)],
          ["Áudios capturados", asNumber(overview?.countsByKind.audio)],
          ["Imagens capturadas", asNumber(overview?.countsByKind.image)],
          ["Fila de IA", asNumber(overview?.countsByStatus.pending_ai) + asNumber(overview?.countsByStatus.failed)]
        ].map(([label, value]) => (
          <Card key={String(label)}>
            <CardContent>
              <div className="text-xs uppercase tracking-wider text-n-text-dim">{label}</div>
              <div className="mt-3 text-3xl font-semibold text-n-text">{String(value)}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {!overview?.providerConfigured ? (
        <div className="mt-4 rounded-2xl border border-n-amber/20 bg-n-amber/5 px-4 py-3 text-body text-n-amber">
          O lake já indexa conversas e mídias locais. Para transcrever áudios localmente, configure `WHISPER_MODEL_PATH` e `WHISPER_BIN`; para imagens, mantenha um provider de visão.
        </div>
      ) : null}

      {overview?.providerConfigured ? (
        <div className="mt-4 rounded-2xl border border-n-blue/20 bg-n-blue/5 px-4 py-3 text-body text-n-blue">
          Provider atual: áudio em <strong>{overview.provider.audioProvider}</strong> e imagem em <strong>{overview.provider.imageProvider}</strong>.
        </div>
      ) : null}

      {runMutation.data?.summary ? (
        <div className="mt-4 rounded-2xl border border-n-wa/20 bg-n-wa/5 px-4 py-3 text-body text-n-wa">
          Última execução: {runMutation.data.summary.databaseMessagesIndexed} mensagens do banco, {runMutation.data.summary.instagramArchiveMessages} mensagens de arquivos do Instagram, {runMutation.data.summary.mediaFilesIndexed} mídias locais e {runMutation.data.summary.enrichmentSummary.transcriptsCompleted} transcrições concluídas.
        </div>
      ) : null}

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>Resumo analítico</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {report ? (
              <>
                <div className="rounded-2xl border border-n-border bg-n-surface-2 px-4 py-4 text-body text-n-text">{report.summaryText}</div>
                <div className="text-xs text-n-text-dim">Gerado em {formatDateTime(report.createdAt)}</div>

                <div className="grid gap-3 md:grid-cols-2">
                  {report.intentSignals.slice(0, 6).map((signal) => (
                    <div key={signal.key} className="rounded-2xl border border-n-border bg-n-surface-2 px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-body font-medium text-n-text">{signal.label}</div>
                        <Badge tone="info">{signal.count}</Badge>
                      </div>
                      {signal.sample ? <div className="mt-2 text-xs text-n-text-muted">{signal.sample}</div> : null}
                    </div>
                  ))}
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div>
                    <div className="mb-2 text-xs uppercase tracking-wider text-n-text-dim">Palavras-chave</div>
                    <div className="flex flex-wrap gap-2">
                      {report.topKeywords.slice(0, 12).map((item) => (
                        <Badge key={item.term} tone="default">
                          {item.term} · {item.count}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="mb-2 text-xs uppercase tracking-wider text-n-text-dim">Bigrams</div>
                    <div className="space-y-2">
                      {report.topBigrams.slice(0, 6).map((item) => (
                        <div key={item.term} className="flex items-center justify-between rounded-2xl border border-n-border bg-n-surface-2 px-3 py-2 text-sm">
                          <span className="text-n-text">{item.term}</span>
                          <span className="text-n-text-dim">{item.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="text-sm text-n-text-muted">Rode o pipeline para gerar o primeiro relatório de tendências.</div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Threads e remetentes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="mb-2 text-xs uppercase tracking-wider text-n-text-dim">Threads mais recorrentes</div>
                <div className="space-y-2">
                  {(report?.topThreads ?? []).slice(0, 6).map((item) => (
                    <div key={item.term} className="flex items-center justify-between rounded-2xl border border-n-border bg-n-surface-2 px-3 py-2 text-sm">
                      <span className="truncate text-n-text">{item.term}</span>
                      <span className="text-n-text-dim">{item.count}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-2 text-xs uppercase tracking-wider text-n-text-dim">Remetentes mais ativos</div>
                <div className="space-y-2">
                  {(report?.topSenders ?? []).slice(0, 6).map((item) => (
                    <div key={item.term} className="flex items-center justify-between rounded-2xl border border-n-border bg-n-surface-2 px-3 py-2 text-sm">
                      <span className="truncate text-n-text">{item.term}</span>
                      <span className="text-n-text-dim">{item.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Fila de mídia</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {pendingAssets.length > 0 ? (
                pendingAssets.map((asset) => (
                  <div key={asset.id} className="rounded-2xl border border-n-border bg-n-surface-2 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-body font-medium text-n-text">{asset.title}</div>
                        <div className="mt-1 text-xs text-n-text-dim">
                          {asset.assetKind} · {formatDateTime(asset.capturedAt)}
                        </div>
                      </div>
                      <Badge tone={asset.enrichmentStatus === "failed" ? "danger" : "warning"}>{asset.enrichmentStatus}</Badge>
                    </div>
                    {asset.enrichmentError ? <div className="mt-2 text-xs text-n-text-muted">{asset.enrichmentError}</div> : null}
                  </div>
                ))
              ) : (
                <div className="text-sm text-n-text-muted">Nenhum ativo pendente de enriquecimento.</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Fontes ativas</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(overview?.sources ?? []).length > 0 ? (
                overview?.sources.map((source) => (
                  <div key={source.id} className="rounded-2xl border border-n-border bg-n-surface-2 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-body font-medium text-n-text">{source.label}</div>
                        <div className="mt-1 text-xs text-n-text-dim">{source.rootPath}</div>
                      </div>
                      <Badge tone="default">{source.sourceType}</Badge>
                    </div>
                    <div className="mt-2 text-xs text-n-text-dim">Último scan: {formatDateTime(source.lastScanAt)}</div>
                  </div>
                ))
              ) : (
                <div className="text-sm text-n-text-muted">As fontes aparecem aqui depois da primeira execução do pipeline.</div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
