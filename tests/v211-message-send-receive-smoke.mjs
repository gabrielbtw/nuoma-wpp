import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { chromium } from "playwright";

const rootDir = process.cwd();
const dataDir = path.join(rootDir, "data");
const dbPath = process.env.DATABASE_URL ?? path.join(dataDir, "nuoma-v2.db");
const apiUrl = process.env.API_URL ?? "http://127.0.0.1:3001";
const webUrl = process.env.WEB_URL ?? "http://127.0.0.1:3002";
const cdpUrl = process.env.CDP_URL ?? "http://127.0.0.1:9223";
const email = process.env.SMOKE_EMAIL ?? "admin@nuoma.local";
const password = process.env.SMOKE_PASSWORD ?? "nuoma-dev-admin-123";
const userId = Number(process.env.SMOKE_USER_ID ?? 1);
const phone = process.env.SMOKE_PHONE ?? "5531982066263";
const sendToken = process.env.SEND_TOKEN ?? `TX-MSG-${Date.now()}`;
const replyToken = process.env.REPLY_TOKEN ?? `RX-MSG-${Date.now()}`;
const inboundTimeoutMs = Number(process.env.INBOUND_TIMEOUT_MS ?? 240_000);
const outboundTimeoutMs = Number(process.env.OUTBOUND_TIMEOUT_MS ?? 180_000);
const requireInbound = process.env.REQUIRE_INBOUND !== "0";
const skipSend = process.env.SKIP_SEND === "1";
const sendBody = process.env.SEND_BODY ?? `Smoke real V2.11 envio ${sendToken}`;

const screenshots = {
  app: path.join(dataDir, "v211-message-send-receive-app.png"),
  wppOutbound: path.join(dataDir, "v211-message-send-receive-wpp-outbound.png"),
  wppInbound: path.join(dataDir, "v211-message-send-receive-wpp-inbound.png"),
};

fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(dbPath);
db.pragma("busy_timeout = 5000");

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function compact(value) {
  return JSON.stringify(value).replace(/\s+/g, " ");
}

async function assertHttpOk(url, label) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${label} not ok: ${response.status}`);
  }
}

function seedConversation() {
  const now = nowIso();
  let contact = db
    .prepare(
      `SELECT * FROM contacts
       WHERE user_id = ? AND deleted_at IS NULL AND phone = ?
       ORDER BY id ASC LIMIT 1`,
    )
    .get(userId, phone);

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
      .run(userId, `Smoke Canary ${phone}`, phone, "Contato canario para smoke real de envio/recepcao.", now, now);
    contact = { id: Number(result.lastInsertRowid), phone };
  }

  let conversation = db
    .prepare(
      `SELECT c.*
       FROM conversations c
       LEFT JOIN contacts ct ON ct.id = c.contact_id
       WHERE c.user_id = ?
         AND c.channel = 'whatsapp'
         AND (
           c.contact_id = ?
           OR c.external_thread_id = ?
           OR c.external_thread_id = ?
           OR ct.phone = ?
         )
       ORDER BY c.last_message_at DESC NULLS LAST, c.id ASC
       LIMIT 1`,
    )
    .get(userId, contact.id, phone, `${phone}@c.us`, phone);

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

  return { contactId: Number(contact.id), conversationId: Number(conversation.id) };
}

async function loginApi() {
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

async function trpcCall(session, procedure, input) {
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
  return body?.result?.data?.json ?? body?.result?.data ?? body;
}

function findLatestSendJobId() {
  const row = db
    .prepare(
      `SELECT id
       FROM jobs
       WHERE user_id = ? AND type = 'send_message' AND payload_json LIKE ?
       ORDER BY id DESC LIMIT 1`,
    )
    .get(userId, `%${sendToken}%`);
  return row ? Number(row.id) : null;
}

function getJob(id) {
  return db
    .prepare(
      `SELECT id, type, status, attempts, last_error, completed_at, payload_json
       FROM jobs WHERE id = ?`,
    )
    .get(id);
}

async function waitJobCompleted(jobId, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const job = getJob(jobId);
    if (!job) {
      throw new Error(`${label} job ${jobId} disappeared`);
    }
    if (job.status === "completed") {
      return job;
    }
    if (["failed", "cancelled", "canceled", "dead"].includes(job.status)) {
      throw new Error(`${label} job ${jobId} ${job.status}: ${job.last_error ?? "no error"}`);
    }
    await sleep(1_000);
  }
  throw new Error(`${label} job ${jobId} timeout after ${timeoutMs}ms`);
}

function findMessageToken(direction, token) {
  return db
    .prepare(
      `SELECT id, conversation_id, contact_id, direction, status, body, observed_at_utc, created_at
       FROM messages
       WHERE user_id = ?
         AND direction = ?
         AND body LIKE ?
       ORDER BY observed_at_utc DESC, id DESC
       LIMIT 1`,
    )
    .get(userId, direction, `%${token}%`);
}

function activeSendJobsCount() {
  return db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM jobs
       WHERE user_id = ? AND type = 'send_message' AND status IN ('queued', 'running')`,
    )
    .get(userId).count;
}

