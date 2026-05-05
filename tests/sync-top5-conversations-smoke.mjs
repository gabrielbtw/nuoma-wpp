import AxeBuilder from "@axe-core/playwright";
import Database from "better-sqlite3";
import { chromium } from "playwright";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const webUrl = process.env.WEB_URL ?? "http://127.0.0.1:3002";
const apiUrl = process.env.API_URL ?? "http://127.0.0.1:3001";
const email = process.env.SMOKE_EMAIL ?? "admin@nuoma.local";
const password = process.env.SMOKE_PASSWORD ?? "nuoma-dev-admin-123";
const databaseUrl = path.resolve(process.env.DATABASE_URL ?? "data/nuoma-v2.db");
const appScreenshotPath = process.env.APP_SCREENSHOT_PATH ?? "data/sync-top5-m29-app.png";
const wppScreenshotPath = process.env.WPP_SCREENSHOT_PATH ?? "data/sync-top5-m29-wpp.png";
const cdpUrl = process.env.CDP_URL ?? "http://127.0.0.1:9223";
const whatsappUrl = process.env.WA_WEB_URL ?? "https://web.whatsapp.com/";
const maxScrolls = Number(process.env.SYNC_TOP5_MAX_SCROLLS ?? 25);
const delayMs = Number(process.env.SYNC_TOP5_DELAY_MS ?? 250);

async function main() {
  await assertHttp(`${webUrl}/`, "web");
  await assertHttp(`${apiUrl}/health`, "api");
  await fs.mkdir(path.dirname(appScreenshotPath), { recursive: true });
  await fs.mkdir(path.dirname(wppScreenshotPath), { recursive: true });

  const login = await loginApi();
  const sendJobsBefore = countActiveSendJobs();
  const snapshotBefore = conversationSnapshot();

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 980 } });
    const page = await context.newPage();
    await loginWeb(page);
    await page.goto(`${webUrl}/inbox`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("inbox-conversation-list").waitFor({ state: "visible" });

    const { conversations, skipped } = await readFirstSyncableConversations(page);
    if (conversations.length < 5) {
      throw new Error(`expected 5 syncable visible conversations, got ${conversations.length}`);
    }

    const jobs = [];
    for (const conversation of conversations) {
      const record = getConversation(conversation.id);
      const phone = normalizePhone(record.external_thread_id);
      const result = await trpcCall(login, "POST", "conversations.forceHistorySync", {
        id: conversation.id,
        phone: phone.length >= 8 ? phone : undefined,
        maxScrolls,
        delayMs,
      });
      if (result.statusCode !== 200 || !result.data?.job?.id) {
        throw new Error(
          `could not enqueue sync_history for ${conversation.id}: ${JSON.stringify(result)}`,
        );
      }
      jobs.push({
        conversationId: conversation.id,
        label: conversation.label,
        phone: phone || null,
        jobId: result.data.job.id,
      });
    }

    const completed = await waitForJobs(
      jobs.map((job) => job.jobId),
      420_000,
    );
    const snapshotAfter = conversationSnapshot();
    const sendJobsAfter = countActiveSendJobs();
    if (sendJobsAfter !== sendJobsBefore) {
      throw new Error(
        `sync created/activated send jobs: before=${sendJobsBefore} after=${sendJobsAfter}`,
      );
    }

    await page.goto(`${webUrl}/inbox`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("inbox-conversation-list").waitFor({ state: "visible" });
    await page.screenshot({ path: appScreenshotPath, fullPage: false });

    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const blocking = axe.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious",
    );
    if (blocking.length > 0) {
      throw new Error(
        `sync top5 inbox has blocking a11y violations: ${blocking
          .map((violation) => `${violation.id}:${violation.impact}`)
          .join(", ")}`,
      );
    }
    await context.close();

    const wppMode = await captureWhatsAppPrint(wppScreenshotPath);
    const results = jobs.map((job) => {
      const before = snapshotBefore.get(job.conversationId);
      const after = snapshotAfter.get(job.conversationId);
      const terminal = completed.get(job.jobId);
      const event = syncEventForJob(job.jobId);
      return {
        ...job,
        status: terminal?.status ?? "missing",
        messagesBefore: before?.messages ?? 0,
        messagesAfter: after?.messages ?? 0,
        delta: (after?.messages ?? 0) - (before?.messages ?? 0),
        history: event?.history ?? null,
        mode: event?.mode ?? null,
      };
    });
    const failed = results.filter((result) => result.status !== "completed");
    if (failed.length > 0) {
      throw new Error(`sync jobs did not complete: ${JSON.stringify(failed)}`);
    }

    console.log(
      `sync-top5|jobs=${jobs.map((job) => job.jobId).join(",")}|conversations=${jobs
        .map((job) => job.conversationId)
        .join(
          ",",
        )}|completed=${results.length}|skipped=${JSON.stringify(skipped)}|sendJobsDelta=${sendJobsAfter - sendJobsBefore}|blocking=${blocking.length}|app=${appScreenshotPath}|wpp=${wppScreenshotPath}|wppMode=${wppMode}|ig=nao_aplicavel|results=${JSON.stringify(results)}`,
    );
  } finally {
    await browser.close();
  }
}

