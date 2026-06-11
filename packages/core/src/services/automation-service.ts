import {
  advanceAutomationRun,
  completeAutomationRun,
  createAutomationRun,
  failAutomationRun,
  getAutomation,
  getAutomationContactState,
  getAutomationRun,
  getOpenAutomationRunForContact,
  listActiveAutomations,
  listDueAutomationRuns,
  recordAutomationContactState
} from "../repositories/automation-repository.js";
import { getDb } from "../db/connection.js";
import { getContactById, listContactsForAutomationEvaluation, applyTagToContact, removeTagFromContact } from "../repositories/contact-repository.js";
import { getInstagramThreadIdForContact } from "../repositories/contact-channel-repository.js";
import { getConversationById, getLatestConversationForContactChannel } from "../repositories/conversation-repository.js";
import { enqueueJob } from "../repositories/job-repository.js";
import { createReminder } from "../repositories/reminder-repository.js";
import { normalizeTagName } from "../repositories/tag-repository.js";
import { getWorkerState, recordSystemEvent } from "../repositories/system-repository.js";
import { loadEnv } from "../config/env.js";
import { resolveTemplateVars } from "../utils/template-vars.js";
import { addSeconds, isWithinTimeWindow, nextWindowStartIso, randomBetween } from "../utils/time.js";
import type { AutomationRuleRecord, ChannelType } from "../types/domain.js";

function hoursSince(timestamp: string | null | undefined) {
  if (!timestamp) {
    return Number.POSITIVE_INFINITY;
  }

  return (Date.now() - new Date(timestamp).getTime()) / (60 * 60 * 1000);
}

function isAfter(left: string | null | undefined, right: string | null | undefined) {
  if (!left || !right) {
    return false;
  }

  return new Date(left).getTime() > new Date(right).getTime();
}

function automationDelaySeconds(min: number, max: number) {
  return randomBetween(min, Math.max(min, max));
}

function isInstagramIncomingAutomation(automation: Pick<AutomationRuleRecord, "category">) {
  return automation.category === "instagram-incoming";
}

function contactMatchesCommonFilters(
  automation: Pick<AutomationRuleRecord, "triggerTags" | "excludeTags" | "requiredStatus" | "procedureOnly">,
  contact: ReturnType<typeof listContactsForAutomationEvaluation>[number]
) {
  const contactTags = new Set(contact.tags.map((tag) => normalizeTagName(tag)));

  if (automation.triggerTags.some((tag) => !contactTags.has(normalizeTagName(tag)))) {
    return false;
  }

  if (automation.excludeTags.some((tag) => contactTags.has(normalizeTagName(tag)))) {
    return false;
  }

  if (automation.requiredStatus && automation.requiredStatus !== contact.status) {
    return false;
  }

  if (automation.procedureOnly && contact.procedureStatus !== "yes") {
    return false;
  }

  return true;
}

function isAutomationCoolingDown(automationId: string, contactId: string, minimumIntervalHours: number) {
  const state = getAutomationContactState(automationId, contactId);
  return Boolean(state?.last_sent_at && hoursSince(state.last_sent_at as string) < minimumIntervalHours);
}

function evaluateScheduledAutomationEligibility(
  automation: AutomationRuleRecord,
  contact: ReturnType<typeof listContactsForAutomationEvaluation>[number]
) {
  if (isInstagramIncomingAutomation(automation)) {
    return false;
  }

  if (automation.category === "follow-up" && automation.triggerTags.length === 0) {
    return false;
  }

  if (!contactMatchesCommonFilters(automation, contact)) {
    return false;
  }

  if (automation.requireLastOutgoing) {
    if (!contact.lastOutgoingAt) {
      return false;
    }

    if (contact.lastIncomingAt && isAfter(contact.lastIncomingAt, contact.lastOutgoingAt)) {
      return false;
    }
  }

  if (automation.requireNoReply) {
    if (!contact.lastOutgoingAt) {
      return false;
    }

    if (contact.lastIncomingAt && isAfter(contact.lastIncomingAt, contact.lastOutgoingAt)) {
      return false;
    }

    if (hoursSince(contact.lastOutgoingAt) < automation.timeWindowHours) {
      return false;
    }
  } else if (contact.lastInteractionAt && hoursSince(contact.lastInteractionAt) < automation.timeWindowHours) {
    return false;
  }

  if (isAutomationCoolingDown(automation.id, contact.id, automation.minimumIntervalHours)) {
    return false;
  }

  return !getOpenAutomationRunForContact(automation.id, contact.id);
}

