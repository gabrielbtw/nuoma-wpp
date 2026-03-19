import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import {
  ensureDefaultChannelAccounts,
  getDashboardSummary,
  getDb,
  getSettings,
  listRecentJobs,
  listSystemEvents,
  listSystemEventsByProcess,
  loadEnv,
  setSettings,
  getWorkerState
} from "@nuoma/core";

type WorkerPayload = Record<string, unknown>;

function readWorkerPayload(workerState: ReturnType<typeof getWorkerState>) {
  return workerState?.value && typeof workerState.value === "object" ? (workerState.value as WorkerPayload) : null;
}

function readWorkerPid(payload: WorkerPayload | null) {
  const pid = payload?.pid;
  return typeof pid === "number" && Number.isFinite(pid) && pid > 0 ? pid : null;
}

function isProcessRunning(pid: number | null) {
  if (!pid) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function normalizeWorkerPayload(payload: WorkerPayload | null, live: boolean, overrides: WorkerPayload = {}) {
  if (!payload) {
    return null;
  }

  if (live) {
    return { ...payload, live: true, stale: false };
  }

  return {
    ...payload,
    ...overrides,
    live: false,
    stale: true
  };
}

function readStatusFromPayload(payload: WorkerPayload | null) {
  const status = payload?.status;
  return typeof status === "string" ? status : null;
}

function readStringFromPayload(payload: WorkerPayload | null, key: string) {
  const value = payload?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isWhatsAppAuthenticated(payload: WorkerPayload | null) {
  const status = String(payload?.status ?? "").toLowerCase();
  const authStatus = String(payload?.authStatus ?? "").toLowerCase();
  return authStatus === "authenticated" || status === "authenticated" || status === "degraded";
}

function isInstagramAuthenticated(payload: WorkerPayload | null) {
  const status = String(payload?.status ?? "").toLowerCase();
  return payload?.authenticated === true || status === "connected";
}

function buildEffectiveSettings() {
  const env = loadEnv();
  const persistedSettings = new Map(getSettings().map((item) => [item.key, item.value]));
  const envEntries = Object.entries(env).filter(([key]) => key !== "PROJECT_ROOT");
  const keys = [...new Set([...envEntries.map(([key]) => key), ...persistedSettings.keys()])].sort((left, right) => left.localeCompare(right));

  return keys.map((key) => ({
    key,
    value: persistedSettings.has(key) ? persistedSettings.get(key) : env[key as keyof typeof env],
    source: persistedSettings.has(key) ? "database" : "env"
  }));
}

function parseMetaJson(input: unknown) {
  if (typeof input !== "string" || !input.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(input) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function listRecentProfileArtifacts(profileDir: string, relativePath: string, limit = 6) {
  if (!profileDir) {
    return [];
  }

  try {
    const directory = path.join(profileDir, relativePath);
    const entries = await readdir(directory);
    const files = await Promise.all(
      entries.map(async (entry) => {
        const absolutePath = path.join(directory, entry);
        const metadata = await stat(absolutePath);
        return metadata.isFile() ? { absolutePath, mtimeMs: metadata.mtimeMs, size: metadata.size } : null;
      })
    );

    return files
      .filter((item): item is { absolutePath: string; mtimeMs: number; size: number } => Boolean(item))
      .filter((item) => item.size > 0 && item.size < 8 * 1024 * 1024)
      .sort((left, right) => right.mtimeMs - left.mtimeMs)
      .slice(0, limit);
  } catch {
    return [];
  }
}

async function readProfileArtifacts(profileDir: string, relativePaths: string[]) {
  const buckets = await Promise.all(relativePaths.map((relativePath) => listRecentProfileArtifacts(profileDir, relativePath)));
  const files = buckets.flat().sort((left, right) => right.mtimeMs - left.mtimeMs).slice(0, 8);
  const contents = await Promise.all(
    files.map(async (file) => {
      try {
        const buffer = await readFile(file.absolutePath);
        return buffer.toString("latin1");
      } catch {
        return "";
      }
    })
  );

  return contents.join("\n");
}

async function resolveProfileWhatsAppPhone(profileDir: string) {
  const raw = await readProfileArtifacts(profileDir, ["Default/Local Storage/leveldb", "Default/Session Storage"]);
  const matches = Array.from(raw.matchAll(/([1-9]\d{9,14})@(?:c\.us|s\.whatsapp\.net)/g)).map((match) => match[1]);
  const preferred = matches.find((value) => value.startsWith("55") && value.length >= 12);
  return preferred ?? matches[0] ?? null;
}

async function resolveProfileInstagramUsername(profileDir: string) {
  const raw = await readProfileArtifacts(profileDir, ["Default/Local Storage/leveldb", "Default/Session Storage"]);
  const matches = Array.from(raw.matchAll(/"username":"([a-z0-9._]+)"/gi)).map((match) => match[1]?.toLowerCase() ?? "");
  return matches.find(Boolean) ?? null;
}

export async function registerSystemRoutes(app: FastifyInstance) {
  app.get("/dashboard", async () => getDashboardSummary());

  app.get("/health", async () => {
    const env = loadEnv();
    const db = getDb();
    const channelAccounts = ensureDefaultChannelAccounts();
    const activeCampaigns = Number((db.prepare("SELECT COUNT(*) AS count FROM campaigns WHERE status = 'active'").get() as { count: number }).count);
    const activeAutomations = Number((db.prepare("SELECT COUNT(*) AS count FROM automations WHERE enabled = 1").get() as { count: number }).count);
    const waitingConversations = Number(
      (db.prepare("SELECT COUNT(*) AS count FROM contacts WHERE deleted_at IS NULL AND status = 'aguardando_resposta'").get() as { count: number }).count
    );
    const pendingFollowUps = Number(
      (
        db.prepare(
          `
            SELECT COUNT(*) AS count
            FROM automation_runs ar
            INNER JOIN automations a ON a.id = ar.automation_id
            WHERE a.category = 'follow-up' AND ar.status IN ('pending', 'active')
          `
        ).get() as { count: number }
      ).count
    );

    const worker = getWorkerState("wa-worker");
    const instagramWorker = getWorkerState("instagram-assisted");
    const scheduler = getWorkerState("scheduler");
    const workerPayload = readWorkerPayload(worker);
    const schedulerPayload = readWorkerPayload(scheduler);
    const instagramWorkerPayload = readWorkerPayload(instagramWorker);
    const workerLive = isProcessRunning(readWorkerPid(workerPayload));
    const schedulerLive = isProcessRunning(readWorkerPid(schedulerPayload));
    const normalizedWorker = normalizeWorkerPayload(workerPayload, workerLive, {
      status: "disconnected",
      authStatus: "disconnected",
      sessionPhone: null
    });
    const normalizedScheduler = normalizeWorkerPayload(schedulerPayload, schedulerLive, {
      status: "offline"
    });
    const normalizedWorkerSessionPhone = readStringFromPayload(normalizedWorker, "sessionPhone");
    const instagramWorkerUsername = readStringFromPayload(instagramWorkerPayload, "username");
    const whatsappSessionPhone = isWhatsAppAuthenticated(normalizedWorker)
      ? normalizedWorkerSessionPhone
      : null;
    const instagramSessionUsername = isInstagramAuthenticated(instagramWorkerPayload)
      ? instagramWorkerUsername
      : null;
    const conversationsByChannel = db
      .prepare(
        `
          SELECT channel, COUNT(*) AS count
          FROM conversations
          GROUP BY channel
        `
      )
      .all() as Array<{ channel: string; count: number }>;
    const contactChannelsByType = db
      .prepare(
        `
          SELECT type, COUNT(*) AS count
          FROM contact_channels
          WHERE is_active = 1
          GROUP BY type
        `
      )
      .all() as Array<{ type: string; count: number }>;

    const conversationsMap = Object.fromEntries(conversationsByChannel.map((item) => [item.channel, Number(item.count)]));
    const contactChannelsMap = Object.fromEntries(contactChannelsByType.map((item) => [item.type, Number(item.count)]));
    const workerStatus = readStatusFromPayload(normalizedWorker);
    const instagramWorkerStatus = readStatusFromPayload(instagramWorkerPayload);
    const overallStatus = ["error", "degraded", "disconnected"].includes(workerStatus ?? "")
      ? workerStatus ?? "error"
      : ["error", "disconnected"].includes(instagramWorkerStatus ?? "")
        ? instagramWorkerStatus ?? "error"
        : "ok";

    return {
      status: overallStatus === "ok" ? "ok" : "attention",
      overallStatus,
      app: env.APP_NAME,
      appStatus: {
        status: "ok",
        host: env.APP_HOST,
        port: env.APP_PORT
      },
      databasePath: env.DATABASE_PATH,
      worker: worker ? { ...worker, value: normalizedWorker } : null,
      scheduler: scheduler ? { ...scheduler, value: normalizedScheduler } : null,
      channels: {
        whatsapp: {
          label: "WPP / WhatsApp",
          mode: "connected",
          account: channelAccounts.whatsapp,
          sessionIdentifier: whatsappSessionPhone,
          worker: normalizedWorker,
          mappedConversations: conversationsMap.whatsapp ?? 0,
          mappedContactChannels: contactChannelsMap.whatsapp ?? 0
        },
        instagram: {
          label: "Instagram Assistido",
          mode: "assisted",
          account: channelAccounts.instagram,
          sessionIdentifier: instagramSessionUsername,
          worker: instagramWorkerPayload,
          mappedConversations: conversationsMap.instagram ?? 0,
          mappedContactChannels: contactChannelsMap.instagram ?? 0
        }
      },
      metrics: {
        activeCampaigns,
        activeAutomations,
        waitingConversations,
        pendingFollowUps
      },
      features: {
        automations: env.ENABLE_AUTOMATIONS,
        campaigns: env.ENABLE_CAMPAIGNS,
        postProcedure: env.ENABLE_POST_PROCEDURE
      }
    };
  });

  app.get("/logs", async (request) => {
    const query = request.query as { limit?: string; offset?: string; eventsOffset?: string; jobsOffset?: string };
    const limit = Math.max(1, Math.min(200, Number(query.limit ?? 150)));
    const fallbackOffset = Math.max(0, Number(query.offset ?? 0));
    const eventsOffset = Math.max(0, Number(query.eventsOffset ?? fallbackOffset));
    const jobsOffset = Math.max(0, Number(query.jobsOffset ?? fallbackOffset));
    return {
      events: listSystemEvents(limit, eventsOffset),
      jobs: listRecentJobs(limit, jobsOffset)
    };
  });

  app.get("/imports", async (request) => {
    const query = request.query as { limit?: string };
    const limit = Math.max(1, Math.min(200, Number(query.limit ?? 100)));
    const events = listSystemEventsByProcess("instagram-import", limit).map((event) => ({
      ...event,
      meta: parseMetaJson(event.meta_json)
    }));
    const batchEvents = events.filter((event) => (event.meta as { eventType?: string }).eventType === "batch");
    const latestBatch =
      batchEvents.find((event) => {
        const meta = event.meta as {
          aggregate?: { processedFiles?: unknown };
          backfill?: { updatedContacts?: unknown };
          whatsappCsvImport?: { created?: unknown; updated?: unknown };
          whatsappConversationEnrichment?: { updatedContacts?: unknown };
          whatsappMessageEnrichment?: { updatedContacts?: unknown };
        };
        return (
          Number(meta.aggregate?.processedFiles ?? 0) > 0 ||
          Number(meta.backfill?.updatedContacts ?? 0) > 0 ||
          Number(meta.whatsappCsvImport?.created ?? 0) > 0 ||
          Number(meta.whatsappCsvImport?.updated ?? 0) > 0 ||
          Number(meta.whatsappConversationEnrichment?.updatedContacts ?? 0) > 0 ||
          Number(meta.whatsappMessageEnrichment?.updatedContacts ?? 0) > 0
        );
      }) ??
      batchEvents[0] ??
      null;
    const fileRuns = events.filter((event) => (event.meta as { eventType?: string }).eventType === "file");

    const totals = fileRuns.reduce(
      (accumulator, event) => {
        const meta = event.meta as { summary?: Record<string, unknown>; deletedSource?: boolean };
        const summary = meta.summary ?? {};
        return {
          files: accumulator.files + 1,
          created: accumulator.created + Number(summary.created ?? 0),
          updated: accumulator.updated + Number(summary.updated ?? 0),
          unchanged: accumulator.unchanged + Number(summary.unchanged ?? 0),
          processedThreads: accumulator.processedThreads + Number(summary.processedThreads ?? 0),
          processedFollowers: accumulator.processedFollowers + Number(summary.processedFollowers ?? 0),
          processedFollowing: accumulator.processedFollowing + Number(summary.processedFollowing ?? 0),
          phonesDiscovered: accumulator.phonesDiscovered + Number(summary.phonesDiscovered ?? 0),
          whatsappCsvMatches: accumulator.whatsappCsvMatches + Number(summary.whatsappCsvMatches ?? 0),
          whatsappCsvNamesApplied: accumulator.whatsappCsvNamesApplied + Number(summary.whatsappCsvNamesApplied ?? 0),
          namesFromPhones: accumulator.namesFromPhones + Number(summary.namesFromPhones ?? 0),
          deletedSources: accumulator.deletedSources + Number(Boolean(meta.deletedSource))
        };
      },
      {
        files: 0,
        created: 0,
        updated: 0,
        unchanged: 0,
        processedThreads: 0,
        processedFollowers: 0,
        processedFollowing: 0,
        phonesDiscovered: 0,
        whatsappCsvMatches: 0,
        whatsappCsvNamesApplied: 0,
        namesFromPhones: 0,
        deletedSources: 0
      }
    );

    return {
      latestBatch,
      totals,
      fileRuns
    };
  });

  app.get("/worker/metrics", async () => {
    const worker = getWorkerState("wa-worker");
    return worker?.value ?? {};
  });

  app.get("/settings", async () => buildEffectiveSettings());

  app.patch("/settings", async (request) => {
    const payload = request.body as Record<string, unknown>;
    setSettings(payload);
    return buildEffectiveSettings();
  });
}
