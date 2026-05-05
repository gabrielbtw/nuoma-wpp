import AxeBuilder from "@axe-core/playwright";
import Database from "better-sqlite3";
import { chromium } from "playwright";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const webUrl = process.env.WEB_URL ?? "http://127.0.0.1:3002";
const apiUrl = process.env.API_URL ?? "http://127.0.0.1:3001";
const email = process.env.SMOKE_EMAIL ?? "admin@nuoma.local";
const password = process.env.SMOKE_PASSWORD ?? "nuoma-dev-admin-123";
const screenshotPath = process.env.SCREENSHOT_PATH ?? "data/v29-emoji-picker-m10.png";
const databaseUrl = path.resolve(process.env.DATABASE_URL ?? "data/nuoma-v2.db");
const smokePhone = "5531999992914";
const smokeTitle = "V2.9.14 Emoji Smoke";

async function main() {
  await assertHttp(`${webUrl}/`, "web");
  await assertHttp(`${apiUrl}/health`, "api");
  await fs.mkdir("data", { recursive: true });
  seedEmojiConversation();

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    await page.goto(`${webUrl}/login`, { waitUntil: "networkidle" });
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.click('button[type="submit"]');
    await page.waitForURL(`${webUrl}/`);

    await page.goto(`${webUrl}/inbox`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("inbox-conversation-list").waitFor({ state: "visible" });
    await page.getByPlaceholder("Buscar conversa…").fill(smokeTitle);
    const smokeRow = page.getByTestId("inbox-conversation-row").filter({ hasText: smokeTitle });
    await smokeRow.waitFor({ state: "visible", timeout: 10_000 });
    await smokeRow.click();

    const textarea = page.getByTestId("composer-textarea");
    await textarea.waitFor({ state: "visible" });
    await textarea.fill("Teste emoji ");
    await page.getByTestId("composer-emoji-button").click();
    const picker = page.getByTestId("composer-emoji-picker");
    await picker.waitFor({ state: "visible" });
    await page.getByTestId("composer-emoji-search").fill("fogo");
    await page.getByTestId("composer-emoji-option").filter({ hasText: "🔥" }).click();

    const value = await textarea.inputValue();
    if (value !== "Teste emoji 🔥") {
      throw new Error(`emoji was not inserted at the composer cursor: ${JSON.stringify(value)}`);
    }
    await picker.waitFor({ state: "visible" });

    await page.screenshot({ path: screenshotPath, fullPage: true });
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    const blocking = result.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious",
    );
    console.log(
      `v29-emoji-picker|value=${value}|violations=${result.violations.length}|blocking=${blocking.length}|${screenshotPath}`,
    );
    if (blocking.length > 0) {
      throw new Error(
        `emoji picker has blocking a11y violations: ${blocking
          .map((violation) => `${violation.id}:${violation.impact}`)
          .join(", ")}`,
      );
    }
    await context.close();
  } finally {
    await browser.close();
  }
}

function seedEmojiConversation() {
  const db = new Database(databaseUrl);
  try {
    db.pragma("foreign_keys = ON");
    const now = new Date().toISOString();
    db.prepare(
      `
        INSERT INTO conversations (
          user_id, contact_id, channel, external_thread_id, title, last_message_at,
          last_preview, unread_count, is_archived, temporary_messages_until,
          created_at, updated_at
        )
        VALUES (
          1, NULL, 'whatsapp', @phone, @title, @now,
          'Emoji picker smoke ready', 0, 0, NULL, @now, @now
        )
        ON CONFLICT(user_id, channel, external_thread_id) DO UPDATE SET
          title = excluded.title,
          last_message_at = excluded.last_message_at,
          last_preview = excluded.last_preview,
          is_archived = 0,
          updated_at = excluded.updated_at
      `,
    ).run({ phone: smokePhone, title: smokeTitle, now });

    const conversation = db
      .prepare("SELECT id FROM conversations WHERE user_id = 1 AND external_thread_id = ?")
      .get(smokePhone);
    if (!conversation?.id) {
      throw new Error("emoji picker smoke conversation was not created");
    }

    db.prepare(
      `
        INSERT INTO messages (
          user_id, conversation_id, contact_id, external_id, direction, content_type, status,
          body, media_asset_id, media_json, quoted_message_id, wa_displayed_at,
          timestamp_precision, message_second, wa_inferred_second, observed_at_utc,
          edited_at, deleted_at, raw_json, created_at, updated_at
        )
        VALUES (
          1, @conversationId, NULL, @externalId, 'inbound', 'text', 'received',
          'Abra o picker e insira um emoji.', NULL, NULL, NULL, @now,
          'second', 0, 0, @now, NULL, NULL, @raw, @now, @now
        )
        ON CONFLICT(conversation_id, external_id) DO UPDATE SET
          body = excluded.body,
          observed_at_utc = excluded.observed_at_utc,
          updated_at = excluded.updated_at
      `,
    ).run({
      conversationId: conversation.id,
      externalId: "v29-emoji-picker-smoke",
      raw: JSON.stringify({ source: "v29-emoji-picker-smoke" }),
      now,
    });
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
