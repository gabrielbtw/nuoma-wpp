import AxeBuilder from "@axe-core/playwright";
import Database from "better-sqlite3";
import { chromium } from "playwright";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const webUrl = process.env.WEB_URL ?? "http://127.0.0.1:3002";
const apiUrl = process.env.API_URL ?? "http://127.0.0.1:3001";
const email = process.env.SMOKE_EMAIL ?? "admin@nuoma.local";
const password = process.env.SMOKE_PASSWORD ?? "nuoma-dev-admin-123";
const appScreenshotPath = process.env.APP_SCREENSHOT_PATH ?? "data/v210-pause-resume-m27-app.png";
const wppScreenshotPath = process.env.WPP_SCREENSHOT_PATH ?? "data/v210-pause-resume-m27-wpp.png";
const databaseUrl = path.resolve(process.env.DATABASE_URL ?? "data/nuoma-v2.db");
const cdpUrl = process.env.CDP_URL ?? "http://127.0.0.1:9223";
const whatsappUrl = process.env.WA_WEB_URL ?? "https://web.whatsapp.com/";
const canaryPhone = "5531982066263";

async function main() {
  await assertHttp(`${webUrl}/`, "web");
  await assertHttp(`${apiUrl}/health`, "api");
  await fs.mkdir(path.dirname(appScreenshotPath), { recursive: true });
  await fs.mkdir(path.dirname(wppScreenshotPath), { recursive: true });

  const fixture = seedPauseResumeFixture();
  const campaignStepJobsBefore = countCampaignStepJobs(fixture.campaignId);

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
    await page.getByText("V2.10.9 Smoke Pause Resume").waitFor({
      state: "visible",
      timeout: 10_000,
    });

    let campaignCard = page.locator(
      `[data-testid="campaign-list-item"][data-campaign-id="${fixture.campaignId}"]`,
    );
    await campaignCard.waitFor({ state: "visible", timeout: 10_000 });

    await campaignCard.getByTestId("campaign-preview-button").click();
    await page.getByText("Último tick").waitFor({ state: "visible", timeout: 10_000 });
    await page.getByText("0 job(s) planejado(s)").waitFor({ state: "visible", timeout: 10_000 });
    const pausedJobsDelta = countCampaignStepJobs(fixture.campaignId) - campaignStepJobsBefore;
    if (pausedJobsDelta !== 0) {
      throw new Error(`paused campaign preview created job(s): delta=${pausedJobsDelta}`);
    }

    await campaignCard.getByTestId("campaign-resume-button").click();
    await page
      .locator(
        `[data-testid="campaign-list-item"][data-campaign-id="${fixture.campaignId}"][data-campaign-status="running"]`,
      )
      .waitFor({ state: "visible", timeout: 10_000 });
    campaignCard = page.locator(
      `[data-testid="campaign-list-item"][data-campaign-id="${fixture.campaignId}"]`,
    );
    await page
      .locator(
        `[data-testid="campaign-pause-resume-panel"][data-campaign-id="${fixture.campaignId}"][data-last-action="resumed"]`,
      )
      .waitFor({ state: "visible", timeout: 10_000 });
    const expectedTitle = await readWhatsAppCanaryTitle();
    if (expectedTitle) {
      preserveCanaryConversationTitle(expectedTitle);
    }

    await campaignCard.getByTestId("campaign-preview-button").click();
    await page.getByText(canaryPhone).first().waitFor({ state: "visible", timeout: 10_000 });

    await campaignCard.getByTestId("campaign-enqueue-button").click();
    await page.getByText("1 job(s) criado(s)").waitFor({ state: "visible", timeout: 15_000 });
    boostCampaignStepJob(fixture.campaignId);
    const completion = await waitForCampaignCompleted(fixture.campaignId, 180_000);

    await campaignCard.getByTestId("campaign-pause-button").click();
    await page
      .locator(
        `[data-testid="campaign-list-item"][data-campaign-id="${fixture.campaignId}"][data-campaign-status="paused"]`,
      )
      .waitFor({ state: "visible", timeout: 10_000 });
    await page
      .locator(
        `[data-testid="campaign-pause-resume-panel"][data-campaign-id="${fixture.campaignId}"][data-last-action="paused"]`,
      )
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: appScreenshotPath, fullPage: false });

    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const blocking = result.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious",
    );
    if (blocking.length > 0) {
      throw new Error(
        `V2.10.9 pause/resume has blocking a11y violations: ${blocking
          .map((violation) => `${violation.id}:${violation.impact}`)
          .join(", ")}`,
      );
    }

    await context.close();

    const wppMode = await captureWhatsAppPrint(wppScreenshotPath, fixture.token);
    const activeJobs = countActiveCampaignStepJobs(fixture.campaignId);
    if (activeJobs !== 0) {
      throw new Error(`campaign still has active campaign_step job(s): ${activeJobs}`);
    }
    console.log(
      `v210-pause-resume|campaign=${fixture.campaignId}|pausedDelta=${pausedJobsDelta}|realSend=completed|event=${completion.eventId}|job=${completion.jobId}|canary=${canaryPhone}|token=${fixture.token}|blocking=${blocking.length}|activeJobs=${activeJobs}|app=${appScreenshotPath}|wpp=${wppScreenshotPath}|wppMode=${wppMode}`,
    );
  } finally {
    await browser.close();
  }
}

