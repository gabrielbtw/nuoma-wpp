import { z } from "zod";
import { isValidCpf, normalizeCpf } from "../utils/cpf.js";

export const contactProcedureStatusValues = ["yes", "no", "unknown"] as const;
export const contactStatusValues = ["novo", "aguardando_resposta", "em_atendimento", "cliente", "sem_retorno", "perdido"] as const;
export const conversationStatusValues = ["open", "waiting", "closed"] as const;
export const messageDirectionValues = ["incoming", "outgoing", "system"] as const;
export const messageContentTypeValues = ["text", "audio", "image", "video", "file", "summary"] as const;
export const automationCategoryValues = [
  "follow-up",
  "reativacao",
  "lead-antigo",
  "lista-fria",
  "pos-procedimento",
  "remarketing",
  "instagram-incoming"
] as const;
export const campaignStatusValues = ["draft", "ready", "active", "paused", "completed", "cancelled", "failed"] as const;
export const campaignStepTypeValues = ["text", "audio", "image", "video", "wait", "ADD_TAG", "REMOVE_TAG"] as const;
export const recipientStatusValues = ["pending", "processing", "sent", "failed", "skipped", "blocked_by_rule"] as const;
export const jobStatusValues = ["pending", "processing", "done", "failed"] as const;
export const jobTypeValues = ["send-message", "send-assisted-message", "sync-inbox", "restart-worker", "validate-recipient"] as const;
export const workerStatusValues = ["starting", "authenticated", "disconnected", "restarting", "degraded", "error"] as const;
export const automationActionTypeValues = [
  "send-text",
  "send-audio",
  "send-image",
  "send-video",
  "wait",
  "apply-tag",
  "remove-tag",
  "create-reminder"
] as const;
export const tagTypeValues = ["manual", "canal", "automacao", "sistema"] as const;
export const channelTypeValues = ["whatsapp", "instagram"] as const;
export const channelAccountStatusValues = ["connected", "assisted", "planned", "error"] as const;

export type ContactProcedureStatus = (typeof contactProcedureStatusValues)[number];
export type ContactStatus = (typeof contactStatusValues)[number];
export type ConversationStatus = (typeof conversationStatusValues)[number];
export type MessageDirection = (typeof messageDirectionValues)[number];
export type MessageContentType = (typeof messageContentTypeValues)[number];
export type AutomationCategory = (typeof automationCategoryValues)[number];
export type CampaignStatus = (typeof campaignStatusValues)[number];
export type CampaignStepType = (typeof campaignStepTypeValues)[number];
export type RecipientStatus = (typeof recipientStatusValues)[number];
export type JobStatus = (typeof jobStatusValues)[number];
export type JobType = (typeof jobTypeValues)[number];
export type WorkerStatus = (typeof workerStatusValues)[number];
export type AutomationActionType = (typeof automationActionTypeValues)[number];
export type TagType = (typeof tagTypeValues)[number];
export type ChannelType = (typeof channelTypeValues)[number];
export type ChannelAccountStatus = (typeof channelAccountStatusValues)[number];

const hhmmPattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const hhmmSchema = z.string().trim().regex(hhmmPattern, "Horário inválido. Use HH:mm.");
export const campaignChannelScopeValues = ["any", "whatsapp", "instagram"] as const;

const baseContactInputSchema = z.object({
  name: z.string().trim().default(""),
  phone: z.string().trim().optional().nullable().default(""),
  cpf: z
    .string()
    .optional()
    .nullable()
    .transform((value) => normalizeCpf(value))
    .refine((value) => value == null || isValidCpf(value), "CPF inválido"),
  email: z.string().trim().email("Email inválido").optional().or(z.literal("")).nullable().default(null),
  instagram: z.string().trim().optional().nullable().default(null),
  procedureStatus: z.enum(contactProcedureStatusValues).default("unknown"),
  lastAttendant: z.string().trim().optional().nullable().default(null),
  notes: z.string().trim().optional().nullable().default(null),
  status: z.enum(contactStatusValues).default("novo"),
  tags: z.array(z.string().trim().min(1)).default([]),
  lastInteractionAt: z.string().datetime().optional().nullable().default(null),
  lastProcedureAt: z.string().datetime().optional().nullable().default(null)
});

