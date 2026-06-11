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
const screenshotPath = process.env.SCREENSHOT_PATH ?? "data/v29-reconciliation-m22-app.png";

const smokePhone = "5531999999629";
const smokeTitle = "V2.9 Reconciliation Smoke";
const mediaRoot = path.resolve("data/tmp/v29-reconciliation-media");

async function main() {
  await assertHttp(`${webUrl}/`, "web");
  await assertHttp(`${apiUrl}/health`, "api");
  await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
  const fixture = await seedFixture();
  const sendJobsBefore = countSendJobsForPhone(smokePhone);

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 940 } });
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

    await page.getByTestId("inbox-conversation-avatar-image").waitFor({
      state: "visible",
      timeout: 10_000,
    });
    await page.getByTestId("inbox-profile-avatar-image").waitFor({
      state: "visible",
      timeout: 10_000,
    });

    const dividers = page.getByTestId("timeline-date-divider");
    await expectCountAtLeast(dividers, 2, "sticky date dividers");
    const stickyPositions = await dividers.evaluateAll((nodes) =>
      nodes.map((node) => getComputedStyle(node).position),
    );
    if (!stickyPositions.every((position) => position === "sticky")) {
      throw new Error(`date dividers are not sticky: ${stickyPositions.join(",")}`);
    }

    for (const type of ["image", "video", "audio", "document"]) {
      await page
        .locator(`[data-testid="message-media-card"][data-media-type="${type}"]`)
        .first()
        .waitFor({ state: "visible", timeout: 10_000 });
    }

    const readReceipt = page.getByTestId("message-read-receipt").first();
    await readReceipt.waitFor({ state: "visible", timeout: 10_000 });
    const receiptState = await readReceipt.getAttribute("data-read-receipt");
    const receiptSource = await readReceipt.getAttribute("data-read-receipt-source");
    if (receiptState !== "read" || receiptSource !== "observer") {
      throw new Error(`read receipt mismatch: state=${receiptState} source=${receiptSource}`);
    }

    await page.getByTestId("composer-attach-image").waitFor({ state: "visible" });
    await page.getByTestId("composer-attach-video").waitFor({ state: "visible" });
    await page.getByTestId("composer-attach-document").waitFor({ state: "visible" });
    await page.getByTestId("composer-voice-record-button").waitFor({ state: "visible" });

    await page.getByTestId("inbox-contact-edit-toggle").click();
    const nextName = `V2.9 contato editado ${Date.now()}`;
    await page.getByTestId("inbox-contact-edit-name").fill(nextName);
    await page.getByTestId("inbox-contact-edit-phone").fill("+55 31 99999-9629");
    await page.getByTestId("inbox-contact-edit-email").fill("v29-reconciliation@nuoma.local");
    await page.getByTestId("inbox-contact-edit-instagram").fill("@v29.reconciliation");
    await page.getByTestId("inbox-contact-edit-save").click();
    await page.waitForTimeout(750);
    const edited = readContact(fixture.contactId);
    if (
      edited.name !== nextName ||
      edited.phone !== "5531999999629" ||
      edited.email !== "v29-reconciliation@nuoma.local" ||
      edited.instagram_handle !== "v29.reconciliation"
    ) {
      throw new Error(`inline contact edit did not persist: ${JSON.stringify(edited)}`);
    }

    await page.getByTestId("inbox-tags-tab").click();
    const firstTag = page.getByTestId("inbox-tag-active").filter({ hasText: "M22-A" });
    const secondTag = page.getByTestId("inbox-tag-active").filter({ hasText: "M22-B" });
    await firstTag.waitFor({ state: "visible", timeout: 10_000 });
    await secondTag.waitFor({ state: "visible", timeout: 10_000 });
    await secondTag.dispatchEvent("dragstart");
    await firstTag.dispatchEvent("dragover");
    await firstTag.dispatchEvent("drop");
    await secondTag.dispatchEvent("dragend");
    await page.waitForTimeout(750);
    const tagOrder = readTagOrder(fixture.contactId);
    if (tagOrder.join(",") !== `${fixture.tagBId},${fixture.tagAId}`) {
      throw new Error(`tag drag/drop order did not persist: ${tagOrder.join(",")}`);
    }

    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .include('[data-testid="inbox-message-timeline"]')
      .include('[data-testid="composer-textarea"]')
      .include('[data-testid="inbox-contact-sidebar"]')
      .analyze();
    const blocking = result.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious",
    );
    await page.screenshot({ path: screenshotPath, fullPage: true });
    if (blocking.length > 0) {
      throw new Error(
        `V2.9 reconciliation has blocking a11y violations: ${blocking
          .map(
            (violation) =>
              `${violation.id}:${violation.impact}:${violation.nodes
                .slice(0, 2)
                .map((node) => node.target.join("|"))
                .join(";")}`,
          )
          .join(", ")}`,
      );
    }

    const sendJobsAfter = countSendJobsForPhone(smokePhone);
    const sendJobsDelta = sendJobsAfter - sendJobsBefore;
    if (sendJobsDelta !== 0) {
      throw new Error(`V2.9 reconciliation smoke created ${sendJobsDelta} send job(s)`);
    }

    console.log(
      `v29-reconciliation|conversation=${fixture.conversationId}|contact=${fixture.contactId}|avatar=real|dividers=${await dividers.count()}|media=image,video,audio,document|receipt=${receiptState}/${receiptSource}|inlineEdit=ok|tagOrder=${tagOrder.join(">")}|sendJobsDelta=${sendJobsDelta}|blocking=${blocking.length}|app=${screenshotPath}|ig=nao_aplicavel`,
    );
    await context.close();
  } finally {
    await browser.close();
  }
}

