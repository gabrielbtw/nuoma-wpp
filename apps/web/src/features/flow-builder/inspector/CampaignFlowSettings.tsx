import type { ChannelType } from "@nuoma/contracts";
import {
  CalendarClock,
  CheckCheck,
  CircleAlert,
  Infinity as InfinityIcon,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
  Tag,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useMemo } from "react";

import { ChannelIcon, Field, Input, Switch, cn } from "@nuoma/ui";

import { buildSteps, type StepDraft } from "../../../flow-builder/lib/build-steps.js";
import type { SegmentDraft } from "../../../flow-builder/lib/segment.js";
import { readyChecks } from "../../../flow-builder/lib/validation.js";
import { stepRegistry } from "../config/step-registry.js";
import type { CampaignBuilderState } from "../state/campaign-store.js";
import { newSegmentDraft } from "../state/hydrate.js";
import { SegmentEditor } from "./fields/SegmentEditor.js";

export interface CampaignStarterDraft {
  name: string;
  channel: ChannelType;
  evergreen: boolean;
  startsAt: string;
  segmentEnabled: boolean;
  segmentOperator: "and" | "or";
  segments: SegmentDraft[];
  steps: StepDraft[];
}

interface CampaignStarter {
  key: string;
  title: string;
  description: string;
  channel: ChannelType;
  Icon: LucideIcon;
  createDraft: () => CampaignStarterDraft;
}

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
  onApplyStarter: (draft: CampaignStarterDraft) => void;
}

function textStep(order: number, label: string, template: string, delaySeconds = "0"): StepDraft {
  return { ...stepRegistry.text.createDraft(order), label, template, delaySeconds };
}

function linkStep(order: number, label: string, linkText: string, url: string): StepDraft {
  return { ...stepRegistry.link.createDraft(order), label, linkText, url };
}

const STARTERS: CampaignStarter[] = [
  {
    key: "reactivation-wa",
    title: "Reativação WhatsApp",
    description: "Mensagem inicial e retorno após 24h.",
    channel: "whatsapp",
    Icon: MessageSquareText,
    createDraft: () => ({
      name: "Reativação WhatsApp",
      channel: "whatsapp",
      evergreen: false,
      startsAt: "",
      segmentEnabled: false,
      segmentOperator: "and",
      segments: [newSegmentDraft()],
      steps: [
        textStep(
          1,
          "Mensagem de reativação",
          "Olá {{nome}}, tudo bem? Passando para retomar seu atendimento por aqui.",
        ),
        textStep(
          2,
          "Follow-up 24h",
          "Oi {{nome}}, consegui te ajudar com a próxima etapa?",
          "86400",
        ),
      ],
    }),
  },
  {
    key: "post-service-ig",
    title: "Pós-atendimento Instagram",
    description: "Follow-up curto para DM após conversa.",
    channel: "instagram",
    Icon: Tag,
    createDraft: () => ({
      name: "Pós-atendimento Instagram",
      channel: "instagram",
      evergreen: false,
      startsAt: "",
      segmentEnabled: false,
      segmentOperator: "and",
      segments: [newSegmentDraft()],
      steps: [
        textStep(
          1,
          "Agradecimento",
          "Oi {{nome}}, obrigado pelo contato. Ficou alguma dúvida sobre o atendimento?",
        ),
      ],
    }),
  },
  {
    key: "safe-rmkt",
    title: "Remarketing seguro",
    description: "Texto + link, sem mídia obrigatória.",
    channel: "whatsapp",
    Icon: ShieldCheck,
    createDraft: () => ({
      name: "Remarketing seguro",
      channel: "whatsapp",
      evergreen: false,
      startsAt: "",
      segmentEnabled: false,
      segmentOperator: "and",
      segments: [newSegmentDraft()],
      steps: [
        textStep(
          1,
          "Contexto",
          "Olá {{nome}}, se ainda fizer sentido, deixei uma opção rápida para você revisar.",
        ),
        linkStep(2, "Link de retorno", "Ver detalhes", "https://nuoma.com.br"),
      ],
    }),
  },
];

