import AxeBuilder from "@axe-core/playwright";
import Database from "better-sqlite3";
import { chromium } from "playwright";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const webUrl = process.env.WEB_URL ?? "http://127.0.0.1:3002";
const apiUrl = process.env.API_URL ?? "http://127.0.0.1:3001";
const email = process.env.SMOKE_EMAIL ?? "admin@nuoma.local";
const password = process.env.SMOKE_PASSWORD ?? "nuoma-dev-admin-123";
const appScreenshotPath = process.env.APP_SCREENSHOT_PATH ?? "data/v29-sidebar-tabs-m18-app.png";
const wppScreenshotPath = process.env.WPP_SCREENSHOT_PATH ?? "data/v29-sidebar-tabs-m18-wpp.png";
const databaseUrl = path.resolve(process.env.DATABASE_URL ?? "data/nuoma-v2.db");
const cdpUrl = process.env.CDP_URL ?? "http://127.0.0.1:9223";
const whatsappUrl = process.env.WA_WEB_URL ?? "https://web.whatsapp.com/";
const chromiumProfileDir = path.resolve(
  process.env.CHROMIUM_PROFILE_DIR ?? "data/chromium-profile/whatsapp",
);
const wppScreenshotProfileDir = path.resolve(
  process.env.WPP_SCREENSHOT_PROFILE_DIR ?? "data/tmp/wpp-profile-screenshot",
);
const smokePhone = "5531999999621";
const smokeTitle = "V2.9.21 Sidebar Tabs Smoke";
const smokeMarker = "V2.9.21 Sidebar Tabs Smoke";
const activeTagName = "M18 ativo";
const availableTagName = "M18 adicionar";

async function main() {
  await assertHttp(`${webUrl}/`, "web");
  await assertHttp(`${apiUrl}/health`, "api");
  await fs.mkdir(path.dirname(appScreenshotPath), { recursive: true });
  await fs.mkdir(path.dirname(wppScreenshotPath), { recursive: true });

  const fixture = seedSidebarFixture();
  const sendJobsBefore = countSendJobsForPhone(smokePhone);
  const noteValue = `Nota V2.9.21 persistida ${Date.now()}`;

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

    await page.getByTestId("inbox-history-tab").click();
    await page.getByTestId("inbox-history-panel").waitFor({ state: "visible", timeout: 10_000 });
    await page.getByTestId("inbox-history-depth").selectOption("10");
    await page.getByTestId("inbox-history-force-sync").waitFor({ state: "visible" });
    await page.getByTestId("inbox-history-force-history").waitFor({ state: "visible" });

    await page.getByTestId("inbox-tags-tab").click();
    await page.getByTestId("inbox-tags-panel").waitFor({ state: "visible", timeout: 10_000 });
    await page.getByTestId("inbox-tag-active").filter({ hasText: activeTagName }).waitFor({
      state: "visible",
      timeout: 10_000,
    });
    await page.getByTestId("inbox-tag-available").filter({ hasText: availableTagName }).click();
    await page.getByTestId("inbox-tag-active").filter({ hasText: availableTagName }).waitFor({
      state: "visible",
      timeout: 10_000,
    });

    await page.getByTestId("inbox-notes-tab").click();
    await page.getByTestId("inbox-notes-panel").waitFor({ state: "visible", timeout: 10_000 });
    await page.getByTestId("inbox-contact-notes-input").fill(noteValue);
    await page.getByTestId("inbox-contact-notes-save").click();
    await page.waitForTimeout(750);

    const persisted = readSidebarFixture(fixture.contactId);
    if (persisted.notes !== noteValue) {
      throw new Error(`notes did not persist. expected=${noteValue} actual=${persisted.notes}`);
    }
    if (!persisted.tagIds.includes(fixture.availableTagId)) {
      throw new Error(`available tag ${fixture.availableTagId} was not attached to contact`);
    }

    await page.getByTestId("inbox-tags-tab").click();
    await page.getByTestId("inbox-tag-active").filter({ hasText: availableTagName }).waitFor({
      state: "visible",
      timeout: 10_000,
    });
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
        `sidebar tabs has blocking a11y violations: ${blocking
          .map((violation) => `${violation.id}:${violation.impact}`)
          .join(", ")}`,
      );
    }
    await context.close();

    const sendJobsAfter = countSendJobsForPhone(smokePhone);
    const sendJobsDelta = sendJobsAfter - sendJobsBefore;
    if (sendJobsDelta !== 0) {
      throw new Error(`sidebar tabs smoke created ${sendJobsDelta} send job(s)`);
    }

    const wppMode = await captureWhatsAppPrint(wppScreenshotPath);
    console.log(
      `v29-sidebar-tabs|conversation=${fixture.conversationId}|contact=${fixture.contactId}|tags=${persisted.tagIds.length}|notes=${persisted.notes.length}|sendJobsDelta=${sendJobsDelta}|blocking=${blocking.length}|app=${appScreenshotPath}|wpp=${wppScreenshotPath}|wppMode=${wppMode}`,
    );
  } finally {
    await browser.close();
  }
}

function seedSidebarFixture() {
  const db = new Database(databaseUrl);
  try {
    db.pragma("foreign_keys = ON");
    const now = new Date().toISOString();
    const activeTagId = upsertTag(db, activeTagName, "#22C55E", now);
    const availableTagId = upsertTag(db, availableTagName, "#38BDF8", now);

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
      throw new Error("sidebar tabs smoke contact was not created");
    }

    db.prepare("DELETE FROM contact_tags WHERE user_id = 1 AND contact_id = ?").run(contact.id);
    db.prepare(
      `
        INSERT INTO contact_tags (contact_id, tag_id, user_id, created_at)
        VALUES (@contactId, @tagId, 1, @now)
        ON CONFLICT(contact_id, tag_id) DO NOTHING
      `,
    ).run({ contactId: contact.id, tagId: activeTagId, now });

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
          'smoke sidebar tabs com tags e notas', 0, 0, NULL,
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
      throw new Error("sidebar tabs smoke conversation was not created");
    }

    db.prepare("DELETE FROM messages WHERE user_id = 1 AND conversation_id = ?").run(
      conversation.id,
    );

    return {
      contactId: Number(contact.id),
      conversationId: Number(conversation.id),
      activeTagId,
      availableTagId,
    };
  } finally {
    db.close();
  }
}

function upsertTag(db, name, color, now) {
  db.prepare(
    `
      INSERT INTO tags (user_id, name, color, description, created_at, updated_at)
      VALUES (1, @name, @color, @description, @now, @now)
      ON CONFLICT(user_id, name) DO UPDATE SET
        color = excluded.color,
        description = excluded.description,
        updated_at = excluded.updated_at
    `,
  ).run({ name, color, description: smokeMarker, now });

  const tag = db
    .prepare(
      `
        SELECT id
        FROM tags
        WHERE user_id = 1 AND name = ?
        LIMIT 1
      `,
    )
    .get(name);
  if (!tag?.id) {
    throw new Error(`tag ${name} was not created`);
  }
  return Number(tag.id);
}

function readSidebarFixture(contactId) {
  const db = new Database(databaseUrl, { readonly: true });
  try {
    const contact = db.prepare("SELECT notes FROM contacts WHERE id = ?").get(contactId);
    const rows = db
      .prepare(
        `
          SELECT tag_id AS tagId
          FROM contact_tags
          WHERE user_id = 1 AND contact_id = ?
          ORDER BY tag_id
        `,
      )
      .all(contactId);
    return {
      notes: String(contact?.notes ?? ""),
      tagIds: rows.map((row) => Number(row.tagId)),
    };
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
