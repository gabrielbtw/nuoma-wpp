import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "nuoma-review-"));
const databasePath = path.join(tempRoot, "database", "nuoma-review.db");
const logDir = path.join(tempRoot, "logs");
const uploadsDir = path.join(tempRoot, "uploads");
const mediaDir = path.join(tempRoot, "media");
const tempDir = path.join(tempRoot, "temp");
const screenshotsDir = path.join(tempRoot, "screenshots");
const dataLakeDir = path.join(tempRoot, "data-lake");
const chromiumProfileDir = path.join(tempRoot, "chromium-profile", "whatsapp");
const instagramProfileDir = path.join(tempRoot, "chromium-profile", "instagram");

process.env.NODE_ENV = "test";
process.env.DATABASE_PATH = databasePath;
process.env.LOG_DIR = logDir;
process.env.UPLOADS_DIR = uploadsDir;
process.env.MEDIA_DIR = mediaDir;
process.env.TEMP_DIR = tempDir;
process.env.SCREENSHOTS_DIR = screenshotsDir;
process.env.DATA_LAKE_DIR = dataLakeDir;
process.env.CHROMIUM_PROFILE_DIR = chromiumProfileDir;
process.env.IG_CHROMIUM_PROFILE_DIR = instagramProfileDir;
process.env.CHROMIUM_CHANNEL = "chromium";
process.env.AI_PROVIDER = "openai";
process.env.OPENAI_API_KEY = "";

const core = await import("../packages/core/src/index.ts");
const { registerCampaignRoutes } = await import("../apps/web-app/src/server/routes/campaigns.ts");
const { registerContactRoutes } = await import("../apps/web-app/src/server/routes/contacts.ts");
const { registerDataLakeRoutes } = await import("../apps/web-app/src/server/routes/data-lake.ts");
const { registerSystemRoutes } = await import("../apps/web-app/src/server/routes/system.ts");
const { registerTagRoutes } = await import("../apps/web-app/src/server/routes/tags.ts");
const { assessInstagramProfileSnapshot, isInstagramComposerSurfaceReady, pickInstagramComposerRecipientCandidate, resolveInstagramThreadParticipant } = await import("../apps/web-app/src/server/lib/instagram-assisted.ts");
const contactUtils = await import("../apps/web-app/src/client/lib/contact-utils.ts");

const {
  buildCampaignImportPreview,
  closeDb,
  createAttachmentCandidate,
  createCampaign,
  createContact,
  deactivateContactChannel,
  createAutomation,
  addMessage,
  duplicateCampaign,
  enqueueJob,
  getDb,
  getContactById,
  importCampaignRecipients,
  isInputError,
  processAutomationTick,
  processCampaignTick,
  recordSystemEvent,
  rememberInstagramThreadForContact,
  sendJobPayloadSchema,
  setWorkerState,
  triggerIncomingAutomationRuns,
  upsertConversation
} = core;
const { formatChannelDisplayValue, formatPhoneForInput, isValidCpf, normalizePhoneForSubmission } = contactUtils;

let app: FastifyInstance;

async function resetDatabase() {
  closeDb();

  for (const filePath of [databasePath, `${databasePath}-shm`, `${databasePath}-wal`]) {
    await rm(filePath, { force: true });
  }

  for (const directory of [logDir, uploadsDir, mediaDir, tempDir, screenshotsDir, dataLakeDir, chromiumProfileDir, instagramProfileDir]) {
    await rm(directory, { recursive: true, force: true });
    await mkdir(directory, { recursive: true });
  }

  getDb();
}

function buildContact(index: number, overrides?: Partial<Parameters<typeof createContact>[0]>) {
  return {
    name: `Contato ${index}`,
    phone: `55319988${String(index).padStart(4, "0")}`,
    cpf: null,
    email: null,
    instagram: null,
    procedureStatus: "unknown" as const,
    lastAttendant: null,
    notes: null,
    status: "novo" as const,
    tags: [],
    lastInteractionAt: null,
    lastProcedureAt: null,
    ...overrides
  };
}

before(async () => {
  app = Fastify({ logger: false });
  app.setErrorHandler((error, _request, reply) => {
    const message = error instanceof ZodError ? error.issues[0]?.message || "Dados inválidos" : error instanceof Error ? error.message : "Erro interno";
    reply.code(error instanceof ZodError || isInputError(error) ? 400 : 500).send({ message });
  });
  await registerContactRoutes(app);
  await registerCampaignRoutes(app);
  await registerDataLakeRoutes(app);
  await registerSystemRoutes(app);
  await registerTagRoutes(app);
  await app.ready();
});

beforeEach(async () => {
  await resetDatabase();
});

after(async () => {
  await app.close();
  closeDb();
  await rm(tempRoot, { recursive: true, force: true });
});

