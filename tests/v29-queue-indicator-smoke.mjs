import AxeBuilder from "@axe-core/playwright";
import Database from "better-sqlite3";
import { chromium } from "playwright";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const webUrl = process.env.WEB_URL ?? "http://127.0.0.1:3002";
const apiUrl = process.env.API_URL ?? "http://127.0.0.1:3001";
const email = process.env.SMOKE_EMAIL ?? "admin@nuoma.local";
const password = process.env.SMOKE_PASSWORD ?? "nuoma-dev-admin-123";
const appScreenshotPath = process.env.APP_SCREENSHOT_PATH ?? "data/v29-queue-indicator-m17-app.png";
const wppScreenshotPath = process.env.WPP_SCREENSHOT_PATH ?? "data/v29-queue-indicator-m17-wpp.png";
const databaseUrl = path.resolve(process.env.DATABASE_URL ?? "data/nuoma-v2.db");
const cdpUrl = process.env.CDP_URL ?? "http://127.0.0.1:9223";
const whatsappUrl = process.env.WA_WEB_URL ?? "https://web.whatsapp.com/";
const chromiumProfileDir = path.resolve(
  process.env.CHROMIUM_PROFILE_DIR ?? "data/chromium-profile/whatsapp",
);
const wppScreenshotProfileDir = path.resolve(
  process.env.WPP_SCREENSHOT_PROFILE_DIR ?? "data/tmp/wpp-profile-screenshot",
);
const smokePhone = "5531999999620";
const smokeTitle = "V2.9.20 Queue Indicator Smoke";
const smokeMarker = "V2.9.20 Queue Indicator Smoke";

async function main() {
  await assertHttp(`${webUrl}/`, "web");
  await assertHttp(`${apiUrl}/health`, "api");
  await fs.mkdir(path.dirname(appScreenshotPath), { recursive: true });
  await fs.mkdir(path.dirname(wppScreenshotPath), { recursive: true });
  const conversationId = seedQueueFixture();

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    await page.goto(`${webUrl}/login`, { waitUntil: "networkidle" });
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.click('button[type="submit"]');
    await page.waitForURL(`${webUrl}/`);

    await page.goto(`${webUrl}/inbox`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("inbox-conversation-list").waitFor({ state: "visible" });
    await page.getByPlaceholder("Buscar conversa…").fill(smokeTitle);
    const smokeRow = page.getByTestId("inbox-conversation-row").filter({ hasText: smokeTitle });
    await smokeRow.waitFor({ state: "visible", timeout: 10_000 });
    await smokeRow.click();

    const indicator = page.getByTestId("conversation-queue-indicator");
    await indicator.waitFor({ state: "visible", timeout: 10_000 });
    await waitForAttribute(indicator, "data-queue-count", "3", 10_000);
    const queueCount = await indicator.getAttribute("data-queue-count");
    const queued = await indicator.getAttribute("data-queue-queued");
    const claimed = await indicator.getAttribute("data-queue-claimed");
    const running = await indicator.getAttribute("data-queue-running");
    if (queueCount !== "3" || queued !== "1" || claimed !== "1" || running !== "1") {
      throw new Error(
        `unexpected queue indicator: total=${queueCount} queued=${queued} claimed=${claimed} running=${running}`,
      );
    }
    await indicator.getByText("Fila 3 jobs").waitFor({ state: "visible", timeout: 10_000 });

    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const blocking = result.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious",
    );
    await page.screenshot({ path: appScreenshotPath, fullPage: true });
    if (blocking.length > 0) {
      throw new Error(
        `queue indicator inbox has blocking a11y violations: ${blocking
          .map((violation) => `${violation.id}:${violation.impact}`)
          .join(", ")}`,
      );
    }
    await context.close();

    const sendJobsCreated = countSendJobsForMarker();
    if (sendJobsCreated !== 0) {
      throw new Error(`queue indicator smoke created ${sendJobsCreated} send job(s)`);
    }

    const wppMode = await captureWhatsAppPrint(wppScreenshotPath);
    console.log(
      `v29-queue-indicator|conversation=${conversationId}|queue=${queueCount}|queued=${queued}|claimed=${claimed}|running=${running}|sendJobs=${sendJobsCreated}|blocking=${blocking.length}|app=${appScreenshotPath}|wpp=${wppScreenshotPath}|wppMode=${wppMode}`,
    );
  } finally {
    await browser.close();
  }
}

