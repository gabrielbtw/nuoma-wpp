import type { z } from "zod";

import type { attendantSchema } from "./attendants.js";
import type { automationSchema } from "./automations.js";
import type { campaignSchema } from "./campaigns.js";
import type { chatbotRuleSchema, chatbotSchema } from "./chatbots.js";
import type { contactSchema } from "./contacts.js";
import type { conversationSchema } from "./conversations.js";
import type { jobSchema } from "./jobs.js";
import type { mediaAssetSchema } from "./media-assets.js";
import type { messageSchema } from "./messages.js";
import type { reminderSchema } from "./reminders.js";
import type { tagSchema } from "./tags.js";
import type { userSchema } from "./users.js";

const now = "2026-04-30T12:00:00.000-03:00";
const observed = "2026-04-30T15:00:42.123Z";

export const userFixture = {
  id: 1,
  email: "admin@nuoma.local",
  role: "admin",
  displayName: "Gabriel",
  lastLoginAt: now,
  isActive: true,
  createdAt: now,
  updatedAt: now,
} satisfies z.input<typeof userSchema>;

export const contactFixture = {
  id: 10,
  userId: 1,
  name: "Contato Teste",
  phone: null,
  email: null,
  primaryChannel: "instagram",
  instagramHandle: "contato.teste",
  status: "active",
  tagIds: [30],
  notes: "Contato sem telefone permitido para Instagram.",
  lastMessageAt: now,
  profilePhotoMediaAssetId: null,
  profilePhotoSha256: null,
  profilePhotoUpdatedAt: null,
  deletedAt: null,
  createdAt: now,
  updatedAt: now,
} satisfies z.input<typeof contactSchema>;

export const conversationFixture = {
  id: 20,
  userId: 1,
  contactId: 10,
  channel: "whatsapp",
  externalThreadId: "5531982066263@c.us",
  title: "Contato Teste",
  lastMessageAt: now,
  lastPreview: "Mensagem recebida",
  unreadCount: 0,
  isArchived: false,
  temporaryMessagesUntil: null,
  profilePhotoMediaAssetId: null,
  profilePhotoSha256: null,
  profilePhotoUpdatedAt: null,
  createdAt: now,
  updatedAt: now,
} satisfies z.input<typeof conversationSchema>;

export const messageFixture = {
  id: 40,
  userId: 1,
  conversationId: 20,
  contactId: 10,
  externalId: "wamid.test-1",
  direction: "inbound",
  contentType: "text",
  status: "received",
  body: "Mensagem recebida",
  media: null,
  quotedMessageId: null,
  waDisplayedAt: "2026-04-30T12:00:00.000-03:00",
  timestampPrecision: "minute",
  messageSecond: null,
  waInferredSecond: 59,
  observedAtUtc: observed,
  editedAt: null,
  deletedAt: null,
  raw: {
    source: "whatsapp-web",
  },
  createdAt: now,
  updatedAt: now,
} satisfies z.input<typeof messageSchema>;

export const tagFixture = {
  id: 30,
  userId: 1,
  name: "Lead quente",
  color: "#22C55E",
  description: "Contato com interesse ativo.",
  createdAt: now,
  updatedAt: now,
} satisfies z.input<typeof tagSchema>;

export const mediaAssetFixture = {
  id: 50,
  userId: 1,
  type: "voice",
  fileName: "voice-3s.wav",
  mimeType: "audio/wav",
  sha256: "d0e423593a1c0000000000000000000000000000000000000000000000000000",
  sizeBytes: 288044,
  durationMs: 3000,
  storagePath: "media/voice-3s.wav",
  sourceUrl: null,
  deletedAt: null,
  createdAt: now,
  updatedAt: now,
} satisfies z.input<typeof mediaAssetSchema>;

