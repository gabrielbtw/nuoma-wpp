import {
  idempotencyKey,
  type AutomationAction,
  type Chatbot,
  type ChatbotRule,
  type ChatbotRuleAbTestVariant,
  type Contact,
  type Conversation,
  type Message,
} from "@nuoma/contracts";
import type { Repositories } from "@nuoma/db";

import { segmentMatches } from "./segment-match.js";

type ChatbotChannel = "whatsapp" | "instagram" | "system";

export interface EvaluateChatbotMessageInput {
  repos: Repositories;
  userId: number;
  chatbotId?: number;
  channel: ChatbotChannel;
  phone?: string;
  body: string;
  contactId?: number | null;
  conversationId?: number | null;
  messageId?: number | null;
  sourceEventId?: string | null;
  persistExecution: boolean;
}

export interface ChatbotInboundTriggerResult {
  chatbotsEvaluated: number;
  matched: boolean;
  jobsCreated: number;
  skippedActions: Array<{ type: AutomationAction["type"]; reason: string }>;
  reasons: string[];
}

export async function evaluateChatbotMessage(input: EvaluateChatbotMessageInput) {
  const candidates = input.chatbotId
    ? [
        await input.repos.chatbots.findById({
          id: input.chatbotId,
          userId: input.userId,
        }),
      ].filter((chatbot) => chatbot !== null)
    : await input.repos.chatbots.list({
        userId: input.userId,
        channel: input.channel,
        status: "active",
      });

  for (const chatbot of candidates) {
    if (chatbot.channel !== input.channel) continue;
    if (chatbot.status === "archived") continue;

    const rules = await input.repos.chatbots.listRules({
      userId: input.userId,
      chatbotId: chatbot.id,
      isActive: true,
    });
    const directMatch = rules.find((rule) => bodyMatchesRule(rule, input.body));
    const fallback = directMatch ?? rules.find((rule) => rule.match.type === "fallback");
    if (fallback) {
      const actions = resolveRuleActions(fallback, input);
      const abTest = summarizeAbTest(fallback, input);
      if (input.persistExecution) {
        await persistChatbotExecution(input, {
          matched: true,
          chatbot,
          rule: fallback,
          fallbackUsed: fallback.match.type === "fallback",
          abTest,
          actionsCount: actions.length,
          executionMode: "dry_run",
          wouldEnqueueJobs: false,
          jobsCreated: 0,
        });
      }
      return {
        matched: true,
        chatbot,
        rule: fallback,
        fallbackUsed: fallback.match.type === "fallback",
        actions,
        abTest,
        phone: input.phone ?? null,
        wouldEnqueueJobs: false as const,
        persisted: input.persistExecution,
        reasons: [],
      };
    }
  }

  if (input.persistExecution) {
    await persistChatbotExecution(input, {
      matched: false,
      chatbot: null,
      rule: null,
      fallbackUsed: false,
      abTest: null,
      actionsCount: 0,
      executionMode: "dry_run",
      wouldEnqueueJobs: false,
      jobsCreated: 0,
    });
  }
  return {
    matched: false,
    chatbot: null,
    rule: null,
    fallbackUsed: false,
    actions: [],
    abTest: null,
    phone: input.phone ?? null,
    wouldEnqueueJobs: false as const,
    persisted: input.persistExecution,
    reasons: candidates.length === 0 ? ["no_chatbot"] : ["no_rule_match"],
  };
}

