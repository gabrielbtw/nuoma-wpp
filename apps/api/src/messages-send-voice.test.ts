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
        { conversationId: conversation.id, mediaAssetId: mediaAsset.id },
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

    const app = await buildApiApp({
      env: loadApiEnv({
        API_LOG_LEVEL: "silent",
        NODE_ENV: "test",
        API_JWT_SECRET: "test-secret-with-more-than-16-chars",
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
        },
      });
    } finally {
      await app.close();
      db.close();
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
