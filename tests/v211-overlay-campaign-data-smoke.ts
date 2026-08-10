import * as path from "node:path";

import { CONSTANTS } from "@nuoma/config";
import { createRepositories, openDb } from "@nuoma/db";

import { listOverlayCampaignOptions } from "../apps/api/src/services/overlay-campaigns.js";
import { isOverlayEnabled } from "../apps/api/src/services/overlay-eligibility.js";

const databaseUrl = path.resolve(process.env.DATABASE_URL ?? "data/nuoma-v2.db");
const canaryPhone = "5531982066263";
const temporaryMessages = {
  enabled: true,
  beforeSendDuration: "24h",
  afterCompletionDuration: "90d",
  restoreOnFailure: true,
};

const handle = openDb(databaseUrl);
try {
  const repos = createRepositories(handle);
  const seeded = await ensureOverlayCampaignDataFixture(repos);
  const campaigns = await repos.campaigns.list(CONSTANTS.defaultUserId);
  const normalizedLegacyCampaigns = campaigns.filter((campaign) => {
    const value = campaign.metadata.legacyStepNormalization;
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
  });
  const overlayEnabledCampaigns = campaigns.filter((campaign) =>
    isOverlayEnabled(campaign.metadata),
  );
  const runnableCampaigns = overlayEnabledCampaigns.filter(
    (campaign) =>
      campaign.channel === "whatsapp" &&
      (campaign.status === "running" || campaign.status === "scheduled") &&
      !campaign.metadata.legacyStepNormalization,
  );
  const options = await listOverlayCampaignOptions({
    repos,
    userId: CONSTANTS.defaultUserId,
    phone: canaryPhone,
    sendPolicy: { mode: "test", allowedPhones: [canaryPhone] },
    limit: 8,
  });

  if (campaigns.length === 0) {
    throw new Error("overlay campaign data smoke found no campaigns in local database");
  }
  if (normalizedLegacyCampaigns.length === 0) {
    throw new Error("overlay campaign data smoke did not exercise legacy normalization");
  }
  if (overlayEnabledCampaigns.length === 0) {
    console.log(
      [
        "v211-overlay-campaign-data",
        `db=${databaseUrl}`,
        `campaigns=${campaigns.length}`,
        "overlayEnabled=0",
        "status=skipped",
      ].join("|"),
    );
  } else {
    if (runnableCampaigns.length === 0) {
      throw new Error("overlay campaign data smoke found no runnable overlay-enabled campaigns");
    }
    if (options.length === 0) {
      throw new Error("overlay campaign data smoke returned no overlay campaign options");
    }
    const overlayEnabledIds = new Set(overlayEnabledCampaigns.map((campaign) => campaign.id));
    const disabledOptionLeak = options.find((option) => !overlayEnabledIds.has(option.id));
    if (disabledOptionLeak) {
      throw new Error(`overlay disabled campaign leaked into options: ${disabledOptionLeak.id}`);
    }
    const legacyOptionLeak = options.find((option) =>
      option.reasons.includes("legacy_campaign_steps_need_review"),
    );
    if (legacyOptionLeak?.eligible) {
      throw new Error(`legacy campaign became eligible in overlay: ${legacyOptionLeak.id}`);
    }

    console.log(
      [
        "v211-overlay-campaign-data",
        `db=${databaseUrl}`,
        `campaigns=${campaigns.length}`,
        `overlayEnabled=${overlayEnabledCampaigns.length}`,
        `legacyNormalized=${normalizedLegacyCampaigns.length}`,
        `runnable=${runnableCampaigns.length}`,
        `options=${options.length}`,
        `eligible=${options.filter((option) => option.eligible).length}`,
        `seeded=${seeded.join(",") || "none"}`,
        "status=ok",
      ].join("|"),
    );
  }
} finally {
  handle.close();
}

async function ensureOverlayCampaignDataFixture(repos: ReturnType<typeof createRepositories>) {
  const seeded: string[] = [];
  const campaigns = await repos.campaigns.list(CONSTANTS.defaultUserId);
  const hasLegacyNormalization = campaigns.some((campaign) => {
    const value = campaign.metadata.legacyStepNormalization;
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
  });
  const hasRunnableOverlay = campaigns.some(
    (campaign) =>
      isOverlayEnabled(campaign.metadata) &&
      campaign.channel === "whatsapp" &&
      (campaign.status === "running" || campaign.status === "scheduled") &&
      !campaign.metadata.legacyStepNormalization,
  );

  if (!hasLegacyNormalization) {
    await repos.campaigns.create({
      userId: CONSTANTS.defaultUserId,
      name: "V2.11 Overlay Smoke Legacy Normalization",
      channel: "whatsapp",
      status: "draft",
      evergreen: false,
      startsAt: null,
      completedAt: null,
      segment: null,
      steps: [
        {
          id: "legacy-text",
          label: "Texto legado",
          type: "text",
          delaySeconds: 0,
          conditions: [],
          template: "Fixture legada para validar bloqueio do overlay.",
        },
      ],
      metadata: {
        overlayEnabled: true,
        temporaryMessages,
        legacyStepNormalization: {
          reason: "smoke_fixture",
          at: new Date().toISOString(),
        },
      },
    });
    seeded.push("legacy-normalization");
  }

  if (!hasRunnableOverlay) {
    await repos.campaigns.create({
      userId: CONSTANTS.defaultUserId,
      name: "V2.11 Overlay Smoke Runnable",
      channel: "whatsapp",
      status: "running",
      evergreen: false,
      startsAt: new Date().toISOString(),
      completedAt: null,
      segment: null,
      steps: [
        {
          id: "overlay-text",
          label: "Mensagem overlay",
          type: "text",
          delaySeconds: 0,
          conditions: [],
          template: "Fixture segura do overlay. Nao disparar nesta validacao.",
        },
      ],
      metadata: {
        overlayEnabled: true,
        temporaryMessages,
        source: "v211-overlay-campaign-data-smoke",
      },
    });
    seeded.push("overlay-runnable");
  }

  return seeded;
}
