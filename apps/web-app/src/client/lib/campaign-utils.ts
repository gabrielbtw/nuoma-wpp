export type CampaignStepDraft = {
  id?: string;
  type: "text" | "audio" | "image" | "video" | "wait" | "ADD_TAG" | "REMOVE_TAG";
  content: string;
  mediaPath?: string | null;
  waitMinutes?: number | null;
  caption?: string;
  tagName?: string | null;
  channelScope: "any" | "whatsapp" | "instagram";
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
  steps: CampaignStepDraft[];
  totalRecipients?: number;
  processedRecipients?: number;
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
  { value: "audio", label: "Áudio", description: "Envio de áudio gravado pela campanha." },
  { value: "image", label: "Imagem", description: "Mensagem com imagem e legenda opcional." },
  { value: "video", label: "Vídeo", description: "Mensagem com vídeo e legenda opcional." },
  { value: "wait", label: "Espera", description: "Pausa controlada antes da próxima etapa." },
  { value: "ADD_TAG", label: "Adicionar tag", description: "Inclui uma tag no cadastro vinculado antes de seguir o fluxo." },
  { value: "REMOVE_TAG", label: "Remover tag", description: "Remove uma tag do cadastro vinculado antes de seguir o fluxo." }
] as const;

export const emptyCampaignStep = (): CampaignStepDraft => ({
  type: "text",
  content: "",
  mediaPath: null,
  waitMinutes: null,
  caption: "",
  tagName: null,
  channelScope: "any"
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

  return {
    ...step,
    type,
    waitMinutes: null,
    tagName: null
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
    issues.push("Selecione ao menos um canal elegível.");
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
      issues.push(`${label}: o escopo da etapa precisa estar entre os canais elegíveis.`);
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

    if (step.type !== "text" && !hasMedia) {
      issues.push(`${label}: envie a midia correspondente.`);
    }

    if (!hasText && !hasCaption && !hasMedia) {
      issues.push(`${label}: preencha conteudo ou legenda.`);
    }
  });

  return [...new Set(issues)];
}