function seedQueueFixture() {
  const db = new Database(databaseUrl);
  try {
    db.pragma("foreign_keys = ON");
    const now = new Date().toISOString();

    const existingContact = db
      .prepare(
        `
          SELECT id
          FROM contacts
          WHERE user_id = 1 AND phone = ?
          ORDER BY id DESC
          LIMIT 1
        `,
      )
      .get(smokePhone);
    if (existingContact?.id) {
      db.prepare(
        `
          UPDATE contacts
          SET name = @title,
              primary_channel = 'whatsapp',
              status = 'lead',
              notes = @marker,
              last_message_at = @now,
              deleted_at = NULL,
              updated_at = @now
          WHERE id = @id
        `,
      ).run({ id: existingContact.id, title: smokeTitle, marker: smokeMarker, now });
    } else {
      db.prepare(
        `
          INSERT INTO contacts (
            user_id, name, phone, email, primary_channel, instagram_handle, status, notes,
            last_message_at, profile_photo_media_asset_id, profile_photo_sha256,
            profile_photo_updated_at, deleted_at, created_at, updated_at
          )
          VALUES (
            1, @title, @phone, NULL, 'whatsapp', NULL, 'lead', @marker,
            @now, NULL, NULL, NULL, NULL, @now, @now
          )
        `,
      ).run({ title: smokeTitle, phone: smokePhone, marker: smokeMarker, now });
    }

    const contact = db
      .prepare(
        `
          SELECT id
          FROM contacts
          WHERE user_id = 1 AND phone = ?
          ORDER BY id DESC
          LIMIT 1
        `,
      )
      .get(smokePhone);
    if (!contact?.id) {
      throw new Error("queue indicator smoke contact was not created");
    }

    db.prepare(
      `
        INSERT INTO conversations (
          user_id, contact_id, channel, external_thread_id, title, last_message_at,
          last_preview, unread_count, is_archived, temporary_messages_until,
          profile_photo_media_asset_id, profile_photo_sha256, profile_photo_updated_at,
          created_at, updated_at
        )
        VALUES (
          1, @contactId, 'whatsapp', @phone, @title, @now,
          'smoke fila com 3 jobs ativos', 0, 0, NULL,
          NULL, NULL, NULL, @now, @now
        )
        ON CONFLICT(user_id, channel, external_thread_id) DO UPDATE SET
          contact_id = excluded.contact_id,
          title = excluded.title,
          last_message_at = excluded.last_message_at,
          last_preview = excluded.last_preview,
          is_archived = 0,
          updated_at = excluded.updated_at
      `,
    ).run({ contactId: contact.id, phone: smokePhone, title: smokeTitle, now });

    const conversation = db
      .prepare(
        `
          SELECT id
          FROM conversations
          WHERE user_id = 1 AND channel = 'whatsapp' AND external_thread_id = ?
        `,
      )
      .get(smokePhone);
    if (!conversation?.id) {
      throw new Error("queue indicator smoke conversation was not created");
    }

    db.prepare("DELETE FROM messages WHERE user_id = 1 AND conversation_id = ?").run(
      conversation.id,
    );
    db.prepare("DELETE FROM jobs WHERE user_id = 1 AND payload_json LIKE ?").run(
      `%${smokeMarker}%`,
    );

    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const insertJob = db.prepare(
      `
        INSERT INTO jobs (
          user_id, type, status, payload_json, priority, scheduled_at, claimed_at,
          claimed_by, attempts, max_attempts, created_at, updated_at
        )
        VALUES (
          1, @type, @status, @payload, @priority, @scheduledAt, @claimedAt,
          @claimedBy, @attempts, 3, @now, @now
        )
      `,
    );
    insertJob.run({
      type: "sync_conversation",
      status: "queued",
      payload: JSON.stringify({ conversationId: conversation.id, smoke: smokeMarker }),
      priority: 5,
      scheduledAt: future,
      claimedAt: null,
      claimedBy: null,
      attempts: 0,
      now,
    });
    insertJob.run({
      type: "sync_history",
      status: "claimed",
      payload: JSON.stringify({ conversationId: conversation.id, smoke: smokeMarker }),
      priority: 5,
      scheduledAt: now,
      claimedAt: now,
      claimedBy: "smoke-m17",
      attempts: 1,
      now,
    });
    insertJob.run({
      type: "sync_inbox_force",
      status: "running",
      payload: JSON.stringify({ conversationId: conversation.id, smoke: smokeMarker }),
      priority: 5,
      scheduledAt: now,
      claimedAt: now,
      claimedBy: "smoke-m17",
      attempts: 1,
      now,
    });

    return Number(conversation.id);
  } finally {
    db.close();
  }
}

