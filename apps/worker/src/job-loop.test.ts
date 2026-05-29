import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import pino from "pino";

import { loadWorkerEnv } from "@nuoma/config";
import {
  createRepositories,
  openDb,
  runMigrations,
  type DbHandle,
  type Repositories,
} from "@nuoma/db";

vi.mock("./instagram/assisted.js", async () => {
  const actual =
    await vi.importActual<typeof import("./instagram/assisted.js")>("./instagram/assisted.js");
  return {
    ...actual,
    sendInstagramTextViaCdp: vi.fn(async (input) => ({
      mode: input.mediaPaths?.length ? "instagram-media-message" : "instagram-text-message",
      username: input.username,
      threadId: "110051807055981",
      reason: input.reason,
      externalId: "ig-mocked-external",
      pageUrl: "https://www.instagram.com/direct/t/110051807055981/",
      contentType: input.contentType ?? "text",
      mediaCount: input.mediaPaths?.length ?? 0,
    })),
  };
});

import { handleJob } from "./job-handlers.js";
import { createJobLoop } from "./job-loop.js";
import { sendInstagramTextViaCdp } from "./instagram/assisted.js";

let tempDir: string;
let db: DbHandle;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nuoma-v2-worker-"));
  db = openDb(path.join(tempDir, "worker.db"));
  await runMigrations(db);
  vi.mocked(sendInstagramTextViaCdp).mockClear();
});

