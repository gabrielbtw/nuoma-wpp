import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import pino from "pino";

import { loadWorkerEnv } from "@nuoma/config";
import { createRepositories, openDb, runMigrations, type DbHandle } from "@nuoma/db";

import { handleJob } from "./job-handlers.js";
import { createJobLoop } from "./job-loop.js";

let tempDir: string;
let db: DbHandle;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nuoma-v2-worker-"));
  db = openDb(path.join(tempDir, "worker.db"));
  await runMigrations(db);
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
        phone: "5531982066263",
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
      }),
    );
  });

  it("allows production send policy beyond the test allowlist and audits before sending", async () => {
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
    });

    expect(calls).toEqual([
      expect.objectContaining({
        phone: "5531999999999",
        body: "envio permitido pela politica",
      }),
    ]);
    const events = await repos.systemEvents.list({
      userId: user.id,
      type: "sender.send_policy.allowed",
    });
    expect(events[0]?.payload).toEqual(
      expect.objectContaining({
        jobId: job.id,
        phone: "5531999999999",
        decision: "allowed",
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
  });

  it("applies temporary messages on the first batch step and restores on the last", async () => {
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
        phone: "5531982066263",
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
        phase: "before_send" | "after_completion_restore" | "failure_restore";
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
            hasComposer: true,
          },
        };
      },
      sendTextMessage: async (input: { conversationId: number; phone: string; body: string; reason?: string }) => {
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

    await handleJob(firstJob, { env, db, repos, logger, sync });
    await handleJob(lastJob, { env, db, repos, logger, sync });

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
    if (!job) {
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