function enqueueInboundSync(token) {
  const now = nowIso();
  const payload = JSON.stringify({ phone, smoke: "v211-message-send-receive", token });
  const result = db
    .prepare(
      `
        INSERT INTO jobs (
          user_id, type, status, payload_json, priority, scheduled_at, claimed_at,
          claimed_by, attempts, max_attempts, created_at, updated_at
        )
        VALUES (
          ?, 'sync_inbox_force', 'queued', ?, 0, ?, NULL,
          NULL, 0, 3, ?, ?
        )
      `,
    )
    .run(userId, payload, now, now, now);
  return Number(result.lastInsertRowid);
}

async function requestForceSync(session, conversationId) {
  const before = db.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM jobs").get().id;
  await trpcCall(session, "conversations.forceSync", { conversationId }).catch(() => null);
  const job = db
    .prepare(
      `SELECT id
       FROM jobs
       WHERE id > ?
         AND user_id = ?
         AND payload_json LIKE ?
       ORDER BY id DESC LIMIT 1`,
    )
    .get(before, userId, `%"conversationId":${conversationId}%`);
  if (job?.id) {
    await waitJobCompleted(Number(job.id), 60_000, "forceSync").catch(() => null);
  }
}

async function waitForMessage(session, direction, token, timeoutMs, conversationId) {
  const started = Date.now();
  let nextSyncAt = 0;
  while (Date.now() - started < timeoutMs) {
    const message = findMessageToken(direction, token);
    if (message) {
      return message;
    }
    if (Date.now() >= nextSyncAt) {
      if (direction === "inbound") {
        const jobId = enqueueInboundSync(token);
        await waitJobCompleted(jobId, 60_000, "inboundSync").catch(() => null);
      } else {
        await requestForceSync(session, conversationId);
      }
      nextSyncAt = Date.now() + 10_000;
    }
    await sleep(1_500);
  }
  return null;
}

async function captureWhatsAppToken(token, filePath, timeoutMs) {
  const browser = await chromium.connectOverCDP(cdpUrl);
  try {
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages().find((item) => item.url().startsWith("https://web.whatsapp.com")) ?? (await context.newPage());
    await page.goto(`https://web.whatsapp.com/send?phone=${phone}&app_absent=0`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForFunction(
      (expected) => document.body?.innerText?.includes(expected),
      token,
      { timeout: timeoutMs },
    );
    await page.screenshot({ path: filePath, fullPage: true });
  } finally {
    // Do not close the browser attached through CDP; the worker owns that session.
  }
}

async function captureApp(filePath) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    await page.goto(`${webUrl}/login`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    const emailInput = page.locator('input[type="email"], input[name="email"]').first();
    const passwordInput = page.locator('input[type="password"], input[name="password"]').first();
    if ((await emailInput.count()) > 0 && (await passwordInput.count()) > 0) {
      await emailInput.fill(email);
      await passwordInput.fill(password);
      await page.locator('button[type="submit"], button:has-text("Entrar")').first().click();
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => null);
    }
    await page.goto(`${webUrl}/inbox`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => null);
    const search = page.locator('input[type="search"], input[placeholder*="Buscar"], input[placeholder*="busca" i]').first();
    if ((await search.count()) > 0) {
      await search.fill(phone);
      await page.waitForTimeout(1_000);
    }
    await page.screenshot({ path: filePath, fullPage: true });
  } finally {
    await browser.close();
  }
}

