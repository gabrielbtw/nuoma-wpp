import AxeBuilder from "@axe-core/playwright";
import Database from "better-sqlite3";
import { chromium } from "playwright";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const webUrl = process.env.WEB_URL ?? "http://127.0.0.1:3002";
const apiUrl = process.env.API_URL ?? "http://127.0.0.1:3001";
const email = process.env.SMOKE_EMAIL ?? "admin@nuoma.local";
const password = process.env.SMOKE_PASSWORD ?? "nuoma-dev-admin-123";
const appScreenshotPath = process.env.APP_SCREENSHOT_PATH ?? "data/v210-ab-variants-m25-app.png";
const wppScreenshotPath = process.env.WPP_SCREENSHOT_PATH ?? "data/v210-ab-variants-m25-wpp.png";
const databaseUrl = path.resolve(process.env.DATABASE_URL ?? "data/nuoma-v2.db");
const cdpUrl = process.env.CDP_URL ?? "http://127.0.0.1:9223";
const whatsappUrl = process.env.WA_WEB_URL ?? "https://web.whatsapp.com/";
const canaryPhone = "5531982066263";

async function main() {
  await assertHttp(`${webUrl}/`, "web");
  await assertHttp(`${apiUrl}/health`, "api");
  await fs.mkdir(path.dirname(appScreenshotPath), { recursive: true });
  await fs.mkdir(path.dirname(wppScreenshotPath), { recursive: true });

  const fixture = seedAbVariantsFixture();
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
    await page.getByText("V2.10.7 Smoke AB Variants").waitFor({
      state: "visible",
      timeout: 10_000,
    });

    const panel = page.locator(
      `[data-testid="campaign-ab-variants"][data-campaign-id="${fixture.displayCampaignId}"]`,
    );
    await panel.waitFor({ state: "visible", timeout: 10_000 });
    await panel.scrollIntoViewIfNeeded();

    const variants = await panel.locator('[data-testid="campaign-ab-variant-row"]').evaluateAll((rows) =>
      rows.map((row) => ({
        id: row.getAttribute("data-variant-id"),
        assigned: Number(row.getAttribute("data-assigned") ?? "0"),
        completed: Number(row.getAttribute("data-completed") ?? "0"),
        failed: Number(row.getAttribute("data-failed") ?? "0"),
        rate: Number(row.getAttribute("data-completion-rate") ?? "0"),
        text: row.textContent ?? "",
      })),
    );
    assertVariant(variants, "a", { assigned: 3, completed: 2, failed: 0, rate: 2 / 3 });
    assertVariant(variants, "b", { assigned: 3, completed: 1, failed: 1, rate: 1 / 3 });
    await panel.getByText("67%").waitFor({ state: "visible", timeout: 10_000 });
    await panel.getByText("33%").waitFor({ state: "visible", timeout: 10_000 });

    await page.getByRole("button", { name: /^Prévia$/ }).first().click();
    await page.getByText("Último tick").waitFor({ state: "visible", timeout: 10_000 });
    await page.getByText(canaryPhone).first().waitFor({ state: "visible", timeout: 10_000 });
    await page.getByText("A/B Direta").first().waitFor({ state: "visible", timeout: 10_000 });

    const campaignStepJobsAfter = countCampaignStepJobs();
    const campaignStepJobsDelta = campaignStepJobsAfter - campaignStepJobsBefore;
    if (campaignStepJobsDelta !== 0) {
      throw new Error(`A/B dry-run created campaign_step job(s): delta=${campaignStepJobsDelta}`);
    }

    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: appScreenshotPath, fullPage: false });
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const blocking = result.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious",
    );
    if (blocking.length > 0) {
      throw new Error(
        `V2.10.7 A/B variants has blocking a11y violations: ${blocking
          .map((violation) => `${violation.id}:${violation.impact}`)
          .join(", ")}`,
      );
    }

    await context.close();
    const wppMode = await captureWhatsAppPrint(wppScreenshotPath);
    pauseSchedulerCanary(fixture.canaryCampaignId);
    console.log(
      `v210-ab-variants|campaign=${fixture.displayCampaignId}|variants=${variants.length}|a=3/2/0/67|b=3/1/1/33|dryRunPhone=${canaryPhone}|campaignStepJobsDelta=${campaignStepJobsDelta}|blocking=${blocking.length}|app=${appScreenshotPath}|wpp=${wppScreenshotPath}|wppMode=${wppMode}`,
    );
  } finally {
    await browser.close();
  }
}

