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
  process.env.APP_SCREENSHOT_PATH ?? "data/v210-chatbot-ab-rules-m28-app.png";
const wppScreenshotPath =
  process.env.WPP_SCREENSHOT_PATH ?? "data/v210-chatbot-ab-rules-m28-wpp.png";
const databaseUrl = path.resolve(process.env.DATABASE_URL ?? "data/nuoma-v2.db");
const cdpUrl = process.env.CDP_URL ?? "http://127.0.0.1:9223";
const whatsappUrl = process.env.WA_WEB_URL ?? "https://web.whatsapp.com/";
const chromiumProfileDir = path.resolve(
  process.env.CHROMIUM_PROFILE_DIR ?? "data/chromium-profile/whatsapp",
);
const wppScreenshotProfileDir = path.resolve(
  process.env.WPP_SCREENSHOT_PROFILE_DIR ?? "data/tmp/wpp-profile-screenshot-v21035",
);
const canaryPhone = "5531982066263";

async function main() {
  await assertHttp(`${webUrl}/`, "web");
  await assertHttp(`${apiUrl}/health`, "api");
  await fs.mkdir(path.dirname(appScreenshotPath), { recursive: true });
  await fs.mkdir(path.dirname(wppScreenshotPath), { recursive: true });

  const fixture = seedChatbotAbFixture();
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
    await page.getByText("V2.10.35 Smoke A/B").waitFor({ state: "visible", timeout: 10_000 });
    const abPanel = page.locator(
      `[data-testid="chatbot-ab-test-panel"][data-rule-id="${fixture.ruleId}"]`,
    );
    await abPanel.waitFor({ state: "visible", timeout: 10_000 });
    const variantsCount = Number(await abPanel.getAttribute("data-variants"));
    if (variantsCount !== 2) {
      throw new Error(`expected 2 A/B variants, got ${variantsCount}`);
    }

    await page.getByTestId("chatbot-ab-dry-run-button").click();
    const result = page.locator('[data-testid="chatbot-ab-dry-run-result"]');
    await result.waitFor({ state: "visible", timeout: 10_000 });
    const selectedVariantId = await result.getAttribute("data-selected-variant-id");
    if (selectedVariantId !== "controle") {
      throw new Error(`expected deterministic variant controle, got ${selectedVariantId}`);
    }

    await page.screenshot({ path: appScreenshotPath, fullPage: false });
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const blocking = axe.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious",
    );
    if (blocking.length > 0) {
      throw new Error(
        `V2.10.35 chatbot A/B has blocking a11y violations: ${blocking
          .map((violation) => `${violation.id}:${violation.impact}`)
          .join(", ")}`,
      );
    }

    await context.close();

    const sendJobsAfter = countSendJobsForPhone(canaryPhone);
    if (sendJobsAfter !== sendJobsBefore) {
      throw new Error(
        `dry-run created send job(s): before=${sendJobsBefore} after=${sendJobsAfter}`,
      );
    }

    const wppMode = await captureWhatsAppPrint(wppScreenshotPath);
    console.log(
      `v210-chatbot-ab-rules|chatbot=${fixture.chatbotId}|rule=${fixture.ruleId}|variants=${variantsCount}|selected=${selectedVariantId}|sendJobsDelta=${sendJobsAfter - sendJobsBefore}|blocking=${blocking.length}|app=${appScreenshotPath}|wpp=${wppScreenshotPath}|wppMode=${wppMode}|ig=nao_aplicavel|m=28`,
    );
  } finally {
    await browser.close();
  }
}

function seedChatbotAbFixture() {
  const db = new Database(databaseUrl);
  try {
    db.pragma("foreign_keys = ON");
    const nowIso = new Date().toISOString();
    const token = `M28-${Date.now()}`;

    const existingChatbots = db
      .prepare("SELECT id FROM chatbots WHERE user_id = 1 AND name LIKE 'V2.10.35 Smoke%'")
      .all();
    for (const chatbot of existingChatbots) {
      db.prepare("DELETE FROM chatbot_rules WHERE user_id = 1 AND chatbot_id = ?").run(chatbot.id);
    }
    db.prepare("DELETE FROM chatbots WHERE user_id = 1 AND name LIKE 'V2.10.35 Smoke%'").run();

    const chatbotInfo = db
      .prepare(
        `
          INSERT INTO chatbots (
            user_id, name, channel, status, fallback_message, metadata_json, created_at, updated_at
          )
          VALUES (
            1, 'V2.10.35 Smoke A/B', 'whatsapp', 'active', 'Nao entendi',
            @metadata, @nowIso, @nowIso
          )
        `,
      )
      .run({
        metadata: JSON.stringify({ smoke: "v2.10.35-smoke", m: 28, token }),
        nowIso,
      });
    const chatbotId = Number(chatbotInfo.lastInsertRowid);

    const metadata = {
      smoke: "v2.10.35-smoke",
      m: 28,
      token,
      abTest: {
        enabled: true,
        assignment: "deterministic",
        variants: [
          {
            id: "controle",
            label: "Controle",
            weight: 100,
            actions: [{ type: "set_status", status: "ab_controle" }],
          },
          {
            id: "alternativa",
            label: "Alternativa",
            weight: 0,
            actions: [{ type: "set_status", status: "ab_alternativa" }],
          },
        ],
      },
    };
    const ruleInfo = db
      .prepare(
        `
          INSERT INTO chatbot_rules (
            user_id, chatbot_id, name, priority, match_json, segment_json, actions_json,
            metadata_json, is_active, created_at, updated_at
          )
          VALUES (
            1, @chatbotId, 'A/B preco', 1, @match, NULL, @actions,
            @metadata, 1, @nowIso, @nowIso
          )
        `,
      )
      .run({
        chatbotId,
        match: JSON.stringify({ type: "contains", value: "preco" }),
        actions: JSON.stringify([{ type: "set_status", status: "base" }]),
        metadata: JSON.stringify(metadata),
        nowIso,
      });
    return { chatbotId, ruleId: Number(ruleInfo.lastInsertRowid), token };
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
  await copyChromiumProfileForScreenshot();
  const context = await chromium.launchPersistentContext(wppScreenshotProfileDir, {
    headless: false,
    viewport: { width: 1366, height: 768 },
    args: [
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--disable-features=Translate,BackForwardCache",
      "--no-first-run",
      "--no-default-browser-check",
      "--no-sandbox",
    ],
  });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(whatsappUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(8_000);
    const bodyText = await page.locator("body").innerText({ timeout: 10_000 });
    if (bodyText.includes("WhatsApp works with Google Chrome 85+")) {
      throw new Error("WhatsApp Web screenshot fallback opened unsupported browser page");
    }
    await page.screenshot({ path: outputPath, fullPage: false, timeout: 20_000 });
    return "profile-copy";
  } catch (error) {
    throw new Error(
      `could not capture WhatsApp Web print via CDP or profile copy: ${String(
        cdpError,
      )}; fallback: ${String(error)}`,
    );
  } finally {
    await context.close();
    await fs.rm(wppScreenshotProfileDir, { recursive: true, force: true });
  }
}

async function copyChromiumProfileForScreenshot() {
  await fs.rm(wppScreenshotProfileDir, { recursive: true, force: true });
  await fs.cp(chromiumProfileDir, wppScreenshotProfileDir, {
    recursive: true,
    force: true,
    filter: (sourcePath) => {
      const basename = path.basename(sourcePath);
      return !basename.startsWith("Singleton") && basename !== "DevToolsActivePort";
    },
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
