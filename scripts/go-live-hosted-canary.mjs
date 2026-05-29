#!/usr/bin/env node
import { readFileSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const envConfig = loadEnvConfig(args["env-file"]);
const apiBaseUrl = stripTrailingSlash(String(args.api ?? envValue("GO_LIVE_API_URL") ?? ""));
const webBaseUrl = stripTrailingSlash(String(args.web ?? envValue("GO_LIVE_WEB_URL") ?? ""));
const email = String(args.email ?? envValue("GO_LIVE_EMAIL") ?? "");
const password = String(args.password ?? envValue("GO_LIVE_PASSWORD") ?? "");
const campaignId = Number(args["campaign-id"] ?? envValue("GO_LIVE_CAMPAIGN_ID") ?? 0);
const canaryPhone = normalizePhone(String(args.phone ?? envValue("GO_LIVE_CANARY_PHONE") ?? ""));
const pollSeconds = numberArg(args["poll-seconds"], 180);
const confirmPhrase = `ENVIAR CANARIO ${canaryPhone}`;
const confirmedSend = args["confirm-send"] === confirmPhrase;
const requireSend = Boolean(args["require-send"]);
const outputPath = path.resolve(
  repoRoot,
  String(
    args.output ??
      `output/go-live-hosted-canary-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  ),
);

const report = {
  mode: "go-live-hosted-canary",
  generatedAtUtc: new Date().toISOString(),
  apiBaseUrl,
  webBaseUrl: webBaseUrl || null,
  campaignId,
  canaryPhone,
  confirmPhrase,
  confirmedSend,
  checks: [],
  blockers: [],
  warnings: [],
  proof: null,
};

await run();

async function run() {
  for (const envWarning of envConfig.warnings) {
    warning("env.file", envWarning);
  }
  validateConfig();
  if (report.blockers.length > 0) {
    await finish();
    return;
  }

  const session = await login();
  if (!session) {
    await finish();
    return;
  }

  const startedAt = new Date().toISOString();
  const metrics = await safeTrpc(session, "GET", "system.metrics");
  if (metrics) {
    ok("system.metrics", {
      workersOnline: metrics.workers?.online ?? null,
      workersTotal: metrics.workers?.total ?? null,
      cdpConnected: metrics.whatsapp?.cdpConnected ?? null,
      apiSendPolicyMode: metrics.sendPolicy?.apiMode ?? null,
      apiAllowedPhonesConfigured: metrics.sendPolicy?.apiAllowedPhonesConfigured ?? null,
    });
    if ((metrics.workers?.online ?? 0) <= 0) {
      blocker("system.metrics", "No worker is online on the target API");
    }
    if (!metrics.whatsapp?.cdpConnected) {
      blocker("system.metrics", "No active WhatsApp CDP connection on the target API");
    }
  }

  const campaigns = await safeTrpc(session, "GET", "campaigns.list");
  const campaign = campaigns?.campaigns?.find((item) => Number(item.id) === campaignId);
  if (!campaign) {
    blocker("campaign.exists", `Campaign ${campaignId} not found for logged-in user`);
    await finish();
    return;
  }
  ok("campaign.exists", {
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    channel: campaign.channel,
  });
  if (campaign.channel !== "whatsapp") {
    blocker("campaign.channel", "Hosted canary runner only supports WhatsApp campaign button flow");
  }
  if (campaign.status !== "running" && campaign.status !== "scheduled") {
    blocker("campaign.status", `Campaign must be running or scheduled, got ${campaign.status}`);
  }

  const dryRun = await safeTrpc(session, "POST", "campaigns.execute", {
    campaignId,
    dryRun: true,
    phones: [canaryPhone],
    maxRecipients: 1,
    allowedPhone: canaryPhone,
  });
  if (dryRun) {
    ok("campaign.execute.dry_run", {
      recipientsPlanned: dryRun.recipientsPlanned,
      rejected: dryRun.rejected ?? [],
    });
    if (dryRun.recipientsPlanned !== 1 || (dryRun.rejected ?? []).length > 0) {
      blocker(
        "campaign.execute.dry_run",
        "Dry-run did not plan exactly one clean canary recipient",
      );
    }
  }

  if (report.blockers.length > 0) {
    await finish();
    return;
  }
  if (!confirmedSend) {
    if (requireSend) {
      blocker(
        "campaign.execute.confirm_send",
        `Pass --confirm-send "${confirmPhrase}" to run real canary`,
      );
    } else {
      warning("campaign.execute.confirm_send", "Real canary send skipped; dry-run proof only");
    }
    await finish();
    return;
  }

  const execute = await safeTrpc(session, "POST", "campaigns.execute", {
    campaignId,
    dryRun: false,
    phones: [canaryPhone],
    maxRecipients: 1,
    allowedPhone: canaryPhone,
  });
  if (!execute) {
    await finish();
    return;
  }
  ok("campaign.execute.real", {
    recipientsCreated: execute.recipientsCreated,
    jobsCreated: execute.scheduler?.jobsCreated ?? null,
    plannedJobs: execute.scheduler?.plannedJobs?.length ?? null,
  });
  if (execute.recipientsCreated !== 1 || (execute.scheduler?.jobsCreated ?? 0) < 1) {
    blocker(
      "campaign.execute.real",
      "Real canary did not create exactly one recipient and at least one job",
    );
    await finish();
    return;
  }

  const proof = await pollCanaryCompletion(session, startedAt);
  report.proof = proof;
  if (proof.activeJobs.length > 0) {
    blocker("canary.completion", "Campaign-step jobs are still active after polling window");
  }
  if (proof.failedJobs.length > 0) {
    blocker("canary.completion", "At least one canary campaign-step job failed");
  }
  if (proof.completedJobs.length === 0) {
    blocker("canary.completion", "No completed canary campaign-step job found");
  }
  if (!proof.recipient) {
    blocker("canary.recipient", "Canary recipient was not found in campaign state after dispatch");
  } else if (proof.recipient.status !== "completed") {
    blocker(
      "canary.recipient",
      `Canary recipient still has active/non-final status: ${proof.recipient.status}`,
    );
  }
  const hasCompletedEvent = proof.events.some(
    (event) => event.type === "sender.campaign_step.completed",
  );
  if (!hasCompletedEvent) {
    blocker("canary.events", "sender.campaign_step.completed event was not observed");
  } else {
    ok("canary.events", { completedEvent: true });
  }

  await finish();
}

async function pollCanaryCompletion(session, startedAt) {
  const deadline = Date.now() + pollSeconds * 1000;
  let snapshot = null;
  while (Date.now() <= deadline) {
    snapshot = await canarySnapshot(session, startedAt);
    if (
      snapshot.completedJobs.length > 0 &&
      snapshot.activeJobs.length === 0 &&
      snapshot.failedJobs.length === 0
    ) {
      return snapshot;
    }
    await sleep(5_000);
  }
  return snapshot ?? (await canarySnapshot(session, startedAt));
}

async function canarySnapshot(session, startedAt) {
  const [jobsData, campaignsData, completedEvents, failedEvents, overlayEvents] = await Promise.all(
    [
      safeTrpc(session, "GET", "jobs.list", {}),
      safeTrpc(session, "GET", "campaigns.list"),
      safeTrpc(session, "GET", "system.events", {
        type: "sender.campaign_step.completed",
        limit: 50,
      }),
      safeTrpc(session, "GET", "system.events", {
        type: "sender.campaign_step.failed",
        limit: 50,
      }),
      safeTrpc(session, "GET", "system.events", {
        type: "campaign.overlay.dispatched",
        limit: 50,
      }),
    ],
  );
  const jobs = (jobsData?.jobs ?? []).filter((job) => isCanaryCampaignJob(job, startedAt));
  const campaign = campaignsData?.campaigns?.find((item) => Number(item.id) === campaignId);
  const recipient = campaign?.recipients?.find(
    (item) => normalizePhone(item.phone) === canaryPhone,
  );
  const events = [
    ...(completedEvents?.events ?? []),
    ...(failedEvents?.events ?? []),
    ...(overlayEvents?.events ?? []),
  ]
    .filter((event) => eventMatchesCanary(event, startedAt))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  return {
    jobs: jobs.map(summarizeJob),
    activeJobs: jobs
      .filter((job) => ["queued", "claimed", "running"].includes(job.status))
      .map(summarizeJob),
    completedJobs: jobs.filter((job) => job.status === "completed").map(summarizeJob),
    failedJobs: jobs.filter((job) => job.status === "failed").map(summarizeJob),
    recipient: recipient
      ? {
          id: recipient.id,
          status: recipient.status,
          phone: recipient.phone,
          lastError: recipient.lastError,
        }
      : null,
    events: events.map((event) => ({
      id: event.id,
      type: event.type,
      severity: event.severity,
      createdAt: event.createdAt,
    })),
  };
}

async function login() {
  const response = await trpcCall(null, "POST", "auth.login", { email, password });
  if (response.error) {
    blocker("auth.login", response.error.message ?? "Login failed");
    return null;
  }
  const csrfToken = response.data?.csrfToken;
  const cookie = cookieHeader(response.setCookie);
  if (!csrfToken || !cookie) {
    blocker("auth.login", "Login did not return session cookies and csrfToken");
    return null;
  }
  ok("auth.login", { email });
  return { cookie, csrfToken };
}

async function safeTrpc(session, method, procedure, input) {
  const response = await trpcCall(session, method, procedure, input);
  if (response.error) {
    blocker(procedure, response.error.message ?? `${procedure} failed`);
    return null;
  }
  return response.data;
}

async function trpcCall(session, method, procedure, input) {
  const headers = {};
  if (session?.cookie) headers.cookie = session.cookie;
  if (session?.csrfToken && method === "POST") headers["x-csrf-token"] = session.csrfToken;
  let url = `${apiBaseUrl}/trpc/${procedure}`;
  const init = { method, headers };
  if (method === "GET") {
    if (input !== undefined) {
      url = `${url}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
    }
  } else {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(input === undefined ? {} : { json: input });
  }
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  const setCookie =
    response.headers.getSetCookie?.() ?? parseCombinedSetCookie(response.headers.get("set-cookie"));
  const body = await response.json().catch(() => null);
  return {
    statusCode: response.status,
    data: body?.result?.data?.json,
    error:
      body?.error?.json ??
      (!response.ok ? { message: `${procedure} returned ${response.status}` } : null),
    setCookie,
  };
}

