import AxeBuilder from "@axe-core/playwright";
import Database from "better-sqlite3";
import { chromium } from "playwright";
import * as fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webUrl = process.env.WEB_URL ?? "http://127.0.0.1:3002";
const apiUrl = process.env.API_URL ?? "http://127.0.0.1:3001";
const email = process.env.SMOKE_EMAIL ?? "admin@nuoma.local";
const password = process.env.SMOKE_PASSWORD ?? "nuoma-dev-admin-123";
const screenshotPath = process.env.SCREENSHOT_PATH ?? "data/v29-voice-recorder-m8.png";
const dbUrl = process.env.SMOKE_DB_URL ?? process.env.DATABASE_URL ?? "data/nuoma-v2.db";

async function main() {
  const conversationId = seedVoiceRecorderFixture(resolveDbPath(dbUrl));
  await assertHttp(`${webUrl}/`, "web");
  await assertHttp(`${apiUrl}/health`, "api");
  await fs.mkdir("data", { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.grantPermissions(["microphone"], { origin: webUrl });
    const page = await context.newPage();

    await page.goto(`${webUrl}/login`, { waitUntil: "networkidle" });
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.click('button[type="submit"]');
    await page.waitForURL(`${webUrl}/`);

    await page.goto(`${webUrl}/inbox`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("inbox-message-timeline").waitFor({ state: "visible" });
    await page.locator('input[placeholder^="Buscar conversa"]').fill("V2.9.13");
    await page.locator(`[data-testid="inbox-conversation-row"][data-conv="${conversationId}"]`).click();

    const recordButton = page.getByTestId("composer-voice-record-button");
    await recordButton.click();
    await page
      .locator('[data-testid="composer-voice-preview"][data-recording-state="recording"]')
      .waitFor({ state: "visible", timeout: 10_000 });
    await page.waitForTimeout(1_250);
    await recordButton.click();

    const preview = page.locator('[data-testid="composer-voice-preview"][data-recording-state="recorded"]');
    await preview.waitFor({ state: "visible", timeout: 10_000 });
    await page.getByTestId("composer-voice-audio").waitFor({ state: "visible", timeout: 10_000 });
    const sendButton = page.getByTestId("composer-voice-send-button");
    if (!(await sendButton.isEnabled())) {
      throw new Error("voice send button should be enabled after recording preview");
    }

    const diagnostics = await page.evaluate(() => {
      const previewNode = document.querySelector('[data-testid="composer-voice-preview"]');
      const audio = document.querySelector('[data-testid="composer-voice-audio"]');
      const send = document.querySelector('[data-testid="composer-voice-send-button"]');
      return {
        state: previewNode?.getAttribute("data-recording-state"),
        hasAudio: audio instanceof HTMLAudioElement,
        audioSrc: audio instanceof HTMLAudioElement ? audio.currentSrc || audio.src : "",
        sendText: send?.textContent?.trim() ?? "",
      };
    });
    if (diagnostics.state !== "recorded" || !diagnostics.hasAudio || !diagnostics.audioSrc.startsWith("blob:")) {
      throw new Error(`voice recorder preview not ready: ${JSON.stringify(diagnostics)}`);
    }
    if (!diagnostics.sendText.includes("Enviar áudio")) {
      throw new Error(`voice send action missing: ${JSON.stringify(diagnostics)}`);
    }

    await page.screenshot({ path: screenshotPath, fullPage: true });
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const blocking = result.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious",
    );
    console.log(
      `v29-voice-recorder|conversation=${conversationId}|state=${diagnostics.state}|audio=${diagnostics.hasAudio}|violations=${result.violations.length}|blocking=${blocking.length}|${screenshotPath}`,
    );
    if (blocking.length > 0) {
      throw new Error(
        `voice recorder has blocking a11y violations: ${blocking
          .map((violation) => `${violation.id}:${violation.impact}`)
          .join(", ")}`,
      );
    }
    await context.close();
  } finally {
    await browser.close();
  }
}

function seedVoiceRecorderFixture(dbPath) {
  const db = new Database(dbPath);
  db.pragma("busy_timeout = 5000");
  try {
    const lastMessageAt = new Date().toISOString();
    db.prepare(
      `
        INSERT INTO conversations (
          user_id,
          channel,
          external_thread_id,
          title,
          last_message_at,
          last_preview,
          unread_count,
          is_archived
        )
        VALUES (1, 'whatsapp', '553100009913', 'V2.9.13 Voice Smoke', @lastMessageAt, 'voice recorder preview', 0, 0)
        ON CONFLICT(user_id, channel, external_thread_id) DO UPDATE SET
          title = excluded.title,
          last_message_at = excluded.last_message_at,
          last_preview = excluded.last_preview,
          unread_count = 0,
          is_archived = 0,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      `,
    ).run({ lastMessageAt });
    const conversation = db
      .prepare(
        `SELECT id FROM conversations WHERE user_id = 1 AND channel = 'whatsapp' AND external_thread_id = '553100009913'`,
      )
      .get();
    if (!conversation?.id) {
      throw new Error("failed to create voice recorder smoke conversation");
    }
    return Number(conversation.id);
  } finally {
    db.close();
  }
}

function resolveDbPath(value) {
  if (value.startsWith("file:")) {
    return fileURLToPath(value);
  }
  if (path.isAbsolute(value)) {
    return value;
  }
  const fromCwd = path.resolve(process.cwd(), value);
  if (existsSync(fromCwd)) {
    return fromCwd;
  }
  return fromCwd;
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
