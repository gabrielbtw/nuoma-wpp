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
    await page.getByTestId("campaigns-new").waitFor({ state: "visible", timeout: 10_000 });

    // Builder V2: rota dedicada, canvas + biblioteca + inspector
    await page.goto(`${webUrl}/campaigns/new`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("builder-topbar").waitFor({ state: "visible", timeout: 10_000 });
    await page.getByTestId("block-library").waitFor({ state: "visible", timeout: 10_000 });
    await page.getByTestId("builder-inspector").waitFor({ state: "visible", timeout: 10_000 });
    await page
      .getByTestId("flow-node-block")
      .first()
      .waitFor({ state: "visible", timeout: 10_000 });

    const validationBeforeInvalid = await readFlowChecklist(page);
    if (validationBeforeInvalid.failed !== 0) {
      throw new Error(
        `expected campaign builder validation to start valid: ${JSON.stringify(validationBeforeInvalid)}`,
      );
    }

    // Seleciona o bloco inicial e esvazia a mensagem -> erro inline no node
    await page.getByTestId("flow-node-block").first().click();
    const messageInput = page.getByTestId("step-message-input");
    await messageInput.waitFor({ state: "visible", timeout: 5_000 });
    const originalMessage = await messageInput.inputValue();
    await messageInput.fill("");
    await page
      .getByTestId("flow-node-errors")
      .first()
      .waitFor({ state: "visible", timeout: 5_000 });
    const messageFieldInvalid = await messageInput.getAttribute("aria-invalid");
    if (messageFieldInvalid !== "true") {
      throw new Error("campaign builder did not flag the empty message field as invalid");
    }

    // Restaura a mensagem -> erro some
    await messageInput.fill(originalMessage || "Olá {{nome}}, tudo bem?");
    await page.getByTestId("flow-node-errors").waitFor({ state: "detached", timeout: 5_000 });

    // Biblioteca: adiciona um segundo bloco de texto
    await page.getByTestId("library-block-step:text").click();
    await page.waitForTimeout(200);
    const builderBlocks = await page.getByTestId("flow-node-block").count();
    if (builderBlocks < 2) {
      throw new Error(`block library click did not add a node: blocks=${builderBlocks}`);
    }

    // Deseleciona (clique no pane) -> checklist do fluxo volta válido
    await page.locator(".react-flow__pane").click({ position: { x: 16, y: 16 } });
    const validationAfterRestore = await readFlowChecklist(page);
    if (validationAfterRestore.failed !== 0 || validationAfterRestore.total < 3) {
      throw new Error(
        `campaign builder validation did not recover after fixing step: ${JSON.stringify(validationAfterRestore)}`,
      );
    }

    // Prévia da conversa com o número canário padrão
    await page.getByTestId("builder-open-preview").click();
    await page.getByTestId("preview-panel").waitFor({ state: "visible", timeout: 5_000 });
    await page.getByTestId("chat-simulator").waitFor({ state: "visible", timeout: 5_000 });
    await page
      .getByTestId("chat-simulator")
      .getByText(canaryPhone)
      .waitFor({ state: "visible", timeout: 5_000 });
    const previewRows = await page.getByTestId("chat-simulator-event").count();

    await page.goto(`${webUrl}/campaigns?tab=recipients`, { waitUntil: "domcontentloaded" });
    await page
      .locator(
        `[data-testid="campaign-recipients-virtual-scroll"][data-campaign-id="${fixture.virtualCampaignId}"]`,
      )
      .waitFor({ state: "visible", timeout: 10_000 });

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
      throw new Error(
        `seeded virtual campaign table not found: ${JSON.stringify(virtualDiagnostics)}`,
      );
    }
    if (
      virtualTable.virtualized !== "true" ||
      virtualTable.total < 80 ||
      virtualTable.visible <= 0 ||
      virtualTable.rendered !== virtualTable.visible ||
      virtualTable.rendered >= virtualTable.total
    ) {
      throw new Error(
        `recipient virtual table diagnostics mismatch: ${JSON.stringify(virtualTable)}`,
      );
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
        element.querySelector('[data-testid="campaign-recipient-row"]')?.getBoundingClientRect()
          .top ?? 0,
      ),
    }));
    if (afterScroll.rendered !== afterScroll.visible || afterScroll.rendered <= 0) {
      throw new Error(`virtual table broke after scroll: ${JSON.stringify(afterScroll)}`);
    }

    await page.goto(
      `${webUrl}/campaigns?tab=dispatch&intent=enqueue&campaignId=${fixture.canaryCampaignId}`,
      { waitUntil: "domcontentloaded" },
    );
    await page.getByTestId("campaign-tab-dispatch").waitFor({ state: "visible", timeout: 10_000 });
    await page.getByText("Selecionada: V2.10 Smoke Scheduler Canary").waitFor({
      state: "visible",
      timeout: 10_000,
    });
    await page.getByRole("button", { name: "Simular selecionada" }).click();
    await page.getByText("Última execução").waitFor({ state: "visible", timeout: 10_000 });
    await page.waitForTimeout(500);
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
      [
        "v210-campaigns",
        `builderBlocks=${builderBlocks}`,
        `checklist=${validationAfterRestore.total - validationAfterRestore.failed}/${validationAfterRestore.total}`,
        `previewRows=${previewRows}`,
        `virtualTotal=${virtualTable.total}`,
        `virtualRendered=${virtualTable.rendered}`,
        `dryRunPhone=${canaryPhone}`,
        `campaignStepJobsDelta=${campaignStepJobsDelta}`,
        `blocking=${blocking.length}`,
        `app=${appScreenshotPath}`,
        `wpp=${wppScreenshotPath}`,
        `wppMode=${wppMode}`,
      ].join("|"),
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
      db.prepare("DELETE FROM campaign_recipients WHERE user_id = 1 AND campaign_id = ?").run(
        row.id,
      );
    }
    db.prepare("DELETE FROM campaigns WHERE user_id = 1 AND name LIKE 'V2.10 Smoke%'").run();
    db.prepare(
      "DELETE FROM system_events WHERE user_id = 1 AND payload_json LIKE '%v2.10-smoke%'",
    ).run();

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
    db.prepare(
      "UPDATE campaigns SET status = 'paused', updated_at = ? WHERE user_id = 1 AND id = ?",
    ).run(new Date().toISOString(), campaignId);
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

async function readFlowChecklist(page) {
  return page.getByTestId("campaign-flow-checklist").evaluate((element) => {
    const checks = Array.from(
      element.querySelectorAll('[data-testid="campaign-flow-validation-check"]'),
    );
    return {
      total: checks.length,
      failed: checks.filter((check) => check.getAttribute("data-ok") === "false").length,
      text: element.textContent ?? "",
    };
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