function validateConfig() {
  if (!apiBaseUrl) blocker("config.api", "Set GO_LIVE_API_URL or --api");
  if (!email) blocker("config.email", "Set GO_LIVE_EMAIL or --email");
  if (!password) blocker("config.password", "Set GO_LIVE_PASSWORD or --password");
  if (!Number.isInteger(campaignId) || campaignId <= 0) {
    blocker("config.campaign", "Set GO_LIVE_CAMPAIGN_ID or --campaign-id");
  }
  if (!/^55\d{10,11}$/.test(canaryPhone)) {
    blocker("config.phone", "Set GO_LIVE_CANARY_PHONE or --phone as canonical Brazilian digits");
  }
}

async function finish() {
  report.status =
    report.blockers.length > 0 ? "blocked" : confirmedSend ? "completed" : "dry_run_ready";
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(
    [
      "go-live-hosted-canary",
      `status=${report.status}`,
      `blockers=${report.blockers.length}`,
      `warnings=${report.warnings.length}`,
      `output=${path.relative(repoRoot, outputPath)}`,
    ].join("|"),
  );
  for (const item of report.blockers) {
    console.log(`blocker|check=${item.check}|reason=${item.reason}`);
  }
  if (report.blockers.length > 0) process.exitCode = 1;
}

function isCanaryCampaignJob(job, startedAt) {
  return (
    job.type === "campaign_step" &&
    Number(job.payload?.campaignId) === campaignId &&
    normalizePhone(job.payload?.phone) === canaryPhone &&
    String(job.createdAt ?? "") >= startedAt
  );
}

