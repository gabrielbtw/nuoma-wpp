import AxeBuilder from "@axe-core/playwright";
import Database from "better-sqlite3";
import { chromium } from "playwright";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const webUrl = process.env.WEB_URL ?? "http://127.0.0.1:3002";
const apiUrl = process.env.API_URL ?? "http://127.0.0.1:3001";
const email = process.env.SMOKE_EMAIL ?? "admin@nuoma.local";
const password = process.env.SMOKE_PASSWORD ?? "nuoma-dev-admin-123";
const automationScreenshotPath =
  process.env.AUTOMATION_APP_SCREENSHOT_PATH ?? "data/v210-flow-builders-m31-automations-app.png";
const chatbotScreenshotPath =
  process.env.CHATBOT_APP_SCREENSHOT_PATH ?? "data/v210-flow-builders-m31-chatbots-app.png";
const wppScreenshotPath = process.env.WPP_SCREENSHOT_PATH ?? "data/v210-flow-builders-m31-wpp.png";
const databaseUrl = path.resolve(process.env.DATABASE_URL ?? "data/nuoma-v2.db");
const cdpUrl = process.env.CDP_URL ?? "http://127.0.0.1:9223";
const whatsappUrl = process.env.WA_WEB_URL ?? "https://web.whatsapp.com/";
const chromiumProfileDir = path.resolve(
  process.env.CHROMIUM_PROFILE_DIR ?? "data/chromium-profile/whatsapp",
);
const wppScreenshotProfileDir = path.resolve(
  process.env.WPP_SCREENSHOT_PROFILE_DIR ?? "data/tmp/wpp-profile-screenshot-v210-flow",
);
const canaryPhone = "5531982066263";

