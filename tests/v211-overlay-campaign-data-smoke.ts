import * as path from "node:path";

import { CONSTANTS } from "@nuoma/config";
import { createRepositories, openDb } from "@nuoma/db";

import { listOverlayCampaignOptions } from "../apps/api/src/services/overlay-campaigns.js";

const databaseUrl = path.resolve(process.env.DATABASE_URL ?? "data/nuoma-v2.db");
const canaryPhone = "5531982066263";

const handle = openDb(databaseUrl);
try {
  const repos = createRepositories(handle);
  const campaigns = await repos.campaigns.list(CONSTANTS.defaultUserId);
  const normalizedLegacyCampaigns = campaigns.filter((campaign) => {
    const value = campaign.metadata.legacyStepNormalization;
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
  });
  const runnableCampaigns = campaigns.filter(
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
  if (runnableCampaigns.length === 0) {
    throw new Error("overlay campaign data smoke found no runnable non-legacy campaigns");
  }
  if (options.length === 0) {
    throw new Error("overlay campaign data smoke returned no overlay campaign options");
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
      `legacyNormalized=${normalizedLegacyCampaigns.length}`,
      `runnable=${runnableCampaigns.length}`,
      `options=${options.length}`,
      `eligible=${options.filter((option) => option.eligible).length}`,
      "status=ok",
    ].join("|"),
  );
} finally {
  handle.close();
}
