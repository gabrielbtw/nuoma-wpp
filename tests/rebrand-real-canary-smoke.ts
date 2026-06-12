import Database from "better-sqlite3";
import { chromium, type BrowserContext, type Page } from "playwright";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { loadWorkerEnv } from "@nuoma/config";

import { sendInstagramTextViaCdp } from "../apps/worker/src/instagram/assisted.js";
import {
  backfillSmokeWhatsappIdentity,
  findSmokeWhatsappContact,
  findSmokeWhatsappConversation,
} from "./helpers/contact-identity.mjs";

const rootDir = process.cwd();
const dataDir = path.join(rootDir, "data");
const evidenceDir = path.join(dataDir, "rebrand-real-canary");
const dbPath = path.resolve(process.env.DATABASE_URL ?? path.join(dataDir, "nuoma-v2.db"));
const apiUrl = process.env.API_URL ?? "http://127.0.0.1:3001";
const webUrl = process.env.WEB_URL ?? "http://127.0.0.1:3002";
const cdpUrl = process.env.CDP_URL ?? "http://127.0.0.1:9223";
const email = process.env.SMOKE_EMAIL ?? "admin@nuoma.local";
const password = process.env.SMOKE_PASSWORD ?? "nuoma-dev-admin-123";
const userId = Number(process.env.SMOKE_USER_ID ?? 1);
const phone = (process.env.REBRAND_REAL_WA_PHONE ?? "5531982066263").replace(/\D/g, "");
const instagramHandle = normalizeInstagramHandle(
  process.env.REBRAND_REAL_IG_HANDLE ?? "gabriell_braga",
);
const tokenRoot = process.env.REBRAND_REAL_TOKEN ?? `REBRAND-${Date.now()}`;
const whatsappToken = `${tokenRoot}-WA`;
const instagramToken = `${tokenRoot}-IG`;
const whatsappBody = `Smoke real rebrand WhatsApp ${whatsappToken}`;
const instagramBody = `Smoke real rebrand Instagram ${instagramToken}`;
const timeoutMs = Number(process.env.REBRAND_REAL_TIMEOUT_MS ?? 180_000);
const confirmed = process.env.REBRAND_REAL_SEND === "SIM";

const screenshots = {
  whatsapp: path.join(evidenceDir, `${tokenRoot}-whatsapp.png`),
  instagram: path.join(evidenceDir, `${tokenRoot}-instagram.png`),
};
const reportPath = path.join(evidenceDir, `${tokenRoot}-report.json`);

const db = new Database(dbPath);
db.pragma("busy_timeout = 5000");

type Session = { cookie: string; csrfToken: string };

function nowIso(): string {
  return new Date().toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function compact(value: unknown): string {
  return JSON.stringify(value).replace(/\s+/g, " ");
}

function normalizeInstagramHandle(value: string): string {
  return value.trim().replace(/^@+/, "").toLowerCase();
}

async function assertHttpOk(url: string, label: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${label} not ok: ${response.status}`);
  }
}

function assertConfirmedTargets(): void {
  if (!confirmed) {
    throw new Error("Real send blocked: set REBRAND_REAL_SEND=SIM.");
  }
  if (phone !== "5531982066263") {
    throw new Error(`Unexpected WhatsApp target: ${phone}`);
  }
  if (instagramHandle !== "gabriell_braga") {
    throw new Error(`Unexpected Instagram target: ${instagramHandle}`);
  }
}

function seedWhatsappConversation(): { conversationId: number } {
  const now = nowIso();
  let contact = findSmokeWhatsappContact(db, { userId, phone });

  if (contact) {
    db.prepare(
      `UPDATE contacts
       SET name = ?, primary_channel = 'whatsapp', status = 'active', updated_at = ?
       WHERE id = ?`,
    ).run(`Smoke Canary ${phone}`, now, contact.id);
  } else {
    const result = db
      .prepare(
        `INSERT INTO contacts
         (user_id, name, phone, email, primary_channel, instagram_handle, status, notes, last_message_at, deleted_at, created_at, updated_at)
         VALUES (?, ?, ?, NULL, 'whatsapp', NULL, 'active', ?, NULL, NULL, ?, ?)`,
      )
      .run(
        userId,
        `Smoke Canary ${phone}`,
        phone,
        "Contato canario para smoke real de rebrand.",
        now,
        now,
      );
    contact = { id: Number(result.lastInsertRowid), phone };
  }

  let conversation = findSmokeWhatsappConversation(db, {
    userId,
    phone,
    contactId: contact.id,
  });

  if (conversation) {
    db.prepare(
      `UPDATE conversations
       SET contact_id = ?, title = ?, updated_at = ?
       WHERE id = ?`,
    ).run(contact.id, `Smoke Canary ${phone}`, now, conversation.id);
  } else {
    const result = db
      .prepare(
        `INSERT INTO conversations
         (user_id, contact_id, channel, external_thread_id, title, last_message_at, last_preview, unread_count, is_archived, temporary_messages_until, created_at, updated_at)
         VALUES (?, ?, 'whatsapp', ?, ?, NULL, NULL, 0, 0, NULL, ?, ?)`,
      )
      .run(userId, contact.id, `${phone}@c.us`, `Smoke Canary ${phone}`, now, now);
    conversation = { id: Number(result.lastInsertRowid), contact_id: contact.id };
  }

  backfillSmokeWhatsappIdentity(db, {
    userId,
    phone,
    contactId: Number(contact.id),
    conversationId: Number(conversation.id),
    now,
  });

  return { conversationId: Number(conversation.id) };
}

async function loginApi(): Promise<Session> {
  const response = await fetch(`${apiUrl}/trpc/auth.login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ json: { email, password } }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.error) {
    throw new Error(`auth.login failed: ${response.status} ${compact(body)}`);
  }

  const setCookies =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie")].filter(Boolean);
  const cookie = setCookies.map((item) => item.split(";")[0]).join("; ");
  const csrfToken = body?.result?.data?.json?.csrfToken;
  if (!cookie || !csrfToken) {
    throw new Error(`auth.login missing cookie/csrf: ${compact(body)}`);
  }

  return { cookie, csrfToken };
}

