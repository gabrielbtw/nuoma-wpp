import type { Repositories } from "@nuoma/db";

import { normalizePhone } from "./send-policy.js";

export interface ExtensionOverlaySnapshotInput {
  repos: Repositories;
  userId: number;
  phone: string | null;
  phoneSource: string | null;
  title: string | null;
  reason: string;
}

export async function buildExtensionOverlaySnapshot(input: ExtensionOverlaySnapshotInput) {
  let phone = normalizePhone(input.phone);
  const title = stringValue(input.title);
  const titleConversation =
    !phone && title
      ? await input.repos.conversations.findActiveByTitle({
          userId: input.userId,
          channel: "whatsapp",
          title,
        })
      : null;
  let contact = phone
    ? await input.repos.contacts.findByPhone({ userId: input.userId, phone })
    : null;
  if (!contact && titleConversation?.contactId) {
    contact = await input.repos.contacts.findById(titleConversation.contactId);
  }

  phone =
    phone ??
    normalizePhone(contact?.phone) ??
    normalizePhone(titleConversation?.externalThreadId) ??
    normalizePhone(titleConversation?.title);
  const phoneSource =
    phone && titleConversation && (!input.phoneSource || input.phoneSource === "unresolved")
      ? "title-conversation"
      : input.phoneSource;

  const allConversations = await input.repos.conversations.list(input.userId, 100);
  const conversations = allConversations
    .filter((conversation) => {
      if (contact && conversation.contactId === contact.id) {
        return true;
      }
      if (titleConversation && conversation.id === titleConversation.id) {
        return true;
      }
      if (!phone) {
        return false;
      }
      return (
        normalizePhone(conversation.externalThreadId) === phone ||
        normalizePhone(conversation.title) === phone
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
  const automations = (await input.repos.automations.list(input.userId))
    .filter(
      (automation) =>
        automation.status === "active" &&
        (!automation.trigger.channel ||
          !contact?.primaryChannel ||
          automation.trigger.channel === contact.primaryChannel),
    )
    .slice(0, 4);

  return {
    phone,
    phoneSource,
    title,
    contact: contact
      ? {
          name: contact.name,
          status: contact.status,
          primaryChannel: contact.primaryChannel,
          notes: contact.notes,
        }
      : null,
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
    automations: automations.map((automation) => ({
      id: automation.id,
      name: automation.name,
      category: automation.category,
      status: automation.status,
    })),
    notes: contact?.notes ?? null,
    source: "nuoma-api",
    reason: input.reason,
    updatedAt: new Date().toISOString(),
  };
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
