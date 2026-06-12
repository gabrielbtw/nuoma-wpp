import {
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@nuoma/ui";

import { trpc } from "../../../lib/trpc.js";
import { triggerOptions } from "../config/action-registry.js";
import type { AutomationBuilderState } from "../state/automation-store.js";
import { SegmentEditor } from "./fields/SegmentEditor.js";
import { TagSelect } from "./fields/TagSelect.js";

const ANY_CHANNEL = "any";

export interface AutomationFlowSettingsProps {
  state: AutomationBuilderState;
  onPatch: (
    patch: Partial<
      Pick<
        AutomationBuilderState,
        | "name"
        | "category"
        | "triggerType"
        | "triggerChannel"
        | "triggerTagId"
        | "triggerCampaignId"
        | "requireWithin24hWindow"
        | "segmentEnabled"
        | "segmentOperator"
        | "segments"
      >
    >,
  ) => void;
}

export function AutomationFlowSettings({ state, onPatch }: AutomationFlowSettingsProps) {
  const campaigns = trpc.campaigns.list.useQuery(undefined, {
    enabled: state.triggerType === "campaign_completed",
  });
  const trigger = triggerOptions.find((option) => option.value === state.triggerType);

  return (
    <div className="grid gap-4">
      <Field label="Nome da automação">
        <Input
          value={state.name}
          onChange={(event) => onPatch({ name: event.target.value })}
          placeholder="Boas-vindas WhatsApp"
          className="h-10"
        />
      </Field>

      <Field label="Categoria" description="Agrupa automações na listagem.">
        <Input
          value={state.category}
          onChange={(event) => onPatch({ category: event.target.value })}
          placeholder="onboarding"
          className="h-10"
        />
      </Field>

      <Field label="Gatilho" description={trigger?.description}>
        <Select
          value={state.triggerType}
          onValueChange={(value) =>
            onPatch({ triggerType: value as AutomationBuilderState["triggerType"] })
          }
        >
          <SelectTrigger className="h-10" aria-label="Gatilho da automação">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {triggerOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Canal do gatilho">
        <Select
          value={state.triggerChannel || ANY_CHANNEL}
          onValueChange={(value) =>
            onPatch({
              triggerChannel:
                value === ANY_CHANNEL ? "" : (value as AutomationBuilderState["triggerChannel"]),
            })
          }
        >
          <SelectTrigger className="h-10" aria-label="Canal do gatilho">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY_CHANNEL}>Qualquer canal</SelectItem>
            <SelectItem value="whatsapp">WhatsApp</SelectItem>
            <SelectItem value="instagram">Instagram</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      {state.triggerType === "tag_applied" || state.triggerType === "tag_removed" ? (
        <TagSelect
          label="Tag observada"
          value={state.triggerTagId}
          description="A automação dispara quando esta tag muda."
          onChange={(id) => onPatch({ triggerTagId: id })}
        />
      ) : null}

      {state.triggerType === "campaign_completed" ? (
        <Field
          label="Campanha observada"
          description={
            campaigns.isLoading ? "Carregando campanhas…" : "Dispara ao concluir esta campanha."
          }
        >
          <Select
            value={state.triggerCampaignId || undefined}
            onValueChange={(value) => onPatch({ triggerCampaignId: value })}
          >
            <SelectTrigger className="h-10" disabled={campaigns.isLoading}>
              <SelectValue placeholder="Selecionar campanha…" />
            </SelectTrigger>
            <SelectContent>
              {(campaigns.data?.campaigns ?? []).map((campaign) => (
                <SelectItem key={campaign.id} value={String(campaign.id)}>
                  {`#${campaign.id} · ${campaign.name}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      ) : null}

      <label className="flex items-center justify-between gap-3 rounded-md border border-line-hairline bg-surface-1/60 px-3 py-2.5">
        <span>
          <span className="block text-xs font-medium text-ink-strong">Exigir janela de 24h</span>
          <span className="mt-0.5 block text-[0.68rem] leading-4 text-ink-faint">
            Só executa se o contato interagiu nas últimas 24 horas.
          </span>
        </span>
        <Switch
          checked={state.requireWithin24hWindow}
          onCheckedChange={(checked) => onPatch({ requireWithin24hWindow: checked })}
        />
      </label>

      <SegmentEditor
        enabled={state.segmentEnabled}
        operator={state.segmentOperator}
        segments={state.segments}
        onPatch={onPatch}
      />

      {state.automationId ? (
        <p className="font-mono text-[0.65rem] uppercase tracking-widest text-ink-faint">
          Automação #{state.automationId} · {state.status}
        </p>
      ) : null}
    </div>
  );
}
