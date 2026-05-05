import { setTimeout as sleep } from "node:timers/promises";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import CDP from "chrome-remote-interface";
import type { Logger } from "pino";

import { CONSTANTS, type WorkerEnv } from "@nuoma/config";
import type { Repositories } from "@nuoma/db";

import {
  NUOMA_OVERLAY_API_BINDING_NAME,
  createNuomaOverlayScript,
} from "../features/overlay/inject.js";
import { SYNC_BINDING_NAME, parseSyncEventPayload, type SyncThreadRef } from "./events.js";
import { createSyncEventHandler, type SyncHandlerMetrics } from "./handler.js";
import { createWhatsAppObserverScript } from "./observer-script.js";

export interface SyncEngineMetrics extends SyncHandlerMetrics {
  connected: boolean;
  bindingCalls: number;
  parseErrors: number;
  reconcileRequests: number;
  reconcileErrors: number;
  overlayApiCalls: number;
  overlayApiErrors: number;
  multiChatReconcileRuns: number;
  multiChatReconcileChats: number;
  multiChatCandidates: number;
  multiChatSkippedNoPhone: number;
  lastReconcileAtUtc: string | null;
  lastForcedConversationId: number | null;
  lastError: string | null;
}

export interface SyncEngineRuntime {
  connected: boolean;
  metrics: SyncEngineMetrics;
  forceConversation: (input: SyncForceConversationInput) => Promise<SyncForceConversationResult>;
  sendTextMessage: (input: SyncSendTextMessageInput) => Promise<SyncSendTextMessageResult>;
  sendVoiceMessage: (input: SyncSendVoiceMessageInput) => Promise<SyncSendVoiceMessageResult>;
  sendDocumentMessage: (
    input: SyncSendDocumentMessageInput,
  ) => Promise<SyncSendDocumentMessageResult>;
  sendMediaMessage: (input: SyncSendMediaMessageInput) => Promise<SyncSendMediaMessageResult>;
  close: () => Promise<void>;
}

type CdpClient = CDP.Client;

export interface SyncForceConversationInput {
  userId: number;
  conversationId?: number;
  phone?: string | null;
  reason?: string;
  history?: SyncHistoryBackfillOptions;
}

export interface SyncForceConversationResult {
  mode: "active-chat" | "phone-navigation" | "unsupported";
  conversationId: number | null;
  phone: string | null;
  reason: string;
  history?: SyncHistoryBackfillResult;
}

export interface SyncHistoryBackfillOptions {
  enabled: boolean;
  maxScrolls?: number;
  delayMs?: number;
}

export interface SyncHistoryBackfillResult {
  mode: "history-backfill";
  scrollsAttempted: number;
  scrollsCompleted: number;
  syncedWindows: number;
  visibleMessageCount: number;
  lastFirstExternalId: string | null;
  lastLastExternalId: string | null;
  stoppedReason:
    | "disabled"
    | "empty-window"
    | "visible-window-not-synced"
    | "top-reached"
    | "max-scrolls"
    | "observer-unavailable";
}

interface SyncReconcileSummary {
  visibleMessageCount: number;
  firstExternalId: string | null;
  lastExternalId: string | null;
  visibleExternalIds: string[];
}

interface SyncHistoryScrollSummary extends SyncReconcileSummary {
  moved: boolean;
  beforeFirstExternalId: string | null;
  beforeScrollTop: number | null;
  afterScrollTop: number | null;
}

type OutgoingDeliveryStatus = "read" | "delivered" | "sent" | "pending" | "unknown";

interface OutgoingBubbleStatus {
  externalId: string | null;
  text: string;
  hasError: boolean;
  deliveryStatus: OutgoingDeliveryStatus;
  hasExpectedText: boolean;
}

interface BrowserProfilePhotoSnapshot {
  thread: SyncThreadRef | null;
  dataBase64: string;
  mimeType: string;
  sha256: string;
  sizeBytes: number;
  sourceUrl: string | null;
}

interface OverlayThreadState {
  mounted: boolean;
  phone: string | null;
  phoneSource: string | null;
  title: string | null;
}

interface OverlayApiRequest {
  id: string;
  method: string;
  params: Record<string, unknown>;
  version: string | null;
  requestedAt: string | null;
}

export interface SyncSendTextMessageInput {
  userId: number;
  conversationId: number;
  phone: string;
  body: string;
  reason?: string;
}

export interface SyncSendTextMessageResult {
  mode: "text-message";
  conversationId: number;
  phone: string;
  reason: string;
  navigationMode: "navigated" | "reused-open-chat";
  externalId: string | null;
  visibleMessageCountBefore: number;
  visibleMessageCountAfter: number;
  lastExternalIdBefore: string | null;
  lastExternalIdAfter: string | null;
}

export interface SyncSendVoiceMessageInput {
  userId: number;
  conversationId: number;
  phone: string;
  wavPath: string;
  durationSecs: number;
  reason?: string;
}

export interface SyncSendVoiceMessageResult {
  mode: "voice-message";
  conversationId: number;
  phone: string;
  reason: string;
  navigationMode: "navigated" | "reused-open-chat";
  durationSecs: number;
  recordingMs: number;
  injectionConsumed: boolean;
  deliveryStatus: "delivered" | "sent" | "pending" | "unknown" | "no-message" | "error";
  nativeVoiceEvidence: boolean;
  displayDurationSecs: number | null;
  externalId: string | null;
  visibleMessageCountBefore: number;
  visibleMessageCountAfter: number;
  lastExternalIdBefore: string | null;
  lastExternalIdAfter: string | null;
}

export interface SyncSendDocumentMessageInput {
  userId: number;
  conversationId: number;
  phone: string;
  filePath: string;
  fileName: string;
  mimeType: string;
  caption?: string | null;
  reason?: string;
}

export interface SyncSendDocumentMessageResult {
  mode: "document-message";
  conversationId: number;
  phone: string;
  reason: string;
  navigationMode: "navigated" | "reused-open-chat";
  externalId: string | null;
  fileName: string;
  mimeType: string;
  captionSent: boolean;
  visibleMessageCountBefore: number;
  visibleMessageCountAfter: number;
  lastExternalIdBefore: string | null;
  lastExternalIdAfter: string | null;
}

export interface SyncSendMediaMessageInput {
  userId: number;
  conversationId: number;
  phone: string;
  mediaType: "image" | "video";
  filePath: string;
  fileName: string;
  mimeType: string;
  files?: Array<{
    filePath: string;
    fileName: string;
    mimeType: string;
  }>;
  caption?: string | null;
  reason?: string;
}

export interface SyncSendMediaMessageResult {
  mode: "media-message";
  contentType: "image" | "video";
  conversationId: number;
  phone: string;
  reason: string;
  navigationMode: "navigated" | "reused-open-chat";
  externalId: string | null;
  fileName: string;
  mimeType: string;
  fileNames: string[];
  mimeTypes: string[];
  mediaCount: number;
  captionSent: boolean;
  visibleMessageCountBefore: number;
  visibleMessageCountAfter: number;
  lastExternalIdBefore: string | null;
  lastExternalIdAfter: string | null;
}