function refineContactChannels(
  value: Pick<z.infer<typeof baseContactInputSchema>, "phone" | "instagram">,
  ctx: z.RefinementCtx,
  mode: "create" | "patch"
) {
  const phone = (value.phone ?? "").trim();
  const instagram = (value.instagram ?? "").trim();
  const hasPhone = phone.length > 0;
  const hasInstagram = instagram.length > 0;

  if (hasPhone && phone.length < 6) {
    ctx.addIssue({
      code: "custom",
      path: ["phone"],
      message: "Telefone inválido"
    });
  }

  if (mode === "create" && !hasPhone && !hasInstagram) {
    ctx.addIssue({
      code: "custom",
      path: ["phone"],
      message: "Informe telefone ou Instagram."
    });
  }
}

export const contactInputSchema = baseContactInputSchema.superRefine((value, ctx) => {
  refineContactChannels(value, ctx, "create");
});

export const contactPatchSchema = baseContactInputSchema.partial().superRefine((value, ctx) => {
  refineContactChannels(
    {
      phone: value.phone ?? null,
      instagram: value.instagram ?? null
    },
    ctx,
    "patch"
  );
});

export type ContactInput = z.infer<typeof contactInputSchema>;

export const automationRuleInputSchema = z.object({
  name: z.string().trim().min(1),
  category: z.enum(automationCategoryValues),
  enabled: z.boolean().default(true),
  description: z.string().trim().optional().default(""),
  triggerTags: z.array(z.string().trim().min(1)).default([]),
  excludeTags: z.array(z.string().trim().min(1)).default(["nao_insistir"]),
  requiredStatus: z.enum(contactStatusValues).optional().nullable().default(null),
  procedureOnly: z.boolean().default(false),
  requireLastOutgoing: z.boolean().default(false),
  requireNoReply: z.boolean().default(false),
  timeWindowHours: z.coerce.number().int().min(1).max(24 * 30).default(24),
  minimumIntervalHours: z.coerce.number().int().min(1).max(24 * 60).default(72),
  randomDelayMinSeconds: z.coerce.number().int().min(0).max(3600).default(10),
  randomDelayMaxSeconds: z.coerce.number().int().min(0).max(3600).default(45),
  sendWindowStart: z.string().trim().default("08:00"),
  sendWindowEnd: z.string().trim().default("20:00"),
  templateKey: z.string().trim().optional().nullable().default(null),
  actions: z.array(
    z.object({
      id: z.string().trim().optional(),
      type: z.enum(automationActionTypeValues),
      content: z.string().trim().optional().default(""),
      mediaPath: z.string().trim().optional().nullable().default(null),
      waitSeconds: z.coerce.number().int().min(1).max(24 * 60 * 60).optional().nullable().default(null),
      tagName: z.string().trim().optional().nullable().default(null),
      reminderText: z.string().trim().optional().nullable().default(null),
      metadata: z.record(z.string(), z.unknown()).optional().default({})
    })
  ).min(1)
});

export type AutomationRuleInput = z.infer<typeof automationRuleInputSchema>;

export const tagInputSchema = z.object({
  name: z.string().trim().min(1),
  color: z.string().trim().default("#3ddc97"),
  type: z.enum(tagTypeValues).default("manual"),
  active: z.boolean().default(true)
});

export type TagInput = z.infer<typeof tagInputSchema>;

export const campaignStepInputSchema = z
  .object({
    id: z.string().trim().optional(),
    type: z.enum(campaignStepTypeValues),
    content: z.string().trim().optional().default(""),
    mediaPath: z.string().trim().optional().nullable().default(null),
    waitMinutes: z.coerce.number().int().min(1).max(24 * 60).optional().nullable().default(null),
    caption: z.string().trim().optional().default(""),
    tagName: z.string().trim().optional().nullable().default(null),
    channelScope: z.enum(campaignChannelScopeValues).default("any")
  })
  .superRefine((value, ctx) => {
    if (value.type === "wait" && value.waitMinutes == null) {
      ctx.addIssue({
        code: "custom",
        path: ["waitMinutes"],
        message: "Etapas de espera precisam informar os minutos."
      });
    }

    if ((value.type === "ADD_TAG" || value.type === "REMOVE_TAG") && !value.tagName?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["tagName"],
        message: "Etapas de tag precisam informar qual tag será alterada."
      });
    }
  });

