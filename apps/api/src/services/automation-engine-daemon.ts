import type { FastifyBaseLogger } from "fastify";

import type { Repositories } from "@nuoma/db";

import { triggerAutomationForPhone } from "./automation-trigger.js";
import { normalizePhone } from "./send-policy.js";

export interface AutomationEngineDaemon {
  start(): void;
  stop(): void;
  tick(): Promise<AutomationEngineTickResult>;
}

export interface AutomationEngineTickResult {
  scannedMessages: number;
  automationsEvaluated: number;
  triggered: number;
  jobsCreated: number;
  actionsApplied: number;
  skipped: Array<{ messageId: number; automationId?: number; reason: string }>;
}

export function createAutomationEngineDaemon(input: {
  repos: Repositories;
  logger: FastifyBaseLogger;
  enabled: boolean;
  userId: number;
  allowedPhone: string;
  allowedPhones?: string[];
  sendPolicyMode?: "test" | "production";
  intervalMs: number;
}): AutomationEngineDaemon {
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let cursor = 0;

  async function seedCursor() {
    cursor = await input.repos.messages.latestId(input.userId);
  }

  async function tick(): Promise<AutomationEngineTickResult> {
    if (running) {
      return emptyResult();
    }
    running = true;
    try {
      const messages = await input.repos.messages.listInboundAfterId({
        userId: input.userId,
        afterId: cursor,
        limit: 100,
      });
      const automations = (await input.repos.automations.list(input.userId)).filter(
        (automation) =>
          automation.status === "active" && automation.trigger.type === "message_received",
      );
      const result: AutomationEngineTickResult = {
        scannedMessages: messages.length,
        automationsEvaluated: 0,
        triggered: 0,
        jobsCreated: 0,
        actionsApplied: 0,
        skipped: [],
      };

      for (const message of messages) {
        cursor = Math.max(cursor, message.id);
        const conversation = await input.repos.conversations.findById({
          userId: input.userId,
          id: message.conversationId,
        });
        if (!conversation) {
          result.skipped.push({ messageId: message.id, reason: "conversation_missing" });
          continue;
        }
        const contact = conversation.contactId
          ? await input.repos.contacts.findById(conversation.contactId)
          : null;
        const phone =
          conversation.channel === "whatsapp"
            ? deriveWhatsappPhoneIdentity({ conversation, contact })
            : "";
        const instagramHandle =
          conversation.channel === "instagram"
            ? (normalizeInstagramHandle(contact?.instagramHandle) ??
              normalizeInstagramHandle(conversation.externalThreadId) ??
              normalizeInstagramHandle(conversation.title))
            : null;
        if (conversation.channel === "whatsapp" && phone.length < 8) {
          result.skipped.push({ messageId: message.id, reason: "conversation_phone_missing" });
          continue;
        }
        if (conversation.channel === "instagram" && !instagramHandle) {
          result.skipped.push({ messageId: message.id, reason: "conversation_instagram_missing" });
          continue;
        }

        for (const automation of automations) {
          result.automationsEvaluated += 1;
          const triggered = await triggerAutomationForPhone({
            repos: input.repos,
            userId: input.userId,
            automationId: automation.id,
            phone,
            instagramHandle,
            dryRun: false,
            allowedPhone: input.allowedPhone,
            allowedPhones: input.allowedPhones,
            sendPolicyMode: input.sendPolicyMode,
            conversationId: conversation.id,
            triggerType: "message_received",
            triggerChannel: conversation.channel,
            within24hWindow: true,
            dedupeScope: `message:${message.id}`,
            sourceMessageId: message.id,
          });

          if (!triggered.eligible) {
            result.skipped.push({
              messageId: message.id,
              automationId: automation.id,
              reason: triggered.reasons.join(",") || "not_eligible",
            });
            continue;
          }
          result.triggered += 1;
          result.jobsCreated += triggered.jobsCreated;
          result.actionsApplied += triggered.actionsApplied;
        }
      }

      if (messages.length > 0 || result.triggered > 0 || result.skipped.length > 0) {
        await input.repos.systemEvents.create({
          userId: input.userId,
          type: "automation.engine.tick",
          severity: result.skipped.length > 0 ? "warn" : "info",
          payload: JSON.stringify(result),
        });
      }

      return result;
    } catch (error) {
      input.logger.warn({ error }, "automation engine tick failed");
      await input.repos.systemEvents.create({
        userId: input.userId,
        type: "automation.engine.failed",
        severity: "error",
        payload: JSON.stringify({
          error: error instanceof Error ? error.message : "unknown_error",
        }),
      });
      throw error;
    } finally {
      running = false;
    }
  }

  return {
    start() {
      if (!input.enabled || timer) return;
      void seedCursor().then(() => {
        timer = setInterval(() => void tick().catch(() => undefined), input.intervalMs);
      });
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    tick,
  };
}

function normalizeInstagramHandle(value: string | null | undefined): string | null {
  const cleaned = String(value ?? "")
    .trim()
    .replace(/^ig:/i, "")
    .replace(/^@+/, "")
    .toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(cleaned) ? cleaned : null;
}

function deriveWhatsappPhoneIdentity(input: {
  conversation: {
    externalThreadId: string;
    waJid?: string | null;
  };
  contact: {
    phone?: string | null;
    phoneE164?: string | null;
    waJid?: string | null;
  } | null;
}): string {
  return (
    normalizePhone(input.conversation.waJid) ??
    normalizePhone(input.contact?.waJid) ??
    normalizePhone(input.contact?.phoneE164) ??
    normalizePhone(input.contact?.phone) ??
    normalizePhone(input.conversation.externalThreadId) ??
    ""
  );
}

function emptyResult(): AutomationEngineTickResult {
  return {
    scannedMessages: 0,
    automationsEvaluated: 0,
    triggered: 0,
    jobsCreated: 0,
    actionsApplied: 0,
    skipped: [],
  };
}
