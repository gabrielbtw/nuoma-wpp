import AxeBuilder from "@axe-core/playwright";
import Database from "better-sqlite3";
import { chromium } from "playwright";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const webUrl = process.env.WEB_URL ?? "http://127.0.0.1:3002";
const apiUrl = process.env.API_URL ?? "http://127.0.0.1:3001";
const email = process.env.SMOKE_EMAIL ?? "admin@nuoma.local";
const password = process.env.SMOKE_PASSWORD ?? "nuoma-dev-admin-123";
const screenshotPath = process.env.SCREENSHOT_PATH ?? "data/v26-attachment-candidates-m12.png";
const databaseUrl = path.resolve(process.env.DATABASE_URL ?? "data/nuoma-v2.db");
const smokePhone = "5531999999627";
const smokeTitle = "V2.6.27 Attachments Smoke";

const attachments = [
  {
    type: "image",
    fileName: "v26-before-after.jpg",
    mimeType: "image/jpeg",
    sha256: "e".repeat(64),
    body: "Imagem capturada",
  },
  {
    type: "video",
    fileName: "v26-video.mp4",
    mimeType: "video/mp4",
    sha256: "f".repeat(64),
    body: "Video capturado",
  },
  {
    type: "audio",
    fileName: "v26-audio.ogg",
    mimeType: "audio/ogg",
    sha256: "1".repeat(64),
    body: "Audio capturado",
  },
  {
    type: "document",
    fileName: "v26-documento.pdf",
    mimeType: "application/pdf",
    sha256: "2".repeat(64),
    body: "Documento capturado",
  },
];

async function main() {
  await assertHttp(`${webUrl}/`, "web");
  await assertHttp(`${apiUrl}/health`, "api");
  await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
  await seedAttachmentEvidence();

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
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

    const attachmentStatus = page.getByTestId("inbox-attachment-candidates-status");
    await attachmentStatus.getByText("Anexos capturados").waitFor({ state: "visible" });
    await attachmentStatus.getByTestId("inbox-attachment-candidates-total").getByText("4").waitFor({
      state: "visible",
    });
    await attachmentStatus.getByText("Imagem").waitFor({ state: "visible" });
    await attachmentStatus.getByText("v26-video.mp4").waitFor({ state: "visible" });
    await attachmentStatus.getByText("v26-before-after.jpg").waitFor({ state: "visible" });

    await attachmentStatus.screenshot({ path: screenshotPath });
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const blocking = result.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious",
    );
    console.log(
      `v26-attachment-candidates|title=${smokeTitle}|total=4|violations=${result.violations.length}|blocking=${blocking.length}|${screenshotPath}`,
    );
    if (blocking.length > 0) {
      throw new Error(
        `attachment candidates inbox has blocking a11y violations: ${blocking
          .map((violation) => `${violation.id}:${violation.impact}`)
          .join(", ")}`,
      );
    }
    await context.close();
  } finally {
    await browser.close();
  }
}

function ensureAttachmentCandidatesTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS attachment_candidates (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      user_id integer NOT NULL,
      conversation_id integer NOT NULL,
      message_id integer,
      media_asset_id integer NOT NULL,
      channel text NOT NULL,
      content_type text NOT NULL,
      external_message_id text,
      caption text,
      observed_at text NOT NULL,
      metadata_json text DEFAULT '{}' NOT NULL,
      created_at text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
      updated_at text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE cascade,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE cascade,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE set null,
      FOREIGN KEY (media_asset_id) REFERENCES media_assets(id) ON DELETE cascade
    );
    CREATE INDEX IF NOT EXISTS idx_attachment_candidates_user_conversation_observed
      ON attachment_candidates (user_id, conversation_id, observed_at);
    CREATE INDEX IF NOT EXISTS idx_attachment_candidates_user_media
      ON attachment_candidates (user_id, media_asset_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_attachment_candidates_user_conversation_external_media
      ON attachment_candidates (user_id, conversation_id, external_message_id, media_asset_id);
  `);
}

async function seedAttachmentEvidence() {
  const db = new Database(databaseUrl);
  try {
    db.pragma("foreign_keys = ON");
    ensureAttachmentCandidatesTable(db);
    const now = new Date().toISOString();

    const existingContact = db
      .prepare("SELECT id FROM contacts WHERE user_id = 1 AND phone = ?")
      .get(smokePhone);
    if (existingContact?.id) {
      db.prepare(
        `
          UPDATE contacts
          SET name = @title,
              primary_channel = 'whatsapp',
              deleted_at = NULL,
              updated_at = @now
          WHERE id = @contactId AND user_id = 1
        `,
      ).run({ title: smokeTitle, now, contactId: existingContact.id });
    } else {
      db.prepare(
        `
          INSERT INTO contacts (
            user_id, name, phone, email, primary_channel, instagram_handle, status, notes,
            last_message_at, profile_photo_media_asset_id, profile_photo_sha256,
            profile_photo_updated_at, deleted_at, created_at, updated_at
          )
          VALUES (
            1, @title, @phone, NULL, 'whatsapp', NULL, 'lead', 'Smoke V2.6.27',
            @now, NULL, NULL, NULL, NULL, @now, @now
          )
        `,
      ).run({ title: smokeTitle, phone: smokePhone, now });
    }

    const contact = db
      .prepare("SELECT id FROM contacts WHERE user_id = 1 AND phone = ?")
      .get(smokePhone);
    if (!contact?.id) {
      throw new Error("attachment candidate smoke contact was not created");
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
          '4 anexos capturados pela V2.6.27', 0, 0, NULL,
          NULL, NULL, NULL, @now, @now
        )
        ON CONFLICT(user_id, channel, external_thread_id) DO UPDATE SET
          contact_id = excluded.contact_id,
          title = excluded.title,
          last_message_at = excluded.last_message_at,
          last_preview = excluded.last_preview,
          is_archived = 0,
          updated_at = excluded.updated_at
      `,
    ).run({ contactId: contact.id, phone: smokePhone, title: smokeTitle, now });

    const conversation = db
      .prepare("SELECT id FROM conversations WHERE user_id = 1 AND external_thread_id = ?")
      .get(smokePhone);
    if (!conversation?.id) {
      throw new Error("attachment candidate smoke conversation was not created");
    }

    db.prepare("DELETE FROM attachment_candidates WHERE user_id = 1 AND conversation_id = ?").run(
      conversation.id,
    );

    for (let index = 0; index < attachments.length; index += 1) {
      const attachment = attachments[index];
      const observedAt = new Date(Date.parse(now) + index * 1000).toISOString();
      const externalId = `v26-attachment-candidate-${index + 1}`;
      db.prepare(
        `
          INSERT INTO media_assets (
            user_id, type, file_name, mime_type, sha256, size_bytes, duration_ms,
            storage_path, source_url, deleted_at, created_at, updated_at
          )
          VALUES (
            1, @type, @fileName, @mimeType, @sha256, 0, NULL,
            @storagePath, NULL, NULL, @now, @now
          )
          ON CONFLICT(user_id, sha256) DO UPDATE SET
            type = excluded.type,
            file_name = excluded.file_name,
            mime_type = excluded.mime_type,
            storage_path = excluded.storage_path,
            deleted_at = NULL,
            updated_at = excluded.updated_at
        `,
      ).run({
        type: attachment.type,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        sha256: attachment.sha256,
        storagePath: `wa-visible://${attachment.sha256}`,
        now,
      });

      const mediaAsset = db
        .prepare("SELECT id FROM media_assets WHERE user_id = 1 AND sha256 = ?")
        .get(attachment.sha256);
      if (!mediaAsset?.id) {
        throw new Error(`media asset not created for ${attachment.fileName}`);
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
            1, @conversationId, @contactId, @externalId, 'inbound', @type, 'received',
            @body, @mediaAssetId, @media, NULL, @observedAt,
            'second', @second, @second, @observedAt, NULL, NULL, @raw, @now, @now
          )
          ON CONFLICT(conversation_id, external_id) DO UPDATE SET
            body = excluded.body,
            content_type = excluded.content_type,
            media_asset_id = excluded.media_asset_id,
            observed_at_utc = excluded.observed_at_utc,
            raw_json = excluded.raw_json,
            updated_at = excluded.updated_at
        `,
      ).run({
        conversationId: conversation.id,
        contactId: contact.id,
        externalId,
        type: attachment.type,
        body: attachment.body,
        mediaAssetId: mediaAsset.id,
        media: JSON.stringify({ fileName: attachment.fileName, sha256: attachment.sha256 }),
        raw: JSON.stringify({ source: "v26-attachment-candidates-smoke" }),
        observedAt,
        second: 59 - index,
        now,
      });

      const message = db
        .prepare("SELECT id FROM messages WHERE conversation_id = ? AND external_id = ?")
        .get(conversation.id, externalId);
      if (!message?.id) {
        throw new Error(`message not created for ${attachment.fileName}`);
      }

      db.prepare(
        `
          INSERT INTO attachment_candidates (
            user_id, conversation_id, message_id, media_asset_id, channel, content_type,
            external_message_id, caption, observed_at, metadata_json, created_at, updated_at
          )
          VALUES (
            1, @conversationId, @messageId, @mediaAssetId, 'whatsapp', @type,
            @externalId, @body, @observedAt, @metadata, @now, @now
          )
          ON CONFLICT(user_id, conversation_id, external_message_id, media_asset_id) DO UPDATE SET
            message_id = excluded.message_id,
            caption = excluded.caption,
            observed_at = excluded.observed_at,
            metadata_json = excluded.metadata_json,
            updated_at = excluded.updated_at
        `,
      ).run({
        conversationId: conversation.id,
        messageId: message.id,
        mediaAssetId: mediaAsset.id,
        type: attachment.type,
        externalId,
        body: attachment.body,
        observedAt,
        metadata: JSON.stringify({
          source: "v26-attachment-candidates-smoke",
          fileName: attachment.fileName,
          sha256: attachment.sha256,
        }),
        now,
      });
    }
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

await main();
