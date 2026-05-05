import type {
  ChannelType,
  MediaAssetType,
  MessageContentType,
  MessageDirection,
  MessageStatus,
  TimestampPrecision,
} from "@nuoma/contracts";

export const SYNC_BINDING_NAME = "__nuomaSync";

export type SyncEventType =
  | "message-added"
  | "message-updated"
  | "message-removed"
  | "conv-unread"
  | "chat-opened"
  | "delivery-status"
  | "conversation-fingerprint-changed"
  | "dom-wa-changed"
  | "profile-photo-captured"
  | "attachment-candidate-captured"
  | "reconcile-snapshot";

export interface SyncThreadRef {
  channel: Extract<ChannelType, "whatsapp" | "instagram">;
  externalThreadId: string;
  title: string;
  phone: string | null;
  unreadCount: number;
  fingerprint: string | null;
}

export interface SyncMessageRef {
  externalId: string;
  direction: MessageDirection;
  contentType: MessageContentType;
  status: MessageStatus;
  body: string | null;
  displayedAtText: string | null;
  waDisplayedAt: string | null;
  timestampPrecision: TimestampPrecision;
  messageSecond: number | null;
  waInferredSecond: number | null;
  observedAtUtc: string;
  raw: Record<string, unknown>;
}

export interface SyncProfilePhotoRef {
  fileName: string;
  mimeType: string;
  sha256: string;
  sizeBytes: number;
  storagePath: string;
  sourceUrl: string | null;
}

export interface SyncAttachmentCandidateRef {
  contentType: MediaAssetType;
  externalMessageId: string | null;
  fileName: string;
  mimeType: string;
  sha256: string;
  sizeBytes: number;
  durationMs: number | null;
  storagePath: string;
  sourceUrl: string | null;
  caption: string | null;
}

export interface SyncBaseEvent {
  type: SyncEventType;
  source: "wa-web" | "instagram-web";
  observedAtUtc: string;
  thread: SyncThreadRef;
}

export interface SyncMessageEvent extends SyncBaseEvent {
  type: "message-added" | "message-updated";
  message: SyncMessageRef;
}

export interface SyncMessageRemovedEvent extends SyncBaseEvent {
  type: "message-removed";
  externalId: string;
}

export interface SyncDeliveryStatusEvent extends SyncBaseEvent {
  type: "delivery-status";
  externalId: string;
  status: MessageStatus;
}

export interface SyncConversationEvent extends SyncBaseEvent {
  type:
    | "conv-unread"
    | "chat-opened"
    | "conversation-fingerprint-changed"
    | "dom-wa-changed"
    | "reconcile-snapshot";
  details?: Record<string, unknown>;
}

export interface SyncProfilePhotoCapturedEvent extends SyncBaseEvent {
  type: "profile-photo-captured";
  profilePhoto: SyncProfilePhotoRef;
  details?: Record<string, unknown>;
}

export interface SyncAttachmentCandidateCapturedEvent extends SyncBaseEvent {
  type: "attachment-candidate-captured";
  attachment: SyncAttachmentCandidateRef;
  details?: Record<string, unknown>;
}

export type SyncEvent =
  | SyncMessageEvent
  | SyncMessageRemovedEvent
  | SyncDeliveryStatusEvent
  | SyncConversationEvent
  | SyncProfilePhotoCapturedEvent
  | SyncAttachmentCandidateCapturedEvent;

const eventTypes: ReadonlySet<string> = new Set<SyncEventType>([
  "message-added",
  "message-updated",
  "message-removed",
  "conv-unread",
  "chat-opened",
  "delivery-status",
  "conversation-fingerprint-changed",
  "dom-wa-changed",
  "profile-photo-captured",
  "attachment-candidate-captured",
  "reconcile-snapshot",
]);

const channels: ReadonlySet<string> = new Set(["whatsapp", "instagram"]);
const sources: ReadonlySet<string> = new Set(["wa-web", "instagram-web"]);
const directions: ReadonlySet<string> = new Set(["inbound", "outbound", "system"]);
const contentTypes: ReadonlySet<string> = new Set([
  "text",
  "image",
  "audio",
  "voice",
  "video",
  "document",
  "link",
  "sticker",
  "system",
]);
const mediaAssetTypes: ReadonlySet<string> = new Set([
  "image",
  "audio",
  "voice",
  "video",
  "document",
]);
const statuses: ReadonlySet<string> = new Set([
  "pending",
  "sent",
  "delivered",
  "read",
  "failed",
  "received",
]);
const precisions: ReadonlySet<string> = new Set(["second", "minute", "date", "unknown"]);

