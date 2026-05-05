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
  Input,
  LoadingState,
  useToast,
} from "@nuoma/ui";
import { useMemo, useState } from "react";

import { AutomationFlowBuilder } from "../flow-builder/FlowBuilder.js";
import { trpc } from "../lib/trpc.js";

export function AutomationsPage() {
  const automations = trpc.automations.list.useQuery();
  const intent = usePageIntent();
  const toast = useToast();
  const [automationId, setAutomationId] = useState("");
  const [phone, setPhone] = useState("5531982066263");
  const trigger = trpc.automations.trigger.useMutation({
    onSuccess(result) {
      toast.push({
        title: "Teste calculado",
        description: result.wouldEnqueueJobs ? "A automação geraria job em execução real." : "Nenhum job seria criado.",
        variant: "info",
      });
    },
    onError(error) {
      toast.push({ title: "Falha no teste", description: error.message, variant: "danger" });
    },
  });

  function runDryTrigger() {
    const id = Number(automationId);
    if (!Number.isInteger(id) || id <= 0) {
      toast.push({ title: "Informe o ID da automação", variant: "warning" });
      return;
    }
    trigger.mutate({
      id,
      phone: phone.replace(/\D/g, ""),
      dryRun: true,
      allowedPhone: "5531982066263",
    });
  }

  return (
    <div className="flex flex-col gap-7 max-w-5xl mx-auto pt-2">
      <Animate preset="rise-in">
        <header>
          <p className="text-[0.65rem] uppercase tracking-[0.25em] text-fg-dim font-mono">
            Automações
          </p>
          <h1 className="font-serif italic text-5xl md:text-6xl leading-[1] mt-2 tracking-tight">
            <span className="text-brand-cyan">Triggers</span> reativos.
          </h1>
          <p className="text-sm text-fg-muted mt-3 max-w-xl">
            Reage a eventos: msg recebida, campanha completa, tag aplicada/removida.
          </p>
        </header>
      </Animate>

      {intent === "trigger" && (
        <Animate preset="rise-in" delaySeconds={0.08}>
          <Card>
            <CardHeader>
              <CardTitle>Teste manual seguro</CardTitle>
              <CardDescription>
                Dry-run de automação; não cria job e não envia mensagem.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-[10rem_1fr_auto]">
              <Input
                placeholder="ID automação"
                inputMode="numeric"
                value={automationId}
                onChange={(event) => setAutomationId(event.target.value)}
              />
              <Input
                placeholder="Telefone"
                inputMode="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
              <Button loading={trigger.isPending} onClick={runDryTrigger}>
                Testar
              </Button>
            </CardContent>
          </Card>
        </Animate>
      )}

      <Animate preset="rise-in" delaySeconds={0.1}>
        <AutomationFlowBuilder />
      </Animate>

      <Animate preset="rise-in" delaySeconds={0.1}>
        <Card>
          <CardHeader>
            <CardTitle>Existentes</CardTitle>
            <CardDescription>
              {automations.data ? `${automations.data.automations.length} automações` : "—"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {automations.isLoading ? (
              <LoadingState />
            ) : automations.error ? (
              <ErrorState description={automations.error.message} />
            ) : !automations.data || automations.data.automations.length === 0 ? (
              <EmptyState description="Nenhuma automação ainda." />
            ) : (
              <ul className="flex flex-col gap-1">
                {automations.data.automations.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg hover:bg-bg-base hover:shadow-flat transition-shadow"
                  >
                    <div className="min-w-0">
                      <div className="text-sm truncate">{a.name}</div>
                      <div className="text-xs text-fg-dim font-mono">{a.category}</div>
                    </div>
                    <Badge variant={a.status === "active" ? "success" : "neutral"}>
                      {a.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </Animate>
    </div>
  );
}

function usePageIntent() {
  return useMemo(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("intent");
  }, []);
}