function channelLabel(channel: ChannelType) {
  return channel === "whatsapp" ? "WhatsApp" : "Instagram";
}

export function CampaignFlowSettings({
  state,
  onPatch,
  onApplyStarter,
}: CampaignFlowSettingsProps) {
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
  const readyCount = checks.filter((check) => check.ok).length;
  const problemCount = checks.length - readyCount;
  const segmentSummary = state.segmentEnabled
    ? `${state.segments.length} ${state.segments.length === 1 ? "regra" : "regras"} em ${
        state.segmentOperator === "and" ? "E" : "OU"
      }`
    : "Todos elegíveis";

  return (
    <div className="flex min-w-0 flex-col" data-testid="campaign-flow-settings">
      <section className="min-w-0 border-b border-line-hairline pb-3">
        <div className="mb-3 grid min-w-0 grid-cols-3 gap-1 text-[0.65rem]">
          <span className="inline-flex min-h-7 min-w-0 items-center justify-center gap-1 rounded-md bg-accent/10 px-1.5 font-medium text-accent">
            <Sparkles className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Rascunho</span>
          </span>
          <span className="inline-flex min-h-7 min-w-0 items-center justify-center rounded-md bg-ink-strong/[0.05] px-1.5 text-ink-soft">
            <span className="truncate">
              {scheduleMode === "evergreen"
                ? "Contínua"
                : scheduleMode === "scheduled"
                  ? "Agendada"
                  : "Manual"}
            </span>
          </span>
          <span
            className={cn(
              "inline-flex min-h-7 min-w-0 items-center justify-center rounded-md px-1.5",
              problemCount > 0
                ? "bg-status-warn/10 text-status-warn"
                : "bg-status-ok/10 text-status-ok",
            )}
          >
            <span className="truncate">
              {problemCount > 0 ? `${problemCount} pend.` : "Pronto"}
            </span>
          </span>
        </div>

        <Field label="Nome da campanha" labelClassName="tracking-[0.14em]">
          <Input
            value={state.name}
            onChange={(event) => onPatch({ name: event.target.value })}
            placeholder="Remarketing junho"
            className="h-9"
          />
        </Field>

        <div className="mt-3 grid min-w-0 grid-cols-2 gap-2" role="radiogroup" aria-label="Canal">
          {(["whatsapp", "instagram"] as const).map((channel) => {
            const active = state.channel === channel;
            return (
              <button
                key={channel}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onPatch({ channel })}
                className={cn(
                  "flex min-h-10 w-full items-center justify-center gap-2 rounded-md border px-3 text-xs font-medium transition-colors",
                  active
                    ? "border-accent bg-accent/10 text-ink-strong"
                    : "border-line-hairline bg-surface-2/60 text-ink-soft hover:border-line-soft hover:text-ink",
                )}
              >
                <ChannelIcon channel={channel} className="h-4 w-4" />
                {channelLabel(channel)}
              </button>
            );
          })}
        </div>
      </section>

      <section className="min-w-0 border-b border-line-hairline py-3">
        <header className="mb-2 flex items-center justify-between gap-3">
          <p className="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-ink-faint">
            Agenda
          </p>
          <span className="min-w-0 truncate rounded-md bg-ink-strong/[0.05] px-2 py-1 text-[0.65rem] text-ink-soft">
            {scheduleMode === "evergreen"
              ? "Entrada contínua"
              : scheduleMode === "scheduled"
                ? "Com data"
                : "Sem data"}
          </span>
        </header>

        <div className="grid grid-cols-1 gap-1.5">
          <button
            type="button"
            aria-pressed={state.evergreen}
            onClick={() => onPatch({ evergreen: true, startsAt: "" })}
            className={cn(
              "flex min-h-12 w-full items-center gap-2.5 rounded-md border px-2.5 text-left transition-colors",
              state.evergreen
                ? "border-accent bg-accent/10"
                : "border-line-hairline bg-surface-2/50 hover:border-line-soft",
            )}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent">
              <InfinityIcon className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-semibold text-ink-strong">
                Campanha evergreen
              </span>
              <span className="block truncate text-[0.68rem] text-ink-faint">
                Entra continuamente conforme público elegível.
              </span>
            </span>
            <span
              className={cn(
                "h-3.5 w-3.5 shrink-0 rounded-full border",
                state.evergreen ? "border-accent bg-accent" : "border-line-soft",
              )}
            />
          </button>

          <button
            type="button"
            aria-pressed={!state.evergreen}
            onClick={() => onPatch({ evergreen: false })}
            className={cn(
              "flex min-h-12 w-full items-center gap-2.5 rounded-md border px-2.5 text-left transition-colors",
              !state.evergreen
                ? "border-accent bg-accent/10"
                : "border-line-hairline bg-surface-2/50 hover:border-line-soft",
            )}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-ink-strong/[0.06] text-ink-soft">
              <CalendarClock className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-semibold text-ink-strong">
                Manual ou agendada
              </span>
              <span className="block truncate text-[0.68rem] text-ink-faint">
                Salva rascunho e dispara pelo console protegido.
              </span>
            </span>
            <span
              className={cn(
                "h-3.5 w-3.5 shrink-0 rounded-full border",
                !state.evergreen ? "border-accent bg-accent" : "border-line-soft",
              )}
            />
          </button>
        </div>

        {!state.evergreen ? (
          <Field
            label="Início"
            description="Opcional. Sem data, continua manual."
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

      {!state.campaignId ? (
        <section className="min-w-0 border-b border-line-hairline py-3">
          <header className="mb-2 flex items-center justify-between gap-3">
            <p className="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-ink-faint">
              Começar rápido
            </p>
            <span className="text-[0.65rem] text-ink-faint">aplica fluxo real</span>
          </header>
          <div className="grid grid-cols-1 gap-1.5">
            {STARTERS.map((starter) => {
              const Icon = starter.Icon;
              return (
                <button
                  key={starter.key}
                  type="button"
                  onClick={() => onApplyStarter(starter.createDraft())}
                  className="flex min-h-12 w-full min-w-0 items-center gap-2.5 rounded-md border border-line-hairline bg-surface-2/50 px-2.5 text-left transition-colors hover:border-accent/60 hover:bg-accent/10"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-ink-strong/[0.06] text-accent">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-ink-strong">
                      {starter.title}
                    </span>
                    <span className="block truncate text-[0.68rem] text-ink-faint">
                      {starter.description}
                    </span>
                  </span>
                  <span
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-ink-strong/[0.05] text-ink-soft"
                    title={channelLabel(starter.channel)}
                    aria-label={channelLabel(starter.channel)}
                  >
                    <ChannelIcon channel={starter.channel} className="h-3 w-3" />
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="min-w-0 border-b border-line-hairline py-3">
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

      <section className="min-w-0 pt-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-ink-faint">
            Prontidão
          </p>
          <span className="text-[0.65rem] text-ink-faint">
            {readyCount}/{checks.length}
          </span>
        </div>
        <ul className="grid grid-cols-2 gap-1.5" data-testid="campaign-flow-checklist">
          {checks.map((check) => (
            <li
              key={check.label}
              data-testid="campaign-flow-validation-check"
              data-ok={check.ok}
              className={cn(
                "inline-flex min-h-7 items-center gap-1.5 rounded-md border px-2 py-1 text-[0.66rem]",
                check.ok
                  ? "border-status-ok/20 bg-status-ok/10 text-status-ok"
                  : "border-status-warn/30 bg-status-warn/10 text-status-warn",
              )}
            >
              {check.ok ? (
                <CheckCheck className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <CircleAlert className="h-3.5 w-3.5 shrink-0" />
              )}
              <span className="truncate">{check.label}</span>
            </li>
          ))}
        </ul>
      </section>

      {state.campaignId ? (
        <p className="pt-3 font-mono text-[0.65rem] uppercase tracking-widest text-ink-faint">
          Campanha #{state.campaignId} · {state.status}
        </p>
      ) : null}
    </div>
  );
}
