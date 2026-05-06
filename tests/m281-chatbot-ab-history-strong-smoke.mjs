import AxeBuilder from "@axe-core/playwright";
import Database from "better-sqlite3";
import { chromium } from "playwright";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const webUrl = process.env.WEB_URL ?? "http://127.0.0.1:3002";
const apiUrl = process.env.API_URL ?? "http://127.0.0.1:3001";
const email = process.env.SMOKE_EMAIL ?? "admin@nuoma.local";
const password = process.env.SMOKE_PASSWORD ?? "nuoma-dev-admin-123";
const databaseUrl = path.resolve(process.env.DATABASE_URL ?? "data/nuoma-v2.db");
const appScreenshotPath =
  process.env.APP_SCREENSHOT_PATH ?? "data/m281-chatbot-ab-history-strong-app.png";
const wppScreenshotPath =
  process.env.WPP_SCREENSHOT_PATH ?? "data/m281-chatbot-ab-history-strong-wpp.png";
const cdpUrl = process.env.CDP_URL ?? "http://127.0.0.1:9223";
const whatsappUrl = process.env.WA_WEB_URL ?? "https://web.whatsapp.com/";
const canaryPhone = "5531982066263";

async function main() {
  await assertHttp(`${webUrl}/`, "web");
  await assertHttp(`${apiUrl}/health`, "api");
  await fs.mkdir(path.dirname(appScreenshotPath), { recursive: true });
  await fs.mkdir(path.dirname(wppScreenshotPath), { recursive: true });

  const fixture = seedChatbotHistoryFixture();
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

    await page.goto(`${webUrl}/chatbots`, { waitUntil: "domcontentloaded" });
    await page.getByText("M28.1 Strong A/B History").waitFor({ state: "visible", timeout: 10_000 });
    const panel = page.locator(
      `[data-testid="chatbot-ab-test-panel"][data-rule-id="${fixture.ruleId}"]`,
    );
    await panel.waitFor({ state: "visible", timeout: 10_000 });

    const control = panel.locator('[data-testid="chatbot-ab-variant-stats"][data-variant-id="controle"]');
    const alternative = panel.locator(
      '[data-testid="chatbot-ab-variant-stats"][data-variant-id="alternativa"]',
    );
    await expectVariantStats(control, { exposures: 2, conversions: 1 });
    await expectVariantStats(alternative, { exposures: 1, conversions: 0 });
    await page.getByText("2 exposição(ões) · 1 conversão(ões)").waitFor({
      state: "visible",
      timeout: 10_000,
    });
    await page.getByText("1 exposição(ões) · 0 conversão(ões)").waitFor({
      state: "visible",
      timeout: 10_000,
    });

    await page.screenshot({ path: appScreenshotPath, fullPage: false });
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const blocking = axe.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious",
    );
    if (blocking.length > 0) {
      throw new Error(
        `M28.1 chatbot history smoke has blocking a11y violations: ${blocking
          .map((violation) => `${violation.id}:${violation.impact}`)
          .join(", ")}`,
      );
    }
    await context.close();

    const sendJobsAfter = countSendJobsForPhone(canaryPhone);
    if (sendJobsAfter !== sendJobsBefore) {
      throw new Error(
        `chatbot history smoke created send job(s): before=${sendJobsBefore} after=${sendJobsAfter}`,
      );
    }
    const wppMode = await captureWhatsAppPrint(wppScreenshotPath);
    console.log(
      [
        "m281-chatbot-ab-history-strong",
        `chatbot=${fixture.chatbotId}`,
        `rule=${fixture.ruleId}`,
        "controle=2/1",
        "alternativa=1/0",
        `sendJobsDelta=${sendJobsAfter - sendJobsBefore}`,
        `blocking=${blocking.length}`,
        `app=${appScreenshotPath}`,
        `wpp=${wppScreenshotPath}`,
        `wppMode=${wppMode}`,
        "ig=nao_aplicavel",
        "status=passed",
      ].join("|"),
    );
  } finally {
    await browser.close();
  }
}

async function expectVariantStats(locator, expected) {
  await locator.waitFor({ state: "visible", timeout: 10_000 });
  const exposures = Number(await locator.getAttribute("data-exposures"));
  const conversions = Number(await locator.getAttribute("data-conversions"));
  if (exposures !== expected.exposures || conversions !== expected.conversions) {
    throw new Error(
      `variant stats mismatch: expected ${expected.exposures}/${expected.conversions}, got ${exposures}/${conversions}`,
    );
  }
}