test("contact utilities normalize channels and validate CPF correctly", () => {
  assert.equal(formatPhoneForInput("+5531982066263"), "+55 (31) 98206-6263");
  assert.equal(normalizePhoneForSubmission("+55 (31) 98206-6263"), "5531982066263");
  assert.equal(formatChannelDisplayValue("instagram", "gabriell_braga"), "@gabriell_braga");
  assert.equal(isValidCpf("529.982.247-25"), true);
  assert.equal(isValidCpf("111.111.111-11"), false);
});

test("contacts pagination and tag filtering stay consistent across pages", async () => {
  for (let index = 1; index <= 25; index += 1) {
    createContact(
      buildContact(index, {
        tags: index <= 22 ? ["vip"] : ["pos"]
      })
    );
  }

  const response = await app.inject({
    method: "GET",
    url: "/contacts?tag=vip&page=2&pageSize=20"
  });

  assert.equal(response.statusCode, 200);
  const payload = response.json();
  assert.equal(payload.total, 22);
  assert.equal(payload.page, 2);
  assert.equal(payload.totalPages, 2);
  assert.equal(payload.items.length, 2);
});

test("contacts patch rejects removing every channel and still records history for valid updates", async () => {
  const created = createContact(
    buildContact(1, {
      name: "Gabriel Braga",
      instagram: "@gabriell_braga"
    })
  );

  assert.ok(created);

  const invalidPatch = await app.inject({
    method: "PATCH",
    url: `/contacts/${created.id}`,
    payload: {
      phone: "",
      instagram: ""
    }
  });

  assert.equal(invalidPatch.statusCode, 400);
  assert.match(invalidPatch.json().message, /Informe telefone ou Instagram/i);

  const validPatch = await app.inject({
    method: "PATCH",
    url: `/contacts/${created.id}`,
    payload: {
      status: "cliente",
      notes: "Contato priorizado"
    }
  });

  assert.equal(validPatch.statusCode, 200);

  const historyResponse = await app.inject({
    method: "GET",
    url: `/contacts/${created.id}/history?limit=10`
  });

  assert.equal(historyResponse.statusCode, 200);
  const historyItems = historyResponse.json() as Array<{ field: string; nextValue: string | null }>;
  assert(historyItems.some((item) => item.field === "status" && item.nextValue === "cliente"));
  assert(historyItems.some((item) => item.field === "notes" && item.nextValue === "Contato priorizado"));
});

test("visible attachment candidates are persisted as media assets and exposed by contact", async () => {
  const contact = createContact(buildContact(7, { name: "Contato Midia" }));
  const conversation = upsertConversation({
    contactId: contact.id,
    waChatId: contact.phone ?? "5531982066263",
    title: contact.name,
    unreadCount: 0,
    lastMessagePreview: "Foto recebida",
    lastMessageAt: "2026-05-05T12:00:00.000Z",
    contactPhone: contact.phone
  });
  assert.ok(conversation);

  const messageId = addMessage({
    conversationId: conversation.id,
    contactId: contact.id,
    direction: "incoming",
    contentType: "image",
    body: "Foto recebida",
    sentAt: "2026-05-05T12:00:00.000Z",
    meta: { source: "test" }
  });

  const candidate = createAttachmentCandidate({
    conversationId: conversation.id,
    contactId: contact.id,
    messageId,
    channel: "whatsapp",
    contentType: "image",
    originalName: "foto-visible.jpg",
    safeName: "foto-visible.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 0,
    sha256: "a".repeat(64),
    storagePath: `wa-visible://${"a".repeat(64)}`,
    sourceUrl: "blob:https://web.whatsapp.com/visible-photo",
    caption: "Foto recebida",
    observedAt: "2026-05-05T12:00:01.000Z",
    metadata: { source: "wa-dom-visible" }
  });

  assert.ok(candidate);
  assert.equal(candidate.contentType, "image");
  assert.equal(candidate.storagePath, `wa-visible://${"a".repeat(64)}`);

  const repeated = createAttachmentCandidate({
    conversationId: conversation.id,
    contactId: contact.id,
    messageId,
    channel: "whatsapp",
    contentType: "image",
    originalName: "foto-visible.jpg",
    safeName: "foto-visible.jpg",
    mimeType: "image/jpeg",
    sha256: "a".repeat(64),
    storagePath: `wa-visible://${"a".repeat(64)}`,
    observedAt: "2026-05-05T12:00:02.000Z"
  });
  assert.equal(repeated?.id, candidate.id);

  const response = await app.inject({
    method: "GET",
    url: `/contacts/${contact.id}/attachment-candidates?limit=10`
  });

  assert.equal(response.statusCode, 200);
  const payload = response.json() as { total: number; items: Array<{ contentType: string; sha256: string; storagePath: string }> };
  assert.equal(payload.total, 1);
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0]?.contentType, "image");
  assert.equal(payload.items[0]?.sha256, "a".repeat(64));
  assert.equal(payload.items[0]?.storagePath, `wa-visible://${"a".repeat(64)}`);
});

