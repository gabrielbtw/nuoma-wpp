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
const screenshotPath = process.env.SCREENSHOT_PATH ?? "data/v29-delivery-status-m7.png";
const dbUrl = process.env.SMOKE_DB_URL ?? process.env.DATABASE_URL ?? "data/nuoma-v2.db";

const REQUIRED_STATUSES = ["pending", "sent", "delivered", "read"];
const EXPECTED_STAGES = {
  pending: "clock",
  sent: "single-check",
  delivered: "double-check",
  read: "blue-double-check",
};

async function main() {
  const conversationId = seedDeliveryStatusFixture(resolveDbPath(dbUrl));
  await assertHttp(`${webUrl}/`, "web");
  await assertHttp(`${apiUrl}/health`, "api");
  await fs.mkdir("data", { recursive: true });

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
    await page.getByTestId("inbox-message-timeline").waitFor({ state: "visible" });
    await page.locator('input[placeholder^="Buscar conversa"]').fill("V2.9.11");
    await page.getByTestId("inbox-conversation-row").waitFor({ state: "visible" });
    await page.locator(`[data-testid="inbox-conversation-row"][data-conv="${conversationId}"]`).click();

    const deliveryStatuses = page.getByTestId("message-delivery-status");
    await deliveryStatuses.first().waitFor({ state: "visible", timeout: 10_000 });

    const diagnostics = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid="message-delivery-status"]')).map(
        (node) => {
          const element = node instanceof HTMLElement ? node : null;
          const icon = element?.querySelector("svg");
          return {
            status: element?.getAttribute("data-delivery-status"),
            stage: element?.getAttribute("data-delivery-stage"),
            animated: element?.getAttribute("data-delivery-animated"),
            label: element?.getAttribute("aria-label"),
            color: icon ? getComputedStyle(icon).color : "",
            boxShadow: element ? getComputedStyle(element).boxShadow : "",
          };
        },
      ),
    );

    for (const status of REQUIRED_STATUSES) {
      const item = diagnostics.find((entry) => entry.status === status);
      if (!item) {
        throw new Error(`missing delivery status ${status}: ${JSON.stringify(diagnostics)}`);
      }
      if (item.stage !== EXPECTED_STAGES[status]) {
        throw new Error(`wrong stage for ${status}: ${JSON.stringify(item)}`);
      }
      if (item.animated !== "true") {
        throw new Error(`delivery status ${status} is not marked animated`);
      }
      if (!item.label?.includes("Status de entrega")) {
        throw new Error(`delivery status ${status} missing accessible label`);
      }
    }

    const read = diagnostics.find((entry) => entry.status === "read");
    const delivered = diagnostics.find((entry) => entry.status === "delivered");
    if (!read || !delivered || read.color === delivered.color) {
      throw new Error(`read status is not visually distinct: ${JSON.stringify(diagnostics)}`);
    }

    await page.screenshot({ path: screenshotPath, fullPage: true });
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const blocking = result.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious",
    );
    console.log(
      `v29-delivery-status|conversation=${conversationId}|statuses=${diagnostics
        .map((entry) => `${entry.status}:${entry.stage}`)
        .join(",")}|violations=${result.violations.length}|blocking=${blocking.length}|${screenshotPath}`,
    );
    if (blocking.length > 0) {
      throw new Error(
        `delivery status has blocking a11y violations: ${blocking
          .map((violation) => `${violation.id}:${violation.impact}`)
          .join(", ")}`,
      );
    }
    await context.close();
  } finally {
    await browser.close();
  }
}

function seedDeliveryStatusFixture(dbPath) {
  const now = new Date();
  const timestamp = (offsetMinutes) =>
    new Date(now.getTime() + offsetMinutes * 60_000).toISOString();
  const conversationThread = "553100009911";
  const db = new Database(dbPath);
  db.pragma("busy_timeout = 5000");
  try {
    const lastMessageAt = timestamp(0);
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
        VALUES (1, 'whatsapp', @thread, 'V2.9.11 Delivery Smoke', @lastMessageAt, 'clock -> check -> double -> blue', 0, 0)
        ON CONFLICT(user_id, channel, external_thread_id) DO UPDATE SET
          title = excluded.title,
          last_message_at = excluded.last_message_at,
          last_preview = excluded.last_preview,
          unread_count = 0,
          is_archived = 0,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      `,
    ).run({ thread: conversationThread, lastMessageAt });

    const conversation = db
      .prepare(
        `SELECT id FROM conversations WHERE user_id = 1 AND channel = 'whatsapp' AND external_thread_id = ?`,
      )
      .get(conversationThread);
    if (!conversation?.id) {
      throw new Error("failed to create delivery status smoke conversation");
    }

    db.prepare(
      `DELETE FROM messages WHERE user_id = 1 AND conversation_id = ? AND external_id LIKE 'v29-11-%'`,
    ).run(conversation.id);

    const insert = db.prepare(
      `
        INSERT INTO messages (
          user_id,
          conversation_id,
          external_id,
          direction,
          content_type,
          status,
          body,
          wa_displayed_at,
          timestamp_precision,
          wa_inferred_second,
          observed_at_utc,
          raw_json
        )
        VALUES (
          1,
          @conversationId,
          @externalId,
          'outbound',
          'text',
          @status,
          @body,
          @observedAtUtc,
          'second',
          @second,
          @observedAtUtc,
          @raw
        )
      `,
    );

    const rows = [
      ["pending", "Clock: aguardando", -3],
      ["sent", "Check: enviada", -2],
      ["delivered", "Double check: entregue", -1],
      ["read", "Blue double check: lida", 0],
    ];
    for (const [status, body, offset] of rows) {
      const observedAtUtc = timestamp(offset);
      insert.run({
        conversationId: conversation.id,
        externalId: `v29-11-${status}`,
        status,
        body,
        observedAtUtc,
        second: new Date(observedAtUtc).getSeconds(),
        raw: JSON.stringify({ smoke: "v2.9.11", status }),
      });
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