async function captureWhatsAppPrint(outputPath) {
  const browser = await chromium.connectOverCDP(cdpUrl);
  try {
    const context = browser.contexts()[0] ?? (await browser.newContext());
    let page = context.pages().find((candidate) => candidate.url().startsWith(whatsappUrl));
    page ??= context.pages()[0] ?? (await context.newPage());
    if (!page.url().startsWith(whatsappUrl)) {
      await page.goto(whatsappUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.waitForTimeout(1_500);
    await page.screenshot({ path: outputPath, fullPage: false, timeout: 15_000 });
    return "cdp";
  } finally {
    await browser.close();
  }
}

function seedChatbotHistoryFixture() {
  const db = new Database(databaseUrl);
  try {
    db.pragma("foreign_keys = ON");
    const nowIso = new Date().toISOString();
    const token = `M281-${Date.now()}`;

    const oldChatbots = db
      .prepare("SELECT id FROM chatbots WHERE user_id = 1 AND name = 'M28.1 Strong A/B History'")
      .all();
    for (const chatbot of oldChatbots) {
      db.prepare("DELETE FROM chatbot_variant_events WHERE user_id = 1 AND chatbot_id = ?").run(
        chatbot.id,
      );
      db.prepare("DELETE FROM chatbot_rules WHERE user_id = 1 AND chatbot_id = ?").run(chatbot.id);
    }
    db.prepare("DELETE FROM chatbots WHERE user_id = 1 AND name = 'M28.1 Strong A/B History'").run();

    const chatbotId = Number(
      db
        .prepare(
          `
            INSERT INTO chatbots (
              user_id, name, channel, status, fallback_message, metadata_json, created_at, updated_at
            )
            VALUES (
              1, 'M28.1 Strong A/B History', 'whatsapp', 'active', 'Fallback forte',
              @metadata, @nowIso, @nowIso
            )
          `,
        )
        .run({
          metadata: JSON.stringify({ smoke: "m281-chatbot-ab-history", token }),
          nowIso,
        }).lastInsertRowid,
    );

    const metadata = {
      smoke: "m281-chatbot-ab-history",
      token,
      abTest: {
        enabled: true,
        assignment: "deterministic",
        variants: [
          {
            id: "controle",
            label: "Controle",
            weight: 50,
            actions: [{ type: "set_status", status: "m281_controle" }],
          },
          {
            id: "alternativa",
            label: "Alternativa",
            weight: 50,
            actions: [{ type: "set_status", status: "m281_alternativa" }],
          },
        ],
      },
    };

    const ruleId = Number(
      db
        .prepare(
          `
            INSERT INTO chatbot_rules (
              user_id, chatbot_id, name, priority, match_json, segment_json, actions_json,
              metadata_json, is_active, created_at, updated_at
            )
            VALUES (
              1, @chatbotId, 'Historico forte por mensagem', 1, @match, NULL, @actions,
              @metadata, 1, @nowIso, @nowIso
            )
          `,
        )
        .run({
          chatbotId,
          match: JSON.stringify({ type: "contains", value: "historico" }),
          actions: JSON.stringify([{ type: "set_status", status: "m281_base" }]),
          metadata: JSON.stringify(metadata),
          nowIso,
        }).lastInsertRowid,
    );

    const insertEvent = db.prepare(
      `
        INSERT INTO chatbot_variant_events (
          user_id, chatbot_id, rule_id, variant_id, variant_label, event_type, channel,
          contact_id, conversation_id, message_id, exposure_id, source_event_id,
          metadata_json, created_at, updated_at
        )
        VALUES (
          1, @chatbotId, @ruleId, @variantId, @variantLabel, @eventType, 'whatsapp',
          NULL, NULL, NULL, @exposureId, @sourceEventId, @metadata, @nowIso, @nowIso
        )
      `,
    );
    [
      ["controle", "Controle", "exposure", null, `${token}:controle:exp:1`],
      ["controle", "Controle", "exposure", null, `${token}:controle:exp:2`],
      ["controle", "Controle", "conversion", 1, `${token}:controle:conv:1`],
      ["alternativa", "Alternativa", "exposure", null, `${token}:alternativa:exp:1`],
    ].forEach(([variantId, variantLabel, eventType, exposureId, sourceEventId]) => {
      insertEvent.run({
        chatbotId,
        ruleId,
        variantId,
        variantLabel,
        eventType,
        exposureId,
        sourceEventId,
        metadata: JSON.stringify({ smoke: "m281-chatbot-ab-history", token }),
        nowIso,
      });
    });

    return { chatbotId, ruleId, token };
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
            AND type IN ('send_message', 'send_instagram_message', 'send_voice', 'send_document', 'campaign_step')
            AND payload_json LIKE ?
        `,
      )
      .get(`%${phone}%`);
    return Number(row?.total ?? 0);
  } finally {
    db.close();
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