function seedAbVariantsFixture() {
  const db = new Database(databaseUrl);
  try {
    db.pragma("foreign_keys = ON");
    const now = new Date();
    const nowIso = now.toISOString();
    const existing = db
      .prepare("SELECT id FROM campaigns WHERE user_id = 1 AND name LIKE 'V2.10.7 Smoke%'")
      .all();
    for (const row of existing) {
      db.prepare("DELETE FROM campaign_recipients WHERE user_id = 1 AND campaign_id = ?").run(row.id);
    }
    db.prepare("DELETE FROM campaigns WHERE user_id = 1 AND name LIKE 'V2.10.7 Smoke%'").run();
    db.prepare("DELETE FROM system_events WHERE user_id = 1 AND payload_json LIKE '%v2.10.7-smoke%'").run();

    const steps = [
      {
        id: "ab-intro",
        label: "Intro",
        type: "text",
        delaySeconds: 0,
        conditions: [],
        template: "Controle {{nome}}",
      },
      {
        id: "ab-close",
        label: "Fechamento",
        type: "text",
        delaySeconds: 60,
        conditions: [],
        template: "Quer continuar?",
      },
    ];
    const abVariants = {
      enabled: true,
      assignment: "deterministic",
      variants: [
        { id: "a", label: "Controle", weight: 50, stepOverrides: {} },
        {
          id: "b",
          label: "Direta",
          weight: 50,
          stepOverrides: {
            "ab-intro": { template: "Direta {{nome}}", delaySeconds: 15 },
          },
        },
      ],
    };

    const insertCampaign = db.prepare(`
      INSERT INTO campaigns (
        user_id, name, status, channel, segment_json, steps_json,
        evergreen, starts_at, completed_at, metadata_json, created_at, updated_at
      )
      VALUES (
        1, @name, @status, 'whatsapp', NULL, @steps,
        0, @startsAt, NULL, @metadata, @nowIso, @nowIso
      )
    `);
    const displayInfo = insertCampaign.run({
      name: "V2.10.7 Smoke AB Variants",
      status: "draft",
      steps: JSON.stringify(steps),
      startsAt: null,
      metadata: JSON.stringify({ smoke: "v2.10.7-smoke", abVariants }),
      nowIso,
    });
    const displayCampaignId = Number(displayInfo.lastInsertRowid);
    const canaryInfo = insertCampaign.run({
      name: "V2.10.7 Smoke AB Canary",
      status: "running",
      steps: JSON.stringify(steps.slice(0, 1)),
      startsAt: nowIso,
      metadata: JSON.stringify({ smoke: "v2.10.7-smoke", abVariants }),
      nowIso,
    });
    const canaryCampaignId = Number(canaryInfo.lastInsertRowid);

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
    const recipients = [];
    for (let index = 0; index < 6; index += 1) {
      const variantId = index < 3 ? "a" : "b";
      recipients.push(
        Number(
          insertRecipient.run({
            campaignId: displayCampaignId,
            phone: index === 0 ? canaryPhone : `55318882${String(10_000 + index)}`,
            status: index === 2 || index === 5 ? "queued" : "running",
            currentStepId: index === 2 || index === 5 ? null : "ab-intro",
            lastError: index === 4 ? "mock variant failure" : null,
            metadata: JSON.stringify({
              smoke: "v2.10.7-smoke",
              abVariantId: variantId,
              abVariantLabel: variantId === "a" ? "Controle" : "Direta",
              variables: { nome: `Lead ${index + 1}` },
            }),
            nowIso,
          }).lastInsertRowid,
        ),
      );
    }
    insertRecipient.run({
      campaignId: canaryCampaignId,
      phone: canaryPhone,
      status: "queued",
      currentStepId: null,
      lastError: null,
      metadata: JSON.stringify({
        smoke: "v2.10.7-smoke",
        abVariantId: "b",
        variables: { nome: "Canario" },
      }),
      nowIso,
    });

    const insertEvent = db.prepare(`
      INSERT INTO system_events (user_id, type, severity, payload_json, created_at)
      VALUES (1, @type, @severity, @payload, @createdAt)
    `);
    const event = (minutesAgo, type, severity, recipientIndex, variantId, includeVariant = true) => {
      const createdAt = new Date(now.getTime() - minutesAgo * 60_000).toISOString();
      insertEvent.run({
        type,
        severity,
        payload: JSON.stringify({
          smoke: "v2.10.7-smoke",
          campaignId: displayCampaignId,
          recipientId: recipients[recipientIndex],
          stepId: "ab-intro",
          stepType: "text",
          ...(includeVariant ? { variantId, variantLabel: variantId === "a" ? "Controle" : "Direta" } : {}),
          navigationMode: recipientIndex % 2 === 0 ? "navigated" : "reused-open-chat",
          jobId: 25_000 + minutesAgo,
          messageId: `m25-${variantId}-${recipientIndex}`,
          externalId: `ext-m25-${variantId}-${recipientIndex}`,
        }),
        createdAt,
      });
    };
    event(30, "sender.campaign_step.completed", "info", 0, "a");
    event(29, "sender.campaign_step.completed", "info", 1, "a", false);
    event(20, "sender.campaign_step.completed", "info", 3, "b");
    event(19, "sender.campaign_step.failed", "warn", 4, "b");

    return { displayCampaignId, canaryCampaignId };
  } finally {
    db.close();
  }
}

function assertVariant(variants, id, expected) {
  const variant = variants.find((item) => item.id === id);
  if (!variant) {
    throw new Error(`missing A/B variant ${id}: ${JSON.stringify(variants)}`);
  }
  const rateDiff = Math.abs(variant.rate - expected.rate);
  if (
    variant.assigned !== expected.assigned ||
    variant.completed !== expected.completed ||
    variant.failed !== expected.failed ||
    rateDiff > 0.001
  ) {
    throw new Error(
      `A/B variant mismatch for ${id}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(variant)}`,
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