async function main() {
  await assertHttp(`${webUrl}/`, "web");
  await assertHttp(`${apiUrl}/health`, "api");
  await fs.mkdir(path.dirname(automationScreenshotPath), { recursive: true });
  await fs.mkdir(path.dirname(chatbotScreenshotPath), { recursive: true });
  await fs.mkdir(path.dirname(wppScreenshotPath), { recursive: true });

  const fixture = seedFlowBuilderFixture();
  const sendJobsBefore = countSendJobsForPhone(canaryPhone);
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 980 } });
    const page = await context.newPage();

    await page.goto(`${webUrl}/login`, { waitUntil: "networkidle" });
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.click('button[type="submit"]');
    await page.waitForURL(`${webUrl}/`);

    await page.goto(`${webUrl}/automations/new`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("automation-builder").waitFor({ state: "visible", timeout: 10_000 });
    await page.getByTestId("builder-topbar").waitFor({ state: "visible", timeout: 10_000 });
    await page.getByTestId("block-library").waitFor({ state: "visible", timeout: 10_000 });
    await page.getByTestId("builder-inspector").waitFor({ state: "visible", timeout: 10_000 });
    await page.getByTestId("flow-canvas").waitFor({ state: "visible", timeout: 10_000 });

    const automationLibraryBlocks = await page
      .locator('[data-testid^="library-block-"]')
      .count();
    if (automationLibraryBlocks < 15) {
      throw new Error(`expected complete automation block library, got ${automationLibraryBlocks}`);
    }

    await page.getByLabel("Nome do fluxo").fill("Escalar atendimento");
    await page.getByTestId("library-block-action:delay").click();
    await page.getByTestId("library-block-action:branch").click();
    await page.getByTestId("library-block-action:notify_attendant").click();
    await page.waitForFunction(
      () =>
        document.querySelectorAll('[data-testid="flow-canvas"] .react-flow__node').length >= 5,
      undefined,
      { timeout: 10_000 },
    );
    const automationCanvasNodes = await page
      .locator('[data-testid="flow-canvas"] .react-flow__node')
      .count();
    const automationCanvasText = await page.getByTestId("flow-canvas").innerText();
    const normalizedAutomationCanvasText = automationCanvasText.toLowerCase();
    for (const expected of ["Mensagem de texto", "Aguardar", "Condição / Branch", "Notificar atendente"]) {
      if (!normalizedAutomationCanvasText.includes(expected.toLowerCase())) {
        throw new Error(`automation canvas missing ${expected}: ${automationCanvasText}`);
      }
    }

    await page.getByTestId("builder-open-preview").click();
    await page.getByTestId("preview-panel").waitFor({ state: "visible", timeout: 10_000 });
    await page.getByTestId("chat-simulator").waitFor({ state: "visible", timeout: 10_000 });
    const automationPreviewEvents = await page.getByTestId("chat-simulator-event").count();
    if (automationPreviewEvents < 4) {
      throw new Error(`automation preview rendered too few events: ${automationPreviewEvents}`);
    }

    await page.getByTestId("builder-save").click();
    await page.getByText("Automacao criada").or(page.getByText("Automação criada")).waitFor({
      state: "visible",
      timeout: 10_000,
    });
    const createdAutomation = latestAutomationByName("Escalar atendimento");
    if (!createdAutomation) {
      throw new Error("automation draft was not persisted");
    }
    const automationMetadata = JSON.parse(createdAutomation.metadata_json);
    const automationActions = JSON.parse(createdAutomation.actions_json);
    if (automationMetadata.source !== "flow_builder_v2") {
      throw new Error(`automation metadata source mismatch: ${createdAutomation.metadata_json}`);
    }
    if (
      !automationActions.every((action) => typeof action.id === "string" && action.id.length > 0)
    ) {
      throw new Error("persisted automation actions must carry ids for branch targeting");
    }
    for (const expected of ["send_step", "delay", "branch", "notify_attendant"]) {
      if (!automationActions.some((action) => action.type === expected)) {
        throw new Error(`persisted automation missing ${expected}: ${createdAutomation.actions_json}`);
      }
    }

    await page.screenshot({ path: automationScreenshotPath, fullPage: true });
    const automationBlocking = await blockingAxeViolations(page);

    await page.goto(`${webUrl}/chatbots`, { waitUntil: "domcontentloaded" });
    await page.getByText("V2.10.26-34 Smoke", { exact: false }).waitFor({ state: "visible" });
    await page.getByTestId("chatbot-rule-builder").waitFor({ state: "visible" });
    await page.getByTestId("chatbot-dry-run-chatbot-select").click();
    await page.getByRole("option", { name: "V2.10.26-34 Smoke" }).click();
    await page.getByTestId("chatbot-dry-run-identity").fill(canaryPhone);
    await page.getByTestId("chatbot-dry-run-body").fill("Qual o preco?");
    await page
      .getByTestId("chatbot-rule-item")
      .first()
      .waitFor({ state: "visible", timeout: 10_000 });
    const priorityHandles = await page.getByTestId("chatbot-rule-priority-dnd").count();
    if (priorityHandles < 2) {
      throw new Error(`expected at least 2 priority drag handles, got ${priorityHandles}`);
    }
    const fallbackBadges = await page.getByText("fallback", { exact: true }).count();
    if (fallbackBadges < 1) {
      throw new Error("fallback rule badge was not rendered");
    }
    const abPanels = await page.getByTestId("chatbot-ab-test-panel").count();
    if (abPanels < 1) {
      throw new Error("response variants panel was not rendered");
    }
    await page.getByTestId("chatbot-ab-dry-run-button").click();
    const dryRunResult = page.locator('[data-testid="chatbot-ab-dry-run-result"]');
    await dryRunResult.waitFor({ state: "visible", timeout: 10_000 });
    const dryRunText = await dryRunResult.innerText();
    if (!dryRunText.includes("4 ação")) {
      throw new Error(`chatbot dry-run should expose 4 planned actions, got: ${dryRunText}`);
    }
    const regexState = await page
      .getByTestId("chatbot-regex-tester")
      .getAttribute("data-regex-state");
    if (!regexState) {
      throw new Error("chatbot regex tester did not expose state");
    }
    await page.screenshot({ path: chatbotScreenshotPath, fullPage: true });
    const chatbotBlocking = await blockingAxeViolations(page);

    await context.close();

    const sendJobsAfter = countSendJobsForPhone(canaryPhone);
    if (sendJobsAfter !== sendJobsBefore) {
      throw new Error(
        `flow builder smoke created send jobs: before=${sendJobsBefore} after=${sendJobsAfter}`,
      );
    }

    const wppMode = await captureWhatsAppPrint(wppScreenshotPath);
    console.log(
      [
        "v210-flow-builders",
        `automationLibraryBlocks=${automationLibraryBlocks}`,
        `automationCanvasNodes=${automationCanvasNodes}`,
        `automationPreviewEvents=${automationPreviewEvents}`,
        `automationCreated=${createdAutomation.id}`,
        `chatbot=${fixture.chatbotId}`,
        `priorityHandles=${priorityHandles}`,
        `fallbackBadges=${fallbackBadges}`,
        `abPanels=${abPanels}`,
        `regexState=${regexState}`,
        `sendJobsDelta=${sendJobsAfter - sendJobsBefore}`,
        `blocking=${automationBlocking.length + chatbotBlocking.length}`,
        `automationApp=${automationScreenshotPath}`,
        `chatbotApp=${chatbotScreenshotPath}`,
        `wpp=${wppScreenshotPath}`,
        `wppMode=${wppMode}`,
        "ig=nao_aplicavel",
        "m=31",
      ].join("|"),
    );
  } finally {
    await browser.close();
  }
}