test("campaign import preview resolves Instagram matches and blocks duplicate or invalid recipients", () => {
  createContact(
    buildContact(1, {
      name: "Lead existente",
      phone: "5531987654321",
      instagram: "@gabriell_braga"
    })
  );

  const preview = buildCampaignImportPreview(
    [
      { nome: "Existente", telefone: "", instagram: "gabriell_braga" },
      { nome: "Novo", telefone: "31 99999-0000", instagram: "" },
      { nome: "Duplicado", telefone: "31 99999-0000", instagram: "" },
      { nome: "Invalido", telefone: "123", instagram: "" }
    ],
    {
      name: "nome",
      phone: "telefone",
      instagram: "instagram"
    }
  );

  assert.deepEqual(preview.summary, {
    total: 4,
    existing: 0,
    eligible: 1,
    new_contact: 1,
    needs_review: 0,
    insufficient_link: 1,
    invalid: 1
  });
  assert.equal(preview.preview[0]?._resolvedPhone, "5531987654321");
  assert.equal(preview.preview[0]?._exists, "eligible");
  assert.equal(preview.preview[2]?._reason, "Destino duplicado no CSV para o mesmo canal.");
});

test("campaign routes only accept controlled CSV references and import eligible recipients", async () => {
  createContact(
    buildContact(1, {
      name: "Lead existente",
      phone: "5531987654321",
      instagram: "@gabriell_braga"
    })
  );

  const campaign = createCampaign({
    name: "Campanha revisão",
    description: "Fluxo de teste",
    status: "draft",
    sendWindowStart: "08:00",
    sendWindowEnd: "20:00",
    rateLimitCount: 20,
    rateLimitWindowMinutes: 60,
    randomDelayMinSeconds: 15,
    randomDelayMaxSeconds: 30,
    steps: [
      {
        type: "text",
        content: "Mensagem inicial",
        mediaPath: null,
        waitMinutes: null,
        caption: ""
      }
    ]
  });

  assert.ok(campaign);

  const invalidReference = await app.inject({
    method: "POST",
    url: `/campaigns/${campaign.id}/preview-import`,
    payload: {
      uploadId: "../../etc/passwd",
      mapping: {
        phone: "telefone"
      }
    }
  });

  assert.equal(invalidReference.statusCode, 400);

  const uploadId = randomUUID();
  const csvDirectory = path.join(uploadsDir, "csv");
  await mkdir(csvDirectory, { recursive: true });
  await writeFile(
    path.join(csvDirectory, `${uploadId}.csv`),
    ["nome,telefone,instagram", "Existente,,gabriell_braga", "Novo Lead,31 99999-0000,", "Duplicado,31 99999-0000,"].join("\n"),
    "utf8"
  );

  const previewResponse = await app.inject({
    method: "POST",
    url: `/campaigns/${campaign.id}/preview-import`,
    payload: {
      uploadId,
      mapping: {
        name: "nome",
        phone: "telefone",
        instagram: "instagram"
      }
    }
  });

  assert.equal(previewResponse.statusCode, 200);
  const previewPayload = previewResponse.json();
  assert.equal(previewPayload.summary.existing, 0);
  assert.equal(previewPayload.summary.eligible, 1);
  assert.equal(previewPayload.summary.new_contact, 1);
  assert.equal(previewPayload.summary.invalid, 1);

  const importResponse = await app.inject({
    method: "POST",
    url: `/campaigns/${campaign.id}/import-recipients`,
    payload: {
      uploadId,
      mapping: {
        name: "nome",
        phone: "telefone",
        instagram: "instagram"
      }
    }
  });

  assert.equal(importResponse.statusCode, 200);

  const recipientsResponse = await app.inject({
    method: "GET",
    url: `/campaigns/${campaign.id}/recipients`
  });

  assert.equal(recipientsResponse.statusCode, 200);
  const recipients = recipientsResponse.json() as Array<{ contact_id: string | null; phone: string }>;
  assert.equal(recipients.length, 2);
  assert(recipients.some((recipient) => recipient.contact_id != null));
  assert(recipients.some((recipient) => recipient.phone === "5531999990000"));
});

test("duplicating a campaign keeps the flow but resets it to a clean draft", () => {
  const original = createCampaign({
    name: "Fluxo original",
    description: "Duas etapas",
    status: "ready",
    sendWindowStart: "08:00",
    sendWindowEnd: "20:00",
    rateLimitCount: 20,
    rateLimitWindowMinutes: 60,
    randomDelayMinSeconds: 10,
    randomDelayMaxSeconds: 20,
    steps: [
      {
        type: "text",
        content: "Primeiro toque",
        mediaPath: null,
        waitMinutes: null,
        caption: ""
      },
      {
        type: "wait",
        content: "",
        mediaPath: null,
        waitMinutes: 15,
        caption: ""
      }
    ]
  });

  assert.ok(original);

  const duplicated = duplicateCampaign(original.id);
  assert.ok(duplicated);
  assert.equal(duplicated.status, "draft");
  assert.equal(duplicated.steps.length, original.steps.length);
  assert.equal(duplicated.totalRecipients, 0);
});

