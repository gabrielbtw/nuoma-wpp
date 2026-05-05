import AxeBuilder from "@axe-core/playwright";
import Database from "better-sqlite3";
import { chromium } from "playwright";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const webUrl = process.env.WEB_URL ?? "http://127.0.0.1:3002";
const apiUrl = process.env.API_URL ?? "http://127.0.0.1:3001";
const email = process.env.SMOKE_EMAIL ?? "admin@nuoma.local";
const password = process.env.SMOKE_PASSWORD ?? "nuoma-dev-admin-123";
const appScreenshotPath = process.env.APP_SCREENSHOT_PATH ?? "data/v210-evergreen-m26-app.png";
const wppScreenshotPath = process.env.WPP_SCREENSHOT_PATH ?? "data/v210-evergreen-m26-wpp.png";
const databaseUrl = path.resolve(process.env.DATABASE_URL ?? "data/nuoma-v2.db");
const cdpUrl = process.env.CDP_URL ?? "http://127.0.0.1:9223";
const whatsappUrl = process.env.WA_WEB_URL ?? "https://web.whatsapp.com/";
const canaryPhone = "5531982066263";

async function main() {
  await assertHttp(`${webUrl}/`, "web");
  await assertHttp(`${apiUrl}/health`, "api");
  await fs.mkdir(path.dirname(appScreenshotPath), { recursive: true });
  await fs.mkdir(path.dirname(wppScreenshotPath), { recursive: true });

  const fixture = seedEvergreenFixture();
  const campaignStepJobsBefore = countCampaignStepJobs();
  const recipientsBefore = countCampaignRecipients(fixture.campaignId);

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 980 } });
    const page = await context.newPage();

    await page.goto(`${webUrl}/login`, { waitUntil: "networkidle" });
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.click('button[type="submit"]');
    await page.waitForURL(`${webUrl}/`);

    await page.goto(`${webUrl}/campaigns`, { waitUntil: "domcontentloaded" });
    await page.getByText("V2.10.8 Smoke Evergreen").waitFor({
      state: "visible",
      timeout: 10_000,
    });

    const campaignPanel = page.locator(
      `[data-testid="campaign-evergreen-panel"][data-campaign-id="${fixture.campaignId}"]`,
    );
    await campaignPanel.waitFor({ state: "visible", timeout: 10_000 });

    await page.getByRole("button", { name: /^Prévia$/ }).first().click();
    await page.getByText("Último tick").waitFor({ state: "visible", timeout: 10_000 });
    const lastTickPanel = page.getByTestId("campaign-evergreen-last-tick");
    await lastTickPanel.waitFor({ state: "visible", timeout: 10_000 });
    const evergreenTick = await lastTickPanel.evaluate((element) => ({
      planned: Number(element.getAttribute("data-planned") ?? "0"),
      created: Number(element.getAttribute("data-created") ?? "0"),
      text: element.textContent ?? "",
    }));
    if (evergreenTick.planned < 2 || evergreenTick.created !== 0) {
      throw new Error(`evergreen dry-run diagnostics mismatch: ${JSON.stringify(evergreenTick)}`);
    }
    await page.getByText("Evergreen").first().waitFor({ state: "visible", timeout: 10_000 });

    const recipientsAfter = countCampaignRecipients(fixture.campaignId);
    if (recipientsAfter !== recipientsBefore) {
      throw new Error(`evergreen dry-run mutated recipients: before=${recipientsBefore} after=${recipientsAfter}`);
    }
    const campaignStepJobsAfter = countCampaignStepJobs();
    const campaignStepJobsDelta = campaignStepJobsAfter - campaignStepJobsBefore;
    if (campaignStepJobsDelta !== 0) {
      throw new Error(`evergreen dry-run created campaign_step job(s): delta=${campaignStepJobsDelta}`);
    }

    await lastTickPanel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: appScreenshotPath, fullPage: false });
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const blocking = result.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious",
    );
    if (blocking.length > 0) {
      throw new Error(
        `V2.10.8 evergreen has blocking a11y violations: ${blocking
          .map((violation) => `${violation.id}:${violation.impact}`)
          .join(", ")}`,
      );
    }

    await context.close();
    const wppMode = await captureWhatsAppPrint(wppScreenshotPath);
    pauseSchedulerCanary(fixture.campaignId);
    console.log(
      `v210-evergreen|campaign=${fixture.campaignId}|tag=${fixture.tagId}|planned=${evergreenTick.planned}|created=${evergreenTick.created}|recipientsDelta=${recipientsAfter - recipientsBefore}|campaignStepJobsDelta=${campaignStepJobsDelta}|canary=${canaryPhone}|blocking=${blocking.length}|app=${appScreenshotPath}|wpp=${wppScreenshotPath}|wppMode=${wppMode}`,
    );
  } finally {
    await browser.close();
  }
}

