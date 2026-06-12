import { Plus, X } from "lucide-react";

import {
  Button,
  Field,
  IconButton,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nuoma/ui";

import type { ConditionDraft, StepDraft } from "../../../../flow-builder/lib/build-steps.js";
import { conditionActions, conditionTypes } from "../../../../flow-builder/lib/builder-options.js";
import { conditionFieldErrors } from "../../../../flow-builder/lib/validation.js";

export interface ConditionsEditorProps {
  step: StepDraft;
  steps: StepDraft[];
  order: number;
  onAdd: () => void;
  onUpdate: (conditionId: string, patch: Partial<ConditionDraft>) => void;
  onRemove: (conditionId: string) => void;
}

export function ConditionsEditor({
  step,
  steps,
  order,
  onAdd,
  onUpdate,
  onRemove,
}: ConditionsEditorProps) {
  const branchTargets = steps
    .map((candidate, index) => ({ candidate, order: index + 1 }))
    .filter(({ candidate }) => candidate.id !== step.id);

  return (
    <section className="rounded-lg border border-line-hairline bg-surface-1/60 p-3">
      <header className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-ink-soft">Condições</p>
          <p className="mt-0.5 text-[0.68rem] leading-4 text-ink-faint">
            Avaliadas antes deste bloco ser enviado.
          </p>
        </div>
        <Button
          variant="ghost"
          size="xs"
          leftIcon={<Plus className="h-3.5 w-3.5" />}
          onClick={onAdd}
        >
          Adicionar
        </Button>
      </header>

      {step.conditions.length === 0 ? (
        <p className="mt-2.5 text-[0.68rem] text-ink-faint">
          Sem condições — o bloco é sempre enviado.
        </p>
      ) : (
        <ul className="mt-3 grid gap-2.5">
          {step.conditions.map((condition, index) => {
            const errors = conditionFieldErrors(condition, order, index + 1);
            const needsValue = condition.type === "has_tag" || condition.type === "channel_is";
            return (
              <li
                key={condition.id}
                className="rounded-md border border-line-hairline bg-surface-2 p-2.5"
              >
                <div className="flex items-center gap-1.5">
                  <Select
                    value={condition.type}
                    onValueChange={(value) =>
                      onUpdate(condition.id, { type: value as ConditionDraft["type"] })
                    }
                  >
                    <SelectTrigger className="h-9 flex-1 px-2.5 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {conditionTypes.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={condition.action}
                    onValueChange={(value) =>
                      onUpdate(condition.id, { action: value as ConditionDraft["action"] })
                    }
                  >
                    <SelectTrigger className="h-9 flex-1 px-2.5 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {conditionActions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <IconButton
                    label="Remover condição"
                    size="xs"
                    icon={<X className="h-3.5 w-3.5" />}
                    onClick={() => onRemove(condition.id)}
                  />
                </div>

                {needsValue ? (
                  <Field className="mt-2" error={errors.value}>
                    <Input
                      value={condition.value}
                      onChange={(event) => onUpdate(condition.id, { value: event.target.value })}
                      placeholder={condition.type === "has_tag" ? "nome da tag" : "whatsapp"}
                      invalid={Boolean(errors.value)}
                      className="h-9 px-2.5 text-xs"
                    />
                  </Field>
                ) : null}

                {condition.action === "branch" ? (
                  <Field className="mt-2" error={errors.targetStepId}>
                    <Select
                      value={condition.targetStepId || undefined}
                      onValueChange={(value) => onUpdate(condition.id, { targetStepId: value })}
                    >
                      <SelectTrigger className="h-9 px-2.5 text-xs">
                        <SelectValue placeholder="Ir para qual bloco?" />
                      </SelectTrigger>
                      <SelectContent>
                        {branchTargets.map(({ candidate, order: targetOrder }) => (
                          <SelectItem key={candidate.id} value={candidate.id}>
                            {`${String(targetOrder).padStart(2, "0")} · ${candidate.label || candidate.id}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
