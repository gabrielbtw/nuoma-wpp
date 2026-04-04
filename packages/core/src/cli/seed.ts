import { createAutomation, createCampaign, createContact, createTag, getDb, listAutomations, listCampaigns, listContacts, listTags } from "../index.js";

getDb();

if (listTags().length === 0) {
  createTag({ name: "vip", color: "#4ade80", type: "manual", active: true });
  createTag({ name: "follow-up", color: "#38bdf8", type: "manual", active: true });
  createTag({ name: "pos", color: "#f59e0b", type: "manual", active: true });
  createTag({ name: "nao_insistir", color: "#fb7185", type: "manual", active: true });
}

if (listContacts().length === 0) {
  createContact({
    name: "Ana Martins",
    phone: "5511999991111",
    cpf: null,
    email: "ana@example.com",
    instagram: "@ana.martins",
    procedureStatus: "unknown",
    lastAttendant: "Operador Local",
    notes: "Lead de teste com tag de follow-up.",
    status: "aguardando_resposta",
    tags: ["vip", "follow-up"],
    lastInteractionAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    lastProcedureAt: null
  });

  createContact({
    name: "Carlos Lima",
    phone: "5511988882222",
    cpf: null,
    email: "carlos@example.com",
    instagram: "@carloslima",
    procedureStatus: "yes",
    lastAttendant: "Operador Local",
    notes: "Cliente seed para pós-procedimento.",
    status: "cliente",
    tags: ["pos"],
    lastInteractionAt: new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString(),
    lastProcedureAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
  });
}

if (listAutomations().length === 0) {
  createAutomation({
    name: "Follow-up VIP",
    category: "follow-up",
    enabled: true,
    description: "Dispara follow-up apenas para contatos VIP sem resposta.",
    triggerTags: ["follow-up"],
    excludeTags: ["nao_insistir"],
    requiredStatus: "aguardando_resposta",
    procedureOnly: false,
    requireLastOutgoing: true,
    requireNoReply: true,
    timeWindowHours: 24,
    minimumIntervalHours: 72,
    randomDelayMinSeconds: 10,
    randomDelayMaxSeconds: 30,
    sendWindowStart: "08:00",
    sendWindowEnd: "20:00",
    templateKey: null,
    actions: [
      {
        type: "send-text",
        content: "Oi! Passando para saber se você quer retomar seu atendimento.",
        mediaPath: null,
        waitSeconds: null,
        tagName: null,
        reminderText: null,
        metadata: {}
      }
    ]
  });

  createAutomation({
    name: "Pós-procedimento padrão",
    category: "pos-procedimento",
    enabled: true,
    description: "Fluxo base com mensagem, material e lembrete interno.",
    triggerTags: ["pos"],
    excludeTags: ["nao_insistir"],
    requiredStatus: "cliente",
    procedureOnly: true,
    requireLastOutgoing: false,
    requireNoReply: false,
    timeWindowHours: 6,
    minimumIntervalHours: 168,
    randomDelayMinSeconds: 15,
    randomDelayMaxSeconds: 45,
    sendWindowStart: "08:00",
    sendWindowEnd: "20:00",
    templateKey: "padrao-pos",
    actions: [
      {
        type: "send-text",
        content: "Segue o material de orientação do seu pós-procedimento.",
        mediaPath: null,
        waitSeconds: null,
        tagName: null,
        reminderText: null,
        metadata: {}
      },
      {
        type: "wait",
        content: "",
        mediaPath: null,
        waitSeconds: 120,
        tagName: null,
        reminderText: null,
        metadata: {}
      },
      {
        type: "create-reminder",
        content: "Revisar cliente em 24h.",
        mediaPath: null,
        waitSeconds: null,
        tagName: null,
        reminderText: "Checar resposta do cliente de pós-procedimento",
        metadata: {}
      }
    ]
  });
}

if (listCampaigns().length === 0) {
  createCampaign({
    name: "Campanha Demo Draft",
    description: "Fluxo linear simples com espera entre duas mensagens.",
    status: "draft",
    eligibleChannels: ["whatsapp"],
    sendWindowStart: "08:00",
    sendWindowEnd: "20:00",
    rateLimitCount: 20,
    rateLimitWindowMinutes: 60,
    randomDelayMinSeconds: 20,
    randomDelayMaxSeconds: 40,
    isEvergreen: false,
    evergreenCriteria: {},
    steps: [
      {
        type: "text",
        content: "Olá! Esta é uma campanha demo do Nuoma WPP.",
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
      },
      {
        type: "wait",
        content: "",
        mediaPath: null,
        waitMinutes: 60,
        caption: "",
        tagName: null,
        channelScope: "any",
        templateId: null,
        conditionType: null,
        conditionValue: null,
        conditionAction: null,
        conditionJumpTo: null
      },
      {
        type: "text",
        content: "Se quiser falar com a equipe, é só responder aqui.",
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
      }
    ]
  });
}

console.log("Seed data inserted.");
