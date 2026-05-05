import AxeBuilder from "@axe-core/playwright";
import Database from "better-sqlite3";
import { chromium } from "playwright";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const webUrl = process.env.WEB_URL ?? "http://127.0.0.1:3002";
const apiUrl = process.env.API_URL ?? "http://127.0.0.1:3001";
const email = process.env.SMOKE_EMAIL ?? "admin@nuoma.local";
const password = process.env.SMOKE_PASSWORD ?? "nuoma-dev-admin-123";
const screenshotPath = process.env.SCREENSHOT_PATH ?? "data/v26-profile-photo-m9.png";
const databaseUrl = path.resolve(process.env.DATABASE_URL ?? "data/nuoma-v2.db");
const smokePhone = "5531999999926";
const smokeTitle = "V2.6.26 Profile Smoke";
const smokeSha = "b".repeat(64);

async function main() {
  await assertHttp(`${webUrl}/`, "web");
  await assertHttp(`${apiUrl}/health`, "api");
  await fs.mkdir("data", { recursive: true });
  await seedProfilePhotoEvidence();

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
    const profileStatus = page.getByTestId("inbox-profile-photo-status");
    await profileStatus.getByText("Foto de perfil").waitFor({ state: "visible" });
    await profileStatus.getByText("asset #").waitFor({ state: "visible" });
    await profileStatus.getByText(`sha ${smokeSha.slice(0, 12)}`).waitFor({ state: "visible" });

    await page.screenshot({ path: screenshotPath, fullPage: true });
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    const blocking = result.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious",
    );
    console.log(
      `v26-profile-photo|title=${smokeTitle}|sha=${smokeSha.slice(0, 12)}|violations=${result.violations.length}|blocking=${blocking.length}|${screenshotPath}`,
    );
    if (blocking.length > 0) {
      throw new Error(
        `profile photo inbox has blocking a11y violations: ${blocking
          .map((violation) => `${violation.id}:${violation.impact}`)
          .join(", ")}`,
      );
    }
    await context.close();
  } finally {
    await browser.close();
  }
}

async function seedProfilePhotoEvidence() {
  const db = new Database(databaseUrl);
  try {
    db.pragma("foreign_keys = ON");
    const now = new Date().toISOString();
    const storageRoot = path.resolve(path.dirname(databaseUrl), "media-assets", "1", "profile-photos", smokePhone);
    await fs.mkdir(storageRoot, { recursive: true });
    const storagePath = path.join(storageRoot, `${smokeSha}.jpg`);
    await fs.writeFile(storagePath, Buffer.from("nuoma-v26-profile-photo-smoke"));

    db.prepare(
      `
        INSERT INTO media_assets (
          user_id, type, file_name, mime_type, sha256, size_bytes, duration_ms,
          storage_path, source_url, deleted_at, created_at, updated_at
        )
        VALUES (1, 'image', 'v26-profile-photo-smoke.jpg', 'image/jpeg', @sha, 30, NULL, @storagePath, NULL, NULL, @now, @now)
        ON CONFLICT(user_id, sha256) DO UPDATE SET
          file_name = excluded.file_name,
          storage_path = excluded.storage_path,
          deleted_at = NULL,
          updated_at = excluded.updated_at
      `,
    ).run({ sha: smokeSha, storagePath, now });

    const mediaAsset = db
      .prepare("SELECT id FROM media_assets WHERE user_id = 1 AND sha256 = ?")
      .get(smokeSha);
    if (!mediaAsset?.id) {
      throw new Error("profile photo smoke media asset was not created");
    }

    const existingContact = db
      .prepare("SELECT id FROM contacts WHERE user_id = 1 AND phone = ?")
      .get(smokePhone);
    if (existingContact?.id) {
      db.prepare(
        `
          UPDATE contacts
          SET name = @title,
              profile_photo_media_asset_id = @mediaAssetId,
              profile_photo_sha256 = @sha,
              profile_photo_updated_at = @now,
              deleted_at = NULL,
              updated_at = @now
          WHERE id = @contactId AND user_id = 1
        `,
      ).run({
        title: smokeTitle,
        mediaAssetId: mediaAsset.id,
        sha: smokeSha,
        now,
        contactId: existingContact.id,
      });
    } else {
      db.prepare(
        `
          INSERT INTO contacts (
            user_id, name, phone, email, primary_channel, instagram_handle, status, notes,
            last_message_at, profile_photo_media_asset_id, profile_photo_sha256,
            profile_photo_updated_at, deleted_at, created_at, updated_at
          )
          VALUES (
            1, @title, @phone, NULL, 'whatsapp', NULL, 'lead', 'Smoke V2.6.26',
            @now, @mediaAssetId, @sha, @now, NULL, @now, @now
          )
        `,
      ).run({ title: smokeTitle, phone: smokePhone, mediaAssetId: mediaAsset.id, sha: smokeSha, now });
    }

    const contact = db
      .prepare("SELECT id FROM contacts WHERE user_id = 1 AND phone = ?")
      .get(smokePhone);
    if (!contact?.id) {
      throw new Error("profile photo smoke contact was not created");
    }

    db.prepare(
      `
        INSERT INTO conversations (
          user_id, contact_id, channel, external_thread_id, title, last_message_at,
          last_preview, unread_count, is_archived, temporary_messages_until,
          profile_photo_media_asset_id, profile_photo_sha256, profile_photo_updated_at,
          created_at, updated_at
        )
        VALUES (
          1, @contactId, 'whatsapp', @phone, @title, @now,
          'Profile photo synced with hash', 0, 0, NULL,
          @mediaAssetId, @sha, @now, @now, @now
        )
        ON CONFLICT(user_id, channel, external_thread_id) DO UPDATE SET
          contact_id = excluded.contact_id,
          title = excluded.title,
          last_message_at = excluded.last_message_at,
          last_preview = excluded.last_preview,
          is_archived = 0,
          profile_photo_media_asset_id = excluded.profile_photo_media_asset_id,
          profile_photo_sha256 = excluded.profile_photo_sha256,
          profile_photo_updated_at = excluded.profile_photo_updated_at,
          updated_at = excluded.updated_at
      `,
    ).run({
      contactId: contact.id,
      phone: smokePhone,
      title: smokeTitle,
      mediaAssetId: mediaAsset.id,
      sha: smokeSha,
      now,
    });

    const conversation = db
      .prepare("SELECT id FROM conversations WHERE user_id = 1 AND external_thread_id = ?")
      .get(smokePhone);
    if (!conversation?.id) {
      throw new Error("profile photo smoke conversation was not created");
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
          1, @conversationId, @contactId, @externalId, 'system', 'system', 'received',
          'Profile photo captured by V2.6.26 smoke', NULL, NULL, NULL, @now,
          'second', 0, 0, @now, NULL, NULL, @raw, @now, @now
        )
        ON CONFLICT(conversation_id, external_id) DO UPDATE SET
          body = excluded.body,
          observed_at_utc = excluded.observed_at_utc,
          updated_at = excluded.updated_at
      `,
    ).run({
      conversationId: conversation.id,
      contactId: contact.id,
      externalId: "v26-profile-photo-smoke",
      raw: JSON.stringify({ source: "v26-profile-photo-smoke", sha256: smokeSha }),
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