export function parseSyncEventPayload(payload: string): SyncEvent {
  const value = JSON.parse(payload) as unknown;
  if (!isRecord(value) || !isSyncEventType(value.type)) {
    throw new Error("Invalid sync event type");
  }

  const base = parseBaseEvent(value);
  switch (value.type) {
    case "message-added":
    case "message-updated":
      if (!isRecord(value.message)) {
        throw new Error("Invalid sync message payload");
      }
      return {
        ...base,
        type: value.type,
        message: parseMessage(value.message),
      };
    case "message-removed":
      if (typeof value.externalId !== "string" || value.externalId.length === 0) {
        throw new Error("Invalid removed message externalId");
      }
      return { ...base, type: value.type, externalId: value.externalId };
    case "delivery-status":
      if (typeof value.externalId !== "string" || value.externalId.length === 0) {
        throw new Error("Invalid delivery-status externalId");
      }
      if (!isMessageStatus(value.status)) {
        throw new Error("Invalid delivery-status status");
      }
      return { ...base, type: value.type, externalId: value.externalId, status: value.status };
    case "conv-unread":
    case "chat-opened":
    case "conversation-fingerprint-changed":
    case "dom-wa-changed":
    case "reconcile-snapshot":
      return {
        ...base,
        type: value.type,
        details: isRecord(value.details) ? value.details : undefined,
      };
    case "profile-photo-captured":
      if (!isRecord(value.profilePhoto)) {
        throw new Error("Invalid sync profile photo payload");
      }
      return {
        ...base,
        type: value.type,
        profilePhoto: parseProfilePhoto(value.profilePhoto),
        details: isRecord(value.details) ? value.details : undefined,
      };
    case "attachment-candidate-captured":
      if (!isRecord(value.attachment)) {
        throw new Error("Invalid sync attachment candidate payload");
      }
      return {
        ...base,
        type: value.type,
        attachment: parseAttachmentCandidate(value.attachment),
        details: isRecord(value.details) ? value.details : undefined,
      };
    default:
      return assertNever(value.type);
  }
}

function parseBaseEvent(value: Record<string, unknown>): SyncBaseEvent {
  if (!isSource(value.source)) {
    throw new Error("Invalid sync event source");
  }
  if (typeof value.observedAtUtc !== "string") {
    throw new Error("Invalid sync event observedAtUtc");
  }
  if (!isRecord(value.thread)) {
    throw new Error("Invalid sync event thread");
  }
  return {
    type: value.type as SyncEventType,
    source: value.source,
    observedAtUtc: value.observedAtUtc,
    thread: parseThread(value.thread),
  };
}

function parseThread(value: Record<string, unknown>): SyncThreadRef {
  if (!isChannel(value.channel)) {
    throw new Error("Invalid sync thread channel");
  }
  if (typeof value.externalThreadId !== "string" || value.externalThreadId.length === 0) {
    throw new Error("Invalid sync thread externalThreadId");
  }
  return {
    channel: value.channel,
    externalThreadId: value.externalThreadId,
    title:
      typeof value.title === "string" && value.title.length > 0
        ? value.title
        : value.externalThreadId,
    phone: typeof value.phone === "string" && value.phone.length > 0 ? value.phone : null,
    unreadCount: typeof value.unreadCount === "number" ? Math.max(0, value.unreadCount) : 0,
    fingerprint:
      typeof value.fingerprint === "string" && value.fingerprint.length > 0
        ? value.fingerprint
        : null,
  };
}

function parseMessage(value: Record<string, unknown>): SyncMessageRef {
  if (typeof value.externalId !== "string" || value.externalId.length === 0) {
    throw new Error("Invalid sync message externalId");
  }
  if (!isDirection(value.direction)) {
    throw new Error("Invalid sync message direction");
  }
  if (!isContentType(value.contentType)) {
    throw new Error("Invalid sync message contentType");
  }
  if (!isMessageStatus(value.status)) {
    throw new Error("Invalid sync message status");
  }
  if (!isTimestampPrecision(value.timestampPrecision)) {
    throw new Error("Invalid sync message timestampPrecision");
  }

  return {
    externalId: value.externalId,
    direction: value.direction,
    contentType: value.contentType,
    status: value.status,
    body: typeof value.body === "string" && value.body.length > 0 ? value.body : null,
    displayedAtText:
      typeof value.displayedAtText === "string" && value.displayedAtText.length > 0
        ? value.displayedAtText
        : null,
    waDisplayedAt: typeof value.waDisplayedAt === "string" ? value.waDisplayedAt : null,
    timestampPrecision: value.timestampPrecision,
    messageSecond: isSecond(value.messageSecond) ? value.messageSecond : null,
    waInferredSecond: isSecond(value.waInferredSecond) ? value.waInferredSecond : null,
    observedAtUtc:
      typeof value.observedAtUtc === "string" ? value.observedAtUtc : new Date().toISOString(),
    raw: isRecord(value.raw) ? value.raw : {},
  };
}

