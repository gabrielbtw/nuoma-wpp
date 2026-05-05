import AxeBuilder from "@axe-core/playwright";
import Database from "better-sqlite3";
import { chromium } from "playwright";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const webUrl = process.env.WEB_URL ?? "http://127.0.0.1:3002";
const apiUrl = process.env.API_URL ?? "http://127.0.0.1:3001";
const email = process.env.SMOKE_EMAIL ?? "admin@nuoma.local";
const password = process.env.SMOKE_PASSWORD ?? "nuoma-dev-admin-123";
const appScreenshotPath = process.env.APP_SCREENSHOT_PATH ?? "data/v210-step-stats-m24-app.png";
const wppScreenshotPath = process.env.WPP_SCREENSHOT_PATH ?? "data/v210-step-stats-m24-wpp.png";
const databaseUrl = path.resolve(process.env.DATABASE_URL ?? "data/nuoma-v2.db");
const cdpUrl = process.env.CDP_URL ?? "http://127.0.0.1:9223";
const whatsappUrl = process.env.WA_WEB_URL ?? "https://web.whatsapp.com/";

async function main() {
  await assertHttp(`${webUrl}/`, "web");
  await assertHttp(`${apiUrl}/health`, "api");
  await fs.mkdir(path.dirname(appScreenshotPath), { recursive: true });
  await fs.mkdir(path.dirname(wppScreenshotPath), { recursive: true });

  const fixture = seedStepStatsFixture();
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
    await page.getByText("V2.10.6 Smoke Step Stats").waitFor({
      state: "visible",
      timeout: 10_000,
    });

    const panel = page.locator(
      `[data-testid="campaign-step-stats"][data-campaign-id="${fixture.campaignId}"]`,
    );
    await panel.waitFor({ state: "visible", timeout: 10_000 });
    await panel.scrollIntoViewIfNeeded();

    const stats = await panel.locator('[data-testid="campaign-step-stat-row"]').evaluateAll((rows) =>
      rows.map((row) => ({
        stepId: row.getAttribute("data-step-id"),
        completed: Number(row.getAttribute("data-completed") ?? "0"),
        failed: Number(row.getAttribute("data-failed") ?? "0"),
        rate: Number(row.getAttribute("data-completion-rate") ?? "0"),
        text: row.textContent ?? "",
      })),
    );
    assertStep(stats, "step-intro", { completed: 3, failed: 0, rate: 0.75 });
    assertStep(stats, "step-proof", { completed: 2, failed: 1, rate: 0.5 });
    assertStep(stats, "step-close", { completed: 1, failed: 0, rate: 0.25 });
    await panel.getByText("75%").waitFor({ state: "visible", timeout: 10_000 });
    await panel.getByText("50%").waitFor({ state: "visible", timeout: 10_000 });
    await panel.getByText("25%").waitFor({ state: "visible", timeout: 10_000 });

    const campaignStepJobsAfter = countCampaignStepJobs();
    const campaignStepJobsDelta = campaignStepJobsAfter - campaignStepJobsBefore;
    if (campaignStepJobsDelta !== 0) {
      throw new Error(`step stats smoke created campaign_step job(s): delta=${campaignStepJobsDelta}`);
    }

    await page.screenshot({ path: appScreenshotPath, fullPage: false });
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const blocking = result.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious",
    );
    if (blocking.length > 0) {
      throw new Error(
        `V2.10.6 per-step stats has blocking a11y violations: ${blocking
          .map((violation) => `${violation.id}:${violation.impact}`)
          .join(", ")}`,
      );
    }

    await context.close();
    const wppMode = await captureWhatsAppPrint(wppScreenshotPath);
    console.log(
      `v210-step-stats|campaign=${fixture.campaignId}|steps=${stats.length}|intro=3/0/75|proof=2/1/50|close=1/0/25|campaignStepJobsDelta=${campaignStepJobsDelta}|blocking=${blocking.length}|app=${appScreenshotPath}|wpp=${wppScreenshotPath}|wppMode=${wppMode}`,
    );
  } finally {
    await browser.close();
  }
}

