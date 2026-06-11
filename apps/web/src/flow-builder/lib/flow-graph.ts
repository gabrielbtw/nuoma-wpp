import type {
  AutomationAction,
  AutomationTrigger,
  CampaignStep,
  CampaignStepCondition,
  ChannelType,
} from "@nuoma/contracts";
import { MarkerType, type Edge, type Node } from "@xyflow/react";

import type {
  ActionDraft,
  BuilderActionType,
  BuilderStepType,
  ConditionDraft,
  StepDraft,
} from "./build-steps.js";
import type { CsvPreviewResult } from "./csv-preview.js";

export type CampaignCanvasTone = "cyan" | "wa" | "ig" | "violet" | "neutral" | "danger";

export type CampaignCanvasNodeData = {
  label: string;
  meta: string;
  summary: string;
  iconType: BuilderStepType | "start" | "end" | "branch";
  tone: CampaignCanvasTone;
  kind: "start" | "step" | "branch" | "end";
  conditionCount?: number;
  onOpenSteps?: () => void;
};

export type CampaignCanvasNode = Node<CampaignCanvasNodeData, "campaignCanvas">;

export type AutomationCanvasIconType =
  | AutomationTrigger["type"]
  | BuilderActionType
  | "condition"
  | "end"
  | "instagram";

export type AutomationCanvasNodeData = {
  label: string;
  meta: string;
  summary: string;
  iconType: AutomationCanvasIconType;
  tone: CampaignCanvasTone;
  kind: "trigger" | "condition" | "action" | "branch" | "end" | "error";
  actionType?: BuilderActionType;
};

export type AutomationCanvasNode = Node<AutomationCanvasNodeData, "automationCanvas">;

export function buildCampaignFlowGraph(inputGraph: {
  steps: StepDraft[];
  channel: ChannelType;
  evergreen: boolean;
  csvPreview: CsvPreviewResult | null;
  segmentEnabled: boolean;
  abEnabled: boolean;
  onOpenSteps: () => void;
}): { nodes: CampaignCanvasNode[]; edges: Edge[] } {
  const rowGap = 142;
  const stepX = 360;
  const startY = Math.max(70, (Math.min(inputGraph.steps.length, 4) * rowGap) / 2 - 42);
  const nodes: CampaignCanvasNode[] = [
    {
      id: "start",
      type: "campaignCanvas",
      position: { x: 36, y: startY },
      data: {
        label: "Início",
        meta: `Entrada do fluxo\n${campaignAudienceLabel(inputGraph)}`,
        summary: `${inputGraph.channel} · ${inputGraph.evergreen ? "evergreen" : "manual"} · A/B ${inputGraph.abEnabled ? "on" : "off"}`,
        iconType: "start",
        tone: "cyan",
        kind: "start",
        onOpenSteps: inputGraph.onOpenSteps,
      },
    },
  ];

  const stepIds = new Set(inputGraph.steps.map((step) => step.id));
  inputGraph.steps.forEach((step, index) => {
    const hasBranch = step.conditions.some((condition) => condition.action === "branch");
    nodes.push({
      id: step.id,
      type: "campaignCanvas",
      position: { x: stepX, y: index * rowGap + 36 },
      data: {
        label: step.label || `Step ${index + 1}`,
        meta: `${step.type} · delay ${step.delaySeconds || 0}s`,
        summary: stepDraftCanvasSummary(step),
        iconType: hasBranch ? "branch" : step.type,
        tone: stepTone(step, inputGraph.channel, hasBranch),
        kind: hasBranch ? "branch" : "step",
        conditionCount: step.conditions.length || undefined,
        onOpenSteps: inputGraph.onOpenSteps,
      },
    });
  });

  nodes.push({
    id: "end",
    type: "campaignCanvas",
    position: { x: 720, y: Math.max(36, inputGraph.steps.length * rowGap - 80) },
    data: {
      label: "Fim",
      meta: "Saída do fluxo\nEncerrar jornada",
      summary: "Finaliza o contato atual antes do próximo contato na fila.",
      iconType: "end",
      tone: "neutral",
      kind: "end",
      onOpenSteps: inputGraph.onOpenSteps,
    },
  });

  const edges: Edge[] = [];
  const markerEnd = { type: MarkerType.ArrowClosed, color: "var(--nw-flow-edge)" };
  const defaultEdge = {
    type: "smoothstep",
    markerEnd,
    style: { stroke: "var(--nw-flow-edge)", strokeWidth: 2 },
  };
  const firstStep = inputGraph.steps[0];
  edges.push({
    id: firstStep ? "start-to-first" : "start-to-end",
    source: "start",
    target: firstStep?.id ?? "end",
    ...defaultEdge,
  });

  inputGraph.steps.forEach((step, index) => {
    const nextStep = inputGraph.steps[index + 1];
    edges.push({
      id: `${step.id}-next`,
      source: step.id,
      target: nextStep?.id ?? "end",
      label: nextStep ? "próximo" : "concluir",
      ...defaultEdge,
    });
    step.conditions.forEach((condition, conditionIndex) => {
      if (
        condition.action === "branch" &&
        condition.targetStepId &&
        stepIds.has(condition.targetStepId)
      ) {
        edges.push({
          id: `${step.id}-branch-${conditionIndex}`,
          source: step.id,
          target: condition.targetStepId,
          label: conditionLabel(condition),
          type: "smoothstep",
          markerEnd,
          style: { stroke: "var(--nw-flow-branch)", strokeWidth: 2 },
          labelStyle: { fill: "var(--nw-flow-label)", fontSize: 11, fontWeight: 600 },
        });
      }
      if (condition.action === "exit") {
        edges.push({
          id: `${step.id}-exit-${conditionIndex}`,
          source: step.id,
          target: "end",
          label: conditionLabel(condition),
          type: "smoothstep",
          markerEnd,
          style: { stroke: "var(--nw-flow-exit)", strokeWidth: 2 },
          labelStyle: { fill: "var(--nw-flow-exit)", fontSize: 11, fontWeight: 600 },
        });
      }
    });
  });

  return { nodes, edges };
}

