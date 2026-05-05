import AxeBuilder from "@axe-core/playwright";
import Database from "better-sqlite3";
import { chromium } from "playwright";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const webUrl = process.env.WEB_URL ?? "http://127.0.0.1:3002";
const apiUrl = process.env.API_URL ?? "http://127.0.0.1:3001";
const email = process.env.SMOKE_EMAIL ?? "admin@nuoma.local";
const password = process.env.SMOKE_PASSWORD ?? "nuoma-dev-admin-123";
const appScreenshotPath = process.env.APP_SCREENSHOT_PATH ?? "data/v29-retry-inline-m16-app.png";
const wppScreenshotPath = process.env.WPP_SCREENSHOT_PATH ?? "data/v29-retry-inline-m16-wpp.png";
const databaseUrl = path.resolve(process.env.DATABASE_URL ?? "data/nuoma-v2.db");
const cdpUrl = process.env.CDP_URL ?? "http://127.0.0.1:9223";
const whatsappUrl = process.env.WA_WEB_URL ?? "https://web.whatsapp.com/";
const chromiumProfileDir = path.resolve(
  process.env.CHROMIUM_PROFILE_DIR ?? "data/chromium-profile/whatsapp",
);
const wppScreenshotProfileDir = path.resolve(
  process.env.WPP_SCREENSHOT_PROFILE_DIR ?? "data/tmp/wpp-profile-screenshot",
);
const smokePhone = "5531999999619";
const smokeTitle = "V2.9.19 Retry Inline Smoke";
const retryBody = `Mensagem retry inline V2.9.19 ${Date.now()}`;

async function main() {
  await assertHttp(`${webUrl}/`, "web");
  await assertHttp(`${apiUrl}/health`, "api");
  await fs.mkdir(path.dirname(appScreenshotPath), { recursive: true });
  await fs.mkdir(path.dirname(wppScreenshotPath), { recursive: true });
  const conversationId = seedRetryFixture();

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    let sendCount = 0;
    let releaseRetryRequest;
    await page.route("**/trpc/messages.send**", async (route) => {
      sendCount += 1;
      if (sendCount === 2) {
        await new Promise((resolve) => {
          releaseRetryRequest = resolve;
        });
      }
      await route.continue();
    });

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

    const textarea = page.getByTestId("composer-textarea");
    await textarea.fill(retryBody);
    await page.getByTestId("composer-send-button").click();

    const failedBubble = page.getByTestId("inbox-message-bubble").filter({ hasText: retryBody });
    await failedBubble.waitFor({ state: "visible", timeout: 10_000 });
    await failedBubble.getByText("falha local").waitFor({ state: "visible", timeout: 10_000 });
    const retryButton = failedBubble.getByTestId("message-retry-inline");
    await retryButton.waitFor({ state: "visible", timeout: 10_000 });
    const failedStatus = await failedBubble
      .getByTestId("message-delivery-status")
      .getAttribute("data-delivery-status");
    if (failedStatus !== "failed") {
      throw new Error(`expected failed bubble before retry, got ${failedStatus}`);
    }

    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const blocking = result.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious",
    );
    await page.screenshot({ path: appScreenshotPath, fullPage: true });
    if (blocking.length > 0) {
      throw new Error(
        `retry inline inbox has blocking a11y violations: ${blocking
          .map((violation) => `${violation.id}:${violation.impact}`)
          .join(", ")}`,
      );
    }

    await retryButton.click();
    await waitUntil(() => Boolean(releaseRetryRequest), 10_000);
    if (!releaseRetryRequest) {
      throw new Error(`retry request was not intercepted; sendCount=${sendCount}`);
    }
    await failedBubble
      .getByTestId("message-delivery-status")
      .waitFor({ state: "visible", timeout: 10_000 });
    const pendingStatus = await failedBubble
      .getByTestId("message-delivery-status")
      .getAttribute("data-delivery-status");
    if (pendingStatus !== "pending") {
      throw new Error(`expected pending status during retry, got ${pendingStatus}`);
    }

    releaseRetryRequest();
    await failedBubble.getByText("falha local").waitFor({ state: "visible", timeout: 10_000 });
    const failedAgainStatus = await failedBubble
      .getByTestId("message-delivery-status")
      .getAttribute("data-delivery-status");
    if (failedAgainStatus !== "failed") {
      throw new Error(`expected failed status after retry guard, got ${failedAgainStatus}`);
    }
    const jobsCreated = countJobsForBody(retryBody);
    if (jobsCreated !== 0) {
      throw new Error(`non-allowlisted retry smoke created ${jobsCreated} send job(s)`);
    }
    await context.close();

    const wppMode = await captureWhatsAppPrint(wppScreenshotPath);
    console.log(
      `v29-retry-inline|conversation=${conversationId}|sendCount=${sendCount}|failed=${failedStatus}|pending=${pendingStatus}|failedAgain=${failedAgainStatus}|jobs=${jobsCreated}|blocking=${blocking.length}|app=${appScreenshotPath}|wpp=${wppScreenshotPath}|wppMode=${wppMode}`,
    );
  } finally {
    await browser.close();
  }
}

