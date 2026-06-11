import type { AutomationAction, CampaignStep, CampaignStepCondition } from "@nuoma/contracts";

import { parseSegmentDraftValue, type SegmentField, type SegmentOperator } from "./segment.js";

export type BuilderStepType = CampaignStep["type"];
export type BuilderActionType = AutomationAction["type"];

export interface StepDraft {
  id: string;
  label: string;
  type: BuilderStepType;
  delaySeconds: string;
  template: string;
  url: string;
  linkText: string;
  previewEnabled: boolean;
  mediaAssetId: string;
  fileName: string;
  caption: string;
  temporaryMessagesDuration: "24h" | "7d" | "90d";
  conditions: ConditionDraft[];
}

export interface ConditionDraft {
  id: string;
  type: CampaignStepCondition["type"];
  action: CampaignStepCondition["action"];
  value: string;
  targetStepId: string;
}

export interface ActionDraft {
  id: string;
  type: BuilderActionType;
  step: StepDraft;
  delayActionSeconds: string;
  delayLabel: string;
  branchLabel: string;
  branchTargetActionId: string;
  branchConditionField: SegmentField;
  branchConditionOperator: SegmentOperator;
  branchConditionValue: string;
  tagId: string;
  status: string;
  reminderTitle: string;
  dueAt: string;
  notifyAttendantId: string;
  notifyMessage: string;
  triggerAutomationId: string;
}

let draftCounter = 0;

export function newStepDraft(order: number): StepDraft {
  draftCounter += 1;
  return {
    id: `step-${Date.now()}-${draftCounter}`,
    label: `Step ${order}`,
    type: "text",
    delaySeconds: "0",
    template: "Olá {{nome}}, tudo bem?",
    url: "https://nuoma.com.br",
    linkText: "Ver detalhes",
    previewEnabled: true,
    mediaAssetId: "",
    fileName: "documento.pdf",
    caption: "",
    temporaryMessagesDuration: "24h",
    conditions: [],
  };
}

export function newConditionDraft(): ConditionDraft {
  draftCounter += 1;
  return {
    id: `condition-${Date.now()}-${draftCounter}`,
    type: "replied",
    action: "exit",
    value: "",
    targetStepId: "",
  };
}

export function newActionDraft(order: number): ActionDraft {
  return {
    id: `action-${Date.now()}-${order}-${Math.random().toString(36).slice(2, 8)}`,
    type: "send_step",
    step: newStepDraft(order),
    delayActionSeconds: "300",
    delayLabel: "Aguardar",
    branchLabel: "Branch",
    branchTargetActionId: "",
    branchConditionField: "status",
    branchConditionOperator: "eq",
    branchConditionValue: "novo",
    tagId: "",
    status: "novo",
    reminderTitle: "Retornar contato",
    dueAt: "",
    notifyAttendantId: "",
    notifyMessage: "Lead precisa de atendimento humano.",
    triggerAutomationId: "",
  };
}

export function buildSteps(steps: StepDraft[]): CampaignStep[] | string {
  const built: CampaignStep[] = [];
  for (const [index, step] of steps.entries()) {
    const result = buildStep(step, index + 1);
    if (typeof result === "string") {
      return result;
    }
    built.push(result);
  }
  return built;
}

export function sanitizeStepId(id: string, order: number) {
  return id.replace(/[^a-zA-Z0-9_-]/g, "") || `step-${order}`;
}

export function buildStep(step: StepDraft, order: number): CampaignStep | string {
  const id = sanitizeStepId(step.id, order);
  const label = step.label.trim() || `Step ${order}`;
  const delaySeconds = Math.max(0, Number.parseInt(step.delaySeconds || "0", 10) || 0);
  const conditions = buildStepConditions(step, order);
  if (typeof conditions === "string") {
    return conditions;
  }
  const base = { id, label, delaySeconds, conditions };

  if (step.type === "temporary_messages") {
    return { ...base, type: "temporary_messages", duration: step.temporaryMessagesDuration };
  }

  if (step.type === "text") {
    const template = step.template.trim();
    return template ? { ...base, type: "text", template } : `Step ${order}: mensagem vazia.`;
  }
  if (step.type === "link") {
    const text = step.linkText.trim();
    const url = step.url.trim();
    if (!text || !url) return `Step ${order}: link precisa de texto e URL.`;
    return { ...base, type: "link", text, url, previewEnabled: step.previewEnabled };
  }

  const mediaAssetId = Number.parseInt(step.mediaAssetId, 10);
  if (!Number.isInteger(mediaAssetId) || mediaAssetId <= 0) {
    return `Step ${order}: informe um Media Asset ID válido.`;
  }
  const caption = step.caption.trim() || null;
  if (step.type === "document") {
    const fileName = step.fileName.trim();
    return fileName
      ? { ...base, type: "document", mediaAssetId, fileName, caption }
      : `Step ${order}: documento precisa de nome de arquivo.`;
  }
  return { ...base, type: step.type, mediaAssetId, caption };
}

