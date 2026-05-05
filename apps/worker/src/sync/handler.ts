import { EventEmitter } from "node:events";

import { CONSTANTS } from "@nuoma/config";
import type { Repositories } from "@nuoma/db";
import type { Logger } from "pino";

import type {
  SyncAttachmentCandidateCapturedEvent,
  SyncConversationEvent,
  SyncDeliveryStatusEvent,
  SyncEvent,
  SyncMessageEvent,
  SyncMessageRemovedEvent,
  SyncProfilePhotoCapturedEvent,
  SyncThreadRef,
} from "./events.js";
import { parseWhatsAppDisplayedAt } from "./timestamps.js";

export interface SyncHandlerMetrics {
  eventsReceived: number;
  messagesInserted: number;
  messagesDuplicated: number;
  statusesUpdated: number;
  messagesDeleted: number;
  conversationEvents: number;
  safetyNetPickedUp: number;
  syncEventLatencyMsLast: number | null;
  syncEventLatencyMsAvg: number | null;
  syncEventLatencyMsMax: number | null;
  hotWindowReconciles: number;
  multiChatReconciles: number;
  profilePhotosCaptured: number;
  attachmentCandidatesCaptured: number;
  errors: number;
}

export interface SyncEventHandler {
  metrics: SyncHandlerMetrics;
  events: EventEmitter;
  handle: (event: SyncEvent) => Promise<void>;
}

