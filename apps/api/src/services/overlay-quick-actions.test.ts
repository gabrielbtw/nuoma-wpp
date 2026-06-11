import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createRepositories, openDb, runMigrations, type DbHandle } from "@nuoma/db";

import { applyOverlayQuickAction, listOverlayAutomationHistory } from "./overlay-quick-actions.js";

let tempDir: string;
let db: DbHandle;

const phone = "5531982066263";

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nuoma-v2-overlay-quick-actions-"));
  db = openDb(path.join(tempDir, "api.db"));
  await runMigrations(db);
});

afterEach(async () => {
  db.close();
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("overlay quick actions", () => {
  it("applies tag, status, reminder and automation history by canonical phone", async () => {
    const repos = createRepositories(db);
    const user = await repos.users.create({
      email: "overlay-actions@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const tag = await repos.tags.create({
      userId: user.id,
      name: "VIP",
      color: "#22c55e",
      description: "Contato prioritario",
    });
    const contact = await repos.contacts.create({
      userId: user.id,
      name: "Neferpeel",
      phone,
      primaryChannel: "whatsapp",
      status: "lead",
    });

    const tagResult = await applyOverlayQuickAction({
      repos,
      userId: user.id,
      phone: "31982066263",
      waJid: `${phone}@s.whatsapp.net`,
      action: "applyTag",
      tagId: tag.id,
      source: "unit-test",
    });
    expect(tagResult).toMatchObject({
      ok: true,
      action: "applyTag",
      contact: { id: contact.id, tagIds: [tag.id] },
    });

    const statusResult = await applyOverlayQuickAction({
      repos,
      userId: user.id,
      phone,
      action: "setStatus",
      status: "active",
      source: "unit-test",
    });
    expect(statusResult).toMatchObject({
      ok: true,
      action: "setStatus",
      contact: { id: contact.id, status: "active" },
    });

    const reminderResult = await applyOverlayQuickAction({
      repos,
      userId: user.id,
      phone,
      action: "createReminder",
      reminderTitle: "Retornar lead",
      reminderDueAt: "2026-06-12T12:00:00.000Z",
      source: "unit-test",
    });
    expect(reminderResult).toMatchObject({
      ok: true,
      action: "createReminder",
      reminder: { title: "Retornar lead", contactId: contact.id, status: "open" },
    });

    await repos.systemEvents.create({
      userId: user.id,
      type: "automation.overlay.dispatched",
      severity: "info",
      payload: JSON.stringify({
        automationId: 42,
        phone,
        eligible: true,
        reasons: [],
        jobsCreated: 1,
        actionsApplied: 2,
        dispatchedAtUtc: "2026-06-11T10:00:00.000Z",
      }),
    });

    const history = await listOverlayAutomationHistory({
      repos,
      userId: user.id,
      phone: "31982066263",
    });
    expect(history).toEqual([
      expect.objectContaining({
        type: "automation.overlay.dispatched",
        automationId: 42,
        phone,
        eligible: true,
        jobsCreated: 1,
        actionsApplied: 2,
      }),
    ]);
  });

  it("rejects quick actions when the overlay identity has no CRM contact", async () => {
    const repos = createRepositories(db);
    const user = await repos.users.create({
      email: "overlay-actions-missing@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });

    const result = await applyOverlayQuickAction({
      repos,
      userId: user.id,
      phone,
      action: "setStatus",
      status: "active",
      source: "unit-test",
    });

    expect(result).toMatchObject({
      ok: false,
      action: "setStatus",
      rejected: [expect.objectContaining({ reason: "contact_not_found" })],
    });
  });
});