function seedFlowBuilderFixture() {
  const db = new Database(databaseUrl);
  try {
    db.pragma("foreign_keys = ON");
    const nowIso = new Date().toISOString();
    const token = `M31-${Date.now()}`;
    const existingChatbots = db
      .prepare("SELECT id FROM chatbots WHERE user_id = 1 AND name LIKE 'V2.10.26-34 Smoke%'")
      .all();
    for (const chatbot of existingChatbots) {
      db.prepare("DELETE FROM chatbot_rules WHERE user_id = 1 AND chatbot_id = ?").run(chatbot.id);
    }
    db.prepare("DELETE FROM chatbots WHERE user_id = 1 AND name LIKE 'V2.10.26-34 Smoke%'").run();
    db.prepare("DELETE FROM automations WHERE user_id = 1 AND name = 'Escalar atendimento'").run();
    db.prepare(
      "DELETE FROM automations WHERE user_id = 1 AND name LIKE 'V2.10.33 Smoke Child%'",
    ).run();

    const childInfo = db
      .prepare(
        `
          INSERT INTO automations (
            user_id, name, category, status, trigger_json, condition_json, actions_json,
            metadata_json, created_at, updated_at
          )
          VALUES (
            1, 'V2.10.33 Smoke Child', 'Smoke', 'active', @trigger, @condition, @actions,
            @metadata, @nowIso, @nowIso
          )
        `,
      )
      .run({
        trigger: JSON.stringify({ type: "message_received", channel: "whatsapp" }),
        condition: JSON.stringify({ segment: null, requireWithin24hWindow: false }),
        actions: JSON.stringify([{ id: "child-status", type: "set_status", status: "active" }]),
        metadata: JSON.stringify({ smoke: "v2.10.16-34", token, role: "child" }),
        nowIso,
      });
    const childAutomationId = Number(childInfo.lastInsertRowid);

    const chatbotInfo = db
      .prepare(
        `
          INSERT INTO chatbots (
            user_id, name, channel, status, fallback_message, metadata_json, created_at, updated_at
          )
          VALUES (
            1, 'V2.10.26-34 Smoke', 'whatsapp', 'active', 'Fallback seguro',
            @metadata, @nowIso, @nowIso
          )
        `,
      )
      .run({
        metadata: JSON.stringify({ smoke: "v2.10.26-34", token }),
        nowIso,
      });
    const chatbotId = Number(chatbotInfo.lastInsertRowid);
    const insertRule = db.prepare(
      `
        INSERT INTO chatbot_rules (
          user_id, chatbot_id, name, priority, match_json, segment_json, actions_json,
          metadata_json, is_active, created_at, updated_at
        )
        VALUES (
          1, @chatbotId, @name, @priority, @match, NULL, @actions,
          @metadata, 1, @nowIso, @nowIso
        )
      `,
    );
    const actions = [
      { id: "tag-match", type: "apply_tag", tagId: 1 },
      { id: "status-match", type: "set_status", status: "active" },
      {
        id: "notify-match",
        type: "notify_attendant",
        attendantId: null,
        message: "Chatbot pediu atendimento.",
      },
      { id: "trigger-match", type: "trigger_automation", automationId: childAutomationId },
    ];
    const ruleInfo = insertRule.run({
      chatbotId,
      name: "Regex preco",
      priority: 1,
      match: JSON.stringify({ type: "regex", value: "preco" }),
      actions: JSON.stringify(actions),
      metadata: JSON.stringify({
        smoke: "v2.10.26-34",
        token,
        abTest: {
          enabled: true,
          assignment: "deterministic",
          variants: [
            { id: "controle", label: "Controle", weight: 100, actions },
            { id: "alternativa", label: "Alternativa", weight: 0, actions: [actions[1]] },
          ],
        },
      }),
      nowIso,
    });
    insertRule.run({
      chatbotId,
      name: "Fallback seguro",
      priority: 999,
      match: JSON.stringify({ type: "fallback", value: null }),
      actions: JSON.stringify([
        {
          id: "fallback-reply",
          type: "send_step",
          step: {
            id: "fallback-text",
            label: "Fallback",
            type: "text",
            template: "Vou chamar atendimento.",
            delaySeconds: 0,
            conditions: [],
          },
        },
      ]),
      metadata: JSON.stringify({ smoke: "v2.10.26-34", token, fallback: true }),
      nowIso,
    });

    return { chatbotId, ruleId: Number(ruleInfo.lastInsertRowid), childAutomationId, token };
  } finally {
    db.close();
  }
}

