import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createRepositories, openDb, runMigrations, type DbHandle } from "@nuoma/db";

import { runCampaignSchedulerTick } from "./campaign-scheduler.js";
import { createCampaignSchedulerDaemon } from "./campaign-scheduler-daemon.js";

let tempDir: string;
let db: DbHandle;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nuoma-v2-campaign-scheduler-"));
  db = openDb(path.join(tempDir, "api.db"));
  await runMigrations(db);
});

afterEach(async () => {
  db.close();
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("campaign scheduler tick", () => {
  it("enqueues the next campaign step once and marks the recipient as awaiting the job", async () => {
    const repos = createRepositories(db);
    const user = await repos.users.create({
      email: "campaign@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const campaign = await repos.campaigns.create({
      userId: user.id,
      name: "Teste",
      channel: "whatsapp",
      status: "running",
      evergreen: false,
      startsAt: null,
      segment: null,
      steps: [
        {
          id: "step-1",
          label: "Primeiro envio",
          type: "text",
          delaySeconds: 30,
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
      phone: "55 (31) 98206-6263",
      channel: "whatsapp",
      status: "queued",
      currentStepId: null,
      metadata: {
        variables: {
          nome: "Gabriel",
        },
      },
    });
    await repos.conversations.create({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "5531982066263",
      title: "Gabriel Braga Nuoma",
      lastMessageAt: null,
      lastPreview: null,
      unreadCount: 0,
    });
    const now = new Date("2026-05-04T12:00:00.000Z");

    const first = await runCampaignSchedulerTick({
      repos,
      userId: user.id,
      ownerId: "test",
      now,
    });
    const second = await runCampaignSchedulerTick({
      repos,
      userId: user.id,
      ownerId: "test",
      now,
    });
    const jobs = (await repos.jobs.list(user.id, "queued")).sort((a, b) =>
      a.scheduledAt.localeCompare(b.scheduledAt),
    );
    const updated = await repos.campaignRecipients.findById({
      userId: user.id,
      id: recipient.id,
    });
    const conversation = await repos.conversations.findByExternalThread({
      userId: user.id,
      channel: "whatsapp",
      externalThreadId: "5531982066263",
    });

    expect(first).toMatchObject({
      acquired: true,
      campaignsScanned: 1,
      recipientsScanned: 1,
      jobsCreated: 1,
    });
    expect(second.jobsCreated).toBe(0);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toEqual(
      expect.objectContaining({
        type: "campaign_step",
        scheduledAt: "2026-05-04T12:00:30.000Z",
      }),
    );
    expect(jobs[0]?.payload).toEqual(
      expect.objectContaining({
        campaignId: campaign.id,
        recipientId: recipient.id,
        phone: "5531982066263",
        isLastStep: true,
        variables: expect.objectContaining({
          nome: "Gabriel",
          telefone: "5531982066263",
        }),
      }),
    );
    expect(updated?.status).toBe("running");
    expect(updated?.metadata).toEqual(
      expect.objectContaining({
        awaitingJobId: jobs[0]?.id,
        awaitingStepId: "step-1",
      }),
    );
    expect(conversation?.title).toBe("Gabriel Braga Nuoma");
  });

  it("groups close campaign steps for the same recipient and carries temporary message audit parameters", async () => {
    const repos = createRepositories(db);
    const user = await repos.users.create({
      email: "campaign-ic2@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const campaign = await repos.campaigns.create({
      userId: user.id,
      name: "IC-2",
      channel: "whatsapp",
      status: "running",
      evergreen: false,
      startsAt: null,
      segment: null,
      steps: [
        {
          id: "intro",
          label: "Intro",
          type: "text",
          delaySeconds: 0,
          conditions: [],
          template: "Intro {{telefone}}",
        },
        {
          id: "proof",
          label: "Prova",
          type: "text",
          delaySeconds: 0,
          conditions: [],
          template: "Prova {{telefone}}",
        },
        {
          id: "close",
          label: "Fechamento",
          type: "text",
          delaySeconds: 0,
          conditions: [],
          template: "Fechamento {{telefone}}",
        },
      ],
      metadata: {
        temporaryMessages: {
          enabled: true,
          beforeSendDuration: "24h",
          afterCompletionDuration: "90d",
          restoreOnFailure: true,
        },
      },
    });
    const recipient = await repos.campaignRecipients.create({
      userId: user.id,
      campaignId: campaign.id,
      contactId: null,
      phone: "5531982066263",
      channel: "whatsapp",
      status: "queued",
      currentStepId: null,
      metadata: {},
    });
    const now = new Date("2026-05-04T12:00:00.000Z");

    const result = await runCampaignSchedulerTick({
      repos,
      userId: user.id,
      ownerId: "ic2",
      now,
    });
    const jobs = (await repos.jobs.list(user.id, "queued")).sort((a, b) =>
      a.scheduledAt.localeCompare(b.scheduledAt),
    );
    const updated = await repos.campaignRecipients.findById({
      userId: user.id,
      id: recipient.id,
    });

    expect(result.jobsCreated).toBe(3);
    expect(result.plannedJobs.map((job) => job.stepId)).toEqual(["intro", "proof", "close"]);
    expect(jobs.map((job) => (job.payload.step as { id?: string }).id)).toEqual([
      "intro",
      "proof",
      "close",
    ]);
    expect(jobs.map((job) => job.scheduledAt)).toEqual([
      "2026-05-04T12:00:00.000Z",
      "2026-05-04T12:00:01.000Z",
      "2026-05-04T12:00:02.000Z",
    ]);
    expect(jobs[0]?.payload.temporaryMessages).toEqual(
      expect.objectContaining({
        beforeSendDuration: "24h",
        afterCompletionDuration: "90d",
        restoreOnFailure: true,
      }),
    );
    expect(jobs[2]?.payload).toEqual(
      expect.objectContaining({
        isLastStep: true,
        campaignBatchIndex: 2,
        campaignBatchSize: 3,
      }),
    );
    expect(updated?.metadata).toEqual(
      expect.objectContaining({
        awaitingJobIds: jobs.map((job) => job.id),
        awaitingStepIds: ["intro", "proof", "close"],
        awaitingJobId: jobs[0]?.id,
        awaitingStepId: "intro",
        temporaryMessages: expect.objectContaining({
          beforeSendDuration: "24h",
          afterCompletionDuration: "90d",
        }),
      }),
    );
  });

  it("runs the same scheduler through the daemon tick without creating duplicates", async () => {
    const repos = createRepositories(db);
    const user = await repos.users.create({
      email: "campaign-daemon@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const campaign = await repos.campaigns.create({
      userId: user.id,
      name: "Daemon",
      channel: "whatsapp",
      status: "running",
      evergreen: false,
      startsAt: null,
      segment: null,
      steps: [
        {
          id: "step-1",
          label: "Envio",
          type: "text",
          delaySeconds: 0,
          conditions: [],
          template: "Oi",
        },
      ],
      metadata: {},
    });
    await repos.campaignRecipients.create({
      userId: user.id,
      campaignId: campaign.id,
      contactId: null,
      phone: "5531982066263",
      channel: "whatsapp",
      status: "queued",
      currentStepId: null,
      metadata: {},
    });
    const logger = {
      info: () => {},
      warn: () => {},
      error: () => {},
    };
    const daemon = createCampaignSchedulerDaemon({
      repos,
      logger,
      enabled: true,
      userId: user.id,
      ownerId: "daemon-test",
      intervalMs: 10_000,
    });

    await daemon.tickOnce();
    await daemon.tickOnce();
    daemon.stop();

    const jobs = await repos.jobs.list(user.id, "queued");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.type).toBe("campaign_step");
  });

  it("previews campaign jobs in dry-run mode without mutating queue or recipients", async () => {
    const repos = createRepositories(db);
    const user = await repos.users.create({
      email: "campaign-preview@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const campaign = await repos.campaigns.create({
      userId: user.id,
      name: "Preview",
      channel: "whatsapp",
      status: "running",
      evergreen: false,
      startsAt: null,
      segment: null,
      steps: [
        {
          id: "step-1",
          label: "Preview envio",
          type: "text",
          delaySeconds: 5,
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
      phone: "5531982066263",
      channel: "whatsapp",
      status: "queued",
      currentStepId: null,
      metadata: {},
    });
    const now = new Date("2026-05-04T12:00:00.000Z");

    const preview = await runCampaignSchedulerTick({
      repos,
      userId: user.id,
      ownerId: "preview-test",
      now,
      dryRun: true,
    });
    const jobs = await repos.jobs.list(user.id, "queued");
    const updated = await repos.campaignRecipients.findById({
      userId: user.id,
      id: recipient.id,
    });

    expect(preview).toMatchObject({
      dryRun: true,
      acquired: true,
      campaignsScanned: 1,
      recipientsScanned: 1,
      jobsCreated: 0,
    });
    expect(preview.plannedJobs).toEqual([
      expect.objectContaining({
        campaignId: campaign.id,
        recipientId: recipient.id,
        stepId: "step-1",
        phone: "5531982066263",
        scheduledAt: "2026-05-04T12:00:05.000Z",
      }),
    ]);
    expect(jobs).toHaveLength(0);
    expect(updated?.status).toBe("queued");
    expect(updated?.metadata.awaitingJobId).toBeUndefined();
  });

  it("skips paused campaigns and scopes ticks to a specific campaign", async () => {
    const repos = createRepositories(db);
    const user = await repos.users.create({
      email: "campaign-pause-resume@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const paused = await repos.campaigns.create({
      userId: user.id,
      name: "Paused",
      channel: "whatsapp",
      status: "paused",
      evergreen: false,
      startsAt: null,
      segment: null,
      steps: [
        {
          id: "paused-step",
          label: "Pausada",
          type: "text",
          delaySeconds: 0,
          conditions: [],
          template: "Pausada",
        },
      ],
      metadata: {},
    });
    const running = await repos.campaigns.create({
      userId: user.id,
      name: "Running",
      channel: "whatsapp",
      status: "running",
      evergreen: false,
      startsAt: null,
      segment: null,
      steps: [
        {
          id: "running-step",
          label: "Rodando",
          type: "text",
          delaySeconds: 0,
          conditions: [],
          template: "Rodando",
        },
      ],
      metadata: {},
    });
    await repos.campaignRecipients.create({
      userId: user.id,
      campaignId: paused.id,
      contactId: null,
      phone: "5531982066263",
      channel: "whatsapp",
      status: "queued",
      currentStepId: null,
      metadata: {},
    });
    await repos.campaignRecipients.create({
      userId: user.id,
      campaignId: running.id,
      contactId: null,
      phone: "5531982066263",
      channel: "whatsapp",
      status: "queued",
      currentStepId: null,
      metadata: {},
    });

    const pausedPreview = await runCampaignSchedulerTick({
      repos,
      userId: user.id,
      ownerId: "paused-preview",
      dryRun: true,
      campaignId: paused.id,
    });
    expect(pausedPreview).toMatchObject({
      campaignsScanned: 0,
      recipientsScanned: 0,
      jobsCreated: 0,
    });
    expect(pausedPreview.plannedJobs).toHaveLength(0);

    const runningPreview = await runCampaignSchedulerTick({
      repos,
      userId: user.id,
      ownerId: "running-preview",
      dryRun: true,
      campaignId: running.id,
    });
    expect(runningPreview).toMatchObject({
      campaignsScanned: 1,
      recipientsScanned: 1,
      jobsCreated: 0,
    });
    expect(runningPreview.plannedJobs).toEqual([
      expect.objectContaining({
        campaignId: running.id,
        stepId: "running-step",
      }),
    ]);

    await repos.campaigns.update({
      userId: user.id,
      id: paused.id,
      status: "running",
      startsAt: new Date("2026-05-04T12:00:00.000Z").toISOString(),
    });
    const resumedPreview = await runCampaignSchedulerTick({
      repos,
      userId: user.id,
      ownerId: "resumed-preview",
      dryRun: true,
      campaignId: paused.id,
    });
    expect(resumedPreview.plannedJobs).toEqual([
      expect.objectContaining({
        campaignId: paused.id,
        stepId: "paused-step",
      }),
    ]);
  });

  it("applies A/B variant overrides to planned and queued campaign steps", async () => {
    const repos = createRepositories(db);
    const user = await repos.users.create({
      email: "campaign-ab@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const campaign = await repos.campaigns.create({
      userId: user.id,
      name: "A/B",
      channel: "whatsapp",
      status: "running",
      evergreen: false,
      startsAt: null,
      segment: null,
      steps: [
        {
          id: "step-1",
          label: "Mensagem",
          type: "text",
          delaySeconds: 5,
          conditions: [],
          template: "Controle {{nome}}",
        },
      ],
      metadata: {
        abVariants: {
          enabled: true,
          assignment: "deterministic",
          variants: [
            { id: "a", label: "Controle", weight: 50, stepOverrides: {} },
            {
              id: "b",
              label: "Direta",
              weight: 50,
              stepOverrides: {
                "step-1": { template: "Direta {{nome}}", delaySeconds: 15 },
              },
            },
          ],
        },
      },
    });
    const recipient = await repos.campaignRecipients.create({
      userId: user.id,
      campaignId: campaign.id,
      contactId: null,
      phone: "5531982066263",
      channel: "whatsapp",
      status: "queued",
      currentStepId: null,
      metadata: {
        abVariantId: "b",
        variables: { nome: "Gabriel" },
      },
    });
    const now = new Date("2026-05-04T12:00:00.000Z");

    const preview = await runCampaignSchedulerTick({
      repos,
      userId: user.id,
      ownerId: "ab-preview",
      now,
      dryRun: true,
    });
    expect(preview.plannedJobs).toEqual([
      expect.objectContaining({
        campaignId: campaign.id,
        recipientId: recipient.id,
        stepId: "step-1",
        phone: "5531982066263",
        scheduledAt: "2026-05-04T12:00:15.000Z",
        variantId: "b",
        variantLabel: "Direta",
      }),
    ]);

    const enqueued = await runCampaignSchedulerTick({
      repos,
      userId: user.id,
      ownerId: "ab-enqueue",
      now,
    });
    const jobs = await repos.jobs.list(user.id, "queued");
    const updated = await repos.campaignRecipients.findById({
      userId: user.id,
      id: recipient.id,
    });

    expect(enqueued.jobsCreated).toBe(1);
    expect(jobs[0]?.payload).toEqual(
      expect.objectContaining({
        variantId: "b",
        variantLabel: "Direta",
        step: expect.objectContaining({
          type: "text",
          id: "step-1",
          template: "Direta {{nome}}",
          delaySeconds: 15,
        }),
      }),
    );
    expect(updated?.metadata).toEqual(
      expect.objectContaining({
        abVariantId: "b",
        abVariantLabel: "Direta",
        awaitingStepId: "step-1",
        awaitingJobId: jobs[0]?.id,
      }),
    );
  });

  it("auto-evaluates evergreen campaigns against contacts and dedupes recipients", async () => {
    const repos = createRepositories(db);
    const user = await repos.users.create({
      email: "campaign-evergreen@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    const tag = await repos.tags.create({
      userId: user.id,
      name: "Evergreen M26",
      color: "#22c55e",
    });
    const eligible = await repos.contacts.create({
      userId: user.id,
      name: "Canario Evergreen",
      phone: "5531982066263",
      primaryChannel: "whatsapp",
      status: "lead",
      tagIds: [tag.id],
    });
    await repos.contacts.create({
      userId: user.id,
      name: "Lead Evergreen 2",
      phone: "553188830002",
      primaryChannel: "whatsapp",
      status: "lead",
      tagIds: [tag.id],
    });
    await repos.contacts.create({
      userId: user.id,
      name: "Lead fora do segmento",
      phone: "553188830003",
      primaryChannel: "whatsapp",
      status: "lead",
      tagIds: [],
    });
    const campaign = await repos.campaigns.create({
      userId: user.id,
      name: "Evergreen",
      channel: "whatsapp",
      status: "running",
      evergreen: true,
      startsAt: null,
      segment: {
        operator: "and",
        conditions: [{ field: "tag", operator: "eq", value: tag.id }],
      },
      steps: [
        {
          id: "step-1",
          label: "Primeiro envio",
          type: "text",
          delaySeconds: 0,
          conditions: [],
          template: "Oi {{nome}}",
        },
      ],
      metadata: {},
    });
    const now = new Date("2026-05-04T12:00:00.000Z");

    const preview = await runCampaignSchedulerTick({
      repos,
      userId: user.id,
      ownerId: "evergreen-preview",
      now,
      limit: 0,
      dryRun: true,
    });
    expect(preview).toMatchObject({
      dryRun: true,
      campaignsScanned: 1,
      evergreenCampaignsScanned: 1,
      evergreenContactsScanned: 3,
      evergreenRecipientsPlanned: 2,
      evergreenRecipientsCreated: 0,
      jobsCreated: 0,
    });
    expect(await repos.campaignRecipients.listByCampaign({ userId: user.id, campaignId: campaign.id })).toHaveLength(0);

    const created = await runCampaignSchedulerTick({
      repos,
      userId: user.id,
      ownerId: "evergreen-create",
      now,
      limit: 0,
    });
    const campaignAfterCreate = await repos.campaigns.findById({
      userId: user.id,
      id: campaign.id,
    });
    const repeated = await runCampaignSchedulerTick({
      repos,
      userId: user.id,
      ownerId: "evergreen-create",
      now,
      limit: 0,
    });
    const recipients = await repos.campaignRecipients.listByCampaign({
      userId: user.id,
      campaignId: campaign.id,
      limit: 10,
    });
    const jobs = await repos.jobs.list(user.id, "queued");

    expect(created.evergreenRecipientsCreated).toBe(2);
    expect(repeated.evergreenRecipientsCreated).toBe(0);
    expect(recipients).toHaveLength(2);
    expect(recipients.find((recipient) => recipient.contactId === eligible.id)?.metadata).toEqual(
      expect.objectContaining({
        source: "campaign_scheduler.evergreen",
        evergreen: true,
        variables: expect.objectContaining({ nome: "Canario Evergreen" }),
      }),
    );
    expect(campaignAfterCreate?.metadata.lastEvergreenEvaluation).toEqual(
      expect.objectContaining({
        contactsScanned: 3,
        recipientsCreated: 2,
      }),
    );
    expect(jobs).toHaveLength(0);
  });
});
