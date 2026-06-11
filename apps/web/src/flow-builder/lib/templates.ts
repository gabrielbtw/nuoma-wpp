import type { AutomationTrigger } from "@nuoma/contracts";

import { newActionDraft, newStepDraft, type ActionDraft, type StepDraft } from "./build-steps.js";
import type { SegmentDraft } from "./segment.js";

export interface CampaignTemplate {
  id: string;
  name: string;
  description: string;
  evergreen: boolean;
  steps: Array<Partial<StepDraft> & Pick<StepDraft, "label" | "type">>;
}

export interface AutomationTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  triggerType: AutomationTrigger["type"];
  requireWithin24hWindow: boolean;
  actions: ActionDraft[];
  segmentDrafts: SegmentDraft[];
}

export const campaignTemplates: CampaignTemplate[] = [
  {
    id: "reactivation",
    name: "Reativação WA",
    description: "Mensagem curta, espera resposta e encerra se o lead interagir.",
    evergreen: true,
    steps: [
      {
        label: "Abrir conversa",
        type: "text",
        template: "Oi {{nome}}, posso te mandar uma atualização rápida?",
        delaySeconds: "0",
        conditions: [
          {
            id: "template-reactivation-replied",
            type: "replied",
            action: "exit",
            value: "",
            targetStepId: "",
          },
        ],
      },
      {
        label: "Follow-up",
        type: "text",
        template:
          "Passando só para não deixar seu retorno esfriar. Quer que eu te explique por aqui?",
        delaySeconds: "86400",
      },
    ],
  },
  {
    id: "quote",
    name: "Orçamento com link",
    description: "Texto inicial + link com preview para orçamento ou landing page.",
    evergreen: false,
    steps: [
      {
        label: "Contexto",
        type: "text",
        template: "Olá {{nome}}, deixei o orçamento organizado para você.",
        delaySeconds: "0",
      },
      {
        label: "Link do orçamento",
        type: "link",
        linkText: "Abrir orçamento",
        url: "https://nuoma.com.br",
        previewEnabled: true,
        delaySeconds: "30",
      },
    ],
  },
  {
    id: "twenty-four-hour",
    name: "Janela 24h",
    description: "Sequência que aguarda quando a conversa está fora da janela ativa.",
    evergreen: false,
    steps: [
      {
        label: "Checar janela",
        type: "text",
        template: "Oi {{nome}}, consigo continuar seu atendimento por aqui?",
        delaySeconds: "0",
        conditions: [
          {
            id: "template-window-wait",
            type: "outside_window",
            action: "wait",
            value: "24h",
            targetStepId: "",
          },
        ],
      },
    ],
  },
];

export const automationTemplates: AutomationTemplate[] = [
  {
    id: "reply-then-tag",
    name: "Responder e taguear",
    category: "Atendimento",
    description: "Envia uma resposta curta, aplica tag e cria trilha auditável.",
    triggerType: "message_received",
    requireWithin24hWindow: true,
    actions: [
      {
        ...newActionDraft(1),
        step: {
          ...newStepDraft(1),
          label: "Resposta inicial",
          template: "Recebi sua mensagem e vou te ajudar.",
        },
      },
      { ...newActionDraft(2), type: "apply_tag", tagId: "1" },
    ],
    segmentDrafts: [
      { id: "template-status", field: "status", operator: "neq", value: "bloqueado" },
    ],
  },
  {
    id: "delay-branch",
    name: "Delay + branch",
    category: "Follow-up",
    description: "Aguarda antes do follow-up e registra um branch de elegibilidade.",
    triggerType: "message_received",
    requireWithin24hWindow: false,
    actions: [
      {
        ...newActionDraft(1),
        type: "delay",
        delayActionSeconds: "3600",
        delayLabel: "Aguardar 1h",
      },
      {
        ...newActionDraft(2),
        type: "branch",
        branchLabel: "Se ainda ativo",
        branchConditionField: "status",
        branchConditionOperator: "neq",
        branchConditionValue: "arquivado",
      },
      {
        ...newActionDraft(3),
        step: {
          ...newStepDraft(3),
          label: "Follow-up",
          template: "Passando para retomar seu atendimento.",
        },
      },
    ],
    segmentDrafts: [],
  },
  {
    id: "notify-and-trigger",
    name: "Escalar atendimento",
    category: "Operação",
    description: "Notifica atendente e aciona uma automação filha com guarda anti-loop.",
    triggerType: "tag_applied",
    requireWithin24hWindow: false,
    actions: [
      {
        ...newActionDraft(1),
        type: "notify_attendant",
        notifyMessage: "Lead precisa de retorno humano.",
      },
      { ...newActionDraft(2), type: "trigger_automation", triggerAutomationId: "1" },
    ],
    segmentDrafts: [
      { id: "template-channel", field: "channel", operator: "eq", value: "whatsapp" },
    ],
  },
];