export async function startSyncEngine(input: {
  env: WorkerEnv;
  repos: Repositories;
  logger: Logger;
}): Promise<SyncEngineRuntime> {
  const handler = createSyncEventHandler({
    repos: input.repos,
    logger: input.logger,
  });
  const metrics: SyncEngineMetrics = {
    ...handler.metrics,
    connected: false,
    bindingCalls: 0,
    parseErrors: 0,
    reconcileRequests: 0,
    reconcileErrors: 0,
    overlayApiCalls: 0,
    overlayApiErrors: 0,
    multiChatReconcileRuns: 0,
    multiChatReconcileChats: 0,
    multiChatCandidates: 0,
    multiChatSkippedNoPhone: 0,
    lastReconcileAtUtc: null,
    lastForcedConversationId: null,
    lastError: null,
  };
  const observerSource = createWhatsAppObserverScript(SYNC_BINDING_NAME);
  const overlaySource = createNuomaOverlayScript();

  if (!input.env.WORKER_SYNC_ENABLED) {
    input.logger.info("worker sync disabled by WORKER_SYNC_ENABLED=false");
    return disabledRuntime(metrics);
  }

  let client: CdpClient | null = null;
  let bindingQueue: Promise<void> = Promise.resolve();
  let overlayApiQueue: Promise<void> = Promise.resolve();
  let reconcileQueue: Promise<void> = Promise.resolve();
  let reconcileTimer: NodeJS.Timeout | null = null;
  let openChatPhone: string | null = null;
  const profilePhotoSeenByThread = new Map<string, string>();
  try {
    const target = await selectSyncTarget(input.env);
    client = await CDP({
      host: input.env.CHROMIUM_CDP_HOST,
      port: input.env.CHROMIUM_CDP_PORT,
      target,
    });

    await client.Runtime.enable();
    await client.Page.enable();
    await client.Runtime.addBinding({ name: SYNC_BINDING_NAME });
    await client.Runtime.addBinding({ name: NUOMA_OVERLAY_API_BINDING_NAME });

    client.on("Runtime.bindingCalled", (params: { name: string; payload: string }) => {
      if (params.name === NUOMA_OVERLAY_API_BINDING_NAME) {
        metrics.overlayApiCalls += 1;
        const payload = params.payload;
        overlayApiQueue = overlayApiQueue
          .then(() => handleOverlayApiPayload(payload))
          .catch((error: unknown) => {
            metrics.overlayApiErrors += 1;
            metrics.lastError = serializeError(error);
            input.logger.warn({ error }, "overlay api binding queue failed");
          });
        return;
      }
      if (params.name !== SYNC_BINDING_NAME) {
        return;
      }
      metrics.bindingCalls += 1;
      const payload = params.payload;
      bindingQueue = bindingQueue
        .then(() => handleBindingPayload(payload))
        .catch((error: unknown) => {
          metrics.parseErrors += 1;
          metrics.lastError = serializeError(error);
          input.logger.warn({ error }, "sync binding queue failed");
        });
    });
    client.on("disconnect", () => {
      metrics.connected = false;
      metrics.lastError = "CDP disconnected";
      input.logger.warn("sync engine CDP disconnected");
    });

    await client.Page.addScriptToEvaluateOnNewDocument({ source: observerSource });
    await client.Page.addScriptToEvaluateOnNewDocument({ source: overlaySource });
    await client.Runtime.evaluate({
      expression: observerSource,
      awaitPromise: false,
      includeCommandLineAPI: false,
    });
    await client.Runtime.evaluate({
      expression: overlaySource,
      awaitPromise: false,
      includeCommandLineAPI: false,
    });
    await hydrateOverlayData("startup");
    await requestReconcile("startup", { multiChat: false });
    if (input.env.WORKER_SYNC_RECONCILE_MS > 0) {
      reconcileTimer = setInterval(() => {
        enqueueReconcile("hot-window");
      }, input.env.WORKER_SYNC_RECONCILE_MS);
    }

    metrics.connected = true;
    input.logger.info(
      {
        cdpHost: input.env.CHROMIUM_CDP_HOST,
        cdpPort: input.env.CHROMIUM_CDP_PORT,
        targetUrl: target?.url,
        bindingName: SYNC_BINDING_NAME,
        overlayApiBindingName: NUOMA_OVERLAY_API_BINDING_NAME,
      },
      "sync engine connected via CDP",
    );
  } catch (error) {
    metrics.connected = false;
    metrics.lastError = serializeError(error);
    input.logger.warn({ error }, "sync engine CDP startup failed");
    await client?.close().catch((closeError: unknown) => {
      input.logger.warn({ closeError }, "sync engine CDP close after startup failure failed");
    });
    client = null;
  }

  async function handleOverlayApiPayload(payload: string): Promise<void> {
    let request: OverlayApiRequest | null = null;
    try {
      request = parseOverlayApiRequest(payload);
      if (!request) {
        metrics.overlayApiErrors += 1;
        return;
      }

      if (request.method === "ping") {
        await resolveOverlayApiRequest(request.id, {
          ok: true,
          data: {
            pong: true,
            source: "worker-cdp",
            version: request.version,
            observedAtUtc: new Date().toISOString(),
          },
        });
        return;
      }

      if (request.method === "contactSummary") {
        const title = stringValue(request.params.title);
        const phone =
          normalizePhone(stringValue(request.params.phone)) ??
          normalizePhone(title) ??
          normalizePhone((await readOverlayThreadState()).phone);
        const snapshot = await buildOverlaySnapshot({
          userId: CONSTANTS.defaultUserId,
          phone,
          phoneSource: stringValue(request.params.phoneSource),
          title,
          reason: `overlay-api:${request.method}`,
        });
        await resolveOverlayApiRequest(request.id, {
          ok: true,
          data: {
            ...snapshot,
            source: "nuoma-api",
            apiStatus: "online",
            apiLastMethod: request.method,
            apiLastError: null,
          },
        });
        return;
      }

      await resolveOverlayApiRequest(request.id, {
        ok: false,
        error: {
          code: "unknown_method",
          message: `Unknown Nuoma overlay API method: ${request.method}`,
        },
      });
    } catch (error) {
      metrics.overlayApiErrors += 1;
      metrics.lastError = serializeError(error);
      if (request) {
        await resolveOverlayApiRequest(request.id, {
          ok: false,
          error: {
            code: "handler_error",
            message: serializeError(error),
          },
        });
      }
    }
  }

  async function resolveOverlayApiRequest(
    requestId: string,
    response: Record<string, unknown>,
  ): Promise<void> {
    if (!client) {
      return;
    }
    await client.Runtime.evaluate({
      expression: `
        (() => {
          if (typeof window.__nuomaApiResolve !== "function") {
            return { ok: false, reason: "nuoma-api-resolver-unavailable" };
          }
          return window.__nuomaApiResolve(${JSON.stringify(requestId)}, ${JSON.stringify(response)});
        })()
      `,
      awaitPromise: false,
      returnByValue: true,
      includeCommandLineAPI: false,
    });
  }

  async function handleBindingPayload(payload: string): Promise<void> {
    try {
      const event = parseSyncEventPayload(payload);
      await handler.handle(event);
      if (event.type === "chat-opened" || event.type === "reconcile-snapshot") {
        await captureActiveProfilePhoto(event.thread, event.observedAtUtc, event.type);
      }
      syncMetrics(metrics, handler.metrics);
    } catch (error) {
      metrics.parseErrors += 1;
      metrics.lastError = serializeError(error);
      input.logger.warn({ error }, "sync binding payload failed");
    }
  }

  async function captureActiveProfilePhoto(
    thread: SyncThreadRef,
    observedAtUtc: string,
    triggerType: string,
  ): Promise<void> {
    if (!client) {
      return;
    }
    try {
      const result = await client.Runtime.evaluate({
        expression: `
          (async () => {
            if (typeof window.__nuomaSyncProfilePhoto !== "function") {
              return null;
            }
            return window.__nuomaSyncProfilePhoto();
          })()
        `,
        awaitPromise: true,
        returnByValue: true,
        includeCommandLineAPI: false,
      });
      const snapshot = parseBrowserProfilePhoto(result.result.value);
      if (!snapshot) {
        return;
      }
      const threadKey = profileThreadKey(snapshot.thread ?? thread);
      if (profilePhotoSeenByThread.get(threadKey) === snapshot.sha256) {
        return;
      }

      const buffer = Buffer.from(snapshot.dataBase64, "base64");
      const sha256 = createHash("sha256").update(buffer).digest("hex");
      if (sha256 !== snapshot.sha256) {
        input.logger.warn(
          { threadKey, browserSha256: snapshot.sha256, nodeSha256: sha256 },
          "profile photo hash mismatch",
        );
        return;
      }
      const storagePath = await writeProfilePhotoFile({
        databaseUrl: input.env.DATABASE_URL,
        userId: CONSTANTS.defaultUserId,
        threadKey,
        sha256,
        mimeType: snapshot.mimeType,
        buffer,
      });
      await handler.handle({
        type: "profile-photo-captured",
        source: "wa-web",
        observedAtUtc,
        thread: snapshot.thread ?? thread,
        profilePhoto: {
          fileName: `profile-${sha256.slice(0, 12)}${extensionForMime(snapshot.mimeType)}`,
          mimeType: snapshot.mimeType,
          sha256,
          sizeBytes: buffer.byteLength,
          storagePath,
          sourceUrl: snapshot.sourceUrl,
        },
        details: {
          triggerType,
          captureMode: "cdp-header-image",
        },
      });
      profilePhotoSeenByThread.set(threadKey, sha256);
      syncMetrics(metrics, handler.metrics);
    } catch (error) {
      input.logger.debug({ error, thread }, "profile photo capture skipped");
    }
  }

  async function hydrateOverlayData(reason: string): Promise<void> {
    if (!client) {
      return;
    }
    try {
      const thread = await readOverlayThreadState();
      if (!thread.mounted) {
        return;
      }
      const phone = normalizePhone(thread.phone) ?? normalizePhone(thread.title);
      const snapshot = await buildOverlaySnapshot({
        userId: CONSTANTS.defaultUserId,
        phone,
        phoneSource: thread.phoneSource,
        title: thread.title,
        reason,
      });
      await client.Runtime.evaluate({
        expression: `
          (() => {
            if (typeof window.__nuomaOverlaySetData !== "function") {
              return { ok: false, reason: "overlay-set-data-unavailable" };
            }
            return window.__nuomaOverlaySetData(${JSON.stringify(snapshot)});
          })()
        `,
        awaitPromise: false,
        returnByValue: true,
        includeCommandLineAPI: false,
      });
    } catch (error) {
      input.logger.debug({ error, reason }, "overlay hydration skipped");
    }
  }

  async function readOverlayThreadState(): Promise<OverlayThreadState> {
    if (!client) {
      return { mounted: false, phone: null, phoneSource: null, title: null };
    }
    const result = await client.Runtime.evaluate({
      expression: `
        (() => {
          if (typeof window.__nuomaOverlayRefresh !== "function") {
            return { mounted: false, phone: null, title: null };
          }
          const state = window.__nuomaOverlayRefresh();
          return {
            mounted: Boolean(state && state.mounted),
            phone: state && typeof state.phone === "string" ? state.phone : null,
            phoneSource: state && typeof state.phoneSource === "string" ? state.phoneSource : null,
            title: state && typeof state.title === "string" ? state.title : null
          };
        })()
      `,
      awaitPromise: false,
      returnByValue: true,
      includeCommandLineAPI: false,
    });
    const value = result.result.value;
    if (typeof value !== "object" || value === null) {
      return { mounted: false, phone: null, phoneSource: null, title: null };
    }
    return {
      mounted: Boolean((value as { mounted?: unknown }).mounted),
      phone:
        typeof (value as { phone?: unknown }).phone === "string"
          ? (value as { phone: string }).phone || null
          : null,
      phoneSource:
        typeof (value as { phoneSource?: unknown }).phoneSource === "string"
          ? (value as { phoneSource: string }).phoneSource || null
          : null,
      title:
        typeof (value as { title?: unknown }).title === "string"
          ? (value as { title: string }).title || null
          : null,
    };
  }

  async function buildOverlaySnapshot(inputSnapshot: {
    userId: number;
    phone: string | null;
    phoneSource: string | null;
    title: string | null;
    reason: string;
  }) {
    const phone = inputSnapshot.phone;
    const contact = phone
      ? await input.repos.contacts.findByPhone({ userId: inputSnapshot.userId, phone })
      : null;
    const allConversations = await input.repos.conversations.list(inputSnapshot.userId, 100);
    const conversations = allConversations
      .filter((conversation) => {
        if (contact && conversation.contactId === contact.id) {
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
            userId: inputSnapshot.userId,
            conversationId: conversation.id,
            limit: 2,
            includeDeleted: false,
          }),
        ),
      )
    )
      .flat()
      .slice(0, 3);
    const automations = (await input.repos.automations.list(inputSnapshot.userId))
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
      phoneSource: inputSnapshot.phoneSource,
      title: inputSnapshot.title,
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
      source: "worker-db",
      reason: inputSnapshot.reason,
      updatedAt: new Date().toISOString(),
    };
  }

  async function requestReconcile(
    reason: string,
    options: { multiChat?: boolean } = {},
  ): Promise<void> {
    if (!client) {
      return;
    }
    metrics.reconcileRequests += 1;
    metrics.lastReconcileAtUtc = new Date().toISOString();
    if (input.env.WORKER_SYNC_MULTI_CHAT_ENABLED && options.multiChat !== false) {
      await requestMultiChatReconcile(reason);
      return;
    }
    await requestActiveReconcile(reason);
  }

  async function requestActiveReconcile(
    reason: string,
    details: Record<string, unknown> = {},
  ): Promise<SyncReconcileSummary | null> {
    if (!client) {
      return null;
    }
    const result = await client.Runtime.evaluate({
      expression: `
        (() => {
          if (typeof window.__nuomaSyncReconcile === "function") {
            return window.__nuomaSyncReconcile(${JSON.stringify(reason)}, ${JSON.stringify(details)});
          }
          if (typeof window.__nuomaSyncScan === "function") {
            window.__nuomaSyncScan();
            return { mode: "scan", visited: 0 };
          }
          return { mode: "unavailable", visited: 0 };
        })()
      `,
      awaitPromise: true,
      returnByValue: true,
      includeCommandLineAPI: false,
    });
    await hydrateOverlayData(reason);
    return parseReconcileSummary(result.result.value);
  }

  async function requestMultiChatReconcile(reason: string): Promise<void> {
    if (!client) {
      return;
    }
    await requestActiveReconcile(`${reason}:active`, {
      scope: "multi-chat",
      candidateIndex: -1,
    });
    const candidates = await sidebarCandidates();
    metrics.multiChatCandidates += candidates.length;
    metrics.multiChatSkippedNoPhone += candidates.filter((candidate) => !candidate.phone).length;
    let visited = 0;
    for (const candidate of candidates
      .filter((item): item is SidebarCandidate & { phone: string } => Boolean(item.phone))
      .slice(0, input.env.WORKER_SYNC_MULTI_CHAT_LIMIT)) {
      await navigateWhatsAppPhone(candidate.phone);
      await requestActiveReconcile(`${reason}:sidebar`, {
        scope: "multi-chat",
        candidateTitle: candidate.title,
        candidatePhone: candidate.phone,
      });
      visited += 1;
    }
    if (input.env.WA_INBOX_TARGET_PHONE) {
      await navigateWhatsAppPhone(input.env.WA_INBOX_TARGET_PHONE);
      await requestActiveReconcile(`${reason}:restore`, {
        scope: "multi-chat",
        candidateIndex: -2,
        candidatePhone: input.env.WA_INBOX_TARGET_PHONE,
      });
    }
    metrics.multiChatReconcileRuns += 1;
    metrics.multiChatReconcileChats += visited;
  }

  async function sidebarCandidates(): Promise<SidebarCandidate[]> {
    if (!client) {
      return [];
    }
    const result = await client.Runtime.evaluate({
      expression: `
        (() => {
          if (typeof window.__nuomaSyncSidebarChats !== "function") {
            return [];
          }
          return window.__nuomaSyncSidebarChats(${input.env.WORKER_SYNC_MULTI_CHAT_LIMIT});
        })()
      `,
      awaitPromise: false,
      returnByValue: true,
      includeCommandLineAPI: false,
    });
    return parseSidebarCandidates(result.result.value);
  }

  async function forceConversation(
    forceInput: SyncForceConversationInput,
  ): Promise<SyncForceConversationResult> {
    const reason = forceInput.reason ?? "sync.forceConversation";
    const conversation = forceInput.conversationId
      ? await input.repos.conversations.findById({
          userId: forceInput.userId,
          id: forceInput.conversationId,
        })
      : null;
    const phone =
      normalizePhone(forceInput.phone) ??
      normalizePhone(conversation?.externalThreadId) ??
      normalizePhone(conversation?.title);
    metrics.lastForcedConversationId = conversation?.id ?? forceInput.conversationId ?? null;

    if (!client) {
      throw new Error("sync engine is not connected");
    }

    if (conversation && conversation.channel !== "whatsapp") {
      await requestActiveReconcile(reason, {
        scope: "force-conversation",
        conversationId: conversation.id,
        unsupportedChannel: conversation.channel,
      });
      return {
        mode: "unsupported",
        conversationId: conversation.id,
        phone: null,
        reason,
      };
    }

    if (phone) {
      await navigateWhatsAppPhone(phone);
      await requestActiveReconcile(reason, {
        scope: "force-conversation",
        conversationId: conversation?.id ?? null,
        candidatePhone: phone,
      });
      const history = await maybeBackfillHistory({
        forceInput,
        conversationId: conversation?.id ?? null,
        reason,
        candidatePhone: phone,
      });
      return {
        mode: "phone-navigation",
        conversationId: conversation?.id ?? null,
        phone,
        reason,
        ...(history ? { history } : {}),
      };
    }

    await requestActiveReconcile(reason, {
      scope: "force-conversation",
      conversationId: conversation?.id ?? null,
      fallback: "active-chat",
    });
    const history = await maybeBackfillHistory({
      forceInput,
      conversationId: conversation?.id ?? null,
      reason,
      candidatePhone: null,
    });
    return {
      mode: "active-chat",
      conversationId: conversation?.id ?? null,
      phone: null,
      reason,
      ...(history ? { history } : {}),
    };
  }

  async function sendTextMessage(
    sendInput: SyncSendTextMessageInput,
  ): Promise<SyncSendTextMessageResult> {
    if (!client) {
      throw new Error("sync engine is not connected");
    }
    const phone = normalizePhone(sendInput.phone);
    if (!phone) {
      throw new Error("send_message requires a valid WhatsApp phone");
    }
    const reason = sendInput.reason ?? "send_message";
    const navigationMode = await navigateWhatsAppPhoneForSend(phone);
    await assertActiveSendTarget({
      expectedPhone: phone,
      operation: "send_message",
      userId: sendInput.userId,
      conversationId: sendInput.conversationId,
    });
    const before = await requestActiveReconcile(`${reason}:before-send`, {
      scope: "send-message",
      conversationId: sendInput.conversationId,
      candidatePhone: phone,
      navigationMode,
    });
    await bindingQueue;

    await focusComposerAndInsertText(sendInput.body);
    await clickComposerSendButton();
    const sent = await waitForOutgoingTextBubble(sendInput.body, "send_message", 25_000);

    const after = await requestActiveReconcile(`${reason}:after-send`, {
      scope: "send-message",
      conversationId: sendInput.conversationId,
      candidatePhone: phone,
    });
    await bindingQueue;

    return {
      mode: "text-message",
      conversationId: sendInput.conversationId,
      phone,
      reason,
      navigationMode,
      externalId: sent.externalId,
      visibleMessageCountBefore: before?.visibleMessageCount ?? 0,
      visibleMessageCountAfter: after?.visibleMessageCount ?? 0,
      lastExternalIdBefore: before?.lastExternalId ?? null,
      lastExternalIdAfter: after?.lastExternalId ?? null,
    };
  }

  async function sendVoiceMessage(
    voiceInput: SyncSendVoiceMessageInput,
  ): Promise<SyncSendVoiceMessageResult> {
    if (!client) {
      throw new Error("sync engine is not connected");
    }
    const phone = normalizePhone(voiceInput.phone);
    if (!phone) {
      throw new Error("send_voice requires a valid WhatsApp phone");
    }
    const reason = voiceInput.reason ?? "send_voice";
    const wavBase64 = (await fs.readFile(voiceInput.wavPath)).toString("base64");
    const initScript = voiceRecorderInitScript(wavBase64);
    const script = await client.Page.addScriptToEvaluateOnNewDocument({ source: initScript });
    const navigationMode = await navigateWhatsAppPhoneForVoice(phone);
    try {
      await assertActiveSendTarget({
        expectedPhone: phone,
        operation: "send_voice",
        userId: voiceInput.userId,
        conversationId: voiceInput.conversationId,
      });
      await client.Runtime.evaluate({
        expression: initScript,
        awaitPromise: false,
        includeCommandLineAPI: false,
      });
      const before = await requestActiveReconcile(`${reason}:before-send`, {
        scope: "send-voice",
        conversationId: voiceInput.conversationId,
        candidatePhone: phone,
        navigationMode,
      });
      await bindingQueue;

      await waitForVoiceOverrideReady();
      await sleep(1_500);
      await clickVoiceRecordButton();
      const injectionConsumed = await waitForVoiceInjectionConsumed();
      const recordingMs = Math.round(voiceInput.durationSecs * 1000) + 250;
      await sleep(recordingMs);
      await clickSendButton();
      const deliveryStatus = await pollLastOutgoingDeliveryStatus(30_000);
      await sleep(1_000);

      const after = await requestActiveReconcile(`${reason}:after-send`, {
        scope: "send-voice",
        conversationId: voiceInput.conversationId,
        candidatePhone: phone,
        navigationMode,
      });
      await bindingQueue;
      const bubble = await waitForVoiceBubbleByExternalId(after?.lastExternalId ?? null, 10_000);

      return {
        mode: "voice-message",
        conversationId: voiceInput.conversationId,
        phone,
        reason,
        navigationMode,
        durationSecs: voiceInput.durationSecs,
        recordingMs,
        injectionConsumed,
        deliveryStatus,
        nativeVoiceEvidence: bubble.nativeVoiceEvidence,
        displayDurationSecs: bubble.displayDurationSecs,
        externalId: sentExternalId(before, after),
        visibleMessageCountBefore: before?.visibleMessageCount ?? 0,
        visibleMessageCountAfter: after?.visibleMessageCount ?? 0,
        lastExternalIdBefore: before?.lastExternalId ?? null,
        lastExternalIdAfter: after?.lastExternalId ?? null,
      };
    } finally {
      if (script.identifier) {
        await client.Page.removeScriptToEvaluateOnNewDocument({ identifier: script.identifier });
      }
    }
  }

  async function sendDocumentMessage(
    documentInput: SyncSendDocumentMessageInput,
  ): Promise<SyncSendDocumentMessageResult> {
    if (!client) {
      throw new Error("sync engine is not connected");
    }
    const phone = normalizePhone(documentInput.phone);
    if (!phone) {
      throw new Error("send_document requires a valid WhatsApp phone");
    }
    await fs.access(documentInput.filePath);

    const reason = documentInput.reason ?? "send_document";
    const navigationMode = await navigateWhatsAppPhoneForDocument(phone);
    await assertActiveSendTarget({
      expectedPhone: phone,
      operation: "send_document",
      userId: documentInput.userId,
      conversationId: documentInput.conversationId,
    });
    const before = await requestActiveReconcile(`${reason}:before-send`, {
      scope: "send-document",
      conversationId: documentInput.conversationId,
      candidatePhone: phone,
      navigationMode,
    });
    await bindingQueue;

    await clearDocumentPreviewAttachments();
    await attachDocumentFile(documentInput.filePath);
    const preview = await waitForDocumentPreview(8_000);
    if (preview.attachments !== 1) {
      throw new Error(
        `send_document expected exactly one preview attachment, got ${preview.attachments}`,
      );
    }
    const caption = documentInput.caption?.trim() ?? "";
    let captionSent = false;
    if (caption) {
      captionSent = await tryInsertAttachmentCaption(caption);
    }
    await dismissStartingConversationDialog();
    await clickSendButton();
    const after = await waitForDocumentSendResult({
      reason,
      reconcileScope: "send-document",
      errorPrefix: "send_document",
      conversationId: documentInput.conversationId,
      phone,
      navigationMode,
      before,
      timeoutMs: 25_000,
      preferExternalId: false,
    });
    const externalId = sentExternalId(before, after);
    await waitForOutgoingBubbleDelivery(externalId, "send_document", 30_000);
    const visibleMessageCountBefore = before?.visibleMessageCount ?? 0;
    const visibleMessageCountAfter = after.visibleMessageCount;

    return {
      mode: "document-message",
      conversationId: documentInput.conversationId,
      phone,
      reason,
      navigationMode,
      externalId,
      fileName: documentInput.fileName,
      mimeType: documentInput.mimeType,
      captionSent,
      visibleMessageCountBefore,
      visibleMessageCountAfter,
      lastExternalIdBefore: before?.lastExternalId ?? null,
      lastExternalIdAfter: after?.lastExternalId ?? null,
    };
  }

  async function sendMediaMessage(
    mediaInput: SyncSendMediaMessageInput,
  ): Promise<SyncSendMediaMessageResult> {
    if (!client) {
      throw new Error("sync engine is not connected");
    }
    const phone = normalizePhone(mediaInput.phone);
    if (!phone) {
      throw new Error("send_media requires a valid WhatsApp phone");
    }
    const mediaFiles = mediaInput.files?.length
      ? mediaInput.files
      : [
          {
            filePath: mediaInput.filePath,
            fileName: mediaInput.fileName,
            mimeType: mediaInput.mimeType,
          },
        ];
    for (const file of mediaFiles) {
      await fs.access(file.filePath);
    }

    const reason = mediaInput.reason ?? "send_media";
    const navigationMode = await navigateWhatsAppPhoneForDocument(phone);
    await assertActiveSendTarget({
      expectedPhone: phone,
      operation: `send_media ${mediaInput.mediaType}`,
      userId: mediaInput.userId,
      conversationId: mediaInput.conversationId,
    });
    const before = await requestActiveReconcile(`${reason}:before-send`, {
      scope: "send-media",
      conversationId: mediaInput.conversationId,
      candidatePhone: phone,
      navigationMode,
    });
    await bindingQueue;

    await clearDocumentPreviewAttachments();
    await attachMediaFiles(
      mediaFiles.map((file) => file.filePath),
      mediaInput.mediaType,
    );
    await waitForMediaPreview(mediaInput.mediaType, 8_000);
    const caption = mediaInput.caption?.trim() ?? "";
    let captionSent = false;
    if (caption) {
      captionSent = await tryInsertAttachmentCaption(caption);
    }
    await dismissStartingConversationDialog();
    await clickSendButton();
    const after = await waitForDocumentSendResult({
      reason,
      reconcileScope: "send-media",
      errorPrefix: `send_media ${mediaInput.mediaType}`,
      conversationId: mediaInput.conversationId,
      phone,
      navigationMode,
      before,
      timeoutMs: 25_000,
      preferExternalId: true,
    });
    const externalId = sentExternalId(before, after);
    await waitForOutgoingBubbleDelivery(externalId, `send_media ${mediaInput.mediaType}`, 30_000);

    return {
      mode: "media-message",
      contentType: mediaInput.mediaType,
      conversationId: mediaInput.conversationId,
      phone,
      reason,
      navigationMode,
      externalId,
      fileName: mediaInput.fileName,
      mimeType: mediaInput.mimeType,
      fileNames: mediaFiles.map((file) => file.fileName),
      mimeTypes: mediaFiles.map((file) => file.mimeType),
      mediaCount: mediaFiles.length,
      captionSent,
      visibleMessageCountBefore: before?.visibleMessageCount ?? 0,
      visibleMessageCountAfter: after.visibleMessageCount,
      lastExternalIdBefore: before?.lastExternalId ?? null,
      lastExternalIdAfter: after?.lastExternalId ?? null,
    };
  }

  async function waitForDocumentSendResult(input: {
    reason: string;
    reconcileScope: "send-document" | "send-media";
    errorPrefix: string;
    conversationId: number;
    phone: string;
    navigationMode: "navigated" | "reused-open-chat";
    before: SyncReconcileSummary | null;
    timeoutMs: number;
    preferExternalId: boolean;
  }): Promise<SyncReconcileSummary> {
    const startedAt = Date.now();
    const deadline = startedAt + input.timeoutMs;
    let lastAfter: SyncReconcileSummary | null = null;
    while (Date.now() < deadline) {
      await sleep(Date.now() - startedAt < 1_500 ? 500 : 1_000);
      const after = await requestActiveReconcile(`${input.reason}:after-send`, {
        scope: input.reconcileScope,
        conversationId: input.conversationId,
        candidatePhone: input.phone,
        navigationMode: input.navigationMode,
      });
      await bindingQueue;
      if (after) {
        lastAfter = after;
      }
      if (
        after?.lastExternalId?.startsWith("toast") &&
        after.lastExternalId !== input.before?.lastExternalId
      ) {
        throw new Error(
          `${input.errorPrefix} produced a WhatsApp toast instead of an outgoing message`,
        );
      }
      if (after && sentExternalId(input.before, after)) {
        return after;
      }
      if (
        after &&
        after.visibleMessageCount > (input.before?.visibleMessageCount ?? 0) &&
        !input.preferExternalId
      ) {
        return after;
      }
      const preview = await getAttachmentPreviewState();
      if (!preview.open && Date.now() - startedAt >= 2_000 && after && !input.preferExternalId) {
        return after;
      }
    }

    const preview = await getAttachmentPreviewState();
    if (preview.open) {
      throw new Error(`${input.errorPrefix} preview remained open after send click`);
    }
    if (!lastAfter || lastAfter.visibleMessageCount <= (input.before?.visibleMessageCount ?? 0)) {
      throw new Error(`${input.errorPrefix} did not produce a new visible outgoing bubble`);
    }
    return lastAfter;
  }

  async function focusComposerAndInsertText(body: string): Promise<void> {
    if (!client) {
      return;
    }
    const result = await client.Runtime.evaluate({
      expression: `
        (() => {
          const composer = document.querySelector("footer [contenteditable='true'][role='textbox']") ||
            document.querySelector("footer [contenteditable='true']");
          if (!(composer instanceof HTMLElement)) {
            return { ok: false, reason: "composer-not-found" };
          }
          composer.focus();
          return { ok: true };
        })()
      `,
      awaitPromise: false,
      returnByValue: true,
      includeCommandLineAPI: false,
    });
    const value = result.result.value;
    if (!isRecord(value) || value.ok !== true) {
      throw new Error(`send_message composer unavailable: ${JSON.stringify(value ?? null)}`);
    }
    await client.Input.insertText({ text: body });
    await sleep(300);
    const verify = await client.Runtime.evaluate({
      expression: `
        (() => {
          const composer = document.querySelector("footer [contenteditable='true'][role='textbox']") ||
            document.querySelector("footer [contenteditable='true']");
          if (!(composer instanceof HTMLElement)) {
            return { ok: false, reason: "composer-not-found" };
          }
          const text = String(composer.textContent || composer.innerText || "");
          return { ok: text.includes(${JSON.stringify(body)}), text };
        })()
      `,
      awaitPromise: false,
      returnByValue: true,
      includeCommandLineAPI: false,
    });
    const verifyValue = verify.result.value;
    if (!isRecord(verifyValue) || verifyValue.ok !== true) {
      throw new Error(
        `send_message composer did not receive text: ${JSON.stringify(verifyValue ?? null)}`,
      );
    }
  }

  async function clickComposerSendButton(): Promise<void> {
    if (!client) {
      return;
    }
    const result = await client.Runtime.evaluate({
      expression: `
        (() => {
          const nodes = Array.from(document.querySelectorAll(
            "footer button[aria-label^='Enviar'], footer button[aria-label^='Send'], footer div[aria-label^='Enviar'], footer div[aria-label^='Send'], footer [role='button'][aria-label^='Enviar'], footer [role='button'][aria-label^='Send'], footer span[data-icon*='send'], footer span[data-icon*='end-filled']"
          )).filter((item) => {
            const target = item.closest("button") || item.closest("[role='button']") || item;
            const rect = target.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
          const node = nodes[nodes.length - 1];
          const clickable = node && (
            node.closest("button") ||
            node.closest("[role='button']") ||
            node.closest("div[aria-label]") ||
            node
          );
          if (!clickable) {
            return { ok: false, reason: "send-button-not-found" };
          }
          const rect = clickable.getBoundingClientRect();
          return {
            ok: true,
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
          };
        })()
      `,
      awaitPromise: false,
      returnByValue: true,
      includeCommandLineAPI: false,
    });
    const value = result.result.value;
    if (
      !isRecord(value) ||
      value.ok !== true ||
      typeof value.x !== "number" ||
      typeof value.y !== "number"
    ) {
      throw new Error(`send_message send button unavailable: ${JSON.stringify(value ?? null)}`);
    }
    await client.Input.dispatchMouseEvent({
      type: "mouseMoved",
      x: value.x,
      y: value.y,
    });
    await client.Input.dispatchMouseEvent({
      type: "mousePressed",
      x: value.x,
      y: value.y,
      button: "left",
      clickCount: 1,
    });
    await client.Input.dispatchMouseEvent({
      type: "mouseReleased",
      x: value.x,
      y: value.y,
      button: "left",
      clickCount: 1,
    });
    await sleep(300);
    await client.Runtime.evaluate({
      expression: `
        (() => {
          const node = Array.from(document.querySelectorAll(
            "footer button[aria-label^='Enviar'], footer button[aria-label^='Send'], footer div[aria-label^='Enviar'], footer div[aria-label^='Send'], footer [role='button'][aria-label^='Enviar'], footer [role='button'][aria-label^='Send'], footer span[data-icon*='send'], footer span[data-icon*='end-filled']"
          )).find((item) => {
            const target = item.closest("button") || item.closest("[role='button']") || item;
            const rect = target.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
          const clickable = node && (node.closest("button") || node.closest("[role='button']") || node);
          if (clickable instanceof HTMLElement) {
            clickable.focus();
            clickable.click();
            return true;
          }
          return false;
        })()
      `,
      awaitPromise: false,
      returnByValue: true,
      includeCommandLineAPI: false,
    });
    await sleep(300);
  }

  async function waitForOutgoingTextBubble(
    body: string,
    errorPrefix: string,
    timeoutMs: number,
  ): Promise<{ externalId: string }> {
    const deadline = Date.now() + timeoutMs;
    let last: OutgoingBubbleStatus | null = null;
    while (Date.now() < deadline) {
      last = await inspectOutgoingTextBubble(body);
      if (last?.hasError) {
        throw new Error(`${errorPrefix} outgoing text bubble failed in WhatsApp`);
      }
      if (last?.externalId && last.hasExpectedText && isDeliveredOrSent(last.deliveryStatus)) {
        return { externalId: last.externalId };
      }
      await sleep(750);
    }
    throw new Error(
      `${errorPrefix} did not produce a sent outgoing text bubble: ${JSON.stringify(last)}`,
    );
  }

  async function waitForOutgoingBubbleDelivery(
    externalId: string | null,
    errorPrefix: string,
    timeoutMs: number,
  ): Promise<void> {
    if (!externalId) {
      throw new Error(`${errorPrefix} did not produce a new external id`);
    }
    const deadline = Date.now() + timeoutMs;
    let last: OutgoingBubbleStatus | null = null;
    while (Date.now() < deadline) {
      last = await inspectOutgoingBubbleByExternalId(externalId);
      if (last?.hasError) {
        throw new Error(`${errorPrefix} outgoing bubble failed in WhatsApp`);
      }
      if (last && isDeliveredOrSent(last.deliveryStatus)) {
        return;
      }
      await sleep(1_000);
    }
    throw new Error(`${errorPrefix} did not reach sent/delivered state: ${JSON.stringify(last)}`);
  }

  async function inspectOutgoingTextBubble(body: string): Promise<OutgoingBubbleStatus | null> {
    return inspectOutgoingBubble(
      `
      (() => {
        const body = ${JSON.stringify(body)};
        const messages = Array.from(document.querySelectorAll(".message-out")).reverse();
        return messages.find((message) => String(message.textContent || "").includes(body)) || null;
      })()
    `,
      body,
    );
  }

  async function inspectOutgoingBubbleByExternalId(
    externalId: string,
  ): Promise<OutgoingBubbleStatus | null> {
    return inspectOutgoingBubble(
      `
      (() => {
        const node = document.querySelector('[data-id="' + CSS.escape(${JSON.stringify(externalId)}) + '"]');
        return node && (node.closest(".message-out") || node.querySelector(".message-out") || node);
      })()
    `,
      null,
    );
  }

  async function inspectOutgoingBubble(
    rootExpression: string,
    expectedText: string | null,
  ): Promise<OutgoingBubbleStatus | null> {
    if (!client) {
      return null;
    }
    const result = await client.Runtime.evaluate({
      expression: `
        (() => {
          const root = ${rootExpression};
          if (!(root instanceof HTMLElement)) {
            return null;
          }
          const dataNode = root.matches("[data-id]")
            ? root
            : root.closest("[data-id]") || root.querySelector("[data-id]");
          const externalId = dataNode ? dataNode.getAttribute("data-id") : root.getAttribute("data-id");
          const text = String(root.textContent || "");
          const hasError = Boolean(root.querySelector("span[data-icon='ic-error'], span[data-icon='msg-error'], [data-icon='ic-error'], [data-icon='msg-error']")) ||
            /(^|\\s)ic-error(\\s|$)/i.test(text);
          const deliveryStatus = root.querySelector("span[data-icon='msg-dblcheck-ack']") ? "read"
            : root.querySelector("span[data-icon='msg-dblcheck']") ? "delivered"
            : root.querySelector("span[data-icon='msg-check']") ? "sent"
            : root.querySelector("span[data-icon='msg-time']") ? "pending"
            : "unknown";
          return {
            externalId,
            text,
            hasError,
            deliveryStatus,
            hasExpectedText: ${expectedText === null ? "true" : `text.includes(${JSON.stringify(expectedText)})`}
          };
        })()
      `,
      awaitPromise: false,
      returnByValue: true,
      includeCommandLineAPI: false,
    });
    const value = result.result.value;
    if (!isRecord(value)) {
      return null;
    }
    return {
      externalId:
        typeof value.externalId === "string" && isSendResultExternalId(value.externalId)
          ? value.externalId
          : null,
      text: typeof value.text === "string" ? value.text : "",
      hasError: value.hasError === true,
      deliveryStatus: isOutgoingDeliveryStatus(value.deliveryStatus)
        ? value.deliveryStatus
        : "unknown",
      hasExpectedText: value.hasExpectedText === true,
    };
  }

  function isDeliveredOrSent(status: OutgoingDeliveryStatus): boolean {
    return status === "sent" || status === "delivered" || status === "read";
  }

  function sentExternalId(
    before: SyncReconcileSummary | null,
    after: SyncReconcileSummary | null,
  ): string | null {
    if (!before || !after) {
      return null;
    }
    const candidate = after.lastExternalId;
    if (!candidate || candidate === before.lastExternalId) {
      return null;
    }
    if (isSendResultExternalId(candidate)) {
      return candidate;
    }
    const previousLastIndex = before.lastExternalId
      ? after.visibleExternalIds.lastIndexOf(before.lastExternalId)
      : -1;
    return (
      after.visibleExternalIds
        .slice(previousLastIndex + 1)
        .filter((externalId) => isSendResultExternalId(externalId))
        .at(-1) ?? null
    );
  }

  function isSendResultExternalId(externalId: string): boolean {
    if (externalId.startsWith("toast")) {
      return false;
    }
    if (externalId.startsWith("grouped-sticker--")) {
      return false;
    }
    return true;
  }

  async function attachDocumentFile(filePath: string): Promise<void> {
    if (!client) {
      return;
    }
    await openAttachmentMenu();
    await clickDocumentMenuItem();
    const input = await waitForDocumentFileInput(8_000);
    await client.DOM.setFileInputFiles({
      ...(input.nodeId ? { nodeId: input.nodeId } : { objectId: input.objectId }),
      files: [filePath],
    });
    await sleep(1_000);
  }

  async function attachMediaFiles(
    filePaths: string[],
    mediaType: "image" | "video",
  ): Promise<void> {
    if (!client) {
      return;
    }
    if (filePaths.length === 0) {
      throw new Error(`send_media ${mediaType} requires at least one file`);
    }
    await openAttachmentMenu();
    await clickMediaMenuItem();
    const input = await waitForMediaFileInput(mediaType, 8_000);
    await client.DOM.setFileInputFiles({
      ...(input.nodeId ? { nodeId: input.nodeId } : { objectId: input.objectId }),
      files: filePaths,
    });
    await sleep(1_000);
  }

  async function openAttachmentMenu(): Promise<void> {
    if (!client) {
      return;
    }
    const openState = await client.Runtime.evaluate({
      expression: `
        (() => Boolean(
          Array.from(document.querySelectorAll("button[aria-label='Documento'], [role='menuitem'][aria-label='Documento'], button[aria-label='Document'], [role='menuitem'][aria-label='Document']"))
            .find((item) => {
              const rect = item.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            })
        ))()
      `,
      awaitPromise: false,
      returnByValue: true,
      includeCommandLineAPI: false,
    });
    if (openState.result.value === true) {
      return;
    }
    const result = await client.Runtime.evaluate({
      expression: `
        (() => {
          const selectors = [
            "footer button[aria-label='Anexar']",
            "footer button[aria-label='Attach']",
            "footer div[aria-label='Anexar']",
            "footer div[aria-label='Attach']",
            "footer span[data-icon='plus']",
            "footer span[data-icon='attach-menu-plus']",
            "footer span[data-icon='clip']"
          ];
          for (const selector of selectors) {
            const node = Array.from(document.querySelectorAll(selector)).find((item) => {
              const target = item.closest("button") || item.closest("[role='button']") || item;
              const rect = target.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            });
            const clickable = node && (node.closest("button") || node.closest("[role='button']") || node);
            if (clickable && typeof clickable.click === "function") {
              clickable.click();
              return { ok: true, selector };
            }
          }
          return { ok: false, reason: "attachment-button-not-found" };
        })()
      `,
      awaitPromise: false,
      returnByValue: true,
      includeCommandLineAPI: false,
    });
    const value = result.result.value;
    if (!isRecord(value) || value.ok !== true) {
      throw new Error(
        `send_document attachment menu unavailable: ${JSON.stringify(value ?? null)}`,
      );
    }
  }

  async function waitForDocumentFileInput(
    timeoutMs: number,
  ): Promise<{ nodeId?: number; objectId?: string }> {
    if (!client) {
      throw new Error("sync engine is not connected");
    }
    const deadline = Date.now() + timeoutMs;
    let clickedDocumentMenu = false;
    while (Date.now() < deadline) {
      const result = await client.Runtime.evaluate({
        expression: `
          (() => {
            const inputs = Array.from(document.querySelectorAll("input[type='file']"));
            const preferred = inputs.find((input) => {
              const accept = String(input.getAttribute("accept") || "").toLowerCase();
              const aria = String(input.getAttribute("aria-label") || input.getAttribute("title") || "").toLowerCase();
              return aria.includes("document") ||
                aria.includes("documento") ||
                accept.includes("application") ||
                accept.includes("pdf") ||
                accept === "*";
            }) || null;
            return preferred;
          })()
        `,
        awaitPromise: false,
        returnByValue: false,
        includeCommandLineAPI: false,
      });
      if (result.result.objectId) {
        return { objectId: result.result.objectId };
      }
      if (!clickedDocumentMenu) {
        clickedDocumentMenu = true;
        await clickDocumentMenuItem();
      }
      await sleep(250);
    }
    await clickDocumentMenuItem();
    const retryDeadline = Date.now() + 2_000;
    while (Date.now() < retryDeadline) {
      const documentNode = await client.DOM.getDocument({ depth: -1, pierce: true });
      const node = await client.DOM.querySelector({
        nodeId: documentNode.root.nodeId,
        selector: "input[type='file'][accept='*']",
      });
      if (node.nodeId) {
        return { nodeId: node.nodeId };
      }
      await sleep(250);
    }
    throw new Error("send_document file input unavailable");
  }

  async function clickDocumentMenuItem(): Promise<void> {
    if (!client) {
      return;
    }
    await client.Runtime.evaluate({
      expression: `
        (() => {
          const node = Array.from(document.querySelectorAll(
            "button[aria-label='Documento'], [role='menuitem'][aria-label='Documento'], button[aria-label='Document'], [role='menuitem'][aria-label='Document']"
          )).find((item) => {
            const rect = item.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
          if (node && typeof node.click === "function") {
            node.click();
          }
        })()
      `,
      awaitPromise: false,
      returnByValue: true,
      includeCommandLineAPI: false,
    });
  }

  async function clickMediaMenuItem(): Promise<void> {
    if (!client) {
      return;
    }
    await client.Runtime.evaluate({
      expression: `
        (() => {
          const labels = /fotos e vídeos|fotos e videos|photos and videos|photos & videos|photo & video|foto|photo/i;
          const node = Array.from(document.querySelectorAll(
            "button[aria-label], [role='menuitem'][aria-label], [role='button'][aria-label]"
          )).find((item) => {
            const label = String(item.getAttribute("aria-label") || item.textContent || "");
            const rect = item.getBoundingClientRect();
            return labels.test(label) && rect.width > 0 && rect.height > 0;
          });
          if (node && typeof node.click === "function") {
            node.click();
          }
        })()
      `,
      awaitPromise: false,
      returnByValue: true,
      includeCommandLineAPI: false,
    });
  }

  async function waitForMediaFileInput(
    mediaType: "image" | "video",
    timeoutMs: number,
  ): Promise<{ nodeId?: number; objectId?: string }> {
    if (!client) {
      throw new Error("sync engine is not connected");
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const result = await client.Runtime.evaluate({
        expression: `
          ((mediaType) => {
            const inputs = Array.from(document.querySelectorAll("input[type='file']"));
            const mediaInputs = inputs.filter((input) => {
              const accept = String(input.getAttribute("accept") || "").toLowerCase();
              const aria = String(input.getAttribute("aria-label") || input.getAttribute("title") || "").toLowerCase();
              if (accept === "*") return false;
              if (mediaType === "image") {
                return (
                  accept.includes("image/") ||
                  aria.includes("foto") ||
                  aria.includes("photo") ||
                  aria.includes("image")
                );
              }
              return accept.includes("video/") || aria.includes("vídeo") || aria.includes("video");
            });
            const preferred = mediaInputs.find((input) => {
              const accept = String(input.getAttribute("accept") || "").toLowerCase();
              const acceptsRegularMedia = accept.includes("video/") || accept.includes(",");
              return input.hasAttribute("multiple") || acceptsRegularMedia;
            }) || mediaInputs[0] || null;
            return preferred;
          })(${JSON.stringify(mediaType)})
        `,
        awaitPromise: false,
        returnByValue: false,
        includeCommandLineAPI: false,
      });
      if (result.result.objectId) {
        return { objectId: result.result.objectId };
      }
      await clickMediaMenuItem();
      await sleep(250);
    }
    throw new Error(`send_media ${mediaType} file input unavailable`);
  }

  async function clearDocumentPreviewAttachments(): Promise<void> {
    if (!client) {
      return;
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await client.Runtime.evaluate({
        expression: `
          (() => {
            const node = Array.from(document.querySelectorAll("[aria-label='Remover anexo'], [aria-label='Remove attachment']"))
              .find((item) => {
                const target = item.closest("button") || item.closest("[role='button']") || item;
                const rect = target.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
              });
            const clickable = node && (node.closest("button") || node.closest("[role='button']") || node);
            if (clickable && typeof clickable.click === "function") {
              clickable.click();
              return { removed: true };
            }
            return { removed: false };
          })()
        `,
        awaitPromise: false,
        returnByValue: true,
        includeCommandLineAPI: false,
      });
      const value = result.result.value;
      if (!isRecord(value) || value.removed !== true) {
        return;
      }
      await sleep(600);
    }
  }

  async function waitForDocumentPreview(timeoutMs: number): Promise<{ attachments: number }> {
    if (!client) {
      return { attachments: 0 };
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const result = await client.Runtime.evaluate({
        expression: `
          (() => {
            const body = String(document.body?.innerText || "");
            const incompatible = /arquivo que você tentou adicionar não é compatível|file you tried to add is not supported/i.test(body);
            const attachments = document.querySelectorAll("[aria-label^='Miniatura de documento'], [aria-label^='Document thumbnail']").length;
            const sendVisible = Boolean(Array.from(document.querySelectorAll("[aria-label^='Enviar'], [aria-label^='Send'], span[data-icon*='send'], span[data-icon*='end-filled']"))
              .find((item) => {
                const target = item.closest("button") || item.closest("[role='button']") || item;
                const rect = target.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
              }));
            return { attachments, sendVisible, incompatible };
          })()
        `,
        awaitPromise: false,
        returnByValue: true,
        includeCommandLineAPI: false,
      });
      const value = result.result.value;
      if (isRecord(value) && value.incompatible === true) {
        throw new Error("send_document file is not supported by WhatsApp preview");
      }
      if (
        isRecord(value) &&
        typeof value.attachments === "number" &&
        value.attachments > 0 &&
        value.sendVisible === true
      ) {
        return { attachments: value.attachments };
      }
      await sleep(250);
    }
    throw new Error("send_document preview did not open");
  }

  async function waitForMediaPreview(
    mediaType: "image" | "video",
    timeoutMs: number,
  ): Promise<void> {
    if (!client) {
      return;
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const result = await client.Runtime.evaluate({
        expression: `
          (() => {
            const body = String(document.body?.innerText || "");
            const incompatible = /arquivo que você tentou adicionar não é compatível|file you tried to add is not supported/i.test(body);
            const sendVisible = Boolean(Array.from(document.querySelectorAll("[aria-label^='Enviar'], [aria-label^='Send'], span[data-icon*='send'], span[data-icon*='end-filled']"))
              .find((item) => {
                const target = item.closest("button") || item.closest("[role='button']") || item;
                const rect = target.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
              }));
            const previewVisible = Boolean(Array.from(document.querySelectorAll("img, video, canvas, [aria-label*='imagem'], [aria-label*='Imagem'], [aria-label*='image'], [aria-label*='Image'], [aria-label*='vídeo'], [aria-label*='Vídeo'], [aria-label*='video'], [aria-label*='Video']"))
              .find((item) => {
                const rect = item.getBoundingClientRect();
                return rect.width > 24 && rect.height > 24 && !item.closest("footer");
              }));
            return { sendVisible, previewVisible, incompatible };
          })()
        `,
        awaitPromise: false,
        returnByValue: true,
        includeCommandLineAPI: false,
      });
      const value = result.result.value;
      if (isRecord(value) && value.incompatible === true) {
        throw new Error(`send_media ${mediaType} file is not supported by WhatsApp preview`);
      }
      if (isRecord(value) && value.sendVisible === true && value.previewVisible === true) {
        return;
      }
      await sleep(250);
    }
    throw new Error(`send_media ${mediaType} preview did not open`);
  }

  async function getAttachmentPreviewState(): Promise<{ open: boolean }> {
    if (!client) {
      return { open: false };
    }
    const result = await client.Runtime.evaluate({
      expression: `
          (() => ({
          open: Boolean(document.querySelector("[aria-label='Remover anexo'], [aria-label='Remove attachment'], [aria-label^='Miniatura de documento'], [aria-label^='Document thumbnail']")) ||
            Boolean(Array.from(document.querySelectorAll("img, video, canvas, [aria-label*='imagem'], [aria-label*='Imagem'], [aria-label*='image'], [aria-label*='Image'], [aria-label*='vídeo'], [aria-label*='Vídeo'], [aria-label*='video'], [aria-label*='Video']"))
              .find((item) => {
                const rect = item.getBoundingClientRect();
                return rect.width > 24 && rect.height > 24 && !item.closest("footer");
              }))
        }))()
      `,
      awaitPromise: false,
      returnByValue: true,
      includeCommandLineAPI: false,
    });
    const value = result.result.value;
    return { open: isRecord(value) && value.open === true };
  }

  async function dismissStartingConversationDialog(): Promise<void> {
    if (!client) {
      return;
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await client.Runtime.evaluate({
        expression: `
          (() => {
            const dialogs = Array.from(document.querySelectorAll("[role='dialog']"));
            const dialog = dialogs.find((item) => /iniciando conversa|starting chat/i.test(String(item.textContent || "")));
            if (!dialog) {
              return { found: false, dismissed: false };
            }
            const cancel = Array.from(dialog.querySelectorAll("button, [role='button']"))
              .find((item) => /cancelar|cancel/i.test(String(item.textContent || item.getAttribute("aria-label") || "")));
            if (cancel instanceof HTMLElement) {
              cancel.click();
              return { found: true, dismissed: true, mode: "cancel" };
            }
            if (dialog instanceof HTMLElement) {
              dialog.remove();
              return { found: true, dismissed: true, mode: "remove" };
            }
            return { found: true, dismissed: false };
          })()
        `,
        awaitPromise: false,
        returnByValue: true,
        includeCommandLineAPI: false,
      });
      const value = result.result.value;
      if (!isRecord(value) || value.found !== true) {
        return;
      }
      if (value.dismissed === true) {
        await sleep(500);
      }
    }
  }

  async function tryInsertAttachmentCaption(caption: string): Promise<boolean> {
    try {
      await focusAttachmentCaptionAndInsertText(caption);
      return true;
    } catch (error) {
      input.logger.warn(
        { error },
        "send_document caption unavailable; sending document without caption",
      );
      return false;
    }
  }

  async function focusAttachmentCaptionAndInsertText(caption: string): Promise<void> {
    if (!client) {
      throw new Error("sync engine is not connected");
    }
    const result = await client.Runtime.evaluate({
      expression: `
        (() => {
          const candidates = Array.from(document.querySelectorAll("[contenteditable='true'][role='textbox'], [contenteditable='true']"))
            .filter((item) => {
              const rect = item.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0 && !item.closest("footer");
            });
          const textbox = candidates[candidates.length - 1];
          if (!(textbox instanceof HTMLElement)) {
            return { ok: false, reason: "caption-box-not-found" };
          }
          textbox.focus();
          return { ok: true };
        })()
      `,
      awaitPromise: false,
      returnByValue: true,
      includeCommandLineAPI: false,
    });
    const value = result.result.value;
    if (!isRecord(value) || value.ok !== true) {
      throw new Error(
        `send_document caption composer unavailable: ${JSON.stringify(value ?? null)}`,
      );
    }
    await client.Input.insertText({ text: caption });
    await sleep(300);
  }

  async function clickSendButton(): Promise<void> {
    if (!client) {
      return;
    }
    const result = await client.Runtime.evaluate({
      expression: `
        (() => {
          const nodes = Array.from(document.querySelectorAll(
            "button[aria-label^='Enviar'], button[aria-label^='Send'], div[aria-label^='Enviar'], div[aria-label^='Send'], [role='button'][aria-label^='Enviar'], [role='button'][aria-label^='Send'], span[data-icon*='send'], span[data-icon*='end-filled']"
          )).filter((item) => {
            const target = item.closest("button") || item.closest("[role='button']") || item;
            const rect = target.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
          const node = nodes[nodes.length - 1];
          const clickable = node && (
            node.closest("button") ||
            node.closest("[role='button']") ||
            node.closest("div[aria-label]") ||
            node
          );
          if (clickable) {
            const rect = clickable.getBoundingClientRect();
            return {
              ok: true,
              mode: "coordinates",
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2
            };
          }
          return { ok: false, reason: "send-button-not-found" };
        })()
      `,
      awaitPromise: false,
      returnByValue: true,
      includeCommandLineAPI: false,
    });
    const value = result.result.value;
    if (isRecord(value) && value.ok === true) {
      if (typeof value.x === "number" && typeof value.y === "number") {
        await client.Input.dispatchMouseEvent({
          type: "mouseMoved",
          x: value.x,
          y: value.y,
        });
        await client.Input.dispatchMouseEvent({
          type: "mousePressed",
          x: value.x,
          y: value.y,
          button: "left",
          clickCount: 1,
        });
        await client.Input.dispatchMouseEvent({
          type: "mouseReleased",
          x: value.x,
          y: value.y,
          button: "left",
          clickCount: 1,
        });
        await sleep(300);
        await client.Runtime.evaluate({
          expression: `
            (() => {
              const node = Array.from(document.querySelectorAll("[role='button'][aria-label^='Enviar'], [role='button'][aria-label^='Send'], div[aria-label^='Enviar'], div[aria-label^='Send'], button[aria-label^='Enviar'], button[aria-label^='Send']"))
                .find((item) => {
                  const rect = item.getBoundingClientRect();
                  return rect.width > 0 && rect.height > 0;
                });
              if (node instanceof HTMLElement) {
                node.focus();
                node.click();
              }
            })()
          `,
          awaitPromise: false,
          returnByValue: true,
          includeCommandLineAPI: false,
        });
      }
      return;
    }
    await client.Input.dispatchKeyEvent({
      type: "keyDown",
      windowsVirtualKeyCode: 13,
      key: "Enter",
    });
    await client.Input.dispatchKeyEvent({
      type: "keyUp",
      windowsVirtualKeyCode: 13,
      key: "Enter",
    });
  }

  async function clickVoiceRecordButton(): Promise<void> {
    if (!client) {
      return;
    }
    const result = await client.Runtime.evaluate({
      expression: `
        (() => {
          const nodes = Array.from(document.querySelectorAll(
            "footer button[aria-label='Mensagem de voz'], footer button[aria-label='Voice message'], footer button[aria-label*='voice'], footer button[aria-label*='voz'], footer span[data-icon='ptt']"
          ));
          const node = nodes.reverse().find((item) => {
            const label = String(item.getAttribute("aria-label") || item.getAttribute("title") || item.textContent || "").toLowerCase();
            const button = item.closest("button") || item;
            const rect = button.getBoundingClientRect();
            const visible = rect.width > 0 && rect.height > 0;
            return visible && (label.includes("voz") || label.includes("voice") || item.getAttribute("data-icon") === "ptt");
          });
          const clickable = node && (node.closest("button") || node);
          if (clickable) {
            const rect = clickable.getBoundingClientRect();
            return {
              ok: true,
              ariaLabel: clickable.getAttribute("aria-label"),
              dataTab: clickable.getAttribute("data-tab"),
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2
            };
          }
          return { ok: false, reason: "voice-button-not-found" };
        })()
      `,
      awaitPromise: false,
      returnByValue: true,
      includeCommandLineAPI: false,
    });
    const value = result.result.value;
    if (!isRecord(value) || value.ok !== true) {
      throw new Error(`send_voice mic button unavailable: ${JSON.stringify(value ?? null)}`);
    }
    if (typeof value.x !== "number" || typeof value.y !== "number") {
      throw new Error(`send_voice mic button missing coordinates: ${JSON.stringify(value)}`);
    }
    await client.Input.dispatchMouseEvent({
      type: "mouseMoved",
      x: value.x,
      y: value.y,
    });
    await client.Input.dispatchMouseEvent({
      type: "mousePressed",
      x: value.x,
      y: value.y,
      button: "left",
      clickCount: 1,
    });
    await client.Input.dispatchMouseEvent({
      type: "mouseReleased",
      x: value.x,
      y: value.y,
      button: "left",
      clickCount: 1,
    });
  }

  async function waitForVoiceOverrideReady(): Promise<void> {
    await waitForRuntimeFlag(
      "voice override",
      8_000,
      `
      (() => Boolean(window.__nuomaVoiceWavBase64))()
    `,
    );
  }

  async function waitForVoiceInjectionConsumed(): Promise<boolean> {
    await waitForRuntimeFlag(
      "voice payload consumption",
      15_000,
      `
      (() => Boolean(window.__nuomaVoiceLastInjection))()
    `,
    );
    return true;
  }

  async function waitForRuntimeFlag(
    label: string,
    timeoutMs: number,
    expression: string,
  ): Promise<void> {
    if (!client) {
      throw new Error("sync engine is not connected");
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const result = await client.Runtime.evaluate({
        expression,
        awaitPromise: true,
        returnByValue: true,
        includeCommandLineAPI: false,
      });
      if (result.result.value === true) {
        return;
      }
      await sleep(250);
    }
    throw new Error(`Timed out waiting for ${label}`);
  }

  async function pollLastOutgoingDeliveryStatus(
    timeoutMs: number,
  ): Promise<SyncSendVoiceMessageResult["deliveryStatus"]> {
    if (!client) {
      return "error";
    }
    const deadline = Date.now() + timeoutMs;
    let lastStatus: SyncSendVoiceMessageResult["deliveryStatus"] = "unknown";
    while (Date.now() < deadline) {
      const result = await client.Runtime.evaluate({
        expression: `
          (() => {
            const messages = document.querySelectorAll(".message-out");
            const last = messages[messages.length - 1];
            if (!last) return "no-message";
            if (last.querySelector("span[data-icon='msg-dblcheck']")) return "delivered";
            if (last.querySelector("span[data-icon='msg-check']")) return "sent";
            if (last.querySelector("span[data-icon='msg-time']")) return "pending";
            return "unknown";
          })()
        `,
        awaitPromise: false,
        returnByValue: true,
        includeCommandLineAPI: false,
      });
      const value = result.result.value;
      lastStatus = isVoiceDeliveryStatus(value) ? value : "unknown";
      if (lastStatus === "delivered" || lastStatus === "sent") {
        return lastStatus;
      }
      await sleep(2_000);
    }
    return lastStatus;
  }

  async function inspectVoiceBubble(externalId: string | null): Promise<{
    nativeVoiceEvidence: boolean;
    displayDurationSecs: number | null;
  }> {
    if (!client) {
      return { nativeVoiceEvidence: false, displayDurationSecs: null };
    }
    const result = await client.Runtime.evaluate({
      expression: `
        (() => {
          const externalId = ${JSON.stringify(externalId)};
          const root = externalId
            ? document.querySelector('[data-id="' + CSS.escape(externalId) + '"]')
            : document.querySelectorAll(".message-out")[document.querySelectorAll(".message-out").length - 1];
          const last = root && (root.matches?.(".message-out") ? root : root.querySelector?.(".message-out") || root);
          if (!last) return { text: "", nativeVoiceEvidence: false };
          const text = String(last.textContent || "").trim();
          const slider = last.querySelector("[role='slider'][aria-valuemax], [aria-valuetext]");
          const ariaValueMax = slider ? slider.getAttribute("aria-valuemax") : null;
          const ariaValueText = slider ? slider.getAttribute("aria-valuetext") : null;
          const nativeVoiceEvidence = Boolean(last.querySelector([
            "audio",
            "span[data-icon='audio-play']",
            "span[data-icon='ptt']",
            "[aria-label*='voz']",
            "[aria-label*='Voice']",
            "[aria-label*='voice']"
          ].join(",")));
          return { text, nativeVoiceEvidence, ariaValueMax, ariaValueText };
        })()
      `,
      awaitPromise: false,
      returnByValue: true,
      includeCommandLineAPI: false,
    });
    const value = result.result.value;
    const text = isRecord(value) && typeof value.text === "string" ? value.text : "";
    const ariaValueMax = isRecord(value) ? numberFromUnknown(value.ariaValueMax) : null;
    return {
      nativeVoiceEvidence: isRecord(value) && value.nativeVoiceEvidence === true,
      displayDurationSecs: ariaValueMax ?? parseDisplayDurationSecs(text),
    };
  }

  async function waitForVoiceBubbleByExternalId(
    externalId: string | null,
    timeoutMs: number,
  ): Promise<{
    nativeVoiceEvidence: boolean;
    displayDurationSecs: number | null;
  }> {
    const deadline = Date.now() + timeoutMs;
    let last: {
      nativeVoiceEvidence: boolean;
      displayDurationSecs: number | null;
    } = { nativeVoiceEvidence: false, displayDurationSecs: null };
    while (Date.now() < deadline) {
      last = await inspectVoiceBubble(externalId);
      if (last.nativeVoiceEvidence && last.displayDurationSecs !== null) {
        return last;
      }
      await sleep(500);
    }
    return last;
  }

  async function maybeBackfillHistory(inputBackfill: {
    forceInput: SyncForceConversationInput;
    conversationId: number | null;
    reason: string;
    candidatePhone: string | null;
  }): Promise<SyncHistoryBackfillResult | null> {
    if (!inputBackfill.forceInput.history?.enabled) {
      return null;
    }
    if (!inputBackfill.conversationId) {
      return {
        mode: "history-backfill",
        scrollsAttempted: 0,
        scrollsCompleted: 0,
        syncedWindows: 0,
        visibleMessageCount: 0,
        lastFirstExternalId: null,
        lastLastExternalId: null,
        stoppedReason: "disabled",
      };
    }
    return backfillConversationHistory({
      userId: inputBackfill.forceInput.userId,
      conversationId: inputBackfill.conversationId,
      reason: inputBackfill.reason,
      candidatePhone: inputBackfill.candidatePhone,
      options: inputBackfill.forceInput.history,
    });
  }

  async function backfillConversationHistory(inputBackfill: {
    userId: number;
    conversationId: number;
    reason: string;
    candidatePhone: string | null;
    options: SyncHistoryBackfillOptions;
  }): Promise<SyncHistoryBackfillResult> {
    const maxScrolls = clampInt(inputBackfill.options.maxScrolls ?? 3, 1, 25);
    const delayMs = clampInt(inputBackfill.options.delayMs ?? 1_200, 250, 10_000);
    const result: SyncHistoryBackfillResult = {
      mode: "history-backfill",
      scrollsAttempted: 0,
      scrollsCompleted: 0,
      syncedWindows: 0,
      visibleMessageCount: 0,
      lastFirstExternalId: null,
      lastLastExternalId: null,
      stoppedReason: "max-scrolls",
    };

    for (let index = 0; index < maxScrolls; index += 1) {
      await bindingQueue;
      const summary = await requestActiveReconcile(`${inputBackfill.reason}:history:visible`, {
        scope: "history-backfill",
        conversationId: inputBackfill.conversationId,
        candidatePhone: inputBackfill.candidatePhone,
        historyIndex: index,
      });
      await bindingQueue;
      if (!summary) {
        result.stoppedReason = "observer-unavailable";
        return result;
      }
      updateBackfillResult(result, summary);
      if (summary.visibleExternalIds.length === 0) {
        result.stoppedReason = "empty-window";
        return result;
      }
      const synced = await visibleMessagesAreSynced({
        userId: inputBackfill.userId,
        conversationId: inputBackfill.conversationId,
        externalIds: summary.visibleExternalIds,
      });
      if (!synced) {
        result.stoppedReason = "visible-window-not-synced";
        return result;
      }
      result.syncedWindows += 1;
      result.scrollsAttempted += 1;
      const scroll = await requestHistoryScroll(`${inputBackfill.reason}:history:scroll`, {
        scope: "history-backfill",
        conversationId: inputBackfill.conversationId,
        candidatePhone: inputBackfill.candidatePhone,
        historyIndex: index,
        delayMs,
      });
      await bindingQueue;
      if (!scroll) {
        result.stoppedReason = "observer-unavailable";
        return result;
      }
      updateBackfillResult(result, scroll);
      if (!scroll.moved) {
        result.stoppedReason = "top-reached";
        return result;
      }
      result.scrollsCompleted += 1;
    }

    return result;
  }

  async function requestHistoryScroll(
    reason: string,
    details: Record<string, unknown>,
  ): Promise<SyncHistoryScrollSummary | null> {
    if (!client) {
      return null;
    }
    const result = await client.Runtime.evaluate({
      expression: `
        (() => {
          if (typeof window.__nuomaSyncScrollHistory !== "function") {
            return { mode: "unavailable" };
          }
          return window.__nuomaSyncScrollHistory({
            reason: ${JSON.stringify(reason)},
            details: ${JSON.stringify(details)},
            delayMs: ${JSON.stringify(details.delayMs ?? 1200)}
          });
        })()
      `,
      awaitPromise: true,
      returnByValue: true,
      includeCommandLineAPI: false,
    });
    return parseHistoryScrollSummary(result.result.value);
  }

  async function visibleMessagesAreSynced(inputVisible: {
    userId: number;
    conversationId: number;
    externalIds: string[];
  }): Promise<boolean> {
    const externalIds = [...new Set(inputVisible.externalIds)].filter(Boolean);
    if (externalIds.length === 0) {
      return false;
    }
    for (const externalId of externalIds) {
      const message = await input.repos.messages.findByExternalId({
        userId: inputVisible.userId,
        conversationId: inputVisible.conversationId,
        externalId,
      });
      if (!message) {
        return false;
      }
    }
    return true;
  }

  async function navigateWhatsAppPhone(phone: string): Promise<void> {
    if (!client) {
      return;
    }
    const normalized = phone.replace(/\D/g, "");
    if (!normalized) {
      return;
    }
    const baseUrl = input.env.WA_WEB_URL.endsWith("/")
      ? input.env.WA_WEB_URL.slice(0, -1)
      : input.env.WA_WEB_URL;
    await client.Page.navigate({
      url: `${baseUrl}/send?phone=${encodeURIComponent(normalized)}`,
    });
    await sleep(input.env.WORKER_SYNC_MULTI_CHAT_DELAY_MS + 2_000);
    await waitForWhatsAppChatReady(
      Math.max(input.env.WORKER_SYNC_MULTI_CHAT_DELAY_MS + 20_000, 25_000),
    );
    await client.Runtime.evaluate({
      expression: observerSource,
      awaitPromise: false,
      includeCommandLineAPI: false,
    });
    await client.Runtime.evaluate({
      expression: overlaySource,
      awaitPromise: false,
      includeCommandLineAPI: false,
    });
    await hydrateOverlayData("navigate-phone");
    openChatPhone = normalized;
  }

  async function navigateWhatsAppPhoneForSend(
    phone: string,
  ): Promise<SyncSendTextMessageResult["navigationMode"]> {
    const normalized = normalizePhone(phone);
    if (!normalized) {
      throw new Error("send_message requires a valid WhatsApp phone");
    }
    if (await canReuseOpenChat(normalized)) {
      return "reused-open-chat";
    }
    await client?.Page.navigate({ url: "about:blank" });
    await sleep(500);
    await navigateWhatsAppPhone(normalized);
    return "navigated";
  }

  async function navigateWhatsAppPhoneForVoice(
    phone: string,
  ): Promise<SyncSendVoiceMessageResult["navigationMode"]> {
    const normalized = normalizePhone(phone);
    if (!normalized) {
      throw new Error("send_voice requires a valid WhatsApp phone");
    }
    if (await canReuseOpenChat(normalized)) {
      return "reused-open-chat";
    }
    await client?.Page.navigate({ url: "about:blank" });
    await sleep(500);
    await navigateWhatsAppPhone(normalized);
    return "navigated";
  }

  async function navigateWhatsAppPhoneForDocument(
    phone: string,
  ): Promise<SyncSendDocumentMessageResult["navigationMode"]> {
    const normalized = normalizePhone(phone);
    if (!normalized) {
      throw new Error("send_document requires a valid WhatsApp phone");
    }
    if (await canReuseOpenChat(normalized)) {
      return "reused-open-chat";
    }
    await navigateWhatsAppPhone(normalized);
    return "navigated";
  }

  async function canReuseOpenChat(normalizedPhone: string): Promise<boolean> {
    if (!input.env.WORKER_SEND_REUSE_OPEN_CHAT_ENABLED) {
      return false;
    }
    return openChatPhone === normalizedPhone && (await isWhatsAppChatReady());
  }

  async function assertActiveSendTarget(assertInput: {
    expectedPhone: string;
    operation: string;
    userId: number;
    conversationId: number;
  }): Promise<void> {
    if (!client) {
      throw new Error(`${assertInput.operation} blocked: sync engine is not connected`);
    }
    const expectedConversation = await input.repos.conversations.findById({
      userId: assertInput.userId,
      id: assertInput.conversationId,
    });
    const expectedTitle = isUsefulSendTitle(expectedConversation?.title ?? null)
      ? normalizeTitle(expectedConversation?.title ?? "")
      : null;
    const allowedSelfChatPhones = parseAllowedSendPhones(input.env);
    const result = await client.Runtime.evaluate({
      expression: `
        (() => {
          const clean = (value) => String(value || "").replace(/\\s+/g, " ").trim();
          const normalizePhone = (value) => {
            const digits = String(value || "").replace(/\\D/g, "");
            return digits.length >= 10 ? digits : null;
          };
          const href = String(location.href || "");
          let hrefPhone = null;
          try {
            hrefPhone = href.includes("/send?phone=") ? new URL(href).searchParams.get("phone") : null;
          } catch {
            hrefPhone = null;
          }
          const isChatTitleCandidate = (text) => {
            if (!text || text.length < 2) return false;
            if (text.startsWith("ic-")) return false;
            if (text.startsWith("wds-ic-")) return false;
            if (text.includes("default-contact")) return false;
            if (text.includes("Etiquetar conversa")) return false;
            if (text.includes("Dados do perfil")) return false;
            if (text.includes("clique para mostrar")) return false;
            if (text.includes("label-outline")) return false;
            return true;
          };
          const header = document.querySelector("#main header");
          const titleCandidates = header
            ? Array.from(header.querySelectorAll("span[title]"))
                .map((node) => clean(node.getAttribute("title") || node.textContent))
                .filter(isChatTitleCandidate)
            : [];
          const textCandidates = header
            ? Array.from(header.querySelectorAll("span, div"))
                .map((node) => clean(node.textContent))
                .filter(isChatTitleCandidate)
            : [];
          const title =
            titleCandidates[0] ||
            textCandidates[0] ||
            "";
          return {
            href,
            hrefPhone: normalizePhone(hrefPhone),
            title,
            titlePhone: normalizePhone(title),
            hasComposer: Boolean(document.querySelector("footer [contenteditable='true']")),
          };
        })()
      `,
      awaitPromise: false,
      returnByValue: true,
      includeCommandLineAPI: false,
    });
    const state = isRecord(result.result.value) ? result.result.value : {};
    const hrefPhone = typeof state.hrefPhone === "string" ? state.hrefPhone : null;
    const titlePhone = typeof state.titlePhone === "string" ? state.titlePhone : null;
    const title = typeof state.title === "string" ? state.title : "";
    const hasComposer = state.hasComposer === true;
    const normalizedTitle = normalizeTitle(title);
    if (
      hrefPhone === assertInput.expectedPhone ||
      titlePhone === assertInput.expectedPhone ||
      (openChatPhone === assertInput.expectedPhone && hasComposer) ||
      isAllowedSelfChatTarget({
        expectedPhone: assertInput.expectedPhone,
        allowedPhones: allowedSelfChatPhones,
        title,
        expectedTitle,
      }) ||
      (expectedTitle &&
        (normalizedTitle === expectedTitle || normalizedTitle.startsWith(`${expectedTitle} `)))
    ) {
      return;
    }
    openChatPhone = null;
    const href = typeof state.href === "string" ? state.href : "";
    throw new Error(
      `${assertInput.operation} blocked: active WhatsApp chat does not match target phone ${assertInput.expectedPhone}; hrefPhone=${hrefPhone ?? "none"} titlePhone=${titlePhone ?? "none"} expectedTitle=${JSON.stringify(expectedTitle)} title=${JSON.stringify(title)} href=${JSON.stringify(href)}`,
    );
  }

  async function waitForWhatsAppChatReady(timeoutMs: number): Promise<void> {
    if (!client) {
      return;
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const result = await client.Runtime.evaluate({
        expression: `
          (() => ({
            hasMain: Boolean(document.querySelector("#main")),
            hasSidebar: Boolean(document.querySelector("#pane-side")),
            hasComposer: Boolean(document.querySelector("footer [contenteditable='true']")),
            visibleMessages: document.querySelectorAll("#main [data-id]").length,
            href: String(location.href || "")
          }))()
        `,
        awaitPromise: false,
        returnByValue: true,
        includeCommandLineAPI: false,
      });
      const value = result.result.value;
      if (isReadyChatState(value)) {
        return;
      }
      await sleep(250);
    }
    throw new Error("WhatsApp chat did not become ready: composer not found");
  }

  async function isWhatsAppChatReady(): Promise<boolean> {
    if (!client) {
      return false;
    }
    const result = await client.Runtime.evaluate({
      expression: `
        (() => ({
          hasMain: Boolean(document.querySelector("#main")),
          hasSidebar: Boolean(document.querySelector("#pane-side")),
          hasComposer: Boolean(document.querySelector("footer [contenteditable='true']")),
          visibleMessages: document.querySelectorAll("#main [data-id]").length,
          href: String(location.href || "")
        }))()
      `,
      awaitPromise: false,
      returnByValue: true,
      includeCommandLineAPI: false,
    });
    return isReadyChatState(result.result.value);
  }

  function enqueueReconcile(reason: string): void {
    reconcileQueue = reconcileQueue
      .then(() => requestReconcile(reason))
      .catch((error: unknown) => {
        metrics.reconcileErrors += 1;
        metrics.lastError = serializeError(error);
        input.logger.warn({ error }, "sync hot-window reconcile failed");
      });
  }

  return {
    get connected() {
      return metrics.connected;
    },
    metrics,
    forceConversation,
    sendTextMessage,
    sendVoiceMessage,
    sendDocumentMessage,
    sendMediaMessage,
    close: async () => {
      metrics.connected = false;
      if (reconcileTimer) {
        clearInterval(reconcileTimer);
        reconcileTimer = null;
      }
      await reconcileQueue;
      await bindingQueue;
      await overlayApiQueue;
      await client?.close();
      client = null;
    },
  };
}