async function seedFixture() {
  await fs.mkdir(mediaRoot, { recursive: true });
  const profilePath = path.join(mediaRoot, "profile.png");
  const imagePath = path.join(mediaRoot, "image.png");
  const videoPath = path.join(mediaRoot, "video.mp4");
  const audioPath = path.join(mediaRoot, "audio.ogg");
  const documentPath = path.join(mediaRoot, "document.pdf");
  await fs.writeFile(profilePath, tinyPng());
  await fs.writeFile(imagePath, tinyPng());
  await fs.writeFile(videoPath, Buffer.from("fake video bytes"));
  await fs.writeFile(audioPath, Buffer.from("fake audio bytes"));
  await fs.writeFile(documentPath, Buffer.from("%PDF-1.4\n% v29 reconciliation\n"));

  const db = new Database(databaseUrl);
  try {
    db.pragma("foreign_keys = ON");
    const now = new Date().toISOString();
    const profile = upsertAsset(db, {
      fileName: "profile.png",
      mimeType: "image/png",
      type: "image",
      path: profilePath,
      bytes: tinyPng().length,
    });
    const image = upsertAsset(db, {
      fileName: "image.png",
      mimeType: "image/png",
      type: "image",
      path: imagePath,
      bytes: tinyPng().length,
    });
    const video = upsertAsset(db, {
      fileName: "video.mp4",
      mimeType: "video/mp4",
      type: "video",
      path: videoPath,
      bytes: 16,
    });
    const audio = upsertAsset(db, {
      fileName: "audio.ogg",
      mimeType: "audio/ogg",
      type: "audio",
      path: audioPath,
      bytes: 16,
    });
    const document = upsertAsset(db, {
      fileName: "document.pdf",
      mimeType: "application/pdf",
      type: "document",
      path: documentPath,
      bytes: 29,
    });
    const tagAId = upsertTag(db, "M22-A", "#22c55e", now);
    const tagBId = upsertTag(db, "M22-B", "#38bdf8", now);

    const updatedContact = db
      .prepare(
        `
        UPDATE contacts
        SET name = @title,
            phone = @phone,
            phone_e164 = @phoneE164,
            wa_jid = @waJid,
            email = NULL,
            primary_channel = 'whatsapp',
            instagram_handle = NULL,
            status = 'lead',
            notes = 'Smoke V2.9 reconciliation',
            last_message_at = @now,
            profile_photo_media_asset_id = @profileId,
            profile_photo_sha256 = @profileSha,
            profile_photo_updated_at = @now,
            deleted_at = NULL,
            updated_at = @now
        WHERE user_id = 1 AND phone = @phone
      `,
      )
      .run({
        title: smokeTitle,
        phone: smokePhone,
        phoneE164: `+${smokePhone}`,
        waJid: `${smokePhone}@s.whatsapp.net`,
        now,
        profileId: profile.id,
        profileSha: profile.sha,
      });

    if (updatedContact.changes === 0) {
      db.prepare(
        `
        INSERT INTO contacts (
          user_id, name, phone, phone_e164, wa_jid, email, primary_channel, instagram_handle, status, notes,
          last_message_at, profile_photo_media_asset_id, profile_photo_sha256,
          profile_photo_updated_at, deleted_at, created_at, updated_at
        )
        VALUES (
          1, @title, @phone, @phoneE164, @waJid, NULL, 'whatsapp', NULL, 'lead', 'Smoke V2.9 reconciliation',
          @now, @profileId, @profileSha, @now, NULL, @now, @now
        )
      `,
      ).run({
        title: smokeTitle,
        phone: smokePhone,
        phoneE164: `+${smokePhone}`,
        waJid: `${smokePhone}@s.whatsapp.net`,
        now,
        profileId: profile.id,
        profileSha: profile.sha,
      });
    }

    const contact = db
      .prepare("SELECT id FROM contacts WHERE user_id = 1 AND phone = ? LIMIT 1")
      .get(smokePhone);
    if (!contact?.id) throw new Error("failed to seed contact");

    db.prepare("DELETE FROM contact_tags WHERE user_id = 1 AND contact_id = ?").run(contact.id);
    db.prepare(
      "INSERT INTO contact_tags (contact_id, tag_id, user_id, sort_order, created_at) VALUES (?, ?, 1, ?, ?)",
    ).run(contact.id, tagAId, 0, now);
    db.prepare(
      "INSERT INTO contact_tags (contact_id, tag_id, user_id, sort_order, created_at) VALUES (?, ?, 1, ?, ?)",
    ).run(contact.id, tagBId, 1, now);

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
          'media, recibo e edição inline', 0, 0, NULL,
          @profileId, @profileSha, @now, @now, @now
        )
        ON CONFLICT(user_id, channel, external_thread_id) DO UPDATE SET
          contact_id = excluded.contact_id,
          title = excluded.title,
          last_message_at = excluded.last_message_at,
          last_preview = excluded.last_preview,
          unread_count = 0,
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
      now,
      profileId: profile.id,
      profileSha: profile.sha,
    });

    const conversation = db
      .prepare(
        "SELECT id FROM conversations WHERE user_id = 1 AND channel = 'whatsapp' AND external_thread_id = ? LIMIT 1",
      )
      .get(smokePhone);
    if (!conversation?.id) throw new Error("failed to seed conversation");

    db.prepare("DELETE FROM messages WHERE user_id = 1 AND conversation_id = ?").run(
      conversation.id,
    );
    insertMessage(db, conversation.id, contact.id, "v29-m22-read", "text", "read", null, {
      direction: "outbound",
      body: "Mensagem lida pelo observer",
      observedAtUtc: "2026-05-09T13:00:00.000Z",
      raw: { readReceipt: "read", statusLabel: "Lida" },
    });
    insertMessage(db, conversation.id, contact.id, "v29-m22-image", "image", "received", image, {
      body: "Imagem",
      observedAtUtc: "2026-05-10T13:01:00.000Z",
    });
    insertMessage(db, conversation.id, contact.id, "v29-m22-video", "video", "received", video, {
      body: "Video",
      observedAtUtc: "2026-05-10T13:02:00.000Z",
    });
    insertMessage(db, conversation.id, contact.id, "v29-m22-audio", "audio", "received", audio, {
      body: "Audio",
      observedAtUtc: "2026-05-10T13:03:00.000Z",
    });
    insertMessage(
      db,
      conversation.id,
      contact.id,
      "v29-m22-document",
      "document",
      "received",
      document,
      { body: "Documento", observedAtUtc: "2026-05-10T13:04:00.000Z" },
    );

    return {
      contactId: Number(contact.id),
      conversationId: Number(conversation.id),
      tagAId,
      tagBId,
    };
  } finally {
    db.close();
  }
}

