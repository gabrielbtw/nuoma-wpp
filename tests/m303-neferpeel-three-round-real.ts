import { setTimeout as sleep } from "node:timers/promises";
import path from "node:path";

import { normalizePhone } from "@nuoma/contracts";
import {
  createRepositories,
  openDb,
  runMigrations,
  type DbHandle,
  type Repositories,
} from "@nuoma/db";

import { runCampaignSchedulerTick } from "../apps/api/src/services/campaign-scheduler.js";

const databaseUrl = path.resolve(process.env.DATABASE_URL ?? "data/nuoma-v2.db");
const userId = Number(process.env.M303_USER_ID ?? 1);
const rounds = Number(process.env.M303_EXPECTED_ROUNDS ?? 3);
const phone = normalizePhone(process.env.M303_PHONE ?? process.env.SMOKE_PHONE ?? "31982066263");
const sourceCampaignId = optionalPositiveInteger(process.env.M303_SOURCE_CAMPAIGN_ID);
const roundTimeoutMs = Number(process.env.M303_ROUND_TIMEOUT_MS ?? 180_000);
const pollMs = Number(process.env.M303_POLL_MS ?? 2_000);
const token = process.env.M303_RUN_TOKEN ?? `m303-neferpeel-${Date.now()}`;

type CampaignStepJobRow = {
  id: number;
  status: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  completedAt: string | null;
  stepId: string | null;
};

type RecipientRow = {
  id: number;
  status: string;
  lastError: string | null;
};

async function main() {
  if (process.env.M303_CONFIRM_NEFERPEEL_REAL !== "SIM") {
    throw new Error(
      "Set M303_CONFIRM_NEFERPEEL_REAL=SIM to create and run real WhatsApp campaigns",
    );
  }
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error("M303_USER_ID must be a positive integer");
  }
  if (!Number.isInteger(rounds) || rounds <= 0) {
    throw new Error("M303_EXPECTED_ROUNDS must be a positive integer");
  }
  if (!phone) {
    throw new Error("M303_PHONE/SMOKE_PHONE must be a valid BR phone");
  }

  const handle = openDb(databaseUrl);
  try {
    await runMigrations(handle);
    const repos = createRepositories(handle);
    const source = sourceCampaignId
      ? await repos.campaigns.findById({ userId, id: sourceCampaignId })
      : await findLatestNeferpeelSource(handle, repos, userId);
    if (!source) {
      throw new Error("No Neferpeel BH source campaign found");
    }
    if (!isNeferpeelBhName(source.name)) {
      throw new Error(`Source campaign is not Neferpeel BH: ${source.id}:${source.name}`);
    }
    if (source.steps.length === 0) {
      throw new Error(`Source campaign has no steps: ${source.id}:${source.name}`);
    }

    const active = await repos.campaignRecipients.findActiveByPhone({
      userId,
      phone,
      channel: "whatsapp",
    });
    if (active) {
      throw new Error(`Target phone already has active campaign recipient: ${active.id}`);
    }

    const contact = await repos.contacts.findByPhone({ userId, phone });
    const campaignIds: number[] = [];
    for (let index = 0; index < rounds; index += 1) {
      const round = index + 1;
      const now = new Date();
      const campaign = await repos.campaigns.create({
        userId,
        name: `Neferpeel BH - M303 24h90d ${token} round ${round}`,
        status: "running",
        channel: "whatsapp",
        segment: null,
        steps: source.steps,
        evergreen: false,
        startsAt: now.toISOString(),
        completedAt: null,
        metadata: {
          m303: true,
          token,
          round,
          sourceCampaignId: source.id,
          sourceCampaignName: source.name,
          temporaryMessages: {
            enabled: true,
            beforeSendDuration: "24h",
            afterCompletionDuration: "90d",
            restoreOnFailure: true,
          },
        },
      });
      const recipient = await repos.campaignRecipients.create({
        userId,
        campaignId: campaign.id,
        contactId: contact?.id ?? null,
        phone,
        channel: "whatsapp",
        status: "queued",
        currentStepId: null,
        lastError: null,
        metadata: {
          source: "m303-neferpeel-three-round-real",
          token,
          round,
          variables: {
            nome: contact?.name ?? "Gabriel",
            name: contact?.name ?? "Gabriel",
            telefone: phone,
            phone,
          },
        },
      });
      const scheduler = await runCampaignSchedulerTick({
        repos,
        userId,
        ownerId: `m303:${token}:round:${round}`,
        campaignId: campaign.id,
        limit: 1,
        dryRun: false,
      });
      if (scheduler.jobsCreated <= 0) {
        throw new Error(
          `Round ${round} did not enqueue campaign_step jobs: ${JSON.stringify(scheduler)}`,
        );
      }
      console.log(
        `m303-neferpeel-three-round|round=${round}|campaign=${campaign.id}|recipient=${recipient.id}|jobsCreated=${scheduler.jobsCreated}|phone=${phone}|status=enqueued`,
      );
      await waitForCampaignRound(handle, campaign.id, recipient.id, round);
      campaignIds.push(campaign.id);
    }

    console.log(
      [
        "m303-neferpeel-three-round",
        "status=completed",
        `phone=${phone}`,
        `rounds=${rounds}`,
        `campaignIds=${campaignIds.join(",")}`,
        `token=${token}`,
      ].join("|"),
    );
  } finally {
    handle.close();
  }
}