export type CampaignStepInput = z.infer<typeof campaignStepInputSchema>;

export const campaignInputSchema = z
  .object({
    name: z.string().trim().min(1),
    description: z.string().trim().optional().default(""),
    status: z.enum(campaignStatusValues).default("draft"),
    eligibleChannels: z.array(z.enum(channelTypeValues)).min(1).default(["whatsapp"]),
    sendWindowStart: hhmmSchema.default("08:00"),
    sendWindowEnd: hhmmSchema.default("20:00"),
    rateLimitCount: z.coerce.number().int().min(1).max(1000).default(30),
    rateLimitWindowMinutes: z.coerce.number().int().min(1).max(24 * 60).default(60),
    randomDelayMinSeconds: z.coerce.number().int().min(0).max(3600).default(15),
    randomDelayMaxSeconds: z.coerce.number().int().min(0).max(3600).default(60),
    steps: z.array(campaignStepInputSchema).min(1)
  })
  .superRefine((value, ctx) => {
    if (value.sendWindowStart === value.sendWindowEnd) {
      ctx.addIssue({
        code: "custom",
        path: ["sendWindowEnd"],
        message: "A janela de envio precisa ter início e fim diferentes."
      });
    }

    if (value.randomDelayMaxSeconds < value.randomDelayMinSeconds) {
      ctx.addIssue({
        code: "custom",
        path: ["randomDelayMaxSeconds"],
        message: "O delay máximo precisa ser maior ou igual ao delay mínimo."
      });
    }
  });

export type CampaignInput = z.infer<typeof campaignInputSchema>;

export const sendJobPayloadSchema = z.object({
  source: z.enum(["rule", "automation", "campaign", "manual"]),
  channel: z.enum(channelTypeValues).default("whatsapp"),
  channelAccountId: z.string().optional().nullable().default(null),
  externalThreadId: z.string().optional().nullable().default(null),
  recipientDisplayValue: z.string().optional().nullable().default(null),
  recipientNormalizedValue: z.string().optional().nullable().default(null),
  phone: z
    .union([z.string(), z.null(), z.undefined()])
    .transform((value) => {
      if (typeof value !== "string") {
        return null;
      }

      const normalized = value.trim();
      return normalized.length > 0 ? normalized : null;
    }),
  contactId: z.string().optional().nullable().default(null),
  conversationId: z.string().optional().nullable().default(null),
  runId: z.string().optional().nullable().default(null),
  recipientId: z.string().optional().nullable().default(null),
  campaignId: z.string().optional().nullable().default(null),
  automationId: z.string().optional().nullable().default(null),
  ruleId: z.string().optional().nullable().default(null),
  stepId: z.string().optional().nullable().default(null),
  contentType: z.enum(["text", "audio", "image", "video"]),
  text: z.string().default(""),
  mediaPath: z.string().optional().nullable().default(null),
  caption: z.string().default(""),
  sendFileFirst: z.boolean().default(false)
}).superRefine((value, ctx) => {
  if (value.channel === "whatsapp" && (!value.phone?.trim() || value.phone.trim().length < 6)) {
    ctx.addIssue({
      code: "custom",
      path: ["phone"],
      message: "Envios de WhatsApp precisam de telefone."
    });
  }

  if (value.channel === "instagram" && !value.externalThreadId?.trim() && !value.recipientNormalizedValue?.trim()) {
    ctx.addIssue({
      code: "custom",
      path: ["recipientNormalizedValue"],
      message: "Envios de Instagram precisam de thread ou username."
    });
  }
});

export type SendJobPayload = z.infer<typeof sendJobPayloadSchema>;

export const uploadCategorySchema = z.enum(["campaign", "rule", "temp"]);
export type UploadCategory = z.infer<typeof uploadCategorySchema>;