async function readFirstSyncableConversations(page) {
  const conversations = [];
  const skipped = [];
  const seen = new Set();

  for (let scroll = 0; scroll < 8 && conversations.length < 5; scroll += 1) {
    const rows = page.getByTestId("inbox-conversation-row");
    await rows.first().waitFor({ state: "visible", timeout: 10_000 });
    const rowCount = await rows.count();
    for (let index = 0; index < rowCount && conversations.length < 5; index += 1) {
      const row = rows.nth(index);
      const id = Number(await row.getAttribute("data-conv"));
      if (!Number.isInteger(id) || seen.has(id)) continue;
      seen.add(id);
      const label = firstLine(await row.innerText());
      const record = getConversation(id);
      const phone = normalizePhone(record?.external_thread_id);
      if (isSyntheticSmoke(label, record) || phone.length < 10) {
        skipped.push({
          id,
          label,
          reason: isSyntheticSmoke(label, record) ? "smoke_fixture" : "no_phone",
        });
        continue;
      }
      conversations.push({ id, label });
    }

    if (conversations.length < 5) {
      await page.getByTestId("inbox-conversation-virtual-scroll").evaluate((node) => {
        node.scrollTop += node.clientHeight;
      });
      await page.waitForTimeout(250);
    }
  }

  return { conversations, skipped };
}

function isSyntheticSmoke(label, record) {
  const text = `${label ?? ""} ${record?.title ?? ""} ${record?.last_preview ?? ""}`.toLowerCase();
  return text.includes("smoke") || text.includes("v2.9.") || text.includes("v2.10.");
}

async function loginWeb(page) {
  await page.goto(`${webUrl}/login`, { waitUntil: "networkidle" });
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${webUrl}/`);
}

async function loginApi() {
  const response = await fetch(`${apiUrl}/trpc/auth.login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ json: { email, password } }),
  });
  const body = await response.json();
  const csrfToken = body?.result?.data?.json?.csrfToken;
  if (!response.ok || !csrfToken) {
    throw new Error(`login failed: ${response.status} ${JSON.stringify(body)}`);
  }
  const setCookies =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : splitSetCookie(response.headers.get("set-cookie") ?? "");
  return {
    csrfToken,
    cookie: setCookies.map((cookie) => cookie.split(";")[0]).join("; "),
  };
}

async function trpcCall(login, method, procedure, input) {
  const headers = {
    "content-type": "application/json",
    cookie: login.cookie,
    "x-csrf-token": login.csrfToken,
  };
  const response = await fetch(`${apiUrl}/trpc/${procedure}`, {
    method,
    headers,
    body: JSON.stringify({ json: input }),
  });
  const body = await response.json().catch(() => ({}));
  return {
    statusCode: response.status,
    data: body?.result?.data?.json,
    error: body?.error?.json,
  };
}

