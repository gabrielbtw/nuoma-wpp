#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = await mkdtemp(path.join(tmpdir(), "nuoma-go-live-preflight-"));
const servers = [];

try {
  const dbPath = path.join(fixtureRoot, "nuoma-v2.db");
  const profileDir = path.join(fixtureRoot, "chromium-profile/whatsapp");
  const envPath = path.join(fixtureRoot, "canary.env");
  const outputPath = path.join(fixtureRoot, "preflight.json");

  await mkdir(profileDir, { recursive: true });
  await writeFile(path.join(profileDir, "profile-marker"), "ok\n", "utf8");
  createMinimalDb(dbPath);
  await writeFile(
    envPath,
    [
      "API_SEND_POLICY_MODE=test",
      "API_SEND_ALLOWED_PHONES=5531982066263",
      "WA_SEND_POLICY_MODE=test",
      "WA_SEND_ALLOWED_PHONES=5531982066263",
      "",
    ].join("\n"),
    "utf8",
  );

  const api = await listenJson({ ok: true });
  const web = await listenText("<!doctype html><title>Nuoma</title>");
  const cdp = await listenJson({ Browser: "Chrome/test" });

  const result = await runCommand(
    process.execPath,
    [
      path.join(repoRoot, "scripts/go-live-canary-preflight.mjs"),
      "--env-file",
      envPath,
      "--canary",
      "5531982066263",
      "--db",
      dbPath,
      "--profile",
      profileDir,
      "--api",
      api.url,
      "--web",
      web.url,
      "--cdp",
      cdp.url,
      "--output",
      outputPath,
    ],
    { cwd: repoRoot },
  );
  assert(result.status === 0, result.stderr || result.stdout);
  const report = JSON.parse(await readFile(outputPath, "utf8"));
  assert(report.status === "ready", "preflight should be ready with valid env-file fixture");
  assert(report.targets.envFiles.length === 1, "preflight report should record the env file used");
  assert(
    report.checks.some((check) => check.check === "api.send_policy" && check.status === "ok"),
    "preflight should validate API send policy from env file",
  );
  assert(
    report.checks.some((check) => check.check === "worker.send_policy" && check.status === "ok"),
    "preflight should validate worker send policy from env file",
  );

  console.log("go-live-canary-preflight-smoke|status=ok");
} finally {
  await Promise.all(servers.map((server) => closeServer(server)));
  await rm(fixtureRoot, { recursive: true, force: true });
}

function createMinimalDb(dbPath) {
  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE jobs (
        id INTEGER PRIMARY KEY,
        type TEXT NOT NULL,
        status TEXT NOT NULL
      );
      CREATE TABLE campaign_recipients (
        id INTEGER PRIMARY KEY,
        status TEXT NOT NULL
      );
    `);
  } finally {
    db.close();
  }
}

async function listenJson(body) {
  return listen((_, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(body));
  });
}

async function listenText(body) {
  return listen((_, response) => {
    response.setHeader("content-type", "text/html");
    response.end(body);
  });
}

async function listen(handler) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  servers.push(server);
  const address = server.address();
  assert(address && typeof address === "object", "server did not expose a TCP address");
  return { server, url: `http://127.0.0.1:${address.port}` };
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

function runCommand(command, args, options) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (status) => {
      resolve({ status, stdout, stderr });
    });
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