function upsertAsset(db, input) {
  const sha = shaFor(input.fileName, input.bytes);
  db.prepare(
    `
      INSERT INTO media_assets (
        user_id, type, file_name, mime_type, sha256, size_bytes, duration_ms,
        storage_path, source_url, deleted_at, created_at, updated_at
      )
      VALUES (1, @type, @fileName, @mimeType, @sha, @bytes, NULL, @path, NULL, NULL, @now, @now)
      ON CONFLICT(user_id, sha256) DO UPDATE SET
        type = excluded.type,
        file_name = excluded.file_name,
        mime_type = excluded.mime_type,
        size_bytes = excluded.size_bytes,
        storage_path = excluded.storage_path,
        deleted_at = NULL,
        updated_at = excluded.updated_at
    `,
  ).run({ ...input, sha, now: new Date().toISOString() });
  return db
    .prepare("SELECT id, sha256 AS sha FROM media_assets WHERE user_id = 1 AND sha256 = ?")
    .get(sha);
}

function upsertTag(db, name, color, now) {
  db.prepare(
    `
      INSERT INTO tags (user_id, name, color, description, created_at, updated_at)
      VALUES (1, @name, @color, 'V2.9 reconciliation smoke', @now, @now)
      ON CONFLICT(user_id, name) DO UPDATE SET color = excluded.color, updated_at = excluded.updated_at
    `,
  ).run({ name, color, now });
  return Number(db.prepare("SELECT id FROM tags WHERE user_id = 1 AND name = ?").get(name).id);
}

