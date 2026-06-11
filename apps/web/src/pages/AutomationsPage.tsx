import {
  Animate,
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  useToast,
} from "@nuoma/ui";
import {
  Activity,
  FlaskConical,
  Layers3,
  Radio,
  ShieldCheck,
  ToggleRight,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";

import { validateAutomationManualTrigger } from "../automations/manual-trigger-validation.js";
import { AutomationFlowBuilder } from "../flow-builder/FlowBuilder.js";
import { trpc } from "../lib/trpc.js";

export function AutomationsPage() {
  const automations = trpc.automations.list.useQuery();
  const utils = trpc.useUtils();
  const intent = usePageIntent();
  const toast = useToast();
  const [automationId, setAutomationId] = useState("");
  const [phone, setPhone] = useState("");
  const [manualTriggerAttempted, setManualTriggerAttempted] = useState(false);
  const manualTriggerValidation = useMemo(
    () => validateAutomationManualTrigger({ automationId, phone }),
    [automationId, phone],
  );
  const showAutomationIdError =
    manualTriggerAttempted && Boolean(manualTriggerValidation.errors.automationId);
  const showPhoneError = manualTriggerAttempted && Boolean(manualTriggerValidation.errors.phone);
  const trigger = trpc.automations.trigger.useMutation({
    onSuccess(result) {
      toast.push({
        title: "Teste calculado",
        description: result.wouldEnqueueJobs
          ? "A automação geraria job em execução real."
          : "Nenhum job seria criado.",
        variant: "info",
      });
    },
    onError(error) {
      toast.push({ title: "Falha no teste", description: error.message, variant: "danger" });
    },
  });
  const updateAutomation = trpc.automations.update.useMutation({
    async onSuccess(result) {
      await utils.automations.list.invalidate();
      const enabled = isOverlayEnabled(result.automation?.metadata ?? {});
      toast.push({
        title: enabled ? "Overlay liberado" : "Overlay removido",
        description: result.automation
          ? `${result.automation.name}: overlay ${enabled ? "sim" : "não"}.`
          : "Automação atualizada.",
        variant: enabled ? "success" : "info",
      });
    },
    onError(error) {
      toast.push({
        title: "Falha ao atualizar overlay",
        description: error.message,
        variant: "danger",
      });
    },
  });

  function runDryTrigger() {
    setManualTriggerAttempted(true);
    if (
      !manualTriggerValidation.valid ||
      !manualTriggerValidation.automationId ||
      !manualTriggerValidation.phone
    ) {
      toast.push({ title: "Corrija os campos destacados", variant: "warning" });
      return;
    }
    trigger.mutate({
      id: manualTriggerValidation.automationId,
      phone: manualTriggerValidation.phone,
      dryRun: true,
      allowedPhone: manualTriggerValidation.phone,
    });
  }

  function toggleAutomationOverlay(
    automation: NonNullable<typeof automations.data>["automations"][number],
  ) {
    const enabled = !isOverlayEnabled(automation.metadata);
    updateAutomation.mutate({
      id: automation.id,
      metadata: {
        ...automation.metadata,
        overlayEnabled: enabled,
      },
    });
  }

  const automationList = automations.data?.automations ?? [];
  const activeCount = automationList.filter((automation) => automation.status === "active").length;
  const overlayCount = automationList.filter((automation) =>
    isOverlayEnabled(automation.metadata),
  ).length;

  return (
    <div className="flex min-h-[calc(100vh-6.5rem)] w-full max-w-none flex-col gap-4 pt-0">
      <Animate preset="rise-in">
        <header className="nuoma-workspace-header">
          <p className="nuoma-compat-kicker">Automações</p>
          <h1 className="nuoma-compat-display mt-2 text-3xl md:text-4xl">
            <span className="nuoma-gradient-text">Triggers</span> reativos.
          </h1>
          <p className="text-sm text-fg-muted mt-3 max-w-xl">
            Reage a eventos: msg recebida, campanha completa, tag aplicada/removida.
          </p>
        </header>
      </Animate>

      <Animate preset="rise-in" delaySeconds={0.1}>
        <section className="nuoma-automation-v2">
          <aside className="nuoma-automation-rail">
            <section className={intent === "trigger" ? "is-focused" : undefined}>
              <div className="nuoma-ops-panel-head">
                <div>
                  <h2>Teste manual seguro</h2>
                  <p>Dry-run, sem job e sem envio.</p>
                </div>
                <span className="nuoma-automation-icon">
                  <FlaskConical className="h-4 w-4" />
                </span>
              </div>
              <div className="nuoma-automation-probe">
                <Field
                  label="ID automação"
                  error={showAutomationIdError ? manualTriggerValidation.errors.automationId : null}
                >
                  <Input
                    placeholder="ID automação"
                    inputMode="numeric"
                    value={automationId}
                    invalid={showAutomationIdError}
                    aria-invalid={showAutomationIdError}
                    onChange={(event) => setAutomationId(event.target.value)}
                  />
                </Field>
                <Field
                  label="Telefone"
                  error={showPhoneError ? manualTriggerValidation.errors.phone : null}
                >
                  <Input
                    placeholder="Telefone"
                    inputMode="tel"
                    value={phone}
                    invalid={showPhoneError}
                    aria-invalid={showPhoneError}
                    onChange={(event) => setPhone(event.target.value)}
                  />
                </Field>
                <Button
                  className="nuoma-automation-primary"
                  loading={trigger.isPending}
                  leftIcon={<Zap className="h-4 w-4" />}
                  onClick={runDryTrigger}
                >
                  Testar
                </Button>
              </div>
            </section>

            <section>
              <div className="nuoma-ops-panel-head">
                <div>
                  <h2>Operação</h2>
                  <p>Resumo dos gatilhos em produção.</p>
                </div>
                <span className="nuoma-automation-icon is-green">
                  <Activity className="h-4 w-4" />
                </span>
              </div>
              <div className="nuoma-automation-metrics">
                <div>
                  <span>Total</span>
                  <strong>{automations.data ? automationList.length : "—"}</strong>
                </div>
                <div>
                  <span>Ativas</span>
                  <strong>{automations.data ? activeCount : "—"}</strong>
                </div>
                <div>
                  <span>Overlay</span>
                  <strong>{automations.data ? overlayCount : "—"}</strong>
                </div>
              </div>
            </section>

            <section>
              <div className="nuoma-ops-panel-head">
                <div>
                  <h2>Guardrails</h2>
                  <p>O disparo manual continua bloqueado por allowlist.</p>
                </div>
              </div>
              <div className="nuoma-automation-gates">
                <span>
                  <ShieldCheck className="h-4 w-4" /> Dry-run <b>on</b>
                </span>
                <span>
                  <Radio className="h-4 w-4" /> Canal <b>WA</b>
                </span>
                <span>
                  <ToggleRight className="h-4 w-4" /> Overlay <b>{overlayCount}</b>
                </span>
              </div>
            </section>
          </aside>

          <main className="nuoma-automation-stage">
            <AutomationFlowBuilder />
          </main>

          <aside className="nuoma-automation-inspector">
            <section>
              <div className="nuoma-ops-panel-head">
                <div>
                  <h2>Existentes</h2>
                  <p>{automations.data ? `${automationList.length} automações` : "Carregando"}</p>
                </div>
                <span className="nuoma-automation-icon">
                  <Layers3 className="h-4 w-4" />
                </span>
              </div>
              {automations.isLoading ? (
                <LoadingState />
              ) : automations.error ? (
                <ErrorState description={automations.error.message} />
              ) : automationList.length === 0 ? (
                <EmptyState description="Nenhuma automação ainda." />
              ) : (
                <ul className="nuoma-automation-list">
                  {automationList.map((a) => (
                    <li key={a.id}>
                      <div className="min-w-0">
                        <strong>{a.name}</strong>
                        <span>{a.category}</span>
                      </div>
                      <div>
                        <Badge variant={isOverlayEnabled(a.metadata) ? "success" : "neutral"}>
                          overlay {isOverlayEnabled(a.metadata) ? "sim" : "não"}
                        </Badge>
                        <Badge variant={a.status === "active" ? "success" : "neutral"}>
                          {a.status}
                        </Badge>
                        <Button
                          variant={isOverlayEnabled(a.metadata) ? "soft" : "accent"}
                          size="xs"
                          data-testid="automation-overlay-toggle"
                          data-automation-id={a.id}
                          loading={
                            updateAutomation.isPending && updateAutomation.variables?.id === a.id
                          }
                          onClick={() => toggleAutomationOverlay(a)}
                        >
                          Overlay {isOverlayEnabled(a.metadata) ? "não" : "sim"}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </aside>
        </section>
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

function isOverlayEnabled(metadata: Record<string, unknown>): boolean {
  return metadata.overlayEnabled === true;
}