function seedStepStatsFixture() {
  const db = new Database(databaseUrl);
  try {
    db.pragma("foreign_keys = ON");
    const now = new Date();
    const nowIso = now.toISOString();
    const existing = db
      .prepare("SELECT id FROM campaigns WHERE user_id = 1 AND name LIKE 'V2.10.6 Smoke%'")
      .all();
    for (const row of existing) {
      db.prepare("DELETE FROM campaign_recipients WHERE user_id = 1 AND campaign_id = ?").run(row.id);
    }
    db.prepare("DELETE FROM campaigns WHERE user_id = 1 AND name LIKE 'V2.10.6 Smoke%'").run();
    db.prepare("DELETE FROM system_events WHERE user_id = 1 AND payload_json LIKE '%v2.10.6-smoke%'").run();

    const steps = [
      {
        id: "step-intro",
        label: "Intro",
        type: "text",
        delaySeconds: 0,
        conditions: [],
        template: "Oi {{nome}}, posso te mostrar uma prova?",
      },
      {
        id: "step-proof",
        label: "Prova",
        type: "link",
        delaySeconds: 60,
        conditions: [],
        text: "Ver antes e depois",
        url: "https://nuoma.com.br",
        previewEnabled: true,
      },
      {
        id: "step-close",
        label: "Fechamento",
        type: "text",
        delaySeconds: 3600,
        conditions: [],
        template: "Quer que eu reserve um horário?",
      },
    ];

    const campaignInfo = db
      .prepare(
        `
          INSERT INTO campaigns (
            user_id, name, status, channel, segment_json, steps_json,
            evergreen, starts_at, completed_at, metadata_json, created_at, updated_at
          )
          VALUES (
            1, 'V2.10.6 Smoke Step Stats', 'draft', 'whatsapp', NULL, @steps,
            0, NULL, NULL, @metadata, @nowIso, @nowIso
          )
        `,
      )
      .run({
        steps: JSON.stringify(steps),
        metadata: JSON.stringify({ smoke: "v2.10.6-smoke" }),
        nowIso,
      });
    const campaignId = Number(campaignInfo.lastInsertRowid);

    const insertRecipient = db.prepare(`
      INSERT INTO campaign_recipients (
        user_id, campaign_id, contact_id, phone, channel, status,
        current_step_id, last_error, metadata_json, created_at, updated_at
      )
      VALUES (
        1, @campaignId, NULL, @phone, 'whatsapp', @status,
        @currentStepId, @lastError, @metadata, @nowIso, @nowIso
      )
    `);
    const recipients = [
      insertRecipient.run({
        campaignId,
        phone: "5531982066263",
        status: "completed",
        currentStepId: "step-close",
        lastError: null,
        metadata: JSON.stringify({ smoke: "v2.10.6-smoke", variables: { nome: "Canario" } }),
        nowIso,
      }).lastInsertRowid,
      insertRecipient.run({
        campaignId,
        phone: "553188810001",
        status: "running",
        currentStepId: "step-proof",
        lastError: null,
        metadata: JSON.stringify({
          smoke: "v2.10.6-smoke",
          awaitingStepId: "step-close",
          variables: { nome: "Lead 2" },
        }),
        nowIso,
      }).lastInsertRowid,
      insertRecipient.run({
        campaignId,
        phone: "553188810002",
        status: "failed",
        currentStepId: "step-proof",
        lastError: "mock failure",
        metadata: JSON.stringify({ smoke: "v2.10.6-smoke", variables: { nome: "Lead 3" } }),
        nowIso,
      }).lastInsertRowid,
      insertRecipient.run({
        campaignId,
        phone: "553188810003",
        status: "queued",
        currentStepId: null,
        lastError: null,
        metadata: JSON.stringify({ smoke: "v2.10.6-smoke", variables: { nome: "Lead 4" } }),
        nowIso,
      }).lastInsertRowid,
    ].map(Number);

    const insertEvent = db.prepare(`
      INSERT INTO system_events (user_id, type, severity, payload_json, created_at)
      VALUES (1, @type, @severity, @payload, @createdAt)
    `);
    const event = (minutesAgo, type, severity, recipientIndex, stepId, stepType, navigationMode) => {
      const createdAt = new Date(now.getTime() - minutesAgo * 60_000).toISOString();
      insertEvent.run({
        type,
        severity,
        payload: JSON.stringify({
          smoke: "v2.10.6-smoke",
          campaignId,
          recipientId: recipients[recipientIndex],
          stepId,
          stepType,
          navigationMode,
          jobId: 24_000 + minutesAgo,
          messageId: `m24-${stepId}-${recipientIndex}`,
          externalId: `ext-m24-${stepId}-${recipientIndex}`,
        }),
        createdAt,
      });
    };
    event(30, "sender.campaign_step.completed", "info", 0, "step-intro", "text", "navigated");
    event(29, "sender.campaign_step.completed", "info", 1, "step-intro", "text", "reused-open-chat");
    event(28, "sender.campaign_step.completed", "info", 2, "step-intro", "text", "navigated");
    event(20, "sender.campaign_step.completed", "info", 0, "step-proof", "link", "reused-open-chat");
    event(19, "sender.campaign_step.completed", "info", 1, "step-proof", "link", "reused-open-chat");
    event(18, "sender.campaign_step.failed", "warn", 2, "step-proof", "link", "navigated");
    event(10, "sender.campaign_step.completed", "info", 0, "step-close", "text", "reused-open-chat");

    return { campaignId };
  } finally {
    db.close();
  }
}

function assertStep(stats, stepId, expected) {
  const stat = stats.find((item) => item.stepId === stepId);
  if (!stat) {
    throw new Error(`missing step stat ${stepId}: ${JSON.stringify(stats)}`);
  }
  const rateDiff = Math.abs(stat.rate - expected.rate);
  if (stat.completed !== expected.completed || stat.failed !== expected.failed || rateDiff > 0.001) {
    throw new Error(
      `step stat mismatch for ${stepId}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(stat)}`,
    );
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
