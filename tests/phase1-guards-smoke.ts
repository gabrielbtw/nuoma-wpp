import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";

import { loadEnv } from "../packages/core/src/config/env.js";
import { assertNoV2Schema } from "../packages/core/src/db/connection.js";
import { getDataLakeProviderStatus } from "../packages/core/src/services/data-lake-service.js";
import { openDb } from "../packages/db/src/index.js";

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nuoma-phase1-guards-"));

try {
  await assert.doesNotReject(async () => {
    const handle = openDb(path.join(tempDir, "empty-v2.db"));
    handle.close();
  });

  const legacyDbPath = path.join(tempDir, "legacy.db");
  const legacyRaw = new Database(legacyDbPath);
  legacyRaw.exec(`
    CREATE TABLE _migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
    CREATE TABLE contacts (id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL);
  `);
  legacyRaw.close();

  assert.throws(() => openDb(legacyDbPath), /NUOMA_DB_STACK_MISMATCH.*DATABASE_URL/s);

  const v2DbPath = path.join(tempDir, "v2.db");
  const v2Raw = new Database(v2DbPath);
  v2Raw.exec(`
    CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL, created_at INTEGER);
    CREATE TABLE contacts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, name TEXT NOT NULL);
  `);
  assert.throws(() => assertNoV2Schema(v2Raw, v2DbPath), /NUOMA_DB_STACK_MISMATCH.*DATABASE_PATH/s);
  v2Raw.close();

  const env = loadEnv({ AI_PROVIDER: "none", AI_COST_APPROVED: "" });
  assert.equal(env.AI_PROVIDER, "none");
  assert.equal(env.AI_COST_APPROVED, "");

  const blockedOpenAiEnv = loadEnv({
    AI_PROVIDER: "openai",
    AI_COST_APPROVED: "",
    OPENAI_API_KEY: "fake-key",
  });
  const blockedOpenAiStatus = getDataLakeProviderStatus(blockedOpenAiEnv);
  assert.equal(blockedOpenAiStatus.openAiApproved, false);
  assert.equal(blockedOpenAiStatus.openAiAvailable, false);
  assert.equal(blockedOpenAiStatus.audioProvider, "none");
  assert.equal(blockedOpenAiStatus.imageProvider, "none");

  const approvedOpenAiEnv = loadEnv({
    AI_PROVIDER: "openai",
    AI_COST_APPROVED: "SIM",
    OPENAI_API_KEY: "fake-key",
  });
  const approvedOpenAiStatus = getDataLakeProviderStatus(approvedOpenAiEnv);
  assert.equal(approvedOpenAiStatus.openAiApproved, true);
  assert.equal(approvedOpenAiStatus.openAiAvailable, true);
  assert.equal(approvedOpenAiStatus.audioProvider, "openai");
  assert.equal(approvedOpenAiStatus.imageProvider, "openai");

  const soraScript = readFileSync(path.resolve("scripts/sora/nuoma-explainer-ptbr.sh"), "utf8");
  assert.match(soraScript, /require_env_equals SORA_BUDGET_APPROVED SIM/);

  console.log("phase1-guards-smoke|status=ok");
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}
