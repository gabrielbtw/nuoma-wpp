import {
  addMessage,
  enqueueJob,
  ensureDefaultChannelAccounts,
  getActiveChatbotsForChannel,
  getMessageByExternalId,
  matchChatbotRule,
  normalizeInstagramHandle,
  rememberInstagramThreadForContact,
  resolveInstagramContactFromLastMessage,
  triggerIncomingAutomationRuns,
  type InstagramAssistedThreadSnapshot,
  upsertConversation
} from "@nuoma/core";
import { getInstagramAssistedService } from "./instagram-assisted.js";

function stableMessageExternalId(thread: InstagramAssistedThreadSnapshot, messageIndex: number, message: InstagramAssistedThreadSnapshot["messages"][number]) {
  // Only trust externalIds that are NOT positional ig-browser-* IDs (those are unstable across syncs)
  if (message.externalId && !message.externalId.startsWith("ig-browser-") && !message.externalId.startsWith("ig-fixture-")) {
    return message.externalId;
  }

  // Stable content-based ID: threadId + position-from-end + direction + body hash
  // Using position-from-end (not from start) so existing messages keep their IDs when new ones arrive
  const posFromEnd = thread.messages.length - 1 - messageIndex;
  const bodyHash = Buffer.from(message.body).toString("base64url").slice(0, 40);
  return `ig:${thread.threadId}:e${posFromEnd}:${message.direction}:${bodyHash}`;
}

export async function syncInstagramInboxToDatabase(options?: {
  threadLimit?: number;
  messagesLimit?: number;
  scrollPasses?: number;
  scrollStartPass?: number;
}) {
  const instagramService = getInstagramAssistedService();
  const synced = await instagramService.syncInbox(options);
  const threads = synced.threads.slice(0, options?.threadLimit ?? synced.threads.length).map((thread) => ({
    ...thread,
    messages: thread.messages.slice(-(options?.messagesLimit ?? thread.messages.length))
  }));
  const channelAccounts = ensureDefaultChannelAccounts();

  let createdContacts = 0;
  let linkedContacts = 0;
  let importedMessages = 0;
  let automationsQueued = 0;
  let skippedThreads = 0;

  for (const thread of threads) {
    const normalizedUsername = normalizeInstagramHandle(thread.username);
    if (!normalizedUsername) {
      skippedThreads += 1;
      continue;
    }

    const lastMessage = thread.messages[thread.messages.length - 1] ?? null;
    const matched = resolveInstagramContactFromLastMessage({
      instagramUsername: normalizedUsername,
      threadTitle: thread.title,
      lastMessageText: lastMessage?.body ?? thread.lastMessagePreview,
      lastMessageAt: lastMessage?.sentAt ?? thread.lastMessageAt ?? null
    });

    if (matched.created) {
      createdContacts += 1;
    } else {
      linkedContacts += 1;
    }

    const conversation = upsertConversation({
      channel: "instagram",
      channelAccountId: channelAccounts.instagram?.id ?? null,
      contactId: matched.contact.id,
      externalThreadId: thread.threadId,
      title: thread.title,
      contactInstagram: normalizedUsername,
      unreadCount: thread.unreadCount,
      lastMessagePreview: thread.lastMessagePreview,
      lastMessageAt: thread.lastMessageAt,
      lastMessageDirection: thread.lastMessageDirection,
      inboxCategory: "primary",
      internalStatus: "open",
      metadata: {
        mode: "assisted",
        username: normalizedUsername,
        automaticTagsApplied: matched.automaticTagsApplied,
        matchLinkedBy: matched.linkedBy,
        detectedPhone: matched.detectedPhoneNormalized
      }
    });

    if (!conversation) {
      continue;
    }

    const instagramChannelValue =
      matched.contact.channels.find((channel) => channel.type === "instagram" && channel.isActive)?.displayValue ?? matched.contact.instagram ?? null;
    rememberInstagramThreadForContact({
      contactId: matched.contact.id,
      instagram: instagramChannelValue,
      threadId: thread.threadId,
      threadTitle: thread.title,
      observedAt: lastMessage?.sentAt ?? thread.lastMessageAt ?? null,
      source: "instagram-assisted-sync"
    });

    let threadHasNewIncomingMessage = false;
    let latestIncomingAt: string | null = null;

    thread.messages.forEach((message, messageIndex) => {
      const externalId = stableMessageExternalId(thread, messageIndex, message);
      const existingMessage = getMessageByExternalId(externalId);

      addMessage({
        conversationId: conversation.id,
        contactId: matched.contact.id,
        direction: message.direction,
        body: message.body,
        contentType: message.contentType === "text" ? "text" : "file",
        externalId,
        sentAt: message.sentAt,
        meta: {
          source: "instagram-assisted-sync",
          instagramUsername: normalizedUsername
        }
      });

      if (!existingMessage) {
        importedMessages += 1;
      }

      if (!existingMessage && message.direction === "incoming") {
        threadHasNewIncomingMessage = true;
        latestIncomingAt = message.sentAt ?? latestIncomingAt ?? new Date().toISOString();
      }
    });

    if (threadHasNewIncomingMessage) {
      const automationResult = triggerIncomingAutomationRuns({
        channel: "instagram",
        contactId: matched.contact.id,
        conversationId: conversation.id,
        receivedAt: latestIncomingAt
      });
      automationsQueued += automationResult.queued;

      // Evaluate chatbot rules against the latest incoming message
      const latestIncoming = [...thread.messages].reverse().find((m) => m.direction === "incoming");
      if (latestIncoming) {
        const activeChatbots = getActiveChatbotsForChannel("instagram");
        for (const chatbot of activeChatbots) {
          const rule = matchChatbotRule(chatbot.id, latestIncoming.body);
          if (rule && rule.responseBody) {
            enqueueJob({
              type: "send-assisted-message",
              dedupeKey: `chatbot:${conversation.id}:${rule.id}:${latestIncoming.sentAt ?? Date.now()}`,
              payload: {
                source: "rule" as const,
                channel: "instagram" as const,
                conversationId: conversation.id,
                contactId: matched.contact.id,
                externalThreadId: thread.threadId,
                recipientDisplayValue: normalizedUsername,
                recipientNormalizedValue: normalizedUsername,
                text: rule.responseBody,
                contentType: rule.responseType !== "text" ? rule.responseType : "text" as const,
                mediaPath: rule.responseMediaPath ?? null,
                ruleId: rule.id
              }
            });
            break; // First matching chatbot wins
          }
        }
      }
    }
  }

  return {
    session: synced.session,
    syncedThreads: threads.length,
    createdContacts,
    linkedContacts,
    importedMessages,
    automationsQueued,
    skippedThreads
  };
}
