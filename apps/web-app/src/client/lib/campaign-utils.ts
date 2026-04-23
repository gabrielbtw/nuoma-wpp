export type ConditionType = "replied" | "has_tag" | "channel_is" | "outside_window" | null;
export type ConditionAction = "skip" | "exit" | "jump_to_step" | "wait" | null;

export type CampaignStepDraft = {
  id?: string;
  type: "text" | "audio" | "image" | "video" | "document" | "link" | "wait" | "ADD_TAG" | "REMOVE_TAG";
  content: string;
  mediaPath?: string | null;
  waitMinutes?: number | null;
  caption?: string;
  tagName?: string | null;
  channelScope: "any" | "whatsapp" | "instagram";
  templateId?: string | null;
  conditionType?: ConditionType;
  conditionValue?: string | null;
  conditionAction?: ConditionAction;
  conditionJumpTo?: number | null;
  attendantId?: string | null;
};

export type CampaignDraft = {
  id?: string;
  name: string;
  description: string;
  status: "draft" | "ready" | "active" | "paused" | "completed" | "cancelled" | "failed" | string;
  sendWindowStart: string;
  sendWindowEnd: string;
  rateLimitCount: number;
  rateLimitWindowMinutes: number;
  randomDelayMinSeconds: number;
  randomDelayMaxSeconds: number;
  eligibleChannels: Array<"whatsapp" | "instagram">;
  isEvergreen?: boolean;
  evergreenCriteria?: Record<string, unknown>;
  steps: CampaignStepDraft[];
  totalRecipients?: number;
  processedRecipients?: number;
};

export type TemplateRecord = {
  id: string;
  name: string;
  contentType: string;
  body: string;
  mediaPath: string | null;
  category: string;
  createdAt: string;
  updatedAt: string;
};

export const campaignStatusOptions = [
  { value: "draft", label: "Rascunho" },
  { value: "ready", label: "Pronta" },
  { value: "active", label: "Ativa" },
  { value: "paused", label: "Pausada" },
  { value: "completed", label: "Concluida" },
  { value: "cancelled", label: "Cancelada" },
  { value: "failed", label: "Com falha" }
] as const;

export const campaignStepOptions = [
  { value: "text", label: "Texto", description: "Mensagem simples enviada direto no fluxo." },
  { value: "audio", label: "Audio", description: "Envio de audio gravado pela campanha." },
  { value: "image", label: "Imagem", description: "Mensagem com imagem e legenda opcional." },
  { value: "video", label: "Video", description: "Mensagem com video e legenda opcional." },
  { value: "document", label: "Documento", description: "Envio de PDF ou documento." },
  { value: "link", label: "Link", description: "Envio de link com texto descritivo." },
  { value: "wait", label: "Espera", description: "Pausa controlada antes da proxima etapa." },
  { value: "ADD_TAG", label: "Adicionar tag", description: "Inclui uma tag no cadastro vinculado." },
  { value: "REMOVE_TAG", label: "Remover tag", description: "Remove uma tag do cadastro vinculado." }
] as const;

export const conditionTypeOptions = [
  { value: "replied", label: "Se respondeu", description: "Contato respondeu alguma mensagem" },
  { value: "has_tag", label: "Se tem tag", description: "Contato possui uma tag especifica" },
  { value: "channel_is", label: "Se canal e", description: "Contato esta num canal especifico" },
  { value: "outside_window", label: "Fora da janela", description: "Fora do horario de envio" }
] as const;

export const conditionActionOptions = [
  { value: "skip", label: "Pular step", description: "Pula esta etapa e vai pra proxima" },
  { value: "exit", label: "Sair da campanha", description: "Remove o contato da campanha" },
  { value: "jump_to_step", label: "Ir para step", description: "Desvia para uma etapa especifica" },
  { value: "wait", label: "Aguardar", description: "Aguarda ate a condicao mudar" }
] as const;

export const emptyCampaignStep = (): CampaignStepDraft => ({
  type: "text",
  content: "",
  mediaPath: null,
  waitMinutes: null,
  caption: "",
  tagName: null,
  channelScope: "any",
  templateId: null,
  conditionType: null,
  conditionValue: null,
  conditionAction: null,
  conditionJumpTo: null
});

export const emptyCampaignDraft = (): CampaignDraft => ({
  name: "",
  description: "",
  status: "draft",
  sendWindowStart: "08:00",
  sendWindowEnd: "20:00",
  rateLimitCount: 30,
  rateLimitWindowMinutes: 60,
  randomDelayMinSeconds: 15,
  randomDelayMaxSeconds: 60,
  eligibleChannels: ["whatsapp"],
  isEvergreen: false,
  evergreenCriteria: {},
  steps: [emptyCampaignStep()],
  totalRecipients: 0,
  processedRecipients: 0
});

export function statusLabel(status: string) {
  return campaignStatusOptions.find((item) => item.value === status)?.label ?? status;
}

