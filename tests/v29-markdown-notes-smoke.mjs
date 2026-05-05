import AxeBuilder from "@axe-core/playwright";
import Database from "better-sqlite3";
import { chromium } from "playwright";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const webUrl = process.env.WEB_URL ?? "http://127.0.0.1:3002";
const apiUrl = process.env.API_URL ?? "http://127.0.0.1:3001";
const email = process.env.SMOKE_EMAIL ?? "admin@nuoma.local";
const password = process.env.SMOKE_PASSWORD ?? "nuoma-dev-admin-123";
const appScreenshotPath = process.env.APP_SCREENSHOT_PATH ?? "data/v29-markdown-notes-m19-app.png";
const wppScreenshotPath = process.env.WPP_SCREENSHOT_PATH ?? "data/v29-markdown-notes-m19-wpp.png";
const databaseUrl = path.resolve(process.env.DATABASE_URL ?? "data/nuoma-v2.db");
const cdpUrl = process.env.CDP_URL ?? "http://127.0.0.1:9223";
const whatsappUrl = process.env.WA_WEB_URL ?? "https://web.whatsapp.com/";
const chromiumProfileDir = path.resolve(
  process.env.CHROMIUM_PROFILE_DIR ?? "data/chromium-profile/whatsapp",
);
const wppScreenshotProfileDir = path.resolve(
  process.env.WPP_SCREENSHOT_PROFILE_DIR ?? "data/tmp/wpp-profile-screenshot",
);
const smokePhone = "5531999999624";
const smokeTitle = "V2.9.24 Markdown Notes Smoke";
const smokeMarker = "V2.9.24 Markdown Notes Smoke";

async function main() {
  await assertHttp(`${webUrl}/`, "web");
  await assertHttp(`${apiUrl}/health`, "api");
  await fs.mkdir(path.dirname(appScreenshotPath), { recursive: true });
  await fs.mkdir(path.dirname(wppScreenshotPath), { recursive: true });

  const fixture = seedMarkdownNotesFixture();
  const sendJobsBefore = countSendJobsForPhone(smokePhone);
  const noteValue = [
    "# Protocolo V2.9.24",
    "**Prioridade:** revisar melasma",
    "- [x] Anamnese enviada",
    "- [ ] Fotos pendentes",
    "Link: [Ficha](https://nuoma.local/ficha)",
    "Código `M19`",
    "> observação privada",
  ].join("\n");

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

    await page.getByTestId("inbox-notes-tab").click();
    await page.getByTestId("inbox-notes-panel").waitFor({ state: "visible", timeout: 10_000 });
    await page.getByTestId("inbox-contact-notes-input").fill(noteValue);

    await page
      .getByTestId("inbox-contact-notes-preview-heading")
      .filter({ hasText: "Protocolo V2.9.24" })
      .waitFor({ state: "visible", timeout: 10_000 });
    await page
      .getByTestId("inbox-contact-notes-preview-link")
      .filter({ hasText: "Ficha" })
      .waitFor({
        state: "visible",
        timeout: 10_000,
      });
    await page
      .getByTestId("inbox-contact-notes-preview-inline-code")
      .filter({ hasText: "M19" })
      .waitFor({ state: "visible", timeout: 10_000 });
    const listItems = await page.getByTestId("inbox-contact-notes-preview-list-item").count();
    if (listItems < 2) {
      throw new Error(`markdown preview rendered only ${listItems} list item(s)`);
    }

    await page.getByTestId("inbox-contact-notes-save").click();
    await page.waitForTimeout(750);

    const persisted = readContactNotes(fixture.contactId);
    if (persisted !== noteValue) {
      throw new Error("markdown notes did not persist exactly");
    }

    for (const dismissButton of await page.getByLabel("Dispensar").all()) {
      await dismissButton.click();
    }
    await page.waitForTimeout(250);

    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const blocking = result.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious",
    );
    await page.screenshot({ path: appScreenshotPath, fullPage: true });
    if (blocking.length > 0) {
      throw new Error(
        `markdown notes has blocking a11y violations: ${blocking
          .map((violation) => `${violation.id}:${violation.impact}`)
          .join(", ")}`,
      );
    }
    await context.close();

    const sendJobsAfter = countSendJobsForPhone(smokePhone);
    const sendJobsDelta = sendJobsAfter - sendJobsBefore;
    if (sendJobsDelta !== 0) {
      throw new Error(`markdown notes smoke created ${sendJobsDelta} send job(s)`);
    }

    const wppMode = await captureWhatsAppPrint(wppScreenshotPath);
    console.log(
      `v29-markdown-notes|conversation=${fixture.conversationId}|contact=${fixture.contactId}|listItems=${listItems}|notes=${persisted.length}|sendJobsDelta=${sendJobsDelta}|blocking=${blocking.length}|app=${appScreenshotPath}|wpp=${wppScreenshotPath}|wppMode=${wppMode}`,
    );
  } finally {
    await browser.close();
  }
}

function seedMarkdownNotesFixture() {
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
      throw new Error("markdown notes smoke contact was not created");
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
          'smoke notas markdown lite preview', 0, 0, NULL,
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
      throw new Error("markdown notes smoke conversation was not created");
    }

    db.prepare("DELETE FROM messages WHERE user_id = 1 AND conversation_id = ?").run(
      conversation.id,
    );

    return {
      contactId: Number(contact.id),
      conversationId: Number(conversation.id),
    };
  } finally {
    db.close();
  }
}

function readContactNotes(contactId) {
  const db = new Database(databaseUrl, { readonly: true });
  try {
    const contact = db.prepare("SELECT notes FROM contacts WHERE id = ?").get(contactId);
    return String(contact?.notes ?? "");
  } finally {
    db.close();
  }
}

function countSendJobsForPhone(phone) {
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
      .get(`%${phone}%`);
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
