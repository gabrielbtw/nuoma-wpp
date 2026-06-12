import type { ChannelType } from "@nuoma/contracts";
import { motion } from "framer-motion";
import { CircleAlert, Send, X } from "lucide-react";
import { useMemo, useState } from "react";

import { Button, Field, IconButton, Input, SegmentedControl, Switch, useToast } from "@nuoma/ui";

import { trpc } from "../../../lib/trpc.js";
import {
  DEFAULT_INSTAGRAM_TEST_HANDLE,
  DEFAULT_WHATSAPP_TEST_PHONE,
} from "../config/test-identities.js";
import { ChatSimulator } from "./ChatSimulator.js";
import type { SimEvent } from "./simulate.js";

export interface PreviewPanelProps {
  mode: "campaign" | "automation";
  /** campaign channel, or automation trigger channel ("" = any channel) */
  flowChannel: ChannelType | "";
  events: SimEvent[];
  savedId: number | null;
  dirty: boolean;
  onClose: () => void;
}

export function PreviewPanel({
  mode,
  flowChannel,
  events,
  savedId,
  dirty,
  onClose,
}: PreviewPanelProps) {
  const toast = useToast();
  const channelLocked = flowChannel === "whatsapp" || flowChannel === "instagram";
  const [channel, setChannel] = useState<ChannelType>(
    flowChannel === "instagram" ? "instagram" : "whatsapp",
  );
  const activeChannel = channelLocked ? (flowChannel as ChannelType) : channel;
  const [phone, setPhone] = useState(DEFAULT_WHATSAPP_TEST_PHONE);
  const [handle, setHandle] = useState(DEFAULT_INSTAGRAM_TEST_HANDLE);
  const [dryRun, setDryRun] = useState(true);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const executeCampaign = trpc.campaigns.execute.useMutation({
    onSuccess(result) {
      setLastResult(JSON.stringify(result, null, 2));
      toast.push({
        title: result.dryRun ? "Simulação no backend concluída" : "Teste real enfileirado",
        description: result.dryRun
          ? `${result.recipientsPlanned} destinatário(s) no plano.`
          : `${result.recipientsCreated} destinatário(s) criados.`,
        variant: "success",
      });
    },
    onError(error) {
      setLastResult(error.message);
      toast.push({ title: "Falha no teste", description: error.message, variant: "danger" });
    },
  });

  const triggerAutomation = trpc.automations.trigger.useMutation({
    onSuccess(result) {
      setLastResult(JSON.stringify(result, null, 2));
      toast.push({
        title: dryRun ? "Simulação no backend concluída" : "Teste real executado",
        description:
          "wouldEnqueueJobs" in result && result.wouldEnqueueJobs
            ? "A automação criaria jobs de envio."
            : "Nenhum job de envio seria criado.",
        variant: "info",
      });
    },
    onError(error) {
      setLastResult(error.message);
      toast.push({ title: "Falha no teste", description: error.message, variant: "danger" });
    },
  });

  const pending = executeCampaign.isPending || triggerAutomation.isPending;

  const backendBlockedReason = useMemo(() => {
    if (!savedId) {
      return mode === "campaign"
        ? "Salve a campanha antes de testar contra o backend."
        : "Salve a automação antes de testar contra o backend.";
    }
    if (activeChannel === "instagram") {
      return mode === "campaign"
        ? "O backend atual não aceita handle de Instagram neste teste. Use a simulação aqui e o console de Disparo quando houver allowlist de Instagram."
        : "Automações usam teste backend por telefone (WhatsApp). Para Instagram, use apenas a simulação.";
    }
    return null;
  }, [activeChannel, mode, savedId]);

  const canRun = Boolean(savedId) && !backendBlockedReason;

  const runTest = () => {
    if (!savedId) return;
    setLastResult(null);
    if (mode === "campaign") {
      executeCampaign.mutate({
        campaignId: savedId,
        dryRun,
        phones: activeChannel === "whatsapp" && phone.trim() ? [phone.trim()] : [],
        contactIds: [],
        allowedPhone: activeChannel === "whatsapp" && phone.trim() ? phone.trim() : undefined,
        maxRecipients: 1,
      });
      return;
    }
    triggerAutomation.mutate({
      id: savedId,
      phone: phone.trim() || undefined,
      dryRun,
      allowedPhone: phone.trim() || undefined,
    });
  };

  return (
    <motion.aside
      initial={{ x: 32, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 32, opacity: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="absolute inset-y-0 right-0 z-20 flex w-[400px] max-w-full flex-col border-l border-line-hairline bg-surface-1 shadow-lifted"
      data-testid="preview-panel"
    >
      <header className="flex items-center gap-3 border-b border-line-hairline px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-ink-faint">
            Prévia
          </p>
          <p className="font-display text-sm font-semibold text-ink-strong">Prévia da conversa</p>
        </div>
        <IconButton label="Fechar prévia" icon={<X className="h-4 w-4" />} onClick={onClose} />
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-4 pb-6 pt-4">
        {!channelLocked ? (
          <SegmentedControl
            size="sm"
            aria-label="Canal da prévia"
            value={activeChannel}
            onValueChange={(value) => setChannel(value as ChannelType)}
            options={[
              { value: "whatsapp", label: "WhatsApp" },
              { value: "instagram", label: "Instagram" },
            ]}
          />
        ) : null}

        {activeChannel === "whatsapp" ? (
          <Field label="Número de teste" description="Padrão do produto — destino permitido.">
            <Input
              value={phone}
              monospace
              inputMode="tel"
              onChange={(event) => setPhone(event.target.value)}
              className="h-9 text-xs"
            />
          </Field>
        ) : (
          <Field label="Usuário de teste" description="Padrão do produto — destino permitido.">
            <Input
              value={handle}
              monospace
              onChange={(event) => setHandle(event.target.value)}
              className="h-9 text-xs"
            />
          </Field>
        )}

        <div className="flex min-h-[260px] flex-1 flex-col">
          <ChatSimulator
            channel={activeChannel}
            identity={activeChannel === "whatsapp" ? phone : handle}
            events={events}
          />
        </div>

        <section className="rounded-lg border border-line-hairline bg-surface-2 p-3">
          <header className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-ink-soft">
                Testar fluxo
              </p>
              <p className="mt-0.5 text-[0.68rem] leading-4 text-ink-faint">
                {dryRun
                  ? "Dry-run: valida no backend sem enviar nada."
                  : "Envio REAL para o destino de teste."}
              </p>
            </div>
            <label className="flex items-center gap-2 text-[0.68rem] text-ink-soft">
              Dry-run
              <Switch checked={dryRun} onCheckedChange={setDryRun} aria-label="Dry-run" />
            </label>
          </header>

          {dirty && savedId ? (
            <p className="mt-2 flex items-start gap-1.5 text-[0.68rem] leading-4 text-status-warn">
              <CircleAlert className="mt-0.5 h-3 w-3 shrink-0" />
              Há alterações não salvas — o teste usa a última versão salva.
            </p>
          ) : null}
          {backendBlockedReason ? (
            <p className="mt-2 flex items-start gap-1.5 text-[0.68rem] leading-4 text-status-warn">
              <CircleAlert className="mt-0.5 h-3 w-3 shrink-0" />
              {backendBlockedReason}
            </p>
          ) : null}

          <Button
            className="mt-3 w-full"
            size="sm"
            variant={dryRun ? "secondary" : "primary"}
            loading={pending}
            disabled={!canRun}
            leftIcon={<Send className="h-3.5 w-3.5" />}
            onClick={runTest}
            data-testid="preview-run-test"
          >
            {dryRun ? "Testar fluxo (dry-run)" : "Testar fluxo de verdade"}
          </Button>

          {lastResult ? (
            <pre className="mt-3 max-h-44 overflow-auto rounded-md bg-surface-0 p-2.5 font-mono text-[0.62rem] leading-4 text-ink-soft">
              {lastResult}
            </pre>
          ) : null}
        </section>
      </div>
    </motion.aside>
  );
}