test("instagram send payload accepts blank phone when the username is present", () => {
  const payload = sendJobPayloadSchema.parse({
    source: "campaign",
    channel: "instagram",
    recipientDisplayValue: "@roseleite",
    recipientNormalizedValue: "roseleite",
    phone: "",
    contentType: "text",
    text: "Oi"
  });

  assert.equal(payload.phone, null);
  assert.equal(payload.recipientNormalizedValue, "roseleite");
});

test("instagram campaign jobs reuse the latest known thread id for faster sends", () => {
  const contact = createContact(
    buildContact(1, {
      name: "Gabriel Braga",
      phone: "",
      instagram: "@gabriell_braga"
    })
  );

  assert.ok(contact);

  const conversation = upsertConversation({
    channel: "instagram",
    contactId: contact.id,
    externalThreadId: "ig-thread-known",
    title: "Gabriel Braga",
    unreadCount: 0,
    lastMessagePreview: "Ultima mensagem",
    lastMessageAt: new Date().toISOString(),
    lastMessageDirection: "incoming",
    contactPhone: null
  });

  assert.ok(conversation);

  const campaign = createCampaign({
    name: "Instagram com thread reutilizado",
    description: "Nao deve buscar o handle novamente",
    status: "active",
    sendWindowStart: "00:00",
    sendWindowEnd: "23:59",
    rateLimitCount: 20,
    rateLimitWindowMinutes: 60,
    randomDelayMinSeconds: 0,
    randomDelayMaxSeconds: 0,
    eligibleChannels: ["instagram"],
    steps: [
      {
        type: "text",
        content: "Mensagem no thread certo",
        mediaPath: null,
        waitMinutes: null,
        caption: "",
        tagName: null,
        channelScope: "instagram"
      }
    ]
  });

  assert.ok(campaign);

  importCampaignRecipients(campaign.id, [
    {
      channel: "instagram",
      phone: "",
      instagram: "@gabriell_braga",
      targetDisplayValue: "@gabriell_braga",
      targetNormalizedValue: "gabriell_braga",
      name: "Gabriel Braga",
      tags: [],
      extra: {}
    }
  ]);

  setWorkerState("instagram-assisted", {
    status: "connected",
    authenticated: true
  });

  const tick = processCampaignTick();
  assert.equal(tick.queued, 1);

  const row = getDb()
    .prepare("SELECT payload_json FROM jobs ORDER BY created_at DESC LIMIT 1")
    .get() as { payload_json: string } | undefined;

  assert.ok(row);
  const payload = JSON.parse(row.payload_json) as { externalThreadId: string | null; recipientNormalizedValue: string };
  assert.equal(payload.externalThreadId, "ig-thread-known");
  assert.equal(payload.recipientNormalizedValue, "gabriell_braga");
});

test("instagram contact channel stores the observed thread id in hidden metadata", () => {
  const contact = createContact(
    buildContact(1, {
      name: "Gabriel Braga",
      phone: "",
      instagram: "@gabriell_braga"
    })
  );

  assert.ok(contact);

  const channel = rememberInstagramThreadForContact({
    contactId: contact.id,
    instagram: "@gabriell_braga",
    threadId: "ig-thread-hidden",
    threadTitle: "Gabriel Braga",
    observedAt: new Date("2026-03-18T10:00:00.000Z").toISOString(),
    source: "test"
  });

  assert.ok(channel);
  assert.equal(channel?.metadata.threadId, "ig-thread-hidden");
  assert.equal(channel?.metadata.threadTitle, "Gabriel Braga");
  assert.equal(channel?.metadata.threadObservedAt, "2026-03-18T10:00:00.000Z");
  assert.equal(channel?.metadata.threadSource, "test");

  const refreshed = getContactById(contact.id);
  const instagramChannel = refreshed?.channels.find((entry) => entry.type === "instagram");
  assert.ok(instagramChannel);
  assert.equal(instagramChannel?.metadata.threadId, "ig-thread-hidden");
});

test("instagram upsertConversation persists the thread id on the contact channel", () => {
  const contact = createContact(
    buildContact(1, {
      name: "Paciente IG",
      phone: "5531998765432",
      instagram: ""
    })
  );

  assert.ok(contact);

  const conversation = upsertConversation({
    channel: "instagram",
    contactId: contact.id,
    externalThreadId: "ig-thread-upserted",
    title: "@paciente_ig",
    contactInstagram: "paciente_ig",
    unreadCount: 0,
    lastMessagePreview: "Oi",
    lastMessageAt: new Date("2026-03-18T10:10:00.000Z").toISOString(),
    lastMessageDirection: "incoming"
  });

  assert.ok(conversation);

  const refreshed = getContactById(contact.id);
  const instagramChannel = refreshed?.channels.find((entry) => entry.type === "instagram");
  assert.ok(instagramChannel);
  assert.equal(instagramChannel?.displayValue, "@paciente_ig");
  assert.equal(instagramChannel?.metadata.threadId, "ig-thread-upserted");
});

