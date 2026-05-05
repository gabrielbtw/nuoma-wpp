import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadApiEnv } from "@nuoma/config";
import { createRepositories, openDb, runMigrations, type DbHandle } from "@nuoma/db";

import { createPushDeliveryService } from "./push-delivery.js";

let tempDir: string;
let handle: DbHandle;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nuoma-v2-push-"));
  handle = openDb(path.join(tempDir, "api.db"));
  await runMigrations(
    handle,
    path.resolve(import.meta.dirname, "../../../../packages/db/src/migrations"),
  );
});

afterEach(async () => {
  handle.close();
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("push delivery", () => {
  it("stays event-only when VAPID is not configured", async () => {
    const repos = createRepositories(handle);
    const user = await repos.users.create({
      email: "push-event-only@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });

    const result = await createPushDeliveryService({
      env: loadApiEnv({
        API_LOG_LEVEL: "silent",
        NODE_ENV: "test",
        API_JWT_SECRET: "test-secret-with-more-than-16-chars",
        DATABASE_URL: handle.url,
      }),
      repos,
    }).sendTestPush(user.id);

    expect(result).toMatchObject({
      configured: false,
      delivered: false,
      attempted: 0,
      mode: "event-only",
      reason: "vapid_not_configured",
    });
  });

  it("sends through web-push when VAPID and subscriptions exist", async () => {
    const repos = createRepositories(handle);
    const user = await repos.users.create({
      email: "push-real@nuoma.local",
      passwordHash: "hash",
      role: "admin",
    });
    await repos.pushSubscriptions.upsert({
      userId: user.id,
      endpoint: "https://push.example.test/subscription/1",
      p256dh: "p256dh-key",
      auth: "auth-key",
      userAgent: "vitest",
    });

    const calls: unknown[] = [];
    const result = await createPushDeliveryService({
      env: loadApiEnv({
        API_LOG_LEVEL: "silent",
        NODE_ENV: "test",
        API_JWT_SECRET: "test-secret-with-more-than-16-chars",
        API_WEB_PUSH_VAPID_PUBLIC_KEY: "public-key",
        API_WEB_PUSH_VAPID_PRIVATE_KEY: "private-key",
        API_WEB_PUSH_VAPID_SUBJECT: "mailto:test@nuoma.local",
        DATABASE_URL: handle.url,
      }),
      repos,
      sender: async (...args) => {
        calls.push(args);
        return { statusCode: 201, body: "", headers: {} };
      },
    }).sendTestPush(user.id);

    expect(result).toMatchObject({
      configured: true,
      delivered: true,
      attempted: 1,
      failed: 0,
      mode: "web-push",
    });
    expect(calls).toHaveLength(1);
  });
});
