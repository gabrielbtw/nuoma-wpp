import {
  CalendarClock,
  CheckCheck,
  CircleAlert,
  Infinity as InfinityIcon,
  Users,
} from "lucide-react";
import { useMemo } from "react";

import { ChannelIcon, Field, Input, SegmentedControl, Switch, cn } from "@nuoma/ui";

import { buildSteps } from "../../../flow-builder/lib/build-steps.js";
import { readyChecks } from "../../../flow-builder/lib/validation.js";
import type { CampaignBuilderState } from "../state/campaign-store.js";
import { SegmentEditor } from "./fields/SegmentEditor.js";

export interface CampaignFlowSettingsProps {
  state: CampaignBuilderState;
  onPatch: (
    patch: Partial<
      Pick<
        CampaignBuilderState,
        | "name"
        | "channel"
        | "evergreen"
        | "startsAt"
        | "segmentEnabled"
        | "segmentOperator"
        | "segments"
      >
    >,
  ) => void;
}

export function CampaignFlowSettings({ state, onPatch }: CampaignFlowSettingsProps) {
  const checks = useMemo(() => {
    const built = buildSteps(state.steps);
    return readyChecks({
      name: state.name,
      previewSteps: typeof built === "string" ? [] : built,
      stepBuildError: typeof built === "string" ? built : null,
      channel: state.channel,
      steps: state.steps,
      csvPreview: null,
      abEnabled: false,
      abTargetStep: null,
    }).filter((check) => check.label !== "CSV" && check.label !== "A/B");
  }, [state.channel, state.name, state.steps]);
  const scheduleMode = state.evergreen ? "evergreen" : state.startsAt ? "scheduled" : "manual";
  const segmentSummary = state.segmentEnabled
    ? `${state.segments.length} ${state.segments.length === 1 ? "regra" : "regras"} em ${
        state.segmentOperator === "and" ? "E" : "OU"
      }`
    : "Todos os contatos elegíveis";

  return (
    <div className="grid gap-3">
      <section className="rounded-lg border border-line-hairline bg-surface-1/70 p-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-ink-faint">
            Essenciais
          </p>
          <span className="rounded-md bg-accent/10 px-2 py-1 text-[0.65rem] font-medium text-accent">
            {state.channel === "whatsapp" ? "WhatsApp" : "Instagram"}
          </span>
        </div>
        <div className="grid gap-3">
          <Field label="Nome" labelClassName="tracking-[0.14em]">
            <Input
              value={state.name}
              onChange={(event) => onPatch({ name: event.target.value })}
              placeholder="Remarketing junho"
              className="h-10"
            />
          </Field>

          <Field label="Canal" labelClassName="tracking-[0.14em]">
            <SegmentedControl
              size="sm"
              aria-label="Canal da campanha"
              value={state.channel}
              className="w-full"
              onValueChange={(value) =>
                onPatch({ channel: value as CampaignBuilderState["channel"] })
              }
              options={[
                {
                  value: "whatsapp",
                  label: "WhatsApp",
                  icon: <ChannelIcon channel="whatsapp" className="h-3.5 w-3.5" />,
                },
                {
                  value: "instagram",
                  label: "Instagram",
                  icon: <ChannelIcon channel="instagram" className="h-3.5 w-3.5" />,
                },
              ]}
            />
          </Field>
        </div>
      </section>

      <section className="rounded-lg border border-line-hairline bg-surface-1/70 p-3">
        <div className="mb-2.5 flex items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-ink-faint">
              Envio
            </p>
            <p className="mt-0.5 text-[0.68rem] leading-4 text-ink-faint">
              Escolha se entra continuamente ou fica manual/agendado.
            </p>
          </div>
          <span className="rounded-md bg-ink-strong/[0.06] px-2 py-1 text-[0.65rem] text-ink-soft">
            {scheduleMode === "evergreen"
              ? "Contínua"
              : scheduleMode === "scheduled"
                ? "Agendada"
                : "Manual"}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Modo de envio">
          <button
            type="button"
            role="radio"
            aria-checked={state.evergreen}
            onClick={() => onPatch({ evergreen: true, startsAt: "" })}
            className={cn(
              "min-h-[5.7rem] rounded-lg border p-3 text-left transition-colors",
              state.evergreen
                ? "border-accent bg-accent/10 text-ink-strong"
                : "border-line-hairline bg-surface-2/70 text-ink-soft hover:border-line-soft hover:text-ink",
            )}
          >
            <span className="flex items-center gap-2 text-xs font-semibold text-ink-strong">
              <InfinityIcon className="h-4 w-4 text-accent" />
              Evergreen
            </span>
            <span className="mt-1.5 block text-[0.68rem] leading-4 text-ink-faint">
              Entra sempre que o público elegível aparecer.
            </span>
          </button>

          <button
            type="button"
            role="radio"
            aria-checked={!state.evergreen}
            onClick={() => onPatch({ evergreen: false })}
            className={cn(
              "min-h-[5.7rem] rounded-lg border p-3 text-left transition-colors",
              !state.evergreen
                ? "border-accent bg-accent/10 text-ink-strong"
                : "border-line-hairline bg-surface-2/70 text-ink-soft hover:border-line-soft hover:text-ink",
            )}
          >
            <span className="flex items-center gap-2 text-xs font-semibold text-ink-strong">
              <CalendarClock className="h-4 w-4 text-accent" />
              Manual
            </span>
            <span className="mt-1.5 block text-[0.68rem] leading-4 text-ink-faint">
              Salva rascunho e dispara pelo console protegido.
            </span>
          </button>
        </div>

        {!state.evergreen ? (
          <Field
            label="Agendar início"
            description="Opcional. Sem data, a campanha só dispara manualmente."
            className="mt-2.5"
            labelClassName="tracking-[0.14em]"
          >
            <Input
              type="datetime-local"
              value={state.startsAt}
              onChange={(event) => onPatch({ startsAt: event.target.value })}
              className="h-9"
            />
          </Field>
        ) : null}
      </section>

      <section className="rounded-lg border border-line-hairline bg-surface-1/70 p-3">
        <header className="mb-2.5 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-mono text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-ink-faint">
              <Users className="h-3.5 w-3.5 text-accent" />
              Audiência
            </p>
            <p className="mt-0.5 truncate text-[0.68rem] leading-4 text-ink-faint">
              {segmentSummary}
            </p>
          </div>
          <Switch
            checked={state.segmentEnabled}
            onCheckedChange={(checked) => onPatch({ segmentEnabled: checked })}
            aria-label="Ativar audiência segmentada"
          />
        </header>
        <SegmentEditor
          enabled={state.segmentEnabled}
          operator={state.segmentOperator}
          segments={state.segments}
          compact
          onPatch={onPatch}
        />
      </section>

      <section className="rounded-lg border border-line-hairline bg-surface-1/70 p-3">
        <p className="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-ink-faint">
          Prontidão
        </p>
        <ul className="mt-2.5 flex flex-wrap gap-1.5" data-testid="campaign-flow-checklist">
          {checks.map((check) => (
            <li
              key={check.label}
              data-testid="campaign-flow-validation-check"
              data-ok={check.ok}
              className={cn(
                "inline-flex min-h-7 items-center gap-1.5 rounded-md border px-2 py-1 text-[0.68rem]",
                check.ok
                  ? "border-status-ok/20 bg-status-ok/10 text-status-ok"
                  : "border-status-warn/30 bg-status-warn/10 text-status-warn",
              )}
            >
              {check.ok ? (
                <CheckCheck className="h-3.5 w-3.5" />
              ) : (
                <CircleAlert className="h-3.5 w-3.5" />
              )}
              {check.label}
            </li>
          ))}
        </ul>
      </section>

      {state.campaignId ? (
        <p className="font-mono text-[0.65rem] uppercase tracking-widest text-ink-faint">
          Campanha #{state.campaignId} · {state.status}
        </p>
      ) : null}
    </div>
  );
}
