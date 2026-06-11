import type { CampaignStepCondition } from "@nuoma/contracts";

import type { BuilderActionType, BuilderStepType } from "./build-steps.js";
import type { SegmentField, SegmentOperator } from "./segment.js";

export type BuilderTab = "base" | "audience" | "steps" | "preview";

export const stepTypes: Array<{ value: BuilderStepType; label: string }> = [
  { value: "temporary_messages", label: "Mensagens temporárias" },
  { value: "text", label: "Texto" },
  { value: "link", label: "Link" },
  { value: "voice", label: "Áudio" },
  { value: "image", label: "Imagem" },
  { value: "video", label: "Vídeo" },
  { value: "document", label: "Documento" },
];

export const temporaryMessagesDurations: Array<{
  value: "24h" | "7d" | "90d";
  label: string;
}> = [
  { value: "24h", label: "24 horas" },
  { value: "7d", label: "7 dias" },
  { value: "90d", label: "90 dias" },
];

export const actionTypes: Array<{ value: BuilderActionType; label: string }> = [
  { value: "send_step", label: "Enviar step" },
  { value: "delay", label: "Delay" },
  { value: "branch", label: "Branch" },
  { value: "apply_tag", label: "Aplicar tag" },
  { value: "remove_tag", label: "Remover tag" },
  { value: "set_status", label: "Definir status" },
  { value: "create_reminder", label: "Criar lembrete" },
  { value: "notify_attendant", label: "Notificar atendente" },
  { value: "trigger_automation", label: "Disparar automação" },
];

export const conditionTypes: Array<{ value: CampaignStepCondition["type"]; label: string }> = [
  { value: "replied", label: "Respondeu" },
  { value: "has_tag", label: "Tem tag" },
  { value: "channel_is", label: "Canal é" },
  { value: "outside_window", label: "Fora 24h" },
];

export const conditionActions: Array<{
  value: CampaignStepCondition["action"];
  label: string;
}> = [
  { value: "exit", label: "Sair" },
  { value: "branch", label: "Ir para step" },
  { value: "skip", label: "Pular" },
  { value: "wait", label: "Aguardar" },
];

export const segmentFields: Array<{ value: SegmentField; label: string }> = [
  { value: "tag", label: "Tag" },
  { value: "status", label: "Status" },
  { value: "channel", label: "Canal" },
  { value: "lastMessageAt", label: "Última msg" },
  { value: "createdAt", label: "Criado em" },
  { value: "procedure", label: "Procedimento" },
  { value: "instagramRelationship", label: "Relação IG" },
];

export const segmentOperators: Array<{ value: SegmentOperator; label: string }> = [
  { value: "eq", label: "=" },
  { value: "neq", label: "!=" },
  { value: "exists", label: "Existe" },
  { value: "not_exists", label: "Não existe" },
  { value: "before", label: "Antes" },
  { value: "after", label: "Depois" },
];

export const builderTabs: Array<{ value: BuilderTab; label: string; description: string }> = [
  { value: "base", label: "Base", description: "Nome, canal e templates" },
  { value: "audience", label: "Audiência", description: "Segmento e CSV" },
  { value: "steps", label: "Passos", description: "Mensagens e regras" },
  { value: "preview", label: "Preview", description: "Fluxo final" },
];