function evaluateInstagramIncomingEligibility(
  automation: AutomationRuleRecord,
  contact: ReturnType<typeof listContactsForAutomationEvaluation>[number]
) {
  if (!isInstagramIncomingAutomation(automation)) {
    return false;
  }

  if (!contact.instagram?.trim()) {
    return false;
  }

  if (!contactMatchesCommonFilters(automation, contact)) {
    return false;
  }

  if (isAutomationCoolingDown(automation.id, contact.id, automation.minimumIntervalHours)) {
    return false;
  }

  return !getOpenAutomationRunForContact(automation.id, contact.id);
}

function getChannelAvailability(channel: ChannelType) {
  if (channel === "instagram") {
    const state = getWorkerState("instagram-assisted");
    const payload = state?.value && typeof state.value === "object" ? (state.value as Record<string, unknown>) : {};
    return payload.authenticated === true || payload.status === "connected";
  }

  const state = getWorkerState("wa-worker");
  const payload = state?.value && typeof state.value === "object" ? (state.value as Record<string, unknown>) : {};
  const status = String(payload.status ?? "");
  return status === "authenticated" || status === "degraded";
}

function resolveRunChannel(automation: AutomationRuleRecord): ChannelType {
  return isInstagramIncomingAutomation(automation) ? "instagram" : "whatsapp";
}

function resolveRunConversation(contactId: string, conversationId: string | null | undefined, channel: ChannelType) {
  const explicitConversation = conversationId ? getConversationById(conversationId) : null;
  if (explicitConversation?.channel === channel) {
    return explicitConversation;
  }

  return getLatestConversationForContactChannel(contactId, channel);
}

export function triggerIncomingAutomationRuns(input: {
  channel: ChannelType;
  contactId: string;
  conversationId: string;
  receivedAt?: string | null;
}) {
  const env = loadEnv();
  if (!env.ENABLE_AUTOMATIONS || input.channel !== "instagram") {
    return { queued: 0, skipped: true };
  }

  const storedContact = getContactById(input.contactId);
  if (!storedContact) {
    return { queued: 0, skipped: true, reason: "contact_not_found" };
  }

  const contact =
    listContactsForAutomationEvaluation().find((candidate) => candidate.id === input.contactId) ?? {
      ...storedContact,
      conversationId: input.conversationId,
      lastOutgoingAt: null,
      lastIncomingAt: input.receivedAt ?? null,
      lastAutomationAt: null
    };

  let queued = 0;
  for (const automation of listActiveAutomations().filter(isInstagramIncomingAutomation)) {
    if (!evaluateInstagramIncomingEligibility(automation, contact)) {
      continue;
    }

    const nextRunAt = isWithinTimeWindow(automation.sendWindowStart, automation.sendWindowEnd, env.DEFAULT_TIMEZONE)
      ? new Date().toISOString()
      : nextWindowStartIso(automation.sendWindowStart, automation.sendWindowEnd, env.DEFAULT_TIMEZONE);

    createAutomationRun({
      automationId: automation.id,
      contactId: contact.id,
      conversationId: input.conversationId,
      nextRunAt
    });

    queued += 1;
    recordSystemEvent("scheduler", "info", "Instagram incoming automation queued", {
      automationId: automation.id,
      contactId: contact.id,
      conversationId: input.conversationId
    });
  }

  return { queued, skipped: false };
}