export function createSyncEventHandler(input: {
  repos: Repositories;
  logger: Logger;
  userId?: number;
}): SyncEventHandler {
  const metrics: SyncHandlerMetrics = {
    eventsReceived: 0,
    messagesInserted: 0,
    messagesDuplicated: 0,
    statusesUpdated: 0,
    messagesDeleted: 0,
    conversationEvents: 0,
    safetyNetPickedUp: 0,
    syncEventLatencyMsLast: null,
    syncEventLatencyMsAvg: null,
    syncEventLatencyMsMax: null,
    hotWindowReconciles: 0,
    multiChatReconciles: 0,
    profilePhotosCaptured: 0,
    attachmentCandidatesCaptured: 0,
    errors: 0,
  };
  let syncEventLatencyMsTotal = 0;
  let syncEventLatencySamples = 0;
  const events = new EventEmitter();
  const userId = input.userId ?? CONSTANTS.defaultUserId;

  async function handle(event: SyncEvent): Promise<void> {
    metrics.eventsReceived += 1;
    recordEventLatency(event.observedAtUtc);
    try {
      switch (event.type) {
        case "message-added":
        case "message-updated":
          await handleMessageEvent(event);
          break;
        case "delivery-status":
          await handleDeliveryStatus(event);
          break;
        case "message-removed":
          await handleMessageRemoved(event);
          break;
        case "conv-unread":
        case "chat-opened":
        case "conversation-fingerprint-changed":
        case "dom-wa-changed":
        case "reconcile-snapshot":
          await handleConversationEvent(event);
          break;
        case "profile-photo-captured":
          await handleProfilePhotoCaptured(event);
          break;
        case "attachment-candidate-captured":
          await handleAttachmentCandidateCaptured(event);
          break;
        default:
          assertNever(event);
      }
      events.emit("sync:event", event);
    } catch (error) {
      metrics.errors += 1;
      input.logger.warn({ error, eventType: event.type }, "sync event handler failed");
      throw error;
    }
  }

  async function handleMessageEvent(event: SyncMessageEvent): Promise<void> {
    const timestamp =
      event.message.waDisplayedAt === null
        ? parseWhatsAppDisplayedAt(event.message.displayedAtText)
        : null;
    const waDisplayedAt = event.message.waDisplayedAt ?? timestamp?.waDisplayedAt ?? null;
    const timestampPrecision =
      event.message.timestampPrecision === "unknown" && timestamp
        ? timestamp.timestampPrecision
        : event.message.timestampPrecision;
    const messageSecond = event.message.messageSecond ?? timestamp?.messageSecond ?? null;
    const observedAtUtc = event.message.observedAtUtc || event.observedAtUtc;

    const conversation = await upsertConversation(event.thread, {
      lastMessageAt: waDisplayedAt ?? observedAtUtc,
      lastPreview: event.message.body,
      reconcileDetails: event.message.raw.reconcileDetails,
    });
    const inserted = await input.repos.messages.insertOrIgnore({
      userId,
      conversationId: conversation.id,
      contactId: conversation.contactId,
      externalId: event.message.externalId,
      direction: event.message.direction,
      contentType: event.message.contentType,
      status: event.message.status,
      body: event.message.body,
      timestampPrecision,
      messageSecond,
      waInferredSecond: event.message.waInferredSecond,
      waDisplayedAt,
      observedAtUtc,
      raw: {
        ...event.message.raw,
        syncEventType: event.type,
        source: event.source,
        thread: event.thread,
      },
    });

    if (inserted) {
      metrics.messagesInserted += 1;
      if (isSafetyNetMessage(event)) {
        metrics.safetyNetPickedUp += 1;
        await input.repos.systemEvents.create({
          userId,
          type: "sync.safety_net.picked_up",
          severity: "warn",
          payload: JSON.stringify({
            thread: event.thread,
            externalId: event.message.externalId,
            reconcileReason: event.message.raw.reconcileReason ?? null,
          }),
        });
      }
      return;
    }

    metrics.messagesDuplicated += 1;
    if (event.type === "message-updated") {
      const existing = await input.repos.messages.findByExternalId({
        userId,
        conversationId: conversation.id,
        externalId: event.message.externalId,
      });
      const editedAt =
        existing && existing.body !== event.message.body
          ? observedAtUtc
          : (existing?.editedAt ?? null);
      const history =
        existing && existing.body !== event.message.body
          ? appendEditHistory(existing.raw, {
              body: existing.body,
              status: existing.status,
              observedAtUtc: existing.observedAtUtc,
              replacedAtUtc: observedAtUtc,
            })
          : event.message.raw;
      await input.repos.messages.updateObservedByExternalId({
        userId,
        conversationId: conversation.id,
        externalId: event.message.externalId,
        status: event.message.status,
        body: event.message.body,
        contentType: event.message.contentType,
        editedAt,
        raw: history,
      });
    }
  }

  async function handleDeliveryStatus(event: SyncDeliveryStatusEvent): Promise<void> {
    const conversation = await findConversation(event.thread);
    if (!conversation) {
      return;
    }
    const updated = await input.repos.messages.updateStatusByExternalId({
      userId,
      conversationId: conversation.id,
      externalId: event.externalId,
      status: event.status,
    });
    if (updated) {
      metrics.statusesUpdated += 1;
    }
  }

  async function handleMessageRemoved(event: SyncMessageRemovedEvent): Promise<void> {
    const conversation = await findConversation(event.thread);
    if (!conversation) {
      return;
    }
    const existing = await input.repos.messages.findByExternalId({
      userId,
      conversationId: conversation.id,
      externalId: event.externalId,
    });
    const updated = await input.repos.messages.markDeletedByExternalId({
      userId,
      conversationId: conversation.id,
      externalId: event.externalId,
      deletedAt: event.observedAtUtc,
      raw: {
        ...(existing?.raw ?? {}),
        syncEventType: event.type,
        source: event.source,
        deletedAt: event.observedAtUtc,
      },
    });
    if (updated) {
      metrics.messagesDeleted += 1;
    }
  }

  async function handleConversationEvent(event: SyncConversationEvent): Promise<void> {
    await upsertConversation(event.thread, { reconcileDetails: event.details });
    metrics.conversationEvents += 1;
    if (event.type === "reconcile-snapshot") {
      metrics.hotWindowReconciles += 1;
      if (event.details?.scope === "multi-chat") {
        metrics.multiChatReconciles += 1;
      }
    }
    if (event.type === "dom-wa-changed") {
      await input.repos.systemEvents.create({
        userId,
        type: "sync.dom_changed",
        severity: "warn",
        payload: JSON.stringify({
          thread: event.thread,
          details: event.details ?? {},
        }),
      });
    }
  }

  async function handleProfilePhotoCaptured(event: SyncProfilePhotoCapturedEvent): Promise<void> {
    const mediaAsset = await upsertProfilePhotoAsset(event);
    const conversation = await upsertConversation(event.thread, {
      profilePhotoMediaAssetId: mediaAsset.id,
      profilePhotoSha256: mediaAsset.sha256,
      profilePhotoUpdatedAt: event.observedAtUtc,
      reconcileDetails: event.details,
    });
    const contact = await findOrCreateProfileContact(event.thread, conversation.contactId);

    if (contact) {
      await input.repos.contacts.updateProfilePhoto({
        id: contact.id,
        userId,
        mediaAssetId: mediaAsset.id,
        sha256: mediaAsset.sha256,
        observedAtUtc: event.observedAtUtc,
      });
    }

    await input.repos.conversations.updateProfilePhoto({
      id: conversation.id,
      userId,
      contactId: contact?.id ?? conversation.contactId,
      mediaAssetId: mediaAsset.id,
      sha256: mediaAsset.sha256,
      observedAtUtc: event.observedAtUtc,
    });

    metrics.profilePhotosCaptured += 1;
    await input.repos.systemEvents.create({
      userId,
      type: "sync.profile_photo.captured",
      severity: "info",
      payload: JSON.stringify({
        thread: event.thread,
        mediaAssetId: mediaAsset.id,
        sha256: mediaAsset.sha256,
        contactId: contact?.id ?? null,
        conversationId: conversation.id,
      }),
    });
  }

  async function handleAttachmentCandidateCaptured(
    event: SyncAttachmentCandidateCapturedEvent,
  ): Promise<void> {
    const conversation = await upsertConversation(event.thread, {
      lastMessageAt: event.observedAtUtc,
      lastPreview: event.attachment.caption,
      reconcileDetails: event.details,
    });
    const mediaAsset = await upsertAttachmentCandidateAsset(event);
    const message = event.attachment.externalMessageId
      ? await input.repos.messages.findByExternalId({
          userId,
          conversationId: conversation.id,
          externalId: event.attachment.externalMessageId,
        })
      : null;

    const candidate = await input.repos.attachmentCandidates.upsert({
      userId,
      conversationId: conversation.id,
      messageId: message?.id ?? null,
      mediaAssetId: mediaAsset.id,
      channel: event.thread.channel,
      contentType: event.attachment.contentType,
      externalMessageId: event.attachment.externalMessageId,
      caption: event.attachment.caption,
      observedAt: event.observedAtUtc,
      metadata: {
        source: event.source,
        thread: event.thread,
        details: event.details ?? {},
        fileName: mediaAsset.fileName,
        mimeType: mediaAsset.mimeType,
        sha256: mediaAsset.sha256,
        sizeBytes: mediaAsset.sizeBytes,
        storagePath: mediaAsset.storagePath,
        sourceUrl: mediaAsset.sourceUrl,
      },
    });

    metrics.attachmentCandidatesCaptured += 1;
    await input.repos.systemEvents.create({
      userId,
      type: "sync.attachment_candidate.captured",
      severity: "info",
      payload: JSON.stringify({
        thread: event.thread,
        attachmentCandidateId: candidate.id,
        mediaAssetId: mediaAsset.id,
        messageId: message?.id ?? null,
        externalMessageId: event.attachment.externalMessageId,
        contentType: event.attachment.contentType,
      }),
    });
  }

  async function upsertConversation(
    thread: SyncThreadRef,
    inputPatch: {
      lastMessageAt?: string | null;
      lastPreview?: string | null;
      profilePhotoMediaAssetId?: number | null;
      profilePhotoSha256?: string | null;
      profilePhotoUpdatedAt?: string | null;
      reconcileDetails?: unknown;
    },
  ) {
    const canonicalConversation = await findCanonicalConversation(
      thread,
      inputPatch.reconcileDetails,
    );
    if (canonicalConversation) {
      const updated = await input.repos.conversations.updateObservedById({
        userId,
        id: canonicalConversation.id,
        title: isUsefulThreadTitle(thread.title) ? thread.title : canonicalConversation.title,
        lastMessageAt: inputPatch.lastMessageAt,
        lastPreview: inputPatch.lastPreview,
        profilePhotoMediaAssetId: inputPatch.profilePhotoMediaAssetId,
        profilePhotoSha256: inputPatch.profilePhotoSha256,
        profilePhotoUpdatedAt: inputPatch.profilePhotoUpdatedAt,
        unreadCount: thread.unreadCount,
      });
      return updated ?? canonicalConversation;
    }

    const existingThread = await input.repos.conversations.findByExternalThread({
      userId,
      channel: thread.channel,
      externalThreadId: thread.externalThreadId,
    });
    if (existingThread) {
      const updated = await input.repos.conversations.updateObservedById({
        userId,
        id: existingThread.id,
        title: isUsefulThreadTitle(thread.title) ? thread.title : existingThread.title,
        lastMessageAt: inputPatch.lastMessageAt,
        lastPreview: inputPatch.lastPreview,
        profilePhotoMediaAssetId: inputPatch.profilePhotoMediaAssetId,
        profilePhotoSha256: inputPatch.profilePhotoSha256,
        profilePhotoUpdatedAt: inputPatch.profilePhotoUpdatedAt,
        unreadCount: thread.unreadCount,
      });
      return updated ?? existingThread;
    }

    return input.repos.conversations.upsertObserved({
      userId,
      channel: thread.channel,
      externalThreadId: thread.externalThreadId,
      title: isUsefulThreadTitle(thread.title) ? thread.title : thread.externalThreadId,
      lastMessageAt: inputPatch.lastMessageAt,
      lastPreview: inputPatch.lastPreview,
      profilePhotoMediaAssetId: inputPatch.profilePhotoMediaAssetId,
      profilePhotoSha256: inputPatch.profilePhotoSha256,
      profilePhotoUpdatedAt: inputPatch.profilePhotoUpdatedAt,
      unreadCount: thread.unreadCount,
    });
  }

  async function upsertProfilePhotoAsset(event: SyncProfilePhotoCapturedEvent) {
    const existing = await input.repos.mediaAssets.findBySha(userId, event.profilePhoto.sha256);
    if (existing) {
      if (existing.deletedAt) {
        return (
          (await input.repos.mediaAssets.update({
            id: existing.id,
            userId,
            deletedAt: null,
          })) ?? existing
        );
      }
      return existing;
    }

    return input.repos.mediaAssets.create({
      userId,
      type: "image",
      fileName: event.profilePhoto.fileName,
      mimeType: event.profilePhoto.mimeType,
      sha256: event.profilePhoto.sha256,
      sizeBytes: event.profilePhoto.sizeBytes,
      durationMs: null,
      storagePath: event.profilePhoto.storagePath,
      sourceUrl: event.profilePhoto.sourceUrl,
      deletedAt: null,
    });
  }

  async function upsertAttachmentCandidateAsset(event: SyncAttachmentCandidateCapturedEvent) {
    const existing = await input.repos.mediaAssets.findBySha(userId, event.attachment.sha256);
    if (existing) {
      if (existing.deletedAt) {
        return (
          (await input.repos.mediaAssets.update({
            id: existing.id,
            userId,
            deletedAt: null,
          })) ?? existing
        );
      }
      return existing;
    }

    return input.repos.mediaAssets.create({
      userId,
      type: event.attachment.contentType,
      fileName: event.attachment.fileName,
      mimeType: event.attachment.mimeType,
      sha256: event.attachment.sha256,
      sizeBytes: event.attachment.sizeBytes,
      durationMs: event.attachment.durationMs,
      storagePath: event.attachment.storagePath,
      sourceUrl: event.attachment.sourceUrl,
      deletedAt: null,
    });
  }

  async function findOrCreateProfileContact(
    thread: SyncThreadRef,
    currentContactId: number | null,
  ) {
    if (currentContactId) {
      return input.repos.contacts.findById(currentContactId);
    }

    const phone = normalizeThreadPhone(thread);
    const instagramHandle =
      thread.channel === "instagram"
        ? (sanitizeInstagramHandle(thread.externalThreadId) ??
          sanitizeInstagramHandle(thread.title))
        : null;
    const existing = await input.repos.contacts.findByIdentity({
      userId,
      phone,
      instagramHandle,
    });
    if (existing) {
      return existing;
    }

    const usefulTitle = isUsefulThreadTitle(thread.title) ? thread.title.trim() : null;
    if (!phone && !instagramHandle && !usefulTitle) {
      return null;
    }

    return input.repos.contacts.create({
      userId,
      name: usefulTitle ?? instagramHandle ?? phone ?? thread.externalThreadId,
      phone,
      primaryChannel: thread.channel,
      instagramHandle,
      status: "lead",
      notes: null,
    });
  }

  async function findCanonicalConversation(thread: SyncThreadRef, reconcileDetails: unknown) {
    const details = asRecord(reconcileDetails);
    const candidatePhone = stringFromUnknown(details?.candidatePhone);
    const conversationId = numberFromUnknown(details?.conversationId);
    if (conversationId) {
      const conversation = await input.repos.conversations.findById({
        userId,
        id: conversationId,
      });
      if (conversation && conversation.channel === thread.channel) {
        const expectedPhone =
          normalizePhone(candidatePhone) ?? normalizePhone(conversation.externalThreadId);
        if (expectedPhone && !hasTrustworthyThreadIdentity(thread)) {
          await recordUntrustedReconcileTarget(thread, expectedPhone, details);
          return null;
        }
        if (expectedPhone && (await isReconcileTargetMismatch(thread, expectedPhone, details))) {
          return null;
        }
        return conversation;
      }
    }

    const fallbackCandidatePhone = candidatePhone ?? thread.phone;
    if (fallbackCandidatePhone) {
      const expectedPhone = normalizePhone(fallbackCandidatePhone);
      if (expectedPhone && !hasTrustworthyThreadIdentity(thread)) {
        await recordUntrustedReconcileTarget(thread, expectedPhone, details);
        return null;
      }
      if (expectedPhone && (await isReconcileTargetMismatch(thread, expectedPhone, details))) {
        return null;
      }
      const conversation = await input.repos.conversations.findByExternalThread({
        userId,
        channel: thread.channel,
        externalThreadId: fallbackCandidatePhone,
      });
      if (conversation) {
        return conversation;
      }
    }

    if (!isUsefulThreadTitle(thread.title)) {
      return null;
    }
    return input.repos.conversations.findActiveByTitle({
      userId,
      channel: thread.channel,
      title: thread.title,
    });
  }

  async function recordUntrustedReconcileTarget(
    thread: SyncThreadRef,
    expectedPhone: string,
    details: Record<string, unknown> | null,
  ): Promise<void> {
    await input.repos.systemEvents.create({
      userId,
      type: "sync.reconcile_target_untrusted",
      severity: "warn",
      payload: JSON.stringify({
        expectedPhone,
        thread,
        details: details ?? {},
      }),
    });
  }

  async function isReconcileTargetMismatch(
    thread: SyncThreadRef,
    expectedPhone: string,
    details: Record<string, unknown> | null,
  ): Promise<boolean> {
    const observedPhone = normalizeThreadPhone(thread);
    if (!observedPhone || observedPhone === expectedPhone) {
      return false;
    }
    await input.repos.systemEvents.create({
      userId,
      type: "sync.reconcile_target_mismatch",
      severity: "warn",
      payload: JSON.stringify({
        expectedPhone,
        observedPhone,
        thread,
        details: details ?? {},
      }),
    });
    return true;
  }

  async function findConversation(thread: SyncThreadRef) {
    return input.repos.conversations.findByExternalThread({
      userId,
      channel: thread.channel,
      externalThreadId: thread.externalThreadId,
    });
  }

  function recordEventLatency(observedAtUtc: string): void {
    const observedAtMs = Date.parse(observedAtUtc);
    if (!Number.isFinite(observedAtMs)) {
      return;
    }
    const latencyMs = Math.max(0, Date.now() - observedAtMs);
    metrics.syncEventLatencyMsLast = latencyMs;
    syncEventLatencyMsTotal += latencyMs;
    syncEventLatencySamples += 1;
    metrics.syncEventLatencyMsAvg = Math.round(syncEventLatencyMsTotal / syncEventLatencySamples);
    metrics.syncEventLatencyMsMax = Math.max(metrics.syncEventLatencyMsMax ?? 0, latencyMs);
  }

  return {
    metrics,
    events,
    handle,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function numberFromUnknown(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return Number(value);
  }
  return null;
}

function stringFromUnknown(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function normalizeThreadPhone(thread: SyncThreadRef): string | null {
  return (
    normalizePhone(thread.phone) ??
    normalizePhone(thread.externalThreadId) ??
    normalizePhone(thread.title)
  );
}

function normalizePhone(value: string | null | undefined): string | null {
  const digits = value?.replace(/\D/g, "") ?? "";
  return digits.length >= 10 ? digits : null;
}

function sanitizeInstagramHandle(value: string | null | undefined): string | null {
  const cleaned = value?.trim().replace(/^@/, "") ?? "";
  if (!cleaned || normalizePhone(cleaned)) {
    return null;
  }
  return cleaned.slice(0, 120);
}

function hasTrustworthyThreadIdentity(thread: SyncThreadRef): boolean {
  return Boolean(normalizeThreadPhone(thread) || isUsefulThreadTitle(thread.title));
}

function isUsefulThreadTitle(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized.length > 0 &&
    normalized !== "online" &&
    normalized !== "whatsapp" &&
    normalized !== "whatsapp business" &&
    normalized !== "conta comercial" &&
    normalized !== "business account" &&
    !normalized.startsWith("visto por último") &&
    !normalized.startsWith("last seen") &&
    !normalized.includes("digitando") &&
    !normalized.includes("typing") &&
    !normalized.includes("clique para mostrar") &&
    !normalized.includes("click to view")
  );
}

function isSafetyNetMessage(event: SyncMessageEvent): boolean {
  const reason = event.message.raw.reconcileReason;
  return typeof reason === "string" && reason.length > 0 && reason !== "observer-scan";
}

function appendEditHistory(
  raw: Record<string, unknown> | null,
  entry: Record<string, unknown>,
): Record<string, unknown> {
  const base = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const current = Array.isArray(base.editHistory) ? base.editHistory : [];
  return {
    ...base,
    editHistory: [...current, entry],
  };
}

function assertNever(value: never): never {
  throw new Error(`Unsupported sync event: ${JSON.stringify(value)}`);
}
