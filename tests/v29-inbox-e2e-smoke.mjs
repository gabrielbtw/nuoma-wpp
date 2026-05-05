import AxeBuilder from "@axe-core/playwright";
import Database from "better-sqlite3";
import { chromium } from "playwright";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const webUrl = process.env.WEB_URL ?? "http://127.0.0.1:3002";
const apiUrl = process.env.API_URL ?? "http://127.0.0.1:3001";
const email = process.env.SMOKE_EMAIL ?? "admin@nuoma.local";
const password = process.env.SMOKE_PASSWORD ?? "nuoma-dev-admin-123";
const appScreenshotPath = process.env.APP_SCREENSHOT_PATH ?? "data/v29-inbox-e2e-m21-app.png";
const wppScreenshotPath = process.env.WPP_SCREENSHOT_PATH ?? "data/v29-inbox-e2e-m21-wpp.png";
const databaseUrl = path.resolve(process.env.DATABASE_URL ?? "data/nuoma-v2.db");
const cdpUrl = process.env.CDP_URL ?? "http://127.0.0.1:9223";
const whatsappUrl = process.env.WA_WEB_URL ?? "https://web.whatsapp.com/";
const chromiumProfileDir = path.resolve(
  process.env.CHROMIUM_PROFILE_DIR ?? "data/chromium-profile/whatsapp",
);
const wppScreenshotProfileDir = path.resolve(
  process.env.WPP_SCREENSHOT_PROFILE_DIR ?? "data/tmp/wpp-profile-screenshot",
);
const smokePhone = "5531999999630";
const smokeTitle = "V2.9.30 Inbox E2E Smoke";
const smokeMarker = "V2.9.30 Inbox E2E";

async function main() {
  await assertHttp(`${webUrl}/`, "web");
  await assertHttp(`${apiUrl}/health`, "api");
  await fs.mkdir(path.dirname(appScreenshotPath), { recursive: true });
  await fs.mkdir(path.dirname(wppScreenshotPath), { recursive: true });

  const fixture = seedInboxE2EFixture();
  const sendJobsBefore = countSendJobsForPhone(smokePhone);
  const syncJobsBefore = countSyncJobs(fixture.conversationId);

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
    const row = page.getByTestId("inbox-conversation-row").filter({ hasText: smokeTitle });
    await row.waitFor({ state: "visible", timeout: 10_000 });
    await row.click();

    await page.getByTestId("inbox-message-timeline").waitFor({ state: "visible" });
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="inbox-message-bubble"]').length === 4,
    );
    await expectFilterCount(page, 4);

    await page.locator('[data-testid="timeline-filter-type"][data-filter-value="image"]').click();
    await expectFilterCount(page, 1);
    await assertVisibleBubbleTypes(page, ["image"]);

    await page.getByTestId("timeline-filter-clear").click();
    await page.locator('[data-testid="timeline-filter-media"]').click();
    await expectFilterCount(page, 2);
    await assertVisibleBubbleTypes(page, ["image", "video"]);

    await page.getByTestId("timeline-filter-clear").click();
    await page.locator('[data-testid="timeline-filter-date"][data-filter-value="yesterday"]').click();
    await expectFilterCount(page, 1);

    await page.getByTestId("timeline-filter-clear").click();
    await page.evaluate(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "f",
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await page.getByTestId("timeline-search-input").waitFor({ state: "visible", timeout: 10_000 });
    await page.getByTestId("timeline-search-input").fill("Alpha M21");
    await expectFilterCount(page, 1);
    await page.getByTestId("timeline-search-count").waitFor({ state: "visible" });

    await page.getByTestId("timeline-filter-clear").click();
    const firstTextBubble = page
      .locator('[data-testid="inbox-message-bubble"][data-content-type="text"]')
      .first();
    await firstTextBubble.click();
    await page.getByTestId("message-inspector").waitFor({ state: "visible", timeout: 10_000 });

    await page.keyboard.press("r");
    const draft = page.getByTestId("composer-action-draft");
    await draft.waitFor({ state: "visible", timeout: 10_000 });
    const replyKind = await draft.getAttribute("data-action-kind");
    if (replyKind !== "reply") {
      throw new Error(`r shortcut did not prepare reply draft: ${replyKind}`);
    }

    await firstTextBubble.click();
    await page.keyboard.press("e");
    const editKind = await draft.getAttribute("data-action-kind");
    if (editKind !== "edit") {
      throw new Error(`e shortcut did not prepare edit draft: ${editKind}`);
    }
    const textarea = page.getByTestId("composer-textarea");
    const originalText = await textarea.inputValue();
    if (!originalText.trim()) {
      throw new Error(`edit shortcut did not preload selected message text: ${originalText}`);
    }
    const editedText = `${originalText} | editado M21`;
    await textarea.fill(editedText);
    const originalBodiesBeforeEsc = readMessageBodies(fixture.conversationId);

    await firstTextBubble.click();
    await page.keyboard.press("Escape");
    await page.getByTestId("message-inspector").waitFor({ state: "hidden", timeout: 10_000 });
    await page.keyboard.press("Escape");
    await page.getByTestId("composer-action-draft").waitFor({ state: "hidden", timeout: 10_000 });
    await waitForComposerValue(page, "");
    const originalBodiesAfterEsc = readMessageBodies(fixture.conversationId);
    if (JSON.stringify(originalBodiesAfterEsc) !== JSON.stringify(originalBodiesBeforeEsc)) {
      throw new Error("edit shortcut mutated persisted message bodies");
    }

    await page.getByTestId("timeline-force-sync").click();
    await page.waitForTimeout(750);
    const syncJobsAfter = countSyncJobs(fixture.conversationId);
    const syncJobsDelta = syncJobsAfter - syncJobsBefore;
    if (syncJobsDelta < 1) {
      throw new Error(`force sync did not enqueue a sync job: delta=${syncJobsDelta}`);
    }

    await page.locator('[data-testid="timeline-filter-type"][data-filter-value="image"]').click();
    await expectFilterCount(page, 1);
    const hasAppError = await page.getByText("Algo deu errado").count();
    if (hasAppError > 0) {
      throw new Error("Inbox rendered an error state during E2E smoke");
    }
    await page.waitForTimeout(5_200);

    await page.screenshot({ path: appScreenshotPath, fullPage: true });
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const blocking = result.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious",
    );
    if (blocking.length > 0) {
      throw new Error(
        `inbox e2e has blocking a11y violations: ${blocking
          .map((violation) => `${violation.id}:${violation.impact}`)
          .join(", ")}`,
      );
    }

    await context.close();

    const sendJobsAfter = countSendJobsForPhone(smokePhone);
    const sendJobsDelta = sendJobsAfter - sendJobsBefore;
    if (sendJobsDelta !== 0) {
      throw new Error(`inbox e2e created ${sendJobsDelta} send job(s)`);
    }
    const wppMode = await captureWhatsAppPrint(wppScreenshotPath);
    console.log(
      `v29-inbox-e2e|conversation=${fixture.conversationId}|messages=4|filters=image/media/yesterday/search|reply=${replyKind}|edit=${editKind}|editMutatesPersisted=false|composerClearedOnCancel=true|syncJobsDelta=${syncJobsDelta}|sendJobsDelta=${sendJobsDelta}|blocking=${blocking.length}|app=${appScreenshotPath}|wpp=${wppScreenshotPath}|wppMode=${wppMode}`,
    );
  } finally {
    await browser.close();
  }
}

