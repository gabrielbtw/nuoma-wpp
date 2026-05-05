import { describe, expect, it } from "vitest";

import { loadApiEnv, loadWorkerEnv } from "./index.js";

describe("loadApiEnv", () => {
  it("keeps CRM storage local by default", () => {
    const env = loadApiEnv({
      NODE_ENV: "test",
    });

    expect(env.API_CRM_STORAGE_PROVIDER).toBe("local");
    expect(env.API_CRM_STORAGE_NAMESPACE).toBe("/nuoma/files/crm");
    expect(env.API_CRM_STORAGE_LOCAL_ROOT).toBeUndefined();
  });

  it("parses explicit S3 CRM storage configuration", () => {
    const env = loadApiEnv({
      NODE_ENV: "test",
      API_CRM_STORAGE_PROVIDER: "s3",
      API_CRM_STORAGE_NAMESPACE: "/nuoma/files/crm",
      API_CRM_STORAGE_S3_BUCKET: "nuoma-crm",
      API_CRM_STORAGE_S3_REGION: "us-east-1",
      API_CRM_STORAGE_S3_ENDPOINT: "https://s3.local.test",
      API_CRM_STORAGE_S3_FORCE_PATH_STYLE: "true",
      API_CRM_STORAGE_S3_ACCESS_KEY_ID: "AKIATEST",
      API_CRM_STORAGE_S3_SECRET_ACCESS_KEY: "secret",
      API_CRM_STORAGE_S3_SESSION_TOKEN: "session",
    });

    expect(env.API_CRM_STORAGE_PROVIDER).toBe("s3");
    expect(env.API_CRM_STORAGE_S3_BUCKET).toBe("nuoma-crm");
    expect(env.API_CRM_STORAGE_S3_FORCE_PATH_STYLE).toBe(true);
    expect(env.API_CRM_STORAGE_S3_SESSION_TOKEN).toBe("session");
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
  });

  it("parses production send policy explicitly", () => {
    const env = loadWorkerEnv({
      NODE_ENV: "test",
      WA_SEND_POLICY_MODE: "production",
      WA_SEND_ALLOWED_PHONES: "5531982066263, 5531999999999",
      WA_SEND_RATE_LIMIT_WINDOW_MS: "30000",
      WA_SEND_RATE_LIMIT_MAX: "3",
    });

    expect(env.WA_SEND_POLICY_MODE).toBe("production");
    expect(env.WA_SEND_ALLOWED_PHONES).toBe("5531982066263, 5531999999999");
    expect(env.WA_SEND_RATE_LIMIT_WINDOW_MS).toBe(30_000);
    expect(env.WA_SEND_RATE_LIMIT_MAX).toBe(3);
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
});
