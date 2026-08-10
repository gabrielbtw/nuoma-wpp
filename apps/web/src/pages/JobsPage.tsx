import { useState, type ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Database,
  RotateCcw,
  ShieldCheck,
  Trash2,
} from "lucide-react";

import {
  Animate,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  LoadingState,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TimeAgo,
  useToast,
} from "@nuoma/ui";

import { ConfirmDangerAction } from "../components/ConfirmDangerAction.js";
import { COPY } from "../lib/copy.js";
import { trpc } from "../lib/trpc.js";

const CLEANUP_CONFIRM_TEXT = "LIMPAR CONCLUÍDOS";

export function JobsPage() {
  const [tab, setTab] = useState("queue");
  const [cleanupConfirm, setCleanupConfirm] = useState("");
  const toast = useToast();
  const utils = trpc.useUtils();

  const all = trpc.jobs.list.useQuery({}, { enabled: tab === "queue" });
  const dead = trpc.jobs.listDead.useQuery({}, { enabled: tab === "dead" });
  const jobs = all.data?.jobs ?? [];
  const deadJobs = dead.data?.jobs ?? [];
  const queuedCount = jobs.filter((job) => job.status === "queued").length;
  const runningCount = jobs.filter(
    (job) => job.status === "running" || job.status === "claimed",
  ).length;
  const completedCount = jobs.filter((job) => job.status === "completed").length;
  const failedCount = jobs.filter(
    (job) => job.status === "failed" || job.status === "cancelled",
  ).length;

  const retry = trpc.jobs.retryDead.useMutation({
    onSuccess() {
      toast.push({ title: "Job recolocado na fila", variant: "success" });
      void utils.jobs.listDead.invalidate();
    },
    onError(err) {
      toast.push({ title: "Falha ao recolocar", description: err.message, variant: "danger" });
    },
  });

  const cleanup = trpc.jobs.cleanup.useMutation({
    onSuccess(data) {
      setCleanupConfirm("");
      toast.push({
        title: "Limpeza concluída",
        description: `${data.deleted} jobs concluídos removidos`,
        variant: "success",
      });
      void utils.jobs.list.invalidate();
    },
    onError(err) {
      toast.push({ title: "Falha na limpeza", description: err.message, variant: "danger" });
    },
  });

  function runCleanup() {
    cleanup.mutate({ olderThanDays: 30 });
  }

  return (
    <div className="flex min-h-[calc(100vh-6.5rem)] w-full max-w-none flex-col gap-4 pt-0">
      <Animate preset="rise-in">
        <header className="nuoma-workspace-header flex items-end justify-between gap-6">
          <div>
            <p className="nuoma-compat-kicker">Processador</p>
            <h1 className="nuoma-compat-display mt-2 text-3xl md:text-4xl">
              Jobs <span className="nuoma-gradient-text">em fila</span>.
            </h1>
            <p className="text-sm text-fg-muted mt-3 max-w-xl">
              Falhas críticas vão para DLQ; recoloque manualmente após resolver a causa.
            </p>
          </div>
          <ConfirmDangerAction
            buttonLabel={COPY.limparConcluidos30Dias}
            confirmText={CLEANUP_CONFIRM_TEXT}
            value={cleanupConfirm}
            onValueChange={setCleanupConfirm}
            onConfirm={runCleanup}
            loading={cleanup.isPending}
            description="Remove apenas jobs concluídos na janela operacional."
            testId="jobs-cleanup-confirm"
          />
        </header>
      </Animate>

      <Animate preset="rise-in" delaySeconds={0.1}>
        <section className="nuoma-jobs-board">
          <div className="nuoma-jobs-stats">
            <JobSignalCard
              icon={<Database className="h-4 w-4" />}
              label="Fila"
              value={jobs.length}
              detail={`${queuedCount} na fila`}
              tone="cyan"
            />
            <JobSignalCard
              icon={<Clock3 className="h-4 w-4" />}
              label="Em execução"
              value={runningCount}
              detail="em execução"
              tone="green"
            />
            <JobSignalCard
              icon={<CheckCircle2 className="h-4 w-4" />}
              label="Concluídos"
              value={completedCount}
              detail="janela atual"
              tone="green"
            />
            <JobSignalCard
              icon={<AlertTriangle className="h-4 w-4" />}
              label="Falhas"
              value={failedCount + deadJobs.length}
              detail={`${deadJobs.length} DLQ`}
              tone={failedCount + deadJobs.length > 0 ? "amber" : "green"}
            />
          </div>

          <div className="nuoma-jobs-layout">
            <Tabs value={tab} onValueChange={setTab} className="nuoma-jobs-main">
              <div className="nuoma-jobs-tabs-row">
                <TabsList>
                  <TabsTrigger value="queue">Fila</TabsTrigger>
                  <TabsTrigger value="dead">DLQ</TabsTrigger>
                </TabsList>
                <Badge variant={failedCount + deadJobs.length > 0 ? "warning" : "success"}>
                  {failedCount + deadJobs.length > 0 ? "atenção" : "saudável"}
                </Badge>
              </div>

              <TabsContent value="queue">
                <Card>
                  <CardHeader>
                    <CardTitle>Fila atual</CardTitle>
                    <CardDescription>
                      {all.data ? `${all.data.jobs.length} jobs` : "—"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {all.isLoading ? (
                      <LoadingState />
                    ) : all.error ? (
                      <ErrorState description={all.error.message} />
                    ) : !all.data || all.data.jobs.length === 0 ? (
                      <EmptyState description="Fila vazia." />
                    ) : (
                      <div
                        className="nuoma-jobs-table"
                        tabIndex={0}
                        aria-label="Tabela de jobs em fila"
                      >
                        <div className="nuoma-jobs-row is-head">
                          <span>ID</span>
                          <span>Tipo</span>
                          <span>Status</span>
                          <span>Criado</span>
                          <span>Ação</span>
                        </div>
                        {all.data.jobs.map((job) => (
                          <div key={job.id} className="nuoma-jobs-row">
                            <span className="font-mono text-fg-dim">#{job.id}</span>
                            <span className="truncate">{job.type}</span>
                            <span>
                              <Badge variant={statusVariant(job.status)}>
                                {jobStatusLabel(job.status)}
                              </Badge>
                            </span>
                            <span>
                              <TimeAgo date={job.createdAt} />
                            </span>
                            <span className="nuoma-jobs-row-action">
                              {job.status === "failed" || job.status === "cancelled"
                                ? "Revisar"
                                : "Monitorar"}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="dead">
                <Card>
                  <CardHeader>
                    <CardTitle>Falhas críticas (DLQ)</CardTitle>
                    <CardDescription>
                      {dead.data ? `${dead.data.jobs.length} jobs mortos` : "—"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {dead.isLoading ? (
                      <LoadingState />
                    ) : dead.error ? (
                      <ErrorState description={dead.error.message} />
                    ) : !dead.data || dead.data.jobs.length === 0 ? (
                      <EmptyState description="Nenhum job morto." />
                    ) : (
                      <div
                        className="nuoma-jobs-table"
                        tabIndex={0}
                        aria-label="Tabela de jobs mortos"
                      >
                        <div className="nuoma-jobs-row is-head">
                          <span>ID</span>
                          <span>Tipo</span>
                          <span>Erro</span>
                          <span>Criado</span>
                          <span>Ação</span>
                        </div>
                        {dead.data.jobs.map((job) => (
                          <div key={job.id} className="nuoma-jobs-row">
                            <span className="font-mono text-fg-dim">#{job.id}</span>
                            <span className="truncate">{job.type}</span>
                            <span className="truncate text-fg-dim">{job.lastError}</span>
                            <span>
                              <TimeAgo date={job.createdAt} />
                            </span>
                            <span>
                              <Button
                                size="xs"
                                variant="soft"
                                loading={retry.isPending && retry.variables?.deadJobId === job.id}
                                onClick={() => retry.mutate({ deadJobId: job.id })}
                              >
                                Recolocar
                              </Button>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>

            <aside className="nuoma-jobs-side">
              <section>
                <h2>Prontidão da fila</h2>
                <div className="nuoma-jobs-gates">
                  <span>
                    <ShieldCheck className="h-4 w-4" /> Agendador <b>OK</b>
                  </span>
                  <span>
                    <Clock3 className="h-4 w-4" /> Backlog <b>{queuedCount}</b>
                  </span>
                  <span>
                    <AlertTriangle className="h-4 w-4" /> DLQ <b>{deadJobs.length}</b>
                  </span>
                </div>
              </section>
              <section>
                <h2>Ações recomendadas</h2>
                <div className="grid gap-2">
                  <span className="inline-flex items-center gap-2 text-sm text-fg-muted">
                    <Trash2 className="h-4 w-4" />
                    {COPY.limparConcluidos30Dias}
                  </span>
                  <ConfirmDangerAction
                    buttonLabel="Limpar"
                    confirmText={CLEANUP_CONFIRM_TEXT}
                    value={cleanupConfirm}
                    onValueChange={setCleanupConfirm}
                    onConfirm={runCleanup}
                    loading={cleanup.isPending}
                  />
                </div>
                <button type="button" onClick={() => setTab("dead")}>
                  <RotateCcw className="h-4 w-4" />
                  Revisar DLQ
                </button>
              </section>
              <section>
                <h2>Linha operacional</h2>
                <div className="nuoma-jobs-timeline">
                  <span className="is-done">Recebido</span>
                  <span className={runningCount > 0 ? "is-done" : undefined}>Reserva</span>
                  <span className={completedCount > 0 ? "is-done" : undefined}>Execução</span>
                  <span className={deadJobs.length === 0 ? "is-done" : "is-alert"}>DLQ</span>
                </div>
              </section>
            </aside>
          </div>
        </section>
      </Animate>
    </div>
  );
}

function JobSignalCard({
  icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  detail: string;
  tone: "cyan" | "green" | "amber";
}) {
  return (
    <div className="nuoma-jobs-stat" data-tone={tone}>
      <span>{icon}</span>
      <em>{label}</em>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function statusVariant(status: string): "neutral" | "info" | "success" | "warning" | "danger" {
  if (status === "completed") return "success";
  if (status === "failed" || status === "cancelled") return "danger";
  if (status === "claimed" || status === "running") return "info";
  return "neutral";
}

function jobStatusLabel(status: string): string {
  if (status === "queued") return "na fila";
  if (status === "claimed") return "reservado";
  if (status === "running") return "em execução";
  if (status === "completed") return "concluído";
  if (status === "failed") return "com falha";
  if (status === "cancelled") return "cancelado";
  return status;
}