function splitSetCookie(value) {
  if (!value) return [];
  return value.split(/,(?=\s*[^;,\s]+=)/g).map((item) => item.trim());
}

function getConversation(id) {
  const db = new Database(databaseUrl, { readonly: true });
  try {
    return db
      .prepare(
        "SELECT id, title, external_thread_id, last_preview FROM conversations WHERE id = ? AND user_id = 1",
      )
      .get(id);
  } finally {
    db.close();
  }
}

function conversationSnapshot() {
  const db = new Database(databaseUrl, { readonly: true });
  try {
    const rows = db
      .prepare(
        `
          SELECT c.id, COUNT(m.id) AS messages
          FROM conversations c
          LEFT JOIN messages m ON m.conversation_id = c.id AND m.deleted_at IS NULL
          WHERE c.user_id = 1
          GROUP BY c.id
        `,
      )
      .all();
    return new Map(rows.map((row) => [Number(row.id), { messages: Number(row.messages ?? 0) }]));
  } finally {
    db.close();
  }
}

function countActiveSendJobs() {
  const db = new Database(databaseUrl, { readonly: true });
  try {
    const row = db
      .prepare(
        `
          SELECT COUNT(*) AS total
          FROM jobs
          WHERE user_id = 1
            AND type IN ('send_message', 'send_instagram_message', 'send_voice', 'send_document', 'campaign_step', 'chatbot_reply')
            AND status IN ('queued', 'claimed', 'running')
        `,
      )
      .get();
    return Number(row?.total ?? 0);
  } finally {
    db.close();
  }
}

async function waitForJobs(jobIds, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const terminal = new Map();
  while (Date.now() < deadline) {
    const db = new Database(databaseUrl, { readonly: true });
    try {
      const rows = db
        .prepare(
          `SELECT id, status, attempts, last_error FROM jobs WHERE id IN (${jobIds
            .map(() => "?")
            .join(",")})`,
        )
        .all(...jobIds);
      for (const row of rows) {
        if (["completed", "failed", "cancelled"].includes(row.status)) {
          terminal.set(Number(row.id), row);
        }
      }
      if (terminal.size === jobIds.length) {
        return terminal;
      }
    } finally {
      db.close();
    }
    await sleep(2_000);
  }
  throw new Error(`timed out waiting for sync jobs ${jobIds.join(",")}`);
}

function syncEventForJob(jobId) {
  const db = new Database(databaseUrl, { readonly: true });
  try {
    const row = db
      .prepare(
        `
          SELECT payload_json
          FROM system_events
          WHERE user_id = 1
            AND type = 'sync.force_conversation.completed'
            AND payload_json LIKE ?
          ORDER BY id DESC
          LIMIT 1
        `,
      )
      .get(`%"jobId":${jobId}%`);
    return row ? JSON.parse(row.payload_json) : null;
  } finally {
    db.close();
  }
}

async function captureWhatsAppPrint(outputPath) {
  const browser = await chromium.connectOverCDP(cdpUrl);
  try {
    const context = browser.contexts()[0] ?? (await browser.newContext());
    let page = context.pages().find((candidate) => candidate.url().startsWith(whatsappUrl));
    page ??= context.pages()[0] ?? (await context.newPage());
    if (!page.url().startsWith(whatsappUrl)) {
      await page.goto(whatsappUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.waitForTimeout(2_000);
    await page.screenshot({ path: outputPath, fullPage: false, timeout: 20_000 });
    return "cdp";
  } finally {
    await browser.close();
  }
}

async function assertHttp(url, label) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${label} not ready: ${response.status} ${url}`);
  }
}

function firstLine(text) {
  return (
    String(text ?? "")
      .split(/\n/)[0]
      ?.trim() ?? ""
  );
}

function normalizePhone(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