export function buildStepConditions(
  step: StepDraft,
  order: number,
): CampaignStepCondition[] | string {
  const built: CampaignStepCondition[] = [];
  for (const [index, condition] of step.conditions.entries()) {
    const value = condition.value.trim();
    const targetStepId = condition.targetStepId.trim();
    if ((condition.type === "has_tag" || condition.type === "channel_is") && !value) {
      return `Step ${order}, condição ${index + 1}: informe o valor.`;
    }
    if (condition.action === "branch" && !targetStepId) {
      return `Step ${order}, condição ${index + 1}: branch precisa de destino.`;
    }
    built.push({
      type: condition.type,
      action: condition.action,
      value: value || null,
      targetStepId: condition.action === "branch" ? targetStepId : null,
    });
  }
  return built;
}

export function buildActions(actions: ActionDraft[]): AutomationAction[] | string {
  const built: AutomationAction[] = [];
  for (const [index, action] of actions.entries()) {
    const order = index + 1;
    if (action.type === "send_step") {
      const step = buildStep(action.step, order);
      if (typeof step === "string") return step;
      built.push({ id: action.id, type: "send_step", step });
      continue;
    }
    if (action.type === "delay") {
      const seconds = Number.parseInt(action.delayActionSeconds, 10);
      if (!Number.isInteger(seconds) || seconds <= 0) {
        return `Ação ${order}: delay precisa de segundos positivos.`;
      }
      built.push({
        id: action.id,
        type: "delay",
        seconds,
        label: action.delayLabel.trim() || null,
      });
      continue;
    }
    if (action.type === "branch") {
      const label = action.branchLabel.trim();
      if (!label) return `Ação ${order}: branch precisa de rótulo.`;
      built.push({
        id: action.id,
        type: "branch",
        label,
        condition: {
          operator: "and",
          conditions: [
            {
              field: action.branchConditionField,
              operator: action.branchConditionOperator,
              value: parseSegmentDraftValue(
                action.branchConditionOperator,
                action.branchConditionValue,
              ),
            },
          ],
        },
        targetActionId: action.branchTargetActionId.trim() || null,
      });
      continue;
    }
    if (action.type === "apply_tag" || action.type === "remove_tag") {
      const tagId = Number.parseInt(action.tagId, 10);
      if (!Number.isInteger(tagId) || tagId <= 0) {
        return `Ação ${order}: informe um Tag ID válido.`;
      }
      built.push({ id: action.id, type: action.type, tagId });
      continue;
    }
    if (action.type === "set_status") {
      const status = action.status.trim();
      if (!status) return `Ação ${order}: informe o status.`;
      built.push({ id: action.id, type: "set_status", status });
      continue;
    }
    const title = action.reminderTitle.trim();
    const dueAt = toIsoDateTime(action.dueAt);
    if (action.type === "create_reminder") {
      if (!title || !dueAt) {
        return `Ação ${order}: lembrete precisa de título e data.`;
      }
      built.push({ id: action.id, type: "create_reminder", title, dueAt });
      continue;
    }
    if (action.type === "notify_attendant") {
      const message = action.notifyMessage.trim();
      if (!message) return `Ação ${order}: notificação precisa de mensagem.`;
      const attendantId = Number.parseInt(action.notifyAttendantId, 10);
      built.push({
        id: action.id,
        type: "notify_attendant",
        attendantId: Number.isInteger(attendantId) && attendantId > 0 ? attendantId : null,
        message,
      });
      continue;
    }
    const automationId = Number.parseInt(action.triggerAutomationId, 10);
    if (!Number.isInteger(automationId) || automationId <= 0) {
      return `Ação ${order}: informe a automação filha.`;
    }
    built.push({ id: action.id, type: "trigger_automation", automationId });
  }
  return built;
}

function toIsoDateTime(value: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
