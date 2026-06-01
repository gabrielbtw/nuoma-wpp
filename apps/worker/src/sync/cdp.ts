import { setTimeout as sleep } from "node:timers/promises";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import CDP from "chrome-remote-interface";
import type { Logger } from "pino";

import { CONSTANTS, type WorkerEnv } from "@nuoma/config";
import { normalizePhone, normalizeWaJid } from "@nuoma/contracts";
import type { Repositories } from "@nuoma/db";

import {
  NUOMA_OVERLAY_API_BINDING_NAME,
  NUOMA_OVERLAY_NATIVE_BRIDGE_NAME,
  createNuomaOverlayScript,
} from "../features/overlay/inject.js";
import {
  isWithin24hWindow,
  listOverlayAutomationOptions,
  runOverlayAutomationNow,
} from "../../../api/src/services/overlay-automations.js";
import {
  listOverlayCampaignOptions,
  runOverlayCampaignNow,
} from "../../../api/src/services/overlay-campaigns.js";
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
  beginContactSession?: (
    input: SyncBeginContactSessionInput,
  ) => Promise<SyncBeginContactSessionResult>;
  forceConversation: (input: SyncForceConversationInput) => Promise<SyncForceConversationResult>;
  ensureTemporaryMessages?: (
    input: SyncEnsureTemporaryMessagesInput,
  ) => Promise<SyncEnsureTemporaryMessagesResult>;
  sendTextMessage: (input: SyncSendTextMessageInput) => Promise<SyncSendTextMessageResult>;
  sendVoiceMessage: (input: SyncSendVoiceMessageInput) => Promise<SyncSendVoiceMessageResult>;
  sendDocumentMessage: (
    input: SyncSendDocumentMessageInput,
  ) => Promise<SyncSendDocumentMessageResult>;
  sendMediaMessage: (input: SyncSendMediaMessageInput) => Promise<SyncSendMediaMessageResult>;
  close: () => Promise<void>;
}

type CdpClient = CDP.Client;
type CdpEventListener = (...args: unknown[]) => void;

export type RegisteredCdpListener = {
  event: string;
  listener: CdpEventListener | null;
};

type RemovableCdpClient = {
  removeListener: (event: string, listener: CdpEventListener) => unknown;
};

export function removeCdpClientListeners(
  client: RemovableCdpClient | null,
  listeners: RegisteredCdpListener[],
): void {
  if (!client) {
    return;
  }
  for (const { event, listener } of listeners) {
    if (listener) {
      client.removeListener(event, listener);
    }
  }
}
export const PROFILE_PHOTO_SEEN_BY_THREAD_CAP = 500;

export function getProfilePhotoSeenByThread(
  seenByThread: Map<string, string>,
  threadKey: string,
): string | undefined {
  const value = seenByThread.get(threadKey);
  if (value === undefined) {
    return undefined;
  }
  seenByThread.delete(threadKey);
  seenByThread.set(threadKey, value);
  return value;
}

export function setProfilePhotoSeenByThread(
  seenByThread: Map<string, string>,
  threadKey: string,
  sha256: string,
  cap = PROFILE_PHOTO_SEEN_BY_THREAD_CAP,
): void {
  if (cap <= 0) {
    seenByThread.clear();
    return;
  }
  if (seenByThread.has(threadKey)) {
    seenByThread.delete(threadKey);
  }
  seenByThread.set(threadKey, sha256);
  while (seenByThread.size > cap) {
    const oldestKey = seenByThread.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    seenByThread.delete(oldestKey);
  }
}

export interface SyncForceConversationInput {
  userId: number;
  conversationId?: number;
  phone?: string | null;
  reason?: string;
  history?: SyncHistoryBackfillOptions;
}

export interface SyncForceConversationResult {
  mode: "active-chat" | "phone-navigation" | "unsupported" | "unresolved";
  conversationId: number | null;
  phone: string | null;
  reason: string;
  history?: SyncHistoryBackfillResult;
}

export type SyncTemporaryMessagesDuration = "24h" | "7d" | "90d";

export type SyncTemporaryMessagesPhase =
  | "before_send"
  | "temporary_messages_set"
  | "after_completion_restore"
  | "failure_restore";

export interface SyncEnsureTemporaryMessagesInput {
  userId: number;
  conversationId: number;
  phone: string;
  duration: SyncTemporaryMessagesDuration;
  phase: SyncTemporaryMessagesPhase;
  reason?: string;
}

export interface SyncEnsureTemporaryMessagesResult {
  mode: "temporary-messages";
  conversationId: number;
  phone: string;
  requestedDuration: SyncTemporaryMessagesDuration;
  verifiedDuration: SyncTemporaryMessagesDuration | null;
  phase: SyncTemporaryMessagesPhase;
  reason: string;
  navigationMode: "navigated" | "reused-open-chat";
  changed: boolean;
  menuDetected: boolean;
  targetEvidence: ActiveSendTargetState;
  visualProof?: {
    screenshotPath: string;
    verifiedDuration: SyncTemporaryMessagesDuration;
    textEvidence: string;
  };
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

export interface ReadyChatState {
  hasMain: boolean;
  hasSidebar: boolean;
  hasComposer: boolean;
  startingConversation: boolean;
  headerTitle: string;
  visibleMessages?: number;
  href?: string;
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
  waJid: string | null;
  phoneSource: string | null;
  title: string | null;
}

export interface ActiveSendTargetState {
  href: string;
  hrefPhone: string | null;
  title: string;
  titlePhone: string | null;
  overlayPhone: string | null;
  contactInfoPhone: string | null;
  hasComposer: boolean;
}

interface OverlayApiRequest {
  id: string;
  method: string;
  params: Record<string, unknown>;
  mutation: OverlayApiMutationGuard | null;
  version: string | null;
  requestedAt: string | null;
}

interface OverlayApiMutationGuard {
  nonce: string;
  idempotencyKey: string;
  confirmed: boolean;
  confirmationText: string | null;
  preparedAt: string | null;
  queuedAt: string | null;
}

const overlayApiReadOnlyMethods = new Set(["ping", "contactSummary"]);

export interface SyncSendTextMessageInput {
  userId: number;
  conversationId: number;
  phone: string;
  body: string;
  reason?: string;
}

export interface SyncBeginContactSessionInput {
  userId: number;
  conversationId: number;
  phone: string;
  reason?: string;
}

export interface SyncBeginContactSessionResult {
  mode: "contact-session";
  conversationId: number;
  phone: string;
  reason: string;
  navigationMode: "navigated" | "reused-open-chat";
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
  audioPath: string;
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
  voiceSendMode?: "native-ptt";
  fallbackReason?: string | null;
  internalFallbackChatId?: string | null;
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
  previewAttachmentCount?: number;
  sentByInternalFallback?: boolean;
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
    return disabledRuntime(metrics, () => handler.close());
  }

  let client: CdpClient | null = null;
  let bindingQueue: Promise<void> = Promise.resolve();
  let overlayApiQueue: Promise<void> = Promise.resolve();
  let reconcileQueue: Promise<void> = Promise.resolve();
  let reconcileTimer: NodeJS.Timeout | null = null;
  let runtimeBindingCalledListener: CdpEventListener | null = null;
  let pageJavascriptDialogOpeningListener: CdpEventListener | null = null;
  let disconnectListener: CdpEventListener | null = null;
  let openChatPhone: string | null = null;
  let openChatPhoneNavigatedAtMs = 0;
  const profilePhotoSeenByThread = new Map<string, string>();

  function removeClientListeners(): void {
    removeCdpClientListeners(client as RemovableCdpClient | null, [
      { event: "Runtime.bindingCalled", listener: runtimeBindingCalledListener },
      { event: "Page.javascriptDialogOpening", listener: pageJavascriptDialogOpeningListener },
      { event: "disconnect", listener: disconnectListener },
    ]);
    runtimeBindingCalledListener = null;
    pageJavascriptDialogOpeningListener = null;
    disconnectListener = null;
  }

  try {
    const target = await selectSyncTarget(input.env);
    client = await withTimeout(
      CDP({
        host: input.env.CHROMIUM_CDP_HOST,
        port: input.env.CHROMIUM_CDP_PORT,
        target,
      }),
      5_000,
      "CDP sync target attach timed out",
    );

    await withTimeout(client.Runtime.enable(), 5_000, "CDP Runtime.enable timed out");
    await withTimeout(client.Page.enable(), 5_000, "CDP Page.enable timed out");
    await withTimeout(
      client.Runtime.removeBinding({ name: NUOMA_OVERLAY_API_BINDING_NAME }),
      5_000,
      "CDP overlay binding cleanup timed out",
    ).catch(() => undefined);
    await withTimeout(
      client.Runtime.evaluate({
        expression: `
          (() => {
            delete window.${NUOMA_OVERLAY_API_BINDING_NAME};
            delete window.${NUOMA_OVERLAY_NATIVE_BRIDGE_NAME};
            delete window.__nuomaApiResolve;
            if (window.__nuomaOverlayState && typeof window.__nuomaOverlayState === "object") {
              window.__nuomaOverlayState.apiBridge = null;
              window.__nuomaOverlayState.apiPending = {};
              window.__nuomaOverlayState.apiInFlight = false;
              window.__nuomaOverlayState.apiStatus = "offline";
              window.__nuomaOverlayState.apiLastMethod = "";
              window.__nuomaOverlayState.apiLastError = "";
            }
            return true;
          })()
        `,
        awaitPromise: false,
        returnByValue: true,
        includeCommandLineAPI: false,
      }),
      5_000,
      "CDP overlay binding cleanup evaluate timed out",
    ).catch(() => undefined);
    await withTimeout(
      client.Runtime.addBinding({ name: SYNC_BINDING_NAME }),
      5_000,
      "CDP sync binding add timed out",
    );
    await withTimeout(
      client.Runtime.addBinding({ name: NUOMA_OVERLAY_API_BINDING_NAME }),
      5_000,
      "CDP overlay binding add timed out",
    );
    const overlayBridgePrelude = `
      (() => {
        if (typeof window.${NUOMA_OVERLAY_API_BINDING_NAME} === "function") {
          window.${NUOMA_OVERLAY_NATIVE_BRIDGE_NAME} = window.${NUOMA_OVERLAY_API_BINDING_NAME}.bind(window);
        }
        return true;
      })()
    `;

    runtimeBindingCalledListener = (paramsValue: unknown) => {
      const params = paramsValue as { name: string; payload: string };
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
    };
    client.on("Runtime.bindingCalled", runtimeBindingCalledListener);

    pageJavascriptDialogOpeningListener = (paramsValue: unknown) => {
      const params = paramsValue as { type?: string; message?: string };
      void client?.Page.handleJavaScriptDialog({ accept: true }).catch((error: unknown) => {
        metrics.lastError = serializeError(error);
        input.logger.warn({ error }, "failed to auto-accept WhatsApp browser dialog");
      });
      input.logger.info(
        {
          dialogType: params.type ?? "unknown",
          message: params.message ?? "",
        },
        "WhatsApp browser dialog auto-accepted",
      );
    };
    client.on("Page.javascriptDialogOpening", pageJavascriptDialogOpeningListener);

    disconnectListener = () => {
      metrics.connected = false;
      metrics.lastError = "CDP disconnected";
      input.logger.warn("sync engine CDP disconnected");
    };
    client.on("disconnect", disconnectListener);

    await withTimeout(
      client.Page.addScriptToEvaluateOnNewDocument({ source: observerSource }),
      5_000,
      "CDP observer preload timed out",
    );
    await withTimeout(
      client.Page.addScriptToEvaluateOnNewDocument({ source: overlayBridgePrelude }),
      5_000,
      "CDP overlay bridge preload timed out",
    );
    await withTimeout(
      client.Page.addScriptToEvaluateOnNewDocument({ source: overlaySource }),
      5_000,
      "CDP overlay preload timed out",
    );
    await withTimeout(
      client.Runtime.evaluate({
        expression: observerSource,
        awaitPromise: false,
        includeCommandLineAPI: false,
      }),
      10_000,
      "CDP observer injection timed out",
    );
    await withTimeout(
      client.Runtime.evaluate({
        expression: overlayBridgePrelude,
        awaitPromise: false,
        includeCommandLineAPI: false,
      }),
      5_000,
      "CDP overlay bridge injection timed out",
    );
    await withTimeout(
      client.Runtime.evaluate({
        expression: overlaySource,
        awaitPromise: false,
        includeCommandLineAPI: false,
      }),
      10_000,
      "CDP overlay injection timed out",
    );
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
    void Promise.resolve()
      .then(async () => {
        await hydrateOverlayData("startup");
        await requestReconcile("startup", { multiChat: false });
      })
      .catch((error: unknown) => {
        metrics.lastError = serializeError(error);
        input.logger.warn({ error }, "sync engine startup hydrate/reconcile failed");
      });
    if (input.env.WORKER_SYNC_RECONCILE_MS > 0) {
      reconcileTimer = setInterval(() => {
        enqueueReconcile("hot-window");
      }, input.env.WORKER_SYNC_RECONCILE_MS);
    }
  } catch (error) {
    metrics.connected = false;
    metrics.lastError = serializeError(error);
    input.logger.warn({ error }, "sync engine CDP startup failed");
    removeClientListeners();
    await client?.close().catch((closeError: unknown) => {
      input.logger.warn({ closeError }, "sync engine CDP close after startup failure failed");
    });
    client = null;
  }

