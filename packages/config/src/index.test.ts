import { describe, expect, it } from "vitest";

import { LOG_REDACT_PATHS, loadApiEnv, loadWorkerEnv } from "./index.js";

describe("loadApiEnv", () => {
  it("keeps CRM storage local by default", () => {
    const env = loadApiEnv({
      NODE_ENV: "test",
    });

    expect(env.API_CRM_STORAGE_PROVIDER).toBe("local");
    expect(env.API_CRM_STORAGE_NAMESPACE).toBe("/nuoma/files/crm");
    expect(env.API_CRM_STORAGE_LOCAL_ROOT).toBeUndefined();
    expect(env.API_CRM_STORAGE_CACHE_ROOT).toBeUndefined();
    expect(env.API_STREAMING_ENABLED).toBe(false);
    expect(env.API_STREAMING_CDP_HOST).toBe("127.0.0.1");
    expect(env.API_STREAMING_CDP_PORT).toBe(9223);
    expect(env.API_STREAMING_TARGET_URL_MATCH).toBe("web.whatsapp.com");
  });

  it("parses explicit S3 CRM storage configuration", () => {
    const env = loadApiEnv({
      NODE_ENV: "test",
      API_CRM_STORAGE_PROVIDER: "s3",
      API_CRM_STORAGE_NAMESPACE: "/nuoma/files/crm",
      API_CRM_STORAGE_S3_BUCKET: "nuoma-crm",
      API_CRM_STORAGE_S3_REGION: "us-east-1",
      API_CRM_STORAGE_S3_ENDPOINT: "https://s3.local.test",
      API_CRM_STORAGE_CACHE_ROOT: "../../data/crm-cache",
      API_CRM_STORAGE_S3_FORCE_PATH_STYLE: "true",
      API_CRM_STORAGE_S3_ACCESS_KEY_ID: "AKIATEST",
      API_CRM_STORAGE_S3_SECRET_ACCESS_KEY: "secret",
      API_CRM_STORAGE_S3_SESSION_TOKEN: "session",
    });

    expect(env.API_CRM_STORAGE_PROVIDER).toBe("s3");
    expect(env.API_CRM_STORAGE_S3_BUCKET).toBe("nuoma-crm");
    expect(env.API_CRM_STORAGE_CACHE_ROOT).toBe("../../data/crm-cache");
    expect(env.API_CRM_STORAGE_S3_FORCE_PATH_STYLE).toBe(true);
    expect(env.API_CRM_STORAGE_S3_SESSION_TOKEN).toBe("session");
  });

  it("parses API streaming CDP configuration explicitly", () => {
    const env = loadApiEnv({
      NODE_ENV: "test",
      API_STREAMING_ENABLED: "true",
      API_STREAMING_CDP_HOST: "127.0.0.2",
      API_STREAMING_CDP_PORT: "9333",
      API_STREAMING_TARGET_URL_MATCH: "example.test",
      API_STREAMING_TIMEOUT_MS: "1500",
    });

    expect(env.API_STREAMING_ENABLED).toBe(true);
    expect(env.API_STREAMING_CDP_HOST).toBe("127.0.0.2");
    expect(env.API_STREAMING_CDP_PORT).toBe(9333);
    expect(env.API_STREAMING_TARGET_URL_MATCH).toBe("example.test");
    expect(env.API_STREAMING_TIMEOUT_MS).toBe(1500);
  });
});

describe("LOG_REDACT_PATHS", () => {
  it("covers common PII and token spellings", () => {
    expect(LOG_REDACT_PATHS).toContain("*.phone");
    expect(LOG_REDACT_PATHS).toContain("*.email");
    expect(LOG_REDACT_PATHS).toContain("*.accessToken");
    expect(LOG_REDACT_PATHS).toContain("*.access_token");
    expect(LOG_REDACT_PATHS).toContain("*.secret");
    expect(LOG_REDACT_PATHS).toContain("req.headers.cookie");
  });
});