export function statusTone(status: string): "success" | "warning" | "danger" | "info" | "default" {
  switch (status) {
    case "active":
      return "success";
    case "paused":
      return "warning";
    case "failed":
      return "danger";
    case "ready":
      return "info";
    default:
      return "default";
  }
}

export function formatCampaignDateTime(value?: string | null) {
  if (!value) {
    return "Sem data";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

export function normalizeCampaignStepForType(step: CampaignStepDraft, type: CampaignStepDraft["type"]): CampaignStepDraft {
  if (type === "wait") {
    return {
      ...step,
      type,
      waitMinutes: step.waitMinutes ?? 5,
      mediaPath: null,
      caption: "",
      tagName: null
    };
  }

  if (type === "ADD_TAG" || type === "REMOVE_TAG") {
    return {
      ...step,
      type,
      content: "",
      mediaPath: null,
      waitMinutes: null,
      caption: "",
      tagName: step.tagName ?? ""
    };
  }

  if (type === "link") {
    return {
      ...step,
      type,
      waitMinutes: null,
      tagName: null,
      mediaPath: null
    };
  }

  return {
    ...step,
    type,
    waitMinutes: null,
    tagName: null,
    attendantId: type === "audio" ? (step.attendantId ?? null) : null
  };
}

export function normalizeCampaignDraft(draft: CampaignDraft): CampaignDraft {
  return {
    ...draft,
    eligibleChannels: draft.eligibleChannels?.length ? draft.eligibleChannels : ["whatsapp"],
    steps:
      draft.steps.length > 0
        ? draft.steps.map((step) => {
            if (step.type === "wait" && step.waitMinutes == null) {
              return { ...step, waitMinutes: 5, tagName: null, channelScope: step.channelScope ?? "any" };
            }

            return {
              ...step,
              tagName: step.tagName ?? null,
              channelScope: step.channelScope ?? "any"
            };
          })
        : [emptyCampaignStep()]
  };
}

export function getCampaignActivationIssues(campaign: CampaignDraft | null | undefined) {
  if (!campaign) {
    return [];
  }

  const issues: string[] = [];

  if (!campaign.name.trim()) {
    issues.push("Defina um nome para a campanha.");
  }

  if (!campaign.eligibleChannels.length) {
    issues.push("Selecione ao menos um canal elegivel.");
  }

  if (campaign.sendWindowStart === campaign.sendWindowEnd) {
    issues.push("A janela de envio precisa ter inicio e fim diferentes.");
  }

  if (campaign.randomDelayMaxSeconds < campaign.randomDelayMinSeconds) {
    issues.push("O delay maximo nao pode ser menor que o delay minimo.");
  }

  if ((campaign.totalRecipients ?? 0) <= 0) {
    issues.push("Importe destinatarios antes de ativar.");
  }

  if (campaign.steps.length === 0) {
    issues.push("Adicione ao menos uma etapa.");
  }

  campaign.steps.forEach((step, index) => {
    const label = `Etapa ${index + 1}`;
    const hasText = step.content.trim().length > 0;
    const hasCaption = String(step.caption ?? "").trim().length > 0;
    const hasMedia = Boolean(step.mediaPath);

    if (step.type === "wait") {
      if (!step.waitMinutes || step.waitMinutes < 1) {
        issues.push(`${label}: informe um tempo de espera valido.`);
      }
      return;
    }

    if (step.channelScope !== "any" && !campaign.eligibleChannels.includes(step.channelScope)) {
      issues.push(`${label}: o escopo da etapa precisa estar entre os canais elegiveis.`);
    }

    if (step.type === "ADD_TAG" || step.type === "REMOVE_TAG") {
      if (!step.tagName?.trim()) {
        issues.push(`${label}: informe a tag que sera alterada.`);
      }
      return;
    }

    if (step.type === "text" && !hasText) {
      issues.push(`${label}: mensagem obrigatoria.`);
    }

    if (step.type === "link" && !hasText) {
      issues.push(`${label}: URL obrigatoria.`);
    }

    if (step.type === "document" && !hasMedia) {
      issues.push(`${label}: envie o documento.`);
    }

    if ((step.type === "audio" || step.type === "image" || step.type === "video") && !hasMedia) {
      issues.push(`${label}: envie a midia correspondente.`);
    }

    if (!hasText && !hasCaption && !hasMedia) {
      issues.push(`${label}: preencha conteudo ou legenda.`);
    }
  });

  return [...new Set(issues)];
}

/** Estimate total campaign duration in minutes based on wait steps */
export function estimateCampaignDuration(steps: CampaignStepDraft[]): number {
  return steps.reduce((total, step) => {
    if (step.type === "wait" && step.waitMinutes) {
      return total + step.waitMinutes;
    }
    return total;
  }, 0);
}

/** Format minutes as human-readable duration */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}min`;
}
