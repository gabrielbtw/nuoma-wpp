import type { AutomationTrigger, ChannelType } from "@nuoma/contracts";
import {
  Activity,
  BellRing,
  CalendarClock,
  GitBranch,
  MailQuestion,
  Megaphone,
  Tag,
  Tags,
  Timer,
  Workflow,
  type LucideIcon,
} from "lucide-react";

import {
  newActionDraft,
  type ActionDraft,
  type BuilderActionType,
  type BuilderStepType,
} from "../../../flow-builder/lib/build-steps.js";
import {
  humanizeSeconds,
  stepRegistry,
  type LibraryCategoryId,
  type NodeTone,
} from "./step-registry.js";

export interface ActionDefinition {
  type: BuilderActionType;
  label: string;
  description: string;
  icon: LucideIcon;
  tone: NodeTone;
  category: LibraryCategoryId;
  channels: ChannelType[];
  createDraft: (order: number) => ActionDraft;
  summarize: (draft: ActionDraft) => string;
}

const ALL_CHANNELS: ChannelType[] = ["whatsapp", "instagram"];

function baseAction(order: number, type: BuilderActionType): ActionDraft {
  return { ...newActionDraft(order), type };
}

/**
 * Exhaustive map of every automation action type the backend supports.
 * `send_step` embeds a campaign step; in the block library the message blocks
 * come from stepRegistry and are wrapped into send_step drafts (§7 of the doc).
 */
export const actionRegistry: Record<BuilderActionType, ActionDefinition> = {
  send_step: {
    type: "send_step",
    label: "Enviar mensagem",
    description: "Envia um step de mensagem (texto, mídia, link…).",
    icon: Megaphone,
    tone: "accent",
    category: "messages",
    channels: ALL_CHANNELS,
    createDraft: (order) => baseAction(order, "send_step"),
    summarize: (draft) => stepRegistry[draft.step.type].summarize(draft.step),
  },
  delay: {
    type: "delay",
    label: "Aguardar",
    description: "Pausa antes das próximas ações de envio.",
    icon: Timer,
    tone: "info",
    category: "logic",
    channels: ALL_CHANNELS,
    createDraft: (order) => baseAction(order, "delay"),
    summarize: (draft) => `Aguarda ${humanizeSeconds(draft.delayActionSeconds)}`,
  },
  branch: {
    type: "branch",
    label: "Condição / Branch",
    description: "Desvia o fluxo quando a regra de segmento bate.",
    icon: GitBranch,
    tone: "info",
    category: "logic",
    channels: ALL_CHANNELS,
    createDraft: (order) => baseAction(order, "branch"),
    summarize: (draft) =>
      `${draft.branchConditionField} ${draft.branchConditionOperator} ${
        draft.branchConditionValue.trim() || "—"
      }${draft.branchTargetActionId ? "" : " · sem destino"}`,
  },
  apply_tag: {
    type: "apply_tag",
    label: "Adicionar tag",
    description: "Marca o contato com uma tag.",
    icon: Tag,
    tone: "ok",
    category: "crm",
    channels: ALL_CHANNELS,
    createDraft: (order) => baseAction(order, "apply_tag"),
    summarize: (draft) => (draft.tagId ? `Aplica tag #${draft.tagId}` : "Selecione a tag"),
  },
  remove_tag: {
    type: "remove_tag",
    label: "Remover tag",
    description: "Remove uma tag do contato.",
    icon: Tags,
    tone: "ok",
    category: "crm",
    channels: ALL_CHANNELS,
    createDraft: (order) => baseAction(order, "remove_tag"),
    summarize: (draft) => (draft.tagId ? `Remove tag #${draft.tagId}` : "Selecione a tag"),
  },
  set_status: {
    type: "set_status",
    label: "Atualizar status",
    description: "Atualiza o status do contato no CRM.",
    icon: Activity,
    tone: "ok",
    category: "crm",
    channels: ALL_CHANNELS,
    createDraft: (order) => baseAction(order, "set_status"),
    summarize: (draft) => `Status → ${draft.status.trim() || "—"}`,
  },
  create_reminder: {
    type: "create_reminder",
    label: "Criar lembrete",
    description: "Agenda um lembrete para a equipe.",
    icon: CalendarClock,
    tone: "warn",
    category: "actions",
    channels: ALL_CHANNELS,
    createDraft: (order) => baseAction(order, "create_reminder"),
    summarize: (draft) =>
      draft.dueAt
        ? `${draft.reminderTitle.trim() || "Lembrete"} · ${new Date(draft.dueAt).toLocaleString("pt-BR")}`
        : `${draft.reminderTitle.trim() || "Lembrete"} · defina a data`,
  },
  notify_attendant: {
    type: "notify_attendant",
    label: "Notificar atendente",
    description: "Handoff humano com mensagem interna.",
    icon: BellRing,
    tone: "warn",
    category: "actions",
    channels: ALL_CHANNELS,
    createDraft: (order) => baseAction(order, "notify_attendant"),
    summarize: (draft) => draft.notifyMessage.trim() || "Mensagem interna pendente",
  },
  trigger_automation: {
    type: "trigger_automation",
    label: "Disparar automação",
    description: "Aciona outra automação (com guarda anti-loop).",
    icon: Workflow,
    tone: "neutral",
    category: "actions",
    channels: ALL_CHANNELS,
    createDraft: (order) => baseAction(order, "trigger_automation"),
    summarize: (draft) =>
      draft.triggerAutomationId
        ? `Aciona automação #${draft.triggerAutomationId}`
        : "Selecione a automação filha",
  },
};