export function buildAutomationFlowGraph(inputGraph: {
  triggerType: AutomationTrigger["type"];
  triggerChannel: ChannelType;
  requireWithin24hWindow: boolean;
  segmentEnabled: boolean;
  segmentCount: number;
  actions: ActionDraft[];
  previewActions: AutomationAction[];
  previewError: string | null;
}): { nodes: AutomationCanvasNode[]; edges: Edge[] } {
  const rowGap = 138;
  const hasCondition = inputGraph.segmentEnabled || inputGraph.requireWithin24hWindow;
  const actionX = hasCondition ? 660 : 360;
  const endX = actionX + 360;
  const actionCount = Math.max(inputGraph.actions.length, 1);
  const startY = Math.max(58, (Math.min(actionCount, 4) * rowGap) / 2 - 42);
  const previewById = new Map(inputGraph.previewActions.map((action) => [action.id, action]));
  const actionIds = new Set(inputGraph.actions.map((action) => action.id));
  const nodes: AutomationCanvasNode[] = [
    {
      id: "automation-trigger",
      type: "automationCanvas",
      position: { x: 36, y: startY },
      data: {
        label: automationTriggerLabel(inputGraph.triggerType),
        meta: `Trigger\n${inputGraph.triggerChannel}`,
        summary: `Entrada ${inputGraph.triggerType} em ${inputGraph.triggerChannel}.`,
        iconType: inputGraph.triggerChannel === "instagram" ? "instagram" : inputGraph.triggerType,
        tone: inputGraph.triggerChannel === "instagram" ? "ig" : "wa",
        kind: "trigger",
      },
    },
  ];

  if (hasCondition) {
    const gates = [
      inputGraph.segmentEnabled ? `${inputGraph.segmentCount} regra(s) de segmento` : null,
      inputGraph.requireWithin24hWindow ? "janela 24h exigida" : null,
    ].filter(Boolean);
    nodes.push({
      id: "automation-condition",
      type: "automationCanvas",
      position: { x: 360, y: startY },
      data: {
        label: "Condição",
        meta: "Gates\nAND/OR",
        summary: gates.join(" · ") || "Sem gate ativo.",
        iconType: "condition",
        tone: "cyan",
        kind: "condition",
      },
    });
  }

  inputGraph.actions.forEach((action, index) => {
    const previewAction = previewById.get(action.id) ?? inputGraph.previewActions[index];
    const isBranch = action.type === "branch";
    nodes.push({
      id: action.id,
      type: "automationCanvas",
      position: { x: actionX, y: index * rowGap + 36 },
      data: {
        label: previewAction
          ? automationActionLabel(previewAction)
          : automationActionDraftLabel(action),
        meta: `${action.type}\nação ${index + 1}`,
        summary: previewAction
          ? automationActionSummary(previewAction)
          : automationActionDraftCanvasSummary(action),
        iconType:
          action.type === "send_step" && inputGraph.triggerChannel === "instagram"
            ? "instagram"
            : action.type,
        tone: automationActionTone(action.type, inputGraph.triggerChannel),
        kind: isBranch ? "branch" : "action",
        actionType: action.type,
      },
    });
  });

  if (inputGraph.previewError) {
    nodes.push({
      id: "automation-preview-error",
      type: "automationCanvas",
      position: { x: actionX, y: inputGraph.actions.length * rowGap + 36 },
      data: {
        label: "Revisar ação",
        meta: "Validação\npreview",
        summary: inputGraph.previewError,
        iconType: "condition",
        tone: "danger",
        kind: "error",
      },
    });
  }

  nodes.push({
    id: "automation-end",
    type: "automationCanvas",
    position: { x: endX, y: Math.max(36, inputGraph.actions.length * rowGap - 74) },
    data: {
      label: "Fim",
      meta: "Saída\nsem job",
      summary: "Criar rascunho salva automação, mas não enfileira envio.",
      iconType: "end",
      tone: "neutral",
      kind: "end",
    },
  });

  const edges: Edge[] = [];
  const markerEnd = { type: MarkerType.ArrowClosed, color: "var(--nw-flow-edge)" };
  const defaultEdge = {
    type: "smoothstep",
    markerEnd,
    style: { stroke: "var(--nw-flow-edge)", strokeWidth: 2 },
  };
  const firstTarget = inputGraph.actions[0]?.id ?? "automation-end";

  edges.push({
    id: hasCondition ? "trigger-to-condition" : "trigger-to-first",
    source: "automation-trigger",
    target: hasCondition ? "automation-condition" : firstTarget,
    ...defaultEdge,
  });

  if (hasCondition) {
    edges.push({
      id: "condition-to-first",
      source: "automation-condition",
      target: firstTarget,
      label: "ok",
      ...defaultEdge,
    });
  }

  inputGraph.actions.forEach((action, index) => {
    const nextAction = inputGraph.actions[index + 1];
    edges.push({
      id: `${action.id}-next`,
      source: action.id,
      target: nextAction?.id ?? "automation-end",
      label: nextAction ? "próximo" : "concluir",
      ...defaultEdge,
    });
    const targetActionId = action.type === "branch" ? action.branchTargetActionId.trim() : "";
    if (targetActionId && actionIds.has(targetActionId)) {
      edges.push({
        id: `${action.id}-branch`,
        source: action.id,
        target: targetActionId,
        label: action.branchLabel.trim() || "branch",
        type: "smoothstep",
        markerEnd,
        style: { stroke: "var(--nw-flow-branch)", strokeWidth: 2 },
        labelStyle: { fill: "var(--nw-flow-branch)", fontSize: 11, fontWeight: 600 },
      });
    }
  });

  if (inputGraph.previewError) {
    edges.push({
      id: "preview-error-to-end",
      source: "automation-preview-error",
      target: "automation-end",
      label: "corrigir",
      ...defaultEdge,
      style: { stroke: "var(--nw-flow-danger)", strokeWidth: 2 },
    });
  }

  return { nodes, edges };
}

