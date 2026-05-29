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

  it("stores and resolves contact phone_e164 from Brazilian phone variants", async () => {
    const repos = createRepositories(handle);
    const user = await repos.users.create({
      email: "phone-e164@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });

    const contact = await repos.contacts.create({
      userId: user.id,
      name: "Phone variants",
      phone: "31982066263",
      primaryChannel: "whatsapp",
      status: "active",
    });

    expect(contact.phone).toBe("31982066263");
    expect(contact.phoneE164).toBe("+5531982066263");
    expect(contact.waJid).toBe("5531982066263@s.whatsapp.net");

    await expect(
      repos.contacts.findByPhone({ userId: user.id, phone: "5531982066263" }),
    ).resolves.toMatchObject({ id: contact.id, phoneE164: "+5531982066263" });
    await expect(
      repos.contacts.findByPhone({ userId: user.id, phone: "+55 31 9 8206-6263" }),
    ).resolves.toMatchObject({
      id: contact.id,
      phoneE164: "+5531982066263",
      waJid: "5531982066263@s.whatsapp.net",
    });
    await expect(
      repos.contacts.findByIdentity({ userId: user.id, waJid: "5531982066263@c.us" }),
    ).resolves.toMatchObject({ id: contact.id, waJid: "5531982066263@s.whatsapp.net" });

    const updated = await repos.contacts.update({
      id: contact.id,
      userId: user.id,
      phone: "+55 31 9 8206-6264",
    });
    expect(updated?.phoneE164).toBe("+5531982066264");
    expect(updated?.waJid).toBe("5531982066264@s.whatsapp.net");
  });

  it("backfills canonical WhatsApp identity for raw SQL contact writes", async () => {
    const repos = createRepositories(handle);
    const user = await repos.users.create({
      email: "raw-sql-identity@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const now = new Date().toISOString();

    const result = handle.raw
      .prepare(
        `INSERT INTO contacts
         (user_id, name, phone, primary_channel, status, created_at, updated_at)
         VALUES (?, ?, ?, 'whatsapp', 'active', ?, ?)`,
      )
      .run(user.id, "Raw SQL", "31982066263", now, now);

    const inserted = await repos.contacts.findById(Number(result.lastInsertRowid));
    expect(inserted).toMatchObject({
      phone: "31982066263",
      phoneE164: "+5531982066263",
      waJid: "5531982066263@s.whatsapp.net",
    });

    handle.raw
      .prepare("UPDATE contacts SET phone = ?, updated_at = ? WHERE id = ?")
      .run("+55 31 9 8206-6264", now, result.lastInsertRowid);

    const updated = await repos.contacts.findById(Number(result.lastInsertRowid));
    expect(updated).toMatchObject({
      phoneE164: "+5531982066264",
      waJid: "5531982066264@s.whatsapp.net",
    });
  });

  it("resolves legacy raw SQL WhatsApp conversations by wa_jid", async () => {
    const repos = createRepositories(handle);
    const user = await repos.users.create({
      email: "legacy-conversation-wa-jid@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const now = new Date().toISOString();

    const result = handle.raw
      .prepare(
        `INSERT INTO conversations
         (user_id, channel, external_thread_id, title, last_message_at, created_at, updated_at)
         VALUES (?, 'whatsapp', ?, ?, ?, ?, ?)`,
      )
      .run(user.id, "5531982066263", "Legacy raw conversation", now, now, now);

    const byWaJid = await repos.conversations.findByWaJid({
      userId: user.id,
      waJid: "5531982066263@s.whatsapp.net",
    });
    const byLegacyCUs = await repos.conversations.findByWaJid({
      userId: user.id,
      waJid: "5531982066263@c.us",
    });

    expect(byWaJid?.id).toBe(Number(result.lastInsertRowid));
    expect(byLegacyCUs?.id).toBe(Number(result.lastInsertRowid));
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

  it("does not claim a second serial send job for a phone already active in the pipeline", async () => {
    const repos = createRepositories(handle);
    const user = await repos.users.create({
      email: "claim-dedupe-phone@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const active = await repos.jobs.create({
      userId: user.id,
      type: "campaign_step",
      status: "running",
      payload: {
        phone: "31982066263",
        campaignId: 1,
        recipientId: 10,
      },
      scheduledAt: "2026-05-18T12:00:00.000Z",
      maxAttempts: 3,
    });
    const duplicate = await repos.jobs.create({
      userId: user.id,
      type: "send_voice",
      status: "queued",
      payload: {
        phone: "5531982066263",
        conversationId: 1,
      },
      scheduledAt: "2026-05-18T12:00:00.000Z",
      maxAttempts: 3,
    });
    const otherPhone = await repos.jobs.create({
      userId: user.id,
      type: "send_message",
      status: "queued",
      payload: {
        phone: "553188880001",
        conversationId: 2,
        body: "outro telefone",
      },
      scheduledAt: "2026-05-18T12:00:00.000Z",
      maxAttempts: 3,
    });
    if (!active || !duplicate || !otherPhone) {
      throw new Error("expected jobs to be created");
    }

    const claimed = await repos.jobs.claimDueJobs({
      workerId: "worker-phone-dedupe",
      now: "2026-05-18T12:00:01.000Z",
      limit: 10,
    });
    const duplicateRow = handle.raw
      .prepare("select status from jobs where id = ?")
      .get(duplicate.id) as { status: string } | undefined;

    expect(claimed.map((job) => job.id)).toEqual([otherPhone.id]);
    expect(duplicateRow?.status).toBe("queued");
  });

  it("does not claim a second serial Instagram send job for a handle already active", async () => {
    const repos = createRepositories(handle);
    const user = await repos.users.create({
      email: "claim-dedupe-instagram@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const active = await repos.jobs.create({
      userId: user.id,
      type: "campaign_step",
      status: "running",
      payload: {
        instagramHandle: "gabriell_braga",
        campaignId: 1,
        recipientId: 10,
      },
      scheduledAt: "2026-05-18T12:00:00.000Z",
      maxAttempts: 3,
    });
    const duplicate = await repos.jobs.create({
      userId: user.id,
      type: "send_instagram_message",
      status: "queued",
      payload: {
        instagramHandle: "@GABRIELL_BRAGA",
        conversationId: 1,
        body: "duplicado",
      },
      scheduledAt: "2026-05-18T12:00:00.000Z",
      maxAttempts: 3,
    });
    const otherHandle = await repos.jobs.create({
      userId: user.id,
      type: "send_instagram_message",
      status: "queued",
      payload: {
        instagramHandle: "outro_handle",
        conversationId: 2,
        body: "outro",
      },
      scheduledAt: "2026-05-18T12:00:00.000Z",
      maxAttempts: 3,
    });
    if (!active || !duplicate || !otherHandle) {
      throw new Error("expected jobs to be created");
    }

    const claimed = await repos.jobs.claimDueJobs({
      workerId: "worker-instagram-dedupe",
      now: "2026-05-18T12:00:01.000Z",
      limit: 10,
    });
    const duplicateRow = handle.raw
      .prepare("select status from jobs where id = ?")
      .get(duplicate.id) as { status: string } | undefined;

    expect(claimed.map((job) => job.id)).toEqual([otherHandle.id]);
    expect(duplicateRow?.status).toBe("queued");
  });

  it("tracks active campaign recipient pipelines by Instagram handle", async () => {
    const repos = createRepositories(handle);
    const user = await repos.users.create({
      email: "recipient-pipeline-instagram@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const campaign = await repos.campaigns.create({
      userId: user.id,
      name: "IG Pipeline",
      channel: "instagram",
      status: "running",
      evergreen: false,
      startsAt: null,
      segment: null,
      steps: [
        {
          id: "step-1",
          label: "IG",
          type: "text",
          delaySeconds: 0,
          conditions: [],
          template: "Oi",
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
      status: "queued",
      currentStepId: null,
      metadata: { instagramHandle: "gabriell_braga" },
    });

    const active = await repos.campaignRecipients.findActiveByInstagramHandle({
      userId: user.id,
      instagramHandle: "@GABRIELL_BRAGA",
    });
    await repos.campaignRecipients.updateState({
      userId: user.id,
      id: recipient.id,
      status: "completed",
    });
    const completed = await repos.campaignRecipients.findActiveByInstagramHandle({
      userId: user.id,
      instagramHandle: "gabriell_braga",
    });

    expect(active?.id).toBe(recipient.id);
    expect(completed).toBeNull();
  });

  it("records and summarizes chatbot variant exposure and conversion events", async () => {
    const repos = createRepositories(handle);
    const user = await repos.users.create({
      email: "chatbot-variants@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const chatbot = await repos.chatbots.create({
      userId: user.id,
      name: "Bot A/B",
      channel: "whatsapp",
      status: "active",
      fallbackMessage: null,
    });
    const rule = await repos.chatbots.createRule({
      userId: user.id,
      chatbotId: chatbot.id,
      name: "Preco",
      priority: 10,
      match: { type: "contains", value: "preco" },
      actions: [
        {
          type: "send_step",
          step: {
            id: "controle-step",
            label: "Controle",
            delaySeconds: 0,
            conditions: [],
            type: "text",
            template: "Controle",
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
              weight: 50,
              actions: [
                {
                  type: "send_step",
                  step: {
                    id: "controle-step",
                    label: "Controle",
                    delaySeconds: 0,
                    conditions: [],
                    type: "text",
                    template: "Controle",
                  },
                },
              ],
            },
            {
              id: "variante-b",
              label: "Variante B",
              weight: 50,
              actions: [
                {
                  type: "send_step",
                  step: {
                    id: "b-step",
                    label: "Variante B",
                    delaySeconds: 0,
                    conditions: [],
                    type: "text",
                    template: "B",
                  },
                },
              ],
            },
          ],
        },
      },
      isActive: true,
    });
    const exposure = await repos.chatbots.recordVariantEvent({
      userId: user.id,
      chatbotId: chatbot.id,
      ruleId: rule.id,
      variantId: "controle",
      variantLabel: "Controle",
      eventType: "exposure",
      channel: "whatsapp",
      contactId: null,
      conversationId: null,
      messageId: null,
      exposureId: null,
      sourceEventId: "chatbot:1:message:1",
      metadata: { source: "test" },
    });
    const duplicate = await repos.chatbots.recordVariantEvent({
      userId: user.id,
      chatbotId: chatbot.id,
      ruleId: rule.id,
      variantId: "controle",
      variantLabel: "Controle",
      eventType: "exposure",
      channel: "whatsapp",
      contactId: null,
      conversationId: null,
      messageId: null,
      exposureId: null,
      sourceEventId: "chatbot:1:message:1",
      metadata: { source: "duplicate" },
    });
    const conversion = await repos.chatbots.recordVariantEvent({
      userId: user.id,
      chatbotId: chatbot.id,
      ruleId: rule.id,
      variantId: "controle",
      variantLabel: "Controle",
      eventType: "conversion",
      channel: "whatsapp",
      contactId: null,
      conversationId: null,
      messageId: null,
      exposureId: exposure?.id ?? null,
      sourceEventId: "chatbot:1:conversion:1",
      metadata: { source: "test" },
    });

    const events = await repos.chatbots.listVariantEvents({
      userId: user.id,
      chatbotId: chatbot.id,
    });
    const summary = await repos.chatbots.summarizeVariantEvents({
      userId: user.id,
      chatbotId: chatbot.id,
      ruleId: rule.id,
    });

    expect(duplicate?.id).toBe(exposure?.id);
    expect(conversion?.exposureId).toBe(exposure?.id);
    expect(events).toHaveLength(2);
    expect(summary).toEqual([
      {
        chatbotId: chatbot.id,
        ruleId: rule.id,
        variantId: "controle",
        variantLabel: "Controle",
        exposures: 1,
        conversions: 1,
      },
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

  it("keeps send jobs serial for the same phone while another send is active", async () => {
    const repos = createRepositories(handle);
    const user = await repos.users.create({
      email: "jobs-phone-serial@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    await repos.jobs.create({
      userId: user.id,
      type: "send_message",
      status: "claimed",
      payload: { conversationId: 1, phone: "31982066263", body: "ativo" },
      priority: 0,
      scheduledAt: "2026-04-30T12:00:00.000Z",
    });
    await repos.jobs.create({
      userId: user.id,
      type: "campaign_step",
      status: "queued",
      payload: { conversationId: 1, phone: "5531982066263" },
      priority: 0,
      scheduledAt: "2026-04-30T12:00:00.000Z",
    });
    await repos.jobs.create({
      userId: user.id,
      type: "send_message",
      status: "queued",
      payload: { conversationId: 2, phone: "5531999999999", body: "outro telefone" },
      priority: 1,
      scheduledAt: "2026-04-30T12:00:00.000Z",
    });

    const claimed = await repos.jobs.claimDueJobs({
      workerId: "worker-serial",
      now: "2026-04-30T12:00:01.000Z",
      limit: 5,
    });
    const stillQueued = await repos.jobs.list(user.id, "queued");

    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.payload.phone).toBe("5531999999999");
    expect(stillQueued).toEqual([
      expect.objectContaining({
        type: "campaign_step",
        payload: expect.objectContaining({ phone: "5531982066263" }),
      }),
    ]);
  });

  it("normalizes legacy v1 campaign steps instead of crashing campaign lists", async () => {
    const repos = createRepositories(handle);
    const user = await repos.users.create({
      email: "legacy-campaign@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    handle.raw
      .prepare(
        `
        insert into campaigns (
          user_id,
          name,
          status,
          channel,
          segment_json,
          steps_json,
          evergreen,
          metadata_json
        ) values (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        user.id,
        "Legacy v1 campaign",
        "paused",
        "whatsapp",
        null,
        JSON.stringify([
          {
            id: "legacy-text-1",
            type: "text",
            label: "Step 1",
            raw: { content: "Ola {{nome}}", wait_minutes: null },
          },
          {
            id: "legacy-wait-1",
            type: "wait",
            label: "Step 2",
            raw: { wait_minutes: 30 },
          },
          {
            id: "legacy-link-1",
            type: "link",
            label: "Step 3",
            raw: { content: "Veja https://nuoma.com.br", wait_minutes: null },
          },
          {
            id: "legacy-tag-1",
            type: "ADD_TAG",
            label: "Step 4",
            raw: { content: "" },
          },
        ]),
        0,
        "{}",
      );

    const campaigns = await repos.campaigns.list(user.id);
    const legacy = campaigns.find((campaign) => campaign.name === "Legacy v1 campaign");

    expect(legacy?.metadata.legacyStepNormalization).toMatchObject({
      applied: true,
      originalStepCount: 4,
      normalizedStepCount: 2,
    });
    expect(legacy?.steps).toEqual([
      expect.objectContaining({ type: "text", delaySeconds: 0, template: "Ola {{nome}}" }),
      expect.objectContaining({
        type: "link",
        delaySeconds: 1800,
        url: "https://nuoma.com.br/",
        text: "Veja https://nuoma.com.br",
      }),
    ]);
  });

  it("claims campaign recipients sequentially within the same campaign", async () => {
    const repos = createRepositories(handle);
    const user = await repos.users.create({
      email: "jobs-campaign-recipient-order@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const campaign = await repos.campaigns.create({
      userId: user.id,
      name: "Sequential campaign",
      status: "running",
      channel: "whatsapp",
      steps: [
        {
          id: "intro",
          label: "Intro",
          delaySeconds: 0,
          conditions: [],
          type: "text",
          template: "Oi",
        },
      ],
    });
    const firstRecipient = await repos.campaignRecipients.create({
      userId: user.id,
      campaignId: campaign.id,
      channel: "whatsapp",
      phone: "5531982066263",
      status: "queued",
    });
    const secondRecipient = await repos.campaignRecipients.create({
      userId: user.id,
      campaignId: campaign.id,
      channel: "whatsapp",
      phone: "55 (31) 8857-0530",
      status: "queued",
    });
    await repos.jobs.create({
      userId: user.id,
      type: "campaign_step",
      status: "queued",
      payload: {
        campaignId: campaign.id,
        campaignBatchId: `campaign:${campaign.id}:recipient:${firstRecipient.id}:5531982066263`,
        campaignBatchIndex: 0,
        phone: "5531982066263",
      },
      priority: 0,
      scheduledAt: "2026-04-30T12:00:00.000Z",
    });
    await repos.jobs.create({
      userId: user.id,
      type: "campaign_step",
      status: "queued",
      payload: {
        campaignId: campaign.id,
        campaignBatchId: `campaign:${campaign.id}:recipient:${secondRecipient.id}:553188570530`,
        campaignBatchIndex: 0,
        phone: "553188570530",
      },
      priority: 0,
      scheduledAt: "2026-04-30T12:00:00.000Z",
    });

    const firstClaim = await repos.jobs.claimDueJobs({
      workerId: "worker-campaign-order",
      now: "2026-04-30T12:00:01.000Z",
      limit: 5,
    });
    await repos.campaignRecipients.updateState({
      userId: user.id,
      id: firstRecipient.id,
      status: "completed",
    });
    const secondClaim = await repos.jobs.claimDueJobs({
      workerId: "worker-campaign-order",
      now: "2026-04-30T12:00:02.000Z",
      limit: 5,
    });

    expect(firstClaim).toHaveLength(1);
    expect(firstClaim[0]?.payload.phone).toBe("5531982066263");
    expect(secondClaim).toHaveLength(1);
    expect(secondClaim[0]?.payload.phone).toBe("553188570530");
  });

  it("finds active instagram campaign recipients by normalized handle", async () => {
    const repos = createRepositories(handle);
    const user = await repos.users.create({
      email: "jobs-campaign-recipient-instagram@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const campaign = await repos.campaigns.create({
      userId: user.id,
      name: "Instagram active recipient",
      status: "running",
      channel: "instagram",
      steps: [
        {
          id: "intro",
          label: "Intro",
          delaySeconds: 0,
          conditions: [],
          type: "text",
          template: "Oi",
        },
      ],
    });
    const recipient = await repos.campaignRecipients.create({
      userId: user.id,
      campaignId: campaign.id,
      channel: "instagram",
      phone: null,
      status: "queued",
      metadata: { instagramHandle: "@Maria.Pele" },
    });

    await expect(
      repos.campaignRecipients.findActiveByInstagramHandle({
        userId: user.id,
        instagramHandle: "maria.pele",
      }),
    ).resolves.toEqual(expect.objectContaining({ id: recipient.id }));

    await repos.campaignRecipients.updateState({
      userId: user.id,
      id: recipient.id,
      status: "completed",
    });

    await expect(
      repos.campaignRecipients.findActiveByInstagramHandle({
        userId: user.id,
        instagramHandle: "maria.pele",
      }),
    ).resolves.toBeNull();
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

  it("normalizes legacy swapped day/month conversation timestamps", async () => {
    const repos = createRepositories(handle);
    const user = await repos.users.create({
      email: "legacy-dates@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });

    await repos.conversations.upsertObserved({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "5531982066201",
      title: "+55 31 98206-6201",
      lastMessageAt: "2026-20-04T13:29:00.000-03:00",
      lastPreview: "data antiga importada",
    });
    await repos.conversations.upsertObserved({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "5531982066202",
      title: "+55 31 98206-6202",
      lastMessageAt: "not-a-date",
      lastPreview: "data irrecuperavel",
    });

    const conversations = await repos.conversations.list(user.id);

    expect(
      conversations.find((item) => item.externalThreadId === "5531982066201")?.lastMessageAt,
    ).toBe("2026-04-20T13:29:00.000-03:00");
    expect(
      conversations.find((item) => item.externalThreadId === "5531982066202")?.lastMessageAt,
    ).toBeNull();
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

  it("prevents stale workers from overwriting a newer job claim", async () => {
    const repos = createRepositories(handle);
    const user = await repos.users.create({
      email: "claim-owner@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const job = await repos.jobs.create({
      userId: user.id,
      type: "send_message",
      status: "queued",
      payload: {
        conversationId: 1,
        phone: "5531982066263",
        body: "ownership",
        idempotencyKey: "manual:claim-owner",
      },
      scheduledAt: "2026-04-30T12:00:00.000Z",
      maxAttempts: 3,
    });
    if (!job) {
      throw new Error("expected job to be created");
    }

    const [workerAClaim] = await repos.jobs.claimDueJobs({
      workerId: "worker-a",
      now: "2026-04-30T12:00:01.000Z",
    });
    expect(workerAClaim?.id).toBe(job.id);
    const workerAState = handle.raw
      .prepare("SELECT claimed_at FROM jobs WHERE id = ?")
      .get(job.id) as { claimed_at: string } | undefined;
    const reaperNow = new Date(
      Date.parse(workerAState?.claimed_at ?? new Date().toISOString()) + 2,
    );

    await repos.jobs.releaseStaleClaims({
      staleAfterMs: 1,
      now: reaperNow,
    });
    const [workerBClaim] = await repos.jobs.claimDueJobs({
      workerId: "worker-b",
      now: reaperNow.toISOString(),
    });
    expect(workerBClaim?.id).toBe(job.id);

    await expect(repos.jobs.markCompleted(job.id, "worker-a")).resolves.toBe(false);
    await expect(
      repos.jobs.releaseForRetry({
        jobId: job.id,
        error: "late retry",
        scheduledAt: "2026-04-30T12:05:00.000Z",
        workerId: "worker-a",
      }),
    ).resolves.toBe(false);
    await expect(
      repos.jobs.moveToDead({ jobId: job.id, error: "late dead", workerId: "worker-a" }),
    ).resolves.toBe(false);
    await expect(repos.jobs.countDead(user.id)).resolves.toBe(0);

    const stillOwnedByB = handle.raw
      .prepare("SELECT status, claimed_by FROM jobs WHERE id = ?")
      .get(job.id) as { status: string; claimed_by: string | null } | undefined;
    expect(stillOwnedByB).toEqual({ status: "claimed", claimed_by: "worker-b" });

    await expect(repos.jobs.markCompleted(job.id, "worker-b")).resolves.toBe(true);
    const completed = handle.raw
      .prepare("SELECT status, claimed_at, claimed_by, last_error FROM jobs WHERE id = ?")
      .get(job.id) as
      | {
          status: string;
          claimed_at: string | null;
          claimed_by: string | null;
          last_error: string | null;
        }
      | undefined;
    expect(completed).toEqual({
      status: "completed",
      claimed_at: null,
      claimed_by: null,
      last_error: null,
    });
  });

  it("clears stale retry errors when a later job attempt completes", async () => {
    const repos = createRepositories(handle);
    const user = await repos.users.create({
      email: "job-error-clear@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const job = await repos.jobs.create({
      userId: user.id,
      type: "send_instagram_message",
      status: "queued",
      payload: { instagramHandle: "gabriell_braga" },
      scheduledAt: "2026-04-30T12:00:00.000Z",
      maxAttempts: 3,
    });
    if (!job) {
      throw new Error("expected job to be created");
    }

    const [firstClaim] = await repos.jobs.claimDueJobs({
      workerId: "worker-a",
      now: "2026-04-30T12:00:01.000Z",
    });
    expect(firstClaim?.id).toBe(job.id);
    await expect(
      repos.jobs.releaseForRetry({
        jobId: job.id,
        error: "Instagram assisted composer search input was not found",
        scheduledAt: "2026-04-30T12:01:00.000Z",
        workerId: "worker-a",
      }),
    ).resolves.toBe(true);

    const [secondClaim] = await repos.jobs.claimDueJobs({
      workerId: "worker-b",
      now: "2026-04-30T12:01:01.000Z",
    });
    expect(secondClaim?.lastError).toBe("Instagram assisted composer search input was not found");
    await expect(repos.jobs.markCompleted(job.id, "worker-b")).resolves.toBe(true);

    const completed = handle.raw
      .prepare("SELECT status, claimed_at, claimed_by, last_error FROM jobs WHERE id = ?")
      .get(job.id) as
      | {
          status: string;
          claimed_at: string | null;
          claimed_by: string | null;
          last_error: string | null;
        }
      | undefined;
    expect(completed).toEqual({
      status: "completed",
      claimed_at: null,
      claimed_by: null,
      last_error: null,
    });
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

  it("upserts outbound messages by idempotency key without inserting duplicates", async () => {
    const repos = createRepositories(handle);
    const user = await repos.users.create({
      email: "idempotency@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const conversation = await repos.conversations.create({
      userId: user.id,
      contactId: null,
      channel: "whatsapp",
      externalThreadId: "5531982066263@c.us",
      title: "Idempotency target",
    });
    const key = "cstep:1:2:hello";
    const first = await repos.messages.upsertOutboundByKey({
      idempotencyKey: key,
      userId: user.id,
      conversationId: conversation.id,
      contactId: null,
      direction: "outbound",
      contentType: "text",
      status: "pending",
      body: "Olá",
      observedAtUtc: "2026-04-30T15:00:00.000Z",
      timestampPrecision: "second",
      messageSecond: 0,
      waInferredSecond: null,
    });
    expect(first.created).toBe(true);
    expect(first.message.idempotencyKey).toBe(key);
    expect(first.message.dispatchAttempts).toBe(0);

    const second = await repos.messages.upsertOutboundByKey({
      idempotencyKey: key,
      userId: user.id,
      conversationId: conversation.id,
      contactId: null,
      direction: "outbound",
      contentType: "text",
      status: "pending",
      body: "ignored on conflict",
      observedAtUtc: "2026-04-30T15:00:01.000Z",
      timestampPrecision: "second",
      messageSecond: 1,
      waInferredSecond: null,
    });
    expect(second.created).toBe(false);
    expect(second.message.id).toBe(first.message.id);
    expect(second.message.body).toBe("Olá");

    const found = await repos.messages.findByIdempotencyKey({
      userId: user.id,
      idempotencyKey: key,
    });
    expect(found?.id).toBe(first.message.id);

    await repos.messages.markDispatched({ id: first.message.id, dispatchAttempts: 1 });
    await repos.messages.setExternalId({
      id: first.message.id,
      externalId: "wamid.real-id",
      status: "sent",
    });
    const dispatched = await repos.messages.findById({ userId: user.id, id: first.message.id });
    expect(dispatched?.dispatchAttempts).toBe(1);
    expect(dispatched?.dispatchedAt).not.toBeNull();
    expect(dispatched?.externalId).toBe("wamid.real-id");
    expect(dispatched?.status).toBe("sent");
  });

  it("reconciles an idempotency placeholder with a sync-created external message", async () => {
    const repos = createRepositories(handle);
    const user = await repos.users.create({
      email: "idempotency-sync-race@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const conversation = await repos.conversations.create({
      userId: user.id,
      contactId: null,
      channel: "whatsapp",
      externalThreadId: "5531982066263@c.us",
      title: "Sync race target",
    });
    const key = "cstep:sync:race";
    const placeholder = await repos.messages.upsertOutboundByKey({
      idempotencyKey: key,
      userId: user.id,
      conversationId: conversation.id,
      contactId: null,
      direction: "outbound",
      contentType: "text",
      status: "pending",
      body: "Mensagem enviada",
      observedAtUtc: "2026-04-30T15:00:00.000Z",
      timestampPrecision: "second",
      messageSecond: 0,
      waInferredSecond: null,
      raw: { source: "dispatch_guard" },
    });
    const attempt = await repos.messageDispatchAttempts.create({
      idempotencyKey: key,
      userId: user.id,
      jobId: 123,
      workerId: "worker-sync-race",
      phase: "sending",
      messageId: placeholder.message.id,
    });
    const mediaAsset = await repos.mediaAssets.create({
      userId: user.id,
      type: "image",
      fileName: "race.jpg",
      mimeType: "image/jpeg",
      sha256: "a".repeat(64),
      sizeBytes: 5,
      durationMs: null,
      storagePath: "/tmp/race.jpg",
    });
    const attachment = await repos.attachmentCandidates.create({
      userId: user.id,
      conversationId: conversation.id,
      messageId: placeholder.message.id,
      mediaAssetId: mediaAsset.id,
      channel: "whatsapp",
      contentType: "image",
      externalMessageId: null,
      caption: "Mensagem enviada",
      observedAt: "2026-04-30T15:00:00.000Z",
      metadata: { source: "placeholder" },
    });
    const chatbot = await repos.chatbots.create({
      userId: user.id,
      name: "Bot",
      channel: "whatsapp",
      status: "active",
      fallbackMessage: null,
      metadata: {},
    });
    const rule = await repos.chatbots.createRule({
      userId: user.id,
      chatbotId: chatbot.id,
      name: "Rule",
      priority: 10,
      match: { type: "contains", value: "oi" },
      segment: null,
      actions: [{ type: "notify_attendant", attendantId: null, message: "Nova mensagem" }],
      metadata: {},
      isActive: true,
    });
    const variantEvent = await repos.chatbots.recordVariantEvent({
      userId: user.id,
      chatbotId: chatbot.id,
      ruleId: rule.id,
      variantId: "a",
      variantLabel: "A",
      eventType: "exposure",
      channel: "whatsapp",
      contactId: null,
      conversationId: conversation.id,
      messageId: placeholder.message.id,
      exposureId: null,
      sourceEventId: "sync-race-source",
      metadata: {},
    });

    const synced = await repos.messages.create({
      userId: user.id,
      conversationId: conversation.id,
      contactId: null,
      externalId: "wamid.sync-race",
      direction: "outbound",
      contentType: "text",
      status: "sent",
      body: "Mensagem enviada",
      observedAtUtc: "2026-04-30T15:00:01.000Z",
      timestampPrecision: "second",
      messageSecond: 1,
      waInferredSecond: null,
      raw: { source: "sync" },
    });

    const reconciled = await repos.messages.reconcileIdempotencyExternalConflict({
      userId: user.id,
      conversationId: conversation.id,
      idempotencyMessageId: placeholder.message.id,
      idempotencyKey: key,
      externalId: "wamid.sync-race",
      status: "sent",
      dispatchAttempts: 1,
    });

    expect(reconciled).toEqual(
      expect.objectContaining({
        id: synced.id,
        idempotencyKey: key,
        externalId: "wamid.sync-race",
        status: "sent",
        dispatchAttempts: 1,
      }),
    );
    await expect(
      repos.messages.findById({ userId: user.id, id: placeholder.message.id }),
    ).resolves.toBeNull();
    await expect(
      repos.messages.findByIdempotencyKey({ userId: user.id, idempotencyKey: key }),
    ).resolves.toEqual(expect.objectContaining({ id: synced.id }));
    const messages = await repos.messages.listByConversation({
      userId: user.id,
      conversationId: conversation.id,
    });
    expect(messages).toHaveLength(1);
    const attempts = await repos.messageDispatchAttempts.listByKey(key);
    expect(attempts[0]).toEqual(
      expect.objectContaining({
        id: attempt.id,
        messageId: synced.id,
        externalId: "wamid.sync-race",
      }),
    );
    const attachmentRow = handle.raw
      .prepare(`SELECT message_id FROM attachment_candidates WHERE id = ?`)
      .get(attachment.id) as { message_id: number } | undefined;
    expect(attachmentRow?.message_id).toBe(synced.id);
    const variantRow = handle.raw
      .prepare(`SELECT message_id FROM chatbot_variant_events WHERE id = ?`)
      .get(variantEvent?.id) as { message_id: number } | undefined;
    expect(variantRow?.message_id).toBe(synced.id);
  });

  it("records dispatch attempts and skips stale in-flight rows when looking up active attempts", async () => {
    const repos = createRepositories(handle);
    const user = await repos.users.create({
      email: "attempts@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const key = "cstep:7:42:welcome";

    const fresh = await repos.messageDispatchAttempts.create({
      idempotencyKey: key,
      userId: user.id,
      jobId: 101,
      workerId: "worker-fresh",
      phase: "sending",
    });
    expect(fresh.phase).toBe("sending");
    expect(fresh.finishedAt).toBeNull();

    const active = await repos.messageDispatchAttempts.findActiveByKey({
      idempotencyKey: key,
      staleAfterMs: 5 * 60 * 1000,
    });
    expect(active?.id).toBe(fresh.id);

    // Same lookup but with a tiny stale window — fresh row is now considered stale.
    const stale = await repos.messageDispatchAttempts.findActiveByKey({
      idempotencyKey: key,
      staleAfterMs: 1,
      now: new Date(Date.now() + 60_000),
    });
    expect(stale).toBeNull();

    // failed/skipped attempts must NOT count as in-flight.
    await repos.messageDispatchAttempts.transitionPhase({
      id: fresh.id,
      phase: "failed",
      error: "boom",
    });
    const afterFailure = await repos.messageDispatchAttempts.findActiveByKey({
      idempotencyKey: key,
      staleAfterMs: 5 * 60 * 1000,
    });
    expect(afterFailure).toBeNull();

    const stored = await repos.messageDispatchAttempts.listByKey(key);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.phase).toBe("failed");
    expect(stored[0]?.error).toBe("boom");
    expect(stored[0]?.finishedAt).not.toBeNull();
  });

  it("records structured send audit events with metadata filters", async () => {
    const repos = createRepositories(handle);
    const user = await repos.users.create({
      email: "send-audit@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const contact = await repos.contacts.create({
      userId: user.id,
      name: "Audit target",
      phone: "31982066263",
      primaryChannel: "whatsapp",
      status: "active",
    });
    const conversation = await repos.conversations.create({
      userId: user.id,
      contactId: contact.id,
      channel: "whatsapp",
      externalThreadId: "5531982066263@c.us",
      title: "Audit target",
    });

    const dispatching = await repos.sendAuditEvents.create({
      userId: user.id,
      contactId: contact.id,
      conversationId: conversation.id,
      channel: "whatsapp",
      phase: "dispatching",
      workerId: "worker-audit",
      payloadHash: "payload-sha",
      metadata: { idempotencyKey: "manual:audit", source: "test" },
    });
    await repos.sendAuditEvents.create({
      userId: user.id,
      contactId: contact.id,
      conversationId: conversation.id,
      channel: "whatsapp",
      phase: "sent",
      latencyMs: 321,
      workerId: "worker-audit",
      metadata: { idempotencyKey: "manual:audit" },
    });

    expect(dispatching.phase).toBe("dispatching");
    expect(dispatching.metadata).toEqual({ idempotencyKey: "manual:audit", source: "test" });

    const sent = await repos.sendAuditEvents.list({
      userId: user.id,
      contactId: contact.id,
      phase: "sent",
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual(
      expect.objectContaining({
        channel: "whatsapp",
        phase: "sent",
        latencyMs: 321,
        workerId: "worker-audit",
        metadata: { idempotencyKey: "manual:audit" },
      }),
    );
  });
});