export async function triggerChatbotsForInboundMessage(input: {
  repos: Repositories;
  userId: number;
  message: Message;
  conversation: Conversation;
  contact: Contact | null;
  phone: string | null;
  instagramHandle: string | null;
}): Promise<ChatbotInboundTriggerResult> {
  const body = input.message.body?.trim();
  if (!body) {
    return emptyInboundResult(["empty_message_body"]);
  }
  const channel = input.conversation.channel;
  if (channel !== "whatsapp" && channel !== "instagram") {
    return emptyInboundResult(["channel_not_supported"]);
  }
  if (channel === "whatsapp" && !input.phone) {
    return emptyInboundResult(["invalid_phone"]);
  }
  if (channel === "instagram" && !input.instagramHandle) {
    return emptyInboundResult(["invalid_instagram"]);
  }

  const chatbots = await input.repos.chatbots.list({
    userId: input.userId,
    channel,
    status: "active",
    limit: 100,
  });
  const result: ChatbotInboundTriggerResult = {
    chatbotsEvaluated: 0,
    matched: false,
    jobsCreated: 0,
    skippedActions: [],
    reasons: [],
  };

  for (const chatbot of chatbots) {
    result.chatbotsEvaluated += 1;
    const rules = await input.repos.chatbots.listRules({
      userId: input.userId,
      chatbotId: chatbot.id,
      isActive: true,
    });
    const matchedRule =
      rules.find(
        (rule) =>
          bodyMatchesRule(rule, body) &&
          segmentMatches(rule.segment, input.contact, input.conversation.channel),
      ) ??
      rules.find(
        (rule) =>
          rule.match.type === "fallback" &&
          segmentMatches(rule.segment, input.contact, input.conversation.channel),
      );
    if (!matchedRule) {
      continue;
    }

    result.matched = true;
    const actions = resolveRuleActions(matchedRule, { body, phone: input.phone ?? undefined });
    const abTest = summarizeAbTest(matchedRule, { body, phone: input.phone ?? undefined });
    const jobsCreated = await enqueueChatbotReplyActions({
      ...input,
      chatbot,
      rule: matchedRule,
      actions,
    });
    result.jobsCreated += jobsCreated.created;
    result.skippedActions.push(...jobsCreated.skipped);

    await persistChatbotExecution(
      {
        repos: input.repos,
        userId: input.userId,
        channel,
        phone: input.phone ?? undefined,
        body,
        contactId: input.contact?.id ?? null,
        conversationId: input.conversation.id,
        messageId: input.message.id,
        sourceEventId: sourceEventId(input.message, chatbot, matchedRule),
      },
      {
        matched: true,
        chatbot,
        rule: matchedRule,
        fallbackUsed: matchedRule.match.type === "fallback",
        abTest,
        actionsCount: actions.length,
        executionMode: "inbound",
        wouldEnqueueJobs: jobsCreated.created > 0,
        jobsCreated: jobsCreated.created,
      },
    );

    break;
  }

  if (!result.matched) {
    result.reasons.push(chatbots.length === 0 ? "no_chatbot" : "no_rule_match");
  }
  return result;
}

function bodyMatchesRule(rule: ChatbotRule, body: string): boolean {
  const value = rule.match.value ?? "";
  const normalizedBody = body.trim().toLowerCase();
  const normalizedValue = value.trim().toLowerCase();

  if (rule.match.type === "fallback") return false;
  if (!normalizedValue) return false;
  if (rule.match.type === "contains") return normalizedBody.includes(normalizedValue);
  if (rule.match.type === "equals") return normalizedBody === normalizedValue;
  if (rule.match.type === "starts_with") return normalizedBody.startsWith(normalizedValue);
  if (rule.match.type === "regex") {
    try {
      return new RegExp(value, "i").test(body);
    } catch {
      return false;
    }
  }
  return false;
}

function resolveRuleActions(
  rule: ChatbotRule,
  input: { body: string; phone?: string },
): AutomationAction[] {
  return selectAbTestVariant(rule, input)?.actions ?? rule.actions;
}

function summarizeAbTest(
  rule: ChatbotRule,
  input: { body: string; phone?: string },
): {
  enabled: true;
  assignment: "deterministic";
  selectedVariantId: string | null;
  selectedVariantLabel: string | null;
  variants: Array<{
    id: string;
    label: string;
    weight: number;
    actionsCount: number;
  }>;
} | null {
  const abTest = rule.metadata.abTest;
  if (!abTest?.enabled) {
    return null;
  }
  const selectedVariant = selectAbTestVariant(rule, input);
  return {
    enabled: true,
    assignment: abTest.assignment,
    selectedVariantId: selectedVariant?.id ?? null,
    selectedVariantLabel: selectedVariant?.label ?? null,
    variants: abTest.variants.map((variant) => ({
      id: variant.id,
      label: variant.label,
      weight: variant.weight,
      actionsCount: variant.actions.length,
    })),
  };
}

function selectAbTestVariant(
  rule: ChatbotRule,
  input: { body: string; phone?: string },
): ChatbotRuleAbTestVariant | null {
  const abTest = rule.metadata.abTest;
  if (!abTest?.enabled || abTest.variants.length < 2) {
    return null;
  }
  const totalWeight = abTest.variants.reduce((sum, variant) => sum + variant.weight, 0);
  if (totalWeight <= 0) {
    return abTest.variants[0] ?? null;
  }
  const bucket = stableHash(`${rule.id}:${input.phone ?? ""}:${input.body}`) % totalWeight;
  let cursor = 0;
  for (const variant of abTest.variants) {
    cursor += variant.weight;
    if (bucket < cursor) {
      return variant;
    }
  }
  return abTest.variants[abTest.variants.length - 1] ?? null;
}