test("instagram campaign jobs fall back to the stored contact thread id when there is no conversation", () => {
  const contact = createContact(
    buildContact(1, {
      name: "Gabriel Braga",
      phone: "",
      instagram: "@gabriell_braga"
    })
  );

  assert.ok(contact);

  rememberInstagramThreadForContact({
    contactId: contact.id,
    instagram: "@gabriell_braga",
    threadId: "ig-thread-from-contact",
    threadTitle: "Gabriel Braga",
    observedAt: new Date("2026-03-18T10:05:00.000Z").toISOString(),
    source: "test"
  });

  const campaign = createCampaign({
    name: "Instagram com thread salvo no contato",
    description: "Deve reutilizar o thread salvo no metadata do canal",
    status: "active",
    sendWindowStart: "00:00",
    sendWindowEnd: "23:59",
    rateLimitCount: 20,
    rateLimitWindowMinutes: 60,
    randomDelayMinSeconds: 0,
    randomDelayMaxSeconds: 0,
    eligibleChannels: ["instagram"],
    steps: [
      {
        type: "text",
        content: "Mensagem usando thread salvo no contato",
        mediaPath: null,
        waitMinutes: null,
        caption: "",
        tagName: null,
        channelScope: "instagram"
      }
    ]
  });

  assert.ok(campaign);

  importCampaignRecipients(campaign.id, [
    {
      channel: "instagram",
      phone: "",
      instagram: "@gabriell_braga",
      targetDisplayValue: "@gabriell_braga",
      targetNormalizedValue: "gabriell_braga",
      name: "Gabriel Braga",
      tags: [],
      extra: {}
    }
  ]);

  setWorkerState("instagram-assisted", {
    status: "connected",
    authenticated: true
  });

  const tick = processCampaignTick();
  assert.equal(tick.queued, 1);

  const row = getDb()
    .prepare("SELECT payload_json FROM jobs ORDER BY created_at DESC LIMIT 1")
    .get() as { payload_json: string } | undefined;

  assert.ok(row);
  const payload = JSON.parse(row.payload_json) as { externalThreadId: string | null; recipientNormalizedValue: string };
  assert.equal(payload.externalThreadId, "ig-thread-from-contact");
  assert.equal(payload.recipientNormalizedValue, "gabriell_braga");
});

test("instagram channel deactivation preserves thread metadata and reason", () => {
  const contact = createContact(
    buildContact(1, {
      name: "Perfil indisponivel",
      phone: "",
      instagram: "@perfil_indisponivel"
    })
  );

  assert.ok(contact);

  rememberInstagramThreadForContact({
    contactId: contact.id,
    instagram: "@perfil_indisponivel",
    threadId: "ig-thread-inactive",
    threadTitle: "Perfil indisponivel",
    observedAt: new Date("2026-03-18T11:00:00.000Z").toISOString(),
    source: "test"
  });

  const channel = deactivateContactChannel({
    contactId: contact.id,
    type: "instagram",
    normalizedValue: "perfil_indisponivel",
    reason: "Perfil @perfil_indisponivel nao esta disponivel.",
    source: "test"
  });

  assert.ok(channel);
  assert.equal(channel?.isActive, false);
  assert.equal(channel?.metadata.threadId, "ig-thread-inactive");
  assert.equal(channel?.metadata.inactiveReason, "Perfil @perfil_indisponivel nao esta disponivel.");
  assert.equal(channel?.metadata.inactiveSource, "test");
});

test("campaign import preview blocks instagram handles marked inactive", () => {
  const contact = createContact(
    buildContact(1, {
      name: "Rose Leite",
      phone: "",
      instagram: "@roseleite"
    })
  );

  assert.ok(contact);

  deactivateContactChannel({
    contactId: contact.id,
    type: "instagram",
    normalizedValue: "roseleite",
    reason: "Perfil @roseleite nao esta disponivel.",
    source: "test"
  });

  const preview = buildCampaignImportPreview(
    [{ nome: "Rose Leite", telefone: "", instagram: "roseleite" }],
    {
      name: "nome",
      phone: "telefone",
      instagram: "instagram"
    },
    {
      eligibleChannels: ["instagram"]
    }
  );

  assert.deepEqual(preview.summary, {
    total: 1,
    existing: 0,
    eligible: 0,
    new_contact: 0,
    needs_review: 0,
    insufficient_link: 0,
    invalid: 1
  });
  assert.equal(preview.preview[0]?._exists, "invalid");
  assert.match(preview.preview[0]?._reason ?? "", /inativo/i);
  assert.equal(preview.recipients.length, 0);
});