  async function handleOverlayApiPayload(payload: string): Promise<void> {
    const startedAt = Date.now();
    let request: OverlayApiRequest | null = null;
    let auditPhone: string | null = null;
    let auditPhoneSource: string | null = null;
    try {
      request = parseOverlayApiRequest(payload);
      if (!request) {
        metrics.overlayApiErrors += 1;
        await auditOverlayApiRequest({
          request,
          ok: false,
          phone: auditPhone,
          phoneSource: auditPhoneSource,
          latencyMs: Date.now() - startedAt,
          errorCode: "invalid_payload",
          errorMessage: "Invalid Nuoma overlay API payload",
        });
        return;
      }

      const securityCheck = validateOverlayApiSecurity(request);
      if (!securityCheck.ok) {
        metrics.overlayApiErrors += 1;
        await resolveOverlayApiRequest(request.id, {
          ok: false,
          error: {
            code: securityCheck.errorCode,
            message: securityCheck.errorMessage,
          },
        });
        await auditOverlayApiRequest({
          request,
          ok: false,
          phone: auditPhone,
          phoneSource: auditPhoneSource,
          latencyMs: Date.now() - startedAt,
          errorCode: securityCheck.errorCode,
          errorMessage: securityCheck.errorMessage,
        });
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
        await auditOverlayApiRequest({
          request,
          ok: true,
          phone: auditPhone,
          phoneSource: auditPhoneSource,
          latencyMs: Date.now() - startedAt,
        });
        return;
      }

      if (request.method === "contactSummary") {
        const title = stringValue(request.params.title);
        auditPhoneSource = stringValue(request.params.phoneSource);
        const overlayThread = await readOverlayThreadState();
        const waJid =
          normalizeWaJid(stringValue(request.params.waJid)) ?? normalizeWaJid(overlayThread.waJid);
        const phone =
          normalizePhone(stringValue(request.params.phone)) ??
          normalizePhone(waJid) ??
          normalizePhone(overlayThread.phone);
        auditPhone = phone;
        const snapshot = await buildOverlaySnapshot({
          userId: CONSTANTS.defaultUserId,
          phone,
          waJid,
          phoneSource: auditPhoneSource,
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
        await auditOverlayApiRequest({
          request,
          ok: true,
          phone: auditPhone,
          phoneSource: auditPhoneSource,
          latencyMs: Date.now() - startedAt,
        });
        return;
      }

      if (request.method === "forceConversationSync") {
        const title = stringValue(request.params.title);
        auditPhoneSource = stringValue(request.params.phoneSource);
        const overlayThread = await readOverlayThreadState();
        const waJid =
          normalizeWaJid(stringValue(request.params.waJid)) ?? normalizeWaJid(overlayThread.waJid);
        const phone =
          normalizePhone(stringValue(request.params.phone)) ??
          normalizePhone(waJid) ??
          normalizePhone(overlayThread.phone);
        auditPhone = phone;
        const conversationId = positiveIntegerValue(request.params.conversationId);
        const result = await forceConversation({
          userId: CONSTANTS.defaultUserId,
          conversationId: conversationId ?? undefined,
          phone,
          reason: `overlay-api:${stringValue(request.params.reason) ?? request.method}`,
          history: {
            enabled: true,
            maxScrolls: 8,
            delayMs: 450,
          },
        });
        const snapshot = await buildOverlaySnapshot({
          userId: CONSTANTS.defaultUserId,
          phone: result.phone ?? phone,
          waJid,
          phoneSource: auditPhoneSource,
          title,
          reason: `overlay-api:${request.method}:after`,
        });
        await resolveOverlayApiRequest(request.id, {
          ok: true,
          data: {
            result,
            snapshot: {
              ...snapshot,
              source: "nuoma-api",
              apiStatus: "online",
              apiLastMethod: request.method,
              apiLastError: null,
            },
          },
        });
        await auditOverlayApiRequest({
          request,
          ok: true,
          phone: auditPhone,
          phoneSource: auditPhoneSource,
          latencyMs: Date.now() - startedAt,
        });
        return;
      }

      if (request.method === "runCampaignForPhone") {
        const title = stringValue(request.params.title);
        auditPhoneSource = stringValue(request.params.phoneSource);
        const overlayThread = await readOverlayThreadState();
        const target = resolveOverlayMutationTarget(request, overlayThread);
        if (!target.ok) {
          await resolveOverlayApiRequest(request.id, {
            ok: false,
            error: { code: target.errorCode, message: target.errorMessage },
          });
          await auditOverlayApiRequest({
            request,
            ok: false,
            phone: auditPhone,
            phoneSource: auditPhoneSource,
            latencyMs: Date.now() - startedAt,
            errorCode: target.errorCode,
            errorMessage: target.errorMessage,
          });
          return;
        }
        const { phone, waJid } = target;
        auditPhone = phone;
        auditPhoneSource = target.phoneSource;
        const campaignId = positiveIntegerValue(request.params.campaignId);
        if (!campaignId) {
          await resolveOverlayApiRequest(request.id, {
            ok: false,
            error: { code: "invalid_campaign", message: "Campaign id is required" },
          });
          await auditOverlayApiRequest({
            request,
            ok: false,
            phone: auditPhone,
            phoneSource: auditPhoneSource,
            latencyMs: Date.now() - startedAt,
            errorCode: "invalid_campaign",
            errorMessage: "Campaign id is required",
          });
          return;
        }
        const result = await runOverlayCampaignNow({
          repos: input.repos,
          userId: CONSTANTS.defaultUserId,
          campaignId,
          phone,
          sendPolicy: resolveWorkerOverlaySendPolicy(),
          ownerId: `worker-overlay:${CONSTANTS.defaultUserId}`,
          source: "worker.overlay",
          idempotencyKey: request.mutation?.idempotencyKey ?? null,
        });
        const ok = result.rejected.length === 0 && result.recipientsCreated > 0;
        const snapshot = await buildOverlaySnapshot({
          userId: CONSTANTS.defaultUserId,
          phone: result.phone ?? phone,
          waJid,
          phoneSource: auditPhoneSource,
          title,
          reason: `overlay-api:${request.method}:after`,
        });
        await resolveOverlayApiRequest(request.id, {
          ok,
          data: {
            result,
            snapshot: {
              ...snapshot,
              source: "worker-db",
              apiStatus: ok ? "online" : "error",
              apiLastMethod: request.method,
              apiLastError: ok ? null : (result.rejected[0]?.reason ?? "campaign_blocked"),
              campaignRunStatus: ok ? "done" : "error",
              campaignRunLastResult: result,
              campaignRunLastError: ok ? null : (result.rejected[0]?.reason ?? "campaign_blocked"),
            },
          },
          ...(ok
            ? {}
            : {
                error: {
                  code: result.rejected[0]?.reason ?? "campaign_blocked",
                  message: "Campanha bloqueada pelos guardrails.",
                },
              }),
        });
        await auditOverlayApiRequest({
          request,
          ok,
          phone: auditPhone,
          phoneSource: auditPhoneSource,
          latencyMs: Date.now() - startedAt,
          errorCode: ok ? undefined : (result.rejected[0]?.reason ?? "campaign_blocked"),
          errorMessage: ok ? undefined : "Overlay campaign dispatch blocked",
        });
        return;
      }

      if (request.method === "runAutomationForPhone") {
        const title = stringValue(request.params.title);
        auditPhoneSource = stringValue(request.params.phoneSource);
        const overlayThread = await readOverlayThreadState();
        const target = resolveOverlayMutationTarget(request, overlayThread);
        if (!target.ok) {
          await resolveOverlayApiRequest(request.id, {
            ok: false,
            error: { code: target.errorCode, message: target.errorMessage },
          });
          await auditOverlayApiRequest({
            request,
            ok: false,
            phone: auditPhone,
            phoneSource: auditPhoneSource,
            latencyMs: Date.now() - startedAt,
            errorCode: target.errorCode,
            errorMessage: target.errorMessage,
          });
          return;
        }
        const { phone, waJid } = target;
        auditPhone = phone;
        auditPhoneSource = target.phoneSource;
        const automationId = positiveIntegerValue(request.params.automationId);
        if (!automationId) {
          await resolveOverlayApiRequest(request.id, {
            ok: false,
            error: { code: "invalid_automation", message: "Automation id is required" },
          });
          await auditOverlayApiRequest({
            request,
            ok: false,
            phone: auditPhone,
            phoneSource: auditPhoneSource,
            latencyMs: Date.now() - startedAt,
            errorCode: "invalid_automation",
            errorMessage: "Automation id is required",
          });
          return;
        }
        const conversation = await findOverlayConversation({
          userId: CONSTANTS.defaultUserId,
          phone,
          waJid,
        });
        const result = await runOverlayAutomationNow({
          repos: input.repos,
          userId: CONSTANTS.defaultUserId,
          automationId,
          phone,
          sendPolicy: resolveWorkerOverlaySendPolicy(),
          conversationId: conversation?.id ?? null,
          within24hWindow: isWithin24hWindow(conversation?.lastMessageAt),
          source: "worker.overlay",
          idempotencyKey: request.mutation?.idempotencyKey ?? null,
        });
        const ok = result.eligible && result.rejected.length === 0;
        const snapshot = await buildOverlaySnapshot({
          userId: CONSTANTS.defaultUserId,
          phone: result.phone ?? phone,
          waJid,
          phoneSource: auditPhoneSource,
          title,
          reason: `overlay-api:${request.method}:after`,
        });
        await resolveOverlayApiRequest(request.id, {
          ok,
          data: {
            result,
            snapshot: {
              ...snapshot,
              source: "worker-db",
              apiStatus: ok ? "online" : "error",
              apiLastMethod: request.method,
              apiLastError: ok ? null : (result.rejected[0]?.reason ?? "automation_blocked"),
              automationRunStatus: ok ? "done" : "error",
              automationRunLastResult: result,
              automationRunLastError: ok
                ? null
                : (result.rejected[0]?.reason ?? "automation_blocked"),
            },
          },
          ...(ok
            ? {}
            : {
                error: {
                  code: result.rejected[0]?.reason ?? "automation_blocked",
                  message: "Automacao bloqueada pelos guardrails.",
                },
              }),
        });
        await auditOverlayApiRequest({
          request,
          ok,
          phone: auditPhone,
          phoneSource: auditPhoneSource,
          latencyMs: Date.now() - startedAt,
          errorCode: ok ? undefined : (result.rejected[0]?.reason ?? "automation_blocked"),
          errorMessage: ok ? undefined : "Overlay automation dispatch blocked",
        });
        return;
      }

      metrics.overlayApiErrors += 1;
      await resolveOverlayApiRequest(request.id, {
        ok: false,
        error: {
          code: "unknown_method",
          message: `Unknown Nuoma overlay API method: ${request.method}`,
        },
      });
      await auditOverlayApiRequest({
        request,
        ok: false,
        phone: auditPhone,
        phoneSource: auditPhoneSource,
        latencyMs: Date.now() - startedAt,
        errorCode: "unknown_method",
        errorMessage: `Unknown Nuoma overlay API method: ${request.method}`,
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
      await auditOverlayApiRequest({
        request,
        ok: false,
        phone: auditPhone,
        phoneSource: auditPhoneSource,
        latencyMs: Date.now() - startedAt,
        errorCode: "handler_error",
        errorMessage: serializeError(error),
      });
    }
  }

  async function auditOverlayApiRequest(inputAudit: {
    request: OverlayApiRequest | null;
    ok: boolean;
    phone: string | null;
    phoneSource: string | null;
    latencyMs: number;
    errorCode?: string;
    errorMessage?: string;
  }): Promise<void> {
    try {
      await input.repos.systemEvents.create({
        userId: CONSTANTS.defaultUserId,
        type: "overlay.api.request",
        severity: inputAudit.ok ? "info" : "warn",
        payload: JSON.stringify({
          requestId: inputAudit.request?.id ?? null,
          method: inputAudit.request?.method ?? null,
          version: inputAudit.request?.version ?? null,
          hasMutationGuard: Boolean(inputAudit.request?.mutation),
          idempotencyKey: inputAudit.request?.mutation?.idempotencyKey ?? null,
          mutationNonce: inputAudit.request?.mutation?.nonce ?? null,
          mutationConfirmed: inputAudit.request?.mutation?.confirmed ?? null,
          phone: inputAudit.phone,
          phoneSource: inputAudit.phoneSource,
          ok: inputAudit.ok,
          latencyMs: inputAudit.latencyMs,
          errorCode: inputAudit.errorCode ?? null,
          errorMessage: inputAudit.errorMessage ?? null,
          requestedAt: inputAudit.request?.requestedAt ?? null,
          auditedAtUtc: new Date().toISOString(),
        }),
      });
    } catch (auditError) {
      input.logger.warn({ auditError }, "overlay api audit log failed");
    }
  }

  function validateOverlayApiSecurity(
    request: OverlayApiRequest,
  ): { ok: true } | { ok: false; errorCode: string; errorMessage: string } {
    if (overlayApiReadOnlyMethods.has(request.method)) {
      return { ok: true };
    }
    if (!request.mutation) {
      return {
        ok: false,
        errorCode: "mutation_guard_required",
        errorMessage: "Sensitive overlay API methods require mutation guard metadata",
      };
    }
    if (!request.mutation.confirmed) {
      return {
        ok: false,
        errorCode: "mutation_confirmation_required",
        errorMessage: "Sensitive overlay API methods require explicit confirmation",
      };
    }
    if (!request.mutation.nonce || !request.mutation.idempotencyKey) {
      return {
        ok: false,
        errorCode: "mutation_idempotency_required",
        errorMessage: "Sensitive overlay API methods require nonce and idempotency key",
      };
    }
    return { ok: true };
  }

  function resolveWorkerOverlaySendPolicy(): {
    mode: "test" | "production";
    allowedPhones: string[];
  } {
    const phones = new Set<string>();
    for (const raw of [input.env.WA_SEND_ALLOWED_PHONES, input.env.WA_SEND_ALLOWED_PHONE]) {
      for (const part of String(raw ?? "").split(",")) {
        const phone = normalizePhone(part);
        if (phone) {
          phones.add(phone);
        }
      }
    }
    if (input.env.WA_SEND_POLICY_MODE === "test" && phones.size === 0) {
      phones.add("5531982066263");
    }
    return {
      mode: input.env.WA_SEND_POLICY_MODE,
      allowedPhones: [...phones],
    };
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
      if (getProfilePhotoSeenByThread(profilePhotoSeenByThread, threadKey) === snapshot.sha256) {
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
      setProfilePhotoSeenByThread(profilePhotoSeenByThread, threadKey, sha256);
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
      const waJid = normalizeWaJid(thread.waJid ?? thread.phone);
      const phone = normalizePhone(thread.phone) ?? normalizePhone(waJid);
      const snapshot = await buildOverlaySnapshot({
        userId: CONSTANTS.defaultUserId,
        phone,
        waJid,
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
      return { mounted: false, phone: null, waJid: null, phoneSource: null, title: null };
    }
    const result = await client.Runtime.evaluate({
      expression: `
        (() => {
          if (typeof window.__nuomaOverlayRefresh !== "function") {
              return { mounted: false, phone: null, waJid: null, title: null };
          }
          const state = window.__nuomaOverlayRefresh();
          return {
            mounted: Boolean(state && state.mounted),
            phone: state && typeof state.phone === "string" ? state.phone : null,
            waJid: state && typeof state.waJid === "string" ? state.waJid : null,
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
      return { mounted: false, phone: null, waJid: null, phoneSource: null, title: null };
    }
    return {
      mounted: Boolean((value as { mounted?: unknown }).mounted),
      phone:
        typeof (value as { phone?: unknown }).phone === "string"
          ? (value as { phone: string }).phone || null
          : null,
      waJid:
        typeof (value as { waJid?: unknown }).waJid === "string"
          ? (value as { waJid: string }).waJid || null
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

  function resolveOverlayMutationTarget(
    request: OverlayApiRequest,
    thread: OverlayThreadState,
  ):
    | { ok: true; phone: string | null; waJid: string | null; phoneSource: string | null }
    | { ok: false; errorCode: string; errorMessage: string } {
    if (!thread.mounted) {
      return {
        ok: false,
        errorCode: "overlay_thread_unavailable",
        errorMessage: "Overlay thread is not mounted",
      };
    }
    const requestedWaJid = normalizeWaJid(stringValue(request.params.waJid));
    const requestedPhone =
      normalizePhone(stringValue(request.params.phone)) ?? normalizePhone(requestedWaJid);
    const liveWaJid = normalizeWaJid(thread.waJid ?? thread.phone);
    const livePhone = normalizePhone(thread.phone) ?? normalizePhone(liveWaJid);
    if (requestedPhone && livePhone && requestedPhone !== livePhone) {
      return {
        ok: false,
        errorCode: "overlay_thread_mismatch",
        errorMessage: "Requested phone does not match current overlay thread",
      };
    }
    if (requestedWaJid && liveWaJid && requestedWaJid !== liveWaJid) {
      return {
        ok: false,
        errorCode: "overlay_thread_mismatch",
        errorMessage: "Requested WhatsApp identity does not match current overlay thread",
      };
    }
    const phone = livePhone ?? requestedPhone;
    const waJid = liveWaJid ?? requestedWaJid;
    if (!phone && !waJid) {
      return {
        ok: false,
        errorCode: "invalid_phone",
        errorMessage: "Current overlay thread does not expose a valid phone",
      };
    }
    return {
      ok: true,
      phone,
      waJid,
      phoneSource: thread.phoneSource ?? stringValue(request.params.phoneSource),
    };
  }

  async function findOverlayConversation(inputConversation: {
    userId: number;
    phone: string | null;
    waJid: string | null;
  }) {
    const waJid = normalizeWaJid(inputConversation.waJid ?? inputConversation.phone);
    const phone = normalizePhone(inputConversation.phone) ?? normalizePhone(waJid);
    if (waJid) {
      const conversation = await input.repos.conversations.findByWaJid({
        userId: inputConversation.userId,
        waJid,
      });
      if (conversation) return conversation;
    }
    const conversations = await input.repos.conversations.list(inputConversation.userId, 100);
    return (
      conversations.find((conversation) => {
        if (waJid) {
          const conversationWaJid =
            normalizeWaJid(conversation.waJid) ?? normalizeWaJid(conversation.externalThreadId);
          if (conversationWaJid === waJid) {
            return true;
          }
        }
        return Boolean(phone && normalizePhone(conversation.externalThreadId) === phone);
      }) ?? null
    );
  }

  async function buildOverlaySnapshot(inputSnapshot: {
    userId: number;
    phone: string | null;
    waJid: string | null;
    phoneSource: string | null;
    title: string | null;
    reason: string;
  }) {
    const waJid = normalizeWaJid(inputSnapshot.waJid ?? inputSnapshot.phone);
    let phone = normalizePhone(inputSnapshot.phone) ?? normalizePhone(waJid);
    const title = stringValue(inputSnapshot.title);
    const identityConversation = waJid
      ? await input.repos.conversations.findByWaJid({
          userId: inputSnapshot.userId,
          waJid,
        })
      : null;
    let contact =
      phone || waJid
        ? await input.repos.contacts.findByIdentity({
            userId: inputSnapshot.userId,
            phone,
            waJid,
          })
        : null;
    if (!contact && identityConversation?.contactId) {
      contact = await input.repos.contacts.findById(identityConversation.contactId);
    }
    phone = phone ?? normalizePhone(contact?.phone) ?? normalizePhone(contact?.waJid);
    const phoneSource =
      phone && waJid && (!inputSnapshot.phoneSource || inputSnapshot.phoneSource === "unresolved")
        ? "wa-jid"
        : inputSnapshot.phoneSource;
    const allConversations = await input.repos.conversations.list(inputSnapshot.userId, 100);
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
    const within24hWindow = conversations.some((conversation) =>
      isWithin24hWindow(conversation.lastMessageAt),
    );
    const automations = await listOverlayAutomationOptions({
      repos: input.repos,
      userId: inputSnapshot.userId,
      phone,
      sendPolicy: resolveWorkerOverlaySendPolicy(),
      within24hWindow,
      limit: 5,
    }).catch((error: unknown) => {
      input.logger.warn(
        { error },
        "overlay automation options unavailable; continuing contact summary",
      );
      return [];
    });
    const campaigns = await listOverlayCampaignOptions({
      repos: input.repos,
      userId: inputSnapshot.userId,
      phone,
      sendPolicy: resolveWorkerOverlaySendPolicy(),
      limit: 5,
    }).catch((error: unknown) => {
      input.logger.warn(
        { error },
        "overlay campaign options unavailable; continuing contact summary",
      );
      return [];
    });

    return {
      phone,
      waJid,
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
      automations,
      campaigns,
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
      normalizePhone(conversation?.waJid) ??
      normalizePhone(conversation?.externalThreadId) ??
      null;
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

    if (conversation && !phone) {
      await input.repos.systemEvents.create({
        userId: forceInput.userId,
        type: "sync.force_conversation.missing_identity",
        severity: "warn",
        payload: JSON.stringify({
          conversationId: conversation.id,
          channel: conversation.channel,
          externalThreadId: conversation.externalThreadId,
          waJid: conversation.waJid,
          reason,
        }),
      });
      return {
        mode: "unresolved",
        conversationId: conversation.id,
        phone: null,
        reason,
      };
    }

    if (phone) {
      await navigateWhatsAppPhone(phone, {
        requireComposer: !forceInput.history?.enabled,
      });
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

  async function beginContactSession(
    sessionInput: SyncBeginContactSessionInput,
  ): Promise<SyncBeginContactSessionResult> {
    if (!client) {
      throw new Error("sync engine is not connected");
    }
    const phone = normalizePhone(sessionInput.phone);
    if (!phone) {
      throw new Error("contact session requires a valid WhatsApp phone");
    }
    const reason = sessionInput.reason ?? "send.contact_session";
    const navigationMode = await navigateWhatsAppPhoneForSend({
      phone,
      userId: sessionInput.userId,
      conversationId: sessionInput.conversationId,
    });
    await assertActiveSendTarget({
      expectedPhone: phone,
      operation: "contact_session",
      userId: sessionInput.userId,
      conversationId: sessionInput.conversationId,
      requireLivePhoneEvidence: true,
    });
    return {
      mode: "contact-session",
      conversationId: sessionInput.conversationId,
      phone,
      reason,
      navigationMode,
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
    const navigationMode = await navigateWhatsAppPhoneForSend({
      phone,
      userId: sendInput.userId,
      conversationId: sendInput.conversationId,
    });
    await assertActiveSendTarget({
      expectedPhone: phone,
      operation: "send_message",
      userId: sendInput.userId,
      conversationId: sendInput.conversationId,
      requireLivePhoneEvidence: true,
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
    const sent = await waitForOutgoingTextBubble(
      sendInput.body,
      "send_message",
      input.env.WORKER_SEND_CONFIRMATION_TIMEOUT_MS,
      { requireDeliveredOrSent: input.env.WORKER_SEND_STRICT_DELIVERY },
    );

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

  async function ensureTemporaryMessages(
    ensureInput: SyncEnsureTemporaryMessagesInput,
  ): Promise<SyncEnsureTemporaryMessagesResult> {
    if (!client) {
      throw new Error("sync engine is not connected");
    }
    const phone = normalizePhone(ensureInput.phone);
    if (!phone) {
      throw new Error("temporary_messages requires a valid WhatsApp phone");
    }
    const reason = ensureInput.reason ?? "temporary_messages";
    const navigationMode = await navigateWhatsAppPhoneForTemporaryMessages({
      phone,
      userId: ensureInput.userId,
      conversationId: ensureInput.conversationId,
    });
    await assertActiveSendTarget({
      expectedPhone: phone,
      operation: `temporary_messages:${ensureInput.phase}`,
      userId: ensureInput.userId,
      conversationId: ensureInput.conversationId,
      requireLivePhoneEvidence: true,
    });
    const beforeState = await readActiveSendTargetState();
    const keepPanelOpenForProof =
      (ensureInput.phase === "before_send" || ensureInput.phase === "temporary_messages_set") &&
      Boolean(process.env.M303_BEFORE_SEND_SCREENSHOT_PATH);
    const result = await applyTemporaryMessagesDuration(
      ensureInput.duration,
      keepPanelOpenForProof,
    );
    const afterState = await readActiveSendTargetState();
    if (result.verifiedDuration !== ensureInput.duration) {
      throw new Error(
        `temporary_messages verification failed: requested=${ensureInput.duration} verified=${result.verifiedDuration ?? "none"} menuDetected=${String(result.menuDetected)} reason=${result.reason ?? "unknown"}`,
      );
    }
    const visualProof =
      ensureInput.phase === "before_send" || ensureInput.phase === "temporary_messages_set"
        ? await captureTemporaryMessagesVisualProof(ensureInput.duration)
        : null;
    return {
      mode: "temporary-messages",
      conversationId: ensureInput.conversationId,
      phone,
      requestedDuration: ensureInput.duration,
      verifiedDuration: result.verifiedDuration,
      phase: ensureInput.phase,
      reason,
      navigationMode,
      changed: result.changed,
      menuDetected: result.menuDetected,
      targetEvidence: {
        ...afterState,
        href: afterState.href || beforeState.href,
        title: afterState.title || beforeState.title,
      },
      ...(visualProof ? { visualProof } : {}),
    };
  }

  async function captureTemporaryMessagesVisualProof(
    duration: SyncTemporaryMessagesDuration,
  ): Promise<SyncEnsureTemporaryMessagesResult["visualProof"] | null> {
    if (!client || !process.env.M303_BEFORE_SEND_SCREENSHOT_PATH) {
      return null;
    }
    const currentClient = client;
    const proofPath = path.isAbsolute(process.env.M303_BEFORE_SEND_SCREENSHOT_PATH)
      ? process.env.M303_BEFORE_SEND_SCREENSHOT_PATH
      : path.resolve(process.cwd(), process.env.M303_BEFORE_SEND_SCREENSHOT_PATH);
    const proof = await currentClient.Runtime.evaluate({
      expression: temporaryMessagesProofScript(duration),
      awaitPromise: true,
      returnByValue: true,
      includeCommandLineAPI: false,
    });
    const value = proof.result.value;
    if (!isRecord(value)) {
      throw new Error(
        `temporary_messages visual proof returned invalid result: ${JSON.stringify(value ?? null)}`,
      );
    }
    const verifiedDuration = parseTemporaryMessagesDuration(value.verifiedDuration);
    if (verifiedDuration !== duration) {
      throw new Error(
        `temporary_messages visual proof failed: requested=${duration} verified=${verifiedDuration ?? "none"} text=${String(value.textEvidence ?? "").slice(0, 160)}`,
      );
    }
    await fs.mkdir(path.dirname(proofPath), { recursive: true });
    const shouldCaptureCdpScreenshot = process.env.M303_CAPTURE_CDP_SCREENSHOT === "true";
    const screenshotData = shouldCaptureCdpScreenshot
      ? await Promise.race([
          currentClient.Page.enable().then(() =>
            currentClient.Page.captureScreenshot({ format: "png", fromSurface: true }),
          ),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 5_000)),
        ]).catch(() => null)
      : null;
    if (screenshotData?.data) {
      await fs.writeFile(proofPath, Buffer.from(screenshotData.data, "base64"));
    } else {
      await fs.writeFile(
        proofPath,
        temporaryMessagesProofSvg({
          requestedDuration: duration,
          verifiedDuration,
          textEvidence: String(value.textEvidence ?? ""),
        }),
        "utf8",
      );
    }
    await client.Runtime.evaluate({
      expression: `
        (async () => {
          const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
          const clean = (value) => String(value || "").normalize("NFD")
            .replace(/[\\u0300-\\u036f]/g, "")
            .replace(/\\s+/g, " ")
            .trim()
            .toLowerCase();
          const isVisible = (node) => {
            if (!(node instanceof HTMLElement)) return false;
            const rect = node.getBoundingClientRect();
            const style = window.getComputedStyle(node);
            return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
          };
          for (let attempt = 0; attempt < 2; attempt += 1) {
            const back = Array.from(document.querySelectorAll("button, [role='button'], span[data-icon='back']"))
              .find((node) => {
                const text = clean(node.getAttribute("aria-label") || node.getAttribute("title") || node.textContent || node.getAttribute("data-icon") || "");
                return isVisible(node) && (text.includes("voltar") || text.includes("back"));
              });
            const target = back && (back.closest("button") || back.closest("[role='button']") || back);
            if (!(target instanceof HTMLElement)) break;
            target.click();
            await sleep(350);
          }
        })()
      `,
      awaitPromise: true,
      returnByValue: true,
      includeCommandLineAPI: false,
    }).catch(() => null);
    return {
      screenshotPath: proofPath,
      verifiedDuration,
      textEvidence: String(value.textEvidence ?? "").slice(0, 2000),
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
    const voiceMimeType = audioMimeTypeForPath(voiceInput.audioPath);
    if (voiceMimeType !== "audio/ogg; codecs=opus") {
      throw new Error(`send_voice requires OGG/Opus PTT audio, got ${voiceMimeType}`);
    }
    const audioBase64 = (await fs.readFile(voiceInput.audioPath)).toString("base64");
    const initScript = voiceRecorderInitScript(audioBase64);
    const script = await client.Page.addScriptToEvaluateOnNewDocument({ source: initScript });
    const navigationMode = await navigateWhatsAppPhoneForVoice({
      phone,
      userId: voiceInput.userId,
      conversationId: voiceInput.conversationId,
    });
    try {
      await assertActiveSendTarget({
        expectedPhone: phone,
        operation: "send_voice",
        userId: voiceInput.userId,
        conversationId: voiceInput.conversationId,
        requireLivePhoneEvidence: true,
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
      const recordingMs = Math.round(voiceInput.durationSecs * 1000) + 250;
      let injectionConsumed = false;
      let fallbackReason: string | null = null;
      let deliveryStatus: SyncSendVoiceMessageResult["deliveryStatus"] = "unknown";
      await clickVoiceRecordButton();
      try {
        injectionConsumed = await waitForVoiceInjectionConsumed();
      } catch (error) {
        fallbackReason = "native_recorder_injection_not_consumed";
        input.logger.warn(
          { error },
          "send_voice native recorder injection did not consume payload",
        );
        throw new Error(
          `send_voice requires native WhatsApp PTT recording; internal media fallback blocked (${fallbackReason})`,
        );
      }
      await sleep(recordingMs);
      await clickSendButton();
      deliveryStatus = await pollLastOutgoingDeliveryStatus(30_000);
      await sleep(1_000);

      const after = await requestActiveReconcile(`${reason}:after-send`, {
        scope: "send-voice",
        conversationId: voiceInput.conversationId,
        candidatePhone: phone,
        navigationMode,
      });
      await bindingQueue;
      const bubble = await waitForVoiceBubbleByExternalId(
        after?.lastExternalId ?? null,
        10_000,
      ).catch(() => ({
        nativeVoiceEvidence: false,
        displayDurationSecs: null,
      }));
      const externalId = sentExternalId(before, after);
      const visibleMessageCountBefore = before?.visibleMessageCount ?? 0;
      const visibleMessageCountAfter = after?.visibleMessageCount ?? 0;
      if (
        !bubble.nativeVoiceEvidence ||
        bubble.displayDurationSecs === null ||
        (!externalId && input.env.WORKER_SEND_STRICT_DELIVERY)
      ) {
        throw new Error(
          `send_voice did not produce a verified WhatsApp voice bubble: externalId=${externalId ?? "null"} nativeVoiceEvidence=${String(
            bubble.nativeVoiceEvidence,
          )} displayDurationSecs=${String(bubble.displayDurationSecs)} visibleBefore=${visibleMessageCountBefore} visibleAfter=${visibleMessageCountAfter}`,
        );
      }

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
        voiceSendMode: "native-ptt",
        fallbackReason,
        internalFallbackChatId: null,
        displayDurationSecs: bubble.displayDurationSecs ?? voiceInput.durationSecs,
        externalId,
        visibleMessageCountBefore,
        visibleMessageCountAfter,
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
    const navigationMode = await navigateWhatsAppPhoneForDocument({
      phone,
      userId: documentInput.userId,
      conversationId: documentInput.conversationId,
    });
    await assertActiveSendTarget({
      expectedPhone: phone,
      operation: "send_document",
      userId: documentInput.userId,
      conversationId: documentInput.conversationId,
      requireLivePhoneEvidence: true,
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
      timeoutMs: input.env.WORKER_SEND_CONFIRMATION_TIMEOUT_MS,
      preferExternalId: false,
    });
    const externalId = sentExternalId(before, after);
    if (input.env.WORKER_SEND_STRICT_DELIVERY) {
      await waitForOutgoingBubbleDelivery(
        externalId,
        "send_document",
        input.env.WORKER_SEND_CONFIRMATION_TIMEOUT_MS,
      );
    }
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
    const navigationMode = await navigateWhatsAppPhoneForDocument({
      phone,
      userId: mediaInput.userId,
      conversationId: mediaInput.conversationId,
    });
    await assertActiveSendTarget({
      expectedPhone: phone,
      operation: `send_media ${mediaInput.mediaType}`,
      userId: mediaInput.userId,
      conversationId: mediaInput.conversationId,
      requireLivePhoneEvidence: true,
    });
    const before = await requestActiveReconcile(`${reason}:before-send`, {
      scope: "send-media",
      conversationId: mediaInput.conversationId,
      candidatePhone: phone,
      navigationMode,
    });
    await bindingQueue;

    const caption = mediaInput.caption?.trim() ?? "";
    let captionSent = false;
    let captionVisible = true;
    let previewClosed = true;
    let sentByInternalFallback = false;
    let previewAttachmentCount = 0;
    const expectedMediaCount = mediaFiles.length;
    const allowInternalFallback = true;
    const sendInternalFallback = async () => {
      if (!allowInternalFallback) {
        throw new Error(
          `send_media ${mediaInput.mediaType} internal fallback disabled for ${expectedMediaCount} files`,
        );
      }
      if (mediaFiles.length === 0) {
        throw new Error(
          `send_media ${mediaInput.mediaType} internal fallback requires at least one media file`,
        );
      }
      let fallback: { chatId: string | null } = { chatId: null };
      for (const [index, fallbackFile] of mediaFiles.entries()) {
        fallback = await withTimeout(
          sendMediaViaWhatsAppInternal({
            file: fallbackFile,
            caption: index === 0 ? caption : "",
            mediaType: mediaInput.mediaType,
          }),
          90_000,
          `send_media ${mediaInput.mediaType} internal fallback timed out`,
        );
        if (index < mediaFiles.length - 1) {
          await sleep(750);
        }
      }
      sentByInternalFallback = true;
      previewAttachmentCount = mediaFiles.length;
      await clearDocumentPreviewAttachments().catch((error: unknown) => {
        input.logger.debug({ error }, "send_media preview cleanup after internal fallback failed");
      });
      previewClosed = await waitForAttachmentPreviewClosed(5_000);
      return fallback;
    };

    if (allowInternalFallback) {
      try {
        const fallback = await sendInternalFallback();
        input.logger.info(
          {
            mediaType: mediaInput.mediaType,
            mediaCount: expectedMediaCount,
            chatId: fallback.chatId,
          },
          "send_media sent via WhatsApp internal media API before visual attachment flow",
        );
      } catch (error) {
        input.logger.warn(
          { error, mediaType: mediaInput.mediaType },
          "send_media internal media API failed before visual attachment flow; falling back to WhatsApp UI attachment",
        );
      }
    } else {
      input.logger.info(
        { mediaType: mediaInput.mediaType, mediaCount: expectedMediaCount },
        "send_media internal media API skipped for multi-file media",
      );
    }

    if (!sentByInternalFallback) {
      input.logger.info(
        { mediaType: mediaInput.mediaType, mediaCount: mediaFiles.length },
        "send_media stage clear-preview",
      );
      await withTimeout(
        clearDocumentPreviewAttachments(),
        10_000,
        `send_media ${mediaInput.mediaType} clear preview timed out`,
      );
      input.logger.info(
        { mediaType: mediaInput.mediaType, mediaCount: mediaFiles.length },
        "send_media stage attach-files",
      );
      await withTimeout(
        attachMediaFiles(
          mediaFiles.map((file) => file.filePath),
          mediaInput.mediaType,
        ),
        20_000,
        `send_media ${mediaInput.mediaType} attach files timed out`,
      );
      input.logger.info({ mediaType: mediaInput.mediaType }, "send_media stage wait-preview");
      try {
        const preview = await withTimeout(
          waitForMediaPreview(mediaInput.mediaType, 15_000, expectedMediaCount),
          18_000,
          `send_media ${mediaInput.mediaType} preview wait timed out`,
        );
        previewAttachmentCount = preview.attachmentCount;
      } catch (error) {
        if (!allowInternalFallback) {
          throw error;
        }
        const fallback = await sendInternalFallback();
        input.logger.warn(
          { error, mediaType: mediaInput.mediaType, chatId: fallback.chatId },
          "send_media attachment preview did not open; sent via WhatsApp internal media API",
        );
      }
      if (!sentByInternalFallback) {
        if (caption) {
          input.logger.info({ mediaType: mediaInput.mediaType }, "send_media stage caption");
          captionSent = await withTimeout(
            tryInsertAttachmentCaption(caption),
            10_000,
            `send_media ${mediaInput.mediaType} caption timed out`,
          );
        }
        input.logger.info({ mediaType: mediaInput.mediaType }, "send_media stage dismiss-dialog");
        await withTimeout(
          dismissStartingConversationDialog(),
          8_000,
          `send_media ${mediaInput.mediaType} dismiss dialog timed out`,
        );
        input.logger.info({ mediaType: mediaInput.mediaType }, "send_media stage click-send");
        await withTimeout(
          clickSendButton(),
          10_000,
          `send_media ${mediaInput.mediaType} click send timed out`,
        );
        input.logger.info({ mediaType: mediaInput.mediaType }, "send_media stage wait-outgoing");
        captionVisible = caption
          ? await withTimeout(
              waitForVisiblePageText(caption, input.env.WORKER_SEND_CONFIRMATION_TIMEOUT_MS),
              input.env.WORKER_SEND_CONFIRMATION_TIMEOUT_MS + 5_000,
              `send_media ${mediaInput.mediaType} outgoing caption visibility timed out`,
            )
          : true;
        previewClosed = await waitForAttachmentPreviewClosed(10_000);
        if (!previewClosed && (await hasStartingConversationDialog())) {
          input.logger.info(
            { mediaType: mediaInput.mediaType },
            "send_media starting conversation dialog blocked first click; retrying send",
          );
          await dismissStartingConversationDialog();
          await withTimeout(
            clickSendButton(),
            10_000,
            `send_media ${mediaInput.mediaType} retry click send timed out`,
          );
          previewClosed = await waitForAttachmentPreviewClosed(30_000);
        }
        if (!previewClosed) {
          if (!allowInternalFallback) {
            throw new Error(
              `send_media ${mediaInput.mediaType} preview remained open after send click`,
            );
          }
          const fallback = await sendInternalFallback();
          input.logger.warn(
            { mediaType: mediaInput.mediaType, chatId: fallback.chatId },
            "send_media visual send button did not close preview; sent via WhatsApp internal media API",
          );
        }
      }
    }
    input.logger.info(
      { mediaType: mediaInput.mediaType, captionVisible, previewClosed, sentByInternalFallback },
      "send_media stage reconcile-after",
    );
    const after = await withTimeout(
      requestActiveReconcile(`${reason}:after-send`, {
        scope: "send-media",
        conversationId: mediaInput.conversationId,
        candidatePhone: phone,
        navigationMode,
      }),
      20_000,
      `send_media ${mediaInput.mediaType} after reconcile timed out`,
    );
    await bindingQueue;
    const externalId = sentExternalId(before, after);
    if (caption && !captionVisible && input.env.WORKER_SEND_STRICT_DELIVERY) {
      throw new Error(`send_media ${mediaInput.mediaType} caption was not visible after send`);
    }
    if (!previewClosed && !externalId && !sentByInternalFallback) {
      throw new Error(`send_media ${mediaInput.mediaType} preview remained open after send click`);
    }
    if (externalId) {
      if (input.env.WORKER_SEND_STRICT_DELIVERY) {
        await waitForOutgoingBubbleDelivery(
          externalId,
          `send_media ${mediaInput.mediaType}`,
          input.env.WORKER_SEND_CONFIRMATION_TIMEOUT_MS,
        );
      }
    } else {
      input.logger.warn(
        { mediaType: mediaInput.mediaType },
        "send_media completed by preview/text evidence without isolated external id",
      );
    }

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
      previewAttachmentCount,
      sentByInternalFallback,
      captionSent,
      visibleMessageCountBefore: before?.visibleMessageCount ?? 0,
      visibleMessageCountAfter: after?.visibleMessageCount ?? before?.visibleMessageCount ?? 0,
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

  async function withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    message: string,
  ): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
        }),
      ]);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  async function waitForVisiblePageText(text: string, timeoutMs: number): Promise<boolean> {
    if (!client) {
      throw new Error("sync engine is not connected");
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const result = await client.Runtime.evaluate({
        expression: `
          (() => String(document.body?.innerText || "").includes(${JSON.stringify(text)}))()
        `,
        awaitPromise: false,
        returnByValue: true,
        includeCommandLineAPI: false,
      });
      if (result.result.value === true) {
        return true;
      }
      await sleep(750);
    }
    return false;
  }

  async function waitForAttachmentPreviewClosed(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const preview = await getAttachmentPreviewState();
      if (!preview.open) {
        return true;
      }
      await sleep(750);
    }
    return false;
  }

  async function applyTemporaryMessagesDuration(
    duration: SyncTemporaryMessagesDuration,
    keepPanelOpen = false,
  ): Promise<{
    changed: boolean;
    menuDetected: boolean;
    verifiedDuration: SyncTemporaryMessagesDuration | null;
    reason: string | null;
  }> {
    if (!client) {
      throw new Error("sync engine is not connected");
    }
    const result = await client.Runtime.evaluate({
      expression: temporaryMessagesUiScript(duration, keepPanelOpen),
      awaitPromise: true,
      returnByValue: true,
      includeCommandLineAPI: false,
    });
    const value = result.result.value;
    if (!isRecord(value)) {
      throw new Error(
        `temporary_messages returned invalid result: ${JSON.stringify(value ?? null)}`,
      );
    }
    return {
      changed: value.changed === true,
      menuDetected: value.menuDetected === true,
      verifiedDuration: parseTemporaryMessagesDuration(value.verifiedDuration),
      reason: typeof value.reason === "string" ? value.reason : null,
    };
  }

  async function sendMediaViaWhatsAppInternal(inputMedia: {
    file: {
      filePath: string;
      fileName: string;
      mimeType: string;
    };
    caption: string;
    mediaType: "image" | "video" | "audio";
    isPtt?: boolean;
    isAudio?: boolean;
  }): Promise<{ chatId: string | null }> {
    if (!client) {
      throw new Error("sync engine is not connected");
    }
    const base64 = (await fs.readFile(inputMedia.file.filePath)).toString("base64");
    let lastValue: unknown = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const result = await client.Runtime.evaluate({
        expression: `
          (async () => {
            const Store = window.require("WAWebCollections");
            const Opaque = window.require("WAWebMediaOpaqueData");
            const PrepRaw = window.require("WAWebPrepRawMedia");
            const MediaPrep = window.require("WAWebMediaPrep");
            const chats = Store.Chat._models || Store.Chat.models || [];
            const chat = chats.find((item) => item.active) || null;
            if (!chat) {
              return { ok: false, reason: "active-chat-not-found" };
            }
            const raw = atob(${JSON.stringify(base64)});
            const bytes = new Uint8Array(raw.length);
            for (let index = 0; index < raw.length; index += 1) {
              bytes[index] = raw.charCodeAt(index);
            }
            const mimeType = ${JSON.stringify(inputMedia.file.mimeType)};
            const caption = ${JSON.stringify(inputMedia.caption)};
            const options = {
              filename: ${JSON.stringify(inputMedia.file.fileName)},
              mimetype: mimeType,
              ...(caption ? { caption } : {}),
              ...(${JSON.stringify(inputMedia.isPtt === true)} ? { isPtt: true } : {}),
              ...(${JSON.stringify(inputMedia.isAudio === true)} ? { isAudio: true } : {})
            };
            const blob = new Blob([bytes], { type: mimeType });
            const opaque = await Opaque.createFromData(blob, mimeType);
            const prep = PrepRaw.prepRawMedia(opaque, options);
            await Promise.race([
              prep.waitForPrep(),
              new Promise((resolve) => setTimeout(resolve, 15_000))
            ]);
            const sendResult = MediaPrep.sendMediaMsgToChat({
              chat,
              prep,
              options: {
                ...(caption ? { caption } : {}),
                ...(${JSON.stringify(inputMedia.isPtt === true)} ? { isPtt: true } : {}),
                ...(${JSON.stringify(inputMedia.isAudio === true)} ? { isAudio: true } : {})
              }
            });
            await Promise.race([
              sendResult,
              new Promise((resolve) => setTimeout(resolve, 15_000))
            ]);
            return {
              ok: true,
              chatId: chat.id?._serialized || String(chat.id || "")
            };
          })()
        `,
        awaitPromise: true,
        returnByValue: true,
        includeCommandLineAPI: false,
      });
      const value = result.result.value;
      if (isRecord(value) && value.ok === true) {
        return {
          chatId: typeof value.chatId === "string" && value.chatId ? value.chatId : null,
        };
      }
      lastValue = value;
      const serializedValue = JSON.stringify(value ?? null);
      if (!serializedValue.includes("InvalidMediaCheckRepairFailedType") || attempt === 3) {
        break;
      }
      await sleep(2_500 * attempt);
    }
    throw new Error(
      `send_media ${inputMedia.mediaType} internal fallback failed: ${JSON.stringify(lastValue ?? null)}`,
    );
  }

  function audioMimeTypeForPath(filePath: string): string {
    const extension = path.extname(filePath).toLowerCase();
    if (extension === ".mp3") {
      return "audio/mpeg";
    }
    if (extension === ".ogg" || extension === ".opus") {
      return "audio/ogg; codecs=opus";
    }
    if (extension === ".m4a") {
      return "audio/mp4";
    }
    return "audio/wav";
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
    options: { requireDeliveredOrSent: boolean } = { requireDeliveredOrSent: true },
  ): Promise<{ externalId: string | null }> {
    const deadline = Date.now() + timeoutMs;
    let last: OutgoingBubbleStatus | null = null;
    while (Date.now() < deadline) {
      last = await inspectOutgoingTextBubble(body);
      if (last?.hasError) {
        throw new Error(`${errorPrefix} outgoing text bubble failed in WhatsApp`);
      }
      if (
        last?.hasExpectedText &&
        last.externalId &&
        (!options.requireDeliveredOrSent || isDeliveredOrSent(last.deliveryStatus))
      ) {
        return { externalId: last.externalId };
      }
      if (
        last?.hasExpectedText &&
        !options.requireDeliveredOrSent &&
        (last.deliveryStatus === "pending" || last.deliveryStatus === "unknown")
      ) {
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
    const expectedTexts = textProofCandidates(body);
    return inspectOutgoingBubble(
      `
      (() => {
        const expectedTexts = ${JSON.stringify(expectedTexts)};
        const messages = Array.from(document.querySelectorAll(".message-out")).reverse();
        return messages.find((message) => {
          const text = String(message.textContent || "").replace(/\\s+/g, " ").trim();
          return expectedTexts.some((expectedText) => text.includes(expectedText));
        }) || null;
      })()
    `,
      expectedTexts,
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
    expectedText: string[] | null,
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
          const normalizedText = text.replace(/\\s+/g, " ").trim();
          const expectedTexts = ${JSON.stringify(expectedText ?? [])};
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
            hasExpectedText: ${expectedText === null ? "true" : "expectedTexts.some((expectedText) => normalizedText.includes(expectedText))"}
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

  function textProofCandidates(body: string): string[] {
    const withoutEmoji = body
      .replace(/[\u{1f000}-\u{1faff}\u{2600}-\u{27bf}]/gu, "")
      .replace(/\ufe0f/gu, "")
      .replace(/\s+/g, " ")
      .trim();
    return [...new Set([body.replace(/\s+/g, " ").trim(), withoutEmoji].filter(Boolean))];
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
    expectedCount = 1,
  ): Promise<{ attachmentCount: number }> {
    if (!client) {
      return { attachmentCount: 0 };
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const result = await client.Runtime.evaluate({
        expression: `
          ((expectedCount) => {
            const body = String(document.body?.innerText || "");
            const incompatible = /arquivo que você tentou adicionar não é compatível|file you tried to add is not supported/i.test(body);
            const sendLabels = Array.from(document.querySelectorAll("[role='button'][aria-label], button[aria-label], div[aria-label]"))
              .map((item) => {
                const label = String(item.getAttribute("aria-label") || "");
                const target = item.closest("button") || item.closest("[role='button']") || item;
                const rect = target.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0 ? label : "";
              })
              .filter(Boolean);
            const sendVisible = sendLabels.some((label) =>
              /(send|enviar).*(selected|selecionad)|\\d+\\s+(selected|selecionad)/i.test(label)
            );
            const selectedCounts = sendLabels
              .map((label) => {
                const match = label.match(/(\\d+)\\s+(?:selected|selecionad)/i);
                return match ? Number(match[1]) : 0;
              })
              .filter((count) => Number.isFinite(count) && count > 0);
            const selectedCount = selectedCounts.length ? Math.max(...selectedCounts) : 0;
            const removeVisible = Boolean(Array.from(document.querySelectorAll("[aria-label='Remover anexo'], [aria-label='Remove attachment']"))
              .find((item) => {
                const target = item.closest("button") || item.closest("[role='button']") || item;
                const rect = target.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
              }));
            const thumbnailCount = Array.from(document.querySelectorAll("[role='tab'][aria-label*='Miniatura'], [role='tab'][aria-label*='Thumbnail'], [role='tab'][aria-label*='thumbnail']"))
              .filter((item) => {
                const rect = item.getBoundingClientRect();
                return rect.width > 24 && rect.height > 24;
              }).length;
            const attachmentCount = Math.max(selectedCount, thumbnailCount, removeVisible ? 1 : 0);
            const previewVisible = removeVisible || thumbnailCount > 0;
            const countSatisfied = expectedCount <= 1 || attachmentCount >= expectedCount;
            return { sendVisible, previewVisible, incompatible, attachmentCount, countSatisfied };
          })(${JSON.stringify(expectedCount)})
        `,
        awaitPromise: false,
        returnByValue: true,
        includeCommandLineAPI: false,
      });
      const value = result.result.value;
      if (isRecord(value) && value.incompatible === true) {
        throw new Error(`send_media ${mediaType} file is not supported by WhatsApp preview`);
      }
      if (
        isRecord(value) &&
        value.sendVisible === true &&
        value.previewVisible === true &&
        value.countSatisfied === true
      ) {
        return {
          attachmentCount:
            typeof value.attachmentCount === "number" && Number.isFinite(value.attachmentCount)
              ? value.attachmentCount
              : 1,
        };
      }
      await sleep(250);
    }
    throw new Error(
      `send_media ${mediaType} preview did not open with ${expectedCount} attachment(s)`,
    );
  }

  async function getAttachmentPreviewState(): Promise<{ open: boolean }> {
    if (!client) {
      return { open: false };
    }
    const result = await client.Runtime.evaluate({
      expression: `
          (() => ({
          open: Boolean(document.querySelector("[aria-label='Remover anexo'], [aria-label='Remove attachment'], [aria-label^='Miniatura de documento'], [aria-label^='Document thumbnail'], [role='tab'][aria-label*='Miniatura'], [role='tab'][aria-label*='Thumbnail'], [role='tab'][aria-label*='thumbnail']"))
        }))()
      `,
      awaitPromise: false,
      returnByValue: true,
      includeCommandLineAPI: false,
    });
    const value = result.result.value;
    return { open: isRecord(value) && value.open === true };
  }

  async function hasStartingConversationDialog(): Promise<boolean> {
    if (!client) {
      return false;
    }
    const result = await client.Runtime.evaluate({
      expression: `
        (() => Boolean(Array.from(document.querySelectorAll("[role='dialog']"))
          .find((item) => /iniciando conversa|starting chat/i.test(String(item.textContent || "")))))()
      `,
      awaitPromise: false,
      returnByValue: true,
      includeCommandLineAPI: false,
    });
    return result.result.value === true;
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
            if (cancel instanceof HTMLElement && ${JSON.stringify(attempt)} === 0) {
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

  async function dismissInvalidPhoneDialog(): Promise<string | null> {
    if (!client) {
      return null;
    }
    const result = await client.Runtime.evaluate({
      expression: `
        (() => {
          const textOf = (node) => String(node?.textContent || "").replace(/\\s+/g, " ").trim();
          const dialogs = Array.from(document.querySelectorAll("[role='dialog']"));
          const dialog = dialogs.find((item) => /n[uú]mero .*n[aã]o est[aá] no whatsapp|phone number .*isn.?t on whatsapp|not on whatsapp/i.test(textOf(item)));
          if (!dialog) {
            return { found: false, text: null, dismissed: false };
          }
          const text = textOf(dialog);
          const button = Array.from(dialog.querySelectorAll("button, [role='button']"))
            .find((item) => /^(ok|entendi|got it)$/i.test(textOf(item) || String(item.getAttribute("aria-label") || "")));
          if (button instanceof HTMLElement) {
            button.click();
            return { found: true, text, dismissed: true };
          }
          if (dialog instanceof HTMLElement) {
            dialog.remove();
            return { found: true, text, dismissed: true };
          }
          return { found: true, text, dismissed: false };
        })()
      `,
      awaitPromise: false,
      returnByValue: true,
      includeCommandLineAPI: false,
    });
    const value = isRecord(result.result.value) ? result.result.value : {};
    if (value.found !== true) {
      return null;
    }
    if (value.dismissed === true) {
      await sleep(500);
    }
    return typeof value.text === "string" ? value.text : "invalid WhatsApp phone";
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
          const allNodes = Array.from(document.querySelectorAll(
            "button[aria-label^='Enviar'], button[aria-label^='Send'], div[aria-label^='Enviar'], div[aria-label^='Send'], [role='button'][aria-label^='Enviar'], [role='button'][aria-label^='Send'], span[data-icon*='send'], span[data-icon*='end-filled']"
          ));
          const selectedNodes = allNodes.filter((item) => {
            const target = item.closest("button") || item.closest("[role='button']") || item.closest("div[aria-label]") || item;
            const label = String(item.getAttribute("aria-label") || target.getAttribute("aria-label") || "");
            const rect = target.getBoundingClientRect();
            return /(send|enviar).*(selected|selecionad)/i.test(label) &&
              rect.width > 0 &&
              rect.height > 0;
          });
          const candidates = (selectedNodes.length ? selectedNodes : allNodes).map((item) => {
            const target = item.closest("button") || item.closest("[role='button']") || item.closest("div[aria-label]") || item;
            const rect = target.getBoundingClientRect();
            const label = String(item.getAttribute("aria-label") || target.getAttribute("aria-label") || "");
            return {
              item,
              target,
              label,
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2,
              visible: rect.width > 0 && rect.height > 0,
            };
          }).filter((item) => item.visible);
          const candidate = candidates.sort((a, b) => b.x - a.x || b.y - a.y)[0] || null;
          const clickable = candidate?.target || null;
          if (clickable) {
            const rect = clickable.getBoundingClientRect();
            return {
              ok: true,
              mode: selectedNodes.length ? "selected-attachment" : "coordinates",
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2,
              label: candidate.label
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
        input.logger.info(
          { mode: value.mode, label: value.label, x: value.x, y: value.y },
          "send button candidate",
        );
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
          buttons: 1,
          clickCount: 1,
        });
        await client.Input.dispatchMouseEvent({
          type: "mouseReleased",
          x: value.x,
          y: value.y,
          button: "left",
          buttons: 0,
          clickCount: 1,
        });
        if (value.mode === "selected-attachment") {
          await sleep(1_500);
          return;
        }
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
      (() => Boolean(window.__nuomaVoiceAudioBase64))()
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

  async function navigateWhatsAppPhone(
    phone: string,
    options?: { requireComposer?: boolean },
  ): Promise<void> {
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
      { requireComposer: options?.requireComposer ?? true },
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
    openChatPhoneNavigatedAtMs = Date.now();
  }

  async function navigateWhatsAppPhoneForSend(inputSend: {
    phone: string;
    userId: number;
    conversationId: number;
  }): Promise<SyncSendTextMessageResult["navigationMode"]> {
    const normalized = normalizePhone(inputSend.phone);
    if (!normalized) {
      throw new Error("send_message requires a valid WhatsApp phone");
    }
    if (await canReuseOpenChat(inputSend.userId, inputSend.conversationId, normalized)) {
      return "reused-open-chat";
    }
    await navigateWhatsAppPhone(normalized);
    return "navigated";
  }

  async function navigateWhatsAppPhoneForVoice(inputVoice: {
    phone: string;
    userId: number;
    conversationId: number;
  }): Promise<SyncSendVoiceMessageResult["navigationMode"]> {
    const normalized = normalizePhone(inputVoice.phone);
    if (!normalized) {
      throw new Error("send_voice requires a valid WhatsApp phone");
    }
    if (await canReuseOpenChat(inputVoice.userId, inputVoice.conversationId, normalized)) {
      return "reused-open-chat";
    }
    await navigateWhatsAppPhone(normalized);
    return "navigated";
  }

  async function navigateWhatsAppPhoneForDocument(inputDocument: {
    phone: string;
    userId: number;
    conversationId: number;
  }): Promise<SyncSendDocumentMessageResult["navigationMode"]> {
    const normalized = normalizePhone(inputDocument.phone);
    if (!normalized) {
      throw new Error("send_document requires a valid WhatsApp phone");
    }
    if (await canReuseOpenChat(inputDocument.userId, inputDocument.conversationId, normalized)) {
      return "reused-open-chat";
    }
    await navigateWhatsAppPhone(normalized);
    return "navigated";
  }

  async function navigateWhatsAppPhoneForTemporaryMessages(inputTemporary: {
    phone: string;
    userId: number;
    conversationId: number;
  }): Promise<SyncEnsureTemporaryMessagesResult["navigationMode"]> {
    const normalized = normalizePhone(inputTemporary.phone);
    if (!normalized) {
      throw new Error("temporary_messages requires a valid WhatsApp phone");
    }
    if (await canReuseOpenChat(inputTemporary.userId, inputTemporary.conversationId, normalized)) {
      return "reused-open-chat";
    }
    await navigateWhatsAppPhone(normalized);
    return "navigated";
  }

  async function canReuseOpenChat(
    userId: number,
    conversationId: number,
    normalizedPhone: string,
  ): Promise<boolean> {
    if (!input.env.WORKER_SEND_REUSE_OPEN_CHAT_ENABLED) {
      return false;
    }
    if (!(await isWhatsAppChatReady())) {
      return false;
    }
    const state = await readActiveSendTargetState();
    const canReuse = shouldAllowActiveSendTarget({
      expectedPhone: normalizedPhone,
      state,
      openChatPhone,
      openChatPhoneNavigatedAtMs,
      nowMs: Date.now(),
    });
    if (!canReuse) {
      openChatPhone = null;
      openChatPhoneNavigatedAtMs = 0;
      return false;
    }
    openChatPhone = normalizedPhone;
    return state.hasComposer;
  }

  async function assertActiveSendTarget(assertInput: {
    expectedPhone: string;
    operation: string;
    userId: number;
    conversationId: number;
    requireLivePhoneEvidence?: boolean;
  }): Promise<void> {
    if (!client) {
      throw new Error(`${assertInput.operation} blocked: sync engine is not connected`);
    }
    const deadline = Date.now() + 25_000;
    let state = await readActiveSendTargetState();
    let contactInfoChecked = false;
    while (Date.now() < deadline) {
      if (
        shouldAllowActiveSendTarget({
          expectedPhone: assertInput.expectedPhone,
          state,
          openChatPhone,
          openChatPhoneNavigatedAtMs,
          nowMs: Date.now(),
          requireLivePhoneEvidence: assertInput.requireLivePhoneEvidence,
        })
      ) {
        return;
      }
      if ((assertInput.requireLivePhoneEvidence ?? true) && !contactInfoChecked) {
        contactInfoChecked = true;
        const contactInfoPhone = await readContactInfoPhoneEvidence(assertInput.expectedPhone);
        if (contactInfoPhone) {
          state = { ...state, contactInfoPhone };
          continue;
        }
      }
      await sleep(300);
      state = await readActiveSendTargetState();
    }
    openChatPhone = null;
    openChatPhoneNavigatedAtMs = 0;
    throw new Error(
      `${assertInput.operation} blocked: active WhatsApp chat does not match target phone ${assertInput.expectedPhone}; hrefPhone=${state.hrefPhone ?? "none"} titlePhone=${state.titlePhone ?? "none"} overlayPhone=${state.overlayPhone ?? "none"} contactInfoPhone=${state.contactInfoPhone ?? "none"} title=${JSON.stringify(state.title)} href=${JSON.stringify(state.href)}`,
    );
  }

  async function readActiveSendTargetState(): Promise<ActiveSendTargetState> {
    if (!client) {
      return {
        href: "",
        hrefPhone: null,
        title: "",
        titlePhone: null,
        overlayPhone: null,
        contactInfoPhone: null,
        hasComposer: false,
      };
    }
    const result = await client.Runtime.evaluate({
      expression: `
        (() => {
          const clean = (value) => String(value || "").replace(/\\s+/g, " ").trim();
          const normalizePhone = (value) => {
            const digits = String(value || "").replace(/\\D/g, "");
            if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
              return digits;
            }
            if (digits.length === 10 || digits.length === 11) {
              return "55" + digits;
            }
            return null;
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
          const title = titleCandidates[0] || textCandidates[0] || "";
          let overlayPhone = null;
          try {
            if (typeof window.__nuomaOverlayRefresh === "function") {
              const overlay = window.__nuomaOverlayRefresh();
              overlayPhone = normalizePhone(overlay && overlay.phone);
            }
          } catch {
            overlayPhone = null;
          }
          return {
            href,
            hrefPhone: normalizePhone(hrefPhone),
            title,
            titlePhone: null,
            overlayPhone,
            hasComposer: Boolean(document.querySelector("footer [contenteditable='true']")),
          };
        })()
      `,
      awaitPromise: false,
      returnByValue: true,
      includeCommandLineAPI: false,
    });
    const value = isRecord(result.result.value) ? result.result.value : {};
    return {
      href: typeof value.href === "string" ? value.href : "",
      hrefPhone: typeof value.hrefPhone === "string" ? value.hrefPhone : null,
      title: typeof value.title === "string" ? value.title : "",
      titlePhone: typeof value.titlePhone === "string" ? value.titlePhone : null,
      overlayPhone: typeof value.overlayPhone === "string" ? value.overlayPhone : null,
      contactInfoPhone: null,
      hasComposer: value.hasComposer === true,
    };
  }

  async function readContactInfoPhoneEvidence(expectedPhone: string): Promise<string | null> {
    if (!client) {
      return null;
    }
    const normalizedExpected = normalizePhone(expectedPhone);
    if (!normalizedExpected) {
      return null;
    }
    const result = await client.Runtime.evaluate({
      expression: `
        (async () => {
          const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
          const visible = (node) => {
            if (!node) return false;
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0;
          };
          const normalize = (value) => {
            const digits = String(value || "").replace(/\\D/g, "");
            if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
              return digits;
            }
            if (digits.length === 10 || digits.length === 11) {
              return "55" + digits;
            }
            return null;
          };
          const withoutBrazilMobileNinthDigit = (phone) => {
            const match = /^55(\\d{2})9(\\d{8})$/.exec(phone);
            return match ? "55" + match[1] + match[2] : phone;
          };
          const expected = ${JSON.stringify(normalizedExpected)};
          const expectedWithoutNinth = withoutBrazilMobileNinthDigit(expected);
          const expectedLocal = expected.startsWith("55") ? expected.slice(2) : expected;
          const expectedWithoutNinthLocal = expectedWithoutNinth.startsWith("55")
            ? expectedWithoutNinth.slice(2)
            : expectedWithoutNinth;
          const header =
            document.querySelector("#main header [role='button']") ||
            document.querySelector("#main header");
          if (header && visible(header)) {
            header.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
            header.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
            header.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
          }
          const panelSelectors = [
            '[data-testid*="drawer"]',
            '[data-testid*="contact-info"]',
            '[aria-label*="Contact"]',
            '[aria-label*="Contato"]',
            '[aria-label*="Dados"]',
            'div[role="dialog"]',
            'aside'
          ];
          for (let attempt = 0; attempt < 24; attempt += 1) {
            const panels = Array.from(document.querySelectorAll(panelSelectors.join(",")))
              .filter((node) => visible(node) && !node.closest("#main"));
            for (const panel of panels) {
              const textDigits = String(panel.textContent || "").replace(/\\D/g, "");
              if (
                textDigits.includes(expected) ||
                textDigits.includes(expectedLocal) ||
                (expectedWithoutNinthLocal !== expectedLocal &&
                  textDigits.includes(expectedWithoutNinthLocal)) ||
                (expectedWithoutNinth !== expected && textDigits.includes(expectedWithoutNinth))
              ) {
                const close =
                  panel.querySelector('[aria-label*="Fechar"], [aria-label*="Close"]') ||
                  panel.querySelector('span[data-icon="x"]')?.closest('button,[role="button"]') ||
                  panel.querySelector('span[data-icon="x-alt"]')?.closest('button,[role="button"]');
                if (close instanceof HTMLElement) {
                  close.click();
                  await sleep(250);
                } else {
                  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
                  await sleep(250);
                }
                return expected;
              }
            }
            const bodyText = String(document.body?.innerText || "");
            const bodyDigits = bodyText.replace(/\\D/g, "");
            if (
              /Dados do contato|Contact info|Informações do contato|Contact details/i.test(bodyText) &&
              (bodyDigits.includes(expected) ||
                bodyDigits.includes(expectedLocal) ||
                (expectedWithoutNinthLocal !== expectedLocal &&
                  bodyDigits.includes(expectedWithoutNinthLocal)) ||
                (expectedWithoutNinth !== expected && bodyDigits.includes(expectedWithoutNinth)))
            ) {
              const close =
                document.querySelector('[aria-label*="Fechar"], [aria-label*="Close"]') ||
                document.querySelector('span[data-icon="x"]')?.closest('button,[role="button"]') ||
                document.querySelector('span[data-icon="x-alt"]')?.closest('button,[role="button"]');
              if (close instanceof HTMLElement) {
                close.click();
                await sleep(250);
              } else {
                document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
                await sleep(250);
              }
              return expected;
            }
            await sleep(250);
          }
          return null;
        })()
      `,
      awaitPromise: true,
      returnByValue: true,
      includeCommandLineAPI: false,
    });
    return normalizePhone(typeof result.result.value === "string" ? result.result.value : null);
  }

  async function waitForWhatsAppChatReady(
    timeoutMs: number,
    options?: { requireComposer?: boolean },
  ): Promise<void> {
    if (!client) {
      return;
    }
    const deadline = Date.now() + timeoutMs;
    const requireComposer = options?.requireComposer ?? true;
    let lastState: unknown = null;
    while (Date.now() < deadline) {
      const invalidPhoneMessage = await dismissInvalidPhoneDialog();
      if (invalidPhoneMessage) {
        throw new Error(`WhatsApp rejected target phone: ${invalidPhoneMessage}`);
      }
      const result = await client.Runtime.evaluate({
        expression: `
          (() => ({
            hasMain: Boolean(document.querySelector("#main")),
            hasSidebar: Boolean(document.querySelector("#pane-side")),
            hasComposer: Boolean(document.querySelector("#main footer [contenteditable='true']")),
            startingConversation: /Iniciando conversa|Starting chat|Iniciando chat/i.test(String(document.body?.innerText || "")),
            headerTitle: String(document.querySelector("#main header")?.textContent || "").replace(/\\s+/g, " ").trim(),
            visibleMessages: document.querySelectorAll("#main [data-id]").length,
            href: String(location.href || "")
          }))()
        `,
        awaitPromise: false,
        returnByValue: true,
        includeCommandLineAPI: false,
      });
      const value = result.result.value;
      lastState = value;
      if (isReadyChatState(value, { requireComposer })) {
        return;
      }
      await sleep(250);
    }
    throw new Error(
      `WhatsApp chat did not become ready: ${describeReadyChatStateFailure(lastState, {
        requireComposer,
      })}`,
    );
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
          hasComposer: Boolean(document.querySelector("#main footer [contenteditable='true']")),
          startingConversation: /Iniciando conversa|Starting chat|Iniciando chat/i.test(String(document.body?.innerText || "")),
          headerTitle: String(document.querySelector("#main header")?.textContent || "").replace(/\\s+/g, " ").trim(),
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
    beginContactSession,
    forceConversation,
    ensureTemporaryMessages,
    sendTextMessage,
    sendVoiceMessage,
    sendDocumentMessage,
    sendMediaMessage,
    close: async () => {
      if (reconcileTimer) {
        clearInterval(reconcileTimer);
        reconcileTimer = null;
      }
      removeClientListeners();
      handler.close();
      await client?.close();
      client = null;
      metrics.connected = false;
    },
  };
}

export function shouldAllowActiveSendTarget(input: {
  expectedPhone: string;
  state: ActiveSendTargetState;
  openChatPhone: string | null;
  openChatPhoneNavigatedAtMs: number;
  nowMs: number;
  requireLivePhoneEvidence?: boolean;
}): boolean {
  if (!input.state.hasComposer) {
    return false;
  }
  const livePhoneMismatch =
    (Boolean(input.state.hrefPhone) &&
      !phonesMatchForSendTarget(input.state.hrefPhone, input.expectedPhone)) ||
    (Boolean(input.state.contactInfoPhone) &&
      !phonesMatchForSendTarget(input.state.contactInfoPhone, input.expectedPhone));
  if (livePhoneMismatch) {
    return false;
  }
  const hasLivePhoneEvidence =
    phonesMatchForSendTarget(input.state.hrefPhone, input.expectedPhone) ||
    phonesMatchForSendTarget(input.state.overlayPhone, input.expectedPhone) ||
    phonesMatchForSendTarget(input.state.contactInfoPhone, input.expectedPhone);
  if (input.requireLivePhoneEvidence ?? true) {
    return hasLivePhoneEvidence;
  }
  return hasLivePhoneEvidence;
}

async function selectSyncTarget(env: WorkerEnv): Promise<CDP.Target | undefined> {
  const response = await fetch(
    `http://${env.CHROMIUM_CDP_HOST}:${env.CHROMIUM_CDP_PORT}/json/list`,
    {
      signal: AbortSignal.timeout(5_000),
    },
  );
  const targets = (await response.json()) as CDP.Target[];
  const pageTargets = targets.filter((target) => target.type === "page");
  const whatsappTargets = pageTargets.filter((target) => target.url.includes("web.whatsapp.com"));
  if (whatsappTargets.length === 1) {
    return whatsappTargets[0];
  }
  const preferredTargets = [
    ...pageTargets.filter((target) => target.url.startsWith(env.WA_WEB_URL)),
    ...pageTargets.filter(
      (target) => target.url.includes("web.whatsapp.com") && !target.url.startsWith(env.WA_WEB_URL),
    ),
    ...pageTargets.filter((target) => !target.url.includes("web.whatsapp.com")),
  ];
  let selected: { target: CDP.Target; score: number } | null = null;
  for (const target of preferredTargets) {
    const score = await scoreSyncTarget(env, target);
    if (!selected || score > selected.score) {
      selected = { target, score };
    }
  }
  return selected?.target;
}

async function scoreSyncTarget(env: WorkerEnv, target: CDP.Target): Promise<number> {
  let score = 0;
  if (target.url.startsWith(env.WA_WEB_URL)) {
    score += 20;
  } else if (target.url.includes("web.whatsapp.com")) {
    score += 10;
  }
  const targetClient = await withTimeout(
    CDP({
      host: env.CHROMIUM_CDP_HOST,
      port: env.CHROMIUM_CDP_PORT,
      target,
    }),
    5_000,
    "CDP target attach timed out",
  ).catch(() => null);
  if (!targetClient) {
    return score;
  }
  try {
    const result = await withTimeout(
      targetClient.Runtime.evaluate({
        expression: `
          (() => ({
            href: location.href,
            title: document.title,
            body: String(document.body?.innerText || "").slice(0, 2000),
            hasComposer: Boolean(document.querySelector("#main footer [contenteditable='true'], footer [contenteditable='true']")),
            hasChatList: Boolean(document.querySelector("[aria-label='Lista de conversas'], [aria-label='Chat list'], #pane-side"))
          }))()
        `,
        awaitPromise: false,
        returnByValue: true,
        includeCommandLineAPI: false,
      }),
      5_000,
      "CDP target scoring timed out",
    );
    const value = result.result.value;
    if (!isRecord(value)) {
      return score;
    }
    const body = typeof value.body === "string" ? value.body : "";
    const title = typeof value.title === "string" ? value.title : "";
    if (/whatsapp/i.test(title)) {
      score += 5;
    }
    if (value.hasComposer === true) {
      score += 40;
    }
    if (
      value.hasChatList === true ||
      /Tudo|Não lidas|Favoritas|Arquivadas|All|Unread|Favorites|Archived/i.test(body)
    ) {
      score += 25;
    }
    if (
      /WhatsApp está aberto em outra janela|WhatsApp is open in another window|Usar nesta janela|Use here/i.test(
        body,
      )
    ) {
      score -= 100;
    }
    return score;
  } finally {
    await withTimeout(targetClient.close(), 2_000, "CDP target close timed out").catch(() => null);
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function disabledRuntime(metrics: SyncEngineMetrics, closeHandler?: () => void): SyncEngineRuntime {
  return {
    connected: false,
    metrics,
    forceConversation: async () => {
      throw new Error("sync engine is disabled");
    },
    ensureTemporaryMessages: async () => {
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
    close: async () => {
      closeHandler?.();
    },
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
    mutation: parseOverlayApiMutationGuard(parsed.mutation),
    version: stringValue(parsed.version),
    requestedAt: stringValue(parsed.requestedAt),
  };
}

function parseOverlayApiMutationGuard(value: unknown): OverlayApiMutationGuard | null {
  if (!isRecord(value)) {
    return null;
  }
  const nonce = stringValue(value.nonce);
  const idempotencyKey = stringValue(value.idempotencyKey);
  if (!nonce || !idempotencyKey) {
    return null;
  }
  return {
    nonce,
    idempotencyKey,
    confirmed: value.confirmed === true,
    confirmationText: stringValue(value.confirmationText),
    preparedAt: stringValue(value.preparedAt),
    queuedAt: stringValue(value.queuedAt),
  };
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function positiveIntegerValue(value: unknown): number | null {
  const numeric =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return null;
  }
  return numeric;
}

function updateBackfillResult(
  target: SyncHistoryBackfillResult,
  summary: SyncReconcileSummary,
): void {
  target.visibleMessageCount = summary.visibleMessageCount;
  target.lastFirstExternalId = summary.firstExternalId;
  target.lastLastExternalId = summary.lastExternalId;
}

export function parseTemporaryMessagesDuration(
  value: unknown,
): SyncTemporaryMessagesDuration | null {
  const text = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  if (!text) {
    return null;
  }
  if (/(^|[^0-9])24\s*(h|hora|horas|hour|hours)([^a-z]|$)/i.test(text)) {
    return "24h";
  }
  if (/(^|[^0-9])7\s*(d|dia|dias|day|days)([^a-z]|$)/i.test(text)) {
    return "7d";
  }
  if (/(^|[^0-9])90\s*(d|dia|dias|day|days)([^a-z]|$)/i.test(text)) {
    return "90d";
  }
  if (/(^|[^0-9])3\s*(mes|meses|month|months)([^a-z]|$)/i.test(text)) {
    return "90d";
  }
  if (/(^|[^a-z])(?:tres|três|three)\s*(meses|months)([^a-z]|$)/i.test(text)) {
    return "90d";
  }
  return null;
}

export function temporaryMessagesUiScript(
  duration: SyncTemporaryMessagesDuration,
  keepPanelOpen = false,
): string {
  return `
    (async () => {
      const requestedDuration = ${JSON.stringify(duration)};
      const keepPanelOpen = ${JSON.stringify(keepPanelOpen)};
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const clean = (value) => String(value || "").normalize("NFD")
        .replace(/[\\u0300-\\u036f]/g, "")
        .replace(/\\s+/g, " ")
        .trim()
        .toLowerCase();
      const isVisible = (node) => {
        if (!(node instanceof HTMLElement)) return false;
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      };
      const chatSurfaceLeft = () => {
        const main = document.querySelector("#main");
        if (main instanceof HTMLElement) {
          return Math.max(0, main.getBoundingClientRect().left - 12);
        }
        return Math.min(430, Math.round(window.innerWidth * 0.35));
      };
      const isChatSurfaceNode = (node) => {
        if (!(node instanceof HTMLElement)) return false;
        const rect = node.getBoundingClientRect();
        const rightPanelBuffer = Math.max(360, Math.round(window.innerWidth * 0.4));
        return rect.right >= chatSurfaceLeft() && rect.left <= window.innerWidth + rightPanelBuffer;
      };
      const durationFromText = (value) => {
        const text = clean(value);
        if (/(^|[^0-9])24\\s*(h|hora|horas|hour|hours)([^a-z]|$)/i.test(text)) return "24h";
        if (/(^|[^0-9])7\\s*(d|dia|dias|day|days)([^a-z]|$)/i.test(text)) return "7d";
        if (/(^|[^0-9])90\\s*(d|dia|dias|day|days)([^a-z]|$)/i.test(text)) return "90d";
        if (/(^|[^0-9])3\\s*(mes|meses|month|months)([^a-z]|$)/i.test(text)) return "90d";
        if (/(^|[^a-z])(?:tres|três|three)\\s*(meses|months)([^a-z]|$)/i.test(text)) return "90d";
        return null;
      };
      const durationsFromText = (value) => {
        const found = new Set();
        const text = clean(value);
        if (/(^|[^0-9])24\\s*(h|hora|horas|hour|hours)([^a-z]|$)/i.test(text)) found.add("24h");
        if (/(^|[^0-9])7\\s*(d|dia|dias|day|days)([^a-z]|$)/i.test(text)) found.add("7d");
        if (/(^|[^0-9])90\\s*(d|dia|dias|day|days)([^a-z]|$)/i.test(text)) found.add("90d");
        if (/(^|[^0-9])3\\s*(mes|meses|month|months)([^a-z]|$)/i.test(text)) found.add("90d");
        if (/(^|[^a-z])(?:tres|três|three)\\s*(meses|months)([^a-z]|$)/i.test(text)) found.add("90d");
        return found;
      };
      const clickNode = (node) => {
        const target = node && (node.closest("button") || node.closest("[role='button']") || node.closest("[role='menuitem']") || node);
        if (!(target instanceof HTMLElement) || !isVisible(target)) return false;
        target.focus();
        target.click();
        return true;
      };
      const dispatchClick = (node) => {
        if (!(node instanceof HTMLElement) || !isVisible(node)) return false;
        node.scrollIntoView({ block: "center", inline: "center" });
        const rect = node.getBoundingClientRect();
        const x = Math.max(8, Math.min(window.innerWidth - 8, rect.left + rect.width / 2));
        const y = Math.max(8, Math.min(window.innerHeight - 8, rect.top + rect.height / 2));
        node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: x, clientY: y }));
        node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: x, clientY: y }));
        node.click();
        return true;
      };
      const visibleNodes = (selector, chatOnly = true) => Array.from(document.querySelectorAll(selector))
        .filter((node) => isVisible(node) && (!chatOnly || isChatSurfaceNode(node)));
      const durationEvidenceText = (node) =>
        [
          node.textContent,
          node.getAttribute?.("aria-label"),
          node.getAttribute?.("title"),
        ].filter(Boolean).join(" ");
      const temporaryNoticeRows = () => {
        const main = document.querySelector("#main");
        if (!(main instanceof HTMLElement)) return [];
        return Array.from(main.querySelectorAll("[data-testid='ephemeral_system_message'], [data-testid='msg-notification-container'], [aria-label], [title], div, span"))
          .map((node, index) => {
            const text = durationEvidenceText(node);
            return {
              index,
              node,
              text,
              duration: durationFromText(text),
              relevant: /mensagens temporarias|mensagens temporárias|disappearing messages|mensajes temporales|novas mensagens desaparecerao|novas mensagens desaparecerão|new messages will disappear/i.test(text),
            };
          })
          .filter((item) => item.relevant && item.duration);
      };
      const latestMainDurationEvidence = () => {
        const rows = temporaryNoticeRows();
        return rows.at(-1)?.duration || null;
      };
      const latestTemporaryNoticeNode = () => temporaryNoticeRows().at(-1)?.node || null;
      const bodyDuration = (preferredDuration = null) => {
        const latestDuration = latestMainDurationEvidence();
        if (latestDuration) return latestDuration;
        const text = visibleNodes("#main, [role='dialog'], [data-animate-modal-popup], section, aside, div, span", true)
          .map((node) => durationEvidenceText(node))
          .join("\\n");
        return durationFromText(text);
      };
      const optionDuration = (node) => {
        if (!(node instanceof HTMLElement)) return null;
        const texts = [
          node.getAttribute("aria-label"),
          node.getAttribute("title"),
          node.textContent,
          node.closest("label")?.textContent,
          node.parentElement?.textContent,
          node.nextElementSibling?.textContent,
          node.parentElement?.querySelector("span")?.textContent,
        ];
        for (const text of texts) {
          const duration = durationFromText(text || "");
          if (duration) return duration;
        }
        return null;
      };
      const selectedDuration = () => {
        const selected = visibleNodes(
          "input[aria-checked='true'], input:checked, [role='radio'][aria-checked='true'], [aria-checked='true']",
          true,
        );
        for (const node of selected) {
          const duration = optionDuration(node);
          if (duration) return duration;
        }
        return null;
      };
      const durationOptionCount = () =>
        visibleNodes("input[aria-checked], input[type='radio'], [role='radio'], [aria-checked]", true).length;
      const waitForDurationOptions = async () => {
        for (let attempt = 0; attempt < 8; attempt += 1) {
          if (durationOptionCount() >= 4) return true;
          await sleep(350);
        }
        return false;
      };
      const latestEphemeralSystemDuration = () => {
        const notices = visibleNodes(
          "[data-testid='ephemeral_system_message'], [data-testid='msg-notification-container']",
          true,
        )
          .map((node, index) => {
            const text = node.textContent || "";
            return {
              index,
              text,
              duration: durationFromText(text),
              relevant: /mensagens temporarias|mensagens temporárias|disappearing messages|mensajes temporales/i.test(text),
            };
          })
          .filter((item) => item.relevant && item.duration);
        return notices.reverse()[0]?.duration || null;
      };
      const findByText = (needles, root = document) => {
        const normalizedNeedles = needles.map(clean);
        return Array.from(root.querySelectorAll("button, [role='button'], [role='menuitem'], [role='radio'], [role='option'], div, span"))
          .filter((node) =>
            isVisible(node) &&
            isChatSurfaceNode(node) &&
            !(node instanceof HTMLElement && node.closest("[data-testid='msg-notification-container'], [data-testid='ephemeral_system_message']"))
          )
          .map((node) => {
            const text = clean(node.getAttribute("aria-label") || node.getAttribute("title") || node.textContent || "");
            const rect = node.getBoundingClientRect();
            const interactive = node.matches("button, [role='button'], [role='menuitem'], [role='radio'], [role='option']");
            return { node, text, score: (interactive ? 0 : 10000) + text.length + Math.round(rect.width * rect.height / 1000) };
          })
          .filter((item) => normalizedNeedles.some((needle) => item.text.includes(needle)))
          .sort((a, b) => a.score - b.score)[0]?.node || null;
      };
      const openChatInfo = async () => {
        const header = document.querySelector("#main header");
        if (!(header instanceof HTMLElement)) return false;
        const clickable = header.querySelector("[role='button'], button") || header;
        return clickNode(clickable);
      };
      const openHeaderMenu = async () => {
        const menuLabels = [
          "Mais opcoes", "Mais opções", "More options", "Menu", "Menú", "Mas opciones", "Más opciones"
        ];
        const node = visibleNodes("#main header button[aria-label], #main header [role='button'][aria-label], #main header span[data-icon='menu'], #main header span[data-icon='down']", false)
          .reverse()
          .find((item) => {
            const text = clean(item.getAttribute("aria-label") || item.getAttribute("title") || item.textContent || "");
            return !text || menuLabels.map(clean).some((label) => text.includes(label));
          });
        return node ? clickNode(node) : false;
      };
      const openTemporaryMenu = async () => {
        const tempLabels = [
          "Mensagens temporarias", "Mensagens temporárias", "Disappearing messages",
          "Mensajes temporales", "Mensajes temporarios"
        ];
        if (await waitForDurationOptions()) return true;
        const clickAndConfirm = async (node) => {
          if (!node || !clickNode(node)) return false;
          return waitForDurationOptions();
        };
        const latestNotice = latestTemporaryNoticeNode();
        if (await clickAndConfirm(latestNotice)) return true;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const direct = findByText(tempLabels);
          if (await clickAndConfirm(direct)) return true;
          if (attempt === 0) {
            await openChatInfo();
          } else if (attempt === 1) {
            await openHeaderMenu();
          }
          await sleep(700);
        }
        const menuItem = findByText(tempLabels);
        return clickAndConfirm(menuItem);
      };
      const clickDuration = async () => {
        const labelsByDuration = {
          "24h": ["24 horas", "24 hours", "24 h", "24 horas"],
          "7d": ["7 dias", "7 days", "7 d"],
          "90d": ["90 dias", "90 days", "90 d", "3 meses", "3 months", "tres meses", "três meses", "three months"]
        };
        const radioIndexByDuration = { "24h": 0, "7d": 1, "90d": 2 };
        const radioOptions = () => {
          const rows = visibleNodes("input[aria-checked], input[type='radio'], [role='radio'], [aria-checked]", true)
            .map((input) => {
              const row =
                input.closest("label") ||
                input.closest("[role='radio']") ||
                input.parentElement ||
                input;
              const text = [
                row?.textContent,
                input.getAttribute("aria-label"),
                input.getAttribute("title"),
                input.parentElement?.textContent,
              ].filter(Boolean).join(" ");
              const duration = durationFromText(text) || (/desativad|off|disabled/i.test(clean(text)) ? "off" : null);
              const rect = row instanceof HTMLElement ? row.getBoundingClientRect() : input.getBoundingClientRect();
              return {
                input,
                row,
                text: clean(text),
                duration,
                top: rect.top,
                left: rect.left,
              };
            })
            .filter((item) => item.duration || item.text)
            .sort((a, b) => a.top - b.top || a.left - b.left);
          const unique = [];
          for (const row of rows) {
            if (!unique.some((item) => item.duration === row.duration && Math.abs(item.top - row.top) < 4)) {
              unique.push(row);
            }
          }
          return unique;
        };
        const durationOptionTarget = () => {
          const labels = labelsByDuration[requestedDuration].map(clean);
          const candidates = visibleNodes("label, button, [role='button'], [role='radio'], [role='option'], div, span, input", true)
            .map((node) => {
              const text = clean([
                node.textContent,
                node.getAttribute("aria-label"),
                node.getAttribute("title"),
                node.closest("label")?.textContent,
                node.parentElement?.textContent,
              ].filter(Boolean).join(" "));
              const durations = durationsFromText(text);
              const exact = labels.some((label) => text === label);
              const includes = labels.some((label) => text.includes(label));
              const onlyRequestedDuration = durations.size === 1 && durations.has(requestedDuration);
              return {
                node,
                text,
                score:
                  (exact ? 0 : 1000) +
                  (onlyRequestedDuration ? 0 : 5000) +
                  (node.matches("input, [role='radio'], [role='option'], label, button, [role='button']") ? 0 : 500) +
                  text.length,
                match: (exact || includes) && onlyRequestedDuration && text.length <= 220,
              };
            })
            .filter((item) => item.match)
            .sort((a, b) => a.score - b.score);
          for (const item of candidates) {
            const row =
              item.node.closest("[role='radio'], [role='option'], label, button, [role='button']") ||
              item.node.parentElement;
            const input =
              item.node.matches("[role='radio'], [role='option'], input, button, [role='button']")
                ? item.node
                : row?.querySelector("input[aria-checked], input[type='radio'], [role='radio'], [aria-checked]");
            if (input instanceof HTMLElement && isVisible(input) && isChatSurfaceNode(input)) {
              return input;
            }
            if (row instanceof HTMLElement && isVisible(row) && isChatSurfaceNode(row)) {
              return row;
            }
            if (item.node instanceof HTMLElement) {
              return item.node;
            }
          }
          return null;
        };
        const scrollables = () => visibleNodes("[role='dialog'], [data-animate-modal-popup], section, div", true)
          .filter((node) => node.scrollHeight > node.clientHeight + 20);
        for (let attempt = 0; attempt < 15; attempt += 1) {
          const indexedOption = radioOptions()[radioIndexByDuration[requestedDuration]];
          const indexedTarget =
            indexedOption?.input instanceof HTMLElement
              ? indexedOption.input
              : indexedOption?.row instanceof HTMLElement
                ? indexedOption.row
                : null;
          if (indexedTarget && dispatchClick(indexedTarget)) return true;
          const node = durationOptionTarget();
          if (node && dispatchClick(node)) return true;
          for (const scroller of scrollables()) {
            const position = attempt % 3;
            scroller.scrollTop =
              position === 0
                ? 0
                : position === 1
                  ? Math.round(scroller.scrollHeight / 2)
                  : scroller.scrollHeight;
          }
          await sleep(500);
        }
        return false;
      };
      const closePanels = async () => {
        const ok = findByText(["OK", "Ok", "Entendi", "Got it", "De acuerdo"]);
        if (ok) clickNode(ok);
        const hasDurationOptions = () => visibleNodes("input[aria-checked], input[type='radio'], [role='radio'], [aria-checked]", true).length >= 4;
        const hasComposer = () => Boolean(document.querySelector("#main footer [contenteditable='true']"));
        const clickHeaderIcon = (icons) => {
          const icon = visibleNodes(icons.map((iconName) => "span[data-icon='" + iconName + "'], span[data-testid='" + iconName + "']").join(","), true)
            .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
          const target =
            icon?.closest("button") ||
            icon?.closest("[role='button']") ||
            icon?.parentElement ||
            icon;
          return dispatchClick(target);
        };
        for (let attempt = 0; attempt < 4; attempt += 1) {
          if (!hasDurationOptions() && hasComposer()) return true;
          if (hasDurationOptions()) {
            clickHeaderIcon(["back-refreshed", "back"]);
          } else {
            clickHeaderIcon(["x", "x-alt", "dismiss"]);
          }
          await sleep(800);
        }
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        await sleep(500);
        return !hasDurationOptions() && hasComposer();
      };

      const closedPanelDuration = bodyDuration();
      if (closedPanelDuration === requestedDuration) {
        return {
          changed: false,
          menuDetected: false,
          verifiedDuration: closedPanelDuration,
          reason: "duration-already-matched"
        };
      }
      const menuDetected = await openTemporaryMenu();
      if (!menuDetected) {
        return {
          changed: false,
          menuDetected: false,
          verifiedDuration: closedPanelDuration,
          reason: "temporary-menu-not-found"
        };
      }
      await sleep(700);
      const beforeDuration = selectedDuration() || closedPanelDuration;
      const clickedDuration = await clickDuration();
      await sleep(900);
      const verifiedDuration = selectedDuration() || latestEphemeralSystemDuration();
      if (!keepPanelOpen) {
        const closed = await closePanels();
        if (!closed) {
          return {
            changed: clickedDuration && beforeDuration !== requestedDuration,
            menuDetected: true,
            verifiedDuration,
            reason: "temporary-panel-close-failed"
          };
        }
      }
      return {
        changed: clickedDuration && beforeDuration !== requestedDuration,
        menuDetected: true,
        verifiedDuration,
        reason: clickedDuration
          ? (verifiedDuration ? "duration-clicked" : "selected-duration-not-detected")
          : "duration-option-not-found"
      };
    })()
  `;
}

function temporaryMessagesProofScript(duration: SyncTemporaryMessagesDuration): string {
  return `
    (async () => {
      const requestedDuration = ${JSON.stringify(duration)};
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const clean = (value) => String(value || "").normalize("NFD")
        .replace(/[\\u0300-\\u036f]/g, "")
        .replace(/\\s+/g, " ")
        .trim()
        .toLowerCase();
      const isVisible = (node) => {
        if (!(node instanceof HTMLElement)) return false;
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      };
      const chatSurfaceLeft = () => {
        const main = document.querySelector("#main");
        if (main instanceof HTMLElement) return Math.max(0, main.getBoundingClientRect().left - 12);
        return Math.min(430, Math.round(window.innerWidth * 0.35));
      };
      const isChatSurfaceNode = (node) => {
        if (!(node instanceof HTMLElement)) return false;
        const rect = node.getBoundingClientRect();
        const rightPanelBuffer = Math.max(360, Math.round(window.innerWidth * 0.4));
        return rect.right >= chatSurfaceLeft() && rect.left <= window.innerWidth + rightPanelBuffer;
      };
      const durationFromText = (value) => {
        const text = clean(value);
        if (/(^|[^0-9])24\\s*(h|hora|horas|hour|hours)([^a-z]|$)/i.test(text)) return "24h";
        if (/(^|[^0-9])7\\s*(d|dia|dias|day|days)([^a-z]|$)/i.test(text)) return "7d";
        if (/(^|[^0-9])90\\s*(d|dia|dias|day|days)([^a-z]|$)/i.test(text)) return "90d";
        if (/(^|[^0-9])3\\s*(mes|meses|month|months)([^a-z]|$)/i.test(text)) return "90d";
        if (/(^|[^a-z])(?:tres|três|three)\\s*(meses|months)([^a-z]|$)/i.test(text)) return "90d";
        return null;
      };
      const clickNode = (node) => {
        const target = node && (node.closest("button") || node.closest("[role='button']") || node.closest("[role='menuitem']") || node);
        if (!(target instanceof HTMLElement) || !isVisible(target) || !isChatSurfaceNode(target)) return false;
        target.focus();
        target.click();
        return true;
      };
      const visibleNodes = (selector) => Array.from(document.querySelectorAll(selector))
        .filter((node) => isVisible(node) && isChatSurfaceNode(node));
      const optionDuration = (node) => {
        if (!(node instanceof HTMLElement)) return null;
        const texts = [
          node.getAttribute("aria-label"),
          node.getAttribute("title"),
          node.textContent,
          node.closest("label")?.textContent,
          node.parentElement?.textContent,
          node.nextElementSibling?.textContent,
          node.parentElement?.querySelector("span")?.textContent,
        ];
        for (const text of texts) {
          const duration = durationFromText(text || "");
          if (duration) return duration;
        }
        return null;
      };
      const selectedDuration = () => {
        const selected = visibleNodes(
          "input[aria-checked='true'], input:checked, [role='radio'][aria-checked='true'], [aria-checked='true']",
        );
        for (const node of selected) {
          const duration = optionDuration(node);
          if (duration) return duration;
        }
        return null;
      };
      const latestEphemeralSystemDuration = () => {
        const notices = visibleNodes("[data-testid='ephemeral_system_message'], [data-testid='msg-notification-container']")
          .map((node, index) => {
            const text = node.textContent || "";
            return {
              index,
              text,
              duration: durationFromText(text),
              relevant: /mensagens temporarias|mensagens temporárias|disappearing messages|mensajes temporales/i.test(text),
            };
          })
          .filter((item) => item.relevant && item.duration);
        return notices.reverse()[0]?.duration || null;
      };
      const findByText = (needles) => {
        const normalizedNeedles = needles.map(clean);
        return visibleNodes("button, [role='button'], [role='menuitem'], [role='radio'], [role='option'], div, span")
          .filter((node) =>
            !(node instanceof HTMLElement && node.closest("[data-testid='msg-notification-container'], [data-testid='ephemeral_system_message']"))
          )
          .map((node) => {
            const text = clean(node.getAttribute("aria-label") || node.getAttribute("title") || node.textContent || "");
            const interactive = node.matches("button, [role='button'], [role='menuitem'], [role='radio'], [role='option']");
            return { node, text, score: (interactive ? 0 : 10000) + text.length };
          })
          .filter((item) => normalizedNeedles.some((needle) => item.text.includes(needle)))
          .sort((a, b) => a.score - b.score)[0]?.node || null;
      };
      const openChatInfo = async () => {
        const header = document.querySelector("#main header");
        if (!(header instanceof HTMLElement)) return false;
        const clickable = header.querySelector("[role='button'], button") || header;
        return clickNode(clickable);
      };
      const openHeaderMenu = async () => {
        const node = visibleNodes("#main header button[aria-label], #main header [role='button'][aria-label], #main header span[data-icon='menu'], #main header span[data-icon='down']").reverse()[0];
        return node ? clickNode(node) : false;
      };
      const tempLabels = [
        "Mensagens temporarias", "Mensagens temporárias", "Disappearing messages",
        "Mensajes temporales", "Mensajes temporarios"
      ];
      const initialComposer = document.querySelector("#main footer [contenteditable='true']");
      const initialHeader = document.querySelector("#main header");
      if (!(initialComposer instanceof HTMLElement) || !(initialHeader instanceof HTMLElement)) {
        return {
          verifiedDuration: null,
          textEvidence: "chat composer/header not visible before before-send proof",
        };
      }
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const direct = findByText(tempLabels);
        if (direct && clickNode(direct)) break;
        if (attempt === 0) await openChatInfo();
        if (attempt === 1) await openHeaderMenu();
        await sleep(800);
      }
      await sleep(1000);
      const proofText = visibleNodes("#main, [role='dialog'], [data-animate-modal-popup], section, aside, div, span")
        .map((node) => node.textContent || "")
        .join("\\n");
      const selected = selectedDuration() || latestEphemeralSystemDuration();
      const durationEvidence = visibleNodes("button, [role='button'], [role='radio'], [role='option'], div, span")
        .map((node) => node.textContent || node.getAttribute("aria-label") || "")
        .find((text) => durationFromText(text) === selected) || "";
      return {
        verifiedDuration: selected,
        textEvidence: (durationEvidence + "\\n" + proofText).replace(/\\s+/g, " ").trim().slice(0, 2000),
      };
    })()
  `;
}

function temporaryMessagesProofSvg(input: {
  requestedDuration: SyncTemporaryMessagesDuration;
  verifiedDuration: SyncTemporaryMessagesDuration;
  textEvidence: string;
}): string {
  const lines = [
    "Nuoma temporary messages proof",
    `requested: ${input.requestedDuration}`,
    `verified: ${input.verifiedDuration}`,
    `captured_at: ${new Date().toISOString()}`,
    "",
    input.textEvidence.replace(/\s+/g, " ").trim().slice(0, 900),
  ]
    .flatMap((line) => wrapSvgText(line, 82))
    .slice(0, 18);
  const text = lines
    .map((line, index) => {
      const weight = index === 0 ? "700" : "400";
      return `<text x="32" y="${48 + index * 26}" font-size="18" font-weight="${weight}" fill="#e7ece9">${escapeXml(line)}</text>`;
    })
    .join("\n");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="620" viewBox="0 0 1200 620">`,
    `<rect width="1200" height="620" fill="#0b1110"/>`,
    `<rect x="24" y="24" width="1152" height="572" rx="18" fill="#13201d" stroke="#56d6b1" stroke-width="2"/>`,
    text,
    `</svg>`,
    "",
  ].join("\n");
}

function wrapSvgText(value: string, maxLength: number): string[] {
  const words = value.split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxLength && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current || lines.length === 0) {
    lines.push(current);
  }
  return lines;
}

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (char) => {
    switch (char) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case '"':
        return "&quot;";
      case "'":
        return "&apos;";
      default:
        return char;
    }
  });
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

export function isReadyChatState(
  value: unknown,
  options?: { requireComposer?: boolean },
): value is ReadyChatState {
  // WA Web can leave a visible "Iniciando conversa" overlay around even after
  // the target chat composer is ready. The send path still validates the active
  // target with live phone evidence before typing into the composer.
  if (!isRecord(value) || value.hasMain !== true || value.hasSidebar !== true) {
    return false;
  }
  const hasTitle = typeof value.headerTitle === "string" && value.headerTitle.trim().length > 0;
  if (!hasTitle) {
    return false;
  }
  if (options?.requireComposer ?? true) {
    return value.hasComposer === true;
  }
  const visibleMessages = numberFromUnknown(value.visibleMessages);
  return value.hasComposer === true || (visibleMessages !== null && visibleMessages > 0);
}

function describeReadyChatStateFailure(
  value: unknown,
  options: { requireComposer: boolean },
): string {
  if (!isRecord(value)) {
    return "state not readable";
  }
  const parts = [
    `main=${String(value.hasMain === true)}`,
    `sidebar=${String(value.hasSidebar === true)}`,
    `composer=${String(value.hasComposer === true)}`,
    `requireComposer=${String(options.requireComposer)}`,
    `startingConversation=${String(value.startingConversation === true)}`,
    `visibleMessages=${String(numberFromUnknown(value.visibleMessages) ?? 0)}`,
  ];
  const headerTitle = typeof value.headerTitle === "string" ? value.headerTitle.trim() : "";
  if (headerTitle) {
    parts.push(`headerTitle=${JSON.stringify(headerTitle.slice(0, 80))}`);
  }
  const href = typeof value.href === "string" ? value.href : "";
  if (href) {
    parts.push(`href=${JSON.stringify(href.slice(0, 160))}`);
  }
  return parts.join(" ");
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

function voiceRecorderInitScript(audioBase64: string): string {
  return `
    (() => {
      const w = window;
      w.__nuomaVoiceAudioBase64 = ${JSON.stringify(audioBase64)};
      w.__nuomaVoiceLastInjection = null;
      w.__nuomaVoiceLastInjectionError = null;
      if (w.__nuomaVoiceInitInstalled) return;
      w.__nuomaVoiceInitInstalled = true;
      const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      const decodePcmWav = (audioCtx, bytes) => {
        const readAscii = (offset, length) => String.fromCharCode(...bytes.slice(offset, offset + length));
        if (bytes.byteLength < 44 || readAscii(0, 4) !== "RIFF" || readAscii(8, 4) !== "WAVE") {
          throw new Error("unsupported wav container");
        }
        let offset = 12;
        let fmt = null;
        let dataOffset = -1;
        let dataSize = 0;
        while (offset + 8 <= bytes.byteLength) {
          const tag = readAscii(offset, 4);
          const size =
            bytes[offset + 4] |
            (bytes[offset + 5] << 8) |
            (bytes[offset + 6] << 16) |
            (bytes[offset + 7] << 24);
          const chunkOffset = offset + 8;
          if (tag === "fmt ") {
            fmt = {
              audioFormat: bytes[chunkOffset] | (bytes[chunkOffset + 1] << 8),
              channels: bytes[chunkOffset + 2] | (bytes[chunkOffset + 3] << 8),
              sampleRate:
                bytes[chunkOffset + 4] |
                (bytes[chunkOffset + 5] << 8) |
                (bytes[chunkOffset + 6] << 16) |
                (bytes[chunkOffset + 7] << 24),
              bitsPerSample: bytes[chunkOffset + 22] | (bytes[chunkOffset + 23] << 8)
            };
          } else if (tag === "data") {
            dataOffset = chunkOffset;
            dataSize = size;
          }
          offset += 8 + size + (size % 2);
        }
        if (!fmt || fmt.audioFormat !== 1 || fmt.channels < 1 || fmt.bitsPerSample !== 16 || dataOffset < 0) {
          throw new Error("unsupported wav pcm format");
        }
        const frames = Math.floor(dataSize / (fmt.channels * 2));
        const audioBuffer = audioCtx.createBuffer(1, frames, fmt.sampleRate);
        const channel = audioBuffer.getChannelData(0);
        for (let frame = 0; frame < frames; frame += 1) {
          let mixed = 0;
          for (let channelIndex = 0; channelIndex < fmt.channels; channelIndex += 1) {
            const sampleOffset = dataOffset + (frame * fmt.channels + channelIndex) * 2;
            const raw = bytes[sampleOffset] | (bytes[sampleOffset + 1] << 8);
            const signed = raw >= 0x8000 ? raw - 0x10000 : raw;
            mixed += signed / 32768;
          }
          channel[frame] = mixed / fmt.channels;
        }
        return audioBuffer;
      };
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        const b64Data = w.__nuomaVoiceAudioBase64;
        if (constraints && constraints.audio && b64Data) {
          try {
            const binaryStr = w.atob(b64Data);
            const bytes = new Uint8Array(binaryStr.length);
            for (let index = 0; index < binaryStr.length; index += 1) {
              bytes[index] = binaryStr.charCodeAt(index);
            }
            const AudioCtx = w.AudioContext || w.webkitAudioContext;
            const audioCtx = new AudioCtx({ sampleRate: 16000 });
            if (audioCtx.state === "suspended") {
              await audioCtx.resume();
            }
            let audioBuffer;
            try {
              audioBuffer = await audioCtx.decodeAudioData(bytes.buffer.slice(0));
            } catch {
              audioBuffer = decodePcmWav(audioCtx, bytes);
            }
            const source = audioCtx.createBufferSource();
            source.buffer = audioBuffer;
            const dest = audioCtx.createMediaStreamDestination();
            source.connect(dest);
            source.start(0);
            w.__nuomaVoiceLastInjection = {
              consumedAt: new Date().toISOString(),
              byteLength: bytes.length,
              sampleRate: audioBuffer.sampleRate,
              duration: audioBuffer.duration
            };
            return dest.stream;
          } catch (error) {
            w.__nuomaVoiceLastInjectionError = {
              at: new Date().toISOString(),
              name: error && error.name,
              message: String(error && (error.message || error))
            };
            throw error;
          }
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
    waJid:
      typeof value.waJid === "string"
        ? normalizeWaJid(value.waJid)
        : normalizeWaJid(externalThreadId),
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
    thread.waJid ??
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

function phonesMatchForSendTarget(actual: string | null, expected: string): boolean {
  if (!actual) {
    return false;
  }
  const normalizeComparablePhone = (phone: string) => {
    const digits = phone.replace(/\D/g, "");
    if ((digits.length === 10 || digits.length === 11) && digits.startsWith("31")) {
      return `55${digits}`;
    }
    return digits;
  };
  const normalizedActual = normalizeComparablePhone(actual);
  const normalizedExpected = normalizeComparablePhone(expected);
  if (normalizedActual === normalizedExpected) {
    return true;
  }
  const withoutBrazilMobileNinthDigit = (phone: string) => {
    const match = /^55(\d{2})9(\d{8})$/.exec(phone);
    return match ? `55${match[1]}${match[2]}` : phone;
  };
  return (
    withoutBrazilMobileNinthDigit(normalizedActual) ===
    withoutBrazilMobileNinthDigit(normalizedExpected)
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
