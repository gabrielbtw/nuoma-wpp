import AxeBuilder from "@axe-core/playwright";
import Database from "better-sqlite3";
import { chromium } from "playwright";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const webUrl = process.env.WEB_URL ?? "http://127.0.0.1:3002";
const apiUrl = process.env.API_URL ?? "http://127.0.0.1:3001";
const email = process.env.SMOKE_EMAIL ?? "admin@nuoma.local";
const password = process.env.SMOKE_PASSWORD ?? "nuoma-dev-admin-123";
const appScreenshotPath = process.env.APP_SCREENSHOT_PATH ?? "data/v29-optimistic-send-m15-app.png";
const wppScreenshotPath = process.env.WPP_SCREENSHOT_PATH ?? "data/v29-optimistic-send-m15-wpp.png";
const databaseUrl = path.resolve(process.env.DATABASE_URL ?? "data/nuoma-v2.db");
const cdpUrl = process.env.CDP_URL ?? "http://127.0.0.1:9223";
const whatsappUrl = process.env.WA_WEB_URL ?? "https://web.whatsapp.com/";
const chromiumProfileDir = path.resolve(
  process.env.CHROMIUM_PROFILE_DIR ?? "data/chromium-profile/whatsapp",
);
const wppScreenshotProfileDir = path.resolve(
  process.env.WPP_SCREENSHOT_PROFILE_DIR ?? "data/tmp/wpp-profile-screenshot",
);
const smokePhone = "5531999999618";
const smokeTitle = "V2.9.18 Optimistic Smoke";
const optimisticBody = `Mensagem optimistic V2.9.18 ${Date.now()}`;

async function main() {
  await assertHttp(`${webUrl}/`, "web");
  await assertHttp(`${apiUrl}/health`, "api");
  await fs.mkdir(path.dirname(appScreenshotPath), { recursive: true });
  await fs.mkdir(path.dirname(wppScreenshotPath), { recursive: true });
  const conversationId = seedOptimisticFixture();

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    let releaseSendRequest;
    let sendIntercepted = false;
    await page.route("**/trpc/messages.send**", async (route) => {
      sendIntercepted = true;
      await new Promise((resolve) => {
        releaseSendRequest = resolve;
      });
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
    await textarea.fill(optimisticBody);
    await page.getByTestId("composer-send-button").click();

    const optimisticBubble = page
      .getByTestId("inbox-message-bubble")
      .filter({ hasText: optimisticBody });
    await optimisticBubble.waitFor({ state: "visible", timeout: 10_000 });
    const optimisticAttr = await optimisticBubble.getAttribute("data-optimistic");
    if (optimisticAttr !== "true") {
      throw new Error(`expected optimistic bubble, got data-optimistic=${optimisticAttr}`);
    }
    await optimisticBubble.getByText("local").waitFor({ state: "visible", timeout: 10_000 });
    await optimisticBubble
      .getByTestId("message-delivery-status")
      .waitFor({ state: "visible", timeout: 10_000 });
    const deliveryStatus = await optimisticBubble
      .getByTestId("message-delivery-status")
      .getAttribute("data-delivery-status");
    if (deliveryStatus !== "pending") {
      throw new Error(`expected pending optimistic delivery status, got ${deliveryStatus}`);
    }
    const textareaValue = await textarea.inputValue();
    if (textareaValue !== "") {
      throw new Error(
        `expected composer to clear immediately, got ${JSON.stringify(textareaValue)}`,
      );
    }
    if (!sendIntercepted || !releaseSendRequest) {
      throw new Error(
        "messages.send request was not intercepted while optimistic bubble was visible",
      );
    }

    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const blocking = result.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious",
    );
    await page.screenshot({ path: appScreenshotPath, fullPage: true });

    releaseSendRequest();
    await optimisticBubble.getByText("falha local").waitFor({ state: "visible", timeout: 10_000 });
    const failedStatus = await optimisticBubble
      .getByTestId("message-delivery-status")
      .getAttribute("data-delivery-status");
    if (failedStatus !== "failed") {
      throw new Error(
        `expected failed optimistic delivery status after API guard, got ${failedStatus}`,
      );
    }
    const jobsCreated = countJobsForBody(optimisticBody);
    if (jobsCreated !== 0) {
      throw new Error(`non-allowlisted optimistic smoke created ${jobsCreated} send job(s)`);
    }

    if (blocking.length > 0) {
      throw new Error(
        `optimistic send inbox has blocking a11y violations: ${blocking
          .map((violation) => `${violation.id}:${violation.impact}`)
          .join(", ")}`,
      );
    }
    await context.close();

    const wppMode = await captureWhatsAppPrint(wppScreenshotPath);
    console.log(
      `v29-optimistic-send|conversation=${conversationId}|optimistic=${optimisticAttr}|pending=${deliveryStatus}|failed=${failedStatus}|jobs=${jobsCreated}|blocking=${blocking.length}|app=${appScreenshotPath}|wpp=${wppScreenshotPath}|wppMode=${wppMode}`,
    );
  } finally {
    await browser.close();
  }
}

function seedOptimisticFixture() {
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
              notes = 'Smoke V2.9.18',
              last_message_at = @now,
              deleted_at = NULL,
              updated_at = @now
          WHERE user_id = 1 AND id = @contactId
        `,
      ).run({ title: smokeTitle, now, contactId: existingContact.id });
    } else {
      db.prepare(
        `
          INSERT INTO contacts (
            user_id, name, phone, email, primary_channel, instagram_handle, status, notes,
            last_message_at, profile_photo_media_asset_id, profile_photo_sha256,
            profile_photo_updated_at, deleted_at, created_at, updated_at
          )
          VALUES (
            1, @title, @phone, NULL, 'whatsapp', NULL, 'lead', 'Smoke V2.9.18',
            @now, NULL, NULL, NULL, NULL, @now, @now
          )
        `,
      ).run({ title: smokeTitle, phone: smokePhone, now });
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
      throw new Error("optimistic send smoke contact was not created");
    }
    db.prepare("DELETE FROM contacts WHERE user_id = 1 AND phone = ? AND id <> ?").run(
      smokePhone,
      contact.id,
    );

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
          'smoke optimistic sem job real', 0, 0, NULL,
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
      throw new Error("optimistic send smoke conversation was not created");
    }

    db.prepare("DELETE FROM messages WHERE user_id = 1 AND conversation_id = ?").run(
      conversation.id,
    );
    db.prepare("DELETE FROM jobs WHERE user_id = 1 AND payload_json LIKE '%V2.9.18%'").run();

    return Number(conversation.id);
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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
