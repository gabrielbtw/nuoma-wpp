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
    expect(jobs[0]?.payload).toMatchObject({
      automationId: parent.id,
      phone: "5531982066263",
      step: { id: "reply" },
    });
    expect(new Date(jobs[0]!.scheduledAt).getTime()).toBeGreaterThanOrEqual(before + 125_000);
  });
});
