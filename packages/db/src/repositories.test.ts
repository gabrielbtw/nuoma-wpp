import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createRepositories, openDb, runMigrations, type DbHandle } from "./index.js";

let tempDir: string;
let handle: DbHandle;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nuoma-v2-db-"));
  handle = openDb(path.join(tempDir, "test.db"));
  await runMigrations(handle, path.resolve(import.meta.dirname, "./migrations"));
});

afterEach(async () => {
  handle.close();
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("repositories", () => {
  it("creates users, contacts, conversations and message inserts idempotently", async () => {
    const repos = createRepositories(handle);
    const user = await repos.users.create({
      email: "Admin@Nuoma.Local",
      passwordHash: "hash",
      role: "admin",
      displayName: "Admin",
    });
    const tag = await repos.tags.create({
      userId: user.id,
      name: "Lead quente",
      color: "#22C55E",
    });
    const followUpTag = await repos.tags.create({
      userId: user.id,
      name: "Follow-up",
      color: "#38BDF8",
    });
    const contact = await repos.contacts.create({
      userId: user.id,
      name: "Instagram only",
      phone: null,
      primaryChannel: "instagram",
      instagramHandle: "instagram.only",
      status: "active",
      tagIds: [tag.id],
    });
    const conversation = await repos.conversations.create({
      userId: user.id,
      contactId: contact.id,
      channel: "whatsapp",
      externalThreadId: "5531982066263@c.us",
      title: "Teste",
    });

    const first = await repos.messages.insertOrIgnore({
      userId: user.id,
      conversationId: conversation.id,
      contactId: contact.id,
      externalId: "wamid.test",
      direction: "inbound",
      contentType: "text",
      status: "received",
      body: "Oi",
      timestampPrecision: "minute",
      messageSecond: null,
      waInferredSecond: 59,
      observedAtUtc: "2026-04-30T15:00:42.123Z",
      raw: { source: "test" },
    });
    const duplicate = await repos.messages.insertOrIgnore({
      userId: user.id,
      conversationId: conversation.id,
      contactId: contact.id,
      externalId: "wamid.test",
      direction: "inbound",
      contentType: "text",
      status: "received",
      body: "Oi",
      timestampPrecision: "minute",
      messageSecond: null,
      waInferredSecond: 59,
      observedAtUtc: "2026-04-30T15:00:42.123Z",
    });

    expect(contact.phone).toBeNull();
    expect(contact.tagIds).toEqual([tag.id]);
    expect(first?.externalId).toBe("wamid.test");
    expect(duplicate).toBeNull();

    const updatedContact = await repos.contacts.update({
      id: contact.id,
      userId: user.id,
      tagIds: [followUpTag.id],
      notes: "Notas persistidas pela sidebar.",
    });
    expect(updatedContact?.tagIds).toEqual([followUpTag.id]);
    expect(updatedContact?.notes).toBe("Notas persistidas pela sidebar.");
  });

  it("deduplicates captured attachment candidates by conversation, message and asset", async () => {
    const repos = createRepositories(handle);
    const user = await repos.users.create({
      email: "attachments@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const conversation = await repos.conversations.create({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "5531982066263",
      title: "Anexos V2.6.27",
    });
    const message = await repos.messages.insertOrIgnore({
      userId: user.id,
      conversationId: conversation.id,
      contactId: null,
      externalId: "false_5531982066263@c.us_IMG",
      direction: "inbound",
      contentType: "image",
      status: "received",
      body: "foto do tratamento",
      timestampPrecision: "minute",
      messageSecond: null,
      waInferredSecond: 58,
      observedAtUtc: "2026-05-05T12:10:00.000Z",
      raw: { source: "test" },
    });
    const mediaAsset = await repos.mediaAssets.create({
      userId: user.id,
      type: "image",
      fileName: "tratamento.jpg",
      mimeType: "image/jpeg",
      sha256: "c".repeat(64),
      sizeBytes: 0,
      durationMs: null,
      storagePath: "wa-visible://" + "c".repeat(64),
      sourceUrl: null,
      deletedAt: null,
    });

    const first = await repos.attachmentCandidates.upsert({
      userId: user.id,
      conversationId: conversation.id,
      messageId: message?.id ?? null,
      mediaAssetId: mediaAsset.id,
      channel: "whatsapp",
      contentType: "image",
      externalMessageId: "false_5531982066263@c.us_IMG",
      caption: "foto do tratamento",
      observedAt: "2026-05-05T12:10:00.000Z",
      metadata: { source: "test", fileName: "tratamento.jpg" },
    });
    const second = await repos.attachmentCandidates.upsert({
      userId: user.id,
      conversationId: conversation.id,
      messageId: message?.id ?? null,
      mediaAssetId: mediaAsset.id,
      channel: "whatsapp",
      contentType: "image",
      externalMessageId: "false_5531982066263@c.us_IMG",
      caption: "foto do tratamento",
      observedAt: "2026-05-05T12:11:00.000Z",
      metadata: { source: "test", fileName: "tratamento-atualizado.jpg" },
    });

    const listed = await repos.attachmentCandidates.listByConversation({
      userId: user.id,
      conversationId: conversation.id,
    });
    const total = await repos.attachmentCandidates.countByConversation({
      userId: user.id,
      conversationId: conversation.id,
    });

    expect(second.id).toBe(first.id);
    expect(total).toBe(1);
    expect(listed).toEqual([
      expect.objectContaining({
        id: first.id,
        messageId: message?.id,
        mediaAssetId: mediaAsset.id,
        contentType: "image",
        observedAt: "2026-05-05T12:11:00.000Z",
        metadata: expect.objectContaining({ fileName: "tratamento-atualizado.jpg" }),
      }),
    ]);
  });

  it("lists and updates reminders by conversation", async () => {
    const repos = createRepositories(handle);
    const user = await repos.users.create({
      email: "reminders@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const conversation = await repos.conversations.create({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "5531982066263",
      title: "Reminder target",
    });

    const reminder = await repos.reminders.create({
      userId: user.id,
      conversationId: conversation.id,
      contactId: null,
      assignedToUserId: user.id,
      title: "Retornar orçamento",
      notes: "Enviar antes do fim do dia",
      dueAt: "2026-05-05T13:30:00.000Z",
      status: "open",
    });

    const listed = await repos.reminders.list({
      userId: user.id,
      conversationId: conversation.id,
      status: "open",
    });
    const updated = await repos.reminders.update({
      id: reminder.id,
      userId: user.id,
      status: "done",
      completedAt: "2026-05-05T13:35:00.000Z",
    });
    const open = await repos.reminders.list({
      userId: user.id,
      conversationId: conversation.id,
      status: "open",
    });

    expect(listed).toEqual([
      expect.objectContaining({ id: reminder.id, title: "Retornar orçamento" }),
    ]);
    expect(updated).toMatchObject({
      id: reminder.id,
      status: "done",
      completedAt: "2026-05-05T13:35:00.000Z",
    });
    expect(open).toHaveLength(0);
  });

  it("claims due jobs atomically and can backup the database", async () => {
    const repos = createRepositories(handle);
    const user = await repos.users.create({
      email: "jobs@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    await repos.jobs.create({
      userId: user.id,
      type: "send_message",
      status: "queued",
      payload: { conversationId: 1 },
      priority: 2,
      dedupeKey: "send_message:1",
      scheduledAt: "2026-04-30T12:00:00.000Z",
    });
    await repos.jobs.create({
      userId: user.id,
      type: "backup",
      status: "queued",
      payload: {},
      priority: 0,
      dedupeKey: "backup:1",
      scheduledAt: "2026-04-30T12:00:00.000Z",
    });

    const claimed = await repos.jobs.claimDueJobs({
      workerId: "worker-1",
      now: "2026-04-30T12:00:01.000Z",
      limit: 5,
    });
    const backupPath = path.join(tempDir, "backup.db");
    await handle.backupTo(backupPath);
    const backupStat = await fs.stat(backupPath);

    expect(claimed).toHaveLength(2);
    expect(claimed.map((job) => job.priority)).toEqual([0, 2]);
    expect(claimed[0]?.status).toBe("claimed");
    expect(claimed[0]?.attempts).toBe(1);
    expect(backupStat.size).toBeGreaterThan(0);
  });

  it("can exclude job types during claim", async () => {
    const repos = createRepositories(handle);
    const user = await repos.users.create({
      email: "job-filter@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    await repos.jobs.create({
      userId: user.id,
      type: "sync_conversation",
      status: "queued",
      payload: { conversationId: 1 },
      priority: 0,
      scheduledAt: "2026-04-30T12:00:00.000Z",
    });
    await repos.jobs.create({
      userId: user.id,
      type: "backup",
      status: "queued",
      payload: {},
      priority: 1,
      scheduledAt: "2026-04-30T12:00:00.000Z",
    });

    const claimed = await repos.jobs.claimDueJobs({
      workerId: "worker-no-sync",
      now: "2026-04-30T12:00:01.000Z",
      limit: 5,
      excludeTypes: ["sync_conversation"],
    });

    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.type).toBe("backup");
  });

  it("upserts observed conversations without duplicate-key races", async () => {
    const repos = createRepositories(handle);
    const user = await repos.users.create({
      email: "conversations@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });

    await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        repos.conversations.upsertObserved({
          userId: user.id,
          channel: "whatsapp",
          externalThreadId: "5531982066263",
          title: "Gabriel Braga Nuoma",
          lastMessageAt: `2026-04-30T12:00:${String(index).padStart(2, "0")}.000Z`,
          lastPreview: `msg ${index}`,
          unreadCount: index,
        }),
      ),
    );

    const conversations = await repos.conversations.list(user.id);
    const conversation = await repos.conversations.findByExternalThread({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "5531982066263",
    });

    expect(conversations).toHaveLength(1);
    expect(conversation?.title).toBe("Gabriel Braga Nuoma");
    expect(conversation?.externalThreadId).toBe("5531982066263");
  });

  it("excludes archived conversations from inbox lists", async () => {
    const repos = createRepositories(handle);
    const user = await repos.users.create({
      email: "archived-conversations@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });

    await repos.conversations.create({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "5531982066200",
      title: "+55 31 98206-6200",
      isArchived: false,
    });
    await repos.conversations.create({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "archived-thread",
      title: "Archived",
      isArchived: true,
    });
    await repos.conversations.create({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "WhatsApp",
      title: "WhatsApp",
      isArchived: false,
    });
    await repos.conversations.create({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "visto por último hoje às 20:44",
      title: "visto por último hoje às 20:44",
      lastMessageAt: "2026-05-05T00:00:00.000Z",
      isArchived: false,
    });

    const conversations = await repos.conversations.list(user.id);

    expect(conversations.map((conversation) => conversation.externalThreadId)).toEqual([
      "5531982066200",
    ]);
  });

  it("searches contacts through the physical FTS index and keeps it synced", async () => {
    const repos = createRepositories(handle);
    const user = await repos.users.create({
      email: "contact-search@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const contact = await repos.contacts.create({
      userId: user.id,
      name: "Maria Importada",
      phone: "5531982066264",
      email: "maria@example.com",
      primaryChannel: "whatsapp",
      instagramHandle: "maria.pele",
      notes: "Lead de melasma",
    });

    await repos.contacts.update({
      id: contact.id,
      userId: user.id,
      notes: "Lead de neferpeel",
    });

    const byUpdatedNotes = await repos.contacts.search({
      userId: user.id,
      query: "neferpeel",
    });
    expect(byUpdatedNotes.map((row) => row.id)).toEqual([contact.id]);

    await repos.contacts.softDelete(contact.id, user.id);

    const visible = await repos.contacts.search({
      userId: user.id,
      query: "neferpeel",
    });
    const includeDeleted = await repos.contacts.search({
      userId: user.id,
      query: "neferpeel",
      includeDeleted: true,
    });

    expect(visible).toEqual([]);
    expect(includeDeleted.map((row) => row.id)).toEqual([contact.id]);
  });

  it("keeps job claims disjoint across workers", async () => {
    const repos = createRepositories(handle);
    const user = await repos.users.create({
      email: "race@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });

    for (let index = 0; index < 100; index += 1) {
      await repos.jobs.create({
        userId: user.id,
        type: "backup",
        status: "queued",
        payload: { index },
        priority: index % 10,
        scheduledAt: "2026-04-30T12:00:00.000Z",
      });
    }

    const workerA = await repos.jobs.claimDueJobs({
      workerId: "worker-a",
      now: "2026-04-30T12:00:01.000Z",
      limit: 60,
    });
    const workerB = await repos.jobs.claimDueJobs({
      workerId: "worker-b",
      now: "2026-04-30T12:00:01.000Z",
      limit: 60,
    });
    const idsA = new Set(workerA.map((job) => job.id));
    const overlap = workerB.filter((job) => idsA.has(job.id));

    expect(workerA).toHaveLength(60);
    expect(workerB).toHaveLength(40);
    expect(overlap).toHaveLength(0);
    expect([...workerA, ...workerB].every((job) => job.status === "claimed")).toBe(true);
  });

  it("moves exhausted jobs to DLQ and retries them manually", async () => {
    const repos = createRepositories(handle);
    const user = await repos.users.create({
      email: "dlq@nuoma.local",
      passwordHash: "hash",
      role: "admin",
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

    expect(claimed).toBeDefined();
    await repos.jobs.moveToDead({ jobId: claimed?.id ?? 0, error: "invalid recipient" });

    const dead = await repos.jobs.listDead(user.id);
    expect(dead).toHaveLength(1);
    expect(dead[0]?.type).toBe("validate_recipient");
    expect(dead[0]?.payload).toEqual({ phone: "5531982066263" });

    const retried = await repos.jobs.retryDead({
      deadJobId: dead[0]?.id ?? 0,
      userId: user.id,
      scheduledAt: "2026-04-30T12:10:00.000Z",
    });
    const deadAfterRetry = await repos.jobs.listDead(user.id);

    expect(retried?.status).toBe("queued");
    expect(retried?.scheduledAt).toBe("2026-04-30T12:10:00.000Z");
    expect(deadAfterRetry).toHaveLength(0);
  });

  it("upserts worker heartbeat and guards scheduler locks by owner/ttl", async () => {
    const repos = createRepositories(handle);
    await repos.workerState.heartbeat({
      workerId: "worker-1",
      status: "busy",
      currentJobId: 123,
      pid: 456,
      rssMb: 200,
      browserConnected: false,
      metrics: { claimed: 1 },
    });
    await repos.workerState.heartbeat({
      workerId: "worker-1",
      status: "idle",
      currentJobId: null,
      pid: 456,
      rssMb: 201,
      browserConnected: true,
      metrics: { completed: 1 },
    });

    const state = await repos.workerState.get("worker-1");
    expect(state?.status).toBe("idle");
    expect(state?.browserConnected).toBe(true);
    expect(state?.metrics).toEqual({ completed: 1 });
    const states = await repos.workerState.list();
    expect(states.map((item) => item.workerId)).toEqual(["worker-1"]);

    await expect(
      repos.schedulerLocks.acquire({
        name: "campaign-tick",
        ownerId: "scheduler-a",
        ttlMs: 60_000,
      }),
    ).resolves.toBe(true);
    await expect(
      repos.schedulerLocks.acquire({
        name: "campaign-tick",
        ownerId: "scheduler-b",
        ttlMs: 60_000,
      }),
    ).resolves.toBe(false);
    await repos.schedulerLocks.release({ name: "campaign-tick", ownerId: "scheduler-a" });
    await expect(
      repos.schedulerLocks.acquire({
        name: "campaign-tick",
        ownerId: "scheduler-b",
        ttlMs: 60_000,
      }),
    ).resolves.toBe(true);
  });

  it("counts jobs and active DLQ entries for operational dashboards", async () => {
    const repos = createRepositories(handle);
    const user = await repos.users.create({
      email: "metrics@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const queued = await repos.jobs.create({
      userId: user.id,
      type: "send_message",
      status: "queued",
      payload: { conversationId: 1, body: "oi" },
      scheduledAt: "2026-04-30T12:00:00.000Z",
      maxAttempts: 2,
    });
    await repos.jobs.create({
      userId: user.id,
      type: "backup",
      status: "completed",
      payload: {},
      scheduledAt: "2026-04-30T12:00:00.000Z",
      maxAttempts: 1,
    });
    if (!queued) {
      throw new Error("expected queued job");
    }
    const [claimed] = await repos.jobs.claimDueJobs({
      workerId: "worker-metrics",
      now: "2026-04-30T12:01:00.000Z",
    });
    if (!claimed) {
      throw new Error("expected claimed job");
    }
    await repos.jobs.moveToDead({ jobId: claimed.id, error: "bad target" });

    await expect(repos.jobs.countByStatus(user.id)).resolves.toEqual({
      completed: 1,
      failed: 1,
    });
    await expect(repos.jobs.countDead(user.id)).resolves.toBe(1);
  });
});
