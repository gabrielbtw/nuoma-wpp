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
  process.env.APP_SCREENSHOT_PATH ?? "data/v210-recipient-audit-ic2-m30-app.png";
const wppScreenshotPath =
  process.env.WPP_SCREENSHOT_PATH ?? "data/v210-recipient-audit-ic2-m30-wpp.png";
const databaseUrl = path.resolve(process.env.DATABASE_URL ?? "data/nuoma-v2.db");
const cdpUrl = process.env.CDP_URL ?? "http://127.0.0.1:9223";
const whatsappUrl = process.env.WA_WEB_URL ?? "https://web.whatsapp.com/";

async function main() {
  await assertHttp(`${webUrl}/`, "web");
  await assertHttp(`${apiUrl}/health`, "api");
  await fs.mkdir(path.dirname(appScreenshotPath), { recursive: true });
  await fs.mkdir(path.dirname(wppScreenshotPath), { recursive: true });

  const campaignStepJobsBefore = countCampaignStepJobs();
  const fixture = seedFixture();

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
    const campaignRow = page.locator(
      `[data-testid="campaign-list-item"][data-campaign-id="${fixture.campaignId}"]`,
    );
    await campaignRow.waitFor({ state: "visible", timeout: 10_000 });
    await campaignRow.scrollIntoViewIfNeeded();

    await campaignRow.getByText("24h/90d").first().waitFor({ state: "visible", timeout: 10_000 });
    await campaignRow.getByText("reuso").first().waitFor({ state: "visible", timeout: 10_000 });
    await campaignRow.getByText("batch:3/3").first().waitFor({ state: "visible", timeout: 10_000 });
    await campaignRow.getByText("temp:after_completion_restore:90d").first().waitFor({
      state: "visible",
      timeout: 10_000,
    });

    const recipientRows = await campaignRow
      .locator('[data-testid="campaign-recipient-row"]')
      .evaluateAll((rows) =>
        rows.map((row) => ({
          recipientId: row.getAttribute("data-recipient-id"),
          status: row.getAttribute("data-status"),
          text: row.textContent ?? "",
        })),
      );
    if (recipientRows.length < 2) {
      throw new Error(`expected two recipient rows, got ${recipientRows.length}`);
    }
    if (!recipientRows.some((row) => row.text.includes("failure_restore"))) {
      throw new Error(`missing failure restore audit row: ${JSON.stringify(recipientRows)}`);
    }

    const campaignStepJobsDelta = countCampaignStepJobs() - campaignStepJobsBefore;
    if (campaignStepJobsDelta !== 0) {
      throw new Error(`audit smoke created campaign_step job(s): delta=${campaignStepJobsDelta}`);
    }

    await page.screenshot({ path: appScreenshotPath, fullPage: false });
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const blocking = result.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious",
    );
    if (blocking.length > 0) {
      throw new Error(
        `V2.10.10-13 audit/IC2 smoke has blocking a11y violations: ${blocking
          .map((violation) => `${violation.id}:${violation.impact}`)
          .join(", ")}`,
      );
    }

    await context.close();
    const wppMode = await captureWhatsAppPrint(wppScreenshotPath);
    console.log(
      `v210-recipient-audit-ic2|campaign=${fixture.campaignId}|recipients=${recipientRows.length}|temp=24h/90d|batch=3|reuso=2|campaignStepJobsDelta=${campaignStepJobsDelta}|blocking=${blocking.length}|app=${appScreenshotPath}|wpp=${wppScreenshotPath}|wppMode=${wppMode}|ig=nao_aplicavel`,
    );
  } finally {
    await browser.close();
  }
}

