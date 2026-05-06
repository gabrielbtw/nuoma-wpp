import { describe, expect, it } from "vitest";

import type { ApiEnv } from "@nuoma/config";

import {
  evaluateApiRealSendTarget,
  normalizeClientAllowedPhoneOverride,
  resolveApiSendPolicy,
} from "./send-policy.js";

const baseEnv: ApiEnv = {
  NODE_ENV: "test",
  TZ: "America/Sao_Paulo",
  API_HOST: "127.0.0.1",
  API_PORT: 3001,
  API_LOG_LEVEL: "silent",
  API_JWT_SECRET: "dev-only-change-me-local",
  API_JWT_TTL_SECONDS: 604800,
  API_REFRESH_TTL_SECONDS: 2592000,
  API_CAMPAIGN_SCHEDULER_ENABLED: false,
  API_CAMPAIGN_SCHEDULER_INTERVAL_MS: 30000,
  API_CAMPAIGN_SCHEDULER_USER_ID: 1,
  API_SEND_POLICY_MODE: "test",
  API_SEND_ALLOWED_PHONES: "",
  API_AUTOMATION_ENGINE_ENABLED: false,
  API_AUTOMATION_ENGINE_INTERVAL_MS: 5000,
  API_AUTOMATION_ENGINE_USER_ID: 1,
  API_AUTOMATION_ENGINE_ALLOWED_PHONE: "5531982066263",
  API_WEB_PUSH_VAPID_SUBJECT: "mailto:admin@nuoma.local",
  API_CRM_STORAGE_PROVIDER: "local",
  API_CRM_STORAGE_NAMESPACE: "/nuoma/files/crm",
  API_CRM_STORAGE_S3_REGION: "us-east-1",
  API_CRM_STORAGE_S3_FORCE_PATH_STYLE: false,
  API_STREAMING_ENABLED: false,
  API_STREAMING_CDP_HOST: "127.0.0.1",
  API_STREAMING_CDP_PORT: 9223,
  API_STREAMING_TARGET_URL_MATCH: "web.whatsapp.com",
  API_STREAMING_TIMEOUT_MS: 5000,
  DATABASE_URL: "../../data/nuoma-v2.db",
};

describe("api send policy", () => {
  it("falls back to the canonical test phone in test mode", () => {
    const policy = resolveApiSendPolicy(baseEnv);

    expect(evaluateApiRealSendTarget(policy, "5531982066263")).toEqual({ allowed: true });
    expect(evaluateApiRealSendTarget(policy, "5531999999999")).toEqual({
      allowed: false,
      reason: "not_allowlisted_for_test_execution",
    });
  });

  it("allows production mode without a canary allowlist", () => {
    const policy = resolveApiSendPolicy({
      ...baseEnv,
      API_SEND_POLICY_MODE: "production",
    });

    expect(evaluateApiRealSendTarget(policy, "5531999999999")).toEqual({ allowed: true });
  });

  it("uses allowed phones as a production canary when configured", () => {
    const policy = resolveApiSendPolicy({
      ...baseEnv,
      API_SEND_POLICY_MODE: "production",
      API_SEND_ALLOWED_PHONES: "5531982066263",
    });

    expect(evaluateApiRealSendTarget(policy, "5531999999999")).toEqual({
      allowed: false,
      reason: "not_in_production_canary_allowlist",
    });
  });

  it("keeps client-side allowedPhone override pinned to the canonical test phone", () => {
    expect(normalizeClientAllowedPhoneOverride("+55 (31) 98206-6263")).toBe("5531982066263");
    expect(normalizeClientAllowedPhoneOverride("5531999999999")).toBeUndefined();
  });
});