async function selectSyncTarget(env: WorkerEnv): Promise<CDP.Target | undefined> {
  const targets = await CDP.List({
    host: env.CHROMIUM_CDP_HOST,
    port: env.CHROMIUM_CDP_PORT,
  });
  return (
    targets.find((target) => target.type === "page" && target.url.startsWith(env.WA_WEB_URL)) ??
    targets.find((target) => target.type === "page" && target.url.includes("web.whatsapp.com")) ??
    targets.find((target) => target.type === "page")
  );
}

function disabledRuntime(metrics: SyncEngineMetrics): SyncEngineRuntime {
  return {
    connected: false,
    metrics,
    forceConversation: async () => {
      throw new Error("sync engine is disabled");
    },
    sendTextMessage: async () => {
      throw new Error("sync engine is disabled");
    },
    sendVoiceMessage: async () => {
      throw new Error("sync engine is disabled");
    },
    sendDocumentMessage: async () => {
      throw new Error("sync engine is disabled");
    },
    sendMediaMessage: async () => {
      throw new Error("sync engine is disabled");
    },
    close: async () => {},
  };
}

interface SidebarCandidate {
  title: string;
  phone: string | null;
  fingerprint: string | null;
}

function parseSidebarCandidates(value: unknown): SidebarCandidate[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const candidates: SidebarCandidate[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const title = (item as { title?: unknown }).title;
    const phone = (item as { phone?: unknown }).phone;
    const fingerprint = (item as { fingerprint?: unknown }).fingerprint;
    if (typeof title !== "string" || title.length === 0) {
      continue;
    }
    candidates.push({
      title,
      phone: typeof phone === "string" ? normalizePhone(phone) : null,
      fingerprint: typeof fingerprint === "string" ? fingerprint : null,
    });
  }
  return candidates;
}

