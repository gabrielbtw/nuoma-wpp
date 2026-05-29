import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import argon2 from "argon2";

import { loadApiEnv } from "@nuoma/config";
import { createRepositories, openDb, runMigrations } from "@nuoma/db";

import { buildApiApp } from "../apps/api/src/app.js";

async function main() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nuoma-v216-ig-sync-"));
  const dbPath = path.join(tempDir, "api.db");
  const db = openDb(dbPath);
  await runMigrations(db);
  const repos = createRepositories(db);
  try {
    await repos.users.create({
      email: "admin@nuoma.local",
      passwordHash: await argon2.hash("initial-password-123", { type: argon2.argon2id }),
      role: "admin",
      displayName: "Admin",
    });
    await repos.workerState.heartbeat({
      workerId: "worker-smoke",
      status: "idle",
      browserConnected: true,
      metrics: {
        instagram: {
          connected: true,
          lastSyncAt: "2026-05-29T00:00:00.000Z",
          session: {
            mode: "shared-cdp",
            status: "connected",
            authenticated: true,
            username: "gabriell_braga",
            pageUrl: "https://www.instagram.com/direct/inbox/",
            browserEndpoint: "http://127.0.0.1:9223",
            lastCheckedAt: "2026-05-29T00:00:00.000Z",
            lastSyncAt: "2026-05-29T00:00:00.000Z",
            threadCount: 1,
            messageCount: 2,
            errorMessage: null,
          },
        },
      },
    });
    const app = await buildApiApp({
      env: loadApiEnv({
        NODE_ENV: "test",
        API_LOG_LEVEL: "silent",
        API_JWT_SECRET: "test-secret-with-more-than-16-chars",
        DATABASE_URL: dbPath,
      }),
      db,
      migrate: false,
    });
    try {
      const session = await app.inject({ method: "GET", url: "/instagram/session" });
      if (session.statusCode !== 200 || session.json().username !== "gabriell_braga") {
        throw new Error(`unexpected Instagram session response: ${session.statusCode} ${session.body}`);
      }
      const sync = await app.inject({
        method: "POST",
        url: "/instagram/sync",
        payload: { threadLimit: 2, messagesLimit: 5, scrollPasses: 1 },
      });
      const syncBody = sync.json();
      if (
        sync.statusCode !== 200 ||
        !syncBody.queued ||
        syncBody.job?.type !== "sync_inbox_force" ||
        syncBody.job?.payload?.channel !== "instagram"
      ) {
        throw new Error(`unexpected Instagram sync response: ${sync.statusCode} ${sync.body}`);
      }
      console.log(
        `v216-instagram-sync|session=${session.json().status}|username=${session.json().username}|job=${syncBody.job.id}|threadLimit=${syncBody.job.payload.threadLimit}`,
      );
    } finally {
      await app.close();
    }
  } finally {
    db.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

await main();