export const actionDefinitions: ActionDefinition[] = Object.values(actionRegistry);

/* ------------------------------------------------------------------------- */
/* Triggers (rendered as the entry node + edited in flow settings)            */
/* ------------------------------------------------------------------------- */

export const triggerOptions: Array<{
  value: AutomationTrigger["type"];
  label: string;
  description: string;
}> = [
  {
    value: "message_received",
    label: "Mensagem recebida",
    description: "Dispara quando o contato envia mensagem.",
  },
  {
    value: "campaign_completed",
    label: "Campanha concluída",
    description: "Dispara ao final de uma campanha.",
  },
  { value: "tag_applied", label: "Tag aplicada", description: "Dispara ao aplicar uma tag." },
  { value: "tag_removed", label: "Tag removida", description: "Dispara ao remover uma tag." },
];

export const triggerIcon: Record<AutomationTrigger["type"], LucideIcon> = {
  message_received: MailQuestion,
  campaign_completed: Megaphone,
  tag_applied: Tag,
  tag_removed: Tags,
};

export function triggerLabel(type: AutomationTrigger["type"]): string {
  return triggerOptions.find((option) => option.value === type)?.label ?? type;
}

/* ------------------------------------------------------------------------- */
/* Block library models (left sidebar)                                        */
/* ------------------------------------------------------------------------- */

export type LibraryBlockKey = `step:${BuilderStepType}` | `action:${BuilderActionType}`;

export interface LibraryBlock {
  key: LibraryBlockKey;
  label: string;
  description: string;
  icon: LucideIcon;
  tone: NodeTone;
  category: LibraryCategoryId;
  channels: ChannelType[];
}

export function campaignLibraryBlocks(): LibraryBlock[] {
  return Object.values(stepRegistry).map((definition) => ({
    key: `step:${definition.type}` as const,
    label: definition.label,
    description: definition.description,
    icon: definition.icon,
    tone: definition.tone,
    category: definition.category,
    channels: definition.channels,
  }));
}

export function automationLibraryBlocks(): LibraryBlock[] {
  const messageBlocks = Object.values(stepRegistry).map((definition) => ({
    key: `step:${definition.type}` as const,
    label: definition.label,
    description: definition.description,
    icon: definition.icon,
    tone: definition.tone,
    category: definition.category,
    channels: definition.channels,
  }));
  const actionBlocks = Object.values(actionRegistry)
    .filter((definition) => definition.type !== "send_step")
    .map((definition) => ({
      key: `action:${definition.type}` as const,
      label: definition.label,
      description: definition.description,
      icon: definition.icon,
      tone: definition.tone,
      category: definition.category,
      channels: definition.channels,
    }));
  return [...messageBlocks, ...actionBlocks];
}