export const campaignFixture = {
  id: 60,
  userId: 1,
  name: "Reativacao",
  status: "draft",
  channel: "whatsapp",
  segment: {
    operator: "and",
    conditions: [
      {
        field: "tag",
        operator: "in",
        value: [30],
      },
    ],
  },
  steps: [
    {
      id: "step-1",
      type: "text",
      label: "Abertura",
      template: "Oi {{nome}}, tudo bem?",
      delaySeconds: 0,
      conditions: [
        {
          type: "outside_window",
          action: "wait",
          value: "24h",
          targetStepId: null,
        },
      ],
    },
  ],
  evergreen: false,
  startsAt: null,
  completedAt: null,
  metadata: {},
  createdAt: now,
  updatedAt: now,
} satisfies z.input<typeof campaignSchema>;

export const automationFixture = {
  id: 70,
  userId: 1,
  name: "Resposta apos mensagem",
  category: "Relacionamento",
  status: "active",
  trigger: {
    type: "message_received",
    channel: "whatsapp",
  },
  condition: {
    segment: null,
    requireWithin24hWindow: true,
  },
  actions: [
    {
      type: "apply_tag",
      tagId: 30,
    },
  ],
  metadata: {},
  createdAt: now,
  updatedAt: now,
} satisfies z.input<typeof automationSchema>;

export const chatbotFixture = {
  id: 80,
  userId: 1,
  name: "FAQ WhatsApp",
  channel: "whatsapp",
  status: "draft",
  fallbackMessage: null,
  metadata: {},
  createdAt: now,
  updatedAt: now,
} satisfies z.input<typeof chatbotSchema>;

export const chatbotRuleFixture = {
  id: 81,
  userId: 1,
  chatbotId: 80,
  name: "Preco",
  priority: 10,
  match: {
    type: "contains",
    value: "preco",
  },
  segment: null,
  actions: [
    {
      type: "send_step",
      step: {
        id: "reply-1",
        type: "text",
        label: "Resposta",
        template: "Vou te mandar as opcoes.",
        delaySeconds: 0,
        conditions: [],
      },
    },
  ],
  isActive: true,
  metadata: {},
  createdAt: now,
  updatedAt: now,
} satisfies z.input<typeof chatbotRuleSchema>;

export const attendantFixture = {
  id: 90,
  userId: 1,
  userAccountId: 1,
  name: "Atendente",
  email: "atendente@nuoma.local",
  role: "attendant",
  isActive: true,
  createdAt: now,
  updatedAt: now,
} satisfies z.input<typeof attendantSchema>;

export const jobFixture = {
  id: 100,
  userId: 1,
  type: "send_message",
  status: "queued",
  payload: {
    conversationId: 20,
    message: "Oi",
  },
  priority: 5,
  dedupeKey: "send_message:20:step-1",
  dedupeExpiresAt: "2026-04-30T16:00:00.000Z",
  scheduledAt: observed,
  claimedAt: null,
  claimedBy: null,
  attempts: 0,
  maxAttempts: 3,
  lastError: null,
  completedAt: null,
  createdAt: now,
  updatedAt: now,
} satisfies z.input<typeof jobSchema>;

export const reminderFixture = {
  id: 110,
  userId: 1,
  contactId: 10,
  conversationId: 20,
  assignedToUserId: 1,
  title: "Retornar contato",
  notes: null,
  dueAt: "2026-05-01T09:00:00.000-03:00",
  status: "open",
  completedAt: null,
  createdAt: now,
  updatedAt: now,
} satisfies z.input<typeof reminderSchema>;

export const entityFixtures = {
  user: userFixture,
  contact: contactFixture,
  conversation: conversationFixture,
  message: messageFixture,
  tag: tagFixture,
  mediaAsset: mediaAssetFixture,
  campaign: campaignFixture,
  automation: automationFixture,
  chatbot: chatbotFixture,
  chatbotRule: chatbotRuleFixture,
  attendant: attendantFixture,
  job: jobFixture,
  reminder: reminderFixture,
} as const;