function parseReconcileSummary(value: unknown): SyncReconcileSummary | null {
  if (!isRecord(value)) {
    return null;
  }
  const visibleExternalIds = Array.isArray(value.visibleExternalIds)
    ? value.visibleExternalIds.filter((item): item is string => typeof item === "string")
    : [];
  const visibleMessageCount =
    typeof value.visibleMessageCount === "number" ? Math.max(0, value.visibleMessageCount) : 0;
  return {
    visibleMessageCount,
    firstExternalId: typeof value.firstExternalId === "string" ? value.firstExternalId : null,
    lastExternalId: typeof value.lastExternalId === "string" ? value.lastExternalId : null,
    visibleExternalIds,
  };
}

function parseHistoryScrollSummary(value: unknown): SyncHistoryScrollSummary | null {
  const summary = parseReconcileSummary(value);
  if (!summary || !isRecord(value)) {
    return null;
  }
  return {
    ...summary,
    moved: value.moved === true,
    beforeFirstExternalId:
      typeof value.beforeFirstExternalId === "string" ? value.beforeFirstExternalId : null,
    beforeScrollTop: typeof value.beforeScrollTop === "number" ? value.beforeScrollTop : null,
    afterScrollTop: typeof value.afterScrollTop === "number" ? value.afterScrollTop : null,
  };
}