export function processAutomationTick() {
  const env = loadEnv();
  if (!env.ENABLE_AUTOMATIONS) {
    return { queued: 0, skipped: true };
  }

  const automations = listActiveAutomations();
  const contacts = listContactsForAutomationEvaluation();
  const contactsById = new Map(contacts.map((contact) => [contact.id, contact]));
  let queued = 0;

  for (const automation of automations) {
    if (automation.category === "pos-procedimento" && !env.ENABLE_POST_PROCEDURE) {
      continue;
    }

    if (isInstagramIncomingAutomation(automation)) {
      continue;
    }

    for (const contact of contacts) {
      if (!evaluateScheduledAutomationEligibility(automation, contact)) {
        continue;
      }

      const nextRunAt = isWithinTimeWindow(automation.sendWindowStart, automation.sendWindowEnd, env.DEFAULT_TIMEZONE)
        ? new Date().toISOString()
        : nextWindowStartIso(automation.sendWindowStart, automation.sendWindowEnd, env.DEFAULT_TIMEZONE);

      createAutomationRun({
        automationId: automation.id,
        contactId: contact.id,
        conversationId: contact.conversationId,
        nextRunAt
      });
      queued += 1;
    }
  }

  const dueRuns = listDueAutomationRuns();
  for (const run of dueRuns) {
    const automation = getAutomation(String(run.automation_id));
    if (!automation || !automation.enabled) {
      continue;
    }

    const action = automation.actions[Number(run.action_index)];
    if (!action) {
      completeAutomationRun(String(run.id));
      continue;
    }

    const channel = resolveRunChannel(automation);
    const contact =
      contactsById.get(String(run.contact_id)) ??
      listContactsForAutomationEvaluation().find((candidate) => candidate.id === String(run.contact_id));

    if (!contact) {
      failAutomationRun(String(run.id), "Contato indisponível para automação.");
      continue;
    }

    switch (action.type) {
      case "wait": {
        advanceAutomationRun(String(run.id), Number(run.action_index) + 1, addSeconds(action.waitSeconds ?? 60));
        break;
      }
      case "apply-tag": {
        if (action.tagName) {
          applyTagToContact(String(run.contact_id), action.tagName);
        }
        advanceAutomationRun(String(run.id), Number(run.action_index) + 1, new Date().toISOString());
        break;
      }
      case "remove-tag": {
        if (action.tagName) {
          removeTagFromContact(String(run.contact_id), action.tagName);
        }
        advanceAutomationRun(String(run.id), Number(run.action_index) + 1, new Date().toISOString());
        break;
      }
      case "create-reminder": {
        createReminder({
          contactId: String(run.contact_id),
          conversationId: (run.conversation_id as string | null) ?? null,
          automationId: automation.id,
          title: action.reminderText || action.content || "Lembrete criado por automação",
          dueAt: new Date().toISOString(),
          notes: action.content || null
        });
        advanceAutomationRun(String(run.id), Number(run.action_index) + 1, new Date().toISOString());
        break;
      }
      default: {
        if (!getChannelAvailability(channel)) {
          advanceAutomationRun(String(run.id), Number(run.action_index), addSeconds(30), "pending");
          break;
        }

        if (!isWithinTimeWindow(automation.sendWindowStart, automation.sendWindowEnd, env.DEFAULT_TIMEZONE)) {
          advanceAutomationRun(
            String(run.id),
            Number(run.action_index),
            nextWindowStartIso(automation.sendWindowStart, automation.sendWindowEnd, env.DEFAULT_TIMEZONE)
          );
          break;
        }

        const conversation = resolveRunConversation(String(run.contact_id), (run.conversation_id as string | null) ?? null, channel);
        const instagramHandle = String(contact.instagram ?? "").replace(/^@+/, "");
        const recipientNormalizedValue = channel === "instagram" ? instagramHandle : String(contact.phone ?? "");
        const externalThreadId =
          channel === "instagram"
            ? conversation?.externalThreadId ?? getInstagramThreadIdForContact(contact.id) ?? null
            : String(contact.phone ?? "");

        if (channel === "instagram" && !externalThreadId && !recipientNormalizedValue) {
          failAutomationRun(String(run.id), "Contato sem thread ou handle de Instagram para resposta automática.");
          break;
        }

        if (channel === "whatsapp" && !recipientNormalizedValue) {
          failAutomationRun(String(run.id), "Contato sem telefone para automação.");
          break;
        }

        // Group consecutive send-image actions into a single multi-file job
        let nextActionIndex = Number(run.action_index);
        let jobContentType: string = action.type.replace("send-", "");
        let jobMediaPath: string | null = action.mediaPath ?? null;
        let jobMediaPaths: string[] | null = null;

        if (action.type === "send-image") {
          const imagePaths: string[] = [];
          let i = Number(run.action_index);
          while (i < automation.actions.length && automation.actions[i].type === "send-image") {
            const imgPath = automation.actions[i].mediaPath;
            if (imgPath) imagePaths.push(imgPath);
            i++;
          }
          if (imagePaths.length > 1) {
            jobContentType = "images";
            jobMediaPath = null;
            jobMediaPaths = imagePaths;
            nextActionIndex = i;
          } else {
            nextActionIndex = Number(run.action_index) + 1;
          }
        }

        const jobId = enqueueJob({
          type: channel === "instagram" ? "send-assisted-message" : "send-message",
          dedupeKey: `automation:${run.id}:${action.id ?? Number(run.action_index)}`,
          payload: {
            source: "automation",
            channel,
            automationId: automation.id,
            runId: String(run.id),
            contactId: String(run.contact_id),
            conversationId: conversation?.id ?? ((run.conversation_id as string | null) ?? null),
            phone: channel === "whatsapp" ? recipientNormalizedValue : null,
            externalThreadId,
            recipientDisplayValue: String(contact.name ?? contact.instagram ?? contact.phone ?? ""),
            recipientNormalizedValue,
            contentType: jobContentType,
            text: resolveTemplateVars(action.content, contact),
            mediaPath: jobMediaPath,
            mediaPaths: jobMediaPaths,
            caption: resolveTemplateVars(action.content, contact)
          }
        });

        advanceAutomationRun(String(run.id), nextActionIndex, addSeconds(20), "active");
        recordSystemEvent("scheduler", "info", "Automation send queued", {
          automationId: automation.id,
          runId: String(run.id),
          channel,
          jobId
        });
        break;
      }
    }
  }

  return { queued, skipped: false };
}

