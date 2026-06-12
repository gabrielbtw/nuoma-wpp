import {
  Field,
  Input,
  NumberInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@nuoma/ui";

import type { ActionDraft, StepDraft } from "../../../flow-builder/lib/build-steps.js";
import { segmentFields, segmentOperators } from "../../../flow-builder/lib/builder-options.js";
import type { SegmentDraft } from "../../../flow-builder/lib/segment.js";
import { trpc } from "../../../lib/trpc.js";
import { humanizeSeconds } from "../config/step-registry.js";
import type { AutomationBuilderState } from "../state/automation-store.js";
import { StepFields } from "./StepFields.js";
import { TagSelect } from "./fields/TagSelect.js";

export interface ActionInspectorProps {
  action: ActionDraft;
  order: number;
  state: AutomationBuilderState;
  onPatch: (patch: Partial<ActionDraft>) => void;
  onPatchStep: (patch: Partial<StepDraft>) => void;
}

export function ActionInspector({
  action,
  order,
  state,
  onPatch,
  onPatchStep,
}: ActionInspectorProps) {
  if (action.type === "send_step") {
    return (
      <StepFields
        step={action.step}
        order={order}
        channel={state.triggerChannel}
        onPatch={onPatchStep}
      />
    );
  }

  if (action.type === "delay") {
    return (
      <div className="grid gap-3.5">
        <Field
          label="Tempo de espera"
          description={`Aguarda ${humanizeSeconds(action.delayActionSeconds)} antes das próximas ações de envio.`}
        >
          <NumberInput
            value={action.delayActionSeconds}
            min={1}
            step={30}
            onValueChange={(_parsed, raw) => onPatch({ delayActionSeconds: raw })}
            aria-label="Espera em segundos"
          />
        </Field>
        <Field label="Rótulo" description="Opcional — aparece no canvas.">
          <Input
            value={action.delayLabel}
            onChange={(event) => onPatch({ delayLabel: event.target.value })}
            placeholder="Aguardar"
            className="h-10"
          />
        </Field>
      </div>
    );
  }

  if (action.type === "branch") {
    const targets = state.actions
      .map((candidate, index) => ({ candidate, order: index + 1 }))
      .filter(({ candidate }) => candidate.id !== action.id);
    const needsValue =
      action.branchConditionOperator !== "exists" &&
      action.branchConditionOperator !== "not_exists";
    return (
      <div className="grid gap-3.5">
        <Field label="Rótulo do desvio" description="Identifica a seta no canvas.">
          <Input
            value={action.branchLabel}
            onChange={(event) => onPatch({ branchLabel: event.target.value })}
            placeholder="Cliente VIP"
            className="h-10"
          />
        </Field>
        <Field label="Regra" description="Quando a regra bate, o fluxo desvia para o destino.">
          <div className="flex items-center gap-1.5">
            <Select
              value={action.branchConditionField}
              onValueChange={(value) =>
                onPatch({ branchConditionField: value as SegmentDraft["field"] })
              }
            >
              <SelectTrigger className="h-9 flex-1 px-2.5 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {segmentFields.map((field) => (
                  <SelectItem key={field.value} value={field.value}>
                    {field.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={action.branchConditionOperator}
              onValueChange={(value) =>
                onPatch({ branchConditionOperator: value as SegmentDraft["operator"] })
              }
            >
              <SelectTrigger className="h-9 w-[5.4rem] shrink-0 px-2 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {segmentOperators.map((op) => (
                  <SelectItem key={op.value} value={op.value}>
                    {op.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {needsValue ? (
              <Input
                value={action.branchConditionValue}
                onChange={(event) => onPatch({ branchConditionValue: event.target.value })}
                placeholder="valor"
                className="h-9 flex-1 px-2.5 text-xs"
              />
            ) : null}
          </div>
        </Field>
        <Field
          label="Destino do desvio"
          description="Também dá para arrastar do conector lateral do bloco no canvas."
        >
          <Select
            value={action.branchTargetActionId || undefined}
            onValueChange={(value) => onPatch({ branchTargetActionId: value })}
          >
            <SelectTrigger className="h-10">
              <SelectValue placeholder="Selecionar ação de destino…" />
            </SelectTrigger>
            <SelectContent>
              {targets.map(({ candidate, order: targetOrder }) => (
                <SelectItem key={candidate.id} value={candidate.id}>
                  {`${String(targetOrder).padStart(2, "0")} · ${actionTitle(candidate)}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
    );
  }

  if (action.type === "apply_tag" || action.type === "remove_tag") {
    return (
      <TagSelect
        label={action.type === "apply_tag" ? "Tag a aplicar" : "Tag a remover"}
        value={action.tagId}
        onChange={(id) => onPatch({ tagId: id })}
      />
    );
  }

  if (action.type === "set_status") {
    return (
      <Field label="Novo status do contato" description="Texto livre — ex.: novo, qualificado.">
        <Input
          value={action.status}
          onChange={(event) => onPatch({ status: event.target.value })}
          placeholder="qualificado"
          className="h-10"
        />
      </Field>
    );
  }

  if (action.type === "create_reminder") {
    return (
      <div className="grid gap-3.5">
        <Field label="Título do lembrete">
          <Input
            value={action.reminderTitle}
            onChange={(event) => onPatch({ reminderTitle: event.target.value })}
            placeholder="Retornar contato"
            className="h-10"
          />
        </Field>
        <Field label="Vencimento">
          <Input
            type="datetime-local"
            value={action.dueAt}
            onChange={(event) => onPatch({ dueAt: event.target.value })}
            className="h-10"
          />
        </Field>
      </div>
    );
  }

  if (action.type === "notify_attendant") {
    return (
      <div className="grid gap-3.5">
        <Field label="Mensagem interna" description="Visível para a equipe, não para o contato.">
          <Textarea
            value={action.notifyMessage}
            rows={3}
            onChange={(event) => onPatch({ notifyMessage: event.target.value })}
            placeholder="Lead precisa de atendimento humano."
          />
        </Field>
        <Field label="ID do atendente" description="Opcional — vazio notifica a equipe toda.">
          <Input
            value={action.notifyAttendantId}
            inputMode="numeric"
            monospace
            onChange={(event) => onPatch({ notifyAttendantId: event.target.value })}
            placeholder="ex.: 2"
            className="h-10"
          />
        </Field>
      </div>
    );
  }

  return (
    <ChildAutomationSelect
      currentAutomationId={state.automationId}
      value={action.triggerAutomationId}
      onChange={(id) => onPatch({ triggerAutomationId: id })}
    />
  );
}

function ChildAutomationSelect({
  currentAutomationId,
  value,
  onChange,
}: {
  currentAutomationId: number | null;
  value: string;
  onChange: (id: string) => void;
}) {
  const automations = trpc.automations.list.useQuery();
  const list = (automations.data?.automations ?? []).filter(
    (automation) => automation.id !== currentAutomationId,
  );
  return (
    <Field
      label="Automação filha"
      description={
        automations.isLoading
          ? "Carregando automações…"
          : "Executa outra automação com guarda anti-loop no backend."
      }
    >
      <Select value={value || undefined} onValueChange={onChange}>
        <SelectTrigger className="h-10" disabled={automations.isLoading}>
          <SelectValue placeholder="Selecionar automação…" />
        </SelectTrigger>
        <SelectContent>
          {list.map((automation) => (
            <SelectItem key={automation.id} value={String(automation.id)}>
              {`#${automation.id} · ${automation.name}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function actionTitle(action: ActionDraft): string {
  if (action.type === "send_step") return action.step.label || "Enviar mensagem";
  if (action.type === "delay") return action.delayLabel || "Aguardar";
  if (action.type === "branch") return action.branchLabel || "Branch";
  return action.type;
}
