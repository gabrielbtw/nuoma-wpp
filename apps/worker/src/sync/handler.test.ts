import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import pino from "pino";

import { createRepositories, openDb, runMigrations, type DbHandle } from "@nuoma/db";

import { createSyncEventHandler } from "./handler.js";
import type { SyncEvent, SyncThreadRef } from "./events.js";

let tempDir: string;
let db: DbHandle;

const thread: SyncThreadRef = {
  channel: "whatsapp",
  externalThreadId: "5531982066263@c.us",
  title: "5531982066263",
  phone: "5531982066263",
  unreadCount: 0,
  fingerprint: null,
};

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nuoma-v2-sync-"));
  db = openDb(path.join(tempDir, "sync.db"));
  await runMigrations(db);
});

afterEach(async () => {
  db.close();
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("sync event handler", () => {
  it("inserts observed messages idempotently and updates status/deleted flags", async () => {
    const repos = createRepositories(db);
    const user = await repos.users.create({
      email: "sync@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const handler = createSyncEventHandler({
      repos,
      logger: pino({ level: "silent" }),
      userId: user.id,
    });
    const messageEvent: SyncEvent = {
      type: "message-added",
      source: "wa-web",
      observedAtUtc: "2026-04-30T18:34:42.123Z",
      thread,
      message: {
        externalId: "false_5531982066263@c.us_MSG1",
        direction: "inbound",
        contentType: "text",
        status: "received",
        body: "Oi",
        displayedAtText: "[15:34, 30/04/2026] Maria: ",
        waDisplayedAt: null,
        timestampPrecision: "unknown",
        messageSecond: null,
        waInferredSecond: 59,
        observedAtUtc: "2026-04-30T18:34:42.123Z",
        raw: { source: "test" },
      },
    };

    await handler.handle(messageEvent);
    await handler.handle(messageEvent);
    await handler.handle({
      ...messageEvent,
      type: "message-updated",
      observedAtUtc: "2026-04-30T18:34:45.000Z",
      message: {
        ...messageEvent.message,
        body: "Oi editado",
        observedAtUtc: "2026-04-30T18:34:45.000Z",
        raw: {
          source: "test",
          isEdited: true,
        },
      },
    });
    await handler.handle({
      type: "delivery-status",
      source: "wa-web",
      observedAtUtc: "2026-04-30T18:35:00.000Z",
      thread,
      externalId: "false_5531982066263@c.us_MSG1",
      status: "read",
    });
    await handler.handle({
      type: "message-removed",
      source: "wa-web",
      observedAtUtc: "2026-04-30T18:36:00.000Z",
      thread,
      externalId: "false_5531982066263@c.us_MSG1",
    });
    await handler.handle({
      type: "reconcile-snapshot",
      source: "wa-web",
      observedAtUtc: "2026-04-30T18:37:00.000Z",
      thread,
      details: {
        reason: "hot-window",
        visibleMessageCount: 1,
      },
    });

    const conversation = await repos.conversations.findByExternalThread({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: thread.externalThreadId,
    });
    const messages = await repos.messages.listByConversation({
      userId: user.id,
      conversationId: conversation?.id ?? 0,
    });

    expect(conversation?.title).toBe("5531982066263");
    expect(messages).toHaveLength(1);
    expect(messages[0]?.body).toBe("Oi editado");
    expect(messages[0]?.status).toBe("read");
    expect(messages[0]?.waDisplayedAt).toBe("2026-04-30T15:34:00.000-03:00");
    expect(messages[0]?.timestampPrecision).toBe("minute");
    expect(messages[0]?.messageSecond).toBeNull();
    expect(messages[0]?.waInferredSecond).toBe(59);
    expect(messages[0]?.editedAt).toBe("2026-04-30T18:34:45.000Z");
    expect(messages[0]?.raw?.editHistory).toEqual([
      {
        body: "Oi",
        status: "received",
        observedAtUtc: "2026-04-30T18:34:42.123Z",
        replacedAtUtc: "2026-04-30T18:34:45.000Z",
      },
    ]);
    expect(messages[0]?.deletedAt).toBe("2026-04-30T18:36:00.000Z");
    expect(handler.metrics.messagesInserted).toBe(1);
    expect(handler.metrics.messagesDuplicated).toBe(2);
    expect(handler.metrics.statusesUpdated).toBe(1);
    expect(handler.metrics.messagesDeleted).toBe(1);
    expect(handler.metrics.hotWindowReconciles).toBe(1);
    expect(handler.metrics.syncEventLatencyMsLast).toEqual(expect.any(Number));
  });

  it("counts messages inserted by forced reconcile as safety-net pickups", async () => {
    const repos = createRepositories(db);
    const user = await repos.users.create({
      email: "safety@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const handler = createSyncEventHandler({
      repos,
      logger: pino({ level: "silent" }),
      userId: user.id,
    });

    await handler.handle({
      type: "message-added",
      source: "wa-web",
      observedAtUtc: "2026-04-30T18:34:42.123Z",
      thread,
      message: {
        externalId: "false_5531982066263@c.us_SAFETY",
        direction: "inbound",
        contentType: "text",
        status: "received",
        body: "Pegou no reconcile",
        displayedAtText: "[15:34, 30/04/2026] Maria: ",
        waDisplayedAt: null,
        timestampPrecision: "unknown",
        messageSecond: null,
        waInferredSecond: 59,
        observedAtUtc: "2026-04-30T18:34:42.123Z",
        raw: { reconcileReason: "hot-window" },
      },
    });

    expect(handler.metrics.safetyNetPickedUp).toBe(1);
  });

  it("stores profile photos as media assets and links contact plus conversation", async () => {
    const repos = createRepositories(db);
    const user = await repos.users.create({
      email: "profile-photo@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const handler = createSyncEventHandler({
      repos,
      logger: pino({ level: "silent" }),
      userId: user.id,
    });
    const sha256 = "a".repeat(64);

    await handler.handle({
      type: "profile-photo-captured",
      source: "wa-web",
      observedAtUtc: "2026-05-05T12:00:00.000Z",
      thread: {
        ...thread,
        externalThreadId: "5531982066263",
        title: "Gabriel Braga Nuoma",
      },
      profilePhoto: {
        fileName: "profile-a.jpg",
        mimeType: "image/jpeg",
        sha256,
        sizeBytes: 2048,
        storagePath: "/tmp/nuoma-profile-a.jpg",
        sourceUrl: null,
      },
      details: {
        captureMode: "test",
      },
    });
    await handler.handle({
      type: "profile-photo-captured",
      source: "wa-web",
      observedAtUtc: "2026-05-05T12:01:00.000Z",
      thread: {
        ...thread,
        externalThreadId: "5531982066263",
        title: "Gabriel Braga Nuoma",
      },
      profilePhoto: {
        fileName: "profile-a-copy.jpg",
        mimeType: "image/jpeg",
        sha256,
        sizeBytes: 2048,
        storagePath: "/tmp/nuoma-profile-a-copy.jpg",
        sourceUrl: null,
      },
    });

    const conversation = await repos.conversations.findByExternalThread({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "5531982066263",
    });
    const contact = await repos.contacts.findByPhone({
      userId: user.id,
      phone: "5531982066263",
    });
    const mediaAssets = await repos.mediaAssets.list({
      userId: user.id,
      sha256,
      includeDeleted: true,
    });

    expect(mediaAssets).toHaveLength(1);
    expect(contact).toMatchObject({
      name: "Gabriel Braga Nuoma",
      profilePhotoMediaAssetId: mediaAssets[0]?.id,
      profilePhotoSha256: sha256,
      profilePhotoUpdatedAt: "2026-05-05T12:01:00.000Z",
    });
    expect(conversation).toMatchObject({
      contactId: contact?.id,
      profilePhotoMediaAssetId: mediaAssets[0]?.id,
      profilePhotoSha256: sha256,
      profilePhotoUpdatedAt: "2026-05-05T12:01:00.000Z",
    });
    expect(handler.metrics.profilePhotosCaptured).toBe(2);
  });

  it("stores visible attachment candidates as media assets linked to the observed message", async () => {
    const repos = createRepositories(db);
    const user = await repos.users.create({
      email: "attachment-candidate@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const handler = createSyncEventHandler({
      repos,
      logger: pino({ level: "silent" }),
      userId: user.id,
    });
    const externalId = "false_5531982066263@c.us_IMG";
    const sha256 = "d".repeat(64);

    await handler.handle({
      type: "message-added",
      source: "wa-web",
      observedAtUtc: "2026-05-05T12:09:00.000Z",
      thread,
      message: {
        externalId,
        direction: "inbound",
        contentType: "image",
        status: "received",
        body: "foto do tratamento",
        displayedAtText: "[09:09, 05/05/2026] Maria: ",
        waDisplayedAt: null,
        timestampPrecision: "unknown",
        messageSecond: null,
        waInferredSecond: 59,
        observedAtUtc: "2026-05-05T12:09:00.000Z",
        raw: { source: "test" },
      },
    });
    const attachmentEvent: SyncEvent = {
      type: "attachment-candidate-captured",
      source: "wa-web",
      observedAtUtc: "2026-05-05T12:10:00.000Z",
      thread,
      attachment: {
        contentType: "image",
        externalMessageId: externalId,
        fileName: "tratamento.jpg",
        mimeType: "image/jpeg",
        sha256,
        sizeBytes: 0,
        durationMs: null,
        storagePath: "wa-visible://" + sha256,
        sourceUrl: null,
        caption: "foto do tratamento",
      },
      details: {
        captureMode: "visible-dom-candidate",
      },
    };

    await handler.handle(attachmentEvent);
    await handler.handle({
      ...attachmentEvent,
      observedAtUtc: "2026-05-05T12:11:00.000Z",
    });

    const conversation = await repos.conversations.findByExternalThread({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: thread.externalThreadId,
    });
    const mediaAssets = await repos.mediaAssets.list({
      userId: user.id,
      sha256,
      includeDeleted: true,
    });
    const candidates = await repos.attachmentCandidates.listByConversation({
      userId: user.id,
      conversationId: conversation?.id ?? 0,
    });
    const message = await repos.messages.findByExternalId({
      userId: user.id,
      conversationId: conversation?.id ?? 0,
      externalId,
    });

    expect(mediaAssets).toHaveLength(1);
    expect(candidates).toEqual([
      expect.objectContaining({
        messageId: message?.id,
        mediaAssetId: mediaAssets[0]?.id,
        contentType: "image",
        externalMessageId: externalId,
        caption: "foto do tratamento",
        observedAt: "2026-05-05T12:11:00.000Z",
      }),
    ]);
    expect(handler.metrics.attachmentCandidatesCaptured).toBe(2);
  });

  it("routes forced phone reconciles into the requested canonical conversation", async () => {
    const repos = createRepositories(db);
    const user = await repos.users.create({
      email: "canonical@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const canonical = await repos.conversations.upsertObserved({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "5531982066263",
      title: "WhatsApp",
      unreadCount: 0,
    });
    const handler = createSyncEventHandler({
      repos,
      logger: pino({ level: "silent" }),
      userId: user.id,
    });

    await handler.handle({
      type: "message-added",
      source: "wa-web",
      observedAtUtc: "2026-04-30T18:45:00.000Z",
      thread: {
        channel: "whatsapp",
        externalThreadId: "Gabriel Braga Nuoma",
        title: "Gabriel Braga Nuoma",
        phone: null,
        unreadCount: 0,
        fingerprint: null,
      },
      message: {
        externalId: "false_5531982066263@c.us_FORCED",
        direction: "inbound",
        contentType: "text",
        status: "received",
        body: "Mensagem após abrir pelo telefone",
        displayedAtText: "[15:45, 30/04/2026] Maria: ",
        waDisplayedAt: null,
        timestampPrecision: "unknown",
        messageSecond: null,
        waInferredSecond: 59,
        observedAtUtc: "2026-04-30T18:45:00.000Z",
        raw: {
          reconcileReason: "sync.forceConversation",
          reconcileDetails: {
            conversationId: canonical.id,
            candidatePhone: "5531982066263",
          },
        },
      },
    });

    const canonicalMessages = await repos.messages.listByConversation({
      userId: user.id,
      conversationId: canonical.id,
    });
    const namedDuplicate = await repos.conversations.findByExternalThread({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "Gabriel Braga Nuoma",
    });
    const updatedCanonical = await repos.conversations.findById({
      userId: user.id,
      id: canonical.id,
    });

    expect(canonicalMessages).toHaveLength(1);
    expect(canonicalMessages[0]?.body).toBe("Mensagem após abrir pelo telefone");
    expect(namedDuplicate).toBeNull();
    expect(updatedCanonical?.title).toBe("Gabriel Braga Nuoma");
    expect(updatedCanonical?.externalThreadId).toBe("5531982066263");
  });

  it("does not route forced phone reconciles into the candidate when the active thread reveals another phone", async () => {
    const repos = createRepositories(db);
    const user = await repos.users.create({
      email: "canonical-mismatch@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const canonical = await repos.conversations.upsertObserved({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "5531982066263",
      title: "Gabriel Braga Nuoma",
      unreadCount: 0,
    });
    const handler = createSyncEventHandler({
      repos,
      logger: pino({ level: "silent" }),
      userId: user.id,
    });

    await handler.handle({
      type: "message-added",
      source: "wa-web",
      observedAtUtc: "2026-05-04T10:38:31.882Z",
      thread: {
        channel: "whatsapp",
        externalThreadId: "553185596476",
        title: "+55 31 8559-6476",
        phone: "553185596476",
        unreadCount: 0,
        fingerprint: null,
      },
      message: {
        externalId: "AC0528809241EBD36655E8335BF15948",
        direction: "inbound",
        contentType: "text",
        status: "received",
        body: "Onde fica a unidade de bh",
        displayedAtText: "[07:38, 04/05/2026] Cliente: ",
        waDisplayedAt: null,
        timestampPrecision: "unknown",
        messageSecond: null,
        waInferredSecond: 59,
        observedAtUtc: "2026-05-04T10:38:31.882Z",
        raw: {
          reconcileReason: "campaign_step:after-send",
          reconcileDetails: {
            conversationId: canonical.id,
            candidatePhone: "5531982066263",
          },
        },
      },
    });

    const canonicalMessages = await repos.messages.listByConversation({
      userId: user.id,
      conversationId: canonical.id,
    });
    const wrongThread = await repos.conversations.findByExternalThread({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "553185596476",
    });
    const wrongThreadMessages = await repos.messages.listByConversation({
      userId: user.id,
      conversationId: wrongThread?.id ?? 0,
    });
    const mismatchEvents = await repos.systemEvents.list({
      userId: user.id,
      type: "sync.reconcile_target_mismatch",
    });

    expect(canonicalMessages).toHaveLength(0);
    expect(wrongThread?.title).toBe("+55 31 8559-6476");
    expect(wrongThreadMessages).toHaveLength(1);
    expect(wrongThreadMessages[0]?.body).toBe("Onde fica a unidade de bh");
    expect(mismatchEvents[0]?.payload).toEqual(
      expect.objectContaining({
        expectedPhone: "5531982066263",
        observedPhone: "553185596476",
      }),
    );
  });

  it("does not route forced phone reconciles into the candidate when the active thread is generic online state", async () => {
    const repos = createRepositories(db);
    const user = await repos.users.create({
      email: "canonical-online@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const canonical = await repos.conversations.upsertObserved({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "5531982066263",
      title: "Gabriel Braga Nuoma",
      unreadCount: 0,
    });
    const handler = createSyncEventHandler({
      repos,
      logger: pino({ level: "silent" }),
      userId: user.id,
    });

    await handler.handle({
      type: "message-added",
      source: "wa-web",
      observedAtUtc: "2026-05-04T10:18:42.170Z",
      thread: {
        channel: "whatsapp",
        externalThreadId: "online",
        title: "online",
        phone: null,
        unreadCount: 0,
        fingerprint: null,
      },
      message: {
        externalId: "3EB0880875BEB2E146393A",
        direction: "outbound",
        contentType: "text",
        status: "sent",
        body: "Teste V2.5 texto real 04/05/2026, 01:09:52",
        displayedAtText: "[07:18, 04/05/2026] Gabriel: ",
        waDisplayedAt: null,
        timestampPrecision: "unknown",
        messageSecond: null,
        waInferredSecond: 59,
        observedAtUtc: "2026-05-04T10:18:42.170Z",
        raw: {
          reconcileReason: "campaign_step:after-send",
          reconcileDetails: {
            conversationId: canonical.id,
            candidatePhone: "5531982066263",
          },
        },
      },
    });

    const canonicalMessages = await repos.messages.listByConversation({
      userId: user.id,
      conversationId: canonical.id,
    });
    const onlineConversation = await repos.conversations.findByExternalThread({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "online",
    });
    const untrustedEvents = await repos.systemEvents.list({
      userId: user.id,
      type: "sync.reconcile_target_untrusted",
    });

    expect(canonicalMessages).toHaveLength(0);
    expect(onlineConversation?.title).toBe("online");
    expect(untrustedEvents[0]?.payload).toEqual(
      expect.objectContaining({
        expectedPhone: "5531982066263",
      }),
    );
  });

  it("does not promote presence text to a conversation title", async () => {
    const repos = createRepositories(db);
    const user = await repos.users.create({
      email: "presence-title@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    await repos.conversations.upsertObserved({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "5531982066263",
      title: "Gabriel Braga Nuoma",
      unreadCount: 0,
    });
    const handler = createSyncEventHandler({
      repos,
      logger: pino({ level: "silent" }),
      userId: user.id,
    });

    await handler.handle({
      type: "message-added",
      source: "wa-web",
      observedAtUtc: "2026-05-05T00:00:00.000Z",
      thread: {
        channel: "whatsapp",
        externalThreadId: "5531982066263",
        title: "visto por último hoje às 20:44",
        phone: "5531982066263",
        unreadCount: 0,
        fingerprint: null,
      },
      message: {
        externalId: "false_5531982066263@c.us_PRESENCE",
        direction: "inbound",
        contentType: "text",
        status: "received",
        body: "Oi",
        displayedAtText: "[21:00, 04/05/2026] Cliente: ",
        waDisplayedAt: null,
        timestampPrecision: "unknown",
        messageSecond: null,
        waInferredSecond: 59,
        observedAtUtc: "2026-05-05T00:00:00.000Z",
        raw: { source: "test" },
      },
    });

    const conversation = await repos.conversations.findByExternalThread({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "5531982066263",
    });

    expect(conversation?.title).toBe("Gabriel Braga Nuoma");
  });

  it("routes passive named-thread events into an existing active canonical conversation", async () => {
    const repos = createRepositories(db);
    const user = await repos.users.create({
      email: "passive-canonical@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const canonical = await repos.conversations.upsertObserved({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "5531982066263",
      title: "Gabriel Braga Nuoma",
      unreadCount: 0,
    });
    const handler = createSyncEventHandler({
      repos,
      logger: pino({ level: "silent" }),
      userId: user.id,
    });

    await handler.handle({
      type: "message-added",
      source: "wa-web",
      observedAtUtc: "2026-05-04T03:14:31.787Z",
      thread: {
        channel: "whatsapp",
        externalThreadId: "Gabriel Braga Nuoma",
        title: "Gabriel Braga Nuoma",
        phone: null,
        unreadCount: 0,
        fingerprint: null,
      },
      message: {
        externalId: "3EB00AAD957956437ABED2",
        direction: "outbound",
        contentType: "audio",
        status: "sent",
        body: null,
        displayedAtText: "[13:45, 04/05/2026] Gabriel: ",
        waDisplayedAt: null,
        timestampPrecision: "unknown",
        messageSecond: null,
        waInferredSecond: 59,
        observedAtUtc: "2026-05-04T03:14:31.787Z",
        raw: {
          reconcileReason: null,
          reconcileDetails: null,
        },
      },
    });

    const canonicalMessages = await repos.messages.listByConversation({
      userId: user.id,
      conversationId: canonical.id,
    });
    const namedDuplicate = await repos.conversations.findByExternalThread({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "Gabriel Braga Nuoma",
    });

    expect(canonicalMessages).toHaveLength(1);
    expect(canonicalMessages[0]?.externalId).toBe("3EB00AAD957956437ABED2");
    expect(namedDuplicate).toBeNull();
  });

  it("does not overwrite a canonical title with generic WhatsApp titles", async () => {
    const repos = createRepositories(db);
    const user = await repos.users.create({
      email: "generic-title@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const canonical = await repos.conversations.upsertObserved({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "5531982066263",
      title: "Gabriel Braga Nuoma",
      unreadCount: 0,
    });
    const handler = createSyncEventHandler({
      repos,
      logger: pino({ level: "silent" }),
      userId: user.id,
    });

    await handler.handle({
      type: "reconcile-snapshot",
      source: "wa-web",
      observedAtUtc: "2026-05-04T03:14:31.787Z",
      thread: {
        channel: "whatsapp",
        externalThreadId: "WhatsApp",
        title: "WhatsApp",
        phone: null,
        unreadCount: 0,
        fingerprint: null,
      },
      details: {
        conversationId: canonical.id,
        candidatePhone: "5531982066263",
      },
    });

    const updatedCanonical = await repos.conversations.findById({
      userId: user.id,
      id: canonical.id,
    });

    expect(updatedCanonical?.title).toBe("Gabriel Braga Nuoma");
  });

  it("preserves existing titles when same-thread events have generic WhatsApp titles", async () => {
    const repos = createRepositories(db);
    const user = await repos.users.create({
      email: "same-thread-generic-title@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const existing = await repos.conversations.upsertObserved({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "5531982066263",
      title: "Gabriel Braga Nuoma",
      unreadCount: 0,
    });
    const handler = createSyncEventHandler({
      repos,
      logger: pino({ level: "silent" }),
      userId: user.id,
    });

    await handler.handle({
      type: "reconcile-snapshot",
      source: "wa-web",
      observedAtUtc: "2026-05-04T03:18:00.000Z",
      thread: {
        channel: "whatsapp",
        externalThreadId: "5531982066263",
        title: "WhatsApp",
        phone: null,
        unreadCount: 0,
        fingerprint: null,
      },
      details: {},
    });

    const updated = await repos.conversations.findById({
      userId: user.id,
      id: existing.id,
    });

    expect(updated?.title).toBe("Gabriel Braga Nuoma");
  });
});