test("campaign tick blocks instagram recipients already marked inactive", () => {
  const contact = createContact(
    buildContact(1, {
      name: "Sandra Inativa",
      phone: "",
      instagram: "@sandra_inativa"
    })
  );

  assert.ok(contact);

  deactivateContactChannel({
    contactId: contact.id,
    type: "instagram",
    normalizedValue: "sandra_inativa",
    reason: "Perfil @sandra_inativa nao esta disponivel.",
    source: "test"
  });

  const campaign = createCampaign({
    name: "Instagram inativo",
    description: "Nao deve enfileirar handles inativos",
    status: "active",
    sendWindowStart: "00:00",
    sendWindowEnd: "23:59",
    rateLimitCount: 20,
    rateLimitWindowMinutes: 60,
    randomDelayMinSeconds: 0,
    randomDelayMaxSeconds: 0,
    eligibleChannels: ["instagram"],
    steps: [
      {
        type: "text",
        content: "Mensagem",
        mediaPath: null,
        waitMinutes: null,
        caption: "",
        tagName: null,
        channelScope: "instagram"
      }
    ]
  });

  assert.ok(campaign);

  importCampaignRecipients(campaign.id, [
    {
      channel: "instagram",
      phone: "",
      instagram: "@sandra_inativa",
      targetDisplayValue: "@sandra_inativa",
      targetNormalizedValue: "sandra_inativa",
      name: "Sandra Inativa",
      tags: [],
      extra: {}
    }
  ]);

  setWorkerState("instagram-assisted", {
    status: "connected",
    authenticated: true
  });

  const tick = processCampaignTick();
  assert.equal(tick.queued, 0);

  const recipient = getDb()
    .prepare("SELECT status, last_error FROM campaign_recipients ORDER BY created_at DESC LIMIT 1")
    .get() as { status: string; last_error: string | null } | undefined;

  assert.ok(recipient);
  assert.equal(recipient?.status, "blocked_by_rule");
  assert.match(recipient?.last_error ?? "", /inativo|validacao da url/i);
});

test("instagram profile snapshot validation rejects unavailable profiles and accepts valid profile pages", () => {
  const invalid = assessInstagramProfileSnapshot(
    {
      currentPath: "/roseleite/",
      canonicalPath: "/roseleite/",
      title: "Instagram",
      bodyText: "Sorry, this page isn't available.",
      hasHeader: false,
      hasActionBar: false
    },
    "roseleite"
  );

  assert.equal(invalid.valid, false);
  assert.match(invalid.reason ?? "", /nao esta disponivel|cabecalho/i);

  const valid = assessInstagramProfileSnapshot(
    {
      currentPath: "/roseleite/",
      canonicalPath: "https://www.instagram.com/roseleite/",
      title: "@roseleite • Instagram photos and videos",
      bodyText: "roseleite Publicacoes Seguidores Seguindo Mensagem",
      hasHeader: true,
      hasActionBar: true
    },
    "roseleite"
  );

  assert.equal(valid.valid, true);
  assert.equal(valid.reason, null);
});

test("instagram thread participant resolution prefers profile links over display names", () => {
  const participant = resolveInstagramThreadParticipant({
    ownUsername: "studionuoma",
    fallbackTitle: "Gabriel Braga",
    profileLinks: [
      { href: "/studionuoma/", text: "Perfil" },
      { href: "/dric941/", text: "Adriana dric941" },
      { href: "/dric941/", text: "Ver perfil" }
    ]
  });

  assert.equal(participant.username, "dric941");
  assert.equal(participant.displayName, "Adriana");

  const fallback = resolveInstagramThreadParticipant({
    ownUsername: "studionuoma",
    fallbackTitle: "@compartilhandomensagens",
    profileLinks: []
  });

  assert.equal(fallback.username, "compartilhandomensagens");
  assert.equal(fallback.displayName, null);

  const invalidFallback = resolveInstagramThreadParticipant({
    ownUsername: "studionuoma",
    fallbackTitle: "Gabriel Braga",
    profileLinks: []
  });

  assert.equal(invalidFallback.username, null);
  assert.equal(invalidFallback.displayName, "Gabriel Braga");
});

test("instagram composer readiness ignores direct/new until a real thread or textbox is open", () => {
  assert.equal(
    isInstagramComposerSurfaceReady({
      url: "https://www.instagram.com/direct/new/",
      hasTextarea: false,
      hasRichTextbox: false
    }),
    false
  );

  assert.equal(
    isInstagramComposerSurfaceReady({
      url: "https://www.instagram.com/direct/t/107576893972150/",
      hasTextarea: false,
      hasRichTextbox: false
    }),
    true
  );

  assert.equal(
    isInstagramComposerSurfaceReady({
      url: "https://www.instagram.com/roseleite/",
      hasTextarea: false,
      hasRichTextbox: true
    }),
    true
  );
});

