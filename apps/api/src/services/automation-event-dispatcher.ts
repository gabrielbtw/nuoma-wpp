import { normalizePhone, type Automation } from "@nuoma/contracts";
import type { Repositories } from "@nuoma/db";

import { triggerAutomationForPhone } from "./automation-trigger.js";

type AutomationDomainEventType =
  | "contact.tag_applied"
  | "contact.tag_removed"
  | "campaign.recipient_completed";

type SystemEventRecord = Awaited<ReturnType<Repositories["systemEvents"]["list"]>>[number];

export interface AutomationDomainDispatchResult {
  eventId: number;
  eventType: string;
  automationsEvaluated: number;
  triggered: number;
  jobsCreated: number;
  actionsApplied: number;
  skipped: Array<{ automationId?: number; reason: string }>;
}

export async function dispatchAutomationDomainEvent(input: {
  repos: Repositories;
  userId: number;
  event: SystemEventRecord;
  allowedPhone: string;
  allowedPhones?: string[];
  sendPolicyMode?: "test" | "production";
}): Promise<AutomationDomainDispatchResult> {
  const eventType = domainEventType(input.event.type);
  const result: AutomationDomainDispatchResult = {
    eventId: input.event.id,
    eventType: input.event.type,
    automationsEvaluated: 0,
    triggered: 0,
    jobsCreated: 0,
    actionsApplied: 0,
    skipped: [],
  };
  if (!eventType) {
    result.skipped.push({ reason: "unsupported_event_type" });
    return result;
  }

  const payload = objectPayload(input.event.payload);
  const triggerType = automationTriggerType(eventType);
  const tagId = numberPayload(payload.tagId);
  const campaignId = numberPayload(payload.campaignId);
  const contact = await resolveContact(input.repos, input.userId, payload);
  const conversationId = numberPayload(payload.conversationId);
  const channel = stringPayload(payload.channel) ?? contact?.primaryChannel ?? "whatsapp";
  const phone = normalizePhone(
    stringPayload(payload.phone) ?? contact?.phone ?? contact?.phoneE164,
  );
  const instagramHandle = normalizeInstagramHandle(
    stringPayload(payload.instagramHandle) ?? contact?.instagramHandle,
  );
  const automations = (await input.repos.automations.list(input.userId)).filter(
    (automation) =>
      automation.status === "active" &&
      automation.trigger.type === triggerType &&
      triggerTagMatches(automation, tagId) &&
      triggerCampaignMatches(automation, campaignId),
  );

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
      conversationId,
      triggerType,
      triggerChannel: channel === "instagram" ? "instagram" : "whatsapp",
      within24hWindow: true,
      dedupeScope: `system_event:${input.event.id}`,
    });
    if (!triggered.eligible) {
      result.skipped.push({
        automationId: automation.id,
        reason: triggered.reasons.join(",") || "not_eligible",
      });
      continue;
    }
    result.triggered += 1;
    result.jobsCreated += triggered.jobsCreated;
    result.actionsApplied += triggered.actionsApplied;
  }

  return result;
}

export function isAutomationDomainEventType(value: string): value is AutomationDomainEventType {
  return domainEventType(value) !== null;
}

function domainEventType(value: string): AutomationDomainEventType | null {
  if (
    value === "contact.tag_applied" ||
    value === "contact.tag_removed" ||
    value === "campaign.recipient_completed"
  ) {
    return value;
  }
  return null;
}

function automationTriggerType(value: AutomationDomainEventType): Automation["trigger"]["type"] {
  if (value === "contact.tag_applied") return "tag_applied";
  if (value === "contact.tag_removed") return "tag_removed";
  return "campaign_completed";
}

function triggerTagMatches(automation: Automation, tagId: number | null): boolean {
  if (automation.trigger.type !== "tag_applied" && automation.trigger.type !== "tag_removed") {
    return true;
  }
  return !automation.trigger.tagId || automation.trigger.tagId === tagId;
}

function triggerCampaignMatches(automation: Automation, campaignId: number | null): boolean {
  if (automation.trigger.type !== "campaign_completed") {
    return true;
  }
  return !automation.trigger.campaignId || automation.trigger.campaignId === campaignId;
}

async function resolveContact(
  repos: Repositories,
  userId: number,
  payload: Record<string, unknown>,
) {
  const contactId = numberPayload(payload.contactId);
  if (contactId) {
    const contact = await repos.contacts.findById(contactId);
    if (contact?.userId === userId) return contact;
  }
  const phone = normalizePhone(stringPayload(payload.phone));
  if (phone) {
    return repos.contacts.findByPhone({ userId, phone });
  }
  const instagramHandle = normalizeInstagramHandle(stringPayload(payload.instagramHandle));
  if (instagramHandle) {
    return repos.contacts.findByIdentity({ userId, instagramHandle });
  }
  return null;
}

function objectPayload(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringPayload(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberPayload(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function normalizeInstagramHandle(value: string | null | undefined): string | null {
  const cleaned = String(value ?? "")
    .trim()
    .replace(/^ig:/i, "")
    .replace(/^@+/, "")
    .toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(cleaned) ? cleaned : null;
}
