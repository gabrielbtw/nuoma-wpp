#!/usr/bin/env node
import { readFileSync, statSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const envConfig = loadEnvConfig(args["env-file"]);
const canaryPhone = normalizePhone(String(args.canary ?? envValue("GO_LIVE_CANARY_PHONE") ?? ""));
const apiBaseUrl = String(args.api ?? envValue("GO_LIVE_API_URL") ?? "http://127.0.0.1:3001");
const webBaseUrl = String(args.web ?? envValue("GO_LIVE_WEB_URL") ?? "http://127.0.0.1:3002");
const cdpVersionUrl = String(
  args.cdp ?? envValue("GO_LIVE_CDP_VERSION_URL") ?? "http://127.0.0.1:9223/json/version",
);
const dbPath = path.resolve(
  repoRoot,
  String(args.db ?? envValue("DATABASE_URL") ?? "data/nuoma-v2.db"),
);
const profileDir = path.resolve(
  repoRoot,
  String(args.profile ?? envValue("CHROMIUM_PROFILE_DIR") ?? "data/chromium-profile/whatsapp"),
);
const outputPath = path.resolve(
  repoRoot,
  String(
    args.output ??
      `output/go-live-canary-preflight-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  ),
);
const requireHostedProof = Boolean(args["require-hosted-proof"]);

const report = {
  mode: "go-live-canary-preflight",
  generatedAtUtc: new Date().toISOString(),
  canaryPhone,
  targets: {
    apiBaseUrl,
    webBaseUrl,
    cdpVersionUrl,
    dbPath: path.relative(repoRoot, dbPath),
    profileDir: path.relative(repoRoot, profileDir),
    envFiles: envConfig.files.map((file) => path.relative(repoRoot, file)),
  },
  checks: [],
  blockers: [],
  warnings: [],
  nextActions: [],
};

await run();

async function run() {
  for (const envWarning of envConfig.warnings) {
    warning("env.file", envWarning);
  }
  checkCanaryPhone();
  await checkProfile();
  checkSendPolicy("API", envValue("API_SEND_POLICY_MODE"), envValue("API_SEND_ALLOWED_PHONES"));
  checkSendPolicy(
    "Worker",
    envValue("WA_SEND_POLICY_MODE"),
    [envValue("WA_SEND_ALLOWED_PHONES"), envValue("WA_SEND_ALLOWED_PHONE")]
      .filter(Boolean)
      .join(","),
  );
  checkDatabase();
  await checkHttp("api.health", `${apiBaseUrl.replace(/\/$/, "")}/health`, true);
  await checkHttp("web.root", webBaseUrl, true);
  await checkHttp("worker.cdp", cdpVersionUrl, true);
  checkHostedProof();

  report.status = report.blockers.length === 0 ? "ready" : "blocked";
  if (report.status === "blocked") {
    report.nextActions.push(
      "Corrija todos os blockers antes de disparar campanha por botao em ambiente hospedado.",
    );
  }
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(
    [
      "go-live-canary-preflight",
      `status=${report.status}`,
      `blockers=${report.blockers.length}`,
      `warnings=${report.warnings.length}`,
      `output=${path.relative(repoRoot, outputPath)}`,
    ].join("|"),
  );
  if (report.blockers.length > 0) {
    for (const blocker of report.blockers) {
      console.log(`blocker|check=${blocker.check}|reason=${blocker.reason}`);
    }
    process.exitCode = 1;
  }
}

function checkCanaryPhone() {
  if (!isCanonicalBrazilianPhone(canaryPhone)) {
    blocker(
      "canary.phone",
      "GO_LIVE_CANARY_PHONE or --canary must be canonical Brazilian E.164 digits, for example 5531982066263",
    );
    return;
  }
  ok("canary.phone", { phone: canaryPhone });
}

async function checkProfile() {
  const stat = await statIfExists(profileDir);
  if (!stat?.isDirectory()) {
    blocker("whatsapp.profile", "Chromium WhatsApp profile directory is missing");
    return;
  }
  const entries = await fs.readdir(profileDir);
  if (entries.length === 0) {
    blocker("whatsapp.profile", "Chromium WhatsApp profile directory is empty");
    return;
  }
  ok("whatsapp.profile", { entries: entries.length });
}

function checkSendPolicy(label, mode, rawPhones) {
  const check = `${label.toLowerCase()}.send_policy`;
  const phones = parsePhones(rawPhones);
  if (!mode) {
    blocker(check, `${label} send policy mode is not configured in this shell`);
    return;
  }
  if (mode !== "test" && mode !== "production") {
    blocker(check, `${label} send policy mode must be test or production`);
    return;
  }
  if (!canaryPhone) {
    blocker(check, `${label} send policy cannot be checked without canary phone`);
    return;
  }
  if (phones.length !== 1 || phones[0] !== canaryPhone) {
    blocker(check, `${label} allowlist must contain only the canary phone`);
    return;
  }
  ok(check, { mode, allowedPhones: phones });
}

function checkDatabase() {
  const dbStat = fsStatSyncSafe(dbPath);
  if (!dbStat?.isFile()) {
    blocker("db.exists", "SQLite database does not exist");
    return;
  }
  let db;
  try {
    db = new Database(dbPath, { readonly: true });
    const counts = {
      activeJobs: scalar(
        db,
        "SELECT count(*) FROM jobs WHERE status IN ('queued','claimed','running')",
      ),
      activeCampaignStepJobs: scalar(
        db,
        "SELECT count(*) FROM jobs WHERE type='campaign_step' AND status IN ('queued','claimed','running')",
      ),
      activeCampaignRecipients: scalar(
        db,
        "SELECT count(*) FROM campaign_recipients WHERE status IN ('queued','running')",
      ),
    };
    if (counts.activeCampaignStepJobs > 0) {
      blocker(
        "db.active_campaign_step_jobs",
        `${counts.activeCampaignStepJobs} campaign_step jobs active`,
      );
    } else {
      ok("db.active_campaign_step_jobs", counts);
    }
    if (counts.activeCampaignRecipients > 0) {
      blocker(
        "db.active_campaign_recipients",
        `${counts.activeCampaignRecipients} campaign recipients active`,
      );
    } else {
      ok("db.active_campaign_recipients", counts);
    }
  } catch (error) {
    blocker("db.read", error instanceof Error ? error.message : String(error));
  } finally {
    db?.close();
  }
}

async function checkHttp(name, url, required) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2_500) });
    const text = await response.text();
    if (!response.ok) {
      (required ? blocker : warning)(name, `${url} returned ${response.status}`);
      return;
    }
    ok(name, { url, status: response.status, sample: text.slice(0, 120) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    (required ? blocker : warning)(name, `${url} failed: ${message}`);
  }
}

function checkHostedProof() {
  const proofPath = envValue("GO_LIVE_HOSTED_PROOF_PATH");
  if (!requireHostedProof) {
    warning("hosted.proof", "Hosted proof capture not required for this preflight run");
    return;
  }
  if (!proofPath) {
    blocker("hosted.proof", "GO_LIVE_HOSTED_PROOF_PATH is required with --require-hosted-proof");
    return;
  }
  const proof = fsStatSyncSafe(path.resolve(repoRoot, proofPath));
  if (!proof?.isFile()) {
    blocker("hosted.proof", `Hosted proof file not found: ${proofPath}`);
    return;
  }
  ok("hosted.proof", { path: proofPath, sizeBytes: proof.size });
}

function scalar(db, sql) {
  return Number(db.prepare(sql).pluck().get() ?? 0);
}

function ok(check, details = {}) {
  report.checks.push({ check, status: "ok", ...details });
}

function blocker(check, reason) {
  report.checks.push({ check, status: "blocked", reason });
  report.blockers.push({ check, reason });
}

function warning(check, reason) {
  report.checks.push({ check, status: "warning", reason });
  report.warnings.push({ check, reason });
}

function parseArgs(input) {
  const parsed = {};
  for (let index = 0; index < input.length; index += 1) {
    const value = input[index];
    if (!value?.startsWith("--")) continue;
    const key = value.slice(2);
    if (key === "require-hosted-proof") {
      parsed[key] = true;
      continue;
    }
    parsed[key] = input[index + 1];
    index += 1;
  }
  return parsed;
}

function envValue(key) {
  return process.env[key] ?? envConfig.values[key];
}

function loadEnvConfig(explicitPath) {
  const values = {};
  const files = [];
  const warnings = [];
  const candidates = explicitPath
    ? [path.resolve(repoRoot, String(explicitPath))]
    : [path.join(repoRoot, ".env"), path.join(repoRoot, ".env.local")];
  for (const filePath of candidates) {
    const stat = fsStatSyncSafe(filePath);
    if (!stat?.isFile()) {
      if (explicitPath) warnings.push(`Env file not found: ${path.relative(repoRoot, filePath)}`);
      continue;
    }
    try {
      Object.assign(values, parseEnvFile(readFileSync(filePath, "utf8")));
      files.push(filePath);
    } catch (error) {
      warnings.push(
        `Env file could not be read: ${path.relative(repoRoot, filePath)}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  return { values, files, warnings };
}

function parseEnvFile(contents) {
  const values = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    values[key] = unquoteEnvValue(rawValue.trim());
  }
  return values;
}

function unquoteEnvValue(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  const commentIndex = value.search(/\s+#/);
  return commentIndex >= 0 ? value.slice(0, commentIndex).trim() : value;
}

function parsePhones(value) {
  return [
    ...new Set(
      String(value ?? "")
        .split(",")
        .map(normalizePhone)
        .filter(Boolean),
    ),
  ];
}

function normalizePhone(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("55") && digits.length >= 12) return digits;
  if (digits.length === 11) return `55${digits}`;
  return digits;
}

function isCanonicalBrazilianPhone(value) {
  return /^55\d{10,11}$/.test(value);
}

async function statIfExists(filePath) {
  try {
    return await fs.stat(filePath);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function fsStatSyncSafe(filePath) {
  try {
    return statSync(filePath);
  } catch {
    return null;
  }
}