test("instagram composer recipient selection prefers the exact searched username over inbox noise", () => {
  const selectedIndex = pickInstagramComposerRecipientCandidate({
    targetUsername: "emanuelerodrigues",
    targetDisplayName: "Emanuele Rodrigues",
    candidates: [
      {
        text: "roseleite Você: Oi! · 3 min",
        descendantTexts: ["roseleite", "Você: Oi!", "3 min"]
      },
      {
        text: "Emanuele Rodrigues emanuelerodrigues",
        descendantTexts: ["Emanuele Rodrigues", "emanuelerodrigues"]
      },
      {
        text: "Enviar mensagem",
        descendantTexts: ["Enviar mensagem"]
      }
    ]
  });

  assert.equal(selectedIndex, 1);
});

test("instagram incoming automation queues an assisted reply on the synced thread", () => {
  const contact = createContact(
    buildContact(1, {
      name: "Gabriel Braga",
      phone: "",
      instagram: "@gabriell_braga"
    })
  );

  assert.ok(contact);

  const conversation = upsertConversation({
    channel: "instagram",
    contactId: contact.id,
    externalThreadId: "ig-thread-auto",
    title: "Gabriel Braga",
    unreadCount: 1,
    lastMessagePreview: "Oi",
    lastMessageAt: new Date().toISOString(),
    lastMessageDirection: "incoming",
    contactPhone: null
  });

  assert.ok(conversation);

  const automation = createAutomation({
    name: "Resposta automática Instagram",
    category: "instagram-incoming",
    enabled: true,
    description: "Responde quando entrar nova mensagem no Instagram.",
    triggerTags: [],
    excludeTags: ["nao_insistir"],
    requiredStatus: null,
    procedureOnly: false,
    requireLastOutgoing: false,
    requireNoReply: false,
    timeWindowHours: 1,
    minimumIntervalHours: 12,
    randomDelayMinSeconds: 0,
    randomDelayMaxSeconds: 0,
    sendWindowStart: "00:00",
    sendWindowEnd: "23:59",
    templateKey: null,
    actions: [
      {
        type: "send-text",
        content: "Recebi sua mensagem e já sigo por aqui.",
        mediaPath: null,
        waitSeconds: null,
        tagName: null,
        reminderText: null,
        metadata: {}
      }
    ]
  });

  assert.ok(automation);

  const trigger = triggerIncomingAutomationRuns({
    channel: "instagram",
    contactId: contact.id,
    conversationId: conversation.id
  });

  assert.equal(trigger.queued, 1);

  setWorkerState("instagram-assisted", {
    status: "connected",
    authenticated: true
  });

  processAutomationTick();

  const row = getDb()
    .prepare("SELECT type, payload_json FROM jobs ORDER BY created_at DESC LIMIT 1")
    .get() as { type: string; payload_json: string } | undefined;

  assert.ok(row);
  assert.equal(row.type, "send-assisted-message");

  const payload = JSON.parse(row.payload_json) as { channel: string; externalThreadId: string | null; recipientNormalizedValue: string; text: string };
  assert.equal(payload.channel, "instagram");
  assert.equal(payload.externalThreadId, "ig-thread-auto");
  assert.equal(payload.recipientNormalizedValue, "gabriell_braga");
  assert.equal(payload.text, "Recebi sua mensagem e já sigo por aqui.");
});

test("tags route creates, updates and lists metadata consistently", async () => {
  const createResponse = await app.inject({
    method: "POST",
    url: "/tags",
    payload: {
      name: "VIP Ouro",
      color: "#fbbf24",
      type: "manual",
      active: true
    }
  });

  assert.equal(createResponse.statusCode, 201);
  const createdTag = createResponse.json() as { id: string; normalizedName: string };
  assert.equal(createdTag.normalizedName, "vip ouro");

  const updateResponse = await app.inject({
    method: "PATCH",
    url: `/tags/${createdTag.id}`,
    payload: {
      name: "VIP Ouro",
      color: "#22d3ee",
      type: "automacao",
      active: false
    }
  });

  assert.equal(updateResponse.statusCode, 200);

  const listResponse = await app.inject({
    method: "GET",
    url: "/tags"
  });

  assert.equal(listResponse.statusCode, 200);
  const tags = listResponse.json() as Array<{ id: string; color: string; type: string; active: boolean }>;
  const updatedTag = tags.find((tag) => tag.id === createdTag.id);
  assert.ok(updatedTag);
  assert.equal(updatedTag.color, "#22d3ee");
  assert.equal(updatedTag.type, "automacao");
  assert.equal(updatedTag.active, false);
});