async function findLatestNeferpeelSource(
  handle: DbHandle,
  repos: Repositories,
  inputUserId: number,
) {
  const rows = handle.raw
    .prepare(
      `SELECT id
       FROM campaigns
       WHERE user_id = ?
         AND lower(name) LIKE '%neferpeel%'
         AND lower(name) LIKE '%bh%'
       ORDER BY id DESC
       LIMIT 20`,
    )
    .all(inputUserId) as Array<{ id: number }>;
  for (const row of rows) {
    const campaign = await repos.campaigns.findById({
      userId: inputUserId,
      id: row.id,
    });
    if (campaign) {
      return campaign;
    }
  }
  return null;
}

async function waitForCampaignRound(
  handle: DbHandle,
  campaignId: number,
  recipientId: number,
  round: number,
) {
  const deadline = Date.now() + roundTimeoutMs;
  while (Date.now() < deadline) {
    const jobs = readCampaignStepJobs(handle, campaignId);
    const recipient = readRecipient(handle, recipientId);
    const failed = jobs.filter((job) => job.status === "failed" || job.status === "cancelled");
    const retried = jobs.filter((job) => job.attempts > 1 || job.maxAttempts !== 1);
    if (failed.length > 0) {
      throw new Error(
        `Round ${round} failed campaign_step job(s): ${failed
          .map((job) => `${job.id}:${job.stepId}:${job.status}:${job.lastError ?? "no_error"}`)
          .join(", ")}`,
      );
    }
    if (retried.length > 0) {
      throw new Error(
        `Round ${round} retried/configured retry job(s): ${retried
          .map((job) => `${job.id}:${job.stepId}:attempts=${job.attempts}:max=${job.maxAttempts}`)
          .join(", ")}`,
      );
    }
    if (recipient?.status === "failed" || recipient?.status === "skipped") {
      throw new Error(
        `Round ${round} recipient ${recipient.id} is ${recipient.status}: ${recipient.lastError ?? "no_error"}`,
      );
    }
    if (
      jobs.length > 0 &&
      jobs.every((job) => job.status === "completed") &&
      recipient?.status === "completed"
    ) {
      console.log(
        `m303-neferpeel-three-round|round=${round}|campaign=${campaignId}|jobs=${jobs.length}|status=completed`,
      );
      return;
    }
    await sleep(pollMs);
  }
  const jobs = readCampaignStepJobs(handle, campaignId);
  throw new Error(
    `Round ${round} timed out after ${roundTimeoutMs}ms: ${jobs
      .map((job) => `${job.id}:${job.stepId}:${job.status}:attempts=${job.attempts}`)
      .join(", ")}`,
  );
}

function readCampaignStepJobs(handle: DbHandle, campaignId: number): CampaignStepJobRow[] {
  return handle.raw
    .prepare(
      `SELECT id, status, attempts, max_attempts AS maxAttempts, last_error AS lastError,
              completed_at AS completedAt, json_extract(payload_json, '$.step.id') AS stepId
       FROM jobs
       WHERE user_id = ?
         AND type = 'campaign_step'
         AND cast(json_extract(payload_json, '$.campaignId') as integer) = ?
         AND json_extract(payload_json, '$.phone') = ?
       ORDER BY id ASC`,
    )
    .all(userId, campaignId, phone) as CampaignStepJobRow[];
}

function readRecipient(handle: DbHandle, recipientId: number): RecipientRow | null {
  return (
    (handle.raw
      .prepare(
        `SELECT id, status, last_error AS lastError
         FROM campaign_recipients
         WHERE user_id = ?
           AND id = ?`,
      )
      .get(userId, recipientId) as RecipientRow | undefined) ?? null
  );
}

function optionalPositiveInteger(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function isNeferpeelBhName(value: string): boolean {
  const normalized = value.toLocaleLowerCase("pt-BR");
  return normalized.includes("neferpeel") && normalized.includes("bh");
}

main().catch((error) => {
  console.error(`m303-neferpeel-three-round|status=failed|error=${error.message}`);
  process.exitCode = 1;
});
