import type { AutomationStatus } from "@nuoma/contracts";
import { useNavigate } from "@tanstack/react-router";
import { FlaskConical, Layers, Plus, Search, SquarePen, Zap } from "lucide-react";
import { useMemo, useState } from "react";

import {
  Badge,
  Button,
  ChannelIcon,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Skeleton,
  TimeAgo,
  cn,
  useToast,
} from "@nuoma/ui";

import { validateAutomationManualTrigger } from "../../automations/manual-trigger-validation.js";
import type { RouterOutput } from "../../lib/api-types.js";
import { trpc } from "../../lib/trpc.js";
import { triggerIcon, triggerLabel } from "../flow-builder/config/action-registry.js";
import { DEFAULT_WHATSAPP_TEST_PHONE } from "../flow-builder/config/test-identities.js";
import { automationStatusLabel, automationStatusVariant } from "../shared/status.js";

type AutomationListItem = RouterOutput["automations"]["list"]["automations"][number];

const STATUS_FILTERS: Array<{ value: AutomationStatus | "all"; label: string }> = [
  { value: "all", label: "Todas" },
  { value: "active", label: "Ativas" },
  { value: "draft", label: "Rascunho" },
  { value: "paused", label: "Pausadas" },
];

export function AutomationsScreen() {
  const navigate = useNavigate();
  const automations = trpc.automations.list.useQuery();
  const list = useMemo(() => automations.data?.automations ?? [], [automations.data?.automations]);

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<AutomationStatus | "all">("all");

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return list.filter((automation) => {
      if (statusFilter !== "all" && automation.status !== statusFilter) return false;
      if (
        term &&
        !automation.name.toLowerCase().includes(term) &&
        !automation.category.toLowerCase().includes(term)
      ) {
        return false;
      }
      return true;
    });
  }, [list, query, statusFilter]);

  const kpis = useMemo(
    () => ({
      total: list.length,
      active: list.filter((automation) => automation.status === "active").length,
      drafts: list.filter((automation) => automation.status === "draft").length,
    }),
    [list],
  );

  return (
    <div className="flex w-full max-w-none flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-accent">
            Automações
          </p>
          <h1 className="mt-1.5 font-display text-2xl font-semibold text-ink-strong md:text-3xl">
            Reações a eventos
          </h1>
          <p className="mt-1.5 max-w-xl text-sm leading-6 text-ink-soft">
            Mensagem recebida, campanha concluída, tag aplicada ou removida — cada gatilho roda um
            fluxo de ações.
          </p>
        </div>
        <Button
          variant="primary"
          leftIcon={<Plus className="h-4 w-4" />}
          onClick={() => navigate({ to: "/automations/new" })}
          data-testid="automations-new"
        >
          Criar automação
        </Button>
      </header>

      <div className="grid gap-4 xl:grid-cols-[1fr_20rem]">
        <section className="space-y-4">
          {automations.data ? (
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Total", value: kpis.total },
                { label: "Ativas", value: kpis.active },
                { label: "Rascunhos", value: kpis.drafts },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-xl border border-line-hairline bg-surface-1 px-4 py-3"
                >
                  <p className="text-[0.65rem] font-medium uppercase tracking-[0.14em] text-ink-faint">
                    {item.label}
                  </p>
                  <p className="mt-1 font-display text-xl font-semibold tabular-nums text-ink-strong">
                    {item.value}
                  </p>
                </div>
              ))}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[14rem] flex-1 md:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar por nome ou categoria…"
                className="h-9 pl-9 text-xs"
              />
            </div>
            <div className="flex items-center gap-1">
              {STATUS_FILTERS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setStatusFilter(option.value)}
                  className={cn(
                    "rounded-md px-2.5 py-1.5 text-[0.7rem] font-medium transition-colors duration-150",
                    statusFilter === option.value
                      ? "bg-accent/15 text-accent"
                      : "text-ink-soft hover:bg-ink-strong/[0.06] hover:text-ink-strong",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {automations.isLoading ? (
            <div className="grid gap-3 md:grid-cols-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-40 rounded-xl" />
              ))}
            </div>
          ) : automations.error ? (
            <ErrorState
              title="Falha ao carregar automações"
              description={automations.error.message}
              action={
                <Button variant="secondary" size="sm" onClick={() => automations.refetch()}>
                  Tentar de novo
                </Button>
              }
            />
          ) : filtered.length === 0 ? (
            list.length === 0 ? (
              <EmptyState
                title="Nenhuma automação ainda"
                description="Crie a primeira reação automática — boas-vindas, follow-up, handoff."
                action={
                  <Button
                    variant="primary"
                    size="sm"
                    leftIcon={<Plus className="h-4 w-4" />}
                    onClick={() => navigate({ to: "/automations/new" })}
                  >
                    Criar automação
                  </Button>
                }
              />
            ) : (
              <EmptyState
                title="Nada com esses filtros"
                description="Ajuste a busca ou o filtro de status."
              />
            )
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {filtered.map((automation) => (
                <AutomationCard
                  key={automation.id}
                  automation={automation}
                  onEdit={() =>
                    navigate({
                      to: "/automations/$automationId/edit",
                      params: { automationId: String(automation.id) },
                    })
                  }
                />
              ))}
            </div>
          )}
        </section>

        <ManualTestRail />
      </div>
    </div>
  );
}