function seedEvergreenFixture() {
  const db = new Database(databaseUrl);
  try {
    db.pragma("foreign_keys = ON");
    const nowIso = new Date().toISOString();
    const existingCampaigns = db
      .prepare("SELECT id FROM campaigns WHERE user_id = 1 AND name LIKE 'V2.10.8 Smoke%'")
      .all();
    for (const row of existingCampaigns) {
      db.prepare("DELETE FROM campaign_recipients WHERE user_id = 1 AND campaign_id = ?").run(row.id);
    }
    db.prepare("DELETE FROM campaigns WHERE user_id = 1 AND name LIKE 'V2.10.8 Smoke%'").run();
    const oldContacts = db
      .prepare("SELECT id FROM contacts WHERE user_id = 1 AND name LIKE 'V2.10.8 Smoke%'")
      .all();
    for (const row of oldContacts) {
      db.prepare("DELETE FROM contact_tags WHERE user_id = 1 AND contact_id = ?").run(row.id);
    }
    db.prepare("DELETE FROM contacts WHERE user_id = 1 AND name LIKE 'V2.10.8 Smoke%'").run();
    db.prepare("DELETE FROM tags WHERE user_id = 1 AND name = 'V2.10.8 Evergreen M26'").run();
    db.prepare("DELETE FROM system_events WHERE user_id = 1 AND payload_json LIKE '%v2.10.8-smoke%'").run();

    const tagInfo = db
      .prepare(
        "INSERT INTO tags (user_id, name, color, description, created_at, updated_at) VALUES (1, ?, '#22c55e', ?, ?, ?)",
      )
      .run("V2.10.8 Evergreen M26", "Smoke evergreen auto-avaliacao", nowIso, nowIso);
    const tagId = Number(tagInfo.lastInsertRowid);

    const insertContact = db.prepare(`
      INSERT INTO contacts (
        user_id, name, phone, email, primary_channel, instagram_handle, status, notes,
        profile_photo_media_asset_id, profile_photo_sha256, profile_photo_updated_at,
        deleted_at, created_at, updated_at
      )
      VALUES (
        1, @name, @phone, NULL, @channel, NULL, @status, NULL,
        NULL, NULL, NULL, NULL, @nowIso, @nowIso
      )
    `);
    const contacts = [
      insertContact.run({
        name: "V2.10.8 Smoke Canario",
        phone: canaryPhone,
        channel: "whatsapp",
        status: "lead",
        nowIso,
      }).lastInsertRowid,
      insertContact.run({
        name: "V2.10.8 Smoke Lead 2",
        phone: "553188840002",
        channel: "whatsapp",
        status: "lead",
        nowIso,
      }).lastInsertRowid,
      insertContact.run({
        name: "V2.10.8 Smoke Fora Segmento",
        phone: "553188840003",
        channel: "whatsapp",
        status: "lead",
        nowIso,
      }).lastInsertRowid,
    ].map(Number);
    const tagContact = db.prepare(
      "INSERT INTO contact_tags (contact_id, tag_id, user_id, created_at) VALUES (?, ?, 1, ?)",
    );
    tagContact.run(contacts[0], tagId, nowIso);
    tagContact.run(contacts[1], tagId, nowIso);

    const steps = [
      {
        id: "evergreen-intro",
        label: "Intro evergreen",
        type: "text",
        delaySeconds: 0,
        conditions: [],
        template: "Oi {{nome}}, posso te mandar uma atualização?",
      },
    ];
    const segment = {
      operator: "and",
      conditions: [{ field: "tag", operator: "eq", value: tagId }],
    };
    const campaignInfo = db
      .prepare(
        `
          INSERT INTO campaigns (
            user_id, name, status, channel, segment_json, steps_json,
            evergreen, starts_at, completed_at, metadata_json, created_at, updated_at
          )
          VALUES (
            1, 'V2.10.8 Smoke Evergreen', 'running', 'whatsapp', @segment, @steps,
            1, @nowIso, NULL, @metadata, @nowIso, @nowIso
          )
        `,
      )
      .run({
        segment: JSON.stringify(segment),
        steps: JSON.stringify(steps),
        metadata: JSON.stringify({ smoke: "v2.10.8-smoke" }),
        nowIso,
      });
    return { campaignId: Number(campaignInfo.lastInsertRowid), tagId };
  } finally {
    db.close();
  }
}

function countCampaignRecipients(campaignId) {
  const db = new Database(databaseUrl, { readonly: true });
  try {
    return Number(
      db
        .prepare("SELECT COUNT(*) AS count FROM campaign_recipients WHERE user_id = 1 AND campaign_id = ?")
        .get(campaignId).count,
    );
  } finally {
    db.close();
  }
}

function countCampaignStepJobs() {
  const db = new Database(databaseUrl, { readonly: true });
  try {
    return Number(
      db
        .prepare("SELECT COUNT(*) AS count FROM jobs WHERE user_id = 1 AND type = 'campaign_step'")
        .get().count,
    );
  } finally {
    db.close();
  }
}

function pauseSchedulerCanary(campaignId) {
  const db = new Database(databaseUrl);
  try {
    db.prepare("UPDATE campaigns SET status = 'paused', updated_at = ? WHERE user_id = 1 AND id = ?").run(
      new Date().toISOString(),
      campaignId,
    );
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