function parseOverlayApiRequest(payload: string): OverlayApiRequest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) {
    return null;
  }
  const id = stringValue(parsed.id);
  const method = stringValue(parsed.method);
  if (!id || !method) {
    return null;
  }
  return {
    id,
    method,
    params: isRecord(parsed.params) ? parsed.params : {},
    version: stringValue(parsed.version),
    requestedAt: stringValue(parsed.requestedAt),
  };
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function updateBackfillResult(
  target: SyncHistoryBackfillResult,
  summary: SyncReconcileSummary,
): void {
  target.visibleMessageCount = summary.visibleMessageCount;
  target.lastFirstExternalId = summary.firstExternalId;
  target.lastLastExternalId = summary.lastExternalId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isVoiceDeliveryStatus(
  value: unknown,
): value is SyncSendVoiceMessageResult["deliveryStatus"] {
  return (
    value === "delivered" ||
    value === "sent" ||
    value === "pending" ||
    value === "unknown" ||
    value === "no-message" ||
    value === "error"
  );
}

function isOutgoingDeliveryStatus(value: unknown): value is OutgoingDeliveryStatus {
  return (
    value === "read" ||
    value === "delivered" ||
    value === "sent" ||
    value === "pending" ||
    value === "unknown"
  );
}

function isReadyChatState(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.hasMain === true &&
    value.hasSidebar === true &&
    value.hasComposer === true
  );
}