export function handleAutomationJobSuccess(input: { runId: string; automationId: string; contactId: string; jobId: string }) {
  const run = getAutomationRun(input.runId);
  const automation = getAutomation(input.automationId);
  if (!run || !automation) {
    return;
  }

  const nextActionIndex = Number(run.action_index) + 1;
  const delaySeconds = automationDelaySeconds(automation.randomDelayMinSeconds, automation.randomDelayMaxSeconds);

  if (nextActionIndex >= automation.actions.length) {
    completeAutomationRun(input.runId);
    recordAutomationContactState(input.automationId, input.contactId, input.jobId);
    return;
  }

  advanceAutomationRun(input.runId, nextActionIndex, addSeconds(delaySeconds));
  recordAutomationContactState(input.automationId, input.contactId, input.jobId);
}

export function handleAutomationJobFailure(runId: string, error: string) {
  failAutomationRun(runId, error);
}

/**
 * Scans recent incoming messages and creates automation runs for automations
 * configured with trigger_type = "event" and trigger_event = "message_received".
 *
 * Conditions in trigger_conditions_json are evaluated as AND:
 *   { field: "body", operator: "contains", value: "..." }
 *
 * Called on every scheduler tick. Window of 2x scheduler interval avoids missing messages.
 */
export function processMessageReceivedTriggers() {
  const env = loadEnv();
  if (!env.ENABLE_AUTOMATIONS) return { queued: 0 };

  const db = getDb();

  // Automations configured for message_received event trigger
  const eventAutomations = listActiveAutomations().filter(
    (a) => a.triggerType === "event" && a.triggerEvent === "message_received"
  );
  if (eventAutomations.length === 0) return { queued: 0 };

  // Recent incoming messages (last 2 minutes — comfortably covers any scheduler interval)
  const recentMessages = db
    .prepare(
      `SELECT m.id, m.body, m.sent_at, m.conversation_id, cv.contact_id, cv.channel
       FROM messages m
       JOIN conversations cv ON m.conversation_id = cv.id
       WHERE m.direction = 'incoming'
         AND m.created_at >= datetime('now', '-2 minutes')
       ORDER BY m.created_at ASC`
    )
    .all() as Array<{ id: string; body: string; sent_at: string; conversation_id: string; contact_id: string; channel: string }>;

  if (recentMessages.length === 0) return { queued: 0 };

  let queued = 0;

  for (const msg of recentMessages) {
    const contact = getContactById(msg.contact_id);
    if (!contact) continue;

    for (const automation of eventAutomations) {
      // Check keyword conditions (all must match — AND logic)
      const conditions = automation.triggerConditions ?? [];
      const matches = conditions.length === 0 || conditions.every((cond) => {
        if (cond.field === "body" && cond.operator === "contains") {
          return msg.body.toLowerCase().includes(cond.value.toLowerCase());
        }
        return false;
      });
      if (!matches) continue;

      // Skip if contact already has an open run for this automation
      const openRun = getOpenAutomationRunForContact(automation.id, msg.contact_id);
      if (openRun) continue;

      // Respect send window
      const nextRunAt = isWithinTimeWindow(automation.sendWindowStart, automation.sendWindowEnd, env.DEFAULT_TIMEZONE)
        ? new Date().toISOString()
        : nextWindowStartIso(automation.sendWindowStart, automation.sendWindowEnd, env.DEFAULT_TIMEZONE);

      createAutomationRun({
        automationId: automation.id,
        contactId: msg.contact_id,
        conversationId: msg.conversation_id,
        nextRunAt
      });
      queued += 1;

      recordSystemEvent("scheduler", "info", "Message-received automation triggered", {
        automationId: automation.id,
        contactId: msg.contact_id,
        conversationId: msg.conversation_id,
        messageId: msg.id,
        keyword: conditions.map((c) => c.value).join(", ")
      });
    }
  }

  return { queued };
}