function seedInboxE2EFixture() {
  const db = new Database(databaseUrl);
  try {
    db.pragma("foreign_keys = ON");
    const now = new Date();
    const nowIso = now.toISOString();

    const contact = upsertSmokeContact(db, nowIso);
    const conversation = upsertSmokeConversation(db, contact.id, nowIso);

    db.prepare("DELETE FROM messages WHERE user_id = 1 AND conversation_id = ?").run(
      conversation.id,
    );

    const todayText = atLocalTime(10, 5, 10);
    const todayImage = atLocalTime(10, 6, 20);
    const todayVideo = atLocalTime(10, 7, 30);
    const yesterdayText = new Date(atLocalTime(9, 30, 5));
    yesterdayText.setDate(yesterdayText.getDate() - 1);

    const rows = [
      {
        externalId: "v29-e2e-yesterday-text",
        direction: "inbound",
        contentType: "text",
        status: "received",
        body: "Mensagem de ontem para filtro de data M21",
        media: null,
        observedAtUtc: yesterdayText.toISOString(),
      },
      {
        externalId: "v29-e2e-alpha-text",
        direction: "inbound",
        contentType: "text",
        status: "received",
        body: "Alpha M21 busca dentro da conversa",
        media: null,
        observedAtUtc: todayText.toISOString(),
      },
      {
        externalId: "v29-e2e-image",
        direction: "outbound",
        contentType: "image",
        status: "sent",
        body: "Imagem M21 para filtro de tipo",
        media: {
          mediaAssetId: null,
          type: "image",
          mimeType: "image/jpeg",
          fileName: "m21-before-after.jpg",
          sizeBytes: 184222,
          durationMs: null,
        },
        observedAtUtc: todayImage.toISOString(),
      },
      {
        externalId: "v29-e2e-video",
        direction: "outbound",
        contentType: "video",
        status: "sent",
        body: "Video M21 com midia",
        media: {
          mediaAssetId: null,
          type: "video",
          mimeType: "video/mp4",
          fileName: "m21-video.mp4",
          sizeBytes: 512000,
          durationMs: 4100,
        },
        observedAtUtc: todayVideo.toISOString(),
      },
    ];

    const insertMessage = db.prepare(`
      INSERT INTO messages (
        user_id, conversation_id, contact_id, external_id, direction, content_type, status,
        body, media_asset_id, media_json, quoted_message_id, wa_displayed_at,
        timestamp_precision, message_second, wa_inferred_second, observed_at_utc,
        edited_at, deleted_at, raw_json, created_at, updated_at
      )
      VALUES (
        1, @conversationId, @contactId, @externalId, @direction, @contentType, @status,
        @body, NULL, @mediaJson, NULL, @observedAtUtc,
        'second', NULL, NULL, @observedAtUtc,
        NULL, NULL, @rawJson, @nowIso, @nowIso
      )
    `);
    for (const row of rows) {
      insertMessage.run({
        conversationId: conversation.id,
        contactId: contact.id,
        externalId: row.externalId,
        direction: row.direction,
        contentType: row.contentType,
        status: row.status,
        body: row.body,
        mediaJson: row.media ? JSON.stringify(row.media) : null,
        observedAtUtc: row.observedAtUtc,
        rawJson: JSON.stringify({ smoke: smokeMarker }),
        nowIso,
      });
    }

    db.prepare(
      `
        UPDATE conversations
        SET last_message_at = @nowIso,
            last_preview = 'Video M21 com midia',
            unread_count = 0,
            updated_at = @nowIso
        WHERE id = @conversationId
      `,
    ).run({ conversationId: conversation.id, nowIso });

    return { contactId: contact.id, conversationId: conversation.id };
  } finally {
    db.close();
  }
}

