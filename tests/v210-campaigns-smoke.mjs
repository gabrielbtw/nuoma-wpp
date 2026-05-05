import AxeBuilder from "@axe-core/playwright";
import Database from "better-sqlite3";
import { chromium } from "playwright";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const webUrl = process.env.WEB_URL ?? "http://127.0.0.1:3002";
const apiUrl = process.env.API_URL ?? "http://127.0.0.1:3001";
const email = process.env.SMOKE_EMAIL ?? "admin@nuoma.local";
const password = process.env.SMOKE_PASSWORD ?? "nuoma-dev-admin-123";
const appScreenshotPath = process.env.APP_SCREENSHOT_PATH ?? "data/v210-campaigns-m23-app.png";
const wppScreenshotPath = process.env.WPP_SCREENSHOT_PATH ?? "data/v210-campaigns-m23-wpp.png";
const databaseUrl = path.resolve(process.env.DATABASE_URL ?? "data/nuoma-v2.db");
const cdpUrl = process.env.CDP_URL ?? "http://127.0.0.1:9223";
const whatsappUrl = process.env.WA_WEB_URL ?? "https://web.whatsapp.com/";
const canaryPhone = "5531982066263";

async function main() {
  await assertHttp(`${webUrl}/`, "web");
  await assertHttp(`${apiUrl}/health`, "api");
  await fs.mkdir(path.dirname(appScreenshotPath), { recursive: true });
  await fs.mkdir(path.dirname(wppScreenshotPath), { recursive: true });

  const fixture = seedCampaignsFixture();
  const campaignStepJobsBefore = countCampaignStepJobs();

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
    await page.getByTestId("campaign-builder-base").waitFor({ state: "visible", timeout: 10_000 });

    await page.getByTestId("campaign-template-card").first().click();
    await page.getByTestId("campaign-builder-steps").waitFor({ state: "visible", timeout: 10_000 });
    await page.getByTestId("campaign-step-condition-row").first().waitFor({
      state: "visible",
      timeout: 10_000,
    });

    await page.getByTestId("campaign-builder-tab-audience").click();
    await page.getByTestId("campaign-csv-text").fill(
      [
        "nome,telefone,email",
        `Canario,+55 31 98206-6263,canario@nuoma.local`,
        `Duplicado,${canaryPhone},duplicado@nuoma.local`,
        "Invalido,abc,invalido@nuoma.local",
      ].join("\n"),
    );
    await page.getByTestId("campaign-csv-process").click();
    await page.getByTestId("campaign-csv-rows").waitFor({ state: "visible", timeout: 10_000 });
    const csvDiagnostics = await page.getByTestId("campaign-csv-rows").evaluate((element) => {
      const rows = Array.from(element.querySelectorAll("[data-valid]"));
      return {
        rows: rows.length,
        valid: rows.filter((row) => row.getAttribute("data-valid") === "true").length,
        invalid: rows.filter((row) => row.getAttribute("data-valid") === "false").length,
      };
    });
    if (csvDiagnostics.rows !== 3 || csvDiagnostics.valid !== 1 || csvDiagnostics.invalid !== 2) {
      throw new Error(`CSV preview diagnostics mismatch: ${JSON.stringify(csvDiagnostics)}`);
    }

    await page.getByTestId("campaign-builder-tab-preview").click();
    await page.getByTestId("campaign-preview-panel").waitFor({ state: "visible", timeout: 10_000 });
    const workflowNodes = await page.getByTestId("campaign-workflow-node").count();
    if (workflowNodes < 5) {
      throw new Error(`workflow viewer rendered too few nodes: ${workflowNodes}`);
    }

    const virtualDiagnostics = await page
      .locator('[data-testid="campaign-recipients-virtual-scroll"]')
      .evaluateAll((elements) =>
        elements.map((element) => ({
          campaignId: element.getAttribute("data-campaign-id"),
          total: Number(element.getAttribute("data-total-count") ?? "0"),
          visible: Number(element.getAttribute("data-visible-count") ?? "0"),
          virtualized: element.getAttribute("data-virtualized"),
          rendered: element.querySelectorAll('[data-testid="campaign-recipient-row"]').length,
        })),
      );
    const virtualTable = virtualDiagnostics.find(
      (item) => item.campaignId === String(fixture.virtualCampaignId),
    );
    if (!virtualTable) {
      throw new Error(`seeded virtual campaign table not found: ${JSON.stringify(virtualDiagnostics)}`);
    }
    if (
      virtualTable.virtualized !== "true" ||
      virtualTable.total < 80 ||
      virtualTable.visible <= 0 ||
      virtualTable.rendered !== virtualTable.visible ||
      virtualTable.rendered >= virtualTable.total
    ) {
      throw new Error(`recipient virtual table diagnostics mismatch: ${JSON.stringify(virtualTable)}`);
    }
    const virtualScroll = page.locator(
      `[data-testid="campaign-recipients-virtual-scroll"][data-campaign-id="${fixture.virtualCampaignId}"]`,
    );
    await virtualScroll.locator('[data-testid="campaign-recipient-row"]').first().hover();
    await virtualScroll.evaluate((element) => {
      element.scrollTop = 900;
      element.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await page.waitForTimeout(250);
    const afterScroll = await virtualScroll.evaluate((element) => ({
      rendered: element.querySelectorAll('[data-testid="campaign-recipient-row"]').length,
      visible: Number(element.getAttribute("data-visible-count") ?? "0"),
      firstTop: Math.round(
        element.querySelector('[data-testid="campaign-recipient-row"]')?.getBoundingClientRect().top ?? 0,
      ),
    }));
    if (afterScroll.rendered !== afterScroll.visible || afterScroll.rendered <= 0) {
      throw new Error(`virtual table broke after scroll: ${JSON.stringify(afterScroll)}`);
    }

    await page.getByRole("button", { name: /^Prévia$/ }).first().click();
    await page.getByText("Último tick").waitFor({ state: "visible", timeout: 10_000 });
    await page.getByText(canaryPhone).first().waitFor({ state: "visible", timeout: 10_000 });

    const campaignStepJobsAfter = countCampaignStepJobs();
    const campaignStepJobsDelta = campaignStepJobsAfter - campaignStepJobsBefore;
    if (campaignStepJobsDelta !== 0) {
      throw new Error(`dry-run created campaign_step job(s): delta=${campaignStepJobsDelta}`);
    }

    await page.screenshot({ path: appScreenshotPath, fullPage: true });
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const blocking = result.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious",
    );
    if (blocking.length > 0) {
      throw new Error(
        `V2.10 campaigns UI has blocking a11y violations: ${blocking
          .map((violation) => `${violation.id}:${violation.impact}`)
          .join(", ")}`,
      );
    }

    await context.close();

    const wppMode = await captureWhatsAppPrint(wppScreenshotPath);
    pauseSchedulerCanary(fixture.canaryCampaignId);
    console.log(
      `v210-campaigns|csv=${csvDiagnostics.valid}/${csvDiagnostics.invalid}|workflowNodes=${workflowNodes}|virtualTotal=${virtualTable.total}|virtualRendered=${virtualTable.rendered}|dryRunPhone=${canaryPhone}|campaignStepJobsDelta=${campaignStepJobsDelta}|blocking=${blocking.length}|app=${appScreenshotPath}|wpp=${wppScreenshotPath}|wppMode=${wppMode}`,
    );
  } finally {
    await browser.close();
  }
}