function AutomationCard({
  automation,
  onEdit,
}: {
  automation: AutomationListItem;
  onEdit: () => void;
}) {
  const TriggerIcon = triggerIcon[automation.trigger.type];
  const channel = automation.trigger.channel;
  return (
    <article
      data-testid="automation-card"
      data-automation-id={automation.id}
      className={cn(
        "group flex flex-col rounded-xl border border-line-hairline bg-surface-2 p-4",
        "shadow-flat transition-[border-color,box-shadow,transform] duration-150",
        "hover:-translate-y-0.5 hover:border-line-strong hover:shadow-raised",
      )}
    >
      <header className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/12 text-accent">
          <TriggerIcon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-display text-sm font-semibold text-ink-strong">
            {automation.name}
          </h3>
          <p className="mt-0.5 font-mono text-[0.62rem] uppercase tracking-[0.14em] text-ink-soft">
            #{automation.id} · {automation.category}
          </p>
        </div>
        <Badge variant={automationStatusVariant(automation.status)}>
          {automationStatusLabel(automation.status)}
        </Badge>
      </header>

      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[0.68rem] text-ink-soft">
        <span className="flex items-center gap-1 rounded-md bg-ink-strong/[0.05] px-1.5 py-0.5">
          <Zap className="h-3 w-3" />
          {triggerLabel(automation.trigger.type)}
        </span>
        {channel && channel !== "system" ? (
          <span className="flex items-center gap-1 rounded-md bg-ink-strong/[0.05] px-1.5 py-0.5">
            <ChannelIcon channel={channel} className="h-3 w-3" />
            {channel === "whatsapp" ? "WhatsApp" : "Instagram"}
          </span>
        ) : (
          <span className="rounded-md bg-ink-strong/[0.05] px-1.5 py-0.5">qualquer canal</span>
        )}
        <span className="flex items-center gap-1 rounded-md bg-ink-strong/[0.05] px-1.5 py-0.5">
          <Layers className="h-3 w-3" />
          {automation.actions.length === 1 ? "1 ação" : `${automation.actions.length} ações`}
        </span>
        <span className="ml-auto text-ink-faint">
          <TimeAgo date={automation.updatedAt} />
        </span>
      </div>

      <footer className="mt-4 flex items-center gap-2 border-t border-line-hairline pt-3">
        <Button
          variant="secondary"
          size="xs"
          leftIcon={<SquarePen className="h-3.5 w-3.5" />}
          onClick={onEdit}
          data-testid="automation-card-edit"
        >
          Abrir no builder
        </Button>
      </footer>
    </article>
  );
}

function ManualTestRail() {
  const toast = useToast();
  const [automationId, setAutomationId] = useState("");
  const [phone, setPhone] = useState(DEFAULT_WHATSAPP_TEST_PHONE);
  const [attempted, setAttempted] = useState(false);

  const validation = useMemo(
    () => validateAutomationManualTrigger({ automationId, phone }),
    [automationId, phone],
  );
  const showIdError = attempted && Boolean(validation.errors.automationId);
  const showPhoneError = attempted && Boolean(validation.errors.phone);

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

  const runDryTrigger = () => {
    setAttempted(true);
    if (!validation.valid || !validation.automationId || !validation.phone) {
      toast.push({ title: "Corrija os campos destacados", variant: "warning" });
      return;
    }
    trigger.mutate({
      id: validation.automationId,
      phone: validation.phone,
      dryRun: true,
      allowedPhone: validation.phone,
    });
  };

  return (
    <aside className="h-fit rounded-xl border border-line-hairline bg-surface-1 p-4">
      <header className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-status-info/12 text-status-info">
          <FlaskConical className="h-4 w-4" />
        </span>
        <div>
          <h2 className="font-display text-sm font-semibold text-ink-strong">
            Teste manual seguro
          </h2>
          <p className="text-[0.68rem] text-ink-soft">Simulação — sem job, sem envio.</p>
        </div>
      </header>
      <div className="mt-4 grid gap-3">
        <Field label="ID da automação" error={showIdError ? validation.errors.automationId : null}>
          <Input
            placeholder="ex.: 3"
            inputMode="numeric"
            monospace
            value={automationId}
            invalid={showIdError}
            onChange={(event) => setAutomationId(event.target.value)}
            className="h-9 text-xs"
          />
        </Field>
        <Field
          label="Telefone de teste"
          description="Padrão do produto."
          error={showPhoneError ? validation.errors.phone : null}
        >
          <Input
            inputMode="tel"
            monospace
            value={phone}
            aria-label="Telefone de teste da automação"
            invalid={showPhoneError}
            onChange={(event) => setPhone(event.target.value)}
            className="h-9 text-xs"
          />
        </Field>
        <Button
          size="sm"
          variant="secondary"
          loading={trigger.isPending}
          leftIcon={<Zap className="h-4 w-4" />}
          onClick={runDryTrigger}
        >
          Testar (dry-run)
        </Button>
      </div>
    </aside>
  );
}