export interface ContactRecord extends ContactInput {
  id: string;
  tags: string[];
  channels: ContactChannelRecord[];
  instagramFollowsMe: boolean | null;
  instagramFollowedByMe: boolean | null;
  instagramIncomingMessagesCount: number;
  instagramSentMoreThanThreeMessages: boolean;
  createdAt: string;
  updatedAt: string;
  conversationId: string | null;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
}

export interface ContactChannelRecord {
  id: string;
  contactId: string;
  type: ChannelType;
  externalId: string | null;
  displayValue: string;
  normalizedValue: string | null;
  isPrimary: boolean;
  isActive: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface TagRecord {
  id: string;
  name: string;
  normalizedName: string;
  color: string;
  type: TagType;
  active: boolean;
  contactCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ContactHistoryRecord {
  id: string;
  contactId: string;
  field: string;
  label: string;
  previousValue: string | null;
  nextValue: string | null;
  source: string;
  createdAt: string;
}

export interface ConversationRecord {
  id: string;
  contactId: string | null;
  channel: ChannelType;
  channelAccountId: string | null;
  externalThreadId: string;
  inboxCategory: string;
  internalStatus: string;
  waChatId: string;
  title: string;
  unreadCount: number;
  lastMessagePreview: string;
  lastMessageAt: string | null;
  status: ConversationStatus;
  assignedTo: string | null;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
  contactName?: string | null;
  contactPhone?: string | null;
  contactInstagram?: string | null;
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  contactId: string | null;
  channel: ChannelType;
  channelAccountId: string | null;
  direction: MessageDirection;
  contentType: MessageContentType;
  body: string;
  mediaPath: string | null;
  externalId: string | null;
  status: string;
  sentAt: string | null;
  createdAt: string;
  meta: Record<string, unknown>;
}

export interface ChannelAccountRecord {
  id: string;
  type: ChannelType;
  provider: string;
  accountKey: string;
  displayName: string;
  status: ChannelAccountStatus;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRuleRecord extends AutomationRuleInput {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReminderRecord {
  id: string;
  contactId: string | null;
  conversationId: string | null;
  automationId: string | null;
  title: string;
  dueAt: string;
  status: "open" | "done";
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignStepRecord {
  id: string;
  campaignId: string;
  sortOrder: number;
  type: CampaignStepType;
  content: string;
  mediaPath: string | null;
  waitMinutes: number | null;
  caption: string;
  tagName: string | null;
  channelScope: (typeof campaignChannelScopeValues)[number];
  createdAt: string;
}

export interface CampaignRecord {
  id: string;
  name: string;
  description: string;
  status: CampaignStatus;
  eligibleChannels: ChannelType[];
  csvPath: string | null;
  sendWindowStart: string;
  sendWindowEnd: string;
  rateLimitCount: number;
  rateLimitWindowMinutes: number;
  randomDelayMinSeconds: number;
  randomDelayMaxSeconds: number;
  totalRecipients: number;
  processedRecipients: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  steps: CampaignStepRecord[];
}

export interface AuditLogRecord {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  channel: ChannelType | null;
  contactId: string | null;
  conversationId: string | null;
  messageId: string | null;
  campaignId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ReplySuggestionRecord {
  id: string;
  label: string;
  content: string;
  source: "automation" | "campaign";
}

export interface InstagramAssistedMessageSnapshot {
  externalId: string | null;
  direction: "incoming" | "outgoing";
  body: string;
  contentType: "text" | "image" | "video" | "file";
  sentAt: string | null;
}

export interface InstagramAssistedThreadSnapshot {
  threadId: string;
  username: string;
  title: string;
  unreadCount: number;
  lastMessagePreview: string;
  lastMessageAt: string | null;
  lastMessageDirection: "incoming" | "outgoing" | null;
  messages: InstagramAssistedMessageSnapshot[];
}

export interface InstagramAssistedSessionState {
  mode: "fixture" | "browser";
  status: "connected" | "assisted" | "error" | "disconnected";
  authenticated: boolean;
  profileDir: string | null;
  username: string | null;
  lastSyncAt: string | null;
  threadCount: number;
  messageCount: number;
  errorMessage: string | null;
  sharedBrowser?: boolean;
  browserEndpoint?: string | null;
  pageUrl?: string | null;
  lastCheckedAt?: string | null;
}