describe("loadWorkerEnv", () => {
  it("keeps open-chat send reuse disabled by default", () => {
    const env = loadWorkerEnv({
      NODE_ENV: "test",
    });

    expect(env.WORKER_SEND_REUSE_OPEN_CHAT_ENABLED).toBe(false);
  });

  it("allows open-chat send reuse only when explicitly enabled", () => {
    const env = loadWorkerEnv({
      NODE_ENV: "test",
      WORKER_SEND_REUSE_OPEN_CHAT_ENABLED: "true",
    });

    expect(env.WORKER_SEND_REUSE_OPEN_CHAT_ENABLED).toBe(true);
  });

  it("keeps real WhatsApp sends in test policy by default", () => {
    const env = loadWorkerEnv({
      NODE_ENV: "test",
    });

    expect(env.WA_SEND_POLICY_MODE).toBe("test");
    expect(env.WA_SEND_ALLOWED_PHONES).toBe("");
    expect(env.WA_SEND_RATE_LIMIT_WINDOW_MS).toBe(60_000);
    expect(env.WA_SEND_RATE_LIMIT_MAX).toBe(12);
    expect(env.IG_SEND_RATE_LIMIT_WINDOW_MS).toBe(60 * 60_000);
    expect(env.IG_SEND_RATE_LIMIT_MAX).toBe(30);
    expect(env.WORKER_SEND_CONFIRMATION_TIMEOUT_MS).toBe(15_000);
    expect(env.WORKER_SEND_STRICT_DELIVERY).toBe(true);
    expect(env.WORKER_IDEMPOTENCY_GUARD_ENABLED).toBe(true);
    expect(env.WORKER_STALE_CLAIM_TIMEOUT_MS).toBe(10 * 60_000);
    expect(env.WORKER_INSTAGRAM_SYNC_ENABLED).toBe(false);
    expect(env.WORKER_INSTAGRAM_SYNC_INTERVAL_MS).toBe(60_000);
    expect(env.WORKER_INSTAGRAM_SYNC_THREAD_LIMIT).toBe(5);
    expect(env.WORKER_INSTAGRAM_SYNC_MESSAGE_LIMIT).toBe(20);
    expect(env.WORKER_INSTAGRAM_SYNC_SCROLL_PASSES).toBe(6);
    expect(env.IG_WEB_URL).toBe("https://www.instagram.com/direct/inbox/");
  });

  it("parses production send policy explicitly", () => {
    const env = loadWorkerEnv({
      NODE_ENV: "test",
      WA_SEND_POLICY_MODE: "production",
      WA_SEND_ALLOWED_PHONES: "5531982066263, 5531999999999",
      WA_SEND_RATE_LIMIT_WINDOW_MS: "30000",
      WA_SEND_RATE_LIMIT_MAX: "3",
      IG_SEND_RATE_LIMIT_WINDOW_MS: "120000",
      IG_SEND_RATE_LIMIT_MAX: "2",
      WORKER_SEND_CONFIRMATION_TIMEOUT_MS: "5000",
      WORKER_SEND_STRICT_DELIVERY: "false",
      WORKER_IDEMPOTENCY_GUARD_ENABLED: "false",
      WORKER_STALE_CLAIM_TIMEOUT_MS: "120000",
    });

    expect(env.WA_SEND_POLICY_MODE).toBe("production");
    expect(env.WA_SEND_ALLOWED_PHONES).toBe("5531982066263, 5531999999999");
    expect(env.WA_SEND_RATE_LIMIT_WINDOW_MS).toBe(30_000);
    expect(env.WA_SEND_RATE_LIMIT_MAX).toBe(3);
    expect(env.IG_SEND_RATE_LIMIT_WINDOW_MS).toBe(120_000);
    expect(env.IG_SEND_RATE_LIMIT_MAX).toBe(2);
    expect(env.WORKER_SEND_CONFIRMATION_TIMEOUT_MS).toBe(5_000);
    expect(env.WORKER_SEND_STRICT_DELIVERY).toBe(false);
    expect(env.WORKER_IDEMPOTENCY_GUARD_ENABLED).toBe(false);
    expect(env.WORKER_STALE_CLAIM_TIMEOUT_MS).toBe(120_000);
  });

  it("allows hosted CDP bind host to differ from the local connect host", () => {
    const env = loadWorkerEnv({
      NODE_ENV: "test",
      CHROMIUM_CDP_HOST: "127.0.0.1",
      CHROMIUM_CDP_BIND_HOST: "0.0.0.0",
    });

    expect(env.CHROMIUM_CDP_HOST).toBe("127.0.0.1");
    expect(env.CHROMIUM_CDP_BIND_HOST).toBe("0.0.0.0");
  });

  it("parses Instagram sync runtime settings explicitly", () => {
    const env = loadWorkerEnv({
      NODE_ENV: "test",
      WORKER_INSTAGRAM_SYNC_ENABLED: "true",
      WORKER_INSTAGRAM_SYNC_INTERVAL_MS: "30000",
      WORKER_INSTAGRAM_SYNC_THREAD_LIMIT: "12",
      WORKER_INSTAGRAM_SYNC_MESSAGE_LIMIT: "40",
      WORKER_INSTAGRAM_SYNC_SCROLL_PASSES: "9",
      IG_WEB_URL: "https://www.instagram.com/direct/inbox/",
    });

    expect(env.WORKER_INSTAGRAM_SYNC_ENABLED).toBe(true);
    expect(env.WORKER_INSTAGRAM_SYNC_INTERVAL_MS).toBe(30_000);
    expect(env.WORKER_INSTAGRAM_SYNC_THREAD_LIMIT).toBe(12);
    expect(env.WORKER_INSTAGRAM_SYNC_MESSAGE_LIMIT).toBe(40);
    expect(env.WORKER_INSTAGRAM_SYNC_SCROLL_PASSES).toBe(9);
  });
});
