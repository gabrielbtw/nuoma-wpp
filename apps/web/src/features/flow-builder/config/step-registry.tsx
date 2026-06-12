import type { ChannelType } from "@nuoma/contracts";
import {
  EyeOff,
  FileText,
  Image,
  Link2,
  MessageSquareText,
  Mic,
  Video,
  type LucideIcon,
} from "lucide-react";

import { newStepDraft, type BuilderStepType, type StepDraft } from "../../../flow-builder/lib/build-steps.js";
import { instagramSupportedStepTypes } from "../../../flow-builder/lib/validation.js";

/** Visual tone of a block — resolved to token-driven classes by FlowNodeCard. */
export type NodeTone = "accent" | "wa" | "ig" | "info" | "ok" | "warn" | "neutral" | "danger";

export type LibraryCategoryId = "messages" | "logic" | "crm" | "actions";

export const LIBRARY_CATEGORIES: Array<{ id: LibraryCategoryId; label: string }> = [
  { id: "messages", label: "Mensagens" },
  { id: "logic", label: "Lógica" },
  { id: "crm", label: "CRM / Contato" },
  { id: "actions", label: "Ações" },
];

export interface StepDefinition {
  type: BuilderStepType;
  label: string;
  description: string;
  icon: LucideIcon;
  tone: NodeTone;
  category: LibraryCategoryId;
  channels: ChannelType[];
  createDraft: (order: number) => StepDraft;
  summarize: (draft: StepDraft) => string;
}

function stepChannels(type: BuilderStepType): ChannelType[] {
  return instagramSupportedStepTypes.has(type) ? ["whatsapp", "instagram"] : ["whatsapp"];
}

function baseDraft(order: number, type: BuilderStepType, label: string): StepDraft {
  return { ...newStepDraft(order), type, label };
}

/**
 * Exhaustive map of every campaign step type the backend supports.
 * Keyed by the contract union — adding a backend variant fails typecheck here
 * until the frontend maps it (docs/flowbuilder-v2-frontend.md §7).
 */
export const stepRegistry: Record<BuilderStepType, StepDefinition> = {
  text: {
    type: "text",
    label: "Mensagem de texto",
    description: "Texto com variáveis como {{nome}}.",
    icon: MessageSquareText,
    tone: "accent",
    category: "messages",
    channels: stepChannels("text"),
    createDraft: (order) => baseDraft(order, "text", "Mensagem de texto"),
    summarize: (draft) => draft.template.trim() || "Mensagem vazia",
  },
  voice: {
    type: "voice",
    label: "Enviar áudio",
    description: "Voice note nativo (PTT).",
    icon: Mic,
    tone: "accent",
    category: "messages",
    channels: stepChannels("voice"),
    createDraft: (order) => ({ ...baseDraft(order, "voice", "Enviar áudio"), mediaAssetId: "" }),
    summarize: (draft) =>
      draft.mediaAssetId
        ? `Voice note · asset #${draft.mediaAssetId}`
        : "Selecione o áudio na configuração",
  },
  image: {
    type: "image",
    label: "Enviar imagem",
    description: "Imagem com legenda opcional.",
    icon: Image,
    tone: "accent",
    category: "messages",
    channels: stepChannels("image"),
    createDraft: (order) => ({ ...baseDraft(order, "image", "Enviar imagem"), mediaAssetId: "" }),
    summarize: (draft) =>
      draft.mediaAssetId
        ? `Imagem · asset #${draft.mediaAssetId}${draft.caption.trim() ? ` · ${draft.caption.trim()}` : ""}`
        : "Selecione a imagem na configuração",
  },
  video: {
    type: "video",
    label: "Enviar vídeo",
    description: "Vídeo com legenda opcional.",
    icon: Video,
    tone: "accent",
    category: "messages",
    channels: stepChannels("video"),
    createDraft: (order) => ({ ...baseDraft(order, "video", "Enviar vídeo"), mediaAssetId: "" }),
    summarize: (draft) =>
      draft.mediaAssetId
        ? `Vídeo · asset #${draft.mediaAssetId}${draft.caption.trim() ? ` · ${draft.caption.trim()}` : ""}`
        : "Selecione o vídeo na configuração",
  },
  document: {
    type: "document",
    label: "Enviar documento",
    description: "Arquivo com nome amigável.",
    icon: FileText,
    tone: "neutral",
    category: "messages",
    channels: stepChannels("document"),
    createDraft: (order) => ({
      ...baseDraft(order, "document", "Enviar documento"),
      mediaAssetId: "",
    }),
    summarize: (draft) =>
      draft.mediaAssetId
        ? `${draft.fileName.trim() || "Documento"} · asset #${draft.mediaAssetId}`
        : "Selecione o documento na configuração",
  },
  link: {
    type: "link",
    label: "Link",
    description: "Texto + URL com preview opcional.",
    icon: Link2,
    tone: "info",
    category: "messages",
    channels: stepChannels("link"),
    createDraft: (order) => baseDraft(order, "link", "Link"),
    summarize: (draft) =>
      [draft.linkText.trim() || "Link", draft.url.trim() || "URL pendente"].join(" · "),
  },
  temporary_messages: {
    type: "temporary_messages",
    label: "Mensagens temporárias",
    description: "Define expiração das mensagens no WhatsApp.",
    icon: EyeOff,
    tone: "warn",
    category: "logic",
    channels: stepChannels("temporary_messages"),
    createDraft: (order) => baseDraft(order, "temporary_messages", "Mensagens temporárias"),
    summarize: (draft) => `Expiração em ${draft.temporaryMessagesDuration}`,
  },
};

export const stepDefinitions: StepDefinition[] = Object.values(stepRegistry);

export function humanizeSeconds(raw: string | number): string {
  const seconds = typeof raw === "number" ? raw : Number.parseInt(raw || "0", 10) || 0;
  if (seconds <= 0) return "imediato";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3_600) {
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return rest ? `${minutes}min ${rest}s` : `${minutes}min`;
  }
  if (seconds < 86_400) {
    const hours = Math.floor(seconds / 3_600);
    const minutes = Math.floor((seconds % 3_600) / 60);
    return minutes ? `${hours}h ${minutes}min` : `${hours}h`;
  }
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  return hours ? `${days}d ${hours}h` : `${days}d`;
}
