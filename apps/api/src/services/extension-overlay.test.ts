import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createRepositories, openDb, runMigrations, type DbHandle } from "@nuoma/db";

import { buildExtensionOverlaySnapshot } from "./extension-overlay.js";

let tempDir: string;
let db: DbHandle;

const sendPolicy = { mode: "test" as const, allowedPhones: ["5531982066263"] };

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nuoma-v2-extension-overlay-"));
  db = openDb(path.join(tempDir, "api.db"));
  await runMigrations(db);
});

afterEach(async () => {
  db.close();
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("extension overlay snapshot identity", () => {
  it("does not resolve a WhatsApp overlay by saved contact title without canonical identity", async () => {
    const repos = createRepositories(db);
    const user = await repos.users.create({
      email: "overlay-title-only@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const decoyContact = await repos.contacts.create({
      userId: user.id,
      name: "Gabriel Braga Nuoma",
      phone: "31982066263",
      primaryChannel: "whatsapp",
      notes: "Nao deve aparecer sem identidade canonica.",
    });
    const decoyConversation = await repos.conversations.create({
      userId: user.id,
      contactId: decoyContact.id,
      channel: "whatsapp",
      externalThreadId: "5531982066263",
      waJid: "5531982066263@s.whatsapp.net",
      title: "Gabriel Braga Nuoma",
      lastMessageAt: "2026-05-07T10:00:00.000Z",
      lastPreview: "Resumo que nao pode vazar por title",
    });
    await repos.messages.insertOrIgnore({
      userId: user.id,
      conversationId: decoyConversation.id,
      contactId: decoyContact.id,
      externalId: "OVERLAY-TITLE-ONLY-DECOY",
      direction: "inbound",
      contentType: "text",
      status: "received",
      body: "Mensagem que nao pode aparecer por title",
      observedAtUtc: "2026-05-07T10:00:00.000Z",
    });

    const snapshot = await buildExtensionOverlaySnapshot({
      repos,
      userId: user.id,
      phone: null,
      waJid: null,
      phoneSource: "unresolved",
      title: "Gabriel Braga Nuoma",
      reason: "unit-test",
      sendPolicy,
    });

    expect(snapshot.phone).toBeNull();
    expect(snapshot.waJid).toBeNull();
    expect(snapshot.contact).toBeNull();
    expect(snapshot.conversations).toEqual([]);
    expect(snapshot.latestMessages).toEqual([]);
  });

  it("resolves by wa_jid when the visible title is a saved name from another contact", async () => {
    const repos = createRepositories(db);
    const user = await repos.users.create({
      email: "overlay-identity@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const canonicalContact = await repos.contacts.create({
      userId: user.id,
      name: "Neferpeel",
      phone: "31982066263",
      primaryChannel: "whatsapp",
      notes: "Contato correto por wa_jid.",
    });
    const decoyContact = await repos.contacts.create({
      userId: user.id,
      name: "Gabriel Braga Nuoma",
      phone: "553185596476",
      primaryChannel: "whatsapp",
      notes: "Contato que bateria se title fosse identidade.",
    });
    const canonicalConversation = await repos.conversations.create({
      userId: user.id,
      contactId: canonicalContact.id,
      channel: "whatsapp",
      externalThreadId: "opaque-canonical-thread",
      waJid: "5531982066263@s.whatsapp.net",
      title: "Neferpeel",
      lastMessageAt: "2026-05-07T10:00:00.000Z",
      lastPreview: "Resumo correto",
    });
    const decoyConversation = await repos.conversations.create({
      userId: user.id,
      contactId: decoyContact.id,
      channel: "whatsapp",
      externalThreadId: "553185596476",
      waJid: "553185596476@s.whatsapp.net",
      title: "Gabriel Braga Nuoma",
      lastMessageAt: "2026-05-07T09:59:00.000Z",
      lastPreview: "Resumo decoy",
    });
    await repos.messages.insertOrIgnore({
      userId: user.id,
      conversationId: canonicalConversation.id,
      contactId: canonicalContact.id,
      externalId: "OVERLAY-CANONICAL-MSG",
      direction: "inbound",
      contentType: "text",
      status: "received",
      body: "Mensagem correta por wa_jid",
      observedAtUtc: "2026-05-07T10:00:00.000Z",
    });
    await repos.messages.insertOrIgnore({
      userId: user.id,
      conversationId: decoyConversation.id,
      contactId: decoyContact.id,
      externalId: "OVERLAY-DECOY-MSG",
      direction: "inbound",
      contentType: "text",
      status: "received",
      body: "Mensagem errada por title",
      observedAtUtc: "2026-05-07T09:59:00.000Z",
    });

    const snapshot = await buildExtensionOverlaySnapshot({
      repos,
      userId: user.id,
      phone: null,
      waJid: "5531982066263@s.whatsapp.net",
      phoneSource: "unresolved",
      title: "Gabriel Braga Nuoma",
      reason: "unit-test",
      sendPolicy,
    });

    expect(snapshot.phone).toBe("5531982066263");
    expect(snapshot.waJid).toBe("5531982066263@s.whatsapp.net");
    expect(snapshot.phoneSource).toBe("wa-jid");
    expect(snapshot.contact).toMatchObject({ name: "Neferpeel" });
    expect(snapshot.conversations).toEqual([
      expect.objectContaining({ id: canonicalConversation.id }),
    ]);
    expect(snapshot.conversations).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: decoyConversation.id })]),
    );
    expect(snapshot.latestMessages).toEqual([
      expect.objectContaining({ body: "Mensagem correta por wa_jid" }),
    ]);
  });

  it("normalizes Brazilian phone variants to the same canonical overlay identity", async () => {
    const repos = createRepositories(db);
    const user = await repos.users.create({
      email: "overlay-phone-variants@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const contact = await repos.contacts.create({
      userId: user.id,
      name: "Neferpeel",
      phone: "31982066263",
      primaryChannel: "whatsapp",
    });
    const conversation = await repos.conversations.create({
      userId: user.id,
      contactId: contact.id,
      channel: "whatsapp",
      externalThreadId: "opaque-phone-variant-thread",
      waJid: "5531982066263@s.whatsapp.net",
      title: "Neferpeel",
      lastMessageAt: "2026-05-07T10:00:00.000Z",
      lastPreview: "Resumo correto",
    });

    for (const phone of ["31982066263", "5531982066263", "+55 31 9 8206-6263"]) {
      const snapshot = await buildExtensionOverlaySnapshot({
        repos,
        userId: user.id,
        phone,
        waJid: null,
        phoneSource: "unit-test",
        title: "Nome salvo qualquer",
        reason: "unit-test",
        sendPolicy,
      });

      expect(snapshot.phone).toBe("5531982066263");
      expect(snapshot.waJid).toBe("5531982066263@s.whatsapp.net");
      expect(snapshot.contact).toMatchObject({ name: "Neferpeel" });
      expect(snapshot.conversations).toEqual([expect.objectContaining({ id: conversation.id })]);
    }
  });
});