function seedPauseResumeFixture() {
  const db = new Database(databaseUrl);
  try {
    db.pragma("foreign_keys = ON");
    const nowIso = new Date().toISOString();
    const token = `M27-${Date.now()}`;
    const existingCampaigns = db
      .prepare("SELECT id FROM campaigns WHERE user_id = 1 AND name LIKE 'V2.10.9 Smoke%'")
      .all();
    for (const row of existingCampaigns) {
      db.prepare("DELETE FROM campaign_recipients WHERE user_id = 1 AND campaign_id = ?").run(row.id);
      db.prepare("DELETE FROM jobs WHERE user_id = 1 AND dedupe_key LIKE ?").run(
        `campaign_step:${row.id}:%`,
      );
      db.prepare("DELETE FROM system_events WHERE user_id = 1 AND payload_json LIKE ?").run(
        `%"campaignId":${row.id}%`,
      );
    }
    db.prepare("DELETE FROM campaigns WHERE user_id = 1 AND name LIKE 'V2.10.9 Smoke%'").run();
    db.prepare("DELETE FROM system_events WHERE user_id = 1 AND payload_json LIKE '%v2.10.9-smoke%'").run();

    const steps = [
      {
        id: "v2109-pause-resume",
        label: "Pause/resume real",
        type: "text",
        delaySeconds: 0,
        conditions: [],
        template: `Smoke V2.10.9 pause/resume ${token} {{telefone}}`,
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
            1, 'V2.10.9 Smoke Pause Resume', 'paused', 'whatsapp', NULL, @steps,
            0, @nowIso, NULL, @metadata, @nowIso, @nowIso
          )
        `,
      )
      .run({
        steps: JSON.stringify(steps),
        metadata: JSON.stringify({
          smoke: "v2.10.9-smoke",
          m: 27,
          token,
        }),
        nowIso,
      });
    const campaignId = Number(campaignInfo.lastInsertRowid);
    db.prepare(
      `
        INSERT INTO campaign_recipients (
          user_id, campaign_id, contact_id, phone, channel, status,
          current_step_id, last_error, metadata_json, created_at, updated_at
        )
        VALUES (
          1, @campaignId, NULL, @phone, 'whatsapp', 'queued',
          NULL, NULL, @metadata, @nowIso, @nowIso
        )
      `,
    ).run({
      campaignId,
      phone: canaryPhone,
      metadata: JSON.stringify({
        smoke: "v2.10.9-smoke",
        token,
        variables: { nome: "Canario", telefone: canaryPhone },
      }),
      nowIso,
    });
    return { campaignId, token };
  } finally {
    db.close();
  }
}

function countCampaignStepJobs(campaignId) {
  const db = new Database(databaseUrl, { readonly: true });
  try {
    return Number(
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM jobs WHERE user_id = 1 AND type = 'campaign_step' AND dedupe_key LIKE ?",
        )
        .get(`campaign_step:${campaignId}:%`).count,
    );
  } finally {
    db.close();
  }
}

function countActiveCampaignStepJobs(campaignId) {
  const db = new Database(databaseUrl, { readonly: true });
  try {
    return Number(
      db
        .prepare(
          `
            SELECT COUNT(*) AS count
            FROM jobs
            WHERE user_id = 1
              AND type = 'campaign_step'
              AND dedupe_key LIKE ?
              AND status IN ('queued', 'claimed', 'running')
          `,
        )
        .get(`campaign_step:${campaignId}:%`).count,
    );
  } finally {
    db.close();
  }
}

function preserveCanaryConversationTitle(title) {
  const db = new Database(databaseUrl);
  try {
    const nowIso = new Date().toISOString();
    db.prepare(
      `
        INSERT INTO conversations (
          user_id, contact_id, channel, external_thread_id, title,
          last_message_at, last_preview, unread_count, created_at, updated_at
        )
        VALUES (1, NULL, 'whatsapp', @phone, @title, NULL, NULL, 0, @nowIso, @nowIso)
        ON CONFLICT(user_id, channel, external_thread_id) DO UPDATE SET
          title = excluded.title,
          updated_at = excluded.updated_at
      `,
    ).run({ phone: canaryPhone, title, nowIso });
  } finally {
    db.close();
  }
}

function boostCampaignStepJob(campaignId) {
  const db = new Database(databaseUrl);
  try {
    db.prepare(
      `
        UPDATE jobs
        SET priority = 0, scheduled_at = ?
        WHERE user_id = 1
          AND type = 'campaign_step'
          AND dedupe_key LIKE ?
          AND status = 'queued'
      `,
    ).run(new Date().toISOString(), `campaign_step:${campaignId}:%`);
  } finally {
    db.close();
  }
}

async function waitForCampaignCompleted(campaignId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastJob = null;
  while (Date.now() < deadline) {
    const db = new Database(databaseUrl, { readonly: true });
    try {
      const event = db
        .prepare(
          `
            SELECT id
            FROM system_events
            WHERE user_id = 1
              AND type = 'sender.campaign_step.completed'
              AND payload_json LIKE ?
            ORDER BY id DESC
            LIMIT 1
          `,
        )
        .get(`%"campaignId":${campaignId}%`);
      const job = db
        .prepare(
          `
            SELECT id, status, attempts, last_error
            FROM jobs
            WHERE user_id = 1
              AND type = 'campaign_step'
              AND dedupe_key LIKE ?
            ORDER BY id DESC
            LIMIT 1
          `,
        )
        .get(`campaign_step:${campaignId}:%`);
      lastJob = job ?? lastJob;
      if (event) {
        return { eventId: event.id, jobId: job?.id ?? null };
      }
      if (job?.status === "failed" || job?.status === "cancelled") {
        throw new Error(
          `campaign_step ${job.id} ended as ${job.status}: ${job.last_error ?? "no error"}`,
        );
      }
    } finally {
      db.close();
    }
    await sleep(2_000);
  }
  throw new Error(`timed out waiting for campaign completion; lastJob=${JSON.stringify(lastJob)}`);
}

async function readWhatsAppCanaryTitle() {
  try {
    const browser = await chromium.connectOverCDP(cdpUrl);
    try {
      const context = browser.contexts()[0] ?? (await browser.newContext());
      let page = context.pages().find((candidate) => candidate.url().startsWith(whatsappUrl));
      page ??= context.pages()[0] ?? (await context.newPage());
      await page.goto(`${whatsappUrl}send?phone=${canaryPhone}`, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
      await page.waitForTimeout(5_000);
      const title = await page.evaluate(() => {
        const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
        const header = document.querySelector("#main header");
        const candidates = header
          ? Array.from(header.querySelectorAll("span[title], span, div"))
              .map((node) => clean(node.getAttribute("title") || node.textContent))
              .filter((text) => text && text.length > 2 && !text.includes("wds-ic-"))
          : [];
        return candidates[0] || "";
      });
      const normalizedTitle = String(title ?? "").trim();
      return normalizedTitle && !normalizedTitle.replace(/\D/g, "").startsWith("55")
        ? normalizedTitle
        : null;
    } finally {
      await browser.close();
    }
  } catch {
    return null;
  }
}

async function captureWhatsAppPrint(outputPath, token) {
  try {
    const browser = await chromium.connectOverCDP(cdpUrl);
    try {
      const context = browser.contexts()[0] ?? (await browser.newContext());
      let page = context.pages().find((candidate) => candidate.url().startsWith(whatsappUrl));
      page ??= context.pages()[0] ?? (await context.newPage());
      await page.goto(`${whatsappUrl}send?phone=${canaryPhone}`, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.waitForTimeout(6_000);
      const tokenVisible = await page.getByText(token, { exact: false }).count().catch(() => 0);
      await page.screenshot({ path: outputPath, fullPage: false });
      return tokenVisible > 0 ? "cdp-token" : "cdp";
    } finally {
      await browser.close();
    }
  } catch (error) {
    const fallback = await chromium.launch({ headless: true });
    try {
      const page = await fallback.newPage({ viewport: { width: 1366, height: 768 } });
      await page.goto(whatsappUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.screenshot({ path: outputPath, fullPage: false });
      return `fallback:${error instanceof Error ? error.message : String(error)}`;
    } finally {
      await fallback.close();
    }
  }
}

async function assertHttp(url, label) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${label} not healthy at ${url}: ${response.status}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