function parseProfilePhoto(value: Record<string, unknown>): SyncProfilePhotoRef {
  if (typeof value.fileName !== "string" || value.fileName.length === 0) {
    throw new Error("Invalid sync profile photo fileName");
  }
  if (typeof value.mimeType !== "string" || !value.mimeType.startsWith("image/")) {
    throw new Error("Invalid sync profile photo mimeType");
  }
  if (typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256)) {
    throw new Error("Invalid sync profile photo sha256");
  }
  if (
    typeof value.sizeBytes !== "number" ||
    !Number.isInteger(value.sizeBytes) ||
    value.sizeBytes < 0
  ) {
    throw new Error("Invalid sync profile photo sizeBytes");
  }
  if (typeof value.storagePath !== "string" || value.storagePath.length === 0) {
    throw new Error("Invalid sync profile photo storagePath");
  }
  return {
    fileName: value.fileName,
    mimeType: value.mimeType,
    sha256: value.sha256,
    sizeBytes: value.sizeBytes,
    storagePath: value.storagePath,
    sourceUrl:
      typeof value.sourceUrl === "string" && isUrl(value.sourceUrl) ? value.sourceUrl : null,
  };
}

function parseAttachmentCandidate(value: Record<string, unknown>): SyncAttachmentCandidateRef {
  if (!isMediaAssetType(value.contentType)) {
    throw new Error("Invalid sync attachment candidate contentType");
  }
  if (typeof value.fileName !== "string" || value.fileName.length === 0) {
    throw new Error("Invalid sync attachment candidate fileName");
  }
  if (typeof value.mimeType !== "string" || value.mimeType.length === 0) {
    throw new Error("Invalid sync attachment candidate mimeType");
  }
  if (typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256)) {
    throw new Error("Invalid sync attachment candidate sha256");
  }
  if (
    typeof value.sizeBytes !== "number" ||
    !Number.isInteger(value.sizeBytes) ||
    value.sizeBytes < 0
  ) {
    throw new Error("Invalid sync attachment candidate sizeBytes");
  }
  if (
    value.durationMs !== null &&
    value.durationMs !== undefined &&
    (typeof value.durationMs !== "number" ||
      !Number.isInteger(value.durationMs) ||
      value.durationMs < 0)
  ) {
    throw new Error("Invalid sync attachment candidate durationMs");
  }
  if (typeof value.storagePath !== "string" || value.storagePath.length === 0) {
    throw new Error("Invalid sync attachment candidate storagePath");
  }
  return {
    contentType: value.contentType,
    externalMessageId:
      typeof value.externalMessageId === "string" && value.externalMessageId.length > 0
        ? value.externalMessageId
        : null,
    fileName: value.fileName,
    mimeType: value.mimeType,
    sha256: value.sha256,
    sizeBytes: value.sizeBytes,
    durationMs: typeof value.durationMs === "number" ? value.durationMs : null,
    storagePath: value.storagePath,
    sourceUrl:
      typeof value.sourceUrl === "string" && isUrl(value.sourceUrl) ? value.sourceUrl : null,
    caption: typeof value.caption === "string" && value.caption.length > 0 ? value.caption : null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSyncEventType(value: unknown): value is SyncEventType {
  return typeof value === "string" && eventTypes.has(value);
}

function isSource(value: unknown): value is SyncBaseEvent["source"] {
  return typeof value === "string" && sources.has(value);
}

function isChannel(value: unknown): value is SyncThreadRef["channel"] {
  return typeof value === "string" && channels.has(value);
}

function isDirection(value: unknown): value is MessageDirection {
  return typeof value === "string" && directions.has(value);
}

function isContentType(value: unknown): value is MessageContentType {
  return typeof value === "string" && contentTypes.has(value);
}

function isMediaAssetType(value: unknown): value is MediaAssetType {
  return typeof value === "string" && mediaAssetTypes.has(value);
}

function isMessageStatus(value: unknown): value is MessageStatus {
  return typeof value === "string" && statuses.has(value);
}

function isTimestampPrecision(value: unknown): value is TimestampPrecision {
  return typeof value === "string" && precisions.has(value);
}

function isUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function isSecond(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 59;
}

function assertNever(value: never): never {
  throw new Error(`Unsupported sync event type: ${String(value)}`);
}