function eventMatchesCanary(event, startedAt) {
  const payload = event.payload ?? {};
  const phone = normalizePhone(payload.phone ?? payload.targetPhone ?? payload.recipientPhone);
  return (
    String(event.createdAt ?? "") >= startedAt &&
    (Number(payload.campaignId) === campaignId || phone === canaryPhone)
  );
}

function summarizeJob(job) {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    attempts: job.attempts,
    lastError: job.lastError,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    campaignId: job.payload?.campaignId ?? null,
    recipientId: job.payload?.recipientId ?? null,
    phone: job.payload?.phone ?? null,
  };
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

function cookieHeader(setCookie) {
  return Array.isArray(setCookie) ? setCookie.map((cookie) => cookie.split(";")[0]).join("; ") : "";
}

function parseCombinedSetCookie(header) {
  if (!header) return [];
  return header.split(/,(?=\s*[^;,=]+=[^;,]+)/).map((cookie) => cookie.trim());
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripTrailingSlash(value) {
  return value.replace(/\/$/, "");
}

function numberArg(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function normalizePhone(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("55") && digits.length >= 12) return digits;
  if (digits.length === 11) return `55${digits}`;
  return digits;
}

function envValue(key) {
  return process.env[key] ?? envConfig.values[key];
}

function loadEnvConfig(explicitPath) {
  const values = {};
  const warnings = [];
  const filePath = explicitPath ? path.resolve(repoRoot, String(explicitPath)) : null;
  if (!filePath) return { values, warnings };
  try {
    Object.assign(values, parseEnvFile(readFileSync(filePath, "utf8")));
  } catch (error) {
    warnings.push(
      `Env file could not be read: ${path.relative(repoRoot, filePath)}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return { values, warnings };
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

function parseArgs(input) {
  const parsed = {};
  for (let index = 0; index < input.length; index += 1) {
    const value = input[index];
    if (!value?.startsWith("--")) continue;
    const key = value.slice(2);
    if (key === "require-send") {
      parsed[key] = true;
      continue;
    }
    parsed[key] = input[index + 1];
    index += 1;
  }
  return parsed;
}
