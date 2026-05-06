#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import Database from "better-sqlite3";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const workerDir = path.join(rootDir, "apps", "worker");
const logPath = path.join(rootDir, "data", "worker-screen.log");
const screenName = "nuoma-wpp-v2-worker-sync-jobs";

const workerEnv = {
  NODE_ENV: "development",
  TZ: "America/Sao_Paulo",
  DATABASE_URL: "../../data/nuoma-v2.db",
  WORKER_ID: "worker-local-1",
  WORKER_BROWSER_ENABLED: "true",
  WORKER_BROWSER_ATTACH_EXISTING: "true",
  WORKER_KEEP_BROWSER_OPEN: "true",
  WORKER_SYNC_ENABLED: "true",
  WORKER_SYNC_RECONCILE_MS: "60000",
  WORKER_JOB_LOOP_ENABLED: "true",
  WORKER_SEND_REUSE_OPEN_CHAT_ENABLED: "true",
  WORKER_SEND_CONFIRMATION_TIMEOUT_MS: "5000",
  WORKER_SEND_STRICT_DELIVERY: "false",
  WORKER_POLL_MS: "1000",
  WORKER_HEARTBEAT_SEC: "5",
  WORKER_TEMP_DIR: "../../data/tmp",
  CHROMIUM_PROFILE_DIR: "../../data/chromium-profile/whatsapp",
  CHROMIUM_CDP_HOST: "127.0.0.1",
  CHROMIUM_CDP_PORT: "9223",
  WA_SEND_ALLOWED_PHONE: process.env.WA_SEND_ALLOWED_PHONE ?? "5531982066263",
};

const databasePath = path.resolve(workerDir, workerEnv.DATABASE_URL);

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: rootDir,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
    env: process.env,
  });
}

function screenSessions() {
  const result = run("screen", ["-ls"]);
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  return output
    .split("\n")
    .map((line) => line.trim().match(/^(\d+\.[^\s]+)/)?.[1])
    .filter(Boolean);
}

function workerScreenSessions() {
  return screenSessions().filter((session) => session.includes(screenName));
}

function processRows() {
  const result = run("ps", ["-axo", "pid=,command="]);
  if (result.status !== 0) {
    return [];
  }
  return (result.stdout ?? "")
    .split("\n")
    .map((line) => {
      const match = line.trim().match(/^(\d+)\s+(.+)$/);
      return match ? { pid: Number(match[1]), command: match[2] } : null;
    })
    .filter(Boolean);
}

function processCwd(pid) {
  try {
    const output = execFileSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output
      .split("\n")
      .find((line) => line.startsWith("n"))
      ?.slice(1);
  } catch {
    return null;
  }
}

function workerProcesses() {
  const rootNeedle = rootDir.replaceAll("\\", "/");
  return processRows().filter(({ pid, command }) => {
    if (pid === process.pid) {
      return false;
    }
    const normalized = command.replaceAll("\\", "/");
    const cwd = normalized.includes("src/index.ts") ? processCwd(pid) : null;
    return (
      normalized.includes(`${rootNeedle}/apps/worker`) ||
      cwd === workerDir ||
      normalized.includes("WORKER_ID=worker-local-1") ||
      normalized.includes("CHROMIUM_PROFILE_DIR=../../data/chromium-profile/whatsapp") ||
      normalized.includes("--user-data-dir=../../data/chromium-profile/whatsapp")
    );
  });
}

function killPid(pid, signal) {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

function isBrowserProcess(row) {
  return row.command.includes("--user-data-dir=../../data/chromium-profile/whatsapp");
}

function stopWorkers({ quiet = false, keepBrowser = false } = {}) {
  for (const session of workerScreenSessions()) {
    run("screen", ["-S", session, "-X", "quit"]);
    if (!quiet) {
      console.log(`worker:stop|screen=${session}|status=quit_requested`);
    }
  }

  const before = workerProcesses();
  const targets = keepBrowser ? before.filter((row) => !isBrowserProcess(row)) : before;
  for (const row of targets) {
    killPid(row.pid, "SIGTERM");
  }
  if (targets.length > 0) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_000);
  }
  for (const row of workerProcesses()) {
    if (keepBrowser && isBrowserProcess(row)) {
      continue;
    }
    killPid(row.pid, "SIGKILL");
  }

  if (!quiet) {
    console.log(
      `worker:stop|processes=${targets.length}|browserKept=${keepBrowser ? "true" : "false"}|status=stopped`,
    );
  }
}

function releaseLocalClaimedJobs() {
  if (!fs.existsSync(databasePath)) {
    return;
  }
  const db = new Database(databasePath);
  try {
    const now = new Date().toISOString();
    const result = db
      .prepare(
        `UPDATE jobs
            SET status = 'queued',
                claimed_at = NULL,
                claimed_by = NULL,
                scheduled_at = ?,
                updated_at = ?
          WHERE status = 'claimed'
            AND claimed_by = ?`,
      )
      .run(now, now, workerEnv.WORKER_ID);
    if (result.changes > 0) {
      console.log(`worker:start|releasedClaimedJobs=${result.changes}|workerId=${workerEnv.WORKER_ID}`);
    }
  } finally {
    db.close();
  }
}

function startWorker() {
  stopWorkers({ quiet: true, keepBrowser: true });
  releaseLocalClaimedJobs();
  const envPrefix = Object.entries(workerEnv)
    .map(([key, value]) => `${key}=${shellQuote(value)}`)
    .join(" ");
  const command = [
    `cd ${shellQuote(workerDir)}`,
    `exec env ${envPrefix} npm run start >> ${shellQuote(logPath)} 2>&1`,
  ].join(" && ");
  const result = run("screen", ["-dmS", screenName, "zsh", "-lc", command]);
  if (result.status !== 0) {
    throw new Error(`screen start failed: ${result.stderr || result.stdout}`);
  }
  console.log(`worker:start|screen=${screenName}|cdp=127.0.0.1:9223|log=${logPath}|status=started`);
}

function statusWorker() {
  const screens = workerScreenSessions();
  const processes = workerProcesses();
  const browserProcesses = processes.filter(isBrowserProcess);
  const runtimeProcesses = processes.filter((row) => !isBrowserProcess(row));
  console.log(
    [
      "worker:status",
      `screens=${screens.length}`,
      `runtimeProcesses=${runtimeProcesses.length}`,
      `browserProcesses=${browserProcesses.length}`,
      `screenNames=${screens.join(",") || "none"}`,
    ].join("|"),
  );
  for (const row of runtimeProcesses) {
    console.log(`worker:process|pid=${row.pid}|command=${row.command}`);
  }
  try {
    const tail = execFileSync("tail", ["-n", "8", logPath], { encoding: "utf8" });
    process.stdout.write(tail);
  } catch {
    console.log(`worker:status|log=${logPath}|tail=unavailable`);
  }
}

const command = process.argv[2] ?? "status";

if (command === "start") {
  startWorker();
} else if (command === "stop") {
  stopWorkers();
} else if (command === "restart") {
  startWorker();
} else if (command === "status") {
  statusWorker();
} else {
  console.error("usage: node scripts/local-worker.mjs <start|stop|restart|status>");
  process.exit(2);
}