test("settings route exposes effective env settings and marks persisted overrides", async () => {
  const settingsResponse = await app.inject({
    method: "GET",
    url: "/settings"
  });

  assert.equal(settingsResponse.statusCode, 200);
  const initialSettings = settingsResponse.json() as Array<{ key: string; value: unknown; source: string }>;
  const appNameSetting = initialSettings.find((setting) => setting.key === "APP_NAME");
  assert.ok(appNameSetting);
  assert.equal(appNameSetting?.value, "Nuoma WPP");
  assert.equal(appNameSetting?.source, "env");

  const patchResponse = await app.inject({
    method: "PATCH",
    url: "/settings",
    payload: {
      APP_NAME: "Nuoma WPP Premium"
    }
  });

  assert.equal(patchResponse.statusCode, 200);
  const patchedSettings = patchResponse.json() as Array<{ key: string; value: unknown; source: string }>;
  const patchedAppName = patchedSettings.find((setting) => setting.key === "APP_NAME");
  assert.ok(patchedAppName);
  assert.equal(patchedAppName?.value, "Nuoma WPP Premium");
  assert.equal(patchedAppName?.source, "database");
});

test("logs route pagina eventos e jobs com offsets independentes", async () => {
  for (let index = 0; index < 25; index += 1) {
    recordSystemEvent("review-test", "info", `evento-${index}`);
    enqueueJob({
      type: "send-message",
      payload: { index }
    });
  }

  const response = await app.inject({
    method: "GET",
    url: "/logs?limit=20&eventsOffset=20&jobsOffset=0"
  });

  assert.equal(response.statusCode, 200);

  const payload = response.json() as {
    events: Array<{ message: string }>;
    jobs: Array<{ type: string }>;
  };

  assert.equal(payload.events.length, 5);
  assert.equal(payload.jobs.length, 20);
  assert.ok(payload.events.every((event) => event.message.startsWith("evento-")));
  assert.ok(payload.jobs.every((job) => job.type === "send-message"));
});

test("data lake pipeline indexes database conversations and local media", async () => {
  const contact = createContact(
    buildContact(1, {
      name: "Paciente IG",
      instagram: "@paciente_ig"
    })
  );

  assert.ok(contact);

  const conversation = upsertConversation({
    channel: "instagram",
    contactId: contact.id,
    externalThreadId: "ig-thread-review-1",
    title: "Paciente IG",
    unreadCount: 0,
    lastMessagePreview: "Quero saber valor",
    lastMessageAt: new Date("2026-03-17T12:00:00.000Z").toISOString(),
    lastMessageDirection: "incoming"
  });

  assert.ok(conversation);

  addMessage({
    conversationId: conversation.id,
    contactId: contact.id,
    direction: "incoming",
    body: "Oi, quero saber o valor do peeling e quando tem horario.",
    contentType: "text",
    externalId: "ig-review-message-1",
    sentAt: new Date("2026-03-17T12:00:00.000Z").toISOString(),
    meta: {
      source: "test"
    }
  });

  const mediaRoot = path.join(tempRoot, "fake-downloads", "Nuoma");
  const imagePath = path.join(mediaRoot, "Fotos", "foto-1.jpg");
  await mkdir(path.dirname(imagePath), { recursive: true });
  await writeFile(imagePath, Buffer.from("fake-image"));

  const runResponse = await app.inject({
    method: "POST",
    url: "/data-lake/run",
    payload: {
      includeInstagramExports: false,
      mediaRoots: [mediaRoot],
      maxMediaFiles: 10,
      maxEnrichmentItems: 2
    }
  });

  assert.equal(runResponse.statusCode, 200);
  const runPayload = runResponse.json() as {
    summary: {
      databaseMessagesIndexed: number;
      mediaFilesIndexed: number;
      enrichmentSummary: {
        provider: string;
        pendingProvider: number;
      };
    };
  };
  assert.equal(runPayload.summary.databaseMessagesIndexed, 1);
  assert.equal(runPayload.summary.mediaFilesIndexed, 1);
  assert.equal(runPayload.summary.enrichmentSummary.provider, "none");
  assert.equal(runPayload.summary.enrichmentSummary.pendingProvider, 1);

  const overviewResponse = await app.inject({
    method: "GET",
    url: "/data-lake"
  });

  assert.equal(overviewResponse.statusCode, 200);
  const overviewPayload = overviewResponse.json() as {
    countsByKind: Record<string, number>;
    latestReport: {
      summaryText: string;
      topKeywords: Array<{ term: string; count: number }>;
    } | null;
  };
  assert.equal(overviewPayload.countsByKind.conversation_message, 1);
  assert.equal(overviewPayload.countsByKind.image, 1);
  assert.ok(overviewPayload.latestReport);
  assert.match(overviewPayload.latestReport?.summaryText ?? "", /registros textuais indexados/i);
  assert.ok((overviewPayload.latestReport?.topKeywords ?? []).some((item) => item.term === "valor"));
});