function parseDisplayDurationSecs(text: string): number | null {
  const match = text.match(/(\d{1,2}):(\d{2})/);
  if (!match) {
    return null;
  }
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return null;
  }
  return minutes * 60 + seconds;
}

function numberFromUnknown(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function voiceRecorderInitScript(wavBase64: string): string {
  return `
    (() => {
      const w = window;
      w.__nuomaVoiceWavBase64 = ${JSON.stringify(wavBase64)};
      w.__nuomaVoiceLastInjection = null;
      if (w.__nuomaVoiceInitInstalled) return;
      w.__nuomaVoiceInitInstalled = true;
      const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        const b64Data = w.__nuomaVoiceWavBase64;
        if (constraints && constraints.audio && b64Data) {
          w.__nuomaVoiceWavBase64 = null;
          const binaryStr = w.atob(b64Data);
          const bytes = new Uint8Array(binaryStr.length);
          for (let index = 0; index < binaryStr.length; index += 1) {
            bytes[index] = binaryStr.charCodeAt(index);
          }
          const AudioCtx = w.AudioContext || w.webkitAudioContext;
          const audioCtx = new AudioCtx({ sampleRate: 48000 });
          if (audioCtx.state === "suspended") {
            await audioCtx.resume();
          }
          const audioBuffer = await audioCtx.decodeAudioData(bytes.buffer.slice(0));
          const source = audioCtx.createBufferSource();
          source.buffer = audioBuffer;
          const dest = audioCtx.createMediaStreamDestination();
          source.connect(dest);
          source.start(0);
          w.__nuomaVoiceLastInjection = {
            consumedAt: new Date().toISOString(),
            byteLength: bytes.length,
            sampleRate: audioBuffer.sampleRate
          };
          return dest.stream;
        }
        return originalGetUserMedia(constraints);
      };
    })()
  `;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function normalizePhone(value: string | null | undefined): string | null {
  const normalizedPhone = String(value ?? "").replace(/\D/g, "");
  return normalizedPhone.length >= 10 ? normalizedPhone : null;
}

function parseBrowserProfilePhoto(value: unknown): BrowserProfilePhotoSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }
  const mimeType = typeof value.mimeType === "string" ? value.mimeType : "";
  const sha256 = typeof value.sha256 === "string" ? value.sha256 : "";
  const dataBase64 = typeof value.dataBase64 === "string" ? value.dataBase64 : "";
  const sizeBytes = typeof value.sizeBytes === "number" ? value.sizeBytes : -1;
  if (
    !mimeType.startsWith("image/") ||
    !/^[a-f0-9]{64}$/.test(sha256) ||
    !dataBase64 ||
    !Number.isInteger(sizeBytes) ||
    sizeBytes <= 0
  ) {
    return null;
  }
  return {
    thread: parseBrowserThread(value.thread),
    dataBase64,
    mimeType,
    sha256,
    sizeBytes,
    sourceUrl:
      typeof value.sourceUrl === "string" && isHttpUrl(value.sourceUrl) ? value.sourceUrl : null,
  };
}