afterEach(async () => {
  db.close();
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("worker job loop", () => {
  it("does not claim send jobs when no WhatsApp runtime is connected", async () => {
    const repos = createRepositories(db);
    const logger = pino({ level: "silent" });
    const env = loadWorkerEnv({
      NODE_ENV: "test",
      DATABASE_URL: path.join(tempDir, "worker.db"),
      WORKER_ID: "worker-test",
      WORKER_BROWSER_ENABLED: "false",
      WORKER_JOB_LOOP_ENABLED: "true",
    });
    const user = await repos.users.create({
      email: "worker@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    await repos.jobs.create({
      userId: user.id,
      type: "send_message",
      status: "queued",
      payload: {
        conversationId: 1,
        body: "nao enviar",
      },
      scheduledAt: "2026-04-30T12:00:00.000Z",
      maxAttempts: 3,
    });

    const loop = createJobLoop({
      env,
      repos,
      logger,
      handlerContext: {
        env,
        db,
        repos,
        logger,
      },
    });

    const processed = await loop.processOne();
    const queued = await repos.jobs.list(user.id, "queued");

    expect(processed).toBe(false);
    expect(queued).toHaveLength(1);
    expect(queued[0]?.type).toBe("send_message");
  });

  it("can claim Instagram send jobs even when WhatsApp sync is disconnected", async () => {
    const repos = createRepositories(db);
    const logger = pino({ level: "silent" });
    const env = loadWorkerEnv({
      NODE_ENV: "test",
      DATABASE_URL: path.join(tempDir, "worker.db"),
      WORKER_ID: "worker-instagram-only",
      WORKER_BROWSER_ENABLED: "false",
      WORKER_JOB_LOOP_ENABLED: "true",
      IG_SEND_ALLOWED_HANDLES: "gabriell_braga",
    });
    const user = await repos.users.create({
      email: "instagram-only@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const contact = await repos.contacts.create({
      userId: user.id,
      name: "Gabriel IG",
      phone: null,
      email: null,
      primaryChannel: "instagram",
      instagramHandle: "gabriell_braga",
      status: "lead",
      notes: null,
    });
    const conversation = await repos.conversations.create({
      userId: user.id,
      contactId: contact.id,
      channel: "instagram",
      externalThreadId: "ig:gabriell_braga",
      title: "@gabriell_braga",
    });
    await repos.jobs.create({
      userId: user.id,
      type: "send_instagram_message",
      status: "queued",
      payload: {
        conversationId: conversation.id,
        instagramHandle: "gabriell_braga",
        body: "oi ig",
        idempotencyKey: "manual:ig-only",
      },
      scheduledAt: "2026-04-30T12:00:00.000Z",
      maxAttempts: 1,
    });

    const loop = createJobLoop({
      env,
      repos,
      logger,
      handlerContext: {
        env,
        db,
        repos,
        logger,
        instagram: { metrics: { connected: true } } as never,
      },
    });

    const processed = await loop.processOne();
    const completed = await repos.jobs.list(user.id, "completed");

    expect(processed).toBe(true);
    expect(completed).toHaveLength(1);
    expect(sendInstagramTextViaCdp).toHaveBeenCalledWith(
      expect.objectContaining({ username: "gabriell_braga", text: "oi ig" }),
    );
  });

  it("drains Instagram campaign batch siblings by handle without a WhatsApp phone", async () => {
    const repos = createRepositories(db);
    const logger = pino({ level: "silent" });
    const env = loadWorkerEnv({
      NODE_ENV: "test",
      DATABASE_URL: path.join(tempDir, "worker.db"),
      WORKER_ID: "worker-instagram-batch-drain",
      WORKER_BROWSER_ENABLED: "false",
      WORKER_JOB_LOOP_ENABLED: "true",
      IG_SEND_ALLOWED_HANDLES: "gabriell_braga",
    });
    const user = await repos.users.create({
      email: "instagram-batch-drain@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const conversation = await repos.conversations.create({
      userId: user.id,
      channel: "instagram",
      externalThreadId: "ig:gabriell_braga",
      title: "@gabriell_braga",
    });
    const basePayload = {
      campaignId: 301,
      recipientId: null,
      conversationId: conversation.id,
      instagramHandle: "gabriell_braga",
      phone: null,
      campaignBatchId: "ig-batch-drain",
      campaignBatchSize: 2,
      variables: { nome: "Gabriel" },
    };
    const firstJob = await repos.jobs.create({
      userId: user.id,
      type: "campaign_step",
      status: "queued",
      payload: {
        ...basePayload,
        campaignBatchIndex: 0,
        isLastStep: false,
        idempotencyKey: "campaign:ig-batch-drain:1",
        step: {
          id: "ig-intro",
          label: "Intro IG",
          type: "text",
          delaySeconds: 0,
          conditions: [],
          template: "Oi {{nome}} pelo IG",
        },
      },
      scheduledAt: "2026-04-30T12:00:00.000Z",
      maxAttempts: 2,
    });
    const nextJob = await repos.jobs.create({
      userId: user.id,
      type: "campaign_step",
      status: "queued",
      payload: {
        ...basePayload,
        campaignBatchIndex: 1,
        isLastStep: true,
        idempotencyKey: "campaign:ig-batch-drain:2",
        step: {
          id: "ig-follow-up",
          label: "Follow-up IG",
          type: "text",
          delaySeconds: 0,
          conditions: [],
          template: "Segundo toque {{nome}} pelo IG",
        },
      },
      scheduledAt: "2026-04-30T12:00:01.000Z",
      maxAttempts: 2,
    });
    if (!firstJob || !nextJob) {
      throw new Error("expected Instagram campaign_step jobs to be created");
    }

    const loop = createJobLoop({
      env,
      repos,
      logger,
      handlerContext: {
        env,
        db,
        repos,
        logger,
        instagram: { metrics: { connected: true } } as never,
      },
    });

    await expect(loop.processOne()).resolves.toBe(true);

    expect(sendInstagramTextViaCdp).toHaveBeenCalledTimes(2);
    expect(sendInstagramTextViaCdp).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ username: "gabriell_braga", text: "Oi Gabriel pelo IG" }),
    );
    expect(sendInstagramTextViaCdp).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        username: "gabriell_braga",
        text: "Segundo toque Gabriel pelo IG",
      }),
    );
    const completed = await repos.jobs.list(user.id, "completed");
    expect(completed.map((job) => job.id).sort((a, b) => a - b)).toEqual([
      firstJob.id,
      nextJob.id,
    ]);
    const drainEvents = await repos.systemEvents.list({
      userId: user.id,
      type: "sender.campaign_step.batch_drained",
    });
    expect(drainEvents[0]?.payload).toEqual(
      expect.objectContaining({
        rootJobId: firstJob.id,
        campaignBatchId: "ig-batch-drain",
        drainedJobs: 1,
        stopped: false,
      }),
    );
  });

  it("does not claim sync jobs when no sync runtime is connected", async () => {
    const repos = createRepositories(db);
    const logger = pino({ level: "silent" });
    const env = loadWorkerEnv({
      NODE_ENV: "test",
      DATABASE_URL: path.join(tempDir, "worker.db"),
      WORKER_ID: "worker-no-sync",
      WORKER_BROWSER_ENABLED: "false",
      WORKER_JOB_LOOP_ENABLED: "true",
    });
    const user = await repos.users.create({
      email: "nosync@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    await repos.jobs.create({
      userId: user.id,
      type: "sync_conversation",
      status: "queued",
      payload: { conversationId: 1 },
      scheduledAt: "2026-04-30T12:00:00.000Z",
      maxAttempts: 2,
    });

    const loop = createJobLoop({
      env,
      repos,
      logger,
      handlerContext: {
        env,
        db,
        repos,
        logger,
      },
    });

    const processed = await loop.processOne();
    const queued = await repos.jobs.list(user.id, "queued");

    expect(processed).toBe(false);
    expect(queued).toHaveLength(1);
    expect(queued[0]?.type).toBe("sync_conversation");
  });

  it("releases stale claimed jobs only with the idempotency guard and does not increment attempts", async () => {
    const repos = createRepositories(db);
    const logger = pino({ level: "silent" });
    const user = await repos.users.create({
      email: "stale-claim@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const staleClaimedAt = "2026-04-30T11:45:00.000Z";
    const staleJob = await repos.jobs.create({
      userId: user.id,
      type: "send_message",
      status: "claimed",
      payload: {
        conversationId: 1,
        phone: "5531982066263",
        body: "claim preso",
        idempotencyKey: "manual:stale-claim",
      },
      scheduledAt: "2026-04-30T12:00:00.000Z",
      claimedAt: staleClaimedAt,
      claimedBy: "dead-worker",
      attempts: 2,
      maxAttempts: 3,
    });
    if (!staleJob) {
      throw new Error("expected stale send_message job to be created");
    }
    const guardedEnv = loadWorkerEnv({
      NODE_ENV: "test",
      DATABASE_URL: path.join(tempDir, "worker.db"),
      WORKER_ID: "worker-stale-claim",
      WORKER_BROWSER_ENABLED: "false",
      WORKER_JOB_LOOP_ENABLED: "true",
      WORKER_IDEMPOTENCY_GUARD_ENABLED: "true",
      WORKER_STALE_CLAIM_TIMEOUT_MS: "60000",
    });
    const guardedLoop = createJobLoop({
      env: guardedEnv,
      repos,
      logger,
      handlerContext: {
        env: guardedEnv,
        db,
        repos,
        logger,
      },
    });

    const processed = await guardedLoop.processOne();
    const released = db.raw.prepare("select status, claimed_at, attempts from jobs where id = ?").get(
      staleJob.id,
    ) as { status: string; claimed_at: string | null; attempts: number } | undefined;

    expect(processed).toBe(false);
    expect(guardedLoop.state.metrics.reaped).toBe(1);
    expect(released).toEqual({
      status: "queued",
      claimed_at: null,
      attempts: 2,
    });

    const guardOffJob = await repos.jobs.create({
      userId: user.id,
      type: "send_message",
      status: "claimed",
      payload: {
        conversationId: 1,
        phone: "5531982066263",
        body: "claim preso sem guard",
        idempotencyKey: "manual:stale-claim-disabled",
      },
      scheduledAt: "2026-04-30T12:00:00.000Z",
      claimedAt: staleClaimedAt,
      claimedBy: "dead-worker",
      attempts: 2,
      maxAttempts: 3,
    });
    if (!guardOffJob) {
      throw new Error("expected guard-off send_message job to be created");
    }
    const guardOffEnv = loadWorkerEnv({
      NODE_ENV: "test",
      DATABASE_URL: path.join(tempDir, "worker.db"),
      WORKER_ID: "worker-stale-claim-off",
      WORKER_BROWSER_ENABLED: "false",
      WORKER_JOB_LOOP_ENABLED: "true",
      WORKER_IDEMPOTENCY_GUARD_ENABLED: "false",
      WORKER_STALE_CLAIM_TIMEOUT_MS: "60000",
    });
    const guardOffLoop = createJobLoop({
      env: guardOffEnv,
      repos,
      logger,
      handlerContext: {
        env: guardOffEnv,
        db,
        repos,
        logger,
      },
    });

    await guardOffLoop.processOne();
    const stillClaimed = db.raw
      .prepare("select status, claimed_at, attempts from jobs where id = ?")
      .get(guardOffJob.id) as
      | { status: string; claimed_at: string | null; attempts: number }
      | undefined;
    expect(guardOffLoop.state.metrics.reaped).toBe(0);
    expect(stillClaimed).toEqual({
      status: "claimed",
      claimed_at: staleClaimedAt,
      attempts: 2,
    });
  });

  it("runs sync_history as a bounded history backfill for one conversation", async () => {
    const repos = createRepositories(db);
    const logger = pino({ level: "silent" });
    const env = loadWorkerEnv({
      NODE_ENV: "test",
      DATABASE_URL: path.join(tempDir, "worker.db"),
      WORKER_ID: "worker-history",
      WORKER_BROWSER_ENABLED: "false",
      WORKER_JOB_LOOP_ENABLED: "true",
    });
    const user = await repos.users.create({
      email: "history@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const conversation = await repos.conversations.create({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "5531982066263",
      title: "Gabriel Braga Nuoma",
    });
    const calls: unknown[] = [];
    const job = await repos.jobs.create({
      userId: user.id,
      type: "sync_history",
      status: "queued",
      payload: {
        conversationId: conversation.id,
        phone: "5531982066263",
        maxScrolls: 50,
        delayMs: 50,
      },
      scheduledAt: "2026-04-30T12:00:00.000Z",
      maxAttempts: 2,
    });
    expect(job).not.toBeNull();
    if (!job) {
      throw new Error("expected sync_history job to be created");
    }

    await handleJob(job, {
      env,
      db,
      repos,
      logger,
      sync: {
        connected: true,
        metrics: {} as never,
        forceConversation: async (input) => {
          calls.push(input);
          return {
            mode: "phone-navigation",
            conversationId: input.conversationId ?? null,
            phone: input.phone ?? null,
            reason: input.reason ?? "sync.forceConversation",
          };
        },
        sendTextMessage: async () => {
          throw new Error("unexpected send");
        },
        sendVoiceMessage: async () => {
          throw new Error("unexpected voice send");
        },
        sendDocumentMessage: async () => {
          throw new Error("unexpected document send");
        },
        sendMediaMessage: async () => {
          throw new Error("unexpected media send");
        },
        close: async () => {},
      },
    });

    expect(calls).toEqual([
      expect.objectContaining({
        conversationId: conversation.id,
        phone: "5531982066263",
        reason: "sync_history",
        history: {
          enabled: true,
          maxScrolls: 25,
          delayMs: 250,
        },
      }),
    ]);
  });

  it("sends text only when the target phone matches the allowlist", async () => {
    const repos = createRepositories(db);
    const logger = pino({ level: "silent" });
    const env = loadWorkerEnv({
      NODE_ENV: "test",
      DATABASE_URL: path.join(tempDir, "worker.db"),
      WORKER_ID: "worker-send",
      WORKER_BROWSER_ENABLED: "false",
      WORKER_JOB_LOOP_ENABLED: "true",
      WA_SEND_ALLOWED_PHONE: "5531982066263",
    });
    const user = await repos.users.create({
      email: "send@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const conversation = await repos.conversations.create({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "5531982066263",
      title: "Gabriel Braga Nuoma",
    });
    const job = await repos.jobs.create({
      userId: user.id,
      type: "send_message",
      status: "queued",
      payload: {
        conversationId: conversation.id,
        phone: "31982066263",
        body: "teste controlado",
      },
      scheduledAt: "2026-04-30T12:00:00.000Z",
      maxAttempts: 2,
    });
    if (!job) {
      throw new Error("expected send_message job to be created");
    }
    const calls: unknown[] = [];

    await handleJob(job, {
      env,
      db,
      repos,
      logger,
      sync: {
        connected: true,
        metrics: {} as never,
        forceConversation: async () => {
          throw new Error("unexpected force sync");
        },
        sendTextMessage: async (input) => {
          calls.push(input);
          return {
            mode: "text-message",
            conversationId: input.conversationId,
            phone: input.phone,
            reason: input.reason ?? "send_message",
            navigationMode: "reused-open-chat",
            externalId: "after",
            visibleMessageCountBefore: 1,
            visibleMessageCountAfter: 2,
            lastExternalIdBefore: "before",
            lastExternalIdAfter: "after",
          };
        },
        sendVoiceMessage: async () => {
          throw new Error("unexpected voice send");
        },
        sendDocumentMessage: async () => {
          throw new Error("unexpected document send");
        },
        sendMediaMessage: async () => {
          throw new Error("unexpected media send");
        },
        close: async () => {},
      },
    });

    expect(calls).toEqual([
      expect.objectContaining({
        conversationId: conversation.id,
        phone: "5531982066263",
        body: "teste controlado",
        reason: "send_message",
      }),
    ]);
    const events = await repos.systemEvents.list({
      userId: user.id,
      type: "sender.text_message.completed",
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toEqual(
      expect.objectContaining({
        jobId: job.id,
        mode: "text-message",
        navigationMode: "reused-open-chat",
        externalId: "after",
      }),
    );
    const dispatchMessage = await repos.messages.findByIdempotencyKey({
      userId: user.id,
      idempotencyKey: `legacy:job:${job.id}`,
    });
    expect(dispatchMessage).toEqual(
      expect.objectContaining({
        contentType: "text",
        body: "teste controlado",
        status: "sent",
        dispatchAttempts: 1,
      }),
    );
    const dispatchingAudit = await repos.sendAuditEvents.list({
      userId: user.id,
      jobId: job.id,
      phase: "dispatching",
    });
    const sentAudit = await repos.sendAuditEvents.list({
      userId: user.id,
      jobId: job.id,
      phase: "sent",
    });
    expect(dispatchingAudit).toEqual([
      expect.objectContaining({
        channel: "whatsapp",
        conversationId: conversation.id,
        messageId: dispatchMessage?.id,
        workerId: "worker-send",
        metadata: expect.objectContaining({
          idempotencyKey: `legacy:job:${job.id}`,
          contentType: "text",
          reason: "send_message",
          phone: "5531982066263",
        }),
      }),
    ]);
    expect(sentAudit).toEqual([
      expect.objectContaining({
        channel: "whatsapp",
        conversationId: conversation.id,
        messageId: dispatchMessage?.id,
        workerId: "worker-send",
        metadata: expect.objectContaining({
          idempotencyKey: `legacy:job:${job.id}`,
          contentType: "text",
          reason: "send_message",
          externalId: "after",
        }),
      }),
    ]);
  });

  it("skips duplicate text dispatches by idempotency key before calling CDP again", async () => {
    const repos = createRepositories(db);
    const logger = pino({ level: "silent" });
    const env = loadWorkerEnv({
      NODE_ENV: "test",
      DATABASE_URL: path.join(tempDir, "worker.db"),
      WORKER_ID: "worker-send-idempotent",
      WORKER_BROWSER_ENABLED: "false",
      WORKER_JOB_LOOP_ENABLED: "true",
      WA_SEND_ALLOWED_PHONE: "5531982066263",
    });
    const user = await repos.users.create({
      email: "send-idempotent@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const conversation = await repos.conversations.create({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "5531982066263",
      title: "Gabriel Braga Nuoma",
    });
    const idempotencyKey = "manual:test-text-send";
    const job = await repos.jobs.create({
      userId: user.id,
      type: "send_message",
      status: "queued",
      payload: {
        conversationId: conversation.id,
        phone: "5531982066263",
        body: "teste idempotente",
        idempotencyKey,
      },
      scheduledAt: "2026-04-30T12:00:00.000Z",
      maxAttempts: 2,
    });
    if (!job) {
      throw new Error("expected send_message job to be created");
    }
    const calls: unknown[] = [];
    const context = {
      env,
      db,
      repos,
      logger,
      sync: {
        connected: true,
        metrics: {} as never,
        forceConversation: async () => {
          throw new Error("unexpected force sync");
        },
        sendTextMessage: async (input: {
          conversationId: number;
          phone: string;
          body: string;
          reason?: string;
        }) => {
          calls.push(input);
          return {
            mode: "text-message" as const,
            conversationId: input.conversationId,
            phone: input.phone,
            reason: input.reason ?? "send_message",
            navigationMode: "reused-open-chat" as const,
            externalId: "after-idempotent",
            visibleMessageCountBefore: 1,
            visibleMessageCountAfter: 2,
            lastExternalIdBefore: "before",
            lastExternalIdAfter: "after-idempotent",
          };
        },
        sendVoiceMessage: async () => {
          throw new Error("unexpected voice send");
        },
        sendDocumentMessage: async () => {
          throw new Error("unexpected document send");
        },
        sendMediaMessage: async () => {
          throw new Error("unexpected media send");
        },
        close: async () => {},
      },
    };

    await handleJob(job, context);
    await handleJob(job, context);

    expect(calls).toHaveLength(1);
    const message = await repos.messages.findByIdempotencyKey({
      userId: user.id,
      idempotencyKey,
    });
    expect(message).toEqual(
      expect.objectContaining({
        idempotencyKey,
        externalId: "after-idempotent",
        status: "sent",
        dispatchAttempts: 1,
      }),
    );
    const attempts = await repos.messageDispatchAttempts.listByKey(idempotencyKey);
    expect(attempts.map((attempt) => attempt.phase)).toEqual(["sent", "skipped_duplicate"]);
    const duplicateAudit = await repos.sendAuditEvents.list({
      userId: user.id,
      jobId: job.id,
      phase: "duplicate",
    });
    expect(duplicateAudit).toEqual([
      expect.objectContaining({
        channel: "whatsapp",
        conversationId: conversation.id,
        messageId: message?.id,
        workerId: "worker-send-idempotent",
        metadata: expect.objectContaining({
          idempotencyKey,
          contentType: "text",
          reason: "send_message",
          externalId: "after-idempotent",
          existingStatus: "sent",
        }),
      }),
    ]);
  });

  it("skips duplicate voice, document, media, and campaign step dispatches before CDP", async () => {
    const repos = createRepositories(db);
    const logger = pino({ level: "silent" });
    const env = loadWorkerEnv({
      NODE_ENV: "test",
      DATABASE_URL: path.join(tempDir, "worker.db"),
      WORKER_ID: "worker-send-idempotent-all",
      WORKER_BROWSER_ENABLED: "false",
      WORKER_JOB_LOOP_ENABLED: "true",
      WORKER_TEMP_DIR: tempDir,
      WA_SEND_ALLOWED_PHONE: "5531982066263",
    });
    const user = await repos.users.create({
      email: "send-idempotent-all@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const conversation = await repos.conversations.create({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "5531982066263",
      title: "Gabriel Braga Nuoma",
    });
    const imagePath = path.join(tempDir, "duplicate-skip.jpg");
    await fs.writeFile(imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const mediaAsset = await repos.mediaAssets.create({
      userId: user.id,
      type: "image",
      fileName: "duplicate-skip.jpg",
      mimeType: "image/jpeg",
      sha256: "c".repeat(64),
      sizeBytes: (await fs.stat(imagePath)).size,
      durationMs: null,
      storagePath: imagePath,
    });
    const cases = [
      {
        type: "send_voice" as const,
        key: "manual:test-voice-duplicate",
        contentType: "voice" as const,
        payload: {
          conversationId: conversation.id,
          phone: "5531982066263",
          audioPath: path.join(tempDir, "missing-duplicate-voice.wav"),
          idempotencyKey: "manual:test-voice-duplicate",
        },
      },
      {
        type: "send_document" as const,
        key: "manual:test-document-duplicate",
        contentType: "document" as const,
        payload: {
          conversationId: conversation.id,
          phone: "5531982066263",
          documentPath: path.join(tempDir, "missing-duplicate-document.pdf"),
          fileName: "duplicate.pdf",
          mimeType: "application/pdf",
          caption: "Documento duplicado",
          idempotencyKey: "manual:test-document-duplicate",
        },
      },
      {
        type: "send_media" as const,
        key: "manual:test-media-duplicate",
        contentType: "image" as const,
        payload: {
          conversationId: conversation.id,
          phone: "5531982066263",
          mediaAssetId: mediaAsset.id,
          mediaType: "image",
          caption: "Imagem duplicada",
          idempotencyKey: "manual:test-media-duplicate",
        },
      },
      {
        type: "campaign_step" as const,
        key: "campaign:test-step-duplicate",
        contentType: "text" as const,
        payload: {
          campaignId: 900,
          recipientId: 901,
          conversationId: conversation.id,
          phone: "5531982066263",
          idempotencyKey: "campaign:test-step-duplicate",
          step: {
            id: "duplicate-step",
            label: "Duplicate step",
            type: "text",
            delaySeconds: 0,
            conditions: [],
            template: "Campanha duplicada",
          },
        },
      },
    ];

    for (const testCase of cases) {
      const upsert = await repos.messages.upsertOutboundByKey({
        idempotencyKey: testCase.key,
        userId: user.id,
        conversationId: conversation.id,
        contactId: conversation.contactId,
        externalId: null,
        direction: "outbound",
        contentType: testCase.contentType,
        status: "pending",
        body: "duplicate placeholder",
        mediaAssetId: testCase.type === "send_media" ? mediaAsset.id : null,
        media: null,
        quotedMessageId: null,
        waDisplayedAt: null,
        timestampPrecision: "unknown",
        messageSecond: null,
        waInferredSecond: null,
        observedAtUtc: new Date().toISOString(),
        raw: { source: "test" },
      });
      await repos.messages.markDispatched({ id: upsert.message.id, dispatchAttempts: 1 });
      await repos.messages.updateStatus(upsert.message.id, "sent");
      const job = await repos.jobs.create({
        userId: user.id,
        type: testCase.type,
        status: "queued",
        payload: testCase.payload,
        scheduledAt: "2026-04-30T12:00:00.000Z",
        maxAttempts: 2,
      });
      if (!job) {
        throw new Error(`expected ${testCase.type} job to be created`);
      }
      await handleJob(job, {
        env,
        db,
        repos,
        logger,
        sync: {
          connected: true,
          metrics: {} as never,
          forceConversation: async () => {
            throw new Error("unexpected force sync");
          },
          sendTextMessage: async () => {
            throw new Error(`unexpected text send for ${testCase.type}`);
          },
          sendVoiceMessage: async () => {
            throw new Error(`unexpected voice send for ${testCase.type}`);
          },
          sendDocumentMessage: async () => {
            throw new Error(`unexpected document send for ${testCase.type}`);
          },
          sendMediaMessage: async () => {
            throw new Error(`unexpected media send for ${testCase.type}`);
          },
          close: async () => {},
        },
      });
      const attempts = await repos.messageDispatchAttempts.listByKey(testCase.key);
      expect(attempts.map((attempt) => attempt.phase)).toEqual(["skipped_duplicate"]);
    }
  });

  it("retries when the first idempotent dispatch fails before a send is confirmed", async () => {
    const repos = createRepositories(db);
    const logger = pino({ level: "silent" });
    const env = loadWorkerEnv({
      NODE_ENV: "test",
      DATABASE_URL: path.join(tempDir, "worker.db"),
      WORKER_ID: "worker-send-idempotent-retry",
      WORKER_BROWSER_ENABLED: "false",
      WORKER_JOB_LOOP_ENABLED: "true",
      WA_SEND_ALLOWED_PHONE: "5531982066263",
    });
    const user = await repos.users.create({
      email: "send-idempotent-retry@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const conversation = await repos.conversations.create({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "5531982066263",
      title: "Gabriel Braga Nuoma",
    });
    const idempotencyKey = "manual:test-text-retry";
    const job = await repos.jobs.create({
      userId: user.id,
      type: "send_message",
      status: "queued",
      payload: {
        conversationId: conversation.id,
        phone: "5531982066263",
        body: "retry depois de falha",
        idempotencyKey,
      },
      scheduledAt: "2026-04-30T12:00:00.000Z",
      maxAttempts: 2,
    });
    if (!job) {
      throw new Error("expected send_message job to be created");
    }
    let calls = 0;
    const context = {
      env,
      db,
      repos,
      logger,
      sync: {
        connected: true,
        metrics: {} as never,
        forceConversation: async () => {
          throw new Error("unexpected force sync");
        },
        sendTextMessage: async (input: {
          conversationId: number;
          phone: string;
          body: string;
          reason?: string;
        }) => {
          calls += 1;
          if (calls === 1) {
            throw new Error("navigation failed before send");
          }
          return {
            mode: "text-message" as const,
            conversationId: input.conversationId,
            phone: input.phone,
            reason: input.reason ?? "send_message",
            navigationMode: "reused-open-chat" as const,
            externalId: "after-retry",
            visibleMessageCountBefore: 1,
            visibleMessageCountAfter: 2,
            lastExternalIdBefore: "before",
            lastExternalIdAfter: "after-retry",
          };
        },
        sendVoiceMessage: async () => {
          throw new Error("unexpected voice send");
        },
        sendDocumentMessage: async () => {
          throw new Error("unexpected document send");
        },
        sendMediaMessage: async () => {
          throw new Error("unexpected media send");
        },
        close: async () => {},
      },
    };

    await expect(handleJob(job, context)).rejects.toThrow("navigation failed before send");
    await handleJob(job, context);

    expect(calls).toBe(2);
    const message = await repos.messages.findByIdempotencyKey({
      userId: user.id,
      idempotencyKey,
    });
    expect(message).toEqual(
      expect.objectContaining({
        idempotencyKey,
        externalId: "after-retry",
        status: "sent",
        dispatchAttempts: 1,
      }),
    );
    const attempts = await repos.messageDispatchAttempts.listByKey(idempotencyKey);
    expect(attempts.map((attempt) => attempt.phase)).toEqual(["failed", "sent"]);
    const failedAudit = await repos.sendAuditEvents.list({
      userId: user.id,
      jobId: job.id,
      phase: "failed",
    });
    expect(failedAudit).toEqual([
      expect.objectContaining({
        channel: "whatsapp",
        conversationId: conversation.id,
        messageId: message?.id,
        workerId: "worker-send-idempotent-retry",
        errorCode: "dispatch_failed",
        errorMessage: "navigation failed before send",
        metadata: expect.objectContaining({
          idempotencyKey,
          contentType: "text",
          reason: "send_message",
          phone: "5531982066263",
        }),
      }),
    ]);
  });

  it("sends Instagram campaign image steps and materializes the real Direct thread", async () => {
    const repos = createRepositories(db);
    const logger = pino({ level: "silent" });
    const env = loadWorkerEnv({
      NODE_ENV: "test",
      DATABASE_URL: path.join(tempDir, "worker.db"),
      WORKER_ID: "worker-instagram-media",
      WORKER_BROWSER_ENABLED: "false",
      WORKER_JOB_LOOP_ENABLED: "true",
      IG_SEND_ALLOWED_HANDLES: "gabriell_braga",
    });
    const user = await repos.users.create({
      email: "instagram-media@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const contact = await repos.contacts.create({
      userId: user.id,
      name: "Gabriel Braga",
      phone: null,
      email: null,
      primaryChannel: "instagram",
      instagramHandle: "gabriell_braga",
      status: "lead",
      notes: null,
    });
    const conversation = await repos.conversations.create({
      userId: user.id,
      contactId: contact.id,
      channel: "instagram",
      externalThreadId: "ig:gabriell_braga",
      title: "@gabriell_braga",
    });
    const imagePath = path.join(tempDir, "ig-campaign.jpg");
    await fs.writeFile(imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const mediaAsset = await repos.mediaAssets.create({
      userId: user.id,
      type: "image",
      fileName: "ig-campaign.jpg",
      mimeType: "image/jpeg",
      sha256: "d".repeat(64),
      sizeBytes: (await fs.stat(imagePath)).size,
      durationMs: null,
      storagePath: imagePath,
    });
    const job = await repos.jobs.create({
      userId: user.id,
      type: "campaign_step",
      status: "queued",
      payload: {
        campaignId: 700,
        recipientId: 701,
        conversationId: conversation.id,
        instagramHandle: "gabriell_braga",
        phone: null,
        idempotencyKey: "campaign:ig-media",
        step: {
          id: "ig-image",
          label: "Imagem IG",
          type: "image",
          delaySeconds: 0,
          conditions: [],
          mediaAssetId: mediaAsset.id,
          caption: "Legenda IG",
        },
        variables: {},
        isLastStep: true,
      },
      scheduledAt: "2026-04-30T12:00:00.000Z",
      maxAttempts: 1,
    });
    if (!job) throw new Error("expected instagram campaign_step job");

    await handleJob(job, { env, db, repos, logger });

    expect(sendInstagramTextViaCdp).toHaveBeenCalledWith(
      expect.objectContaining({
        username: "gabriell_braga",
        text: "Legenda IG",
        mediaPaths: [imagePath],
        contentType: "image",
        reason: "campaign_step",
      }),
    );
    const materialized = await repos.conversations.findByExternalThread({
      userId: user.id,
      channel: "instagram",
      externalThreadId: "110051807055981",
    });
    expect(materialized).toEqual(expect.objectContaining({ id: conversation.id }));
    const message = await repos.messages.findByIdempotencyKey({
      userId: user.id,
      idempotencyKey: "campaign:ig-media",
    });
    expect(message).toEqual(
      expect.objectContaining({
        conversationId: conversation.id,
        contentType: "image",
        status: "sent",
        externalId: "ig-mocked-external",
      }),
    );
  });

  it("marks failed Instagram dispatch drafts and clears terminal campaign awaiting metadata", async () => {
    const repos = createRepositories(db);
    const logger = pino({ level: "silent" });
    const env = loadWorkerEnv({
      NODE_ENV: "test",
      DATABASE_URL: path.join(tempDir, "worker.db"),
      WORKER_ID: "worker-instagram-failure",
      WORKER_BROWSER_ENABLED: "false",
      WORKER_JOB_LOOP_ENABLED: "true",
      IG_SEND_ALLOWED_HANDLES: "gabriell_braga",
    });
    vi.mocked(sendInstagramTextViaCdp).mockRejectedValueOnce(new Error("Instagram composer failed"));
    const user = await repos.users.create({
      email: "instagram-failure@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const conversation = await repos.conversations.create({
      userId: user.id,
      channel: "instagram",
      externalThreadId: "ig:gabriell_braga",
      title: "@gabriell_braga",
    });
    const campaign = await repos.campaigns.create({
      userId: user.id,
      name: "IG falha",
      channel: "instagram",
      status: "running",
      evergreen: false,
      startsAt: null,
      segment: null,
      steps: [
        {
          id: "ig-text",
          label: "Texto IG",
          type: "text",
          delaySeconds: 0,
          conditions: [],
          template: "Mensagem falha",
        },
      ],
      metadata: {},
    });
    const recipient = await repos.campaignRecipients.create({
      userId: user.id,
      campaignId: campaign.id,
      contactId: null,
      phone: null,
      channel: "instagram",
      status: "running",
      currentStepId: null,
      lastError: null,
      metadata: {
        instagramHandle: "gabriell_braga",
        awaitingJobId: 0,
        awaitingStepId: "ig-text",
        awaitingJobIds: [],
        awaitingStepIds: ["ig-text"],
      },
    });
    const job = await repos.jobs.create({
      userId: user.id,
      type: "campaign_step",
      status: "queued",
      payload: {
        campaignId: campaign.id,
        recipientId: recipient.id,
        conversationId: conversation.id,
        instagramHandle: "gabriell_braga",
        phone: null,
        idempotencyKey: "campaign:ig-failure",
        step: campaign.steps[0],
        variables: {},
        isLastStep: true,
      },
      scheduledAt: "2026-04-30T12:00:00.000Z",
      maxAttempts: 1,
    });
    if (!job) throw new Error("expected instagram failure job");
    await repos.campaignRecipients.updateState({
      userId: user.id,
      id: recipient.id,
      metadata: {
        ...recipient.metadata,
        awaitingJobId: job.id,
        awaitingJobIds: [job.id],
      },
    });

    await expect(handleJob({ ...job, attempts: 1 }, { env, db, repos, logger })).rejects.toThrow(
      "Instagram composer failed",
    );

    const message = await repos.messages.findByIdempotencyKey({
      userId: user.id,
      idempotencyKey: "campaign:ig-failure",
    });
    expect(message).toEqual(expect.objectContaining({ status: "failed", dispatchAttempts: 0 }));
    const updatedRecipient = await repos.campaignRecipients.findById({
      userId: user.id,
      id: recipient.id,
    });
    expect(updatedRecipient).toEqual(
      expect.objectContaining({
        status: "failed",
        lastError: "Instagram composer failed",
        metadata: expect.objectContaining({
          awaitingJobId: null,
          awaitingStepId: null,
          awaitingJobIds: [],
          awaitingStepIds: [],
          lastFailureTerminal: true,
        }),
      }),
    );
  });

  it("does not re-dispatch when a job retries after send but before completion", async () => {
    const repos = createRepositories(db);
    const logger = pino({ level: "silent" });
    const env = loadWorkerEnv({
      NODE_ENV: "test",
      DATABASE_URL: path.join(tempDir, "worker.db"),
      WORKER_ID: "worker-send-crash-proof",
      WORKER_BROWSER_ENABLED: "false",
      WORKER_JOB_LOOP_ENABLED: "true",
      WA_SEND_ALLOWED_PHONE: "5531982066263",
    });
    const user = await repos.users.create({
      email: "send-crash-proof@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const conversation = await repos.conversations.create({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "5531982066263",
      title: "Gabriel Braga Nuoma",
    });
    const idempotencyKey = "manual:test-crash-after-send";
    const job = await repos.jobs.create({
      userId: user.id,
      type: "send_message",
      status: "queued",
      payload: {
        conversationId: conversation.id,
        phone: "5531982066263",
        body: "crash depois do send",
        clientNonce: "composer:text:crash-proof",
        idempotencyKey,
      },
      scheduledAt: "2026-04-30T12:00:00.000Z",
      maxAttempts: 3,
    });
    if (!job) {
      throw new Error("expected send_message job to be created");
    }

    let sendCalls = 0;
    let failMarkCompletedOnce = true;
    const flakyRepos: Repositories = {
      ...repos,
      jobs: {
        ...repos.jobs,
        markCompleted: async (jobId: number, workerId?: string) => {
          if (failMarkCompletedOnce) {
            failMarkCompletedOnce = false;
            throw new Error("simulated crash after send before markCompleted");
          }
          return repos.jobs.markCompleted(jobId, workerId);
        },
      },
    };
    const loop = createJobLoop({
      env,
      repos: flakyRepos,
      logger,
      handlerContext: {
        env,
        db,
        repos: flakyRepos,
        logger,
        sync: {
          connected: true,
          metrics: {} as never,
          forceConversation: async () => {
            throw new Error("unexpected force sync");
          },
          sendTextMessage: async (input: {
            conversationId: number;
            phone: string;
            body: string;
            reason?: string;
          }) => {
            sendCalls += 1;
            if (sendCalls > 1) {
              throw new Error("duplicate CDP send");
            }
            return {
              mode: "text-message" as const,
              conversationId: input.conversationId,
              phone: input.phone,
              reason: input.reason ?? "send_message",
              navigationMode: "reused-open-chat" as const,
              externalId: "crash-proof-external",
              visibleMessageCountBefore: 1,
              visibleMessageCountAfter: 2,
              lastExternalIdBefore: "before",
              lastExternalIdAfter: "crash-proof-external",
            };
          },
          sendVoiceMessage: async () => {
            throw new Error("unexpected voice send");
          },
          sendDocumentMessage: async () => {
            throw new Error("unexpected document send");
          },
          sendMediaMessage: async () => {
            throw new Error("unexpected media send");
          },
          close: async () => {},
        },
      },
    });

    await loop.processOne();
    expect(loop.state.lastError).toBe("simulated crash after send before markCompleted");
    expect(sendCalls).toBe(1);
    db.raw
      .prepare("update jobs set scheduled_at = ? where id = ?")
      .run("2026-04-30T12:00:00.000Z", job.id);

    await loop.processOne();

    expect(sendCalls).toBe(1);
    const storedJob = db.raw.prepare("select status, attempts from jobs where id = ?").get(job.id) as
      | { status: string; attempts: number }
      | undefined;
    expect(storedJob).toEqual({ status: "completed", attempts: 2 });
    const message = await repos.messages.findByIdempotencyKey({
      userId: user.id,
      idempotencyKey,
    });
    expect(message).toEqual(
      expect.objectContaining({
        idempotencyKey,
        externalId: "crash-proof-external",
        status: "sent",
        dispatchAttempts: 1,
        raw: expect.objectContaining({
          clientNonce: "composer:text:crash-proof",
        }),
      }),
    );
    const attempts = await repos.messageDispatchAttempts.listByKey(idempotencyKey);
    expect(attempts.map((attempt) => attempt.phase)).toEqual(["sent", "skipped_duplicate"]);
  });

  it("does not fail when sync already reconciled the returned external id", async () => {
    const repos = createRepositories(db);
    const logger = pino({ level: "silent" });
    const env = loadWorkerEnv({
      NODE_ENV: "test",
      DATABASE_URL: path.join(tempDir, "worker.db"),
      WORKER_ID: "worker-send-sync-race",
      WORKER_BROWSER_ENABLED: "false",
      WORKER_JOB_LOOP_ENABLED: "true",
      WA_SEND_ALLOWED_PHONE: "5531982066263",
    });
    const user = await repos.users.create({
      email: "send-sync-race@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const conversation = await repos.conversations.create({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "5531982066263",
      title: "Gabriel Braga Nuoma",
    });
    const idempotencyKey = "manual:test-sync-race";
    const job = await repos.jobs.create({
      userId: user.id,
      type: "send_message",
      status: "queued",
      payload: {
        conversationId: conversation.id,
        phone: "5531982066263",
        body: "sync race",
        idempotencyKey,
      },
      scheduledAt: "2026-04-30T12:00:00.000Z",
      maxAttempts: 2,
    });
    if (!job) {
      throw new Error("expected send_message job to be created");
    }

    await handleJob(job, {
      env,
      db,
      repos,
      logger,
      sync: {
        connected: true,
        metrics: {} as never,
        forceConversation: async () => {
          throw new Error("unexpected force sync");
        },
        sendTextMessage: async (input) => {
          await repos.messages.create({
            userId: user.id,
            conversationId: conversation.id,
            contactId: conversation.contactId,
            externalId: "already-synced",
            direction: "outbound",
            contentType: "text",
            status: "sent",
            body: input.body,
            media: null,
            raw: null,
            observedAtUtc: new Date().toISOString(),
          });
          return {
            mode: "text-message",
            conversationId: input.conversationId,
            phone: input.phone,
            reason: input.reason ?? "send_message",
            navigationMode: "reused-open-chat",
            externalId: "already-synced",
            visibleMessageCountBefore: 1,
            visibleMessageCountAfter: 2,
            lastExternalIdBefore: "before",
            lastExternalIdAfter: "already-synced",
          };
        },
        sendVoiceMessage: async () => {
          throw new Error("unexpected voice send");
        },
        sendDocumentMessage: async () => {
          throw new Error("unexpected document send");
        },
        sendMediaMessage: async () => {
          throw new Error("unexpected media send");
        },
        close: async () => {},
      },
    });

    const message = await repos.messages.findByIdempotencyKey({
      userId: user.id,
      idempotencyKey,
    });
    const synced = await repos.messages.findByExternalId({
      userId: user.id,
      conversationId: conversation.id,
      externalId: "already-synced",
    });
    expect(message).toEqual(
      expect.objectContaining({
        id: synced?.id,
        idempotencyKey,
        externalId: "already-synced",
        status: "sent",
        dispatchAttempts: 1,
      }),
    );
    expect(synced).toEqual(
      expect.objectContaining({
        idempotencyKey,
        externalId: "already-synced",
        status: "sent",
        dispatchAttempts: 1,
      }),
    );
    const visibleMessages = await repos.messages.listByConversation({
      userId: user.id,
      conversationId: conversation.id,
    });
    expect(visibleMessages).toHaveLength(1);
  });

  it("blocks non-allowlisted targets in test send policy and audits the decision", async () => {
    const repos = createRepositories(db);
    const logger = pino({ level: "silent" });
    const env = loadWorkerEnv({
      NODE_ENV: "test",
      DATABASE_URL: path.join(tempDir, "worker.db"),
      WORKER_ID: "worker-send-test-policy",
      WORKER_BROWSER_ENABLED: "false",
      WORKER_JOB_LOOP_ENABLED: "true",
      WA_SEND_POLICY_MODE: "test",
      WA_SEND_ALLOWED_PHONES: "5531982066263",
    });
    const user = await repos.users.create({
      email: "send-policy-test@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const conversation = await repos.conversations.create({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "5531999999999",
      title: "Outro contato",
    });
    const job = await repos.jobs.create({
      userId: user.id,
      type: "send_message",
      status: "queued",
      payload: {
        conversationId: conversation.id,
        phone: "5531999999999",
        body: "nao enviar",
      },
      scheduledAt: "2026-04-30T12:00:00.000Z",
      maxAttempts: 2,
    });
    if (!job) {
      throw new Error("expected send_message job to be created");
    }
    const calls: unknown[] = [];

    await expect(
      handleJob(job, {
        env,
        db,
        repos,
        logger,
        sync: {
          connected: true,
          metrics: {} as never,
          forceConversation: async () => {
            throw new Error("unexpected force sync");
          },
          sendTextMessage: async (input) => {
            calls.push(input);
            throw new Error("unexpected text send");
          },
          sendVoiceMessage: async () => {
            throw new Error("unexpected voice send");
          },
          sendDocumentMessage: async () => {
            throw new Error("unexpected document send");
          },
          sendMediaMessage: async () => {
            throw new Error("unexpected media send");
          },
          close: async () => {},
        },
      }),
    ).rejects.toThrow("not_allowlisted_for_test_execution");

    expect(calls).toHaveLength(0);
    const events = await repos.systemEvents.list({
      userId: user.id,
      type: "sender.send_policy.blocked",
    });
    expect(events[0]?.payload).toEqual(
      expect.objectContaining({
        jobId: job.id,
        phone: "5531999999999",
        decision: "blocked",
        reason: "not_allowlisted_for_test_execution",
        policyMode: "test",
      }),
    );
    const policyAudit = await repos.sendAuditEvents.list({
      userId: user.id,
      jobId: job.id,
      phase: "policy_block",
    });
    expect(policyAudit).toEqual([
      expect.objectContaining({
        channel: "whatsapp",
        conversationId: conversation.id,
        workerId: "worker-send-test-policy",
        errorCode: "not_allowlisted_for_test_execution",
        metadata: expect.objectContaining({
          jobType: "send_message",
          phone: "5531999999999",
          policyMode: "test",
          allowedPhonesCount: 1,
        }),
      }),
    ]);
  });

  it("records started and failed evidence for campaign steps before retry or DLQ handling", async () => {
    const repos = createRepositories(db);
    const logger = pino({ level: "silent" });
    const env = loadWorkerEnv({
      NODE_ENV: "test",
      DATABASE_URL: path.join(tempDir, "worker.db"),
      WORKER_ID: "worker-campaign-evidence",
      WORKER_BROWSER_ENABLED: "false",
      WORKER_JOB_LOOP_ENABLED: "true",
      WA_SEND_ALLOWED_PHONE: "5531982066263",
    });
    const user = await repos.users.create({
      email: "campaign-evidence@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const conversation = await repos.conversations.create({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "5531982066263",
      title: "Gabriel Braga Nuoma",
    });
    const campaign = await repos.campaigns.create({
      userId: user.id,
      name: "Evidencia",
      channel: "whatsapp",
      status: "running",
      evergreen: false,
      startsAt: null,
      segment: null,
      steps: [
        {
          id: "step-fail",
          label: "Falha controlada",
          type: "text",
          delaySeconds: 0,
          conditions: [],
          template: "Oi {{nome}}",
        },
      ],
      metadata: {},
    });
    const recipient = await repos.campaignRecipients.create({
      userId: user.id,
      campaignId: campaign.id,
      contactId: null,
      phone: "5531982066263",
      channel: "whatsapp",
      status: "running",
      currentStepId: null,
      metadata: {},
    });
    await repos.jobs.create({
      userId: user.id,
      type: "campaign_step",
      status: "queued",
      payload: {
        campaignId: campaign.id,
        recipientId: recipient.id,
        conversationId: conversation.id,
        phone: "5531982066263",
        step: campaign.steps[0],
        variables: {},
      },
      scheduledAt: "2026-04-30T12:00:00.000Z",
      maxAttempts: 1,
    });
    const [job] = await repos.jobs.claimDueJobs({
      workerId: "worker-campaign-evidence",
      now: "2026-04-30T12:00:01.000Z",
      limit: 1,
    });
    if (!job) {
      throw new Error("expected campaign_step job to be created");
    }

    await expect(
      handleJob(job, {
        env,
        db,
        repos,
        logger,
        sync: {
          connected: true,
          metrics: {} as never,
          forceConversation: async () => {
            throw new Error("unexpected force sync");
          },
          sendTextMessage: async () => {
            throw new Error("unexpected text send");
          },
          sendVoiceMessage: async () => {
            throw new Error("unexpected voice send");
          },
          sendDocumentMessage: async () => {
            throw new Error("unexpected document send");
          },
          sendMediaMessage: async () => {
            throw new Error("unexpected media send");
          },
          close: async () => {},
        },
      }),
    ).rejects.toThrow("missing template variables");

    const started = await repos.systemEvents.list({
      userId: user.id,
      type: "sender.campaign_step.started",
    });
    const failed = await repos.systemEvents.list({
      userId: user.id,
      type: "sender.campaign_step.failed",
    });
    const updated = await repos.campaignRecipients.findById({
      userId: user.id,
      id: recipient.id,
    });

    expect(started[0]?.payload).toEqual(
      expect.objectContaining({
        jobId: job.id,
        stepId: "step-fail",
        evidence: expect.objectContaining({ phase: "before_runtime_send" }),
      }),
    );
    expect(failed[0]?.payload).toEqual(
      expect.objectContaining({
        jobId: job.id,
        stepId: "step-fail",
        terminal: true,
        error: expect.stringContaining("nome"),
      }),
    );
    expect(updated?.status).toBe("failed");
    expect(updated?.metadata).toEqual(
      expect.objectContaining({
        lastFailedJobId: job.id,
        lastFailedStepId: "step-fail",
        lastFailureTerminal: true,
        auditTrail: [
          expect.objectContaining({
            event: "campaign_step.started",
            source: "worker_campaign_step",
            jobId: job.id,
            stepId: "step-fail",
            status: "running",
          }),
          expect.objectContaining({
            event: "campaign_step.failed",
            source: "worker_campaign_step",
            jobId: job.id,
            stepId: "step-fail",
            status: "failed",
            terminal: true,
            error: expect.stringContaining("nome"),
          }),
        ],
      }),
    );
  });

  it("blocks production send policy without a canary allowlist before touching WhatsApp", async () => {
    const repos = createRepositories(db);
    const logger = pino({ level: "silent" });
    const env = loadWorkerEnv({
      NODE_ENV: "test",
      DATABASE_URL: path.join(tempDir, "worker.db"),
      WORKER_ID: "worker-send-production-policy",
      WORKER_BROWSER_ENABLED: "false",
      WORKER_JOB_LOOP_ENABLED: "true",
      WA_SEND_POLICY_MODE: "production",
      WA_SEND_RATE_LIMIT_MAX: "2",
    });
    const user = await repos.users.create({
      email: "send-policy-prod@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const conversation = await repos.conversations.create({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "5531999999999",
      title: "Contato producao",
    });
    const job = await repos.jobs.create({
      userId: user.id,
      type: "send_message",
      status: "queued",
      payload: {
        conversationId: conversation.id,
        phone: "5531999999999",
        body: "envio permitido pela politica",
      },
      scheduledAt: "2026-04-30T12:00:00.000Z",
      maxAttempts: 2,
    });
    if (!job) {
      throw new Error("expected send_message job to be created");
    }
    const calls: unknown[] = [];

    await expect(
      handleJob(job, {
        env,
        db,
        repos,
        logger,
        sync: {
          connected: true,
          metrics: {} as never,
          forceConversation: async () => {
            throw new Error("unexpected force sync");
          },
          sendTextMessage: async (input) => {
            calls.push(input);
            return {
              mode: "text-message",
              conversationId: input.conversationId,
              phone: input.phone,
              reason: input.reason ?? "send_message",
              navigationMode: "navigated",
              externalId: "prod-after",
              visibleMessageCountBefore: 1,
              visibleMessageCountAfter: 2,
              lastExternalIdBefore: "prod-before",
              lastExternalIdAfter: "prod-after",
            };
          },
          sendVoiceMessage: async () => {
            throw new Error("unexpected voice send");
          },
          sendDocumentMessage: async () => {
            throw new Error("unexpected document send");
          },
          sendMediaMessage: async () => {
            throw new Error("unexpected media send");
          },
          close: async () => {},
        },
      }),
    ).rejects.toThrow("production_without_canary_allowlist");

    expect(calls).toEqual([]);
    const events = await repos.systemEvents.list({
      userId: user.id,
      type: "sender.send_policy.blocked",
    });
    expect(events[0]?.payload).toEqual(
      expect.objectContaining({
        jobId: job.id,
        phone: "5531999999999",
        decision: "blocked",
        reason: "production_without_canary_allowlist",
        policyMode: "production",
        allowedPhonesCount: 0,
      }),
    );
  });

  it("rate-limits allowed production sends before touching the WhatsApp runtime", async () => {
    const repos = createRepositories(db);
    const logger = pino({ level: "silent" });
    const env = loadWorkerEnv({
      NODE_ENV: "test",
      DATABASE_URL: path.join(tempDir, "worker.db"),
      WORKER_ID: "worker-send-rate-limit",
      WORKER_BROWSER_ENABLED: "false",
      WORKER_JOB_LOOP_ENABLED: "true",
      WA_SEND_POLICY_MODE: "production",
      WA_SEND_ALLOWED_PHONES: "5531999999999",
      WA_SEND_RATE_LIMIT_MAX: "1",
      WA_SEND_RATE_LIMIT_WINDOW_MS: "60000",
    });
    const user = await repos.users.create({
      email: "send-policy-rate@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const conversation = await repos.conversations.create({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "5531999999999",
      title: "Contato rate limit",
    });
    const firstJob = await repos.jobs.create({
      userId: user.id,
      type: "send_message",
      status: "queued",
      payload: {
        conversationId: conversation.id,
        phone: "5531999999999",
        body: "primeiro envio",
      },
      scheduledAt: "2026-04-30T12:00:00.000Z",
      maxAttempts: 2,
    });
    const secondJob = await repos.jobs.create({
      userId: user.id,
      type: "send_message",
      status: "queued",
      payload: {
        conversationId: conversation.id,
        phone: "5531999999999",
        body: "segundo envio",
      },
      scheduledAt: "2026-04-30T12:00:01.000Z",
      maxAttempts: 2,
    });
    if (!firstJob || !secondJob) {
      throw new Error("expected send_message jobs to be created");
    }
    const calls: unknown[] = [];
    const sync = {
      connected: true,
      metrics: {} as never,
      forceConversation: async () => {
        throw new Error("unexpected force sync");
      },
      sendTextMessage: async (input: {
        phone: string;
        body: string;
        conversationId: number;
        reason?: string;
      }) => {
        calls.push(input);
        return {
          mode: "text-message" as const,
          conversationId: input.conversationId,
          phone: input.phone,
          reason: input.reason ?? "send_message",
          navigationMode: "navigated" as const,
          externalId: `after-${calls.length}`,
          visibleMessageCountBefore: calls.length,
          visibleMessageCountAfter: calls.length + 1,
          lastExternalIdBefore: "before",
          lastExternalIdAfter: `after-${calls.length}`,
        };
      },
      sendVoiceMessage: async () => {
        throw new Error("unexpected voice send");
      },
      sendDocumentMessage: async () => {
        throw new Error("unexpected document send");
      },
      sendMediaMessage: async () => {
        throw new Error("unexpected media send");
      },
      close: async () => {},
    };

    await handleJob(firstJob, { env, db, repos, logger, sync });
    await expect(handleJob(secondJob, { env, db, repos, logger, sync })).rejects.toThrow(
      "send_rate_limit_exceeded",
    );

    expect(calls).toHaveLength(1);
    const blockedEvents = await repos.systemEvents.list({
      userId: user.id,
      type: "sender.send_policy.blocked",
    });
    expect(blockedEvents[0]?.payload).toEqual(
      expect.objectContaining({
        jobId: secondJob.id,
        reason: "send_rate_limit_exceeded",
        recentAllowedCount: 1,
      }),
    );
  });

  it("sends voice only when the target phone matches the allowlist", async () => {
    const repos = createRepositories(db);
    const logger = pino({ level: "silent" });
    const audioPath = path.join(tempDir, "voice.wav");
    await fs.writeFile(audioPath, createTestWav(1));
    const env = loadWorkerEnv({
      NODE_ENV: "test",
      DATABASE_URL: path.join(tempDir, "worker.db"),
      WORKER_ID: "worker-send-voice",
      WORKER_BROWSER_ENABLED: "false",
      WORKER_JOB_LOOP_ENABLED: "true",
      WORKER_TEMP_DIR: tempDir,
      WA_SEND_ALLOWED_PHONE: "5531982066263",
    });
    const user = await repos.users.create({
      email: "voice@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const conversation = await repos.conversations.create({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "5531982066263",
      title: "Gabriel Braga Nuoma",
    });
    const job = await repos.jobs.create({
      userId: user.id,
      type: "send_voice",
      status: "queued",
      payload: {
        conversationId: conversation.id,
        phone: "5531982066263",
        audioPath,
      },
      scheduledAt: "2026-04-30T12:00:00.000Z",
      maxAttempts: 2,
    });
    if (!job) {
      throw new Error("expected send_voice job to be created");
    }
    const calls: unknown[] = [];

    await handleJob(job, {
      env,
      db,
      repos,
      logger,
      sync: {
        connected: true,
        metrics: {} as never,
        forceConversation: async () => {
          throw new Error("unexpected force sync");
        },
        sendTextMessage: async () => {
          throw new Error("unexpected text send");
        },
        sendVoiceMessage: async (input) => {
          calls.push(input);
          return {
            mode: "voice-message",
            conversationId: input.conversationId,
            phone: input.phone,
            reason: input.reason ?? "send_voice",
            navigationMode: "reused-open-chat",
            durationSecs: input.durationSecs,
            recordingMs: 1250,
            injectionConsumed: true,
            deliveryStatus: "sent",
            nativeVoiceEvidence: true,
            displayDurationSecs: 1,
            externalId: "after",
            visibleMessageCountBefore: 1,
            visibleMessageCountAfter: 2,
            lastExternalIdBefore: "before",
            lastExternalIdAfter: "after",
          };
        },
        sendDocumentMessage: async () => {
          throw new Error("unexpected document send");
        },
        sendMediaMessage: async () => {
          throw new Error("unexpected media send");
        },
        close: async () => {},
      },
    });

    expect(calls).toEqual([
      expect.objectContaining({
        conversationId: conversation.id,
        phone: "5531982066263",
        wavPath: audioPath,
        reason: "send_voice",
      }),
    ]);
    const events = await repos.systemEvents.list({
      userId: user.id,
      type: "sender.voice_message.completed",
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toEqual(
      expect.objectContaining({
        jobId: job.id,
        mode: "voice-message",
        navigationMode: "reused-open-chat",
        externalId: "after",
        audio: expect.objectContaining({
          sampleRate: 48000,
          channels: 1,
          bitsPerSample: 16,
        }),
      }),
    );
  });

  it("executes campaign text steps through the guarded text sender", async () => {
    const repos = createRepositories(db);
    const logger = pino({ level: "silent" });
    const env = loadWorkerEnv({
      NODE_ENV: "test",
      DATABASE_URL: path.join(tempDir, "worker.db"),
      WORKER_ID: "worker-campaign-text",
      WORKER_BROWSER_ENABLED: "false",
      WORKER_JOB_LOOP_ENABLED: "true",
      WA_SEND_ALLOWED_PHONE: "5531982066263",
    });
    const user = await repos.users.create({
      email: "campaign-text@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const conversation = await repos.conversations.create({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "5531982066263",
      title: "Gabriel Braga Nuoma",
    });
    const job = await repos.jobs.create({
      userId: user.id,
      type: "campaign_step",
      status: "queued",
      payload: {
        campaignId: 10,
        recipientId: 20,
        conversationId: conversation.id,
        phone: "5531982066263",
        variables: {
          nome: "Gabriel",
        },
        step: {
          id: "step-1",
          label: "Mensagem inicial",
          type: "text",
          delaySeconds: 0,
          conditions: [],
          template: "Oi {{nome}}, teste de campanha.",
        },
      },
      scheduledAt: "2026-04-30T12:00:00.000Z",
      maxAttempts: 2,
    });
    if (!job) {
      throw new Error("expected campaign_step job to be created");
    }
    const calls: unknown[] = [];

    await handleJob(job, {
      env,
      db,
      repos,
      logger,
      sync: {
        connected: true,
        metrics: {} as never,
        forceConversation: async () => {
          throw new Error("unexpected force sync");
        },
        sendTextMessage: async (input) => {
          calls.push(input);
          return {
            mode: "text-message",
            conversationId: input.conversationId,
            phone: input.phone,
            reason: input.reason ?? "campaign_step",
            navigationMode: "reused-open-chat",
            externalId: "after",
            visibleMessageCountBefore: 2,
            visibleMessageCountAfter: 3,
            lastExternalIdBefore: "before",
            lastExternalIdAfter: "after",
          };
        },
        sendVoiceMessage: async () => {
          throw new Error("unexpected voice send");
        },
        sendDocumentMessage: async () => {
          throw new Error("unexpected document send");
        },
        sendMediaMessage: async () => {
          throw new Error("unexpected media send");
        },
        close: async () => {},
      },
    });

    expect(calls).toEqual([
      expect.objectContaining({
        conversationId: conversation.id,
        phone: "5531982066263",
        body: "Oi Gabriel, teste de campanha.",
        reason: "campaign_step",
      }),
    ]);
    const events = await repos.systemEvents.list({
      userId: user.id,
      type: "sender.campaign_step.completed",
    });
    expect(events[0]?.payload).toEqual(
      expect.objectContaining({
        jobId: job.id,
        campaignId: 10,
        recipientId: 20,
        stepId: "step-1",
        stepType: "text",
        mode: "text-message",
        externalId: "after",
      }),
    );
    const dispatchMessage = await repos.messages.findByIdempotencyKey({
      userId: user.id,
      idempotencyKey: `legacy:job:${job.id}`,
    });
    expect(dispatchMessage).toEqual(
      expect.objectContaining({
        contentType: "text",
        body: "Oi Gabriel, teste de campanha.",
        status: "sent",
        dispatchAttempts: 1,
      }),
    );
  });

  it("verifies temporary messages before the first campaign step and restores on the last", async () => {
    const repos = createRepositories(db);
    const logger = pino({ level: "silent" });
    const env = loadWorkerEnv({
      NODE_ENV: "test",
      DATABASE_URL: path.join(tempDir, "worker.db"),
      WORKER_ID: "worker-campaign-temp",
      WORKER_BROWSER_ENABLED: "false",
      WORKER_JOB_LOOP_ENABLED: "true",
      WA_SEND_ALLOWED_PHONE: "5531982066263",
    });
    const user = await repos.users.create({
      email: "campaign-temp@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const conversation = await repos.conversations.create({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "5531982066263",
      title: "Gabriel Braga Nuoma",
    });
    const tempConfig = {
      enabled: true,
      beforeSendDuration: "24h",
      afterCompletionDuration: "90d",
      restoreOnFailure: true,
    };
    const firstJob = await repos.jobs.create({
      userId: user.id,
      type: "campaign_step",
      status: "queued",
      payload: {
        campaignId: 11,
        recipientId: 21,
        conversationId: conversation.id,
        phone: "31982066263",
        campaignBatchId: "batch-temp",
        campaignBatchIndex: 0,
        campaignBatchSize: 2,
        isLastStep: false,
        temporaryMessages: tempConfig,
        variables: { nome: "Gabriel" },
        step: {
          id: "intro",
          label: "Intro",
          type: "text",
          delaySeconds: 0,
          conditions: [],
          template: "Oi {{nome}}",
        },
      },
      scheduledAt: "2026-04-30T12:00:00.000Z",
      maxAttempts: 2,
    });
    const lastJob = await repos.jobs.create({
      userId: user.id,
      type: "campaign_step",
      status: "queued",
      payload: {
        campaignId: 11,
        recipientId: 21,
        conversationId: conversation.id,
        phone: "5531982066263",
        campaignBatchId: "batch-temp",
        campaignBatchIndex: 1,
        campaignBatchSize: 2,
        isLastStep: true,
        temporaryMessages: tempConfig,
        variables: { nome: "Gabriel" },
        step: {
          id: "close",
          label: "Close",
          type: "text",
          delaySeconds: 0,
          conditions: [],
          template: "Tchau {{nome}}",
        },
      },
      scheduledAt: "2026-04-30T12:01:00.000Z",
      maxAttempts: 2,
    });
    if (!firstJob || !lastJob) {
      throw new Error("expected campaign_step jobs to be created");
    }
    const ensureCalls: unknown[] = [];
    const sendCalls: unknown[] = [];
    const sync = {
      connected: true,
      metrics: {} as never,
      forceConversation: async () => {
        throw new Error("unexpected force sync");
      },
      ensureTemporaryMessages: async (input: {
        conversationId: number;
        phone: string;
        duration: "24h" | "7d" | "90d";
        phase:
          | "before_send"
          | "temporary_messages_set"
          | "after_completion_restore"
          | "failure_restore";
        reason?: string;
      }) => {
        ensureCalls.push(input);
        return {
          mode: "temporary-messages" as const,
          conversationId: input.conversationId,
          phone: input.phone,
          requestedDuration: input.duration,
          verifiedDuration: input.duration,
          phase: input.phase,
          reason: input.reason ?? "campaign_step",
          navigationMode: "reused-open-chat" as const,
          changed: true,
          menuDetected: true,
          targetEvidence: {
            href: "https://web.whatsapp.com/send?phone=5531982066263",
            hrefPhone: "5531982066263",
            title: "Gabriel Braga Nuoma",
            titlePhone: null,
            overlayPhone: "5531982066263",
            contactInfoPhone: null,
            hasComposer: true,
          },
          visualProof: {
            screenshotPath: path.join(tempDir, `temporary-${input.phase}-${input.duration}.png`),
            verifiedDuration: input.duration,
            textEvidence: `Mensagens temporarias: ${input.duration}`,
          },
        };
      },
      sendTextMessage: async (input: {
        conversationId: number;
        phone: string;
        body: string;
        reason?: string;
      }) => {
        sendCalls.push(input);
        return {
          mode: "text-message" as const,
          conversationId: input.conversationId,
          phone: input.phone,
          reason: input.reason ?? "campaign_step",
          navigationMode: "reused-open-chat" as const,
          externalId: `external-${sendCalls.length}`,
          visibleMessageCountBefore: sendCalls.length,
          visibleMessageCountAfter: sendCalls.length + 1,
          lastExternalIdBefore: "before",
          lastExternalIdAfter: `external-${sendCalls.length}`,
        };
      },
      sendVoiceMessage: async () => {
        throw new Error("unexpected voice send");
      },
      sendDocumentMessage: async () => {
        throw new Error("unexpected document send");
      },
      sendMediaMessage: async () => {
        throw new Error("unexpected media send");
      },
      close: async () => {},
    };

    const loop = createJobLoop({
      env,
      repos,
      logger,
      handlerContext: { env, db, repos, logger, sync },
    });

    await expect(loop.processOne()).resolves.toBe(true);

    expect(sendCalls).toHaveLength(2);
    expect(ensureCalls).toEqual([
      expect.objectContaining({ phase: "before_send", duration: "24h" }),
      expect.objectContaining({ phase: "after_completion_restore", duration: "90d" }),
    ]);
    const tempEvents = await repos.systemEvents.list({
      userId: user.id,
      type: "sender.temporary_messages.audit",
    });
    expect(tempEvents.map((event) => event.payload)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          phase: "before_send",
          executionMode: "whatsapp_real",
          verified: true,
          requestedDuration: "24h",
          verifiedDuration: "24h",
          visualProof: expect.objectContaining({
            verifiedDuration: "24h",
            textEvidence: expect.stringContaining("24h"),
          }),
        }),
        expect.objectContaining({
          phase: "step_completed_keep_window",
          executionMode: "whatsapp_real",
          verified: true,
          requestedDuration: "24h",
          verifiedDuration: "24h",
        }),
        expect.objectContaining({
          phase: "after_completion_restore",
          executionMode: "whatsapp_real",
          verified: true,
          requestedDuration: "90d",
          verifiedDuration: "90d",
        }),
      ]),
    );
    const jobs = await repos.jobs.list(user.id);
    expect(jobs.find((job) => job.id === firstJob.id)?.status).toBe("completed");
    expect(jobs.find((job) => job.id === lastJob.id)?.status).toBe("completed");
    const drainEvents = await repos.systemEvents.list({
      userId: user.id,
      type: "sender.campaign_step.batch_drained",
    });
    expect(drainEvents[0]?.payload).toEqual(
      expect.objectContaining({
        rootJobId: firstJob.id,
        campaignBatchId: "batch-temp",
        drainedJobs: 1,
        stopped: false,
      }),
    );
  });

  it("executes temporary messages control steps without sending a message", async () => {
    const repos = createRepositories(db);
    const logger = pino({ level: "silent" });
    const env = loadWorkerEnv({
      NODE_ENV: "test",
      DATABASE_URL: path.join(tempDir, "worker.db"),
      WORKER_ID: "worker-campaign-temp-step",
      WORKER_BROWSER_ENABLED: "false",
      WORKER_JOB_LOOP_ENABLED: "true",
      WA_SEND_ALLOWED_PHONE: "5531982066263",
    });
    const user = await repos.users.create({
      email: "campaign-temp-step@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const conversation = await repos.conversations.create({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "5531982066263",
      title: "Gabriel Braga Nuoma",
    });
    const basePayload = {
      campaignId: 13,
      recipientId: 23,
      conversationId: conversation.id,
      phone: "5531982066263",
      campaignBatchId: "batch-temp-step",
      campaignBatchSize: 3,
      variables: { nome: "Gabriel" },
    };
    const firstJob = await repos.jobs.create({
      userId: user.id,
      type: "campaign_step",
      status: "queued",
      payload: {
        ...basePayload,
        campaignBatchIndex: 0,
        isLastStep: false,
        step: {
          id: "temp-24h",
          label: "Definir 24h",
          type: "temporary_messages",
          delaySeconds: 0,
          conditions: [],
          duration: "24h",
        },
      },
      scheduledAt: "2026-04-30T12:00:00.000Z",
      maxAttempts: 2,
    });
    const textJob = await repos.jobs.create({
      userId: user.id,
      type: "campaign_step",
      status: "queued",
      payload: {
        ...basePayload,
        campaignBatchIndex: 1,
        isLastStep: false,
        step: {
          id: "msg",
          label: "Mensagem",
          type: "text",
          delaySeconds: 0,
          conditions: [],
          template: "Oi {{nome}}",
        },
      },
      scheduledAt: "2026-04-30T12:00:01.000Z",
      maxAttempts: 2,
    });
    const restoreJob = await repos.jobs.create({
      userId: user.id,
      type: "campaign_step",
      status: "queued",
      payload: {
        ...basePayload,
        campaignBatchIndex: 2,
        isLastStep: true,
        step: {
          id: "temp-90d",
          label: "Restaurar 90d",
          type: "temporary_messages",
          delaySeconds: 0,
          conditions: [],
          duration: "90d",
        },
      },
      scheduledAt: "2026-04-30T12:00:02.000Z",
      maxAttempts: 2,
    });
    if (!firstJob || !textJob || !restoreJob) {
      throw new Error("expected campaign_step jobs to be created");
    }

    const ensureCalls: unknown[] = [];
    const sendCalls: unknown[] = [];
    const sync = {
      connected: true,
      metrics: {} as never,
      forceConversation: async () => {
        throw new Error("unexpected force sync");
      },
      ensureTemporaryMessages: async (input: {
        conversationId: number;
        phone: string;
        duration: "24h" | "7d" | "90d";
        phase:
          | "before_send"
          | "temporary_messages_set"
          | "after_completion_restore"
          | "failure_restore";
        reason?: string;
      }) => {
        ensureCalls.push(input);
        return {
          mode: "temporary-messages" as const,
          conversationId: input.conversationId,
          phone: input.phone,
          requestedDuration: input.duration,
          verifiedDuration: input.duration,
          phase: input.phase,
          reason: input.reason ?? "campaign_step",
          navigationMode: "reused-open-chat" as const,
          changed: true,
          menuDetected: true,
          targetEvidence: {
            href: "https://web.whatsapp.com/send?phone=5531982066263",
            hrefPhone: "5531982066263",
            title: "Gabriel Braga Nuoma",
            titlePhone: null,
            overlayPhone: "5531982066263",
            contactInfoPhone: null,
            hasComposer: true,
          },
        };
      },
      sendTextMessage: async (input: {
        conversationId: number;
        phone: string;
        body: string;
        reason?: string;
      }) => {
        sendCalls.push(input);
        return {
          mode: "text-message" as const,
          conversationId: input.conversationId,
          phone: input.phone,
          reason: input.reason ?? "campaign_step",
          navigationMode: "reused-open-chat" as const,
          externalId: "external-text",
          visibleMessageCountBefore: 1,
          visibleMessageCountAfter: 2,
          lastExternalIdBefore: "before",
          lastExternalIdAfter: "external-text",
        };
      },
      sendVoiceMessage: async () => {
        throw new Error("unexpected voice send");
      },
      sendDocumentMessage: async () => {
        throw new Error("unexpected document send");
      },
      sendMediaMessage: async () => {
        throw new Error("unexpected media send");
      },
      close: async () => {},
    };

    await handleJob(firstJob, { env, db, repos, logger, sync });

    expect(sendCalls).toEqual([
      expect.objectContaining({
        body: "Oi Gabriel",
        phone: "5531982066263",
      }),
    ]);
    expect(ensureCalls).toEqual([
      expect.objectContaining({ phase: "temporary_messages_set", duration: "24h" }),
      expect.objectContaining({ phase: "temporary_messages_set", duration: "90d" }),
    ]);
    const completedControlEvents = await repos.systemEvents.list({
      userId: user.id,
      type: "sender.temporary_messages.set.completed",
    });
    expect(completedControlEvents.map((event) => event.payload)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stepId: "temp-24h",
          temporaryMessagesRequestedDuration: "24h",
          temporaryMessagesConfirmedDuration: "24h",
          temporaryMessagesProof: true,
        }),
        expect.objectContaining({
          stepId: "temp-90d",
          temporaryMessagesRequestedDuration: "90d",
          temporaryMessagesConfirmedDuration: "90d",
          temporaryMessagesProof: true,
        }),
      ]),
    );
    const jobs = await repos.jobs.list(user.id);
    expect(jobs.find((job) => job.id === textJob.id)?.status).toBe("completed");
    expect(jobs.find((job) => job.id === restoreJob.id)?.status).toBe("completed");
  });

  it("blocks campaign sends when temporary messages cannot be verified", async () => {
    const repos = createRepositories(db);
    const logger = pino({ level: "silent" });
    const env = loadWorkerEnv({
      NODE_ENV: "test",
      DATABASE_URL: path.join(tempDir, "worker.db"),
      WORKER_ID: "worker-campaign-temp-block",
      WORKER_BROWSER_ENABLED: "false",
      WORKER_JOB_LOOP_ENABLED: "true",
      WA_SEND_ALLOWED_PHONE: "5531982066263",
    });
    const user = await repos.users.create({
      email: "campaign-temp-block@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const conversation = await repos.conversations.create({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "5531982066263",
      title: "Gabriel Braga Nuoma",
    });
    const job = await repos.jobs.create({
      userId: user.id,
      type: "campaign_step",
      status: "queued",
      payload: {
        campaignId: 12,
        recipientId: 22,
        conversationId: conversation.id,
        phone: "5531982066263",
        campaignBatchId: "batch-temp-fail",
        campaignBatchIndex: 0,
        campaignBatchSize: 1,
        isLastStep: true,
        temporaryMessages: {
          enabled: true,
          beforeSendDuration: "24h",
          afterCompletionDuration: "90d",
          restoreOnFailure: true,
        },
        variables: { nome: "Gabriel" },
        step: {
          id: "intro",
          label: "Intro",
          type: "text",
          delaySeconds: 0,
          conditions: [],
          template: "Oi {{nome}}",
        },
      },
      scheduledAt: "2026-04-30T12:00:00.000Z",
      maxAttempts: 2,
    });
    const siblingJob = await repos.jobs.create({
      userId: user.id,
      type: "campaign_step",
      status: "queued",
      payload: {
        campaignId: 12,
        recipientId: 22,
        conversationId: conversation.id,
        phone: "5531982066263",
        campaignBatchId: "batch-temp-fail",
        campaignBatchIndex: 1,
        campaignBatchSize: 2,
        isLastStep: true,
        temporaryMessages: {
          enabled: true,
          beforeSendDuration: "24h",
          afterCompletionDuration: "90d",
          restoreOnFailure: true,
        },
        variables: { nome: "Gabriel" },
        step: {
          id: "follow-up",
          label: "Follow-up",
          type: "text",
          delaySeconds: 0,
          conditions: [],
          template: "Depois {{nome}}",
        },
      },
      scheduledAt: "2026-04-30T12:01:00.000Z",
      maxAttempts: 2,
    });
    if (!job || !siblingJob) {
      throw new Error("expected campaign_step job to be created");
    }
    let sendCalls = 0;

    await expect(
      handleJob(job, {
        env,
        db,
        repos,
        logger,
        sync: {
          connected: true,
          metrics: {} as never,
          forceConversation: async () => {
            throw new Error("unexpected force sync");
          },
          ensureTemporaryMessages: async () => {
            throw new Error("temporary menu not found");
          },
          sendTextMessage: async () => {
            sendCalls += 1;
            throw new Error("unexpected text send");
          },
          sendVoiceMessage: async () => {
            throw new Error("unexpected voice send");
          },
          sendDocumentMessage: async () => {
            throw new Error("unexpected document send");
          },
          sendMediaMessage: async () => {
            throw new Error("unexpected media send");
          },
          close: async () => {},
        },
      }),
    ).rejects.toThrow("temporary menu not found");

    expect(sendCalls).toBe(0);
    const tempEvents = await repos.systemEvents.list({
      userId: user.id,
      type: "sender.temporary_messages.audit",
    });
    expect(tempEvents[0]?.payload).toEqual(
      expect.objectContaining({
        phase: "before_send",
        executionMode: "whatsapp_real",
        verified: false,
        error: "temporary menu not found",
      }),
    );
    const failedEvents = await repos.systemEvents.list({
      userId: user.id,
      type: "sender.campaign_step.failed",
    });
    expect(failedEvents[0]?.payload).toEqual(
      expect.objectContaining({
        jobId: job.id,
        campaignId: 12,
        recipientId: 22,
        error: "temporary menu not found",
      }),
    );
    const siblingRow = db.raw.prepare("select status from jobs where id = ?").get(siblingJob.id) as
      | { status: string }
      | undefined;
    expect(siblingRow?.status).toBe("cancelled");
  });

  it("executes campaign voice steps through the guarded voice sender", async () => {
    const repos = createRepositories(db);
    const logger = pino({ level: "silent" });
    const audioPath = path.join(tempDir, "campaign-voice.wav");
    await fs.writeFile(audioPath, createTestWav(1));
    const env = loadWorkerEnv({
      NODE_ENV: "test",
      DATABASE_URL: path.join(tempDir, "worker.db"),
      WORKER_ID: "worker-campaign-voice",
      WORKER_BROWSER_ENABLED: "false",
      WORKER_JOB_LOOP_ENABLED: "true",
      WORKER_TEMP_DIR: tempDir,
      WA_SEND_ALLOWED_PHONE: "5531982066263",
    });
    const user = await repos.users.create({
      email: "campaign-voice@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const conversation = await repos.conversations.create({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "5531982066263",
      title: "Gabriel Braga Nuoma",
    });
    const mediaAsset = await repos.mediaAssets.create({
      userId: user.id,
      type: "voice",
      fileName: "campaign-voice.wav",
      mimeType: "audio/wav",
      sha256: "a".repeat(64),
      sizeBytes: (await fs.stat(audioPath)).size,
      durationMs: 1000,
      storagePath: audioPath,
    });
    const job = await repos.jobs.create({
      userId: user.id,
      type: "campaign_step",
      status: "queued",
      payload: {
        campaignId: 11,
        recipientId: 21,
        conversationId: conversation.id,
        phone: "5531982066263",
        step: {
          id: "voice-1",
          label: "Audio",
          type: "voice",
          delaySeconds: 0,
          conditions: [],
          mediaAssetId: mediaAsset.id,
          caption: null,
        },
      },
      scheduledAt: "2026-04-30T12:00:00.000Z",
      maxAttempts: 2,
    });
    if (!job) {
      throw new Error("expected campaign_step voice job to be created");
    }
    const calls: unknown[] = [];

    await handleJob(job, {
      env,
      db,
      repos,
      logger,
      sync: {
        connected: true,
        metrics: {} as never,
        forceConversation: async () => {
          throw new Error("unexpected force sync");
        },
        sendTextMessage: async () => {
          throw new Error("unexpected text send");
        },
        sendVoiceMessage: async (input) => {
          calls.push(input);
          return {
            mode: "voice-message",
            conversationId: input.conversationId,
            phone: input.phone,
            reason: input.reason ?? "campaign_step",
            navigationMode: "reused-open-chat",
            durationSecs: input.durationSecs,
            recordingMs: 1250,
            injectionConsumed: true,
            deliveryStatus: "sent",
            nativeVoiceEvidence: true,
            displayDurationSecs: 1,
            externalId: "after",
            visibleMessageCountBefore: 3,
            visibleMessageCountAfter: 4,
            lastExternalIdBefore: "before",
            lastExternalIdAfter: "after",
          };
        },
        sendDocumentMessage: async () => {
          throw new Error("unexpected document send");
        },
        sendMediaMessage: async () => {
          throw new Error("unexpected media send");
        },
        close: async () => {},
      },
    });

    expect(calls).toEqual([
      expect.objectContaining({
        conversationId: conversation.id,
        phone: "5531982066263",
        wavPath: audioPath,
        reason: "campaign_step",
      }),
    ]);
    const events = await repos.systemEvents.list({
      userId: user.id,
      type: "sender.campaign_step.completed",
    });
    expect(events[0]?.payload).toEqual(
      expect.objectContaining({
        jobId: job.id,
        campaignId: 11,
        recipientId: 21,
        stepId: "voice-1",
        stepType: "voice",
        mode: "voice-message",
        externalId: "after",
        mediaAssetId: mediaAsset.id,
      }),
    );
  });

  it("marks campaign voice fallback as failed while preserving dispatch evidence", async () => {
    const repos = createRepositories(db);
    const logger = pino({ level: "silent" });
    const audioPath = path.join(tempDir, "campaign-voice-fallback.wav");
    await fs.writeFile(audioPath, createTestWav(1));
    const env = loadWorkerEnv({
      NODE_ENV: "test",
      DATABASE_URL: path.join(tempDir, "worker.db"),
      WORKER_ID: "worker-campaign-voice-fallback",
      WORKER_BROWSER_ENABLED: "false",
      WORKER_JOB_LOOP_ENABLED: "true",
      WORKER_TEMP_DIR: tempDir,
      WA_SEND_ALLOWED_PHONE: "5531982066263",
    });
    const user = await repos.users.create({
      email: "campaign-voice-fallback@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const conversation = await repos.conversations.create({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "5531982066263",
      title: "Gabriel Braga Nuoma",
    });
    const mediaAsset = await repos.mediaAssets.create({
      userId: user.id,
      type: "voice",
      fileName: "campaign-voice-fallback.wav",
      mimeType: "audio/wav",
      sha256: "b".repeat(64),
      sizeBytes: (await fs.stat(audioPath)).size,
      durationMs: 1000,
      storagePath: audioPath,
    });
    const job = await repos.jobs.create({
      userId: user.id,
      type: "campaign_step",
      status: "queued",
      payload: {
        campaignId: 15,
        recipientId: 25,
        conversationId: conversation.id,
        phone: "5531982066263",
        step: {
          id: "voice-fallback",
          label: "Audio fallback",
          type: "voice",
          delaySeconds: 0,
          conditions: [],
          mediaAssetId: mediaAsset.id,
          caption: null,
        },
      },
      scheduledAt: "2026-04-30T12:00:00.000Z",
      maxAttempts: 1,
    });
    if (!job) {
      throw new Error("expected campaign_step voice job to be created");
    }

    let rejection: unknown = null;
    await handleJob(job, {
      env,
      db,
      repos,
      logger,
      sync: {
        connected: true,
        metrics: {} as never,
        forceConversation: async () => {
          throw new Error("unexpected force sync");
        },
        sendTextMessage: async () => {
          throw new Error("unexpected text send");
        },
        sendVoiceMessage: async (input) => ({
          mode: "voice-message",
          conversationId: input.conversationId,
          phone: input.phone,
          reason: input.reason ?? "campaign_step",
          navigationMode: "reused-open-chat",
          durationSecs: input.durationSecs,
          recordingMs: 1250,
          injectionConsumed: false,
          deliveryStatus: "sent",
          nativeVoiceEvidence: false,
          displayDurationSecs: null,
          externalId: "fallback-after",
          visibleMessageCountBefore: 3,
          visibleMessageCountAfter: 4,
          lastExternalIdBefore: "before",
          lastExternalIdAfter: "fallback-after",
          sentByInternalFallback: true,
        }),
        sendDocumentMessage: async () => {
          throw new Error("unexpected document send");
        },
        sendMediaMessage: async () => {
          throw new Error("unexpected media send");
        },
        close: async () => {},
      },
    }).catch((error: unknown) => {
      rejection = error;
    });

    expect(rejection).toBeInstanceOf(Error);
    expect(rejection instanceof Error ? rejection.message : String(rejection)).toContain(
      "native_voice_evidence_required",
    );
    const rejectedEvents = await repos.systemEvents.list({
      userId: user.id,
      type: "sender.voice_message.rejected",
    });
    expect(rejectedEvents[0]?.payload).toEqual(
      expect.objectContaining({
        jobId: job.id,
        campaignId: 15,
        recipientId: 25,
        stepId: "voice-fallback",
        reason: "native_voice_evidence_required",
      }),
    );
    const dispatchMessage = await repos.messages.findByIdempotencyKey({
      userId: user.id,
      idempotencyKey: `legacy:job:${job.id}`,
    });
    expect(dispatchMessage).toEqual(
      expect.objectContaining({
        externalId: "fallback-after",
        status: "failed",
        dispatchAttempts: 1,
      }),
    );
    const attempts = await repos.messageDispatchAttempts.listByKey(`legacy:job:${job.id}`);
    expect(attempts.map((attempt) => attempt.phase)).toEqual(["failed"]);
  });

  it("sends documents only when the target phone matches the allowlist", async () => {
    const repos = createRepositories(db);
    const logger = pino({ level: "silent" });
    const documentPath = path.join(tempDir, "procedure.pdf");
    await fs.writeFile(documentPath, Buffer.from("%PDF-1.4\n% test\n"));
    const env = loadWorkerEnv({
      NODE_ENV: "test",
      DATABASE_URL: path.join(tempDir, "worker.db"),
      WORKER_ID: "worker-send-document",
      WORKER_BROWSER_ENABLED: "false",
      WORKER_JOB_LOOP_ENABLED: "true",
      WA_SEND_ALLOWED_PHONE: "5531982066263",
    });
    const user = await repos.users.create({
      email: "document@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const conversation = await repos.conversations.create({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "5531982066263",
      title: "Gabriel Braga Nuoma",
    });
    const job = await repos.jobs.create({
      userId: user.id,
      type: "send_document",
      status: "queued",
      payload: {
        conversationId: conversation.id,
        phone: "5531982066263",
        documentPath,
        fileName: "procedure.pdf",
        mimeType: "application/pdf",
        caption: "Documento de teste",
      },
      scheduledAt: "2026-04-30T12:00:00.000Z",
      maxAttempts: 2,
    });
    if (!job) {
      throw new Error("expected send_document job to be created");
    }
    const calls: unknown[] = [];

    await handleJob(job, {
      env,
      db,
      repos,
      logger,
      sync: {
        connected: true,
        metrics: {} as never,
        forceConversation: async () => {
          throw new Error("unexpected force sync");
        },
        sendTextMessage: async () => {
          throw new Error("unexpected text send");
        },
        sendVoiceMessage: async () => {
          throw new Error("unexpected voice send");
        },
        sendDocumentMessage: async (input) => {
          calls.push(input);
          return {
            mode: "document-message",
            conversationId: input.conversationId,
            phone: input.phone,
            reason: input.reason ?? "send_document",
            navigationMode: "reused-open-chat",
            externalId: "doc-after",
            fileName: input.fileName,
            mimeType: input.mimeType,
            captionSent: Boolean(input.caption),
            visibleMessageCountBefore: 4,
            visibleMessageCountAfter: 5,
            lastExternalIdBefore: "doc-before",
            lastExternalIdAfter: "doc-after",
          };
        },
        sendMediaMessage: async () => {
          throw new Error("unexpected media send");
        },
        close: async () => {},
      },
    });

    expect(calls).toEqual([
      expect.objectContaining({
        conversationId: conversation.id,
        phone: "5531982066263",
        filePath: documentPath,
        fileName: "procedure.pdf",
        mimeType: "application/pdf",
        caption: "Documento de teste",
        reason: "send_document",
      }),
    ]);
    const events = await repos.systemEvents.list({
      userId: user.id,
      type: "sender.document_message.completed",
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toEqual(
      expect.objectContaining({
        jobId: job.id,
        mode: "document-message",
        externalId: "doc-after",
        fileName: "procedure.pdf",
        mimeType: "application/pdf",
        captionSent: true,
      }),
    );
  });

  it("executes campaign document steps through the guarded document sender", async () => {
    const repos = createRepositories(db);
    const logger = pino({ level: "silent" });
    const documentPath = path.join(tempDir, "campaign-document.pdf");
    await fs.writeFile(documentPath, Buffer.from("%PDF-1.4\n% campaign test\n"));
    const env = loadWorkerEnv({
      NODE_ENV: "test",
      DATABASE_URL: path.join(tempDir, "worker.db"),
      WORKER_ID: "worker-campaign-document",
      WORKER_BROWSER_ENABLED: "false",
      WORKER_JOB_LOOP_ENABLED: "true",
      WA_SEND_ALLOWED_PHONE: "5531982066263",
    });
    const user = await repos.users.create({
      email: "campaign-document@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const conversation = await repos.conversations.create({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "5531982066263",
      title: "Gabriel Braga Nuoma",
    });
    const mediaAsset = await repos.mediaAssets.create({
      userId: user.id,
      type: "document",
      fileName: "campaign-document.pdf",
      mimeType: "application/pdf",
      sha256: "b".repeat(64),
      sizeBytes: (await fs.stat(documentPath)).size,
      durationMs: null,
      storagePath: documentPath,
    });
    const job = await repos.jobs.create({
      userId: user.id,
      type: "campaign_step",
      status: "queued",
      payload: {
        campaignId: 12,
        recipientId: 22,
        conversationId: conversation.id,
        phone: "5531982066263",
        variables: {
          nome: "Gabriel",
        },
        step: {
          id: "doc-1",
          label: "Documento",
          type: "document",
          delaySeconds: 0,
          conditions: [],
          mediaAssetId: mediaAsset.id,
          fileName: "procedimento-{{nome}}.pdf",
          caption: "Arquivo para {{nome}}",
        },
      },
      scheduledAt: "2026-04-30T12:00:00.000Z",
      maxAttempts: 2,
    });
    if (!job) {
      throw new Error("expected campaign_step document job to be created");
    }
    const calls: unknown[] = [];

    await handleJob(job, {
      env,
      db,
      repos,
      logger,
      sync: {
        connected: true,
        metrics: {} as never,
        forceConversation: async () => {
          throw new Error("unexpected force sync");
        },
        sendTextMessage: async () => {
          throw new Error("unexpected text send");
        },
        sendVoiceMessage: async () => {
          throw new Error("unexpected voice send");
        },
        sendDocumentMessage: async (input) => {
          calls.push(input);
          return {
            mode: "document-message",
            conversationId: input.conversationId,
            phone: input.phone,
            reason: input.reason ?? "campaign_step",
            navigationMode: "reused-open-chat",
            externalId: "campaign-doc-after",
            fileName: input.fileName,
            mimeType: input.mimeType,
            captionSent: Boolean(input.caption),
            visibleMessageCountBefore: 5,
            visibleMessageCountAfter: 6,
            lastExternalIdBefore: "campaign-doc-before",
            lastExternalIdAfter: "campaign-doc-after",
          };
        },
        sendMediaMessage: async () => {
          throw new Error("unexpected media send");
        },
        close: async () => {},
      },
    });

    expect(calls).toEqual([
      expect.objectContaining({
        conversationId: conversation.id,
        phone: "5531982066263",
        filePath: documentPath,
        fileName: "procedimento-Gabriel.pdf",
        mimeType: "application/pdf",
        caption: "Arquivo para Gabriel",
        reason: "campaign_step",
      }),
    ]);
    const events = await repos.systemEvents.list({
      userId: user.id,
      type: "sender.campaign_step.completed",
    });
    expect(events[0]?.payload).toEqual(
      expect.objectContaining({
        jobId: job.id,
        campaignId: 12,
        recipientId: 22,
        stepId: "doc-1",
        stepType: "document",
        mode: "document-message",
        externalId: "campaign-doc-after",
        mediaAssetId: mediaAsset.id,
        captionSent: true,
      }),
    );
  });

  it("executes campaign image steps through the guarded native media sender", async () => {
    const repos = createRepositories(db);
    const logger = pino({ level: "silent" });
    const imagePath = path.join(tempDir, "campaign-image.jpg");
    await fs.writeFile(imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const env = loadWorkerEnv({
      NODE_ENV: "test",
      DATABASE_URL: path.join(tempDir, "worker.db"),
      WORKER_ID: "worker-campaign-image",
      WORKER_BROWSER_ENABLED: "false",
      WORKER_JOB_LOOP_ENABLED: "true",
      WA_SEND_ALLOWED_PHONE: "5531982066263",
    });
    const user = await repos.users.create({
      email: "campaign-image@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const conversation = await repos.conversations.create({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "5531982066263",
      title: "Gabriel Braga Nuoma",
    });
    const mediaAsset = await repos.mediaAssets.create({
      userId: user.id,
      type: "image",
      fileName: "campaign-image.jpg",
      mimeType: "image/jpeg",
      sha256: "c".repeat(64),
      sizeBytes: (await fs.stat(imagePath)).size,
      durationMs: null,
      storagePath: imagePath,
    });
    const job = await repos.jobs.create({
      userId: user.id,
      type: "campaign_step",
      status: "queued",
      payload: {
        campaignId: 13,
        recipientId: 23,
        conversationId: conversation.id,
        phone: "5531982066263",
        variables: {
          nome: "Gabriel",
        },
        step: {
          id: "image-1",
          label: "Imagem",
          type: "image",
          delaySeconds: 0,
          conditions: [],
          mediaAssetId: mediaAsset.id,
          caption: "Imagem para {{nome}}",
        },
      },
      scheduledAt: "2026-04-30T12:00:00.000Z",
      maxAttempts: 2,
    });
    if (!job) {
      throw new Error("expected campaign_step image job to be created");
    }
    const calls: unknown[] = [];

    await handleJob(job, {
      env,
      db,
      repos,
      logger,
      sync: {
        connected: true,
        metrics: {} as never,
        forceConversation: async () => {
          throw new Error("unexpected force sync");
        },
        sendTextMessage: async () => {
          throw new Error("unexpected text send");
        },
        sendVoiceMessage: async () => {
          throw new Error("unexpected voice send");
        },
        sendDocumentMessage: async () => {
          throw new Error("unexpected document send");
        },
        sendMediaMessage: async (input) => {
          calls.push(input);
          return {
            mode: "media-message",
            contentType: input.mediaType,
            conversationId: input.conversationId,
            phone: input.phone,
            reason: input.reason ?? "campaign_step",
            navigationMode: "reused-open-chat",
            externalId: "campaign-image-after",
            fileName: input.fileName,
            mimeType: input.mimeType,
            fileNames: input.files?.map((file) => file.fileName) ?? [input.fileName],
            mimeTypes: input.files?.map((file) => file.mimeType) ?? [input.mimeType],
            mediaCount: input.files?.length ?? 1,
            captionSent: Boolean(input.caption),
            visibleMessageCountBefore: 6,
            visibleMessageCountAfter: 7,
            lastExternalIdBefore: "campaign-image-before",
            lastExternalIdAfter: "campaign-image-after",
          };
        },
        close: async () => {},
      },
    });

    expect(calls).toEqual([
      expect.objectContaining({
        conversationId: conversation.id,
        phone: "5531982066263",
        mediaType: "image",
        filePath: imagePath,
        fileName: "campaign-image.jpg",
        mimeType: "image/jpeg",
        caption: "Imagem para Gabriel",
        reason: "campaign_step",
      }),
    ]);
    const events = await repos.systemEvents.list({
      userId: user.id,
      type: "sender.campaign_step.completed",
    });
    expect(events[0]?.payload).toEqual(
      expect.objectContaining({
        jobId: job.id,
        campaignId: 13,
        recipientId: 23,
        stepId: "image-1",
        stepType: "image",
        mode: "media-message",
        contentType: "image",
        externalId: "campaign-image-after",
        mediaAssetId: mediaAsset.id,
        captionSent: true,
      }),
    );
  });

  it("executes campaign image album steps with multiple media assets", async () => {
    const repos = createRepositories(db);
    const logger = pino({ level: "silent" });
    const imagePaths = await Promise.all(
      [1, 2, 3, 4].map(async (index) => {
        const imagePath = path.join(tempDir, `campaign-album-${index}.jpg`);
        await fs.writeFile(imagePath, Buffer.from([0xff, 0xd8, index, 0xff, 0xd9]));
        return imagePath;
      }),
    );
    const env = loadWorkerEnv({
      NODE_ENV: "test",
      DATABASE_URL: path.join(tempDir, "worker.db"),
      WORKER_ID: "worker-campaign-image-album",
      WORKER_BROWSER_ENABLED: "false",
      WORKER_JOB_LOOP_ENABLED: "true",
      WA_SEND_ALLOWED_PHONE: "5531982066263",
    });
    const user = await repos.users.create({
      email: "campaign-image-album@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const conversation = await repos.conversations.create({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "5531982066263",
      title: "Gabriel Braga Nuoma",
    });
    const mediaAssets = [];
    for (const [index, imagePath] of imagePaths.entries()) {
      mediaAssets.push(
        await repos.mediaAssets.create({
          userId: user.id,
          type: "image",
          fileName: `campaign-album-${index + 1}.jpg`,
          mimeType: "image/jpeg",
          sha256: `${index + 1}`.repeat(64),
          sizeBytes: (await fs.stat(imagePath)).size,
          durationMs: null,
          storagePath: imagePath,
        }),
      );
    }
    const job = await repos.jobs.create({
      userId: user.id,
      type: "campaign_step",
      status: "queued",
      payload: {
        campaignId: 15,
        recipientId: 25,
        conversationId: conversation.id,
        phone: "5531982066263",
        variables: {
          nome: "Gabriel",
        },
        step: {
          id: "album-1",
          label: "Album",
          type: "image",
          delaySeconds: 0,
          conditions: [],
          mediaAssetId: mediaAssets[0]?.id,
          mediaAssetIds: mediaAssets.map((mediaAsset) => mediaAsset.id),
          caption: "Album para {{nome}}",
        },
      },
      scheduledAt: "2026-04-30T12:00:00.000Z",
      maxAttempts: 2,
    });
    if (!job) {
      throw new Error("expected campaign_step image album job to be created");
    }
    const calls: unknown[] = [];

    await handleJob(job, {
      env,
      db,
      repos,
      logger,
      sync: {
        connected: true,
        metrics: {} as never,
        forceConversation: async () => {
          throw new Error("unexpected force sync");
        },
        sendTextMessage: async () => {
          throw new Error("unexpected text send");
        },
        sendVoiceMessage: async () => {
          throw new Error("unexpected voice send");
        },
        sendDocumentMessage: async () => {
          throw new Error("unexpected document send");
        },
        sendMediaMessage: async (input) => {
          calls.push(input);
          return {
            mode: "media-message",
            contentType: input.mediaType,
            conversationId: input.conversationId,
            phone: input.phone,
            reason: input.reason ?? "campaign_step",
            navigationMode: "reused-open-chat",
            externalId: "campaign-album-after",
            fileName: input.fileName,
            mimeType: input.mimeType,
            fileNames: input.files?.map((file) => file.fileName) ?? [input.fileName],
            mimeTypes: input.files?.map((file) => file.mimeType) ?? [input.mimeType],
            mediaCount: input.files?.length ?? 1,
            captionSent: Boolean(input.caption),
            visibleMessageCountBefore: 8,
            visibleMessageCountAfter: 9,
            lastExternalIdBefore: "campaign-album-before",
            lastExternalIdAfter: "campaign-album-after",
          };
        },
        close: async () => {},
      },
    });

    expect(calls).toEqual([
      expect.objectContaining({
        conversationId: conversation.id,
        phone: "5531982066263",
        mediaType: "image",
        filePath: imagePaths[0],
        fileName: "campaign-album-1.jpg",
        mimeType: "image/jpeg",
        files: imagePaths.map((imagePath, index) => ({
          filePath: imagePath,
          fileName: `campaign-album-${index + 1}.jpg`,
          mimeType: "image/jpeg",
        })),
        caption: "Album para Gabriel",
        reason: "campaign_step",
      }),
    ]);
    const events = await repos.systemEvents.list({
      userId: user.id,
      type: "sender.campaign_step.completed",
    });
    expect(events[0]?.payload).toEqual(
      expect.objectContaining({
        jobId: job.id,
        campaignId: 15,
        recipientId: 25,
        stepId: "album-1",
        stepType: "image",
        mode: "media-message",
        contentType: "image",
        externalId: "campaign-album-after",
        mediaAssetId: mediaAssets[0]?.id,
        mediaAssetIds: mediaAssets.map((mediaAsset) => mediaAsset.id),
        mediaCount: 4,
        captionSent: true,
      }),
    );
  });

  it("executes direct send_media image albums from mediaAssetIds", async () => {
    const repos = createRepositories(db);
    const logger = pino({ level: "silent" });
    const imagePaths = await Promise.all(
      [1, 2, 3, 4, 5].map(async (index) => {
        const imagePath = path.join(tempDir, `direct-album-${index}.jpg`);
        await fs.writeFile(imagePath, Buffer.from([0xff, 0xd8, index, 0xff, 0xd9]));
        return imagePath;
      }),
    );
    const env = loadWorkerEnv({
      NODE_ENV: "test",
      DATABASE_URL: path.join(tempDir, "worker.db"),
      WORKER_ID: "worker-direct-image-album",
      WORKER_BROWSER_ENABLED: "false",
      WORKER_JOB_LOOP_ENABLED: "true",
      WA_SEND_ALLOWED_PHONE: "5531982066263",
    });
    const user = await repos.users.create({
      email: "direct-image-album@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const conversation = await repos.conversations.create({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "5531982066263",
      title: "Gabriel Braga Nuoma",
    });
    const mediaAssets = [];
    for (const [index, imagePath] of imagePaths.entries()) {
      mediaAssets.push(
        await repos.mediaAssets.create({
          userId: user.id,
          type: "image",
          fileName: `direct-album-${index + 1}.jpg`,
          mimeType: "image/jpeg",
          sha256: `${index + 5}`.repeat(64),
          sizeBytes: (await fs.stat(imagePath)).size,
          durationMs: null,
          storagePath: imagePath,
        }),
      );
    }
    const job = await repos.jobs.create({
      userId: user.id,
      type: "send_media",
      status: "queued",
      payload: {
        conversationId: conversation.id,
        phone: "5531982066263",
        mediaAssetId: mediaAssets[0]?.id,
        mediaAssetIds: mediaAssets.map((mediaAsset) => mediaAsset.id),
        mediaType: "image",
        caption: "Album direto",
      },
      scheduledAt: "2026-04-30T12:00:00.000Z",
      maxAttempts: 2,
    });
    if (!job) {
      throw new Error("expected direct send_media image album job to be created");
    }
    const calls: unknown[] = [];

    await handleJob(job, {
      env,
      db,
      repos,
      logger,
      sync: {
        connected: true,
        metrics: {} as never,
        forceConversation: async () => {
          throw new Error("unexpected force sync");
        },
        sendTextMessage: async () => {
          throw new Error("unexpected text send");
        },
        sendVoiceMessage: async () => {
          throw new Error("unexpected voice send");
        },
        sendDocumentMessage: async () => {
          throw new Error("unexpected document send");
        },
        sendMediaMessage: async (input) => {
          calls.push(input);
          return {
            mode: "media-message",
            contentType: input.mediaType,
            conversationId: input.conversationId,
            phone: input.phone,
            reason: input.reason ?? "send_media",
            navigationMode: "reused-open-chat",
            externalId: "direct-album-after",
            fileName: input.fileName,
            mimeType: input.mimeType,
            fileNames: input.files?.map((file) => file.fileName) ?? [input.fileName],
            mimeTypes: input.files?.map((file) => file.mimeType) ?? [input.mimeType],
            mediaCount: input.files?.length ?? 1,
            captionSent: Boolean(input.caption),
            visibleMessageCountBefore: 8,
            visibleMessageCountAfter: 9,
            lastExternalIdBefore: "direct-album-before",
            lastExternalIdAfter: "direct-album-after",
          };
        },
        close: async () => {},
      },
    });

    expect(calls).toEqual([
      expect.objectContaining({
        conversationId: conversation.id,
        phone: "5531982066263",
        mediaType: "image",
        filePath: imagePaths[0],
        fileName: "direct-album-1.jpg",
        mimeType: "image/jpeg",
        files: imagePaths.map((imagePath, index) => ({
          filePath: imagePath,
          fileName: `direct-album-${index + 1}.jpg`,
          mimeType: "image/jpeg",
        })),
        caption: "Album direto",
        reason: "send_media",
      }),
    ]);
    const events = await repos.systemEvents.list({
      userId: user.id,
      type: "sender.media_message.completed",
    });
    expect(events[0]?.payload).toEqual(
      expect.objectContaining({
        jobId: job.id,
        mediaAssetId: mediaAssets[0]?.id,
        mediaAssetIds: mediaAssets.map((mediaAsset) => mediaAsset.id),
        mediaCount: 5,
        captionSent: true,
      }),
    );
  });

  it("executes campaign video steps through the guarded native media sender", async () => {
    const repos = createRepositories(db);
    const logger = pino({ level: "silent" });
    const videoPath = path.join(tempDir, "campaign-video.mp4");
    await fs.writeFile(videoPath, Buffer.from("ftypmp42"));
    const env = loadWorkerEnv({
      NODE_ENV: "test",
      DATABASE_URL: path.join(tempDir, "worker.db"),
      WORKER_ID: "worker-campaign-video",
      WORKER_BROWSER_ENABLED: "false",
      WORKER_JOB_LOOP_ENABLED: "true",
      WA_SEND_ALLOWED_PHONE: "5531982066263",
    });
    const user = await repos.users.create({
      email: "campaign-video@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const conversation = await repos.conversations.create({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "5531982066263",
      title: "Gabriel Braga Nuoma",
    });
    const mediaAsset = await repos.mediaAssets.create({
      userId: user.id,
      type: "video",
      fileName: "campaign-video.mp4",
      mimeType: "video/mp4",
      sha256: "d".repeat(64),
      sizeBytes: (await fs.stat(videoPath)).size,
      durationMs: 1000,
      storagePath: videoPath,
    });
    const job = await repos.jobs.create({
      userId: user.id,
      type: "campaign_step",
      status: "queued",
      payload: {
        campaignId: 14,
        recipientId: 24,
        conversationId: conversation.id,
        phone: "5531982066263",
        variables: {
          nome: "Gabriel",
        },
        step: {
          id: "video-1",
          label: "Video",
          type: "video",
          delaySeconds: 0,
          conditions: [],
          mediaAssetId: mediaAsset.id,
          caption: "Video para {{nome}}",
        },
      },
      scheduledAt: "2026-04-30T12:00:00.000Z",
      maxAttempts: 2,
    });
    if (!job) {
      throw new Error("expected campaign_step video job to be created");
    }
    const calls: unknown[] = [];

    await handleJob(job, {
      env,
      db,
      repos,
      logger,
      sync: {
        connected: true,
        metrics: {} as never,
        forceConversation: async () => {
          throw new Error("unexpected force sync");
        },
        sendTextMessage: async () => {
          throw new Error("unexpected text send");
        },
        sendVoiceMessage: async () => {
          throw new Error("unexpected voice send");
        },
        sendDocumentMessage: async () => {
          throw new Error("unexpected document send");
        },
        sendMediaMessage: async (input) => {
          calls.push(input);
          return {
            mode: "media-message",
            contentType: input.mediaType,
            conversationId: input.conversationId,
            phone: input.phone,
            reason: input.reason ?? "campaign_step",
            navigationMode: "reused-open-chat",
            externalId: "campaign-video-after",
            fileName: input.fileName,
            mimeType: input.mimeType,
            fileNames: input.files?.map((file) => file.fileName) ?? [input.fileName],
            mimeTypes: input.files?.map((file) => file.mimeType) ?? [input.mimeType],
            mediaCount: input.files?.length ?? 1,
            captionSent: Boolean(input.caption),
            visibleMessageCountBefore: 7,
            visibleMessageCountAfter: 8,
            lastExternalIdBefore: "campaign-video-before",
            lastExternalIdAfter: "campaign-video-after",
          };
        },
        close: async () => {},
      },
    });

    expect(calls).toEqual([
      expect.objectContaining({
        conversationId: conversation.id,
        phone: "5531982066263",
        mediaType: "video",
        filePath: videoPath,
        fileName: "campaign-video.mp4",
        mimeType: "video/mp4",
        caption: "Video para Gabriel",
        reason: "campaign_step",
      }),
    ]);
    const events = await repos.systemEvents.list({
      userId: user.id,
      type: "sender.campaign_step.completed",
    });
    expect(events[0]?.payload).toEqual(
      expect.objectContaining({
        jobId: job.id,
        campaignId: 14,
        recipientId: 24,
        stepId: "video-1",
        stepType: "video",
        mode: "media-message",
        contentType: "video",
        externalId: "campaign-video-after",
        mediaAssetId: mediaAsset.id,
        captionSent: true,
      }),
    );
  });
});

function createTestWav(durationSecs: number): Buffer {
  const sampleRate = 48_000;
  const channels = 1;
  const bytesPerSample = 2;
  const frameCount = Math.round(durationSecs * sampleRate);
  const dataSize = frameCount * channels * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  buffer.writeUInt16LE(channels * bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}
