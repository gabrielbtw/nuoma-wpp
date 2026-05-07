import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import pino from "pino";

import { loadWorkerEnv } from "@nuoma/config";
import { createRepositories, openDb, runMigrations } from "@nuoma/db";

import { createJobLoop } from "../apps/worker/src/job-loop.js";

async function main() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nuoma-v25-sender-runtime-"));
  const dbPath = path.join(tempDir, "worker.db");
  const db = openDb(dbPath);

  try {
    await runMigrations(db);
    const repos = createRepositories(db);
    const logger = pino({ level: "silent" });
    const env = loadWorkerEnv({
      NODE_ENV: "test",
      DATABASE_URL: dbPath,
      WORKER_ID: "worker-v25-smoke",
      WORKER_BROWSER_ENABLED: "false",
      WORKER_JOB_LOOP_ENABLED: "true",
      WA_SEND_ALLOWED_PHONE: "5531982066263",
      WA_SEND_RATE_LIMIT_MAX: "10",
    });
    const user = await repos.users.create({
      email: "v25-sender@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const allowedConversation = await repos.conversations.create({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "5531982066263",
      title: "Gabriel Braga Nuoma",
    });
    const blockedConversation = await repos.conversations.create({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "553100009999",
      title: "Blocked Target",
    });

    const noRuntimeJob = await repos.jobs.create({
      userId: user.id,
      type: "send_message",
      status: "queued",
      payload: {
        conversationId: allowedConversation.id,
        phone: "5531982066263",
        body: "nao deve ser claimado sem runtime",
      },
      scheduledAt: "2026-01-01T12:00:00.000Z",
      maxAttempts: 2,
    });
    assert(noRuntimeJob, "no-runtime job was not created");
    const noRuntimeLoop = createJobLoop({
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
    const noRuntimeProcessed = await noRuntimeLoop.processOne();
    assert(noRuntimeProcessed === false, "send job was claimed without connected runtime");
    assert((await repos.jobs.list(user.id, "queued")).some((job) => job.id === noRuntimeJob.id), {
      message: "no-runtime job did not remain queued",
    });
    db.raw.prepare("DELETE FROM jobs WHERE id = ?").run(noRuntimeJob.id);

    const allowedJob = await repos.jobs.create({
      userId: user.id,
      type: "send_message",
      status: "queued",
      payload: {
        conversationId: allowedConversation.id,
        phone: "5531982066263",
        body: "V2.5 sender runtime smoke",
      },
      scheduledAt: "2026-01-01T12:01:00.000Z",
      maxAttempts: 2,
    });
    const blockedJob = await repos.jobs.create({
      userId: user.id,
      type: "send_message",
      status: "queued",
      payload: {
        conversationId: blockedConversation.id,
        phone: "553100009999",
        body: "bloquear por allowlist",
      },
      scheduledAt: "2026-01-01T12:02:00.000Z",
      maxAttempts: 2,
    });
    assert(allowedJob && blockedJob, "runtime jobs were not created");

    const sendCalls: Array<{ conversationId: number; phone: string; body: string }> = [];
    const sync = {
      connected: true,
      metrics: {} as never,
      forceConversation: async () => {
        throw new Error("unexpected force sync");
      },
      sendTextMessage: async (input: { conversationId: number; phone: string; body: string }) => {
        sendCalls.push(input);
        return {
          mode: "text-message" as const,
          conversationId: input.conversationId,
          phone: input.phone,
          reason: "send_message",
          navigationMode: "reused-open-chat" as const,
          externalId: "v25-smoke-text-after",
          visibleMessageCountBefore: 1,
          visibleMessageCountAfter: 2,
          lastExternalIdBefore: "v25-smoke-text-before",
          lastExternalIdAfter: "v25-smoke-text-after",
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

    const runtimeLoop = createJobLoop({
      env,
      repos,
      logger,
      handlerContext: {
        env,
        db,
        repos,
        logger,
        sync,
      },
    });

    assert(await runtimeLoop.processOne(), "allowed job was not processed");
    assert(await runtimeLoop.processOne(), "blocked job was not processed");

    assert(sendCalls.length === 1, `unexpected send call count ${sendCalls.length}`);
    assert(sendCalls[0]?.phone === "5531982066263", "allowed send phone mismatch");

    const completed = await repos.jobs.list(user.id, "completed");
    assert(completed.some((job) => job.id === allowedJob.id), "allowed job was not completed");
    const dead = await repos.jobs.listDead(user.id);
    assert(dead.some((job) => job.originalJobId === blockedJob.id), "blocked job did not enter DLQ");

    const allowedEvents = await repos.systemEvents.list({
      userId: user.id,
      type: "sender.send_policy.allowed",
    });
    const blockedEvents = await repos.systemEvents.list({
      userId: user.id,
      type: "sender.send_policy.blocked",
    });
    const textEvents = await repos.systemEvents.list({
      userId: user.id,
      type: "sender.text_message.completed",
    });

    assert(allowedEvents.length >= 1, "allowed send policy event missing");
    assert(blockedEvents.length >= 1, "blocked send policy event missing");
    assert(textEvents[0]?.payload.mode === "text-message", "text completion event missing");
    assert(blockedEvents[0]?.payload.reason === "not_allowlisted_for_test_execution", {
      message: "blocked event reason mismatch",
    });

    console.log("v25-sender-runtime|claim_guard=ok|send=ok|allowlist_block=ok|dlq=ok|status=closed");
  } finally {
    db.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function assert(
  condition: unknown,
  messageOrInput: string | { message: string },
): asserts condition {
  if (!condition) {
    const message = typeof messageOrInput === "string" ? messageOrInput : messageOrInput.message;
    throw new Error(`V2.5 sender runtime smoke failed: ${message}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