function seedRetryFixture() {
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
              notes = 'Smoke V2.9.19',
              last_message_at = @now,
              deleted_at = NULL,
              updated_at = @now
          WHERE id = @id
        `,
      ).run({ id: existingContact.id, title: smokeTitle, now });
    }
    const contactId =
      existingContact?.id ??
      db
        .prepare(
          `
            INSERT INTO contacts (
              user_id, name, phone, email, primary_channel, instagram_handle, status, notes,
              last_message_at, profile_photo_media_asset_id, profile_photo_sha256,
              profile_photo_updated_at, deleted_at, created_at, updated_at
            )
            VALUES (
              1, @title, @phone, NULL, 'whatsapp', NULL, 'lead', 'Smoke V2.9.19',
              @now, NULL, NULL, NULL, NULL, @now, @now
            )
          `,
        )
        .run({ title: smokeTitle, phone: smokePhone, now }).lastInsertRowid;

    const existingConversation = db
      .prepare(
        `
          SELECT id
          FROM conversations
          WHERE user_id = 1 AND channel = 'whatsapp' AND external_thread_id = ?
          ORDER BY id DESC
          LIMIT 1
        `,
      )
      .get(smokePhone);
    if (existingConversation?.id) {
      db.prepare(
        `
          UPDATE conversations
          SET contact_id = @contactId,
              title = @title,
              is_archived = 0,
              last_message_at = NULL,
              last_preview = NULL,
              unread_count = 0,
              updated_at = @now
          WHERE id = @id
        `,
      ).run({ id: existingConversation.id, contactId, title: smokeTitle, now });
    }
    const conversationId =
      existingConversation?.id ??
      db
        .prepare(
          `
            INSERT INTO conversations (
              user_id, contact_id, channel, external_thread_id, title, is_archived,
              last_message_at, last_preview, unread_count, created_at, updated_at
            )
            VALUES (1, @contactId, 'whatsapp', @phone, @title, 0,
              NULL, NULL, 0, @now, @now)
          `,
        )
        .run({ contactId, phone: smokePhone, title: smokeTitle, now }).lastInsertRowid;

    db.prepare("DELETE FROM messages WHERE user_id = 1 AND conversation_id = ?").run(
      conversationId,
    );
    db.prepare("DELETE FROM jobs WHERE user_id = 1 AND payload_json LIKE ?").run("%V2.9.19%");
    return Number(conversationId);
  } finally {
    db.close();
  }
}

function countJobsForBody(body) {
  const db = new Database(databaseUrl, { readonly: true });
  try {
    const row = db
      .prepare(
        `
          SELECT count(*) AS total
          FROM jobs
          WHERE user_id = 1 AND type = 'send_message' AND payload_json LIKE ?
        `,
      )
      .get(`%${body}%`);
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

async function waitUntil(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
