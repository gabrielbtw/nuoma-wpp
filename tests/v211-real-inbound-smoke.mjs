import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import Database from "better-sqlite3";
import { chromium } from "playwright";

const execFileAsync = promisify(execFile);
const rootDir = process.cwd();
const dataDir = path.join(rootDir, "data");
const dbPath = process.env.DATABASE_URL ?? path.join(dataDir, "nuoma-v2.db");
const cdpUrl = process.env.CDP_URL ?? "http://127.0.0.1:9223";
const phone = process.env.SMOKE_PHONE ?? "5531982066263";
const token = process.env.SMOKE_INBOUND_TOKEN ?? `INB-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(2, 14)}`;
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS ?? 300_000);
const screenshot = path.join(dataDir, "v211-real-inbound-wpp.png");

const db = new Database(dbPath);
db.pragma("busy_timeout = 5000");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function inboundRow() {
  return db
    .prepare(
      `SELECT id, conversation_id, direction, content_type, body, external_id, status, observed_at_utc, created_at
       FROM messages
       WHERE direction = 'inbound'
         AND body LIKE ?
       ORDER BY id DESC
       LIMIT 1`,
    )
    .get(`%${token}%`);
}

function nowIso() {
  return new Date().toISOString();
}

function enqueueInboundSync() {
  const now = nowIso();
  const payload = JSON.stringify({ phone, smoke: "v211-real-inbound", token });
  const result = db
    .prepare(
      `
        INSERT INTO jobs (
          user_id, type, status, payload_json, priority, scheduled_at, claimed_at,
          claimed_by, attempts, max_attempts, created_at, updated_at
        )
        VALUES (
          1, 'sync_inbox_force', 'queued', @payload, 0, @now, NULL,
          NULL, 0, 3, @now, @now
        )
      `,
    )
    .run({ payload, now });
  return Number(result.lastInsertRowid);
}

function syncJobRow(jobId) {
  return db
    .prepare(
      `SELECT id, type, status, attempts, last_error, completed_at
       FROM jobs
       WHERE id = ?`,
    )
    .get(jobId);
}

async function captureDesktopScreenshot(targetPath) {
  await execFileAsync("screencapture", ["-x", targetPath], { timeout: 30_000 });
}

async function waitDbInbound(syncJobId) {
  const started = Date.now();
  let completedWithoutRowAt = null;
  while (Date.now() - started < timeoutMs) {
    const row = inboundRow();
    if (row) return row;
    const job = syncJobRow(syncJobId);
    if (job?.status === "dead" || job?.status === "failed") {
      throw new Error(`inbound sync job ${syncJobId} failed before persistence: ${job.last_error ?? "unknown"}`);
    }
    if (job?.status === "completed") {
      completedWithoutRowAt ??= Date.now();
      if (Date.now() - completedWithoutRowAt > 10_000) {
        throw new Error(`inbound sync job ${syncJobId} completed but token was not persisted: ${token}`);
      }
    }
    await sleep(1_000);
  }
  throw new Error(`inbound token reached WhatsApp visual proof but was not persisted in messages table: ${token}`);
}

async function main() {
  console.log(`v211-real-inbound|waiting|phone=${phone}|token=${token}|instruction=envie este token do celular para o WhatsApp Business`);

  const browser = await chromium.connectOverCDP(cdpUrl);
  try {
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages().find((item) => item.url().startsWith("https://web.whatsapp.com")) ?? (await context.newPage());
    const onTargetChat = await page
      .evaluate((expectedPhone) => {
        const normalized = String(expectedPhone || "").replace(/\D/g, "");
        const hrefPhone = new URL(location.href).searchParams.get("phone")?.replace(/\D/g, "") ?? "";
        const text = String(document.querySelector("#main header")?.textContent || document.body?.innerText || "");
        return hrefPhone === normalized || text.replace(/\D/g, "").includes(normalized.slice(-8));
      }, phone)
      .catch(() => false);
    if (!onTargetChat) {
      await page.goto(`https://web.whatsapp.com/send?phone=${phone}&app_absent=0`, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
    }
    await page.waitForFunction(() => Boolean(document.body?.innerText?.trim()), { timeout: 90_000 });
    await page.keyboard.press("End").catch(() => null);
    await page.waitForFunction(
      (expectedToken) => {
        function isVisible(node) {
          if (!node) return false;
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
        }
        return Array.from(document.querySelectorAll("#main .message-in")).some(
          (node) => isVisible(node) && String(node.textContent || "").includes(expectedToken),
        );
      },
      token,
      { timeout: timeoutMs },
    );
    await page.bringToFront();
    await page.waitForTimeout(1_000);
    await captureDesktopScreenshot(screenshot);
  } finally {
    // Do not close the browser attached through CDP; the worker owns that session.
  }

  const syncJobId = enqueueInboundSync();
  const row = await waitDbInbound(syncJobId);
  console.log(
    [
      "v211-real-inbound",
      `phone=${phone}`,
      `token=${token}`,
      `visual=1`,
      `db=1`,
      `syncJob=${syncJobId}`,
      `message=${row.id}`,
      `conversation=${row.conversation_id}`,
      `externalId=${row.external_id ?? "null"}`,
      `wpp=${path.relative(rootDir, screenshot)}`,
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
    console.error(`v211-real-inbound|failed|phone=${phone}|token=${token}|ig=nao_aplicavel|error=${error.message}`);
    process.exit(1);
  });