export function flowToneColor(tone: CampaignCanvasTone) {
  if (tone === "wa") return "var(--nw-flow-wa)";
  if (tone === "ig") return "var(--nw-flow-ig)";
  if (tone === "violet") return "var(--nw-flow-accent)";
  if (tone === "danger") return "var(--nw-flow-danger)";
  if (tone === "neutral") return "var(--nw-flow-neutral)";
  return "var(--nw-flow-accent)";
}

export function stepSummary(step: CampaignStep) {
  if (step.type === "temporary_messages") return `Definir temporárias em ${step.duration}.`;
  if (step.type === "text") return step.template;
  if (step.type === "link") return `${step.text} · ${step.url}`;
  if (step.type === "document") return `${step.fileName} · asset #${step.mediaAssetId}`;
  if (step.type === "image") {
    const count = step.mediaAssetIds?.length ?? 1;
    return `${count} imagem(ns) · asset #${step.mediaAssetId}${step.caption ? ` · ${step.caption}` : ""}`;
  }
  return `asset #${step.mediaAssetId}${step.caption ? ` · ${step.caption}` : ""}`;
}

export function automationActionLabel(action: AutomationAction) {
  if (action.type === "send_step") return action.step.label;
  if (action.type === "delay") return action.label ?? "Delay";
  if (action.type === "branch") return action.label;
  if (action.type === "apply_tag") return `Aplicar tag #${action.tagId}`;
  if (action.type === "remove_tag") return `Remover tag #${action.tagId}`;
  if (action.type === "set_status") return `Status ${action.status}`;
  if (action.type === "create_reminder") return action.title;
  if (action.type === "notify_attendant") return "Notificar atendente";
  return `Disparar automação #${action.automationId}`;
}

