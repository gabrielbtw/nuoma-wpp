import type { Repositories } from "@nuoma/db";
import { normalizeWaJid } from "@nuoma/contracts";

import {
  isWithin24hWindow,
  listOverlayAutomationOptions,
  type OverlayAutomationOption,
} from "./overlay-automations.js";
import { listOverlayCampaignOptions, type OverlayCampaignOption } from "./overlay-campaigns.js";
import { listOverlayAutomationHistory } from "./overlay-quick-actions.js";
import { normalizePhone } from "./send-policy.js";
import type { ApiSendPolicy } from "./send-policy.js";

export interface ExtensionOverlaySnapshotInput {
  repos: Repositories;
  userId: number;
  phone: string | null;
  waJid?: string | null;
  phoneSource: string | null;
  title: string | null;
  reason: string;
  sendPolicy: ApiSendPolicy;
}

export async function buildExtensionOverlaySnapshot(input: ExtensionOverlaySnapshotInput) {
  const waJid = normalizeWaJid(input.waJid ?? input.phone);
  let phone = normalizePhone(input.phone) ?? normalizePhone(waJid);
  const title = stringValue(input.title);
  const identityConversation = waJid
    ? await input.repos.conversations.findByWaJid({
        userId: input.userId,
        waJid,
      })
    : null;
  let contact =
    phone || waJid
      ? await input.repos.contacts.findByIdentity({ userId: input.userId, phone, waJid })
      : null;
  if (!contact && identityConversation?.contactId) {
    contact = await input.repos.contacts.findById(identityConversation.contactId);
  }

  phone = phone ?? normalizePhone(contact?.phone) ?? normalizePhone(contact?.waJid) ?? null;
  const phoneSource =
    phone && waJid && (!input.phoneSource || input.phoneSource === "unresolved")
      ? "wa-jid"
      : input.phoneSource;

  const allConversations = await input.repos.conversations.list(input.userId, 100);
  const conversations = allConversations
    .filter((conversation) => {
      if (contact && conversation.contactId === contact.id) {
        return true;
      }
      if (identityConversation && conversation.id === identityConversation.id) {
        return true;
      }
      if (!phone && !waJid) {
        return false;
      }
      return (
        (waJid !== null &&
          (normalizeWaJid(conversation.waJid) === waJid ||
            normalizeWaJid(conversation.externalThreadId) === waJid)) ||
        (phone !== null && normalizePhone(conversation.externalThreadId) === phone)
      );
    })
    .slice(0, 4);
  const latestMessages = (
    await Promise.all(
      conversations.slice(0, 2).map((conversation) =>
        input.repos.messages.listByConversation({
          userId: input.userId,
          conversationId: conversation.id,
          limit: 2,
          includeDeleted: false,
        }),
      ),
    )
  )
    .flat()
    .slice(0, 3);
  const within24hWindow = conversations.some((conversation) =>
    isWithin24hWindow(conversation.lastMessageAt),
  );
  const automations: OverlayAutomationOption[] = await listOverlayAutomationOptions({
    repos: input.repos,
    userId: input.userId,
    phone,
    sendPolicy: input.sendPolicy,
    within24hWindow,
    limit: 5,
  }).catch(() => []);
  const campaigns: OverlayCampaignOption[] = await listOverlayCampaignOptions({
    repos: input.repos,
    userId: input.userId,
    phone,
    sendPolicy: input.sendPolicy,
    limit: 5,
  }).catch(() => []);
  const tags = contact ? await input.repos.tags.list(input.userId).catch(() => []) : [];
  const reminders = contact
    ? await input.repos.reminders
        .list({ userId: input.userId, contactId: contact.id, status: "open", limit: 3 })
        .catch(() => [])
    : [];
  const automationHistory = await listOverlayAutomationHistory({
    repos: input.repos,
    userId: input.userId,
    phone,
    limit: 5,
  }).catch(() => []);

  return {
    phone,
    waJid,
    phoneSource,
    title,
    contact: contact
      ? {
          id: contact.id,
          name: contact.name,
          status: contact.status,
          primaryChannel: contact.primaryChannel,
          notes: contact.notes,
          tagIds: contact.tagIds,
        }
      : null,
    tags: tags.map((tag) => ({
      id: tag.id,
      name: tag.name,
      color: tag.color,
      description: tag.description,
    })),
    reminders: reminders.map((reminder) => ({
      id: reminder.id,
      title: reminder.title,
      notes: reminder.notes,
      dueAt: reminder.dueAt,
      status: reminder.status,
    })),
    conversations: conversations.map((conversation) => ({
      id: conversation.id,
      channel: conversation.channel,
      lastPreview: conversation.lastPreview,
      lastMessageAt: conversation.lastMessageAt,
    })),
    latestMessages: latestMessages.map((message) => ({
      body: message.body,
      direction: message.direction,
      contentType: message.contentType,
      observedAtUtc: message.observedAtUtc,
    })),
    automations,
    automationHistory,
    campaigns,
    notes: contact?.notes ?? null,
    source: "nuoma-api",
    reason: input.reason,
    updatedAt: new Date().toISOString(),
  };
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