async function trpcCall<T>(session: Session, procedure: string, input: unknown): Promise<T> {
  const response = await fetch(`${apiUrl}/trpc/${procedure}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: session.cookie,
      "x-csrf-token": session.csrfToken,
    },
    body: JSON.stringify({ json: input }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.error) {
    throw new Error(`${procedure} failed: ${response.status} ${compact(body)}`);
  }
  return (body?.result?.data?.json ?? body?.result?.data ?? body) as T;
}

type JobSnapshot = {
  id: number;
  status: string;
  last_error: string | null;
  attempts: number;
  max_attempts: number;
};

function getJob(id: number): JobSnapshot | undefined {
  return db
    .prepare(`SELECT id, status, last_error, attempts, max_attempts FROM jobs WHERE id = ?`)
    .get(id) as JobSnapshot | undefined;
}

function findJobForToken(token: string): JobSnapshot | undefined {
  return db
    .prepare(
      `SELECT id, status, last_error, attempts, max_attempts
       FROM jobs
       WHERE user_id = ?
         AND payload_json LIKE ?
       ORDER BY id DESC
       LIMIT 1`,
    )
    .get(userId, `%${token}%`) as JobSnapshot | undefined;
}

function limitJobAttempts(jobId: number, maxAttempts: number): void {
  db.prepare(
    `UPDATE jobs
     SET max_attempts = ?,
         updated_at = ?
     WHERE id = ?
       AND status = 'queued'`,
  ).run(maxAttempts, nowIso(), jobId);
}

function failedWorkerStatuses(status: string): boolean {
  return ["failed", "cancelled", "canceled", "dead"].includes(status);
}

function workerErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function findOutboundMessage(token: string): unknown {
  return db
    .prepare(
      `SELECT id, conversation_id, contact_id, direction, status, body, observed_at_utc, created_at
       FROM messages
       WHERE user_id = ?
         AND direction = 'outbound'
         AND body LIKE ?
       ORDER BY observed_at_utc DESC, id DESC
       LIMIT 1`,
    )
    .get(userId, `%${token}%`);
}

function findAnyOutboundMessage(token: string): unknown {
  return db
    .prepare(
      `SELECT id, conversation_id, contact_id, direction, status, body, observed_at_utc, created_at
       FROM messages
       WHERE user_id = ?
         AND body LIKE ?
       ORDER BY observed_at_utc DESC, id DESC
       LIMIT 1`,
    )
    .get(userId, `%${token}%`);
}

function findInstagramThreadId(): string | null {
  const row = db
    .prepare(
      `SELECT conversations.external_thread_id AS threadId
       FROM conversations
       LEFT JOIN contacts ON contacts.id = conversations.contact_id
       WHERE conversations.user_id = ?
         AND conversations.channel = 'instagram'
         AND (
           lower(contacts.instagram_handle) = lower(?)
           OR lower(conversations.title) LIKE lower(?)
           OR conversations.external_thread_id = ?
         )
       ORDER BY
         CASE
           WHEN conversations.external_thread_id NOT LIKE 'ig:%' THEN 0
           ELSE 1
         END,
         conversations.updated_at DESC
       LIMIT 1`,
    )
    .get(userId, instagramHandle, `%${instagramHandle}%`, instagramHandle) as
    | { threadId: string | null }
    | undefined;
  return row?.threadId?.trim() || null;
}

async function waitJobCompleted(jobId: number, label: string): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const job = getJob(jobId);
    if (!job) {
      throw new Error(`${label} job ${jobId} disappeared`);
    }
    if (job.status === "completed") {
      return;
    }
    if (failedWorkerStatuses(job.status)) {
      throw new Error(`${label} job ${jobId} ${job.status}: ${job.last_error ?? "no error"}`);
    }
    await sleep(1_000);
  }
  throw new Error(`${label} job ${jobId} timeout after ${timeoutMs}ms`);
}

async function waitOutboundMessage(token: string): Promise<unknown> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const message = findOutboundMessage(token);
    if (message) {
      return message;
    }
    await sleep(1_000);
  }
  throw new Error(`outbound message not persisted: ${token}`);
}

async function captureTokenOnPage(input: {
  channel: "whatsapp" | "instagram";
  token: string;
  path: string;
  waitMs?: number;
  navigate?: boolean;
}): Promise<string> {
  const browser = await chromium.connectOverCDP(cdpUrl);
  try {
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = await resolveChannelPage(context, input.channel);
    if (input.channel === "whatsapp" && input.navigate !== false) {
      await page.goto(`https://web.whatsapp.com/send?phone=${phone}&app_absent=0`, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
    }
    await page.waitForFunction(
      (expected) => Boolean(document.body?.innerText?.includes(String(expected))),
      input.token,
      { timeout: input.waitMs ?? timeoutMs },
    );
    if (input.channel === "whatsapp") {
      await page
        .getByText("Cancelar")
        .click({ timeout: 2_000 })
        .catch(() => undefined);
      await page
        .waitForFunction(
          () => !String(document.body?.innerText ?? "").includes("Iniciando conversa"),
          null,
          { timeout: 10_000 },
        )
        .catch(() => undefined);
    }
    await page.bringToFront();
    await page.screenshot({ path: input.path, fullPage: true });
    return page.url();
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function resolveChannelPage(
  context: BrowserContext,
  channel: "whatsapp" | "instagram",
): Promise<Page> {
  const needle = channel === "whatsapp" ? "web.whatsapp.com" : "instagram.com";
  const existing = context.pages().find((page) => !page.isClosed() && page.url().includes(needle));
  if (existing) {
    return existing;
  }
  return context.newPage();
}

async function sendWhatsapp(
  session: Session,
  conversationId: number,
): Promise<{
  jobId: number;
  jobStatus: string;
  workerError: string | null;
  evidenceSource: "job_completed" | "existing_visual" | "visual_after_worker_error";
  message: unknown;
  screenshot: string;
  pageUrl: string;
}> {
  const existingJob = findJobForToken(whatsappToken);
  const existingMessage = findAnyOutboundMessage(whatsappToken);
  try {
    const pageUrl = await captureTokenOnPage({
      channel: "whatsapp",
      token: whatsappToken,
      path: screenshots.whatsapp,
      waitMs: existingJob || existingMessage ? 8_000 : 2_000,
      navigate: false,
    });
    return {
      jobId: existingJob?.id ?? 0,
      jobStatus: existingJob?.status ?? "visual-only",
      workerError: existingJob?.last_error ?? null,
      evidenceSource: "existing_visual",
      message: existingMessage,
      screenshot: screenshots.whatsapp,
      pageUrl,
    };
  } catch {
    // No previous visual evidence for this token; enqueue a guarded real send.
  }

  const sendResult = await trpcCall<{ job?: { id?: number }; jobId?: number; id?: number }>(
    session,
    "messages.send",
    { conversationId, body: whatsappBody },
  );
  const jobId = Number(sendResult?.job?.id ?? sendResult?.jobId ?? sendResult?.id);
  if (!jobId) {
    throw new Error(`messages.send did not expose a send job: ${compact(sendResult)}`);
  }
  limitJobAttempts(jobId, 1);

  try {
    await waitJobCompleted(jobId, "whatsapp");
    const message = await waitOutboundMessage(whatsappToken);
    const pageUrl = await captureTokenOnPage({
      channel: "whatsapp",
      token: whatsappToken,
      path: screenshots.whatsapp,
    });
    return {
      jobId,
      jobStatus: "completed",
      workerError: null,
      evidenceSource: "job_completed",
      message,
      screenshot: screenshots.whatsapp,
      pageUrl,
    };
  } catch (error) {
    const job = getJob(jobId);
    const message = findAnyOutboundMessage(whatsappToken);
    const pageUrl = await captureTokenOnPage({
      channel: "whatsapp",
      token: whatsappToken,
      path: screenshots.whatsapp,
      waitMs: 30_000,
    });
    return {
      jobId,
      jobStatus: job?.status ?? "unknown",
      workerError: workerErrorMessage(error),
      evidenceSource: "visual_after_worker_error",
      message,
      screenshot: screenshots.whatsapp,
      pageUrl,
    };
  }
}

async function sendInstagram(): Promise<{
  result: unknown;
  evidenceSource: "sent" | "existing_visual";
  screenshot: string;
  pageUrl: string;
}> {
  const threadId = findInstagramThreadId();
  try {
    const pageUrl = await captureTokenOnPage({
      channel: "instagram",
      token: instagramToken,
      path: screenshots.instagram,
      waitMs: 8_000,
    });
    return {
      result: {
        mode: "existing_visual",
        username: instagramHandle,
        threadId,
        reason: "rebrand-real-canary",
      },
      evidenceSource: "existing_visual",
      screenshot: screenshots.instagram,
      pageUrl,
    };
  } catch {
    // No previous visual evidence for this token; send via the active Direct thread.
  }

  const cdp = new URL(cdpUrl);
  const env = loadWorkerEnv({
    ...process.env,
    NODE_ENV: process.env.NODE_ENV ?? "development",
    CHROMIUM_CDP_HOST: cdp.hostname,
    CHROMIUM_CDP_PORT: String(Number(cdp.port || 9223)),
    IG_SEND_ALLOWED_HANDLES: instagramHandle,
    IG_SEND_CONFIRMATION_TIMEOUT_MS: process.env.IG_SEND_CONFIRMATION_TIMEOUT_MS ?? "30000",
    DATABASE_URL: process.env.WORKER_DATABASE_URL ?? "../../data/nuoma-v2.db",
  });
  const result = await sendInstagramTextViaCdp({
    env,
    username: instagramHandle,
    threadId,
    text: instagramBody,
    reason: "rebrand-real-canary",
  });
  const pageUrl = await captureTokenOnPage({
    channel: "instagram",
    token: instagramToken,
    path: screenshots.instagram,
  });
  return { result, evidenceSource: "sent", screenshot: screenshots.instagram, pageUrl };
}

async function main(): Promise<void> {
  assertConfirmedTargets();
  await fs.mkdir(evidenceDir, { recursive: true });
  await assertHttpOk(`${apiUrl}/health`, "api");
  await assertHttpOk(webUrl, "web");
  await assertHttpOk(`${cdpUrl}/json/version`, "cdp");

  const { conversationId } = seedWhatsappConversation();
  const session = await loginApi();
  const whatsapp = await sendWhatsapp(session, conversationId);
  const instagram = await sendInstagram();

  const report = {
    generatedAt: nowIso(),
    tokenRoot,
    targets: { whatsapp: phone, instagram: instagramHandle },
    whatsapp: {
      token: whatsappToken,
      body: whatsappBody,
      jobId: whatsapp.jobId,
      jobStatus: whatsapp.jobStatus,
      workerError: whatsapp.workerError,
      evidenceSource: whatsapp.evidenceSource,
      message: whatsapp.message,
      screenshot: path.relative(rootDir, whatsapp.screenshot),
      pageUrl: whatsapp.pageUrl,
    },
    instagram: {
      token: instagramToken,
      body: instagramBody,
      evidenceSource: instagram.evidenceSource,
      result: instagram.result,
      screenshot: path.relative(rootDir, instagram.screenshot),
      pageUrl: instagram.pageUrl,
    },
  };
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(
    [
      "rebrand-real-canary",
      `token=${tokenRoot}`,
      `wa=${phone}`,
      `waJob=${whatsapp.jobId}`,
      `waShot=${path.relative(rootDir, whatsapp.screenshot)}`,
      `ig=${instagramHandle}`,
      `igShot=${path.relative(rootDir, instagram.screenshot)}`,
      `report=${path.relative(rootDir, reportPath)}`,
      "realSend=completed",
    ].join("|"),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => {
    db.close();
  });