export function automationActionSummary(action: AutomationAction) {
  if (action.type === "send_step") return stepSummary(action.step);
  if (action.type === "delay") return `${action.seconds}s antes das próximas ações com envio`;
  if (action.type === "branch") {
    const condition = action.condition?.conditions[0];
    return condition
      ? `${condition.field} ${condition.operator} ${String(condition.value ?? "nulo")}`
      : "Branch sem condição";
  }
  if (action.type === "apply_tag" || action.type === "remove_tag") return "Ação de CRM";
  if (action.type === "set_status") return "Atualiza status do contato";
  if (action.type === "create_reminder")
    return `Vence em ${new Date(action.dueAt).toLocaleString("pt-BR")}`;
  if (action.type === "notify_attendant") return action.message;
  return "Aciona automação filha com guarda anti-loop";
}

function campaignAudienceLabel(inputGraph: {
  csvPreview: CsvPreviewResult | null;
  segmentEnabled: boolean;
}) {
  if (inputGraph.csvPreview) return `${inputGraph.csvPreview.validCount} contatos elegíveis`;
  return inputGraph.segmentEnabled ? "Segmento ativo" : "Todos que entram";
}

function stepTone(step: StepDraft, channel: ChannelType, hasBranch: boolean): CampaignCanvasTone {
  if (hasBranch) return "violet";
  if (step.type === "temporary_messages" || step.type === "voice") return "cyan";
  if (channel === "instagram" || step.type === "image" || step.type === "video") return "ig";
  if (step.type === "document") return "neutral";
  return "wa";
}

function conditionLabel(condition: ConditionDraft) {
  const type = conditionTypeLabels[condition.type] ?? condition.type;
  const value = condition.value.trim();
  return value ? `${type}: ${value}` : type;
}

function stepDraftCanvasSummary(step: StepDraft) {
  if (step.type === "temporary_messages") return `Temporárias ${step.temporaryMessagesDuration}`;
  if (step.type === "text") return step.template || "Mensagem de texto";
  if (step.type === "link") return `${step.linkText || "Link"} - ${step.url || "URL pendente"}`;
  if (step.type === "document")
    return `${step.fileName || "Documento"} - asset #${step.mediaAssetId || "-"}`;
  if (step.type === "voice") return step.fileName || "Voice note PTT";
  return step.caption || "Mídia sem legenda";
}

function automationTriggerLabel(type: AutomationTrigger["type"]) {
  if (type === "campaign_completed") return "Campanha completa";
  if (type === "tag_applied") return "Tag aplicada";
  if (type === "tag_removed") return "Tag removida";
  return "Mensagem recebida";
}

function automationActionDraftLabel(action: ActionDraft) {
  if (action.type === "send_step") return action.step.label || "Enviar step";
  if (action.type === "delay") return action.delayLabel.trim() || "Delay";
  if (action.type === "branch") return action.branchLabel.trim() || "Branch";
  if (action.type === "apply_tag") return `Aplicar tag #${action.tagId || "-"}`;
  if (action.type === "remove_tag") return `Remover tag #${action.tagId || "-"}`;
  if (action.type === "set_status") return `Status ${action.status || "-"}`;
  if (action.type === "create_reminder") return action.reminderTitle || "Criar lembrete";
  if (action.type === "notify_attendant") return "Notificar atendente";
  return `Disparar automação #${action.triggerAutomationId || "-"}`;
}

function automationActionDraftCanvasSummary(action: ActionDraft) {
  if (action.type === "send_step") return stepDraftCanvasSummary(action.step);
  if (action.type === "delay")
    return `${action.delayActionSeconds || "0"}s antes das próximas ações`;
  if (action.type === "branch") {
    return `${action.branchConditionField} ${action.branchConditionOperator} ${action.branchConditionValue || "-"}`;
  }
  if (action.type === "apply_tag" || action.type === "remove_tag") return "Ação de CRM";
  if (action.type === "set_status") return "Atualiza status do contato";
  if (action.type === "create_reminder") return action.dueAt || "Data pendente";
  if (action.type === "notify_attendant") return action.notifyMessage || "Notificação pendente";
  return "Aciona automação filha com guarda anti-loop";
}

function automationActionTone(type: BuilderActionType, channel: ChannelType): CampaignCanvasTone {
  if (type === "branch") return "violet";
  if (type === "delay" || type === "create_reminder") return "cyan";
  if (type === "send_step") return channel === "instagram" ? "ig" : "wa";
  if (type === "notify_attendant" || type === "trigger_automation") return "violet";
  return "neutral";
}

const conditionTypeLabels: Record<CampaignStepCondition["type"], string> = {
  replied: "Respondeu",
  has_tag: "Tem tag",
  channel_is: "Canal é",
  outside_window: "Fora 24h",
};