function latestAutomationByName(name) {
  const db = new Database(databaseUrl, { readonly: true });
  try {
    return db
      .prepare(
        `
          SELECT id, actions_json, metadata_json
          FROM automations
          WHERE user_id = 1 AND name = ?
          ORDER BY id DESC
          LIMIT 1
        `,
      )
      .get(name);
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
            AND type IN ('send_message', 'send_instagram_message', 'send_voice', 'send_document', 'campaign_step', 'chatbot_reply')
            AND payload_json LIKE ?
        `,
      )
      .get(`%${phone}%`);
    return Number(row?.total ?? 0);
  } finally {
    db.close();
  }
}

async function blockingAxeViolations(page) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  return result.violations.filter(
    (violation) => violation.impact === "critical" || violation.impact === "serious",
  );
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
  try {
    await fs.rm(wppScreenshotProfileDir, { recursive: true, force: true });
    await copyProfileForScreenshot(chromiumProfileDir, wppScreenshotProfileDir);
    const browser = await chromium.launchPersistentContext(wppScreenshotProfileDir, {
      headless: true,
      viewport: { width: 1366, height: 768 },
    });
    try {
      const page = browser.pages()[0] ?? (await browser.newPage());
      await page.goto(whatsappUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForTimeout(3_000);
      await page.screenshot({ path: outputPath, fullPage: false, timeout: 15_000 });
      return "profile-copy";
    } finally {
      await browser.close();
    }
  } catch (fallbackError) {
    throw new Error(
      `failed to capture WhatsApp screenshot: cdp=${String(cdpError)} fallback=${String(fallbackError)}`,
    );
  }
}

async function copyProfileForScreenshot(source, destination) {
  await fs.mkdir(destination, { recursive: true });
  const ignored = new Set(["SingletonLock", "SingletonSocket", "SingletonCookie"]);
  async function copyDir(src, dest) {
    const entries = await fs.readdir(src, { withFileTypes: true });
    await fs.mkdir(dest, { recursive: true });
    for (const entry of entries) {
      if (ignored.has(entry.name)) continue;
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        await copyDir(srcPath, destPath);
      } else if (entry.isFile()) {
        await fs.copyFile(srcPath, destPath).catch(() => undefined);
      }
    }
  }
  await copyDir(source, destination);
}

async function assertHttp(url, label) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${label} is not healthy: ${response.status} ${url}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