async function main() {
  await assertHttpOk(`${apiUrl}/health`, "api");
  await assertHttpOk(`${webUrl}`, "web");

  const { conversationId } = seedConversation();
  const session = await loginApi();
  const activeBefore = activeSendJobsCount();

  let sendJobId = null;
  let outboundMessage = findMessageToken("outbound", sendToken);
  if (!skipSend) {
    const sendResult = await trpcCall(session, "messages.send", { conversationId, body: sendBody });
    sendJobId = Number(sendResult?.job?.id ?? sendResult?.jobId ?? sendResult?.id ?? findLatestSendJobId());
    if (!sendJobId) {
      throw new Error(`messages.send did not expose a send job: ${compact(sendResult)}`);
    }

    await waitJobCompleted(sendJobId, outboundTimeoutMs, "send_message");
    await requestForceSync(session, conversationId);
    outboundMessage = await waitForMessage(session, "outbound", sendToken, outboundTimeoutMs, conversationId);
    if (!outboundMessage) {
      throw new Error(`outbound message with token ${sendToken} was not persisted`);
    }

    await captureWhatsAppToken(sendToken, screenshots.wppOutbound, 90_000);
    await captureApp(screenshots.app);
    console.log(
      [
        "v211-message-send-receive",
        "stage=outbound_completed",
        `phone=${phone}`,
        `realSend=completed`,
        `sendJob=${sendJobId}`,
        `sendToken=${sendToken}`,
        `replyToken=${replyToken}`,
        `outboundDb=1`,
        `wppOutbound=1`,
        "ig=nao_aplicavel",
      ].join("|"),
    );
  } else {
    await requestForceSync(session, conversationId);
    console.log(
      [
        "v211-message-send-receive",
        "stage=inbound_only_wait",
        `phone=${phone}`,
        `sendToken=${sendToken}`,
        `replyToken=${replyToken}`,
        `outboundDb=${outboundMessage ? 1 : 0}`,
        "ig=nao_aplicavel",
      ].join("|"),
    );
  }

  if (requireInbound) {
    console.log(
      [
        "v211-message-send-receive",
        "stage=waiting_inbound",
        `phone=${phone}`,
        `replyToken=${replyToken}`,
        `timeoutMs=${inboundTimeoutMs}`,
        "instruction=envie este token do celular para o WhatsApp Business",
        "ig=nao_aplicavel",
      ].join("|"),
    );
  }

  const inboundMessage = await waitForMessage(session, "inbound", replyToken, inboundTimeoutMs, conversationId);
  if (!inboundMessage && requireInbound) {
    throw new Error(`inbound reply with token ${replyToken} was not received within ${inboundTimeoutMs}ms`);
  }
  if (inboundMessage) {
    await captureWhatsAppToken(replyToken, screenshots.wppInbound, 90_000);
  }

  const activeAfter = activeSendJobsCount();
  console.log(
    [
      "v211-message-send-receive",
      `mode=${skipSend ? "inbound_only" : "send_receive"}`,
      `phone=${phone}`,
      `realSend=${skipSend ? "skipped" : "completed"}`,
      `sendJob=${sendJobId ?? "skipped"}`,
      `sendToken=${sendToken}`,
      `outboundDb=${outboundMessage ? 1 : 0}`,
      `wppOutbound=1`,
      `replyToken=${replyToken}`,
      `inboundDb=${inboundMessage ? 1 : 0}`,
      `wppInbound=${inboundMessage ? 1 : 0}`,
      `activeSendJobsBefore=${activeBefore}`,
      `activeSendJobsAfter=${activeAfter}`,
      `app=${path.relative(rootDir, screenshots.app)}`,
      `wppOutboundShot=${path.relative(rootDir, screenshots.wppOutbound)}`,
      `wppInboundShot=${inboundMessage ? path.relative(rootDir, screenshots.wppInbound) : "nao_gerado"}`,
      "ig=nao_aplicavel",
    ].join("|"),
  );
}

main()
  .then(() => {
    db.close();
    process.exit(0);
  })
  .catch((error) => {
    db.close();
    console.error(`v211-message-send-receive|failed|sendToken=${sendToken}|replyToken=${replyToken}|ig=nao_aplicavel|error=${error.message}`);
    process.exit(1);
  });
