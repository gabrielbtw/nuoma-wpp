import { useState } from "react";

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

import { trpc } from "../lib/trpc.js";

export function JobsPage() {
  const [tab, setTab] = useState("queue");
  const toast = useToast();
  const utils = trpc.useUtils();

  const all = trpc.jobs.list.useQuery({}, { enabled: tab === "queue" });
  const dead = trpc.jobs.listDead.useQuery({}, { enabled: tab === "dead" });

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
      toast.push({
        title: "Cleanup OK",
        description: `${data.deleted} jobs concluídos removidos`,
        variant: "success",
      });
      void utils.jobs.list.invalidate();
    },
    onError(err) {
      toast.push({ title: "Falha cleanup", description: err.message, variant: "danger" });
    },
  });

  return (
    <div className="flex flex-col gap-7 max-w-6xl mx-auto pt-2">
      <Animate preset="rise-in">
        <header className="flex items-end justify-between gap-6">
          <div>
            <p className="text-[0.65rem] uppercase tracking-[0.25em] text-fg-dim font-mono">
              Worker
            </p>
            <h1 className="font-serif italic text-5xl md:text-6xl leading-[1] mt-2 tracking-tight">
              Jobs <span className="text-brand-cyan">em fila</span>.
            </h1>
            <p className="text-sm text-fg-muted mt-3 max-w-xl">
              Mortos vão pra DLQ — recoloque manualmente após resolver causa.
            </p>
          </div>
          <Button
            variant="soft"
            size="sm"
            loading={cleanup.isPending}
            onClick={() => cleanup.mutate({ olderThanDays: 30 })}
          >
            Cleanup 30 dias
          </Button>
        </header>
      </Animate>

      <Animate preset="rise-in" delaySeconds={0.1}>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="queue">Fila</TabsTrigger>
            <TabsTrigger value="dead">DLQ</TabsTrigger>
          </TabsList>
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
                  <ul className="flex flex-col gap-1">
                    {all.data.jobs.map((job) => (
                      <li
                        key={job.id}
                        className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg hover:bg-bg-base hover:shadow-flat transition-shadow"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="font-mono text-xs text-fg-dim">#{job.id}</span>
                          <span className="text-sm">{job.type}</span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <Badge variant={statusVariant(job.status)}>{job.status}</Badge>
                          <TimeAgo date={job.scheduledAt} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="dead">
            <Card>
              <CardHeader>
                <CardTitle>Dead-letter queue</CardTitle>
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
                  <ul className="flex flex-col gap-1">
                    {dead.data.jobs.map((job) => (
                      <li
                        key={job.id}
                        className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg hover:bg-bg-base hover:shadow-flat transition-shadow"
                      >
                        <div className="min-w-0">
                          <div className="text-sm">
                            <span className="font-mono text-xs text-fg-dim mr-2">#{job.id}</span>
                            {job.type}
                          </div>
                          <div className="text-xs text-fg-dim mt-0.5 truncate max-w-md">
                            {job.lastError}
                          </div>
                        </div>
                        <Button
                          size="xs"
                          variant="soft"
                          loading={retry.isPending && retry.variables?.deadJobId === job.id}
                          onClick={() => retry.mutate({ deadJobId: job.id })}
                        >
                          Recolocar
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </Animate>
    </div>
  );
}

function statusVariant(
  status: string,
): "neutral" | "info" | "success" | "warning" | "danger" {
  if (status === "completed") return "success";
  if (status === "failed" || status === "cancelled") return "danger";
  if (status === "claimed" || status === "running") return "info";
  return "neutral";
}
