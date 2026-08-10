import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import argon2 from "argon2";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createRepositories, openDb, runMigrations, type DbHandle } from "@nuoma/db";

import { createAutomationEngineDaemon } from "./automation-engine-daemon.js";
import { triggerAutomationForPhone } from "./automation-trigger.js";

let tempDir: string;
let db: DbHandle;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nuoma-v2-automation-engine-"));
  db = openDb(path.join(tempDir, "automation.db"));
  await runMigrations(db);
});

afterEach(async () => {
  db.close();
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("automation engine daemon", () => {
  it("queues chatbot_reply jobs for new inbound messages matching active chatbot rules", async () => {
    const repos = createRepositories(db);
    const passwordHash = await argon2.hash("initial-password-123", { type: argon2.argon2id });
    const user = await repos.users.create({
      email: "chatbot-inbound@nuoma.local",
      passwordHash,
      role: "admin",
    });
    const contact = await repos.contacts.create({
      userId: user.id,
      name: "Gabriel",
      phone: "5531982066263",
      primaryChannel: "whatsapp",
      status: "lead",
    });
    const conversation = await repos.conversations.create({
      userId: user.id,
      contactId: contact.id,
      channel: "whatsapp",
      externalThreadId: "5531982066263",
      title: "Gabriel",
    });
    const chatbot = await repos.chatbots.create({
      userId: user.id,
      name: "Atendimento inbound",
      channel: "whatsapp",
      status: "active",
      fallbackMessage: null,
      metadata: {},
    });
    const rule = await repos.chatbots.createRule({
      userId: user.id,
      chatbotId: chatbot.id,
      name: "Preco",
      priority: 10,
      match: { type: "contains", value: "preco" },
      segment: {
        operator: "and",
        conditions: [{ field: "status", operator: "eq", value: "lead" }],
      },
      actions: [
        {
          type: "send_step",
          step: {
            id: "reply-price",
            label: "Resposta de preco",
            type: "text",
            template: "Oi {{nome}}, aqui esta o preco.",
            delaySeconds: 0,
            conditions: [],
          },
        },
      ],
      metadata: {},
      isActive: true,
    });
    const message = await repos.messages.create({
      userId: user.id,
      conversationId: conversation.id,
      contactId: contact.id,
      externalId: "MSG-CHATBOT-IN-1",
      direction: "inbound",
      contentType: "text",
      status: "received",
      body: "Qual o preco?",
      observedAtUtc: "2026-05-04T12:00:00.000Z",
    });

    const daemon = createAutomationEngineDaemon({
      repos,
      logger: pino({ level: "silent" }),
      enabled: true,
      userId: user.id,
      allowedPhone: "5531982066263",
      intervalMs: 1_000,
    });

    const first = await daemon.tick();
    const second = await daemon.tick();
    const jobs = await repos.jobs.list(user.id, "queued");
    const events = await repos.systemEvents.list({
      userId: user.id,
      type: "chatbot.execution.evaluated",
    });

    expect(first).toMatchObject({
      scannedMessages: 1,
      chatbotsEvaluated: 1,
      chatbotRepliesCreated: 1,
      jobsCreated: 1,
    });
    expect(second.scannedMessages).toBe(0);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      type: "chatbot_reply",
      maxAttempts: 1,
    });
    expect(jobs[0]?.payload).toMatchObject({
      conversationId: conversation.id,
      contactId: contact.id,
      phone: "5531982066263",
      chatbotId: chatbot.id,
      ruleId: rule.id,
      sourceMessageId: message.id,
      step: {
        id: "reply-price",
        type: "text",
      },
      variables: {
        nome: "Gabriel",
        phone: "5531982066263",
      },
    });
    expect(String(jobs[0]?.payload.idempotencyKey)).toMatch(/^chatbot_reply:/);
    expect(jobs[0]?.dedupeKey).toBe(jobs[0]?.payload.idempotencyKey);
    expect(events).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          chatbotId: chatbot.id,
          ruleId: rule.id,
          matched: true,
          executionMode: "inbound",
          wouldEnqueueJobs: true,
          jobsCreated: 1,
        }),
      }),
    ]);
  });

  it("triggers active message_received automations for new inbound messages", async () => {
    const repos = createRepositories(db);
    const passwordHash = await argon2.hash("initial-password-123", { type: argon2.argon2id });
    const user = await repos.users.create({
      email: "admin@nuoma.local",
      passwordHash,
      role: "admin",
    });
    const tag = await repos.tags.create({
      userId: user.id,
      name: "Respondeu",
      color: "#22c55e",
    });
    const contact = await repos.contacts.create({
      userId: user.id,
      name: "Gabriel",
      phone: "5531982066263",
      primaryChannel: "whatsapp",
      status: "lead",
    });
    const conversation = await repos.conversations.create({
      userId: user.id,
      contactId: contact.id,
      channel: "whatsapp",
      externalThreadId: "5531982066263",
      title: "Gabriel",
    });
    await repos.automations.create({
      userId: user.id,
      name: "Resposta inbound",
      category: "Relacionamento",
      status: "active",
      trigger: { type: "message_received", channel: "whatsapp" },
      condition: {
        requireWithin24hWindow: true,
        segment: {
          operator: "and",
          conditions: [{ field: "status", operator: "eq", value: "lead" }],
        },
      },
      actions: [
        { type: "apply_tag", tagId: tag.id },
        { type: "set_status", status: "active" },
        {
          type: "create_reminder",
          title: "Follow-up",
          dueAt: "2026-05-05T12:00:00.000Z",
        },
        {
          type: "send_step",
          step: {
            id: "reply",
            label: "Resposta",
            type: "text",
            template: "Oi {{nome}}",
            delaySeconds: 0,
            conditions: [],
          },
        },
      ],
      metadata: {},
    });
    await repos.messages.create({
      userId: user.id,
      conversationId: conversation.id,
      contactId: contact.id,
      externalId: "MSG-IN-1",
      direction: "inbound",
      contentType: "text",
      status: "received",
      body: "Oi",
      observedAtUtc: "2026-05-04T12:00:00.000Z",
    });

    const daemon = createAutomationEngineDaemon({
      repos,
      logger: pino({ level: "silent" }),
      enabled: true,
      userId: user.id,
      allowedPhone: "5531982066263",
      intervalMs: 1_000,
    });

    const first = await daemon.tick();
    const second = await daemon.tick();
    const jobs = await repos.jobs.list(user.id, "queued");
    const updatedContact = await repos.contacts.findById(contact.id);
    const reminders = await repos.reminders.dueBefore(user.id, "2026-05-06T00:00:00.000Z");

    expect(first).toMatchObject({
      scannedMessages: 1,
      automationsEvaluated: 1,
      triggered: 1,
      jobsCreated: 1,
      actionsApplied: 3,
    });
    expect(second.scannedMessages).toBe(0);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.maxAttempts).toBe(1);
    expect(jobs[0]?.payload).toMatchObject({
      automationId: expect.any(Number),
      phone: "5531982066263",
      sourceMessageId: 1,
    });
    expect(updatedContact?.status).toBe("active");
    expect(updatedContact?.tagIds).toContain(tag.id);
    expect(reminders).toHaveLength(1);
    expect(reminders[0]?.title).toBe("Follow-up");
  });

  it("triggers tag_applied automations from contact tag domain events", async () => {
    const repos = createRepositories(db);
    const user = await repos.users.create({
      email: "tag-applied@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const tag = await repos.tags.create({ userId: user.id, name: "VIP", color: "#f97316" });
    const contact = await repos.contacts.create({
      userId: user.id,
      name: "Gabriel",
      phone: "5531982066263",
      primaryChannel: "whatsapp",
      status: "lead",
    });
    await repos.automations.create({
      userId: user.id,
      name: "Tag aplicada",
      category: "Tags",
      status: "active",
      trigger: { type: "tag_applied", tagId: tag.id, channel: "whatsapp" },
      condition: { requireWithin24hWindow: false, segment: null },
      actions: [
        {
          type: "send_step",
          step: {
            id: "tag-reply",
            label: "Resposta tag",
            type: "text",
            template: "Tag aplicada para {{nome}}",
            delaySeconds: 0,
            conditions: [],
          },
        },
      ],
      metadata: {},
    });
    await repos.systemEvents.create({
      userId: user.id,
      type: "contact.tag_applied",
      severity: "info",
      payload: JSON.stringify({
        contactId: contact.id,
        phone: contact.phone,
        tagId: tag.id,
        source: "test",
      }),
    });

    const daemon = createAutomationEngineDaemon({
      repos,
      logger: pino({ level: "silent" }),
      enabled: true,
      userId: user.id,
      allowedPhone: "5531982066263",
      intervalMs: 1_000,
    });
    const result = await daemon.tick();
    const jobs = await repos.jobs.list(user.id, "queued");

    expect(result).toMatchObject({
      scannedEvents: 1,
      automationsEvaluated: 1,
      triggered: 1,
      jobsCreated: 1,
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.payload).toMatchObject({
      automationId: expect.any(Number),
      phone: "5531982066263",
      step: { id: "tag-reply" },
    });
  });

  it("triggers tag_removed automations from contact tag domain events", async () => {
    const repos = createRepositories(db);
    const user = await repos.users.create({
      email: "tag-removed@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const tag = await repos.tags.create({ userId: user.id, name: "Saiu", color: "#ef4444" });
    const contact = await repos.contacts.create({
      userId: user.id,
      name: "Gabriel",
      phone: "5531982066263",
      primaryChannel: "whatsapp",
      status: "lead",
    });
    await repos.automations.create({
      userId: user.id,
      name: "Tag removida",
      category: "Tags",
      status: "active",
      trigger: { type: "tag_removed", tagId: tag.id, channel: "whatsapp" },
      condition: { requireWithin24hWindow: false, segment: null },
      actions: [{ type: "set_status", status: "active" }],
      metadata: {},
    });
    await repos.systemEvents.create({
      userId: user.id,
      type: "contact.tag_removed",
      severity: "info",
      payload: JSON.stringify({
        contactId: contact.id,
        phone: contact.phone,
        tagId: tag.id,
        source: "test",
      }),
    });

    const daemon = createAutomationEngineDaemon({
      repos,
      logger: pino({ level: "silent" }),
      enabled: true,
      userId: user.id,
      allowedPhone: "5531982066263",
      intervalMs: 1_000,
    });
    const result = await daemon.tick();
    const updated = await repos.contacts.findById(contact.id);

    expect(result).toMatchObject({
      scannedEvents: 1,
      automationsEvaluated: 1,
      triggered: 1,
      actionsApplied: 1,
    });
    expect(updated?.status).toBe("active");
  });

  it("triggers campaign_completed automations from recipient completion events", async () => {
    const repos = createRepositories(db);
    const user = await repos.users.create({
      email: "campaign-completed@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const contact = await repos.contacts.create({
      userId: user.id,
      name: "Gabriel",
      phone: "5531982066263",
      primaryChannel: "whatsapp",
      status: "lead",
    });
    const campaign = await repos.campaigns.create({
      userId: user.id,
      name: "Campanha origem",
      channel: "whatsapp",
      status: "running",
      evergreen: false,
      startsAt: null,
      completedAt: null,
      segment: null,
      steps: [
        {
          id: "origin",
          label: "Origem",
          type: "text",
          template: "Origem",
          delaySeconds: 0,
          conditions: [],
        },
      ],
      metadata: {},
    });
    await repos.automations.create({
      userId: user.id,
      name: "Campanha concluida",
      category: "Campanhas",
      status: "active",
      trigger: { type: "campaign_completed", campaignId: campaign.id, channel: "whatsapp" },
      condition: { requireWithin24hWindow: false, segment: null },
      actions: [
        {
          type: "send_step",
          step: {
            id: "after-campaign",
            label: "Depois da campanha",
            type: "text",
            template: "Campanha concluida para {{nome}}",
            delaySeconds: 0,
            conditions: [],
          },
        },
      ],
      metadata: {},
    });
    await repos.systemEvents.create({
      userId: user.id,
      type: "campaign.recipient_completed",
      severity: "info",
      payload: JSON.stringify({
        campaignId: campaign.id,
        recipientId: 123,
        contactId: contact.id,
        channel: "whatsapp",
        phone: contact.phone,
        source: "test",
      }),
    });

    const daemon = createAutomationEngineDaemon({
      repos,
      logger: pino({ level: "silent" }),
      enabled: true,
      userId: user.id,
      allowedPhone: "5531982066263",
      intervalMs: 1_000,
    });
    const result = await daemon.tick();
    const jobs = await repos.jobs.list(user.id, "queued");

    expect(result).toMatchObject({
      scannedEvents: 1,
      automationsEvaluated: 1,
      triggered: 1,
      jobsCreated: 1,
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.payload).toMatchObject({
      automationId: expect.any(Number),
      phone: "5531982066263",
      step: { id: "after-campaign" },
    });
  });

  it("resolves WhatsApp automations by wa_jid when the thread id is a saved display name", async () => {
    const repos = createRepositories(db);
    const passwordHash = await argon2.hash("initial-password-123", { type: argon2.argon2id });
    const user = await repos.users.create({
      email: "admin-wa-jid-automation@nuoma.local",
      passwordHash,
      role: "admin",
    });
    const contact = await repos.contacts.create({
      userId: user.id,
      name: "Gabriel Salvo",
      phone: "+55 31 9 8206-6263",
      waJid: "5531982066263@s.whatsapp.net",
      primaryChannel: "whatsapp",
      status: "lead",
    });
    const conversation = await repos.conversations.create({
      userId: user.id,
      contactId: contact.id,
      channel: "whatsapp",
      externalThreadId: "Gabriel Salvo",
      waJid: "5531982066263@s.whatsapp.net",
      title: "Gabriel Salvo",
    });
    await repos.automations.create({
      userId: user.id,
      name: "Resposta por JID",
      category: "Relacionamento",
      status: "active",
      trigger: { type: "message_received", channel: "whatsapp" },
      condition: { segment: null, requireWithin24hWindow: true },
      actions: [
        {
          type: "send_step",
          step: {
            id: "jid-reply",
            label: "Resposta JID",
            type: "text",
            template: "Oi {{telefone}}",
            delaySeconds: 0,
            conditions: [],
          },
        },
      ],
      metadata: {},
    });
    await repos.messages.create({
      userId: user.id,
      conversationId: conversation.id,
      contactId: contact.id,
      externalId: "MSG-JID-IN-1",
      direction: "inbound",
      contentType: "text",
      status: "received",
      body: "Oi",
      observedAtUtc: "2026-05-04T12:00:00.000Z",
    });

    const daemon = createAutomationEngineDaemon({
      repos,
      logger: pino({ level: "silent" }),
      enabled: true,
      userId: user.id,
      allowedPhone: "31982066263",
      intervalMs: 1_000,
    });

    const result = await daemon.tick();
    const jobs = await repos.jobs.list(user.id, "queued");

    expect(result).toMatchObject({
      scannedMessages: 1,
      automationsEvaluated: 1,
      triggered: 1,
      jobsCreated: 1,
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.payload).toMatchObject({
      automationId: expect.any(Number),
      phone: "5531982066263",
      sourceMessageId: 1,
      variables: expect.objectContaining({
        telefone: "5531982066263",
        phone: "5531982066263",
      }),
    });
  });

  it("triggers Instagram inbound automations using instagramHandle identity", async () => {
    const repos = createRepositories(db);
    const passwordHash = await argon2.hash("initial-password-123", { type: argon2.argon2id });
    const user = await repos.users.create({
      email: "admin-ig@nuoma.local",
      passwordHash,
      role: "admin",
    });
    const contact = await repos.contacts.create({
      userId: user.id,
      name: "Gabriel IG",
      phone: null,
      primaryChannel: "instagram",
      instagramHandle: "gabriell_braga",
      status: "lead",
    });
    const conversation = await repos.conversations.create({
      userId: user.id,
      contactId: contact.id,
      channel: "instagram",
      externalThreadId: "110051807055981",
      title: "Gabriel IG",
    });
    await repos.automations.create({
      userId: user.id,
      name: "Resposta IG",
      category: "Instagram",
      status: "active",
      trigger: { type: "message_received", channel: "instagram" },
      condition: { segment: null, requireWithin24hWindow: true },
      actions: [
        {
          type: "send_step",
          step: {
            id: "ig-reply",
            label: "Resposta IG",
            type: "text",
            template: "Oi @{{instagram}}",
            delaySeconds: 0,
            conditions: [],
          },
        },
      ],
      metadata: {},
    });
    await repos.messages.create({
      userId: user.id,
      conversationId: conversation.id,
      contactId: contact.id,
      externalId: "IG-IN-1",
      direction: "inbound",
      contentType: "text",
      status: "received",
      body: "Oi IG",
      observedAtUtc: "2026-05-04T12:00:00.000Z",
    });

    const daemon = createAutomationEngineDaemon({
      repos,
      logger: pino({ level: "silent" }),
      enabled: true,
      userId: user.id,
      allowedPhone: "5531982066263",
      intervalMs: 1_000,
    });

    const result = await daemon.tick();
    const jobs = await repos.jobs.list(user.id, "queued");

    expect(result).toMatchObject({
      scannedMessages: 1,
      automationsEvaluated: 1,
      triggered: 1,
      jobsCreated: 1,
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.payload).toMatchObject({
      automationId: expect.any(Number),
      phone: null,
      instagramHandle: "gabriell_braga",
      sourceMessageId: 1,
      variables: {
        telefone: "",
        phone: "",
        instagram: "gabriell_braga",
        instagramHandle: "gabriell_braga",
      },
    });
  });

  it("does not trigger Instagram automations from a display-title-only handle", async () => {
    const repos = createRepositories(db);
    const passwordHash = await argon2.hash("initial-password-123", { type: argon2.argon2id });
    const user = await repos.users.create({
      email: "admin-ig-title-only@nuoma.local",
      passwordHash,
      role: "admin",
    });
    const contact = await repos.contacts.create({
      userId: user.id,
      name: "Gabriel IG",
      phone: null,
      primaryChannel: "instagram",
      instagramHandle: null,
      status: "lead",
    });
    const conversation = await repos.conversations.create({
      userId: user.id,
      contactId: contact.id,
      channel: "instagram",
      externalThreadId: "direct-thread-123",
      title: "@gabriell_braga",
    });
    await repos.automations.create({
      userId: user.id,
      name: "Resposta IG",
      category: "Instagram",
      status: "active",
      trigger: { type: "message_received", channel: "instagram" },
      condition: { segment: null, requireWithin24hWindow: true },
      actions: [
        {
          type: "send_step",
          step: {
            id: "ig-reply",
            label: "Resposta IG",
            type: "text",
            template: "Oi @{{instagram}}",
            delaySeconds: 0,
            conditions: [],
          },
        },
      ],
      metadata: {},
    });
    await repos.messages.create({
      userId: user.id,
      conversationId: conversation.id,
      contactId: contact.id,
      externalId: "IG-IN-TITLE",
      direction: "inbound",
      contentType: "text",
      status: "received",
      body: "Oi IG",
      observedAtUtc: "2026-05-04T12:00:00.000Z",
    });

    const daemon = createAutomationEngineDaemon({
      repos,
      logger: pino({ level: "silent" }),
      enabled: true,
      userId: user.id,
      allowedPhone: "5531982066263",
      intervalMs: 1_000,
    });

    const result = await daemon.tick();
    const jobs = await repos.jobs.list(user.id, "queued");

    expect(result).toMatchObject({
      scannedMessages: 1,
      automationsEvaluated: 0,
      triggered: 0,
      jobsCreated: 0,
      skipped: [expect.objectContaining({ reason: "conversation_instagram_missing" })],
    });
    expect(jobs).toHaveLength(0);
  });

  it("executes delay, branch target, notify and child automation actions safely", async () => {
    const repos = createRepositories(db);
    const passwordHash = await argon2.hash("initial-password-123", { type: argon2.argon2id });
    const user = await repos.users.create({
      email: "admin@nuoma.local",
      passwordHash,
      role: "admin",
    });
    const contact = await repos.contacts.create({
      userId: user.id,
      name: "Gabriel",
      phone: "5531982066263",
      primaryChannel: "whatsapp",
      status: "lead",
    });
    const conversation = await repos.conversations.create({
      userId: user.id,
      contactId: contact.id,
      channel: "whatsapp",
      externalThreadId: "5531982066263",
      title: "Gabriel",
    });
    const child = await repos.automations.create({
      userId: user.id,
      name: "Filha status",
      category: "Teste",
      status: "active",
      trigger: { type: "message_received", channel: "whatsapp" },
      condition: { segment: null, requireWithin24hWindow: false },
      actions: [{ id: "child-status", type: "set_status", status: "active" }],
      metadata: {},
    });
    const parent = await repos.automations.create({
      userId: user.id,
      name: "Branch completo",
      category: "Teste",
      status: "active",
      trigger: { type: "message_received", channel: "whatsapp" },
      condition: { segment: null, requireWithin24hWindow: false },
      actions: [
        { id: "delay-1", type: "delay", seconds: 120, label: "Aguardar 2m" },
        {
          id: "branch-1",
          type: "branch",
          label: "Se lead",
          condition: {
            operator: "and",
            conditions: [{ field: "status", operator: "eq", value: "lead" }],
          },
          targetActionId: "notify-1",
        },
        { id: "skip-me", type: "set_status", status: "blocked" },
        {
          id: "notify-1",
          type: "notify_attendant",
          attendantId: null,
          message: "Lead passou no branch.",
        },
        { id: "trigger-child", type: "trigger_automation", automationId: child.id },
        {
          id: "send-1",
          type: "send_step",
          step: {
            id: "reply",
            label: "Resposta",
            type: "text",
            template: "Oi {{nome}}",
            delaySeconds: 5,
            conditions: [],
          },
        },
      ],
      metadata: {},
    });

    const before = Date.now();
    const result = await triggerAutomationForPhone({
      repos,
      userId: user.id,
      automationId: parent.id,
      phone: "5531982066263",
      dryRun: false,
      allowedPhone: "5531982066263",
      conversationId: conversation.id,
      within24hWindow: true,
    });
    const jobs = await repos.jobs.list(user.id, "queued");
    const updatedContact = await repos.contacts.findById(contact.id);
    const notifyEvents = await repos.systemEvents.list({
      userId: user.id,
      type: "automation.attendant_notify.planned",
      limit: 5,
    });

    expect(result).toMatchObject({
      eligible: true,
      dryRun: false,
      jobsCreated: 1,
      skippedActions: [],
    });
    expect(result.actionsApplied).toBe(5);
    expect(updatedContact?.status).toBe("active");
    expect(notifyEvents).toHaveLength(1);
    expect(notifyEvents[0]?.payload).toMatchObject({
      automationId: parent.id,
      message: "Lead passou no branch.",
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.maxAttempts).toBe(1);
    expect(jobs[0]?.payload).toMatchObject({
      automationId: parent.id,
      phone: "5531982066263",
      step: { id: "reply" },
    });
    expect(new Date(jobs[0]!.scheduledAt).getTime()).toBeGreaterThanOrEqual(before + 125_000);
  });
});
