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
  process.env.APP_SCREENSHOT_PATH ?? "data/v29-individual-campaign-m14-app.png";
const wppScreenshotPath =
  process.env.WPP_SCREENSHOT_PATH ?? "data/v29-individual-campaign-m14-wpp.png";
const databaseUrl = path.resolve(process.env.DATABASE_URL ?? "data/nuoma-v2.db");
const cdpUrl = process.env.CDP_URL ?? "http://127.0.0.1:9223";
const whatsappUrl = process.env.WA_WEB_URL ?? "https://web.whatsapp.com/";
const smokePhone = "5531999999617";
const smokeTitle = "V2.9.17 Campaign Smoke";
const eligibleCampaignName = "Campanha individual V2.9.17";

async function main() {
  await assertHttp(`${webUrl}/`, "web");
  await assertHttp(`${apiUrl}/health`, "api");
  await fs.mkdir(path.dirname(appScreenshotPath), { recursive: true });
  await fs.mkdir(path.dirname(wppScreenshotPath), { recursive: true });
  const conversationId = seedCampaignFixture();

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

    await page.getByTestId("inbox-campaign-trigger").click();
    const picker = page.getByTestId("inbox-campaign-picker");
    await picker.waitFor({ state: "visible", timeout: 10_000 });
    await picker.getByTestId("inbox-campaign-search").fill("individual");
    await picker.getByText(eligibleCampaignName).waitFor({ state: "visible", timeout: 10_000 });
    const options = await picker.getByTestId("inbox-campaign-option").count();
    if (options !== 1) {
      throw new Error(`expected exactly one eligible campaign after search, found ${options}`);
    }

    const dispatchDisabled = await picker.getByTestId("inbox-campaign-dispatch").isDisabled();
    if (!dispatchDisabled) {
      throw new Error("real campaign dispatch should stay disabled for non-allowlisted phone");
    }
    await picker.getByTestId("inbox-campaign-preview").click();
    await picker.getByTestId("inbox-campaign-result").getByText("1 alvo").waitFor({
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
        `individual campaign inbox has blocking a11y violations: ${blocking
          .map((violation) => `${violation.id}:${violation.impact}`)
          .join(", ")}`,
      );
    }
    await context.close();

    const wppMode = await captureWhatsAppPrint(wppScreenshotPath);
    console.log(
      `v29-individual-campaign|conversation=${conversationId}|options=${options}|blocking=${blocking.length}|app=${appScreenshotPath}|wpp=${wppScreenshotPath}|wppMode=${wppMode}`,
    );
  } finally {
    await browser.close();
  }
}

function seedCampaignFixture() {
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
              notes = 'Smoke V2.9.17',
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
            1, @title, @phone, NULL, 'whatsapp', NULL, 'lead', 'Smoke V2.9.17',
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
      throw new Error("individual campaign smoke contact was not created");
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
          'prévia de campanha sem envio real', 0, 0, NULL,
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
      throw new Error("individual campaign smoke conversation was not created");
    }

    const smokeCampaignIds = db
      .prepare(
        `
          SELECT id
          FROM campaigns
          WHERE user_id = 1 AND name LIKE '%V2.9.17%'
        `,
      )
      .all()
      .map((row) => row.id);
    for (const campaignId of smokeCampaignIds) {
      db.prepare("DELETE FROM campaign_recipients WHERE user_id = 1 AND campaign_id = ?").run(
        campaignId,
      );
    }
    db.prepare("DELETE FROM campaigns WHERE user_id = 1 AND name LIKE '%V2.9.17%'").run();

    const insertCampaign = db.prepare(
      `
        INSERT INTO campaigns (
          user_id, name, status, channel, segment_json, steps_json,
          evergreen, starts_at, completed_at, metadata_json, created_at, updated_at
        )
        VALUES (
          1, @name, @status, @channel, NULL, @steps,
          0, NULL, NULL, @metadata, @now, @now
        )
      `,
    );

    insertCampaign.run({
      name: eligibleCampaignName,
      status: "draft",
      channel: "whatsapp",
      steps: JSON.stringify([
        {
          id: "v29-17-text",
          label: "Mensagem individual",
          type: "text",
          delaySeconds: 0,
          conditions: [],
          template: "Olá {{nome}}, esta é uma prévia segura da campanha V2.9.17.",
        },
      ]),
      metadata: JSON.stringify({ smoke: "v2.9.17", eligible: true }),
      now,
    });
    insertCampaign.run({
      name: "Campanha IG não elegível V2.9.17",
      status: "draft",
      channel: "instagram",
      steps: JSON.stringify([
        {
          id: "v29-17-ig",
          label: "IG",
          type: "text",
          delaySeconds: 0,
          conditions: [],
          template: "Mensagem IG",
        },
      ]),
      metadata: JSON.stringify({ smoke: "v2.9.17", eligible: false }),
      now,
    });
    insertCampaign.run({
      name: "Campanha arquivada V2.9.17",
      status: "archived",
      channel: "whatsapp",
      steps: JSON.stringify([
        {
          id: "v29-17-archived",
          label: "Arquivada",
          type: "text",
          delaySeconds: 0,
          conditions: [],
          template: "Mensagem arquivada",
        },
      ]),
      metadata: JSON.stringify({ smoke: "v2.9.17", eligible: false }),
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
