import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createRepositories, openDb, runMigrations, type DbHandle } from "@nuoma/db";

import { listOverlayAutomationOptions, runOverlayAutomationNow } from "./overlay-automations.js";
import { listOverlayCampaignOptions, runOverlayCampaignNow } from "./overlay-campaigns.js";

let tempDir: string;
let db: DbHandle;

const canaryPhone = "5531982066263";
const sendPolicy = { mode: "test" as const, allowedPhones: [canaryPhone] };
const temporaryMessages = {
  enabled: true,
  beforeSendDuration: "24h" as const,
  afterCompletionDuration: "90d" as const,
  restoreOnFailure: true,
};

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nuoma-v2-overlay-services-"));
  db = openDb(path.join(tempDir, "api.db"));
  await runMigrations(db);
});

afterEach(async () => {
  db.close();
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("overlay services", () => {
  it("lists and runs only campaigns explicitly marked overlay sim across media and day delays", async () => {
    const repos = createRepositories(db);
    const user = await repos.users.create({
      email: "overlay-campaigns@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    await repos.contacts.create({
      userId: user.id,
      name: "Neferpeel",
      phone: canaryPhone,
      primaryChannel: "whatsapp",
      status: "lead",
    });

    const mediaCampaigns = await Promise.all([
      repos.campaigns.create({
        userId: user.id,
        name: "Overlay audio com delay de dias",
        channel: "whatsapp",
        status: "running",
        evergreen: false,
        steps: [
          {
            id: "voice-day",
            label: "Audio dia seguinte",
            type: "voice",
            delaySeconds: 86_400,
            conditions: [],
            mediaAssetId: 101,
            caption: "Audio programado",
          },
        ],
        metadata: { overlayEnabled: true, temporaryMessages },
      }),
      repos.campaigns.create({
        userId: user.id,
        name: "Overlay fotos",
        channel: "whatsapp",
        status: "running",
        evergreen: false,
        steps: [
          {
            id: "image",
            label: "Foto",
            type: "image",
            delaySeconds: 0,
            conditions: [],
            mediaAssetId: 102,
            mediaAssetIds: [102, 103],
            caption: "Fotos",
          },
        ],
        metadata: { overlayEnabled: true, temporaryMessages },
      }),
      repos.campaigns.create({
        userId: user.id,
        name: "Overlay video",
        channel: "whatsapp",
        status: "running",
        evergreen: false,
        steps: [
          {
            id: "video",
            label: "Video",
            type: "video",
            delaySeconds: 0,
            conditions: [],
            mediaAssetId: 104,
            caption: "Video",
          },
        ],
        metadata: { overlayEnabled: true, temporaryMessages },
      }),
      repos.campaigns.create({
        userId: user.id,
        name: "Overlay documento",
        channel: "whatsapp",
        status: "running",
        evergreen: false,
        steps: [
          {
            id: "document",
            label: "Documento",
            type: "document",
            delaySeconds: 0,
            conditions: [],
            mediaAssetId: 105,
            fileName: "proposta.pdf",
            caption: "Documento",
          },
        ],
        metadata: { overlayEnabled: true, temporaryMessages },
      }),
      repos.campaigns.create({
        userId: user.id,
        name: "Overlay link",
        channel: "whatsapp",
        status: "running",
        evergreen: false,
        steps: [
          {
            id: "link",
            label: "Link",
            type: "link",
            delaySeconds: 0,
            conditions: [],
            url: "https://nuoma.local/checkout",
            previewEnabled: true,
            text: "Abrir link",
          },
        ],
        metadata: { overlayEnabled: true, temporaryMessages },
      }),
      repos.campaigns.create({
        userId: user.id,
        name: "Overlay texto",
        channel: "whatsapp",
        status: "running",
        evergreen: false,
        steps: [
          {
            id: "text",
            label: "Texto",
            type: "text",
            delaySeconds: 0,
            conditions: [],
            template: "Oi {{nome}}, tudo bem?",
          },
        ],
        metadata: { overlayEnabled: true, temporaryMessages },
      }),
      repos.campaigns.create({
        userId: user.id,
        name: "Overlay controle temporario",
        channel: "whatsapp",
        status: "running",
        evergreen: false,
        steps: [
          {
            id: "temporary",
            label: "Controle 24h",
            type: "temporary_messages",
            delaySeconds: 0,
            conditions: [],
            duration: "24h",
          },
        ],
        metadata: { overlayEnabled: true },
      }),
    ]);
    const disabledCampaign = await repos.campaigns.create({
      userId: user.id,
      name: "Campanha bloqueada por overlay nao",
      channel: "whatsapp",
      status: "running",
      evergreen: false,
      steps: [
        {
          id: "blocked",
          label: "Bloqueada",
          type: "text",
          delaySeconds: 0,
          conditions: [],
          template: "Nao deve aparecer",
        },
      ],
      metadata: { overlayEnabled: false, temporaryMessages },
    });
    const unmarkedCampaign = await repos.campaigns.create({
      userId: user.id,
      name: "Campanha sem flag overlay",
      channel: "whatsapp",
      status: "running",
      evergreen: false,
      steps: [
        {
          id: "unmarked",
          label: "Sem flag",
          type: "text",
          delaySeconds: 0,
          conditions: [],
          template: "Nao deve aparecer tambem",
        },
      ],
      metadata: { temporaryMessages },
    });

    const options = await listOverlayCampaignOptions({
      repos,
      userId: user.id,
      phone: canaryPhone,
      sendPolicy,
      limit: 20,
    });

    expect(options).toHaveLength(mediaCampaigns.length);
    expect(options.every((option) => option.overlayEnabled)).toBe(true);
    expect(options.map((option) => option.id)).not.toContain(disabledCampaign.id);
    expect(options.map((option) => option.id)).not.toContain(unmarkedCampaign.id);
    expect(options.map((option) => option.firstStepType)).toEqual(
      expect.arrayContaining([
        "voice",
        "image",
        "video",
        "document",
        "link",
        "text",
        "temporary_messages",
      ]),
    );

    const blockedRun = await runOverlayCampaignNow({
      repos,
      userId: user.id,
      campaignId: disabledCampaign.id,
      phone: canaryPhone,
      sendPolicy,
      ownerId: "test-overlay",
      source: "overlay.test",
      idempotencyKey: "overlay-disabled-campaign",
    });
    expect(blockedRun.rejected).toEqual([
      { source: "phone", value: canaryPhone, reason: "overlay_not_enabled" },
    ]);
    expect(blockedRun.jobsCreated).toBe(0);

    const audioCampaign = mediaCampaigns[0]!;
    const beforeRun = Date.now();
    const run = await runOverlayCampaignNow({
      repos,
      userId: user.id,
      campaignId: audioCampaign.id,
      phone: canaryPhone,
      sendPolicy,
      ownerId: "test-overlay",
      source: "overlay.test",
      idempotencyKey: "overlay-audio-day",
    });
    const jobs = await repos.jobs.list(user.id, "queued");
    const audioJob = jobs.find((job) => {
      const payload = job.payload as { campaignId?: number };
      return payload.campaignId === audioCampaign.id;
    });

    expect(run).toMatchObject({ recipientsCreated: 1, jobsCreated: 1, plannedJobs: 1 });
    expect(audioJob?.payload).toEqual(
      expect.objectContaining({
        campaignId: audioCampaign.id,
        step: expect.objectContaining({ type: "voice", mediaAssetId: 101 }),
      }),
    );
    expect(new Date(audioJob!.scheduledAt).getTime()).toBeGreaterThanOrEqual(
      beforeRun + 86_300_000,
    );
  });

  it("lists and runs only automations explicitly marked overlay sim", async () => {
    const repos = createRepositories(db);
    const user = await repos.users.create({
      email: "overlay-automations@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    await repos.contacts.create({
      userId: user.id,
      name: "Neferpeel",
      phone: canaryPhone,
      primaryChannel: "whatsapp",
      status: "lead",
    });
    const automation = await repos.automations.create({
      userId: user.id,
      name: "Automacao overlay video com delay",
      category: "Overlay",
      status: "active",
      trigger: { type: "message_received", channel: "whatsapp" },
      condition: { segment: null, requireWithin24hWindow: false },
      actions: [
        { id: "delay-day", type: "delay", seconds: 86_400, label: "Dia seguinte" },
        {
          id: "send-video",
          type: "send_step",
          step: {
            id: "video-step",
            label: "Video",
            type: "video",
            delaySeconds: 0,
            conditions: [],
            mediaAssetId: 301,
            caption: "Video do overlay",
          },
        },
      ],
      metadata: { overlayEnabled: true },
    });
    const disabledAutomation = await repos.automations.create({
      userId: user.id,
      name: "Automacao overlay nao",
      category: "Overlay",
      status: "active",
      trigger: { type: "message_received", channel: "whatsapp" },
      condition: { segment: null, requireWithin24hWindow: false },
      actions: [
        {
          id: "send-text",
          type: "send_step",
          step: {
            id: "text-step",
            label: "Texto",
            type: "text",
            delaySeconds: 0,
            conditions: [],
            template: "Nao deve rodar",
          },
        },
      ],
      metadata: { overlayEnabled: false },
    });
    const unmarkedAutomation = await repos.automations.create({
      userId: user.id,
      name: "Automacao sem flag overlay",
      category: "Overlay",
      status: "active",
      trigger: { type: "message_received", channel: "whatsapp" },
      condition: { segment: null, requireWithin24hWindow: false },
      actions: [
        {
          id: "send-text",
          type: "send_step",
          step: {
            id: "text-step",
            label: "Texto",
            type: "text",
            delaySeconds: 0,
            conditions: [],
            template: "Nao deve aparecer",
          },
        },
      ],
      metadata: {},
    });

    const options = await listOverlayAutomationOptions({
      repos,
      userId: user.id,
      phone: canaryPhone,
      sendPolicy,
      limit: 10,
    });

    expect(options).toEqual([
      expect.objectContaining({
        id: automation.id,
        name: automation.name,
        overlayEnabled: true,
        eligible: true,
        wouldEnqueueJobs: true,
      }),
    ]);
    expect(options.map((option) => option.id)).not.toContain(disabledAutomation.id);
    expect(options.map((option) => option.id)).not.toContain(unmarkedAutomation.id);

    const blockedRun = await runOverlayAutomationNow({
      repos,
      userId: user.id,
      automationId: disabledAutomation.id,
      phone: canaryPhone,
      sendPolicy,
      source: "overlay.test",
      idempotencyKey: "overlay-disabled-automation",
    });
    expect(blockedRun).toMatchObject({
      eligible: false,
      reasons: ["overlay_not_enabled"],
      jobsCreated: 0,
    });

    const beforeRun = Date.now();
    const run = await runOverlayAutomationNow({
      repos,
      userId: user.id,
      automationId: automation.id,
      phone: canaryPhone,
      sendPolicy,
      source: "overlay.test",
      idempotencyKey: "overlay-automation-delay",
    });
    const jobs = await repos.jobs.list(user.id, "queued");
    const automationJob = jobs.find((job) => {
      const payload = job.payload as { automationId?: number };
      return payload.automationId === automation.id;
    });

    expect(run).toMatchObject({
      eligible: true,
      jobsCreated: 1,
      actionsApplied: 1,
      plannedActions: 2,
    });
    expect(automationJob?.payload).toEqual(
      expect.objectContaining({
        automationId: automation.id,
        step: expect.objectContaining({ type: "video", mediaAssetId: 301 }),
      }),
    );
    expect(new Date(automationJob!.scheduledAt).getTime()).toBeGreaterThanOrEqual(
      beforeRun + 86_300_000,
    );
  });
});