function upsertSmokeContact(db, nowIso) {
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
            notes = @marker,
            last_message_at = @nowIso,
            deleted_at = NULL,
            updated_at = @nowIso
        WHERE id = @id
      `,
    ).run({ id: existing.id, title: smokeTitle, marker: smokeMarker, nowIso });
  } else {
    db.prepare(
      `
        INSERT INTO contacts (
          user_id, name, phone, email, primary_channel, instagram_handle, status, notes,
          last_message_at, profile_photo_media_asset_id, profile_photo_sha256,
          profile_photo_updated_at, deleted_at, created_at, updated_at
        )
        VALUES (
          1, @title, @phone, NULL, 'whatsapp', NULL, 'lead', @marker,
          @nowIso, NULL, NULL, NULL, NULL, @nowIso, @nowIso
        )
      `,
    ).run({ title: smokeTitle, phone: smokePhone, marker: smokeMarker, nowIso });
  }
  const contact = db
    .prepare("SELECT id FROM contacts WHERE user_id = 1 AND phone = ? ORDER BY id DESC LIMIT 1")
    .get(smokePhone);
  if (!contact?.id) throw new Error("inbox e2e contact was not created");
  return { id: Number(contact.id) };
}

function upsertSmokeConversation(db, contactId, nowIso) {
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
        is_archived = 0,
        updated_at = excluded.updated_at
    `,
  ).run({
    contactId,
    phone: smokePhone,
    title: smokeTitle,
    preview: "Alpha M21 busca dentro da conversa",
    nowIso,
  });
  const conversation = db
    .prepare(
      "SELECT id FROM conversations WHERE user_id = 1 AND channel = 'whatsapp' AND external_thread_id = ?",
    )
    .get(smokePhone);
  if (!conversation?.id) throw new Error("inbox e2e conversation was not created");
  return { id: Number(conversation.id) };
}

function atLocalTime(hours, minutes, seconds) {
  const date = new Date();
  date.setHours(hours, minutes, seconds, 0);
  return date;
}

async function expectFilterCount(page, expected) {
  await page.waitForFunction(
    ({ expectedCount }) => {
      const text = document.querySelector('[data-testid="timeline-filter-count"]')?.textContent;
      return text?.startsWith(`${expectedCount}/`) ?? false;
    },
    { expectedCount: expected },
  );
}

async function waitForComposerValue(page, expectedValue) {
  await page.waitForFunction(
    ({ expected }) => {
      const textarea = document.querySelector('[data-testid="composer-textarea"]');
      return textarea && textarea.value === expected;
    },
    { expected: expectedValue },
  );
}

async function assertVisibleBubbleTypes(page, expectedTypes) {
  const visibleTypes = await page
    .locator('[data-testid="inbox-message-bubble"]')
    .evaluateAll((nodes) =>
      nodes
        .filter((node) => {
          const element = node;
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        })
        .map((node) => node.getAttribute("data-content-type")),
    );
  for (const expected of expectedTypes) {
    if (!visibleTypes.includes(expected)) {
      throw new Error(`expected visible bubble type ${expected}, got ${visibleTypes.join(",")}`);
    }
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

function readMessageBodies(conversationId) {
  const db = new Database(databaseUrl, { readonly: true });
  try {
    return db
      .prepare(
        `
          SELECT external_id AS externalId, body, edited_at AS editedAt
          FROM messages
          WHERE user_id = 1 AND conversation_id = ?
          ORDER BY external_id
        `,
      )
      .all(conversationId);
  } finally {
    db.close();
  }
}

function countSyncJobs(conversationId) {
  const db = new Database(databaseUrl, { readonly: true });
  try {
    const row = db
      .prepare(
        `
          SELECT count(*) AS total
          FROM jobs
          WHERE user_id = 1
            AND type = 'sync_conversation'
            AND payload_json LIKE ?
        `,
      )
      .get(`%"conversationId":${conversationId}%`);
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