function seedCampaignsFixture() {
  const db = new Database(databaseUrl);
  try {
    db.pragma("foreign_keys = ON");
    const now = new Date().toISOString();
    const existing = db
      .prepare("SELECT id FROM campaigns WHERE user_id = 1 AND name LIKE 'V2.10 Smoke%'")
      .all();
    for (const row of existing) {
      db.prepare("DELETE FROM campaign_recipients WHERE user_id = 1 AND campaign_id = ?").run(row.id);
    }
    db.prepare("DELETE FROM campaigns WHERE user_id = 1 AND name LIKE 'V2.10 Smoke%'").run();
    db.prepare("DELETE FROM system_events WHERE user_id = 1 AND payload_json LIKE '%v2.10-smoke%'").run();

    const insertCampaign = db.prepare(`
      INSERT INTO campaigns (
        user_id, name, status, channel, segment_json, steps_json,
        evergreen, starts_at, completed_at, metadata_json, created_at, updated_at
      )
      VALUES (
        1, @name, @status, 'whatsapp', NULL, @steps,
        0, @startsAt, NULL, @metadata, @now, @now
      )
    `);
    const steps = JSON.stringify([
      {
        id: "v210-text",
        label: "Smoke seguro",
        type: "text",
        delaySeconds: 0,
        conditions: [],
        template: "Smoke V2.10 dry-run {{telefone}}",
      },
    ]);

    const virtualInfo = insertCampaign.run({
      name: "V2.10 Smoke Virtual Recipients",
      status: "draft",
      steps,
      startsAt: null,
      metadata: JSON.stringify({ smoke: "v2.10-smoke", purpose: "virtual-recipients" }),
      now,
    });
    const virtualCampaignId = Number(virtualInfo.lastInsertRowid);

    const canaryInfo = insertCampaign.run({
      name: "V2.10 Smoke Scheduler Canary",
      status: "running",
      steps,
      startsAt: now,
      metadata: JSON.stringify({ smoke: "v2.10-smoke", purpose: "scheduler-dry-run" }),
      now,
    });
    const canaryCampaignId = Number(canaryInfo.lastInsertRowid);

    const insertRecipient = db.prepare(`
      INSERT INTO campaign_recipients (
        user_id, campaign_id, contact_id, phone, channel, status,
        current_step_id, last_error, metadata_json, created_at, updated_at
      )
      VALUES (
        1, @campaignId, NULL, @phone, 'whatsapp', 'queued',
        NULL, NULL, @metadata, @now, @now
      )
    `);
    for (let index = 0; index < 80; index += 1) {
      insertRecipient.run({
        campaignId: virtualCampaignId,
        phone: `55318880${String(10_000 + index)}`,
        metadata: JSON.stringify({
          smoke: "v2.10-smoke",
          variables: { nome: `Lead ${index + 1}`, telefone: `fake-${index + 1}` },
        }),
        now,
      });
    }
    insertRecipient.run({
      campaignId: canaryCampaignId,
      phone: canaryPhone,
      metadata: JSON.stringify({
        smoke: "v2.10-smoke",
        variables: { nome: "Canario", telefone: canaryPhone },
      }),
      now,
    });

    return { virtualCampaignId, canaryCampaignId };
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
