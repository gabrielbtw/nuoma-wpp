import AxeBuilder from "@axe-core/playwright";
import Database from "better-sqlite3";
import { chromium } from "playwright";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const webUrl = process.env.WEB_URL ?? "http://127.0.0.1:3002";
const apiUrl = process.env.API_URL ?? "http://127.0.0.1:3001";
const email = process.env.SMOKE_EMAIL ?? "admin@nuoma.local";
const password = process.env.SMOKE_PASSWORD ?? "nuoma-dev-admin-123";
const appScreenshotPath =
  process.env.APP_SCREENSHOT_PATH ?? "data/v29-automation-trigger-m13-app.png";
const wppScreenshotPath =
  process.env.WPP_SCREENSHOT_PATH ?? "data/v29-automation-trigger-m13-wpp.png";
const databaseUrl = path.resolve(process.env.DATABASE_URL ?? "data/nuoma-v2.db");
const cdpUrl = process.env.CDP_URL ?? "http://127.0.0.1:9223";
const whatsappUrl = process.env.WA_WEB_URL ?? "https://web.whatsapp.com/";
const smokePhone = "5531999999616";
const smokeTitle = "V2.9.16 Automation Smoke";
const eligibleAutomationName = "Follow-up elegível V2.9.16";

async function main() {
  await assertHttp(`${webUrl}/`, "web");
  await assertHttp(`${apiUrl}/health`, "api");
  await fs.mkdir(path.dirname(appScreenshotPath), { recursive: true });
  await fs.mkdir(path.dirname(wppScreenshotPath), { recursive: true });
  const conversationId = seedAutomationFixture();

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

    await page.getByTestId("inbox-automation-trigger").click();
    const picker = page.getByTestId("inbox-automation-picker");
    await picker.waitFor({ state: "visible", timeout: 10_000 });
    await picker.getByTestId("inbox-automation-search").fill("Follow");
    await picker.getByText(eligibleAutomationName).waitFor({ state: "visible", timeout: 10_000 });
    const options = await picker.getByTestId("inbox-automation-option").count();
    if (options !== 1) {
      throw new Error(`expected exactly one eligible automation after search, found ${options}`);
    }

    const dispatchDisabled = await picker.getByTestId("inbox-automation-dispatch").isDisabled();
    if (!dispatchDisabled) {
      throw new Error("real dispatch button should stay disabled for non-allowlisted smoke phone");
    }
    await picker.getByTestId("inbox-automation-preview").click();
    await picker.getByTestId("inbox-automation-result").getByText("criaria job").waitFor({
      state: "visible",
      timeout: 10_000,
    });

    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const blocking = result.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious",
    );
    await page.screenshot({ path: appScreenshotPath, fullPage: true });

    if (blocking.length > 0) {
      throw new Error(
        `automation trigger inbox has blocking a11y violations: ${blocking
          .map((violation) => `${violation.id}:${violation.impact}`)
          .join(", ")}`,
      );
    }
    await context.close();

    const wppMode = await captureWhatsAppPrint(wppScreenshotPath);
    console.log(
      `v29-automation-trigger|conversation=${conversationId}|options=${options}|blocking=${blocking.length}|app=${appScreenshotPath}|wpp=${wppScreenshotPath}|wppMode=${wppMode}`,
    );
  } finally {
    await browser.close();
  }
}

function seedAutomationFixture() {
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
              notes = 'Smoke V2.9.16',
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
            1, @title, @phone, NULL, 'whatsapp', NULL, 'lead', 'Smoke V2.9.16',
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
      throw new Error("automation trigger smoke contact was not created");
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
          'prévia de automação sem envio real', 0, 0, NULL,
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
      throw new Error("automation trigger smoke conversation was not created");
    }

    db.prepare("DELETE FROM automations WHERE user_id = 1 AND name LIKE '%V2.9.16%'").run();
    const insertAutomation = db.prepare(
      `
        INSERT INTO automations (
          user_id, name, category, status, trigger_json, condition_json,
          actions_json, metadata_json, created_at, updated_at
        )
        VALUES (
          1, @name, @category, @status, @trigger, @condition,
          @actions, @metadata, @now, @now
        )
      `,
    );

    insertAutomation.run({
      name: eligibleAutomationName,
      category: "Atendimento",
      status: "active",
      trigger: JSON.stringify({ type: "message_received", channel: "whatsapp" }),
      condition: JSON.stringify({ segment: null, requireWithin24hWindow: false }),
      actions: JSON.stringify([
        {
          type: "send_step",
          step: {
            id: "v29-16-follow-up",
            label: "Follow-up seguro",
            type: "text",
            delaySeconds: 0,
            conditions: [],
            template: "Olá {{nome}}, esta é uma prévia segura da automação V2.9.16.",
          },
        },
      ]),
      metadata: JSON.stringify({ smoke: "v2.9.16", eligible: true }),
      now,
    });
    insertAutomation.run({
      name: "IG não elegível V2.9.16",
      category: "Instagram",
      status: "active",
      trigger: JSON.stringify({ type: "message_received", channel: "instagram" }),
      condition: JSON.stringify({ segment: null, requireWithin24hWindow: false }),
      actions: JSON.stringify([
        {
          type: "send_step",
          step: {
            id: "v29-16-ig",
            label: "IG",
            type: "text",
            delaySeconds: 0,
            conditions: [],
            template: "Mensagem IG",
          },
        },
      ]),
      metadata: JSON.stringify({ smoke: "v2.9.16", eligible: false }),
      now,
    });
    insertAutomation.run({
      name: "Rascunho oculto V2.9.16",
      category: "Rascunho",
      status: "draft",
      trigger: JSON.stringify({ type: "message_received", channel: "whatsapp" }),
      condition: JSON.stringify({ segment: null, requireWithin24hWindow: false }),
      actions: JSON.stringify([
        {
          type: "send_step",
          step: {
            id: "v29-16-draft",
            label: "Draft",
            type: "text",
            delaySeconds: 0,
            conditions: [],
            template: "Mensagem draft",
          },
        },
      ]),
      metadata: JSON.stringify({ smoke: "v2.9.16", eligible: false }),
      now,
    });

    return Number(conversation.id);
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
      await page.screenshot({ path: outputPath, fullPage: true });
      return "cdp";
    } finally {
      await browser.close();
    }
  } catch {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
      const page = await context.newPage();
      await page.goto(whatsappUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.screenshot({ path: outputPath, fullPage: true });
      await context.close();
      return "standalone";
    } finally {
      await browser.close();
    }
  }
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
