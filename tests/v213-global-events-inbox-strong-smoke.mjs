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
  process.env.APP_SCREENSHOT_PATH ?? "data/v213-global-events-inbox-strong-app.png";
const wppScreenshotPath =
  process.env.WPP_SCREENSHOT_PATH ?? "data/v213-global-events-inbox-strong-wpp.png";
const cdpUrl = process.env.CDP_URL ?? "http://127.0.0.1:9223";
const whatsappUrl = process.env.WA_WEB_URL ?? "https://web.whatsapp.com/";
const smokePhone = "5531999992130";
const smokeTitle = "V2.13 Global Events Strong";

async function main() {
  await assertHttp(`${webUrl}/`, "web");
  await assertHttp(`${apiUrl}/health`, "api");
  await fs.mkdir(path.dirname(appScreenshotPath), { recursive: true });
  await fs.mkdir(path.dirname(wppScreenshotPath), { recursive: true });

  const fixture = seedInboxFixture("preview inicial V2.13");
  const sendJobsBefore = countSendJobsForPhone(smokePhone);
  const seenEventUrls = [];

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    page.on("request", (request) => {
      const url = request.url();
      if (url.includes("/api/events")) {
        seenEventUrls.push(url);
      }
    });

    await page.goto(`${webUrl}/login`, { waitUntil: "networkidle" });
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.click('button[type="submit"]');
    await page.waitForURL(`${webUrl}/`);

    await page.goto(`${webUrl}/inbox`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("inbox-realtime-header").waitFor({ state: "visible", timeout: 10_000 });
    await page.getByText("Tempo real ativo").waitFor({ state: "visible", timeout: 10_000 });
    await page.getByPlaceholder("Buscar conversa…").fill(smokeTitle);
    const row = page.getByTestId("inbox-conversation-row").filter({ hasText: smokeTitle });
    await row.waitFor({ state: "visible", timeout: 10_000 });
    await row.click();

    if (!seenEventUrls.some((url) => url.includes("/api/events?channels=inbox"))) {
      throw new Error(`Inbox did not open the global events stream: ${seenEventUrls.join(",")}`);
    }

    const eventPreview = `evento global V2.13 ${Date.now()}`;
    updateConversation(fixture.conversationId, eventPreview);

    await page.getByText("1 eventos").waitFor({ state: "visible", timeout: 7_000 });
    await page.getByText(eventPreview).waitFor({ state: "visible", timeout: 10_000 });
    await page.getByText(`conv #${fixture.conversationId}`).waitFor({
      state: "visible",
      timeout: 10_000,
    });

    await page.screenshot({ path: appScreenshotPath, fullPage: true });
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const blocking = axe.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious",
    );
    if (blocking.length > 0) {
      throw new Error(
        `V2.13 global events smoke has blocking a11y violations: ${blocking
          .map((violation) => `${violation.id}:${violation.impact}`)
          .join(", ")}`,
      );
    }
    await context.close();

    const sendJobsAfter = countSendJobsForPhone(smokePhone);
    if (sendJobsAfter !== sendJobsBefore) {
      throw new Error(
        `global events inbox smoke created send job(s): before=${sendJobsBefore} after=${sendJobsAfter}`,
      );
    }
    const wppMode = await captureWhatsAppPrint(wppScreenshotPath);

    console.log(
      [
        "v213-global-events-inbox-strong",
        `conversation=${fixture.conversationId}`,
        "stream=/api/events?channels=inbox",
        "messageEvents=1",
        `preview=${eventPreview}`,
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

function seedInboxFixture(preview) {
  const db = new Database(databaseUrl);
  try {
    db.pragma("foreign_keys = ON");
    const nowIso = new Date().toISOString();
    const contactId = upsertContact(db, nowIso);
    const conversationId = upsertConversation(db, contactId, preview, nowIso);
    return { contactId, conversationId };
  } finally {
    db.close();
  }
}

function upsertContact(db, nowIso) {
  const existing = db
    .prepare("SELECT id FROM contacts WHERE user_id = 1 AND phone = ? ORDER BY id DESC LIMIT 1")
    .get(smokePhone);
  if (existing?.id) {
    db.prepare(
      `
        UPDATE contacts
        SET name = @title,
            primary_channel = 'whatsapp',
            status = 'lead',
            notes = 'V2.13 global events strong smoke',
            last_message_at = @nowIso,
            deleted_at = NULL,
            updated_at = @nowIso
        WHERE id = @id
      `,
    ).run({ id: existing.id, title: smokeTitle, nowIso });
  } else {
    db.prepare(
      `
        INSERT INTO contacts (
          user_id, name, phone, email, primary_channel, instagram_handle, status, notes,
          last_message_at, profile_photo_media_asset_id, profile_photo_sha256,
          profile_photo_updated_at, deleted_at, created_at, updated_at
        )
        VALUES (
          1, @title, @phone, NULL, 'whatsapp', NULL, 'lead',
          'V2.13 global events strong smoke',
          @nowIso, NULL, NULL, NULL, NULL, @nowIso, @nowIso
        )
      `,
    ).run({ title: smokeTitle, phone: smokePhone, nowIso });
  }
  const contact = db
    .prepare("SELECT id FROM contacts WHERE user_id = 1 AND phone = ? ORDER BY id DESC LIMIT 1")
    .get(smokePhone);
  if (!contact?.id) throw new Error("V2.13 contact was not created");
  return Number(contact.id);
}

function upsertConversation(db, contactId, preview, nowIso) {
  db.prepare(
    `
      INSERT INTO conversations (
        user_id, contact_id, channel, external_thread_id, title, last_message_at,
        last_preview, unread_count, is_archived, temporary_messages_until,
        profile_photo_media_asset_id, profile_photo_sha256, profile_photo_updated_at,
        created_at, updated_at
      )
      VALUES (
        1, @contactId, 'whatsapp', @phone, @title, @nowIso,
        @preview, 0, 0, NULL,
        NULL, NULL, NULL, @nowIso, @nowIso
      )
      ON CONFLICT(user_id, channel, external_thread_id) DO UPDATE SET
        contact_id = excluded.contact_id,
        title = excluded.title,
        last_message_at = excluded.last_message_at,
        last_preview = excluded.last_preview,
        unread_count = 0,
        is_archived = 0,
        updated_at = excluded.updated_at
    `,
  ).run({ contactId, phone: smokePhone, title: smokeTitle, preview, nowIso });
  const conversation = db
    .prepare(
      "SELECT id FROM conversations WHERE user_id = 1 AND channel = 'whatsapp' AND external_thread_id = ?",
    )
    .get(smokePhone);
  if (!conversation?.id) throw new Error("V2.13 conversation was not created");
  return Number(conversation.id);
}

function updateConversation(conversationId, preview) {
  const db = new Database(databaseUrl);
  try {
    const nowIso = new Date().toISOString();
    db.prepare(
      `
        UPDATE conversations
        SET last_message_at = @nowIso,
            last_preview = @preview,
            unread_count = unread_count + 1,
            updated_at = @nowIso
        WHERE user_id = 1 AND id = @conversationId
      `,
    ).run({ conversationId, preview, nowIso });
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