function parseBrowserThread(value: unknown): SyncThreadRef | null {
  if (!isRecord(value)) {
    return null;
  }
  const channel =
    value.channel === "instagram" ? "instagram" : value.channel === "whatsapp" ? "whatsapp" : null;
  const externalThreadId = typeof value.externalThreadId === "string" ? value.externalThreadId : "";
  if (!channel || !externalThreadId) {
    return null;
  }
  return {
    channel,
    externalThreadId,
    title:
      typeof value.title === "string" && value.title.length > 0 ? value.title : externalThreadId,
    phone: typeof value.phone === "string" && value.phone.length > 0 ? value.phone : null,
    unreadCount: typeof value.unreadCount === "number" ? Math.max(0, value.unreadCount) : 0,
    fingerprint:
      typeof value.fingerprint === "string" && value.fingerprint.length > 0
        ? value.fingerprint
        : null,
  };
}

async function writeProfilePhotoFile(input: {
  databaseUrl: string;
  userId: number;
  threadKey: string;
  sha256: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<string> {
  const root = mediaStorageRoot(input.databaseUrl);
  const targetDir = path.join(
    root,
    String(input.userId),
    "profile-photos",
    safePathSegment(input.threadKey),
  );
  await fs.mkdir(targetDir, { recursive: true });
  const targetPath = path.join(targetDir, `${input.sha256}${extensionForMime(input.mimeType)}`);
  await fs.writeFile(targetPath, input.buffer);
  return targetPath;
}

function mediaStorageRoot(databaseUrl: string): string {
  if (databaseUrl !== ":memory:") {
    return path.resolve(path.dirname(databaseUrl), "media-assets");
  }
  return path.resolve(process.cwd(), "data", "media-assets");
}

function profileThreadKey(thread: SyncThreadRef): string {
  return (
    normalizePhone(thread.phone) ??
    normalizePhone(thread.externalThreadId) ??
    thread.externalThreadId
  );
}

function safePathSegment(value: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "unknown-thread";
}

function extensionForMime(mimeType: string): string {
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  return ".img";
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeTitle(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function isUsefulSendTitle(value: string | null): boolean {
  const title = normalizeTitle(value ?? "");
  return Boolean(
    title &&
    title !== "online" &&
    title !== "whatsapp" &&
    title !== "whatsapp business" &&
    !normalizePhone(title),
  );
}

function parseAllowedSendPhones(env: WorkerEnv): string[] {
  const phones = new Set<string>();
  for (const raw of [...(env.WA_SEND_ALLOWED_PHONES ?? "").split(","), env.WA_SEND_ALLOWED_PHONE]) {
    const phone = normalizePhone(raw);
    if (phone) {
      phones.add(phone);
    }
  }
  return [...phones];
}

function isAllowedSelfChatTarget(input: {
  expectedPhone: string;
  allowedPhones: string[];
  title: string;
  expectedTitle: string | null;
}): boolean {
  if (!input.allowedPhones.includes(input.expectedPhone)) {
    return false;
  }
  const title = normalizeTitle(input.title);
  const expectedTitle = normalizeTitle(input.expectedTitle ?? "");
  return (
    title === "mensagens para mim" ||
    title === "message yourself" ||
    title.includes("(voce)") ||
    title.includes("(você)") ||
    title.includes("(you)") ||
    expectedTitle.includes("(voce)") ||
    expectedTitle.includes("(você)") ||
    expectedTitle.includes("(you)")
  );
}

function syncMetrics(target: SyncEngineMetrics, source: SyncHandlerMetrics): void {
  target.eventsReceived = source.eventsReceived;
  target.messagesInserted = source.messagesInserted;
  target.messagesDuplicated = source.messagesDuplicated;
  target.statusesUpdated = source.statusesUpdated;
  target.messagesDeleted = source.messagesDeleted;
  target.conversationEvents = source.conversationEvents;
  target.safetyNetPickedUp = source.safetyNetPickedUp;
  target.syncEventLatencyMsLast = source.syncEventLatencyMsLast;
  target.syncEventLatencyMsAvg = source.syncEventLatencyMsAvg;
  target.syncEventLatencyMsMax = source.syncEventLatencyMsMax;
  target.hotWindowReconciles = source.hotWindowReconciles;
  target.multiChatReconciles = source.multiChatReconciles;
  target.profilePhotosCaptured = source.profilePhotosCaptured;
  target.attachmentCandidatesCaptured = source.attachmentCandidatesCaptured;
  target.errors = source.errors;
}

function serializeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