function countSendJobsForMarker() {
  const db = new Database(databaseUrl, { readonly: true });
  try {
    const row = db
      .prepare(
        `
          SELECT count(*) AS total
          FROM jobs
          WHERE user_id = 1
            AND type IN ('send_message', 'send_instagram_message', 'send_voice', 'send_document', 'campaign_step')
            AND payload_json LIKE ?
        `,
      )
      .get(`%${smokeMarker}%`);
    return Number(row?.total ?? 0);
  } finally {
    db.close();
  }
}

async function captureWhatsAppPrint(outputPath) {
  try {
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
      await page.screenshot({ path: outputPath, fullPage: false, timeout: 15_000 });
      return "cdp";
    } finally {
      await browser.close();
    }
  } catch (error) {
    return captureWhatsAppPrintFromProfileCopy(outputPath, error);
  }
}

async function captureWhatsAppPrintFromProfileCopy(outputPath, cdpError) {
  await copyChromiumProfileForScreenshot();
  const context = await chromium.launchPersistentContext(wppScreenshotProfileDir, {
    headless: false,
    viewport: { width: 1366, height: 768 },
    args: [
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--disable-features=Translate,BackForwardCache",
      "--no-first-run",
      "--no-default-browser-check",
      "--no-sandbox",
    ],
  });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(whatsappUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(8_000);
    const bodyText = await page.locator("body").innerText({ timeout: 10_000 });
    if (bodyText.includes("WhatsApp works with Google Chrome 85+")) {
      throw new Error("WhatsApp Web screenshot fallback opened unsupported browser page");
    }
    await page.screenshot({ path: outputPath, fullPage: false, timeout: 20_000 });
    return "profile-copy";
  } catch (error) {
    throw new Error(
      `could not capture WhatsApp Web print via CDP or profile copy: ${String(
        cdpError,
      )}; fallback: ${String(error)}`,
    );
  } finally {
    await context.close();
    await fs.rm(wppScreenshotProfileDir, { recursive: true, force: true });
  }
}

async function copyChromiumProfileForScreenshot() {
  await fs.rm(wppScreenshotProfileDir, { recursive: true, force: true });
  await fs.cp(chromiumProfileDir, wppScreenshotProfileDir, {
    recursive: true,
    force: true,
    filter: (sourcePath) => {
      const basename = path.basename(sourcePath);
      return !basename.startsWith("Singleton") && basename !== "DevToolsActivePort";
    },
  });
}

async function assertHttp(url, label) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${label} not ready: ${response.status} ${url}`);
  }
}

async function waitForAttribute(locator, name, expected, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await locator.getAttribute(name).catch(() => null);
    if (value === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`attribute ${name} did not become ${expected}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
