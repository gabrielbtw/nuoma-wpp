import type {
  ActionDraft,
  BuilderStepType,
  StepDraft,
} from "../../../flow-builder/lib/build-steps.js";
import { conditionActions, conditionTypes } from "../../../flow-builder/lib/builder-options.js";
import { humanizeSeconds } from "../config/step-registry.js";

/** One rendered row in the conversation simulator. */
export type SimEvent =
  | { kind: "bubble"; stepType: BuilderStepType; lines: string[] }
  | { kind: "delay"; label: string }
  | { kind: "event"; text: string; tone: "neutral" | "info" | "ok" | "warn" };

function optionLabel(options: Array<{ value: string; label: string }>, value: string): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

function stepBubble(step: StepDraft): SimEvent {
  switch (step.type) {
    case "text":
      return { kind: "bubble", stepType: "text", lines: [step.template.trim() || "(mensagem vazia)"] };
    case "link":
      return {
        kind: "bubble",
        stepType: "link",
        lines: [step.linkText.trim() || "(texto pendente)", step.url.trim() || "(URL pendente)"],
      };
    case "voice":
      return {
        kind: "bubble",
        stepType: "voice",
        lines: [step.mediaAssetId ? `Voice note · asset #${step.mediaAssetId}` : "Voice note pendente"],
      };
    case "image":
    case "video":
      return {
        kind: "bubble",
        stepType: step.type,
        lines: [
          step.mediaAssetId
            ? `${step.type === "image" ? "Imagem" : "Vídeo"} · asset #${step.mediaAssetId}`
            : `${step.type === "image" ? "Imagem" : "Vídeo"} pendente`,
          ...(step.caption.trim() ? [step.caption.trim()] : []),
        ],
      };
    case "document":
      return {
        kind: "bubble",
        stepType: "document",
        lines: [
          step.fileName.trim() || "Documento",
          ...(step.caption.trim() ? [step.caption.trim()] : []),
        ],
      };
    case "temporary_messages":
      return {
        kind: "bubble",
        stepType: "temporary_messages",
        lines: [`Mensagens temporárias: ${step.temporaryMessagesDuration}`],
      };
  }
}

function stepEvents(step: StepDraft): SimEvent[] {
  const events: SimEvent[] = [];
  const delay = Number.parseInt(step.delaySeconds || "0", 10) || 0;
  if (delay > 0) events.push({ kind: "delay", label: `aguarda ${humanizeSeconds(delay)}` });
  for (const condition of step.conditions) {
    events.push({
      kind: "event",
      tone: condition.action === "exit" ? "warn" : "info",
      text: `Se "${optionLabel(conditionTypes, condition.type)}${
        condition.value.trim() ? `: ${condition.value.trim()}` : ""
      }" → ${optionLabel(conditionActions, condition.action)}`,
    });
  }
  if (step.type === "temporary_messages") {
    events.push({
      kind: "event",
      tone: "neutral",
      text: `Modo temporário ativado (${step.temporaryMessagesDuration})`,
    });
    return events;
  }
  events.push(stepBubble(step));
  return events;
}

export function simulateCampaign(steps: StepDraft[]): SimEvent[] {
  return steps.flatMap(stepEvents);
}

export function simulateAutomation(actions: ActionDraft[]): SimEvent[] {
  return actions.flatMap((action, index): SimEvent[] => {
    switch (action.type) {
      case "send_step":
        return stepEvents(action.step);
      case "delay":
        return [
          {
            kind: "delay",
            label: `${action.delayLabel.trim() || "aguarda"} ${humanizeSeconds(action.delayActionSeconds)}`,
          },
        ];
      case "branch":
        return [
          {
            kind: "event",
            tone: "info",
            text: `Desvio "${action.branchLabel.trim() || `Branch ${index + 1}`}" se ${action.branchConditionField} ${action.branchConditionOperator} ${action.branchConditionValue.trim() || "—"}`,
          },
        ];
      case "apply_tag":
        return [
          { kind: "event", tone: "ok", text: `Tag #${action.tagId || "?"} aplicada ao contato` },
        ];
      case "remove_tag":
        return [
          { kind: "event", tone: "ok", text: `Tag #${action.tagId || "?"} removida do contato` },
        ];
      case "set_status":
        return [
          { kind: "event", tone: "ok", text: `Status do contato → ${action.status.trim() || "—"}` },
        ];
      case "create_reminder":
        return [
          {
            kind: "event",
            tone: "neutral",
            text: `Lembrete "${action.reminderTitle.trim() || "sem título"}" criado`,
          },
        ];
      case "notify_attendant":
        return [
          {
            kind: "event",
            tone: "warn",
            text: `Equipe notificada: ${action.notifyMessage.trim() || "—"}`,
          },
        ];
      case "trigger_automation":
        return [
          {
            kind: "event",
            tone: "neutral",
            text: `Automação #${action.triggerAutomationId || "?"} acionada`,
          },
        ];
    }
  });
}