function insertMessage(
  db,
  conversationId,
  contactId,
  externalId,
  contentType,
  status,
  asset,
  extra,
) {
  db.prepare(
    `
      INSERT INTO messages (
        user_id, conversation_id, contact_id, external_id, direction, content_type, status,
        body, media_asset_id, media_json, wa_displayed_at, timestamp_precision,
        message_second, wa_inferred_second, observed_at_utc, edited_at, deleted_at,
        raw_json, created_at, updated_at
      )
      VALUES (
        1, @conversationId, @contactId, @externalId, @direction, @contentType, @status,
        @body, @mediaAssetId, @media, @observedAtUtc, 'second',
        0, NULL, @observedAtUtc, NULL, NULL, @raw, @observedAtUtc, @observedAtUtc
      )
    `,
  ).run({
    conversationId,
    contactId,
    externalId,
    direction: extra.direction ?? "inbound",
    contentType,
    status,
    body: extra.body ?? null,
    mediaAssetId: asset?.id ?? null,
    media: asset
      ? JSON.stringify({
          mediaAssetId: Number(asset.id),
          type: assetType(contentType),
          mimeType: mimeType(contentType),
          fileName: `${contentType}-m22`,
          sizeBytes: 16,
          durationMs: null,
        })
      : null,
    observedAtUtc: extra.observedAtUtc,
    raw: JSON.stringify(extra.raw ?? {}),
  });
}

function readContact(contactId) {
  const db = new Database(databaseUrl, { readonly: true });
  try {
    return db
      .prepare("SELECT name, phone, email, instagram_handle FROM contacts WHERE id = ?")
      .get(contactId);
  } finally {
    db.close();
  }
}

function readTagOrder(contactId) {
  const db = new Database(databaseUrl, { readonly: true });
  try {
    return db
      .prepare(
        "SELECT tag_id AS tagId FROM contact_tags WHERE user_id = 1 AND contact_id = ? ORDER BY sort_order ASC, tag_id ASC",
      )
      .all(contactId)
      .map((row) => Number(row.tagId));
  } finally {
    db.close();
  }
}

function countSendJobsForPhone(phone) {
  const db = new Database(databaseUrl, { readonly: true });
  try {
    return Number(
      db
        .prepare(
          `
            SELECT COUNT(*) AS total
            FROM jobs
            WHERE user_id = 1
              AND type IN ('send_message', 'send_voice', 'campaign_step', 'automation_action', 'send_instagram_message')
              AND payload_json LIKE ?
          `,
        )
        .get(`%${phone}%`).total,
    );
  } finally {
    db.close();
  }
}

async function expectCountAtLeast(locator, expected, label) {
  const count = await locator.count();
  if (count < expected) {
    throw new Error(`expected at least ${expected} ${label}, got ${count}`);
  }
}

async function assertHttp(url, label) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${label} not ready: ${response.status} ${url}`);
  }
}

function tinyPng() {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    "base64",
  );
}

function shaFor(name, bytes) {
  const value = `${name}:${bytes}:v29-reconciliation`;
  return Buffer.from(value).toString("hex").padEnd(64, "0").slice(0, 64);
}

function assetType(contentType) {
  return contentType === "document" ? "document" : contentType;
}

function mimeType(contentType) {
  if (contentType === "image") return "image/png";
  if (contentType === "video") return "video/mp4";
  if (contentType === "audio") return "audio/ogg";
  return "application/pdf";
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
