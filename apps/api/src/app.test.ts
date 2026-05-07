import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import argon2 from "argon2";
import type { FastifyInstance } from "fastify";
import { describe, expect, it, vi } from "vitest";

import { loadApiEnv } from "@nuoma/config";
import { createRepositories, openDb, runMigrations } from "@nuoma/db";

import { buildApiApp } from "./app.js";

function cookieHeader(setCookie: string | string[] | undefined): string {
  if (!setCookie) return "";
  const list = Array.isArray(setCookie) ? setCookie : [setCookie];
  return list.map((cookie) => cookie.split(";")[0]).join("; ");
}

function multipartPayload(input: {
  boundary: string;
  fields?: Record<string, string>;
  file: { fieldName: string; fileName: string; contentType: string; body: Buffer };
}): Buffer {
  const chunks: Buffer[] = [];
  for (const [name, value] of Object.entries(input.fields ?? {})) {
    chunks.push(
      Buffer.from(
        `--${input.boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  chunks.push(
    Buffer.from(
      `--${input.boundary}\r\nContent-Disposition: form-data; name="${input.file.fieldName}"; filename="${input.file.fileName}"\r\nContent-Type: ${input.file.contentType}\r\n\r\n`,
    ),
    input.file.body,
    Buffer.from(`\r\n--${input.boundary}--\r\n`),
  );
  return Buffer.concat(chunks);
}

interface TrpcResult<T> {
  statusCode: number;
  data?: T;
  error?: { code?: string; message?: string; data?: { code?: string; httpStatus?: number } };
  setCookie?: string | string[];
}

interface SseEvent {
  event: string;
  data: Record<string, unknown>;
}

interface SseReadState {
  buffer: string;
}

interface SseReader {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
  cancel(): Promise<unknown>;
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
      const encoded = encodeURIComponent(JSON.stringify({ json: input }));
      url = `${url}?input=${encoded}`;
    }
  } else {
    headers["content-type"] = "application/json";
    payload = input === undefined ? {} : { json: input as unknown };
  }

  const response = await app.inject({
    method,
    url,
    headers,
    ...(payload === undefined ? {} : { payload }),
  });
  let body: unknown;
  try {
    body = response.json() as unknown;
  } catch {
    body = undefined;
  }
  const errorWrapper = (body as { error?: { json?: TrpcResult<T>["error"] } })?.error;
  const data = (body as { result?: { data?: { json?: T } } })?.result?.data?.json;

  const setCookieHeader = response.headers["set-cookie"];
  return {
    statusCode: response.statusCode,
    data: data as T | undefined,
    error: errorWrapper?.json,
    setCookie:
      typeof setCookieHeader === "string" || Array.isArray(setCookieHeader)
        ? setCookieHeader
        : undefined,
  };
}

async function readUntilSseEvent(
  reader: SseReader,
  state: SseReadState,
  eventName: string,
  timeoutMs = 7_000,
): Promise<SseEvent> {
  let timeoutId: NodeJS.Timeout | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`Timed out waiting for SSE ${eventName}`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([readUntilSseEventInner(reader, state, eventName), timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function readUntilSseEventInner(
  reader: SseReader,
  state: SseReadState,
  eventName: string,
): Promise<SseEvent> {
  while (true) {
    const event = await readNextSseEvent(reader, state);
    if (event.event === eventName) {
      return event;
    }
  }
}

async function readNextSseEvent(reader: SseReader, state: SseReadState): Promise<SseEvent> {
  const decoder = new TextDecoder();
  while (true) {
    const boundary = state.buffer.indexOf("\n\n");
    if (boundary >= 0) {
      const block = state.buffer.slice(0, boundary);
      state.buffer = state.buffer.slice(boundary + 2);
      const parsed = parseSseBlock(block);
      if (parsed) {
        return parsed;
      }
      continue;
    }

    const result = await reader.read();
    if (result.done) {
      throw new Error("SSE stream closed before expected event");
    }
    state.buffer += decoder.decode(result.value ?? new Uint8Array(), { stream: true });
  }
}

function parseSseBlock(block: string): SseEvent | null {
  let event = "";
  const dataLines: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trim());
    }
  }
  if (!event) {
    return null;
  }
  return {
    event,
    data: dataLines.length > 0 ? (JSON.parse(dataLines.join("\n")) as Record<string, unknown>) : {},
  };
}

describe("api health", () => {
  it("returns the V2 health payload", async () => {
    const app = await buildApiApp({
      env: loadApiEnv({
        API_LOG_LEVEL: "silent",
        NODE_ENV: "test",
        API_JWT_SECRET: "test-secret-with-more-than-16-chars",
        DATABASE_URL: ":memory:",
      }),
    });

    const response = await app.inject({ method: "GET", url: "/health" });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      service: "nuoma-wpp-v2-api",
      version: "0.1.0",
    });

    await app.close();
  });

  it("streams V2.9.3 inbox message-added events and supports realtime reorder", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nuoma-v2-api-sse-"));
    const db = openDb(path.join(tempDir, "api.db"));
    await runMigrations(db);
    const repos = createRepositories(db);
    const passwordHash = await argon2.hash("initial-password-123", { type: argon2.argon2id });
    const user = await repos.users.create({
      email: "admin@nuoma.local",
      passwordHash,
      role: "admin",
      displayName: "Admin",
    });
    const newest = await repos.conversations.create({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "5531982066200",
      title: "Conversa nova",
      lastMessageAt: "2026-05-04T12:00:00.000Z",
      lastPreview: "topo inicial",
      unreadCount: 0,
    });
    const older = await repos.conversations.create({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "5531982066201",
      title: "Conversa que sobe",
      lastMessageAt: "2026-05-04T11:00:00.000Z",
      lastPreview: "base inicial",
      unreadCount: 0,
    });
    const app = await buildApiApp({
      env: loadApiEnv({
        API_LOG_LEVEL: "silent",
        NODE_ENV: "test",
        API_JWT_SECRET: "test-secret-with-more-than-16-chars",
        DATABASE_URL: path.join(tempDir, "api.db"),
      }),
      db,
      migrate: false,
    });
    let reader: SseReader | null = null;
    const controller = new AbortController();

    try {
      const login = await trpcCall(app, "POST", "auth.login", {
        email: "admin@nuoma.local",
        password: "initial-password-123",
      });
      const cookies = cookieHeader(login.setCookie);
      expect(cookies).toContain("nuoma_access=");

      await app.listen({ host: "127.0.0.1", port: 0 });
      const address = app.server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected Fastify to listen on a TCP address");
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const response = await fetch(`${baseUrl}/api/inbox/events`, {
        headers: {
          cookie: cookies,
          origin: "http://127.0.0.1:3002",
        },
        signal: controller.signal,
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/event-stream");
      expect(response.headers.get("access-control-allow-credentials")).toBe("true");
      if (!response.body) {
        throw new Error("Expected SSE response body");
      }
      reader = response.body.getReader() as SseReader;
      const streamState: SseReadState = { buffer: "" };

      const ready = await readUntilSseEvent(reader, streamState, "inbox-ready");
      expect(ready.data).toMatchObject({
        conversationCount: 2,
        pollMs: 2_000,
      });

      await repos.conversations.update({
        userId: user.id,
        id: older.id,
        lastMessageAt: "2026-05-04T12:10:00.000Z",
        lastPreview: "mensagem nova via SSE",
        unreadCount: 3,
      });

      const event = await readUntilSseEvent(reader, streamState, "message-added");
      expect(event.data).toMatchObject({
        conversationId: older.id,
        channel: "whatsapp",
        title: "Conversa que sobe",
        lastMessageAt: "2026-05-04T12:10:00.000Z",
        preview: "mensagem nova via SSE",
        unreadCount: 3,
        previousRank: 1,
        nextRank: 0,
      });

      const reordered = await repos.conversations.list(user.id, 10);
      expect(reordered.map((conversation) => conversation.id)).toEqual([older.id, newest.id]);
    } finally {
      controller.abort();
      if (reader) {
        await reader.cancel().catch(() => undefined);
      }
      await app.close();
      db.close();
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("streams V2.13 global events by channel with cursor support", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nuoma-v2-api-global-events-"));
    const db = openDb(path.join(tempDir, "api.db"));
    await runMigrations(db);
    const repos = createRepositories(db);
    const passwordHash = await argon2.hash("initial-password-123", { type: argon2.argon2id });
    const user = await repos.users.create({
      email: "admin@nuoma.local",
      passwordHash,
      role: "admin",
      displayName: "Admin",
    });
    await repos.systemEvents.create({
      userId: user.id,
      type: "sync.dom_changed",
      severity: "warn",
      payload: JSON.stringify({ reason: "cursor-test" }),
    });
    const conversation = await repos.conversations.create({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "5531982066263",
      title: "Gabriel",
      lastMessageAt: "2026-05-04T12:00:00.000Z",
      lastPreview: "inicio",
      unreadCount: 0,
    });
    const app = await buildApiApp({
      env: loadApiEnv({
        API_LOG_LEVEL: "silent",
        NODE_ENV: "test",
        API_JWT_SECRET: "test-secret-with-more-than-16-chars",
        DATABASE_URL: path.join(tempDir, "api.db"),
      }),
      db,
      migrate: false,
    });
    let reader: SseReader | null = null;
    const controller = new AbortController();

    try {
      const login = await trpcCall(app, "POST", "auth.login", {
        email: "admin@nuoma.local",
        password: "initial-password-123",
      });
      const cookies = cookieHeader(login.setCookie);
      expect(cookies).toContain("nuoma_access=");

      await app.listen({ host: "127.0.0.1", port: 0 });
      const address = app.server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected Fastify to listen on a TCP address");
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const response = await fetch(
        `${baseUrl}/api/events?channels=system,inbox&sinceSystemEventId=0`,
        {
          headers: {
            cookie: cookies,
            origin: "http://127.0.0.1:3002",
          },
          signal: controller.signal,
        },
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/event-stream");
      if (!response.body) {
        throw new Error("Expected SSE response body");
      }
      reader = response.body.getReader() as SseReader;
      const streamState: SseReadState = { buffer: "" };

      const ready = await readUntilSseEvent(reader, streamState, "events-ready");
      expect(ready.data).toMatchObject({
        channels: ["system", "inbox"],
        conversationCount: 1,
        pollMs: 2_000,
      });

      const systemEvent = await readUntilSseEvent(reader, streamState, "nuoma-event");
      expect(systemEvent.data).toMatchObject({
        channel: "system",
        type: "sync.dom_changed",
        payload: {
          severity: "warn",
          payload: { reason: "cursor-test" },
        },
      });

      await repos.conversations.update({
        userId: user.id,
        id: conversation.id,
        lastMessageAt: "2026-05-04T12:20:00.000Z",
        lastPreview: "global stream",
        unreadCount: 2,
      });

      const inboxEvent = await readUntilSseEvent(reader, streamState, "nuoma-event");
      expect(inboxEvent.data).toMatchObject({
        channel: "inbox",
        type: "message-added",
        payload: {
          conversationId: conversation.id,
          preview: "global stream",
          unreadCount: 2,
          previousRank: 0,
          nextRank: 0,
        },
      });
    } finally {
      controller.abort();
      if (reader) {
        await reader.cancel().catch(() => undefined);
      }
      await app.close();
      db.close();
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("supports login, me, refresh and change-password via tRPC", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nuoma-v2-api-"));
    const db = openDb(path.join(tempDir, "api.db"));
    await runMigrations(db);
    const repos = createRepositories(db);
    const passwordHash = await argon2.hash("initial-password-123", { type: argon2.argon2id });
    await repos.users.create({
      email: "admin@nuoma.local",
      passwordHash,
      role: "admin",
      displayName: "Admin",
    });

    const app = await buildApiApp({
      env: loadApiEnv({
        API_LOG_LEVEL: "silent",
        NODE_ENV: "test",
        API_JWT_SECRET: "test-secret-with-more-than-16-chars",
        DATABASE_URL: path.join(tempDir, "api.db"),
      }),
      db,
      migrate: false,
    });

    try {
      const login = await trpcCall<{
        user: { email: string; role: string };
        csrfToken: string;
      }>(app, "POST", "auth.login", {
        email: "admin@nuoma.local",
        password: "initial-password-123",
      });
      expect(login.statusCode).toBe(200);
      expect(login.data?.user.email).toBe("admin@nuoma.local");
      expect(login.data?.csrfToken.length).toBeGreaterThanOrEqual(43);
      const cookies = cookieHeader(login.setCookie);

      const me = await trpcCall<{ user: { role: string } }>(app, "GET", "auth.me", undefined, {
        cookie: cookies,
      });
      expect(me.statusCode).toBe(200);
      expect(me.data?.user.role).toBe("admin");

      const refreshed = await trpcCall<{ csrfToken: string }>(
        app,
        "POST",
        "auth.refresh",
        undefined,
        { cookie: cookies },
      );
      expect(refreshed.statusCode).toBe(200);
      const refreshedCookies = cookieHeader(refreshed.setCookie);
      const refreshedCsrf = refreshed.data!.csrfToken;

      const changed = await trpcCall<{ ok: true }>(
        app,
        "POST",
        "auth.changePassword",
        {
          currentPassword: "initial-password-123",
          newPassword: "changed-password-123",
        },
        { cookie: refreshedCookies, csrfToken: refreshedCsrf },
      );
      expect(changed.statusCode).toBe(200);

      const relogin = await trpcCall(app, "POST", "auth.login", {
        email: "admin@nuoma.local",
        password: "changed-password-123",
      });
      expect(relogin.statusCode).toBe(200);
    } finally {
      await app.close();
      db.close();
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("creates, lists and completes small reminders via tRPC", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nuoma-v2-api-reminders-"));
    const db = openDb(path.join(tempDir, "api.db"));
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
      title: "Gabriel WhatsApp",
    });

    const app = await buildApiApp({
      env: loadApiEnv({
        API_LOG_LEVEL: "silent",
        NODE_ENV: "test",
        API_JWT_SECRET: "test-secret-with-more-than-16-chars",
        DATABASE_URL: path.join(tempDir, "api.db"),
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

      const create = await trpcCall<{
        reminder: { id: number; title: string; dueAt: string; status: string };
      }>(
        app,
        "POST",
        "reminders.create",
        {
          conversationId: conversation.id,
          title: "Retornar com proposta",
          notes: "Lembrete criado no smoke da V2.9.25",
          dueAt: "2026-05-05T13:30:00.000Z",
        },
        { cookie: cookies, csrfToken },
      );
      expect(create.statusCode, JSON.stringify(create.error)).toBe(200);
      expect(create.data?.reminder).toMatchObject({
        title: "Retornar com proposta",
        dueAt: "2026-05-05T13:30:00.000Z",
        status: "open",
      });

      const list = await trpcCall<{ reminders: Array<{ id: number; status: string }> }>(
        app,
        "GET",
        "reminders.list",
        { conversationId: conversation.id, status: "open" },
        { cookie: cookies },
      );
      expect(list.data?.reminders).toEqual([
        expect.objectContaining({ id: create.data!.reminder.id, status: "open" }),
      ]);

      const complete = await trpcCall<{
        reminder: { id: number; status: string; completedAt: string | null };
      }>(
        app,
        "POST",
        "reminders.complete",
        { id: create.data!.reminder.id },
        { cookie: cookies, csrfToken },
      );
      expect(complete.data?.reminder).toMatchObject({
        id: create.data!.reminder.id,
        status: "done",
        completedAt: expect.any(String),
      });
    } finally {
      await app.close();
      db.close();
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("creates, lists, uses and soft-deletes quick replies via tRPC", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nuoma-v2-api-quick-replies-"));
    const db = openDb(path.join(tempDir, "api.db"));
    await runMigrations(db);
    const repos = createRepositories(db);
    const passwordHash = await argon2.hash("initial-password-123", { type: argon2.argon2id });
    await repos.users.create({
      email: "admin@nuoma.local",
      passwordHash,
      role: "admin",
      displayName: "Admin",
    });

    const app = await buildApiApp({
      env: loadApiEnv({
        API_LOG_LEVEL: "silent",
        NODE_ENV: "test",
        API_JWT_SECRET: "test-secret-with-more-than-16-chars",
        DATABASE_URL: path.join(tempDir, "api.db"),
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

      const create = await trpcCall<{
        quickReply: { id: number; title: string; body: string; shortcut: string | null };
      }>(
        app,
        "POST",
        "quickReplies.create",
        {
          title: "Orçamento padrão",
          body: "Te envio o orçamento completo ainda hoje.",
          shortcut: "orcamento",
          category: "Comercial",
        },
        { cookie: cookies, csrfToken },
      );
      expect(create.statusCode, JSON.stringify(create.error)).toBe(200);
      expect(create.data?.quickReply).toMatchObject({
        title: "Orçamento padrão",
        body: "Te envio o orçamento completo ainda hoje.",
        shortcut: "orcamento",
      });

      const list = await trpcCall<{
        quickReplies: Array<{ id: number; title: string; usageCount: number }>;
      }>(
        app,
        "GET",
        "quickReplies.list",
        { query: "orçamento", isActive: true },
        { cookie: cookies },
      );
      expect(list.data?.quickReplies).toEqual([
        expect.objectContaining({ id: create.data!.quickReply.id, title: "Orçamento padrão" }),
      ]);

      const markUsed = await trpcCall<{
        quickReply: { id: number; usageCount: number; lastUsedAt: string | null };
      }>(
        app,
        "POST",
        "quickReplies.markUsed",
        { id: create.data!.quickReply.id },
        { cookie: cookies, csrfToken },
      );
      expect(markUsed.data?.quickReply).toMatchObject({
        id: create.data!.quickReply.id,
        usageCount: 1,
        lastUsedAt: expect.any(String),
      });

      const deleted = await trpcCall<{ ok: boolean }>(
        app,
        "POST",
        "quickReplies.softDelete",
        { id: create.data!.quickReply.id },
        { cookie: cookies, csrfToken },
      );
      expect(deleted.data?.ok).toBe(true);

      const afterDelete = await trpcCall<{ quickReplies: Array<{ id: number }> }>(
        app,
        "GET",
        "quickReplies.list",
        { query: "orçamento" },
        { cookie: cookies },
      );
      expect(afterDelete.data?.quickReplies).toEqual([]);
    } finally {
      await app.close();
      db.close();
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("protects admin operational endpoints and retries dead jobs via tRPC", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nuoma-v2-api-jobs-"));
    const db = openDb(path.join(tempDir, "api.db"));
    await runMigrations(db);
    const repos = createRepositories(db);
    const passwordHash = await argon2.hash("initial-password-123", { type: argon2.argon2id });
    const user = await repos.users.create({
      email: "admin@nuoma.local",
      passwordHash,
      role: "admin",
      displayName: "Admin",
    });
    await repos.jobs.create({
      userId: user.id,
      type: "validate_recipient",
      status: "queued",
      payload: { phone: "5531982066263" },
      scheduledAt: "2026-04-30T12:00:00.000Z",
      maxAttempts: 1,
    });
    const [claimed] = await repos.jobs.claimDueJobs({
      workerId: "worker-1",
      now: "2026-04-30T12:00:01.000Z",
    });
    await repos.jobs.moveToDead({ jobId: claimed?.id ?? 0, error: "invalid recipient" });
    await repos.systemEvents.create({
      userId: user.id,
      type: "sync.dom_changed",
      severity: "warn",
      payload: JSON.stringify({ reason: "test" }),
    });
    await repos.workerState.heartbeat({
      workerId: "worker-1",
      status: "idle",
      currentJobId: null,
      pid: 123,
      rssMb: 256,
      browserConnected: true,
      metrics: { claimed: 1 },
    });
    const conversation = await repos.conversations.create({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "5531982066263",
      title: "5531982066263",
    });

    const app = await buildApiApp({
      env: loadApiEnv({
        API_LOG_LEVEL: "silent",
        NODE_ENV: "test",
        API_JWT_SECRET: "test-secret-with-more-than-16-chars",
        DATABASE_URL: path.join(tempDir, "api.db"),
      }),
      db,
      migrate: false,
    });

    try {
      const unauthenticated = await trpcCall(app, "GET", "jobs.listDead", undefined);
      expect(unauthenticated.statusCode).toBe(401);

      const login = await trpcCall<{ csrfToken: string }>(app, "POST", "auth.login", {
        email: "admin@nuoma.local",
        password: "initial-password-123",
      });
      const cookies = cookieHeader(login.setCookie);
      const csrfToken = login.data!.csrfToken;

      const list = await trpcCall<{ jobs: Array<{ id: number }> }>(
        app,
        "GET",
        "jobs.listDead",
        undefined,
        { cookie: cookies },
      );
      expect(list.statusCode).toBe(200);
      expect(list.data?.jobs).toHaveLength(1);

      const events = await trpcCall<{
        events: Array<{ type: string; severity: string; payload: unknown }>;
      }>(app, "GET", "system.events", { severity: "warn" }, { cookie: cookies });
      expect(events.statusCode).toBe(200);
      expect(events.data?.events).toEqual([
        expect.objectContaining({
          type: "sync.dom_changed",
          severity: "warn",
          payload: { reason: "test" },
        }),
      ]);

      const metrics = await trpcCall<{
        jobs: { dead: number; failed: number };
        operations: {
          terminalLastHour: number;
          failedLastHour: number;
          failureRatePct: number;
          throughputPerHour: number;
          avgRunLatencyMs: number | null;
        };
        workers: { total: number; browserConnected: number };
        whatsapp: { sessionStatus: string; cdpConnected: boolean };
        criticalEvents: Array<{ type: string; severity: string }>;
      }>(app, "GET", "system.metrics", undefined, { cookie: cookies });
      expect(metrics.statusCode).toBe(200);
      expect(metrics.data?.jobs.dead).toBe(1);
      expect(metrics.data?.jobs.failed).toBe(1);
      expect(metrics.data?.operations).toEqual(
        expect.objectContaining({
          terminalLastHour: 1,
          failedLastHour: 1,
          failureRatePct: 100,
          throughputPerHour: 1,
        }),
      );
      expect(metrics.data?.operations.avgRunLatencyMs).toEqual(expect.any(Number));
      expect(metrics.data?.workers).toEqual(
        expect.objectContaining({ total: 1, browserConnected: 1 }),
      );
      expect(metrics.data?.whatsapp).toEqual(
        expect.objectContaining({ sessionStatus: "connected", cdpConnected: true }),
      );
      expect(metrics.data?.criticalEvents).toEqual([
        expect.objectContaining({ type: "sync.dom_changed", severity: "warn" }),
      ]);

      const conversations = await trpcCall<{
        conversations: Array<{ id: number; externalThreadId: string }>;
      }>(app, "GET", "conversations.list", undefined, { cookie: cookies });
      expect(conversations.statusCode).toBe(200);
      expect(conversations.data?.conversations).toEqual([
        expect.objectContaining({
          id: conversation.id,
          externalThreadId: "5531982066263",
        }),
      ]);

      const forceSync = await trpcCall<{ job: { type: string } }>(
        app,
        "POST",
        "conversations.forceSync",
        {
          id: conversation.id,
          phone: "5531982066263",
        },
        { cookie: cookies, csrfToken },
      );
      expect(forceSync.statusCode).toBe(200);
      expect(forceSync.data?.job.type).toBe("sync_conversation");

      const forceHistorySync = await trpcCall<{
        job: { type: string; payload: { maxScrolls?: number } };
      }>(
        app,
        "POST",
        "conversations.forceHistorySync",
        {
          id: conversation.id,
          phone: "5531982066263",
          maxScrolls: 5,
        },
        { cookie: cookies, csrfToken },
      );
      expect(forceHistorySync.statusCode).toBe(200);
      expect(forceHistorySync.data?.job.type).toBe("sync_history");
      expect(forceHistorySync.data?.job.payload.maxScrolls).toBe(5);

      const deadId = list.data!.jobs[0]!.id;
      const retry = await trpcCall<{ job: { status: string } }>(
        app,
        "POST",
        "jobs.retryDead",
        { deadJobId: deadId, scheduledAt: "2026-04-30T12:10:00.000Z" },
        { cookie: cookies, csrfToken },
      );
      expect(retry.statusCode).toBe(200);
      expect(retry.data?.job.status).toBe("queued");

      const listAfterRetry = await trpcCall<{ jobs: unknown[] }>(
        app,
        "GET",
        "jobs.listDead",
        undefined,
        { cookie: cookies },
      );
      expect(listAfterRetry.data?.jobs).toHaveLength(0);
    } finally {
      await app.close();
      db.close();
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("exposes V2.7 media, push, embed and streaming procedures safely", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nuoma-v2-api-v27-"));
    const db = openDb(path.join(tempDir, "api.db"));
    await runMigrations(db);
    const repos = createRepositories(db);
    const passwordHash = await argon2.hash("initial-password-123", { type: argon2.argon2id });
    const user = await repos.users.create({
      email: "admin@nuoma.local",
      passwordHash,
      role: "admin",
      displayName: "Admin",
    });
    const contact = await repos.contacts.create({
      userId: user.id,
      name: "Gabriel",
      phone: "5531982066263",
      primaryChannel: "whatsapp",
    });
    const conversation = await repos.conversations.create({
      userId: user.id,
      contactId: contact.id,
      channel: "whatsapp",
      externalThreadId: "5531982066263",
      title: "Gabriel",
    });
    await repos.messages.insertOrIgnore({
      userId: user.id,
      conversationId: conversation.id,
      contactId: contact.id,
      externalId: "MSG1",
      direction: "inbound",
      contentType: "text",
      status: "received",
      body: "Oi",
      observedAtUtc: "2026-05-04T12:00:00.000Z",
    });
    await repos.automations.create({
      userId: user.id,
      name: "Boas-vindas",
      category: "Teste",
      status: "active",
      trigger: { type: "message_received", channel: "whatsapp" },
      condition: { segment: null, requireWithin24hWindow: false },
      actions: [
        {
          type: "send_step",
          step: {
            id: "hello",
            label: "Hello",
            type: "text",
            template: "Oi {{nome}}",
            delaySeconds: 0,
            conditions: [],
          },
        },
      ],
      metadata: {},
    });

    const app = await buildApiApp({
      env: loadApiEnv({
        API_LOG_LEVEL: "silent",
        NODE_ENV: "test",
        API_JWT_SECRET: "test-secret-with-more-than-16-chars",
        DATABASE_URL: path.join(tempDir, "api.db"),
        API_CRM_STORAGE_CACHE_ROOT: path.join(tempDir, "crm-cache"),
        API_CRM_STORAGE_S3_BUCKET: "nuoma-crm-test",
        API_CRM_STORAGE_S3_ENDPOINT: "https://s3.local.test",
        API_CRM_STORAGE_S3_ACCESS_KEY_ID: "AKIATEST",
        API_CRM_STORAGE_S3_SECRET_ACCESS_KEY: "secret-test-key",
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

      const userCreate = await trpcCall<{
        user: { id: number; email: string; isActive: boolean; displayName: string | null };
      }>(
        app,
        "POST",
        "users.create",
        {
          email: "operador@nuoma.local",
          password: "operator-password-123",
          role: "attendant",
          displayName: "Operador",
        },
        { cookie: cookies, csrfToken },
      );
      expect(userCreate.statusCode).toBe(200);
      expect(userCreate.data?.user).toMatchObject({
        email: "operador@nuoma.local",
        isActive: true,
        displayName: "Operador",
      });

      const userGet = await trpcCall<{ user: { id: number; email: string } | null }>(
        app,
        "GET",
        "users.get",
        { id: userCreate.data!.user.id },
        { cookie: cookies },
      );
      expect(userGet.data?.user).toMatchObject({
        id: userCreate.data!.user.id,
        email: "operador@nuoma.local",
      });

      const userUpdate = await trpcCall<{
        user: { displayName: string | null; role: string } | null;
      }>(
        app,
        "POST",
        "users.update",
        { id: userCreate.data!.user.id, displayName: "Operador atualizado", role: "viewer" },
        { cookie: cookies, csrfToken },
      );
      expect(userUpdate.data?.user).toMatchObject({
        displayName: "Operador atualizado",
        role: "viewer",
      });

      const userDeactivate = await trpcCall<{ ok: boolean; user: { isActive: boolean } | null }>(
        app,
        "POST",
        "users.deactivate",
        { id: userCreate.data!.user.id },
        { cookie: cookies, csrfToken },
      );
      expect(userDeactivate.data).toMatchObject({
        ok: true,
        user: { isActive: false },
      });

      const sha256 = "a".repeat(64);
      const upload = await trpcCall<{ asset: { id: number; sha256: string }; deduped: boolean }>(
        app,
        "POST",
        "media.upload",
        {
          type: "image",
          fileName: "before-after.jpg",
          mimeType: "image/jpeg",
          sha256,
          sizeBytes: 123,
          storagePath: "data/uploads/before-after.jpg",
        },
        { cookie: cookies, csrfToken },
      );
      expect(upload.statusCode).toBe(200);
      expect(upload.data?.deduped).toBe(false);

      const uploadAgain = await trpcCall<{ asset: { id: number }; deduped: boolean }>(
        app,
        "POST",
        "media.upload",
        {
          type: "image",
          fileName: "duplicate.jpg",
          mimeType: "image/jpeg",
          sha256,
          sizeBytes: 123,
          storagePath: "data/uploads/duplicate.jpg",
        },
        { cookie: cookies, csrfToken },
      );
      expect(uploadAgain.statusCode).toBe(200);
      expect(uploadAgain.data?.deduped).toBe(true);
      expect(uploadAgain.data?.asset.id).toBe(upload.data?.asset.id);

      const multipartBoundary = "----nuoma-test-boundary";
      const multipartBody = Buffer.from("multipart image bytes");
      const multipartUpload = await app.inject({
        method: "POST",
        url: "/api/media/upload",
        headers: {
          cookie: cookies,
          "x-csrf-token": csrfToken,
          "content-type": `multipart/form-data; boundary=${multipartBoundary}`,
        },
        payload: multipartPayload({
          boundary: multipartBoundary,
          fields: { type: "image" },
          file: {
            fieldName: "file",
            fileName: "antes-depois.jpeg",
            contentType: "image/jpeg",
            body: multipartBody,
          },
        }),
      });
      const multipartJson = multipartUpload.json() as {
        asset: { id: number; sha256: string; storagePath: string; sizeBytes: number };
        deduped: boolean;
      };
      expect(multipartUpload.statusCode).toBe(201);
      expect(multipartJson).toMatchObject({
        deduped: false,
        asset: {
          sha256: createHash("sha256").update(multipartBody).digest("hex"),
          sizeBytes: multipartBody.byteLength,
        },
      });
      await expect(fs.stat(multipartJson.asset.storagePath)).resolves.toMatchObject({
        size: multipartBody.byteLength,
      });

      const multipartDuplicate = await app.inject({
        method: "POST",
        url: "/api/media/upload",
        headers: {
          cookie: cookies,
          "x-csrf-token": csrfToken,
          "content-type": `multipart/form-data; boundary=${multipartBoundary}`,
        },
        payload: multipartPayload({
          boundary: multipartBoundary,
          fields: { type: "image" },
          file: {
            fieldName: "file",
            fileName: "duplicado.jpeg",
            contentType: "image/jpeg",
            body: multipartBody,
          },
        }),
      });
      const multipartDuplicateJson = multipartDuplicate.json() as {
        asset: { id: number };
        deduped: boolean;
      };
      expect(multipartDuplicate.statusCode).toBe(200);
      expect(multipartDuplicateJson).toMatchObject({
        deduped: true,
        asset: { id: multipartJson.asset.id },
      });

      const crmBoundary = "----nuoma-crm-storage-boundary";
      const crmBody = Buffer.from("crm namespaced upload bytes");
      const crmUpload = await app.inject({
        method: "POST",
        url: "/api/media/upload",
        headers: {
          cookie: cookies,
          "x-csrf-token": csrfToken,
          "content-type": `multipart/form-data; boundary=${crmBoundary}`,
        },
        payload: multipartPayload({
          boundary: crmBoundary,
          fields: { type: "image", crmOwnerKey: "+55 (31) 98206-6263" },
          file: {
            fieldName: "file",
            fileName: "crm-profile.jpeg",
            contentType: "image/jpeg",
            body: crmBody,
          },
        }),
      });
      const crmJson = crmUpload.json() as {
        asset: { storagePath: string; sha256: string };
        storage: { provider: string; namespace: string; objectKey: string };
      };
      const crmSha256 = createHash("sha256").update(crmBody).digest("hex");
      expect(crmUpload.statusCode).toBe(201);
      expect(crmJson).toMatchObject({
        asset: { sha256: crmSha256 },
        storage: {
          provider: "local",
          namespace: "/nuoma/files/crm/5531982066263/",
          objectKey: `nuoma/files/crm/5531982066263/${crmSha256}.jpeg`,
        },
      });
      expect(crmJson.asset.storagePath).toBe(
        path.join(
          tempDir,
          "crm-files",
          "nuoma",
          "files",
          "crm",
          "5531982066263",
          `${crmSha256}.jpeg`,
        ),
      );
      await expect(fs.readFile(crmJson.asset.storagePath)).resolves.toEqual(crmBody);

      const s3Body = Buffer.from("s3 cached download bytes");
      const s3Asset = await repos.mediaAssets.create({
        userId: user.id,
        type: "document",
        fileName: "crm-s3.txt",
        mimeType: "text/plain",
        sha256: createHash("sha256").update(s3Body).digest("hex"),
        sizeBytes: s3Body.byteLength,
        durationMs: null,
        storagePath: "s3://nuoma-crm-test/nuoma/files/crm/5531982066263/crm-s3.txt",
        sourceUrl: null,
        deletedAt: null,
      });
      expect(s3Asset.storagePath).toBe(
        "s3://nuoma-crm-test/nuoma/files/crm/5531982066263/crm-s3.txt",
      );
      const fetchMock = vi.fn<typeof fetch>(async () => new Response(s3Body, { status: 200 }));
      const originalFetch = globalThis.fetch;
      globalThis.fetch = fetchMock;
      try {
        const s3Download = await app.inject({
          method: "GET",
          url: `/api/media/assets/${s3Asset.id}`,
          headers: { cookie: cookies },
        });
        const s3DownloadCached = await app.inject({
          method: "GET",
          url: `/api/media/assets/${s3Asset.id}`,
          headers: { cookie: cookies },
        });
        expect(
          s3Download.statusCode,
          `${s3Download.payload} calls=${fetchMock.mock.calls.length}`,
        ).toBe(200);
        expect(s3Download.payload).toBe(s3Body.toString());
        expect(s3Download.headers["x-nuoma-storage-cache"]).toBe("miss");
        expect(s3DownloadCached.statusCode).toBe(200);
        expect(s3DownloadCached.payload).toBe(s3Body.toString());
        expect(s3DownloadCached.headers["x-nuoma-storage-cache"]).toBe("hit");
        expect(fetchMock).toHaveBeenCalledTimes(1);
      } finally {
        globalThis.fetch = originalFetch;
      }

      const mediaGet = await trpcCall<{ asset: { fileName: string } | null }>(
        app,
        "GET",
        "media.get",
        { id: upload.data!.asset.id },
        { cookie: cookies },
      );
      expect(mediaGet.data?.asset?.fileName).toBe("before-after.jpg");

      const mediaUpdate = await trpcCall<{ asset: { fileName: string } | null }>(
        app,
        "POST",
        "media.update",
        {
          id: upload.data!.asset.id,
          fileName: "before-after-renamed.jpg",
        },
        { cookie: cookies, csrfToken },
      );
      expect(mediaUpdate.statusCode).toBe(200);
      expect(mediaUpdate.data?.asset?.fileName).toBe("before-after-renamed.jpg");

      const mediaList = await trpcCall<{ assets: Array<{ sha256: string }> }>(
        app,
        "GET",
        "media.list",
        { type: "image" },
        { cookie: cookies },
      );
      expect(mediaList.data?.assets).toEqual(
        expect.arrayContaining([expect.objectContaining({ sha256 })]),
      );

      const mediaSoftDelete = await trpcCall<{ asset: { deletedAt: string | null } | null }>(
        app,
        "POST",
        "media.softDelete",
        { id: upload.data!.asset.id },
        { cookie: cookies, csrfToken },
      );
      expect(mediaSoftDelete.data?.asset?.deletedAt).toEqual(expect.any(String));

      const mediaListAfterDelete = await trpcCall<{ assets: unknown[] }>(
        app,
        "GET",
        "media.list",
        { type: "image" },
        { cookie: cookies },
      );
      expect(mediaListAfterDelete.data?.assets).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ sha256 })]),
      );

      const contactUpdate = await trpcCall<{ contact: { name: string; status: string } | null }>(
        app,
        "POST",
        "contacts.update",
        { id: contact.id, name: "Gabriel Atualizado", status: "active" },
        { cookie: cookies, csrfToken },
      );
      expect(contactUpdate.statusCode).toBe(200);
      expect(contactUpdate.data?.contact).toMatchObject({
        name: "Gabriel Atualizado",
        status: "active",
      });

      const conversationUpdate = await trpcCall<{
        conversation: { title: string; unreadCount: number; isArchived: boolean } | null;
      }>(
        app,
        "POST",
        "conversations.update",
        { id: conversation.id, title: "Gabriel WhatsApp", unreadCount: 2 },
        { cookie: cookies, csrfToken },
      );
      expect(conversationUpdate.data?.conversation).toMatchObject({
        title: "Gabriel WhatsApp",
        unreadCount: 2,
        isArchived: false,
      });

      const conversationArchive = await trpcCall<{ ok: boolean }>(
        app,
        "POST",
        "conversations.softDelete",
        { id: conversation.id },
        { cookie: cookies, csrfToken },
      );
      expect(conversationArchive.data?.ok).toBe(true);

      const conversationRestore = await trpcCall<{ conversation: { isArchived: boolean } | null }>(
        app,
        "POST",
        "conversations.restore",
        { id: conversation.id },
        { cookie: cookies, csrfToken },
      );
      expect(conversationRestore.data?.conversation?.isArchived).toBe(false);

      const conversationCreate = await trpcCall<{
        conversation: { id: number; channel: string; externalThreadId: string };
      }>(
        app,
        "POST",
        "conversations.create",
        {
          contactId: contact.id,
          channel: "instagram",
          externalThreadId: "ig:gabs",
          title: "@gabs",
        },
        { cookie: cookies, csrfToken },
      );
      expect(conversationCreate.data?.conversation).toMatchObject({
        channel: "instagram",
        externalThreadId: "ig:gabs",
      });

      const messageCreate = await trpcCall<{
        message: { id: number; body: string | null; status: string };
      }>(
        app,
        "POST",
        "messages.create",
        {
          conversationId: conversation.id,
          contactId: contact.id,
          direction: "system",
          contentType: "text",
          status: "received",
          body: "Mensagem manual",
          observedAtUtc: "2026-05-04T11:00:00.000Z",
        },
        { cookie: cookies, csrfToken },
      );
      expect(messageCreate.data?.message).toMatchObject({
        body: "Mensagem manual",
        status: "received",
      });

      const messageGet = await trpcCall<{ message: { id: number } | null }>(
        app,
        "GET",
        "messages.get",
        { id: messageCreate.data!.message.id },
        { cookie: cookies },
      );
      expect(messageGet.data?.message?.id).toBe(messageCreate.data!.message.id);

      const messageUpdate = await trpcCall<{
        message: { body: string | null; status: string; editedAt: string | null } | null;
      }>(
        app,
        "POST",
        "messages.update",
        {
          id: messageCreate.data!.message.id,
          status: "sent",
          body: "Mensagem manual editada",
          editedAt: "2026-05-04T11:05:00.000Z",
        },
        { cookie: cookies, csrfToken },
      );
      expect(messageUpdate.data?.message).toMatchObject({
        body: "Mensagem manual editada",
        status: "sent",
        editedAt: "2026-05-04T11:05:00.000Z",
      });

      const messageSoftDelete = await trpcCall<{ ok: boolean }>(
        app,
        "POST",
        "messages.softDelete",
        { id: messageCreate.data!.message.id },
        { cookie: cookies, csrfToken },
      );
      expect(messageSoftDelete.data?.ok).toBe(true);

      const visibleMessages = await trpcCall<{ messages: Array<{ id: number }> }>(
        app,
        "GET",
        "messages.listByConversation",
        { conversationId: conversation.id, includeDeleted: false },
        { cookie: cookies },
      );
      expect(visibleMessages.data?.messages).not.toContainEqual(
        expect.objectContaining({ id: messageCreate.data!.message.id }),
      );

      const contactImportPreview = await trpcCall<{
        created: number;
        duplicates: number;
        dryRun: boolean;
      }>(
        app,
        "POST",
        "contacts.import",
        {
          dryRun: true,
          csv: "nome,telefone,email\nMaria Importada,+55 (31) 98206-6264,maria@example.com\nGabriel Duplicado,5531982066263,gabriel@example.com",
        },
        { cookie: cookies, csrfToken },
      );
      expect(contactImportPreview.data).toMatchObject({
        created: 1,
        duplicates: 1,
        dryRun: true,
      });

      const contactImport = await trpcCall<{
        contacts: Array<{ id: number; name: string; phone: string | null }>;
        created: number;
      }>(
        app,
        "POST",
        "contacts.import",
        {
          dryRun: false,
          rows: [
            {
              name: "Maria Importada",
              phone: "5531982066264",
              email: "maria@example.com",
              primaryChannel: "whatsapp",
              status: "lead",
            },
          ],
        },
        { cookie: cookies, csrfToken },
      );
      expect(contactImport.data?.created).toBe(1);
      expect(contactImport.data?.contacts[0]).toMatchObject({
        name: "Maria Importada",
        phone: "5531982066264",
      });

      const contactSearch = await trpcCall<{ contacts: Array<{ name: string }> }>(
        app,
        "GET",
        "contacts.search",
        { query: "maria", limit: 10 },
        { cookie: cookies },
      );
      expect(contactSearch.statusCode, JSON.stringify(contactSearch.error)).toBe(200);
      expect(contactSearch.data?.contacts).toEqual([
        expect.objectContaining({ name: "Maria Importada" }),
      ]);

      const campaignCreate = await trpcCall<{
        campaign: { id: number; status: string };
      }>(
        app,
        "POST",
        "campaigns.create",
        {
          name: "Campanha teste",
          channel: "whatsapp",
          evergreen: false,
          steps: [
            {
              id: "s1",
              label: "Texto",
              type: "text",
              template: "Oi {{telefone}}",
              delaySeconds: 0,
              conditions: [],
            },
          ],
          metadata: {},
        },
        { cookie: cookies, csrfToken },
      );
      expect(campaignCreate.statusCode).toBe(200);

      const campaignGet = await trpcCall<{ campaign: { id: number; name: string } }>(
        app,
        "GET",
        "campaigns.get",
        { id: campaignCreate.data!.campaign.id },
        { cookie: cookies },
      );
      expect(campaignGet.data?.campaign).toMatchObject({
        id: campaignCreate.data!.campaign.id,
        name: "Campanha teste",
      });

      const campaignUpdate = await trpcCall<{
        campaign: { name: string; status: string; evergreen: boolean } | null;
      }>(
        app,
        "POST",
        "campaigns.update",
        {
          id: campaignCreate.data!.campaign.id,
          name: "Campanha teste atualizada",
          status: "paused",
          evergreen: true,
        },
        { cookie: cookies, csrfToken },
      );
      expect(campaignUpdate.data?.campaign).toMatchObject({
        name: "Campanha teste atualizada",
        status: "paused",
        evergreen: true,
      });

      const campaignResume = await trpcCall<{
        ok: boolean;
        campaign: { status: string; metadata: Record<string, unknown> } | null;
      }>(
        app,
        "POST",
        "campaigns.resume",
        { id: campaignCreate.data!.campaign.id },
        { cookie: cookies, csrfToken },
      );
      expect(campaignResume.data?.campaign).toMatchObject({
        status: "running",
        metadata: {
          pauseResume: expect.objectContaining({ lastAction: "resumed" }),
        },
      });

      const campaignPause = await trpcCall<{
        ok: boolean;
        campaign: { status: string; metadata: Record<string, unknown> } | null;
      }>(
        app,
        "POST",
        "campaigns.pause",
        { id: campaignCreate.data!.campaign.id, reason: "teste" },
        { cookie: cookies, csrfToken },
      );
      expect(campaignPause.data?.campaign).toMatchObject({
        status: "paused",
        metadata: {
          pauseResume: expect.objectContaining({
            lastAction: "paused",
            pauseReason: "teste",
          }),
        },
      });

      const campaignArchive = await trpcCall<{ ok: boolean; campaign: { status: string } | null }>(
        app,
        "POST",
        "campaigns.softDelete",
        { id: campaignCreate.data!.campaign.id },
        { cookie: cookies, csrfToken },
      );
      expect(campaignArchive.data).toMatchObject({
        ok: true,
        campaign: { status: "archived" },
      });

      const campaignRestore = await trpcCall<{ campaign: { status: string } | null }>(
        app,
        "POST",
        "campaigns.restore",
        { id: campaignCreate.data!.campaign.id, status: "draft" },
        { cookie: cookies, csrfToken },
      );
      expect(campaignRestore.data?.campaign?.status).toBe("draft");
      const campaignDisableEvergreen = await trpcCall<{
        campaign: { evergreen: boolean } | null;
      }>(
        app,
        "POST",
        "campaigns.update",
        { id: campaignCreate.data!.campaign.id, evergreen: false },
        { cookie: cookies, csrfToken },
      );
      expect(campaignDisableEvergreen.data?.campaign?.evergreen).toBe(false);

      const campaignReadyDraft = await trpcCall<{
        canEnqueue: boolean;
        issues: Array<{ code: string; severity: string }>;
        summary: { plannedJobs: number };
      }>(
        app,
        "GET",
        "campaigns.ready",
        { campaignId: campaignCreate.data!.campaign.id },
        { cookie: cookies },
      );
      expect(campaignReadyDraft.data).toMatchObject({
        canEnqueue: false,
        summary: { plannedJobs: 0 },
      });
      expect(campaignReadyDraft.data?.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "campaign_status_not_runnable", severity: "error" }),
          expect.objectContaining({ code: "no_active_recipients", severity: "error" }),
        ]),
      );

      const campaignExecutePreview = await trpcCall<{
        dryRun: boolean;
        recipientsPlanned: number;
        scheduler: null;
      }>(
        app,
        "POST",
        "campaigns.execute",
        {
          campaignId: campaignCreate.data!.campaign.id,
          dryRun: true,
          phones: ["5531982066263", "5531999999999"],
        },
        { cookie: cookies, csrfToken },
      );
      expect(campaignExecutePreview.data).toMatchObject({
        dryRun: true,
        recipientsPlanned: 2,
        scheduler: null,
      });

      const campaignExecute = await trpcCall<{
        dryRun: boolean;
        recipientsCreated: number;
        scheduler: { jobsCreated: number; plannedJobs: Array<{ phone: string }> };
      }>(
        app,
        "POST",
        "campaigns.execute",
        {
          campaignId: campaignCreate.data!.campaign.id,
          dryRun: false,
          phones: ["5531982066263"],
        },
        { cookie: cookies, csrfToken },
      );
      expect(campaignExecute.data).toMatchObject({
        dryRun: false,
        recipientsCreated: 1,
        scheduler: {
          jobsCreated: 1,
          plannedJobs: [expect.objectContaining({ phone: "5531982066263" })],
        },
      });

      const tagCreate = await trpcCall<{ tag: { id: number; name: string } }>(
        app,
        "POST",
        "tags.create",
        { name: "VIP", color: "#10b981", description: "Lead quente" },
        { cookie: cookies, csrfToken },
      );
      expect(tagCreate.statusCode).toBe(200);
      const tagUpdate = await trpcCall<{
        tag: { name: string; description: string | null } | null;
      }>(
        app,
        "POST",
        "tags.update",
        { id: tagCreate.data!.tag.id, name: "VIP atualizado", description: null },
        { cookie: cookies, csrfToken },
      );
      expect(tagUpdate.data?.tag).toMatchObject({
        name: "VIP atualizado",
        description: null,
      });

      const chatbotCreate = await trpcCall<{
        chatbot: { id: number; name: string; status: string };
      }>(
        app,
        "POST",
        "chatbots.create",
        { name: "Bot WhatsApp", channel: "whatsapp", fallbackMessage: "Nao entendi" },
        { cookie: cookies, csrfToken },
      );
      expect(chatbotCreate.statusCode).toBe(200);
      expect(chatbotCreate.data?.chatbot.status).toBe("draft");

      const chatbotUpdate = await trpcCall<{
        chatbot: { id: number; status: string } | null;
      }>(
        app,
        "POST",
        "chatbots.update",
        { id: chatbotCreate.data!.chatbot.id, status: "active" },
        { cookie: cookies, csrfToken },
      );
      expect(chatbotUpdate.data?.chatbot?.status).toBe("active");

      const chatbotArchive = await trpcCall<{
        ok: boolean;
        chatbot: { status: string } | null;
      }>(
        app,
        "POST",
        "chatbots.softDelete",
        { id: chatbotCreate.data!.chatbot.id },
        { cookie: cookies, csrfToken },
      );
      expect(chatbotArchive.data).toMatchObject({
        ok: true,
        chatbot: { status: "archived" },
      });

      const chatbotRestore = await trpcCall<{ chatbot: { status: string } | null }>(
        app,
        "POST",
        "chatbots.restore",
        { id: chatbotCreate.data!.chatbot.id, status: "active" },
        { cookie: cookies, csrfToken },
      );
      expect(chatbotRestore.data?.chatbot?.status).toBe("active");

      const chatbotRuleCreate = await trpcCall<{
        rule: { id: number; name: string; priority: number; metadata: unknown };
      }>(
        app,
        "POST",
        "chatbots.createRule",
        {
          chatbotId: chatbotCreate.data!.chatbot.id,
          name: "Preco",
          priority: 10,
          match: { type: "contains", value: "preco" },
          actions: [{ type: "set_status", status: "interessado" }],
          metadata: {
            abTest: {
              enabled: true,
              assignment: "deterministic",
              variants: [
                {
                  id: "controle",
                  label: "Controle",
                  weight: 100,
                  actions: [{ type: "set_status", status: "ab_controle" }],
                },
                {
                  id: "alternativa",
                  label: "Alternativa",
                  weight: 0,
                  actions: [{ type: "set_status", status: "ab_alternativa" }],
                },
              ],
            },
          },
        },
        { cookie: cookies, csrfToken },
      );
      expect(chatbotRuleCreate.statusCode).toBe(200);
      expect(chatbotRuleCreate.data?.rule.metadata).toMatchObject({
        abTest: { enabled: true },
      });

      const chatbotRules = await trpcCall<{ rules: Array<{ id: number }> }>(
        app,
        "GET",
        "chatbots.listRules",
        { chatbotId: chatbotCreate.data!.chatbot.id },
        { cookie: cookies },
      );
      expect(chatbotRules.data?.rules).toHaveLength(1);

      const chatbotRuleTest = await trpcCall<{
        matched: boolean;
        wouldEnqueueJobs: false;
        rule: { id: number } | null;
        actions: Array<{ type: string; status?: string }>;
        abTest: {
          selectedVariantId: string | null;
          variants: Array<{ id: string; weight: number; actionsCount: number }>;
        } | null;
      }>(
        app,
        "GET",
        "chatbots.testRule",
        {
          chatbotId: chatbotCreate.data!.chatbot.id,
          phone: "5531982066263",
          body: "Qual o preco?",
        },
        { cookie: cookies },
      );
      expect(chatbotRuleTest.data).toMatchObject({
        matched: true,
        wouldEnqueueJobs: false,
        rule: { id: chatbotRuleCreate.data!.rule.id },
        actions: [{ type: "set_status", status: "ab_controle" }],
        abTest: {
          selectedVariantId: "controle",
          variants: [
            { id: "controle", weight: 100, actionsCount: 1 },
            { id: "alternativa", weight: 0, actionsCount: 1 },
          ],
        },
      });

      const exposureCreate = await trpcCall<{
        ok: boolean;
        event: {
          id: number;
          eventType: string;
          variantId: string;
          sourceEventId: string | null;
        } | null;
        reason: string | null;
      }>(
        app,
        "POST",
        "chatbots.recordVariantEvent",
        {
          chatbotId: chatbotCreate.data!.chatbot.id,
          ruleId: chatbotRuleCreate.data!.rule.id,
          variantId: "controle",
          eventType: "exposure",
          channel: "whatsapp",
          sourceEventId: "app-test-chatbot-exposure-1",
          metadata: { source: "app.test" },
        },
        { cookie: cookies, csrfToken },
      );
      expect(exposureCreate.data).toMatchObject({
        ok: true,
        event: {
          eventType: "exposure",
          variantId: "controle",
          sourceEventId: "app-test-chatbot-exposure-1",
        },
        reason: null,
      });

      const conversionCreate = await trpcCall<{
        ok: boolean;
        event: { eventType: string; variantId: string; exposureId: number | null } | null;
      }>(
        app,
        "POST",
        "chatbots.recordVariantEvent",
        {
          chatbotId: chatbotCreate.data!.chatbot.id,
          ruleId: chatbotRuleCreate.data!.rule.id,
          variantId: "controle",
          eventType: "conversion",
          channel: "whatsapp",
          exposureId: exposureCreate.data!.event!.id,
          sourceEventId: "app-test-chatbot-conversion-1",
        },
        { cookie: cookies, csrfToken },
      );
      expect(conversionCreate.data).toMatchObject({
        ok: true,
        event: {
          eventType: "conversion",
          variantId: "controle",
          exposureId: exposureCreate.data!.event!.id,
        },
      });

      const variantEvents = await trpcCall<{
        events: Array<{ id: number; eventType: string; variantId: string }>;
      }>(
        app,
        "GET",
        "chatbots.listVariantEvents",
        { chatbotId: chatbotCreate.data!.chatbot.id },
        { cookie: cookies },
      );
      expect(variantEvents.data?.events).toHaveLength(2);

      const variantSummary = await trpcCall<{
        variants: Array<{
          ruleId: number;
          variantId: string;
          exposures: number;
          conversions: number;
        }>;
      }>(
        app,
        "GET",
        "chatbots.summarizeVariantEvents",
        { chatbotId: chatbotCreate.data!.chatbot.id },
        { cookie: cookies },
      );
      expect(variantSummary.data?.variants).toEqual([
        {
          chatbotId: chatbotCreate.data!.chatbot.id,
          ruleId: chatbotRuleCreate.data!.rule.id,
          variantId: "controle",
          variantLabel: "Controle",
          exposures: 1,
          conversions: 1,
        },
      ]);

      const chatbotRuleUpdate = await trpcCall<{
        rule: { isActive: boolean } | null;
      }>(
        app,
        "POST",
        "chatbots.updateRule",
        { id: chatbotRuleCreate.data!.rule.id, isActive: false },
        { cookie: cookies, csrfToken },
      );
      expect(chatbotRuleUpdate.data?.rule?.isActive).toBe(false);

      const chatbotRuleDelete = await trpcCall<{ ok: boolean; rule: { isActive: boolean } | null }>(
        app,
        "POST",
        "chatbots.deleteRule",
        { id: chatbotRuleCreate.data!.rule.id },
        { cookie: cookies, csrfToken },
      );
      expect(chatbotRuleDelete.data).toMatchObject({
        ok: true,
        rule: { isActive: false },
      });

      const attendantCreate = await trpcCall<{
        attendant: { id: number; name: string; isActive: boolean };
      }>(
        app,
        "POST",
        "attendants.create",
        { name: "Atendente 1", email: "atendente@nuoma.local", role: "attendant" },
        { cookie: cookies, csrfToken },
      );
      expect(attendantCreate.statusCode).toBe(200);
      const attendantUpdate = await trpcCall<{
        attendant: { name: string; isActive: boolean } | null;
      }>(
        app,
        "POST",
        "attendants.update",
        { id: attendantCreate.data!.attendant.id, name: "Atendente pausado", isActive: false },
        { cookie: cookies, csrfToken },
      );
      expect(attendantUpdate.data?.attendant).toMatchObject({
        name: "Atendente pausado",
        isActive: false,
      });
      const attendantsList = await trpcCall<{ attendants: Array<{ id: number }> }>(
        app,
        "GET",
        "attendants.list",
        undefined,
        { cookie: cookies },
      );
      expect(attendantsList.data?.attendants).toHaveLength(1);

      const automationList = await trpcCall<{ automations: Array<{ id: number }> }>(
        app,
        "GET",
        "automations.list",
        undefined,
        { cookie: cookies },
      );
      const automationId = automationList.data!.automations[0]!.id;
      const automationUpdate = await trpcCall<{
        automation: { status: string; category: string } | null;
      }>(
        app,
        "POST",
        "automations.update",
        { id: automationId, status: "active", category: "Atendimento" },
        { cookie: cookies, csrfToken },
      );
      expect(automationUpdate.data?.automation).toMatchObject({
        status: "active",
        category: "Atendimento",
      });
      const automationTest = await trpcCall<{
        eligible: boolean;
        wouldEnqueueJobs: false;
      }>(
        app,
        "GET",
        "automations.test",
        { id: automationId, channel: "whatsapp" },
        { cookie: cookies },
      );
      expect(automationTest.data).toMatchObject({
        eligible: true,
        wouldEnqueueJobs: false,
      });

      const automationArchive = await trpcCall<{
        ok: boolean;
        automation: { status: string } | null;
      }>(
        app,
        "POST",
        "automations.softDelete",
        { id: automationId },
        { cookie: cookies, csrfToken },
      );
      expect(automationArchive.data).toMatchObject({
        ok: true,
        automation: { status: "archived" },
      });

      const automationRestore = await trpcCall<{
        automation: { status: string } | null;
      }>(
        app,
        "POST",
        "automations.restore",
        { id: automationId, status: "active" },
        { cookie: cookies, csrfToken },
      );
      expect(automationRestore.data?.automation?.status).toBe("active");

      const automationTriggerPreview = await trpcCall<{
        eligible: boolean;
        dryRun: boolean;
        jobsCreated: number;
        wouldEnqueueJobs: boolean;
      }>(
        app,
        "POST",
        "automations.trigger",
        { id: automationId, phone: "5531982066263", dryRun: true },
        { cookie: cookies, csrfToken },
      );
      expect(automationTriggerPreview.data).toMatchObject({
        eligible: true,
        dryRun: true,
        jobsCreated: 0,
        wouldEnqueueJobs: true,
      });

      const automationTrigger = await trpcCall<{
        eligible: boolean;
        dryRun: boolean;
        jobsCreated: number;
      }>(
        app,
        "POST",
        "automations.trigger",
        { id: automationId, phone: "5531982066263", dryRun: false },
        { cookie: cookies, csrfToken },
      );
      expect(automationTrigger.data).toMatchObject({
        eligible: true,
        dryRun: false,
        jobsCreated: 1,
      });

      const summary = await trpcCall<{
        contact: { id: number; phone: string } | null;
        conversations: unknown[];
        latestMessages: Array<{ body: string | null }>;
      }>(app, "GET", "embed.contactSummary", { phone: "5531982066263" }, { cookie: cookies });
      expect(summary.statusCode).toBe(200);
      expect(summary.data?.contact?.id).toBe(contact.id);
      expect(summary.data?.conversations).toHaveLength(2);
      expect(summary.data?.latestMessages[0]?.body).toBe("Oi");

      const eligible = await trpcCall<{ automations: Array<{ name: string }> }>(
        app,
        "GET",
        "embed.eligibleAutomations",
        { phone: "5531982066263" },
        { cookie: cookies },
      );
      expect(eligible.data?.automations).toEqual([
        expect.objectContaining({ name: "Boas-vindas" }),
      ]);

      const dispatchAutomation = await trpcCall<{
        eligible: boolean;
        dryRun: boolean;
        wouldEnqueueJobs: boolean;
      }>(
        app,
        "POST",
        "embed.dispatchAutomation",
        { automationId, phone: "5531982066263", dryRun: true },
        { cookie: cookies, csrfToken },
      );
      expect(dispatchAutomation.data).toMatchObject({
        eligible: true,
        dryRun: true,
        wouldEnqueueJobs: true,
      });

      const note = await trpcCall<{ contact: { notes: string | null } | null }>(
        app,
        "POST",
        "embed.addNote",
        { phone: "5531982066263", body: "Nota operacional" },
        { cookie: cookies, csrfToken },
      );
      expect(note.statusCode).toBe(200);
      expect(note.data?.contact?.notes).toContain("Nota operacional");

      const pushSubscribe = await trpcCall<{ ok: true }>(
        app,
        "POST",
        "push.subscribe",
        {
          endpoint: "https://push.example.test/subscription/1",
          keys: { p256dh: "p256dh-key", auth: "auth-key" },
        },
        { cookie: cookies, csrfToken },
      );
      expect(pushSubscribe.statusCode).toBe(200);

      const pushTest = await trpcCall<{ delivered: false; mode: string }>(
        app,
        "POST",
        "push.test",
        undefined,
        { cookie: cookies, csrfToken },
      );
      expect(pushTest.data).toMatchObject({ delivered: false, mode: "event-only" });

      const pushUnsubscribe = await trpcCall<{ deleted: boolean }>(
        app,
        "POST",
        "push.unsubscribe",
        { endpoint: "https://push.example.test/subscription/1" },
        { cookie: cookies, csrfToken },
      );
      expect(pushUnsubscribe.data?.deleted).toBe(true);

      const tagDelete = await trpcCall<{ ok: boolean }>(
        app,
        "POST",
        "tags.delete",
        { id: tagCreate.data!.tag.id },
        { cookie: cookies, csrfToken },
      );
      expect(tagDelete.statusCode, JSON.stringify(tagDelete.error)).toBe(200);
      expect(tagDelete.data?.ok).toBe(true);

      const screencast = await trpcCall<{ available: false; sessionId: null; image: null }>(
        app,
        "GET",
        "streaming.startScreencast",
        undefined,
        { cookie: cookies },
      );
      expect(screencast.statusCode).toBe(200);
      expect(screencast.data).toMatchObject({ available: false, sessionId: null, image: null });
    } finally {
      await app.close();
      db.close();
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("unifies WhatsApp and Instagram conversations in V2.7 listUnified", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nuoma-v2-api-v27-ig-"));
    const db = openDb(path.join(tempDir, "api.db"));
    await runMigrations(db);
    const repos = createRepositories(db);
    const passwordHash = await argon2.hash("initial-password-123", { type: argon2.argon2id });
    const user = await repos.users.create({
      email: "admin@nuoma.local",
      passwordHash,
      role: "admin",
      displayName: "Admin",
    });
    const whatsappContact = await repos.contacts.create({
      userId: user.id,
      name: "Gabriel WhatsApp",
      phone: "5531982066263",
      primaryChannel: "whatsapp",
      status: "active",
    });
    const instagramContact = await repos.contacts.create({
      userId: user.id,
      name: "Neferpeel Instagram",
      phone: null,
      primaryChannel: "instagram",
      instagramHandle: "neferpeel.bh",
      status: "lead",
    });
    await repos.conversations.create({
      userId: user.id,
      contactId: whatsappContact.id,
      channel: "whatsapp",
      externalThreadId: "5531982066263",
      title: "Gabriel WhatsApp",
      lastMessageAt: "2026-05-07T10:00:00.000Z",
      lastPreview: "WA recente",
    });
    await repos.conversations.create({
      userId: user.id,
      contactId: instagramContact.id,
      channel: "instagram",
      externalThreadId: "ig:neferpeel.bh",
      title: "@neferpeel.bh",
      lastMessageAt: "2026-05-07T10:05:00.000Z",
      lastPreview: "DM recente",
    });

    const app = await buildApiApp({
      env: loadApiEnv({
        API_LOG_LEVEL: "silent",
        NODE_ENV: "test",
        API_JWT_SECRET: "test-secret-with-more-than-16-chars",
        DATABASE_URL: path.join(tempDir, "api.db"),
      }),
      db,
      migrate: false,
    });

    try {
      const login = await trpcCall(app, "POST", "auth.login", {
        email: "admin@nuoma.local",
        password: "initial-password-123",
      });
      const cookies = cookieHeader(login.setCookie);

      const unified = await trpcCall<{
        conversations: Array<{
          channel: string;
          title: string;
          contact: { instagramHandle: string | null; phone: string | null } | null;
          target: { kind: string; identity: string; label: string };
        }>;
        summary: {
          total: number;
          returned: number;
          channels: { instagram: number; system: number; whatsapp: number };
          filters: { channel: string; search: string | null };
        };
      }>(
        app,
        "GET",
        "conversations.listUnified",
        { channel: "all", limit: 10 },
        { cookie: cookies },
      );
      expect(unified.statusCode, JSON.stringify(unified.error)).toBe(200);
      expect(unified.data?.summary).toMatchObject({
        total: 2,
        returned: 2,
        channels: { instagram: 1, system: 0, whatsapp: 1 },
        filters: { channel: "all", search: null },
      });
      expect(unified.data?.conversations.map((conversation) => conversation.channel)).toEqual([
        "instagram",
        "whatsapp",
      ]);
      expect(unified.data?.conversations[0]).toMatchObject({
        channel: "instagram",
        contact: { instagramHandle: "neferpeel.bh", phone: null },
        target: {
          kind: "instagram",
          identity: "@neferpeel.bh",
          label: "Neferpeel Instagram",
        },
      });

      const byIgHandle = await trpcCall<{
        conversations: Array<{ channel: string; target: { identity: string } }>;
        summary: { total: number; channels: { instagram: number; whatsapp: number } };
      }>(
        app,
        "GET",
        "conversations.listUnified",
        { channel: "instagram", search: "@neferpeel", limit: 10 },
        { cookie: cookies },
      );
      expect(byIgHandle.statusCode, JSON.stringify(byIgHandle.error)).toBe(200);
      expect(byIgHandle.data?.summary).toMatchObject({
        total: 1,
        channels: { instagram: 1, whatsapp: 0 },
      });
      expect(byIgHandle.data?.conversations).toEqual([
        expect.objectContaining({
          channel: "instagram",
          target: expect.objectContaining({ identity: "@neferpeel.bh" }),
        }),
      ]);
    } finally {
      await app.close();
      db.close();
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("persists V2.10 chatbot execution history per source message", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nuoma-v2-api-chatbot-history-"));
    const db = openDb(path.join(tempDir, "api.db"));
    await runMigrations(db);
    const repos = createRepositories(db);
    const passwordHash = await argon2.hash("initial-password-123", { type: argon2.argon2id });
    const user = await repos.users.create({
      email: "admin@nuoma.local",
      passwordHash,
      role: "admin",
      displayName: "Admin",
    });
    const contact = await repos.contacts.create({
      userId: user.id,
      name: "Lead Chatbot",
      phone: "5531982066263",
      primaryChannel: "whatsapp",
    });
    const conversation = await repos.conversations.create({
      userId: user.id,
      contactId: contact.id,
      channel: "whatsapp",
      externalThreadId: "5531982066263",
      title: "Lead Chatbot",
    });
    const message = await repos.messages.insertOrIgnore({
      userId: user.id,
      conversationId: conversation.id,
      contactId: contact.id,
      externalId: "CHATBOT-MSG-1",
      direction: "inbound",
      contentType: "text",
      status: "received",
      body: "qual o preco?",
      observedAtUtc: "2026-05-07T12:00:00.000Z",
    });
    if (!message) {
      throw new Error("expected chatbot source message to be created");
    }
    const chatbot = await repos.chatbots.create({
      userId: user.id,
      name: "V2.10 History",
      channel: "whatsapp",
      status: "active",
      fallbackMessage: null,
      metadata: {},
    });
    const rule = await repos.chatbots.createRule({
      userId: user.id,
      chatbotId: chatbot.id,
      name: "Preco",
      priority: 1,
      match: { type: "contains", value: "preco" },
      segment: null,
      actions: [
        {
          type: "send_step",
          step: {
            id: "reply-price",
            label: "Preço",
            type: "text",
            delaySeconds: 0,
            conditions: [],
            template: "Segue preço.",
          },
        },
      ],
      metadata: {
        abTest: {
          enabled: true,
          assignment: "deterministic",
          variants: [
            {
              id: "controle",
              label: "Controle",
              weight: 1,
              actions: [
                {
                  type: "send_step",
                  step: {
                    id: "reply-price",
                    label: "Preço",
                    type: "text",
                    delaySeconds: 0,
                    conditions: [],
                    template: "Segue preço.",
                  },
                },
              ],
            },
            {
              id: "direta",
              label: "Direta",
              weight: 1,
              actions: [
                {
                  type: "send_step",
                  step: {
                    id: "reply-price",
                    label: "Preço",
                    type: "text",
                    delaySeconds: 0,
                    conditions: [],
                    template: "Preço direto.",
                  },
                },
              ],
            },
          ],
        },
      },
    });
    const app = await buildApiApp({
      env: loadApiEnv({
        API_LOG_LEVEL: "silent",
        NODE_ENV: "test",
        API_JWT_SECRET: "test-secret-with-more-than-16-chars",
        DATABASE_URL: path.join(tempDir, "api.db"),
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

      const evaluation = await trpcCall<{
        matched: boolean;
        persisted: boolean;
        rule: { id: number } | null;
        abTest: { selectedVariantId: string | null } | null;
      }>(
        app,
        "POST",
        "chatbots.evaluateMessage",
        {
          chatbotId: chatbot.id,
          channel: "whatsapp",
          phone: "5531982066263",
          body: "qual o preco?",
          contactId: contact.id,
          conversationId: conversation.id,
          messageId: message.id,
          sourceEventId: "chatbot-history-msg-1",
        },
        { cookie: cookies, csrfToken },
      );
      expect(evaluation.statusCode, JSON.stringify(evaluation.error)).toBe(200);
      expect(evaluation.data).toEqual(
        expect.objectContaining({
          matched: true,
          persisted: true,
          rule: expect.objectContaining({ id: rule.id }),
          abTest: expect.objectContaining({ selectedVariantId: expect.any(String) }),
        }),
      );

      const history = await trpcCall<{
        events: Array<{ type: string; severity: string; payload: Record<string, unknown> }>;
      }>(
        app,
        "GET",
        "chatbots.executionHistory",
        { chatbotId: chatbot.id, messageId: message.id },
        { cookie: cookies },
      );
      expect(history.statusCode, JSON.stringify(history.error)).toBe(200);
      expect(history.data?.events).toEqual([
        expect.objectContaining({
          type: "chatbot.execution.evaluated",
          severity: "info",
          payload: expect.objectContaining({
            chatbotId: chatbot.id,
            ruleId: rule.id,
            conversationId: conversation.id,
            messageId: message.id,
            matched: true,
            sourceEventId: "chatbot-history-msg-1",
            executionMode: "dry_run",
            wouldEnqueueJobs: false,
          }),
        }),
      ]);
      const variantEvents = await repos.chatbots.listVariantEvents({
        userId: user.id,
        chatbotId: chatbot.id,
        ruleId: rule.id,
      });
      expect(variantEvents).toHaveLength(1);
      expect(variantEvents[0]).toEqual(
        expect.objectContaining({
          eventType: "exposure",
          conversationId: conversation.id,
          messageId: message.id,
          sourceEventId: "chatbot-history-msg-1",
        }),
      );
    } finally {
      await app.close();
      db.close();
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("guards and dispatches V2.10 real remarketing batches", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nuoma-v2-api-remarketing-batch-"));
    const db = openDb(path.join(tempDir, "api.db"));
    await runMigrations(db);
    const repos = createRepositories(db);
    const passwordHash = await argon2.hash("initial-password-123", { type: argon2.argon2id });
    const user = await repos.users.create({
      email: "admin@nuoma.local",
      passwordHash,
      role: "admin",
      displayName: "Admin",
    });
    const campaign = await repos.campaigns.create({
      userId: user.id,
      name: "V2.10 Remarketing Lote Real",
      channel: "whatsapp",
      status: "draft",
      evergreen: false,
      startsAt: null,
      segment: null,
      steps: [
        {
          id: "intro",
          label: "Intro",
          type: "text",
          delaySeconds: 0,
          conditions: [],
          template: "Intro {{telefone}}",
        },
        {
          id: "close",
          label: "Fechamento",
          type: "text",
          delaySeconds: 0,
          conditions: [],
          template: "Fechamento {{telefone}}",
        },
      ],
      metadata: {
        temporaryMessages: {
          enabled: true,
          beforeSendDuration: "24h",
          afterCompletionDuration: "90d",
          restoreOnFailure: true,
        },
      },
    });
    const app = await buildApiApp({
      env: loadApiEnv({
        API_LOG_LEVEL: "silent",
        NODE_ENV: "test",
        API_JWT_SECRET: "test-secret-with-more-than-16-chars",
        DATABASE_URL: path.join(tempDir, "api.db"),
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

      const blocked = await trpcCall<{
        canDispatch: boolean;
        rejected: Array<{ reason: string }>;
        issues: Array<{ code: string; severity: string; count?: number }>;
      }>(
        app,
        "POST",
        "campaigns.remarketingBatchReady",
        {
          campaignId: campaign.id,
          rawPhones: "5531982066263\n5531999999999",
          allowedPhone: "5531982066263",
        },
        { cookie: cookies, csrfToken },
      );
      expect(blocked.statusCode, JSON.stringify(blocked.error)).toBe(200);
      expect(blocked.data?.canDispatch).toBe(false);
      expect(blocked.data?.rejected).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ reason: "not_allowlisted_for_test_execution" }),
        ]),
      );
      expect(blocked.data?.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "batch_has_rejections", severity: "error" }),
        ]),
      );

      const ready = await trpcCall<{
        canDispatch: boolean;
        confirmText: string;
        summary: {
          acceptedRecipients: number;
          plannedJobs: number;
          activeCampaignStepJobs: number;
          activeRecipients: number;
        };
        temporaryMessages: {
          enabled: boolean;
          beforeSendDuration: string | null;
          afterCompletionDuration: string | null;
        };
      }>(
        app,
        "POST",
        "campaigns.remarketingBatchReady",
        {
          campaignId: campaign.id,
          rawPhones: "5531982066263",
          allowedPhone: "5531982066263",
        },
        { cookie: cookies, csrfToken },
      );
      expect(ready.statusCode, JSON.stringify(ready.error)).toBe(200);
      expect(ready.data).toMatchObject({
        canDispatch: true,
        confirmText: "DISPARAR LOTE 1",
        summary: {
          acceptedRecipients: 1,
          plannedJobs: 2,
          activeCampaignStepJobs: 0,
          activeRecipients: 0,
        },
        temporaryMessages: {
          enabled: true,
          beforeSendDuration: "24h",
          afterCompletionDuration: "90d",
        },
      });

      const dispatch = await trpcCall<{
        batchDispatchId: string;
        recipientsCreated: number;
        scheduler: { jobsCreated: number; plannedJobs: Array<{ phone: string }> };
      }>(
        app,
        "POST",
        "campaigns.remarketingBatchDispatch",
        {
          campaignId: campaign.id,
          rawPhones: "5531982066263",
          allowedPhone: "5531982066263",
          confirmText: ready.data!.confirmText,
        },
        { cookie: cookies, csrfToken },
      );
      expect(dispatch.statusCode, JSON.stringify(dispatch.error)).toBe(200);
      expect(dispatch.data).toMatchObject({
        batchDispatchId: expect.stringContaining(`remarketing:${campaign.id}:`),
        recipientsCreated: 1,
        scheduler: {
          jobsCreated: 2,
          plannedJobs: expect.arrayContaining([
            expect.objectContaining({ phone: "5531982066263" }),
          ]),
        },
      });

      const jobs = await repos.jobs.list(user.id, "queued");
      expect(jobs).toHaveLength(2);
      expect(jobs.map((job) => job.payload.temporaryMessages)).toEqual([
        expect.objectContaining({ beforeSendDuration: "24h", afterCompletionDuration: "90d" }),
        expect.objectContaining({ beforeSendDuration: "24h", afterCompletionDuration: "90d" }),
      ]);
      const events = await repos.systemEvents.list({ userId: user.id, limit: 10 });
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "campaign.remarketing_batch.dispatched",
            severity: "info",
            payload: expect.objectContaining({
              campaignId: campaign.id,
              executionMode: "whatsapp_real",
              recipientsCreated: 1,
              jobsCreated: 2,
              guardrails: expect.objectContaining({
                allowlist: true,
                temporaryMessagesM303: true,
                partialBatchBlocked: true,
              }),
            }),
          }),
        ]),
      );
    } finally {
      await app.close();
      db.close();
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