function stableHash(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

async function enqueueChatbotReplyActions(input: {
  repos: Repositories;
  userId: number;
  message: Message;
  conversation: Conversation;
  contact: Contact | null;
  phone: string | null;
  instagramHandle: string | null;
  chatbot: Chatbot;
  rule: ChatbotRule;
  actions: AutomationAction[];
}) {
  const now = Date.now();
  let created = 0;
  const skipped: ChatbotInboundTriggerResult["skippedActions"] = [];
  for (const [index, action] of input.actions.entries()) {
    if (action.type !== "send_step") {
      skipped.push({ type: action.type, reason: "not_reply_action" });
      continue;
    }
    if (action.step.type !== "text" && action.step.type !== "link") {
      skipped.push({ type: action.type, reason: "unsupported_reply_step" });
      continue;
    }
    const key = idempotencyKey({
      kind: "chatbot_reply",
      userId: input.userId,
      ruleId: input.rule.id,
      triggerMessageExternalId: `${input.message.externalId ?? `message:${input.message.id}`}:${
        action.id ?? index
      }`,
    });
    const job = await input.repos.jobs.create({
      userId: input.userId,
      type: "chatbot_reply",
      status: "queued",
      payload: {
        conversationId: input.conversation.id,
        contactId: input.contact?.id ?? null,
        phone: input.phone,
        instagramHandle: input.instagramHandle,
        chatbotId: input.chatbot.id,
        ruleId: input.rule.id,
        sourceMessageId: input.message.id,
        step: action.step,
        variables: {
          nome: input.contact?.name ?? input.instagramHandle ?? input.phone ?? "",
          name: input.contact?.name ?? input.instagramHandle ?? input.phone ?? "",
          telefone: input.phone ?? "",
          phone: input.phone ?? "",
          instagram: input.instagramHandle ?? "",
          instagramHandle: input.instagramHandle ?? "",
        },
        idempotencyKey: key,
      },
      dedupeKey: key,
      scheduledAt: new Date(now + action.step.delaySeconds * 1000).toISOString(),
      priority: 5,
      maxAttempts: 1,
    });
    if (job) {
      created += 1;
    }
  }
  return { created, skipped };
}

async function persistChatbotExecution(
  input: {
    repos: Repositories;
    userId: number;
    channel: ChatbotChannel;
    phone?: string;
    body: string;
    contactId?: number | null;
    conversationId?: number | null;
    messageId?: number | null;
    sourceEventId?: string | null;
  },
  result: {
    matched: boolean;
    chatbot: { id: number; name: string } | null;
    rule: ChatbotRule | null;
    fallbackUsed: boolean;
    abTest: ReturnType<typeof summarizeAbTest>;
    actionsCount: number;
    executionMode: "dry_run" | "inbound";
    wouldEnqueueJobs: boolean;
    jobsCreated: number;
  },
) {
  const selectedVariantId = result.abTest?.selectedVariantId ?? null;
  const selectedVariantLabel = result.abTest?.selectedVariantLabel ?? null;
  const eventId =
    input.sourceEventId ??
    (input.messageId && result.chatbot && result.rule
      ? `message:${input.messageId}:chatbot:${result.chatbot.id}:rule:${result.rule.id}`
      : null);
  await input.repos.systemEvents.create({
    userId: input.userId,
    type: "chatbot.execution.evaluated",
    severity: result.matched ? "info" : "warn",
    payload: JSON.stringify({
      chatbotId: result.chatbot?.id ?? null,
      chatbotName: result.chatbot?.name ?? null,
      ruleId: result.rule?.id ?? null,
      ruleName: result.rule?.name ?? null,
      matched: result.matched,
      fallbackUsed: result.fallbackUsed,
      channel: input.channel,
      phone: input.phone ?? null,
      contactId: input.contactId ?? null,
      conversationId: input.conversationId ?? null,
      messageId: input.messageId ?? null,
      sourceEventId: eventId,
      bodyPreview: input.body.slice(0, 240),
      actionsCount: result.actionsCount,
      selectedVariantId,
      selectedVariantLabel,
      executionMode: result.executionMode,
      wouldEnqueueJobs: result.wouldEnqueueJobs,
      jobsCreated: result.jobsCreated,
    }),
  });
  if (result.chatbot && result.rule && selectedVariantId) {
    await input.repos.chatbots.recordVariantEvent({
      userId: input.userId,
      chatbotId: result.chatbot.id,
      ruleId: result.rule.id,
      variantId: selectedVariantId,
      variantLabel: selectedVariantLabel,
      eventType: "exposure",
      channel: input.channel,
      contactId: input.contactId ?? null,
      conversationId: input.conversationId ?? null,
      messageId: input.messageId ?? null,
      exposureId: null,
      sourceEventId: eventId,
      metadata: {
        source: "chatbot.execution.evaluated",
        executionMode: result.executionMode,
        bodyPreview: input.body.slice(0, 120),
      },
    });
  }
}

function sourceEventId(message: Message, chatbot: Chatbot, rule: ChatbotRule): string {
  return `message:${message.id}:chatbot:${chatbot.id}:rule:${rule.id}`;
}

function emptyInboundResult(reasons: string[]): ChatbotInboundTriggerResult {
  return {
    chatbotsEvaluated: 0,
    matched: false,
    jobsCreated: 0,
    skippedActions: [],
    reasons,
  };
}
