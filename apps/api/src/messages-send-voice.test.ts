import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import argon2 from "argon2";
import type { FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";

import { loadApiEnv } from "@nuoma/config";
import { createRepositories, openDb, runMigrations } from "@nuoma/db";

import { buildApiApp } from "./app.js";

const testAllowedPhone = "31982066263";

function cookieHeader(setCookie: string | string[] | undefined): string {
  if (!setCookie) return "";
  const list = Array.isArray(setCookie) ? setCookie : [setCookie];
  return list.map((cookie) => cookie.split(";")[0]).join("; ");
}

interface TrpcResult<T> {
  statusCode: number;
  data?: T;
  error?: { message?: string };
  setCookie?: string | string[];
}

async function trpcCall<T = unknown>(
  app: FastifyInstance,
  method: "GET" | "POST",
  procedure: string,
  input: unknown,
  options: { cookie?: string; csrfToken?: string } = {},
): Promise<TrpcResult<T>> {
  const headers: Record<string, string> = {};
  if (options.cookie) headers.cookie = options.cookie;
  if (options.csrfToken) headers["x-csrf-token"] = options.csrfToken;

  let url = `/trpc/${procedure}`;
  let payload: Record<string, unknown> | undefined;
  if (method === "GET") {
    if (input !== undefined) {
      url = `${url}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
    }
  } else {
    headers["content-type"] = "application/json";
    payload = input === undefined ? {} : { json: input };
  }

  const response = await app.inject({
    method,
    url,
    headers,
    ...(payload === undefined ? {} : { payload }),
  });
  const body = response.json() as {
    result?: { data?: { json?: T } };
    error?: { json?: TrpcResult<T>["error"] };
  };
  const setCookieHeader = response.headers["set-cookie"];
  return {
    statusCode: response.statusCode,
    data: body.result?.data?.json,
    error: body.error?.json,
    setCookie:
      typeof setCookieHeader === "string" || Array.isArray(setCookieHeader)
        ? setCookieHeader
        : undefined,
  };
}

describe("messages.sendVoice", () => {
  it("exposes Instagram session and sync queue routes", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nuoma-ig-routes-"));
    const dbPath = path.join(tempDir, "api.db");
    const db = openDb(dbPath);
    await runMigrations(db);
    const repos = createRepositories(db);
    await repos.users.create({
      email: "admin@nuoma.local",
      passwordHash: await argon2.hash("initial-password-123", { type: argon2.argon2id }),
      role: "admin",
      displayName: "Admin",
    });
    await repos.workerState.heartbeat({
      workerId: "worker-local-1",
      status: "idle",
      browserConnected: true,
      metrics: {
        instagram: {
          connected: true,
          lastSyncAt: "2026-05-29T00:00:00.000Z",
          session: {
            mode: "shared-cdp",
            status: "connected",
            authenticated: true,
            username: "gabriell_braga",
            pageUrl: "https://www.instagram.com/direct/inbox/",
            browserEndpoint: "http://127.0.0.1:9223",
            lastCheckedAt: "2026-05-29T00:00:00.000Z",
            lastSyncAt: "2026-05-29T00:00:00.000Z",
            threadCount: 2,
            messageCount: 7,
            errorMessage: null,
          },
        },
      },
    });
    const app = await buildApiApp({
      env: loadApiEnv({
        API_LOG_LEVEL: "silent",
        NODE_ENV: "test",
        API_JWT_SECRET: "test-secret-with-more-than-16-chars",
        API_SEND_ALLOWED_PHONES: testAllowedPhone,
        DATABASE_URL: dbPath,
      }),
      db,
      migrate: false,
    });

    try {
      const session = await app.inject({ method: "GET", url: "/instagram/session" });
      expect(session.statusCode).toBe(200);
      expect(session.json()).toMatchObject({
        status: "connected",
        authenticated: true,
        username: "gabriell_braga",
        threadCount: 2,
        messageCount: 7,
      });

      const sync = await app.inject({
        method: "POST",
        url: "/instagram/sync",
        payload: { threadLimit: 3, messagesLimit: 9, scrollPasses: 2 },
      });
      expect(sync.statusCode).toBe(200);
      expect(sync.json()).toMatchObject({
        queued: true,
        requested: { threadLimit: 3, messagesLimit: 9, scrollPasses: 2 },
        job: {
          type: "sync_inbox_force",
          status: "queued",
          payload: {
            channel: "instagram",
            threadLimit: 3,
            messagesLimit: 9,
            scrollPasses: 2,
            source: "api.instagram.sync",
          },
        },
      });
    } finally {
      await app.close();
      db.close();
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }, 15_000);

  it("enqueues a guarded send_voice job from a recorded media asset", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nuoma-v29-voice-api-"));
    const dbPath = path.join(tempDir, "api.db");
    const db = openDb(dbPath);
    await runMigrations(db);
    const repos = createRepositories(db);
    const passwordHash = await argon2.hash("initial-password-123", { type: argon2.argon2id });
    const user = await repos.users.create({
      email: "admin@nuoma.local",
      passwordHash,
      role: "admin",
      displayName: "Admin",
    });
    const conversation = await repos.conversations.create({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "5531982066263",
      title: "V2.9.13 Voice API",
    });
    const blockedConversation = await repos.conversations.create({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "553100009913",
      title: "V2.9.13 Blocked Voice API",
    });
    const audioPath = path.join(tempDir, "recorded.webm");
    const audioBytes = Buffer.from("nuoma-v29-voice-recorder");
    await fs.writeFile(audioPath, audioBytes);
    const mediaAsset = await repos.mediaAssets.create({
      userId: user.id,
      type: "voice",
      fileName: "recorded.webm",
      mimeType: "audio/webm;codecs=opus",
      sha256: createHash("sha256").update(audioBytes).digest("hex"),
      sizeBytes: audioBytes.byteLength,
      durationMs: 1250,
      storagePath: audioPath,
      sourceUrl: null,
      deletedAt: null,
    });

    const app = await buildApiApp({
      env: loadApiEnv({
        API_LOG_LEVEL: "silent",
        NODE_ENV: "test",
        API_JWT_SECRET: "test-secret-with-more-than-16-chars",
        API_SEND_ALLOWED_PHONES: testAllowedPhone,
        DATABASE_URL: dbPath,
      }),
      db,
      migrate: false,
    });

    try {
      const login = await trpcCall<{ csrfToken: string }>(app, "POST", "auth.login", {
        email: "admin@nuoma.local",
        password: "initial-password-123",
      });
      const cookies = cookieHeader(login.setCookie);
      const csrfToken = login.data!.csrfToken;

      const sendVoice = await trpcCall<{
        job: {
          id: number;
          type: string;
          status: string;
          priority: number;
          payload: Record<string, unknown>;
        };
      }>(
        app,
        "POST",
        "messages.sendVoice",
        {
          conversationId: conversation.id,
          mediaAssetId: mediaAsset.id,
          clientNonce: "composer:voice:test-nonce",
        },
        { cookie: cookies, csrfToken },
      );
      expect(sendVoice.statusCode, JSON.stringify(sendVoice.error)).toBe(200);
      expect(sendVoice.data?.job).toMatchObject({
        type: "send_voice",
        status: "queued",
        priority: 4,
        payload: {
          conversationId: conversation.id,
          phone: "5531982066263",
          audioPath,
          mediaAssetId: mediaAsset.id,
          source: "inbox.voice_recorder",
          clientNonce: "composer:voice:test-nonce",
        },
      });

      const blocked = await trpcCall(
        app,
        "POST",
        "messages.sendVoice",
        { conversationId: blockedConversation.id, mediaAssetId: mediaAsset.id },
        { cookie: cookies, csrfToken },
      );
      expect(blocked.statusCode).toBe(400);
      expect(blocked.error?.message).toContain("Envio bloqueado pela allowlist da API");

      const blockedText = await trpcCall(
        app,
        "POST",
        "messages.send",
        { conversationId: blockedConversation.id, body: "nao deve enfileirar" },
        { cookie: cookies, csrfToken },
      );
      expect(blockedText.statusCode).toBe(400);
      expect(blockedText.error?.message).toContain("Envio bloqueado pela allowlist da API");
    } finally {
      await app.close();
      db.close();
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("enqueues guarded media jobs for composer image and document assets", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nuoma-v29-media-api-"));
    const dbPath = path.join(tempDir, "api.db");
    const db = openDb(dbPath);
    await runMigrations(db);
    const repos = createRepositories(db);
    const passwordHash = await argon2.hash("initial-password-123", { type: argon2.argon2id });
    const user = await repos.users.create({
      email: "admin@nuoma.local",
      passwordHash,
      role: "admin",
      displayName: "Admin",
    });
    const conversation = await repos.conversations.create({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "5531982066263",
      title: "V2.9.12 Media API",
    });
    const instagramContact = await repos.contacts.create({
      userId: user.id,
      name: "Gabriel IG",
      phone: null,
      email: null,
      primaryChannel: "instagram",
      instagramHandle: "gabriell_braga",
      status: "lead",
      notes: null,
    });
    const instagramConversation = await repos.conversations.create({
      userId: user.id,
      contactId: instagramContact.id,
      channel: "instagram",
      externalThreadId: "110051807055981",
      title: "Gabriel IG",
    });
    const imagePath = path.join(tempDir, "before.jpg");
    const imageBytes = Buffer.from("nuoma-v29-image");
    await fs.writeFile(imagePath, imageBytes);
    const imageAsset = await repos.mediaAssets.create({
      userId: user.id,
      type: "image",
      fileName: "before.jpg",
      mimeType: "image/jpeg",
      sha256: createHash("sha256").update(imageBytes).digest("hex"),
      sizeBytes: imageBytes.byteLength,
      durationMs: null,
      storagePath: imagePath,
      sourceUrl: null,
      deletedAt: null,
    });
    const documentPath = path.join(tempDir, "terms.pdf");
    const documentBytes = Buffer.from("nuoma-v29-document");
    await fs.writeFile(documentPath, documentBytes);
    const documentAsset = await repos.mediaAssets.create({
      userId: user.id,
      type: "document",
      fileName: "terms.pdf",
      mimeType: "application/pdf",
      sha256: createHash("sha256").update(documentBytes).digest("hex"),
      sizeBytes: documentBytes.byteLength,
      durationMs: null,
      storagePath: documentPath,
      sourceUrl: null,
      deletedAt: null,
    });
    const audioPath = path.join(tempDir, "audio.ogg");
    const audioBytes = Buffer.from("nuoma-v29-audio");
    await fs.writeFile(audioPath, audioBytes);
    const audioAsset = await repos.mediaAssets.create({
      userId: user.id,
      type: "audio",
      fileName: "audio.ogg",
      mimeType: "audio/ogg",
      sha256: createHash("sha256").update(audioBytes).digest("hex"),
      sizeBytes: audioBytes.byteLength,
      durationMs: 1000,
      storagePath: audioPath,
      sourceUrl: null,
      deletedAt: null,
    });

    const app = await buildApiApp({
      env: loadApiEnv({
        API_LOG_LEVEL: "silent",
        NODE_ENV: "test",
        API_JWT_SECRET: "test-secret-with-more-than-16-chars",
        API_SEND_ALLOWED_PHONES: testAllowedPhone,
        DATABASE_URL: dbPath,
      }),
      db,
      migrate: false,
    });

    try {
      const login = await trpcCall<{ csrfToken: string }>(app, "POST", "auth.login", {
        email: "admin@nuoma.local",
        password: "initial-password-123",
      });
      const cookies = cookieHeader(login.setCookie);
      const csrfToken = login.data!.csrfToken;

      const blockedInstagramText = await trpcCall(
        app,
        "POST",
        "messages.send",
        {
          conversationId: instagramConversation.id,
          body: "DM fora da janela",
          clientNonce: "composer:ig-text:no-window",
        },
        { cookie: cookies, csrfToken },
      );
      expect(blockedInstagramText.statusCode).toBe(400);
      expect(blockedInstagramText.error?.message).toContain("no inbound message found");

      const blockedInstagramImage = await trpcCall(
        app,
        "POST",
        "messages.sendMedia",
        {
          conversationId: instagramConversation.id,
          mediaAssetId: imageAsset.id,
          caption: "Foto IG fora da janela",
          clientNonce: "composer:ig-media:no-window",
        },
        { cookie: cookies, csrfToken },
      );
      expect(blockedInstagramImage.statusCode).toBe(400);
      expect(blockedInstagramImage.error?.message).toContain("no inbound message found");

      const latestAudit = await repos.sendAuditEvents.list({
        userId: user.id,
        conversationId: instagramConversation.id,
        phase: "policy_block",
        limit: 2,
      });
      expect(latestAudit).toHaveLength(2);
      expect(latestAudit[0]).toMatchObject({
        channel: "instagram",
        errorCode: "instagram_24h_window_missing",
      });

      await repos.messages.create({
        userId: user.id,
        conversationId: instagramConversation.id,
        contactId: instagramContact.id,
        externalId: "ig-inbound-window",
        direction: "inbound",
        contentType: "text",
        status: "received",
        body: "Oi pelo Instagram",
        observedAtUtc: new Date().toISOString(),
      });

      const scheduledOutsideWindow = await trpcCall(
        app,
        "POST",
        "messages.send",
        {
          conversationId: instagramConversation.id,
          body: "DM agendada fora da janela",
          scheduledAt: new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString(),
          clientNonce: "composer:ig-text:scheduled-outside-window",
        },
        { cookie: cookies, csrfToken },
      );
      expect(scheduledOutsideWindow.statusCode).toBe(400);
      expect(scheduledOutsideWindow.error?.message).toContain("outside the 24h window");

      const sendImage = await trpcCall<{
        job: {
          type: string;
          status: string;
          priority: number;
          payload: Record<string, unknown>;
        };
      }>(
        app,
        "POST",
        "messages.sendMedia",
        {
          conversationId: conversation.id,
          mediaAssetId: imageAsset.id,
          caption: "Foto antes/depois",
          clientNonce: "composer:media:test-nonce",
        },
        { cookie: cookies, csrfToken },
      );
      expect(sendImage.statusCode, JSON.stringify(sendImage.error)).toBe(200);
      expect(sendImage.data?.job).toMatchObject({
        type: "send_media",
        status: "queued",
        priority: 4,
        payload: {
          conversationId: conversation.id,
          phone: "5531982066263",
          mediaAssetId: imageAsset.id,
          mediaType: "image",
          caption: "Foto antes/depois",
          source: "inbox.composer",
          clientNonce: "composer:media:test-nonce",
        },
      });

      const sendDocument = await trpcCall<{
        job: {
          type: string;
          status: string;
          priority: number;
          payload: Record<string, unknown>;
        };
      }>(
        app,
        "POST",
        "messages.sendMedia",
        {
          conversationId: conversation.id,
          mediaAssetId: documentAsset.id,
          caption: "Termos",
          clientNonce: "composer:document:test-nonce",
        },
        { cookie: cookies, csrfToken },
      );
      expect(sendDocument.statusCode, JSON.stringify(sendDocument.error)).toBe(200);
      expect(sendDocument.data?.job).toMatchObject({
        type: "send_document",
        status: "queued",
        priority: 4,
        payload: {
          conversationId: conversation.id,
          phone: "5531982066263",
          mediaAssetId: documentAsset.id,
          mediaType: "document",
          caption: "Termos",
          source: "inbox.composer",
          clientNonce: "composer:document:test-nonce",
        },
      });

      const sendInstagramImage = await trpcCall<{
        job: {
          type: string;
          status: string;
          priority: number;
          payload: Record<string, unknown>;
        };
      }>(
        app,
        "POST",
        "messages.sendMedia",
        {
          conversationId: instagramConversation.id,
          mediaAssetId: imageAsset.id,
          caption: "Foto IG",
          clientNonce: "composer:ig-media:test-nonce",
        },
        { cookie: cookies, csrfToken },
      );
      expect(sendInstagramImage.statusCode, JSON.stringify(sendInstagramImage.error)).toBe(200);
      expect(sendInstagramImage.data?.job).toMatchObject({
        type: "send_instagram_message",
        status: "queued",
        priority: 4,
        payload: {
          conversationId: instagramConversation.id,
          phone: null,
          instagramHandle: "gabriell_braga",
          body: "Foto IG",
          mediaAssetId: imageAsset.id,
          mediaType: "image",
          caption: "Foto IG",
          source: "inbox.composer",
          clientNonce: "composer:ig-media:test-nonce",
        },
      });

      const sendInstagramDocument = await trpcCall(
        app,
        "POST",
        "messages.sendMedia",
        {
          conversationId: instagramConversation.id,
          mediaAssetId: documentAsset.id,
          caption: "Termos IG",
          clientNonce: "composer:ig-document:test-nonce",
        },
        { cookie: cookies, csrfToken },
      );
      expect(sendInstagramDocument.statusCode).toBe(400);
      expect(sendInstagramDocument.error?.message).toMatch(/image and video/i);

      const sendInstagramAudio = await trpcCall(
        app,
        "POST",
        "messages.sendMedia",
        {
          conversationId: instagramConversation.id,
          mediaAssetId: audioAsset.id,
          caption: "Audio IG",
          clientNonce: "composer:ig-audio:test-nonce",
        },
        { cookie: cookies, csrfToken },
      );
      expect(sendInstagramAudio.statusCode).toBe(400);
      expect(sendInstagramAudio.error?.message).toMatch(/Unsupported composer media type: audio/i);
    } finally {
      await app.close();
      db.close();
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }, 15_000);
});