function seedFixture() {
  const db = new Database(databaseUrl);
  try {
    db.pragma("foreign_keys = ON");
    const now = new Date();
    const nowIso = now.toISOString();
    const existing = db
      .prepare("SELECT id FROM campaigns WHERE user_id = 1 AND name LIKE 'V2.10.10-13 Smoke%'")
      .all();
    for (const row of existing) {
      db.prepare("DELETE FROM campaign_recipients WHERE user_id = 1 AND campaign_id = ?").run(row.id);
      db.prepare("DELETE FROM jobs WHERE user_id = 1 AND dedupe_key LIKE ?").run(
        `campaign_step:${row.id}:%`,
      );
      db.prepare("DELETE FROM system_events WHERE user_id = 1 AND payload_json LIKE ?").run(
        `%"campaignId":${row.id}%`,
      );
    }
    db.prepare("DELETE FROM campaigns WHERE user_id = 1 AND name LIKE 'V2.10.10-13 Smoke%'").run();
    db.prepare("DELETE FROM system_events WHERE user_id = 1 AND payload_json LIKE '%v2.10.10-13-smoke%'").run();

    const steps = [
      {
        id: "intro",
        label: "Intro",
        type: "text",
        delaySeconds: 0,
        conditions: [],
        template: "Intro {{telefone}}",
      },
      {
        id: "proof",
        label: "Prova",
        type: "text",
        delaySeconds: 0,
        conditions: [],
        template: "Prova {{telefone}}",
      },
      {
        id: "close",
        label: "Fechamento",
        type: "text",
        delaySeconds: 0,
        conditions: [],
        template: "Fechamento {{telefone}}",
      },
    ];
    const metadata = {
      smoke: "v2.10.10-13-smoke",
      temporaryMessages: {
        enabled: true,
        beforeSendDuration: "24h",
        afterCompletionDuration: "90d",
        restoreOnFailure: true,
      },
    };
    const campaignInfo = db
      .prepare(
        `
          INSERT INTO campaigns (
            user_id, name, status, channel, segment_json, steps_json,
            evergreen, starts_at, completed_at, metadata_json, created_at, updated_at
          )
          VALUES (
            1, 'V2.10.10-13 Smoke Audit IC2', 'draft', 'whatsapp', NULL, @steps,
            0, NULL, NULL, @metadata, @nowIso, @nowIso
          )
        `,
      )
      .run({
        steps: JSON.stringify(steps),
        metadata: JSON.stringify(metadata),
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
    const completedRecipientId = Number(
      insertRecipient.run({
        campaignId,
        phone: "5531982066263",
        status: "completed",
        currentStepId: "close",
        lastError: null,
        metadata: JSON.stringify({
          smoke: "v2.10.10-13-smoke",
          campaignBatchId: "m30-batch-ok",
          awaitingJobIds: [],
          awaitingStepIds: [],
          temporaryMessages: metadata.temporaryMessages,
        }),
        nowIso,
      }).lastInsertRowid,
    );
    const failedRecipientId = Number(
      insertRecipient.run({
        campaignId,
        phone: "553188810010",
        status: "failed",
        currentStepId: "proof",
        lastError: "simulated temporary restore failure path",
        metadata: JSON.stringify({
          smoke: "v2.10.10-13-smoke",
          campaignBatchId: "m30-batch-fail",
          temporaryMessages: metadata.temporaryMessages,
        }),
        nowIso,
      }).lastInsertRowid,
    );

    const insertEvent = db.prepare(`
      INSERT INTO system_events (user_id, type, severity, payload_json, created_at)
      VALUES (1, @type, @severity, @payload, @createdAt)
    `);
    const event = (secondsAgo, type, severity, payload) => {
      insertEvent.run({
        type,
        severity,
        payload: JSON.stringify({
          smoke: "v2.10.10-13-smoke",
          campaignId,
          ...payload,
        }),
        createdAt: new Date(now.getTime() - secondsAgo * 1000).toISOString(),
      });
    };

    event(80, "sender.temporary_messages.audit", "info", {
      recipientId: completedRecipientId,
      jobId: 30001,
      stepId: "intro",
      stepType: "text",
      phase: "before_send",
      duration: "24h",
      executionMode: "audit_only",
      campaignBatchId: "m30-batch-ok",
      campaignBatchIndex: 0,
      campaignBatchSize: 3,
    });
    event(70, "sender.campaign_step.completed", "info", {
      recipientId: completedRecipientId,
      jobId: 30001,
      stepId: "intro",
      stepType: "text",
      navigationMode: "navigated",
      campaignBatchId: "m30-batch-ok",
      campaignBatchIndex: 0,
      campaignBatchSize: 3,
      messageId: "m30-intro",
    });
    event(60, "sender.campaign_step.completed", "info", {
      recipientId: completedRecipientId,
      jobId: 30002,
      stepId: "proof",
      stepType: "text",
      navigationMode: "reused-open-chat",
      campaignBatchId: "m30-batch-ok",
      campaignBatchIndex: 1,
      campaignBatchSize: 3,
      messageId: "m30-proof",
    });
    event(50, "sender.campaign_step.completed", "info", {
      recipientId: completedRecipientId,
      jobId: 30003,
      stepId: "close",
      stepType: "text",
      navigationMode: "reused-open-chat",
      campaignBatchId: "m30-batch-ok",
      campaignBatchIndex: 2,
      campaignBatchSize: 3,
      messageId: "m30-close",
    });
    event(40, "sender.temporary_messages.audit", "info", {
      recipientId: completedRecipientId,
      jobId: 30003,
      stepId: "close",
      stepType: "text",
      phase: "after_completion_restore",
      duration: "90d",
      executionMode: "audit_only",
      campaignBatchId: "m30-batch-ok",
      campaignBatchIndex: 2,
      campaignBatchSize: 3,
    });
    event(30, "sender.campaign_step.failed", "warn", {
      recipientId: failedRecipientId,
      jobId: 30004,
      stepId: "proof",
      stepType: "text",
      navigationMode: "navigated",
      error: "simulated send failure",
      campaignBatchId: "m30-batch-fail",
      campaignBatchIndex: 1,
      campaignBatchSize: 3,
    });
    event(20, "sender.temporary_messages.audit", "warn", {
      recipientId: failedRecipientId,
      jobId: 30004,
      stepId: "proof",
      stepType: "text",
      phase: "failure_restore",
      duration: "90d",
      executionMode: "audit_only",
      error: "simulated send failure",
      campaignBatchId: "m30-batch-fail",
      campaignBatchIndex: 1,
      campaignBatchSize: 3,
    });

    return { campaignId };
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
