import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import Database from "better-sqlite3";
import { chromium } from "playwright";
import {
  backfillSmokeWhatsappIdentity,
  findSmokeWhatsappContact,
  findSmokeWhatsappConversation,
  normalizeSmokePhoneDigits,
} from "./helpers/contact-identity.mjs";

const execFileAsync = promisify(execFile);
const rootDir = process.cwd();
const dataDir = path.join(rootDir, "data");
const mediaDir = path.join(dataDir, "smoke-media", "full-campaign-real-media");
const dbPath = process.env.DATABASE_URL ?? path.join(dataDir, "nuoma-v2.db");
const apiUrl = process.env.API_URL ?? "http://127.0.0.1:3001";
const webUrl = process.env.WEB_URL ?? "http://127.0.0.1:3002";
const cdpUrl = process.env.CDP_URL ?? "http://127.0.0.1:9223";
const email = process.env.SMOKE_EMAIL ?? "admin@nuoma.local";
const password = process.env.SMOKE_PASSWORD ?? "nuoma-dev-admin-123";
const userId = Number(process.env.SMOKE_USER_ID ?? 1);
const phone = normalizeRequiredPhone(process.env.SMOKE_PHONE ?? "5531982066263");
const allowedPhone = normalizeRequiredPhone(
  process.env.CAMPAIGN_REAL_MEDIA_ALLOWED_PHONE ?? "5531982066263",
);
const tokenRoot = process.env.SMOKE_TOKEN ?? `FCMR-${Date.now()}`;
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS ?? 420_000);
const longAudioMs = Number(process.env.SMOKE_LONG_AUDIO_MS ?? 25_000);
const proofCampaignId = optionalPositiveInteger(process.env.CAMPAIGN_REAL_MEDIA_PROOF_CAMPAIGN_ID);
const screenshotDir = path.resolve(
  process.env.SMOKE_SCREENSHOT_DIR ?? path.join("/tmp", "nuoma-full-audit", "campaign-real-media"),
);

const tokens = {
  text: `${tokenRoot}-TEXTO`,
  message: `${tokenRoot}-MENSAGEM`,
  link: `${tokenRoot}-LINK`,
  image: `${tokenRoot}-IMAGEM`,
  video: `${tokenRoot}-VIDEO`,
  document: `${tokenRoot}-PDF`,
  audioLong: `${tokenRoot}-AUDIO-LONGO`,
};

const screenshots = {
  app: path.join(screenshotDir, `${tokenRoot}-campaigns-app.png`),
  wpp: path.join(screenshotDir, `${tokenRoot}-whatsapp-campaign.png`),
};

fs.mkdirSync(mediaDir, { recursive: true });
fs.mkdirSync(screenshotDir, { recursive: true });

const db = new Database(dbPath);
db.pragma("busy_timeout = 5000");

function normalizeRequiredPhone(value) {
  const phoneValue = normalizeSmokePhoneDigits(value);
  if (!phoneValue) {
    throw new Error(`invalid phone: ${String(value ?? "")}`);
  }
  return phoneValue;
}

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function compact(value) {
  return JSON.stringify(value).replace(/\s+/g, " ");
}

function assertRealSendGuards() {
  if (process.env.CAMPAIGN_REAL_MEDIA_SEND !== "SIM") {
    throw new Error(
      "Set CAMPAIGN_REAL_MEDIA_SEND=SIM to run the real WhatsApp campaign media smoke",
    );
  }
  if (phone !== allowedPhone) {
    throw new Error(
      `SMOKE_PHONE must match CAMPAIGN_REAL_MEDIA_ALLOWED_PHONE: phone=${phone} allowed=${allowedPhone}`,
    );
  }
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error("SMOKE_USER_ID must be a positive integer");
  }
  if (!Number.isInteger(longAudioMs) || longAudioMs < 20_000) {
    throw new Error("SMOKE_LONG_AUDIO_MS must be at least 20000 for long-audio coverage");
  }
}

function optionalPositiveInteger(value) {
  if (value == null || value === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`expected positive integer, got ${value}`);
  }
  return parsed;
}

async function assertHttpOk(url, label) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${label} not ok: ${response.status}`);
  }
}

async function runFfmpeg(args) {
  await execFileAsync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], {
    timeout: 120_000,
  });
}

function mediaSeedParts() {
  const digest = crypto.createHash("sha256").update(tokenRoot).digest("hex");
  return {
    imageColor: `0x${digest.slice(0, 6)}`,
    videoColor: `0x${digest.slice(6, 12)}`,
    audioFrequency: 480 + (parseInt(digest.slice(12, 16), 16) % 520),
  };
}

async function generateMediaFiles() {
  const seed = mediaSeedParts();
  const imagePath = path.join(mediaDir, `${tokens.image}.jpg`);
  const videoPath = path.join(mediaDir, `${tokens.video}.mp4`);
  const audioPath = path.join(mediaDir, `${tokens.audioLong}.wav`);
  const pdfPath = path.join(mediaDir, `${tokens.document}.pdf`);

  await runFfmpeg([
    "-f",
    "lavfi",
    "-i",
    `color=c=${seed.imageColor}:s=960x1280:d=1`,
    "-frames:v",
    "1",
    imagePath,
  ]);
  await runFfmpeg([
    "-f",
    "lavfi",
    "-i",
    `color=c=${seed.videoColor}:s=640x360:r=15:d=3`,
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=44100:cl=mono",
    "-t",
    "3",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    videoPath,
  ]);
  await runFfmpeg([
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=${seed.audioFrequency}:duration=${Math.ceil(longAudioMs / 1000)}`,
    "-ac",
    "1",
    "-ar",
    "48000",
    "-c:a",
    "pcm_s16le",
    audioPath,
  ]);
  await fs.promises.writeFile(pdfPath, minimalPdf(`${tokens.document} campanha real Nuoma`));

  return {
    image: await mediaInput("image", "image/jpeg", imagePath),
    video: await mediaInput("video", "video/mp4", videoPath),
    audio: await mediaInput("voice", "audio/wav", audioPath, longAudioMs),
    document: await mediaInput("document", "application/pdf", pdfPath),
  };
}

function minimalPdf(text) {
  const safeText = text.replace(/[()\\]/g, " ");
  return Buffer.from(
    [
      "%PDF-1.4",
      "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
      "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
      "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj",
      `4 0 obj << /Length ${54 + safeText.length} >> stream`,
      "BT /F1 18 Tf 72 720 Td",
      `(${safeText}) Tj`,
      "ET",
      "endstream endobj",
      "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
      "xref",
      "0 6",
      "0000000000 65535 f ",
      "trailer << /Root 1 0 R /Size 6 >>",
      "startxref",
      "0",
      "%%EOF",
    ].join("\n"),
    "utf8",
  );
}

async function mediaInput(type, mimeType, filePath, durationMs = null) {
  const buffer = await fs.promises.readFile(filePath);
  const stat = await fs.promises.stat(filePath);
  return {
    type,
    fileName: path.basename(filePath),
    mimeType,
    sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
    sizeBytes: stat.size,
    durationMs,
    storagePath: filePath,
    sourceUrl: null,
  };
}

function seedConversation() {
  const now = nowIso();
  let contact = findSmokeWhatsappContact(db, { userId, phone });

  if (contact) {
    db.prepare(
      `UPDATE contacts
       SET name = ?, primary_channel = 'whatsapp', status = 'active', updated_at = ?
       WHERE id = ?`,
    ).run(`Smoke Campaign ${phone}`, now, contact.id);
  } else {
    const result = db
      .prepare(
        `INSERT INTO contacts
         (user_id, name, phone, email, primary_channel, instagram_handle, status, notes, last_message_at, deleted_at, created_at, updated_at)
         VALUES (?, ?, ?, NULL, 'whatsapp', NULL, 'active', ?, NULL, NULL, ?, ?)`,
      )
      .run(
        userId,
        `Smoke Campaign ${phone}`,
        phone,
        "Contato canario para smoke real de campanha multimidia.",
        now,
        now,
      );
    contact = { id: Number(result.lastInsertRowid), phone };
  }

  let conversation = findSmokeWhatsappConversation(db, {
    userId,
    phone,
    contactId: contact.id,
  });

  if (conversation) {
    db.prepare(
      `UPDATE conversations
       SET contact_id = ?, title = ?, updated_at = ?
       WHERE id = ?`,
    ).run(contact.id, `Smoke Campaign ${phone}`, now, conversation.id);
  } else {
    const result = db
      .prepare(
        `INSERT INTO conversations
         (user_id, contact_id, channel, external_thread_id, title, last_message_at, last_preview, unread_count, is_archived, temporary_messages_until, created_at, updated_at)
         VALUES (?, ?, 'whatsapp', ?, ?, NULL, NULL, 0, 0, NULL, ?, ?)`,
      )
      .run(userId, contact.id, `${phone}@c.us`, `Smoke Campaign ${phone}`, now, now);
    conversation = { id: Number(result.lastInsertRowid), contact_id: contact.id };
  }

  backfillSmokeWhatsappIdentity(db, {
    userId,
    phone,
    contactId: Number(contact.id),
    conversationId: Number(conversation.id),
    now,
  });

  return {
    contactId: Number(contact.id),
    conversationId: Number(conversation.id),
  };
}

function cancelStaleSmokeRecipientsIfAllowed() {
  if (process.env.CAMPAIGN_REAL_MEDIA_CANCEL_STALE_SMOKE !== "SIM") {
    return { cancelledRecipients: 0, cancelledJobs: 0 };
  }
  const now = nowIso();
  const rows = db
    .prepare(
      `SELECT cr.id, cr.campaign_id AS campaignId, c.name AS campaignName
       FROM campaign_recipients cr
       JOIN campaigns c ON c.id = cr.campaign_id
       WHERE cr.user_id = ?
         AND cr.phone = ?
         AND cr.status IN ('queued', 'running')
         AND (
           lower(c.name) LIKE '%smoke%'
           OR lower(cr.metadata_json) LIKE '%smoke%'
         )`,
    )
    .all(userId, phone);
  let cancelledRecipients = 0;
  let cancelledJobs = 0;
  for (const row of rows) {
    const jobResult = db
      .prepare(
        `UPDATE jobs
         SET status = 'cancelled',
             last_error = COALESCE(last_error, ?),
             updated_at = ?
         WHERE user_id = ?
           AND type = 'campaign_step'
           AND status IN ('queued', 'claimed', 'running')
           AND payload_json LIKE ?`,
      )
      .run(
        `cancelled stale smoke recipient ${row.id} before ${tokenRoot}`,
        now,
        userId,
        `%"recipientId":${row.id}%`,
      );
    cancelledJobs += jobResult.changes;
    const recipientResult = db
      .prepare(
        `UPDATE campaign_recipients
         SET status = 'cancelled',
             last_error = ?,
             updated_at = ?
         WHERE user_id = ?
           AND id = ?
           AND status IN ('queued', 'running')`,
      )
      .run(
        `cancelled stale smoke recipient before ${tokenRoot}: ${row.campaignName}`,
        now,
        userId,
        row.id,
      );
    cancelledRecipients += recipientResult.changes;
  }
  return { cancelledRecipients, cancelledJobs };
}

function assertNoActivePipelineForPhone() {
  const active = db
    .prepare(
      `SELECT cr.id, cr.status, cr.campaign_id AS campaignId, c.name AS campaignName, cr.last_error AS lastError
       FROM campaign_recipients cr
       JOIN campaigns c ON c.id = cr.campaign_id
       WHERE cr.user_id = ?
         AND cr.phone = ?
         AND cr.status IN ('queued', 'running')
       ORDER BY cr.id DESC`,
    )
    .all(userId, phone);
  if (active.length > 0) {
    throw new Error(
      `active pipeline blocks real smoke for ${phone}: ${compact(active)}. If these are stale smoke rows, rerun with CAMPAIGN_REAL_MEDIA_CANCEL_STALE_SMOKE=SIM`,
    );
  }
}

async function loginApi() {
  const response = await fetch(`${apiUrl}/trpc/auth.login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ json: { email, password } }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.error) {
    throw new Error(`auth.login failed: ${response.status} ${compact(body)}`);
  }

  const setCookies =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie")].filter(Boolean);
  const cookie = setCookies.map((item) => item.split(";")[0]).join("; ");
  const csrfToken = body?.result?.data?.json?.csrfToken;
  if (!cookie || !csrfToken) {
    throw new Error(`auth.login missing cookie/csrf: ${compact(body)}`);
  }

  return { cookie, csrfToken };
}

async function trpcCall(session, procedure, input) {
  const response = await fetch(`${apiUrl}/trpc/${procedure}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: session.cookie,
      "x-csrf-token": session.csrfToken,
    },
    body: JSON.stringify({ json: input }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.error) {
    throw new Error(`${procedure} failed: ${response.status} ${compact(body)}`);
  }
  return body?.result?.data?.json ?? body?.result?.data ?? body;
}

async function uploadAsset(session, input) {
  const result = await trpcCall(session, "media.upload", input);
  if (!result?.asset?.id) {
    throw new Error(`media.upload did not return asset: ${compact(result)}`);
  }
  return result.asset;
}

async function createCampaign(session, assets) {
  const steps = [
    {
      id: "tmp-24",
      label: "Auditoria 24h",
      type: "temporary_messages",
      duration: "24h",
      delaySeconds: 0,
      conditions: [],
    },
    {
      id: "text-main",
      label: "Texto",
      type: "text",
      template: `Smoke campanha texto ${tokens.text}`,
      delaySeconds: 0,
      conditions: [],
    },
    {
      id: "message-main",
      label: "Mensagem",
      type: "text",
      template: `Smoke campanha mensagem ${tokens.message}`,
      delaySeconds: 1,
      conditions: [],
    },
    {
      id: "link-main",
      label: "Link",
      type: "link",
      text: `Smoke campanha link ${tokens.link}`,
      url: `https://nuoma.local/smoke/${encodeURIComponent(tokenRoot)}`,
      previewEnabled: true,
      delaySeconds: 1,
      conditions: [],
    },
    {
      id: "image-main",
      label: "Imagem",
      type: "image",
      mediaAssetId: assets.image.id,
      caption: `Smoke campanha imagem ${tokens.image}`,
      delaySeconds: 1,
      conditions: [],
    },
    {
      id: "video-main",
      label: "Vídeo",
      type: "video",
      mediaAssetId: assets.video.id,
      caption: `Smoke campanha video ${tokens.video}`,
      delaySeconds: 1,
      conditions: [],
    },
    {
      id: "pdf-main",
      label: "PDF",
      type: "document",
      mediaAssetId: assets.document.id,
      fileName: `${tokens.document}.pdf`,
      caption: `Smoke campanha pdf ${tokens.document}`,
      delaySeconds: 1,
      conditions: [],
    },
    {
      id: "audio-long-main",
      label: "Áudio longo",
      type: "voice",
      mediaAssetId: assets.audio.id,
      caption: `Smoke campanha audio longo ${tokens.audioLong}`,
      delaySeconds: 1,
      conditions: [],
    },
  ];

  const result = await trpcCall(session, "campaigns.create", {
    name: `Smoke real campanha multimidia ${tokenRoot}`,
    channel: "whatsapp",
    segment: null,
    steps,
    evergreen: false,
    startsAt: null,
    metadata: {
      source: "v2-full-campaign-real-media-smoke",
      builderVersion: "full-real-media-smoke",
      overlayEnabled: false,
      tokenRoot,
      temporaryMessages: {
        enabled: true,
        beforeSendDuration: "24h",
        afterCompletionDuration: "90d",
        restoreOnFailure: true,
      },
      realSmoke: {
        phone,
        longAudioMs,
        mediaAssetIds: {
          image: assets.image.id,
          video: assets.video.id,
          document: assets.document.id,
          audio: assets.audio.id,
        },
      },
    },
  });
  const campaign = result?.campaign;
  if (!campaign?.id) {
    throw new Error(`campaigns.create did not return campaign: ${compact(result)}`);
  }
  const updated = await trpcCall(session, "campaigns.update", {
    id: campaign.id,
    status: "running",
    startsAt: nowIso(),
  });
  if (!updated?.campaign?.id) {
    throw new Error(`campaigns.update did not return campaign: ${compact(updated)}`);
  }
  return updated.campaign;
}

async function executeCampaign(session, campaignId) {
  const result = await trpcCall(session, "campaigns.execute", {
    campaignId,
    phones: [phone],
    dryRun: false,
    allowedPhone: phone,
    maxRecipients: 1,
  });
  if (result?.dryRun !== false || result?.recipientsCreated !== 1) {
    throw new Error(`campaigns.execute did not create one real recipient: ${compact(result)}`);
  }
  return result;
}

function readRecipient(campaignId) {
  return db
    .prepare(
      `SELECT id, status, campaign_id AS campaignId, phone, current_step_id AS currentStepId,
              last_error AS lastError, metadata_json AS metadataJson, updated_at AS updatedAt
       FROM campaign_recipients
       WHERE user_id = ?
         AND campaign_id = ?
         AND phone = ?
       ORDER BY id DESC
       LIMIT 1`,
    )
    .get(userId, campaignId, phone);
}

function readCampaign(campaignId) {
  const campaign = db
    .prepare(
      `SELECT id, name, status
       FROM campaigns
       WHERE user_id = ?
         AND id = ?`,
    )
    .get(userId, campaignId);
  if (!campaign) {
    throw new Error(`campaign not found: ${campaignId}`);
  }
  return campaign;
}

function readCampaignStepJobs(campaignId, recipientId) {
  return db
    .prepare(
      `SELECT id, type, status, attempts, max_attempts AS maxAttempts, last_error AS lastError,
              completed_at AS completedAt, payload_json AS payloadJson
       FROM jobs
       WHERE user_id = ?
         AND type = 'campaign_step'
         AND payload_json LIKE ?
         AND payload_json LIKE ?
       ORDER BY id ASC`,
    )
    .all(userId, `%"campaignId":${campaignId}%`, `%"recipientId":${recipientId}%`)
    .map((job) => ({
      ...job,
      payload: JSON.parse(job.payloadJson),
    }));
}

function readCompletedStepEvents(campaignId, recipientId) {
  return db
    .prepare(
      `SELECT id, type, payload_json AS payloadJson, created_at AS createdAt
       FROM system_events
       WHERE user_id = ?
         AND type = 'sender.campaign_step.completed'
         AND payload_json LIKE ?
         AND payload_json LIKE ?
       ORDER BY id ASC`,
    )
    .all(userId, `%"campaignId":${campaignId}%`, `%"recipientId":${recipientId}%`)
    .map((event) => ({
      ...event,
      payload: JSON.parse(event.payloadJson),
    }));
}

async function waitCampaignCompleted(campaignId, expectedSteps) {
  const started = Date.now();
  let recipient = null;
  while (Date.now() - started < timeoutMs) {
    recipient = readRecipient(campaignId);
    if (recipient) break;
    await sleep(500);
  }
  if (!recipient) {
    throw new Error(`campaign recipient not found for campaign=${campaignId} phone=${phone}`);
  }

  while (Date.now() - started < timeoutMs) {
    const jobs = readCampaignStepJobs(campaignId, recipient.id);
    const failed = jobs.filter((job) =>
      ["failed", "cancelled", "canceled", "dead"].includes(job.status),
    );
    if (failed.length > 0) {
      throw new Error(
        `campaign step failed: ${failed
          .map((job) => `${job.id}:${job.payload?.step?.id}:${job.status}:${job.lastError}`)
          .join(", ")}`,
      );
    }
    recipient = readRecipient(campaignId);
    const events = readCompletedStepEvents(campaignId, recipient.id);
    const completedStepIds = new Set(events.map((event) => event.payload.stepId));
    const allEventsSeen = expectedSteps.every((stepId) => completedStepIds.has(stepId));
    if (
      jobs.length >= expectedSteps.length &&
      jobs.every((job) => job.status === "completed") &&
      recipient?.status === "completed" &&
      allEventsSeen
    ) {
      return { recipient, jobs, events };
    }
    await sleep(1_000);
  }
  throw new Error(
    `campaign did not complete within ${timeoutMs}ms: recipient=${compact(recipient)} jobs=${compact(
      readCampaignStepJobs(campaignId, recipient.id).map((job) => ({
        id: job.id,
        status: job.status,
        stepId: job.payload?.step?.id,
        error: job.lastError,
      })),
    )}`,
  );
}

function stepEvent(events, stepId) {
  const event = events.find((item) => item.payload.stepId === stepId);
  if (!event) {
    throw new Error(`missing sender.campaign_step.completed event for ${stepId}`);
  }
  return event;
}

function assertCampaignMediaEvidence(events) {
  const text = stepEvent(events, "text-main");
  const message = stepEvent(events, "message-main");
  const link = stepEvent(events, "link-main");
  const image = stepEvent(events, "image-main");
  const video = stepEvent(events, "video-main");
  const document = stepEvent(events, "pdf-main");
  const audio = stepEvent(events, "audio-long-main");

  for (const [label, event] of [
    ["text", text],
    ["message", message],
    ["link", link],
    ["image", image],
    ["video", video],
    ["document", document],
    ["audio", audio],
  ]) {
    if (!event.payload.externalId && label !== "audio") {
      throw new Error(`${label} completed without externalId: ${compact(event.payload)}`);
    }
  }
  if (!audio.payload.externalId || audio.payload.nativeVoiceEvidence !== true) {
    throw new Error(`audio-long missing native voice evidence: ${compact(audio.payload)}`);
  }
  if (audio.payload.mediaAssetId == null) {
    throw new Error(`audio-long missing mediaAssetId: ${compact(audio.payload)}`);
  }
  return { text, message, link, image, video, document, audio };
}

async function writeCdpScreenshot(context, page, targetPath) {
  const client = await context.newCDPSession(page);
  try {
    const result = await client.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
      fromSurface: true,
    });
    fs.writeFileSync(targetPath, Buffer.from(result.data, "base64"));
  } finally {
    await client.detach().catch(() => null);
  }
}

async function captureDesktopScreenshot(targetPath) {
  await execFileAsync("screencapture", ["-x", targetPath], { timeout: 30_000 });
}

async function captureWhatsAppProof({ tokensToFind, audioExternalId }) {
  const browser = await chromium.connectOverCDP(cdpUrl);
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page =
    context.pages().find((item) => item.url().startsWith("https://web.whatsapp.com")) ??
    (await context.newPage());
  const onTargetChat = await page
    .evaluate((expectedPhone) => {
      const normalized = String(expectedPhone || "").replace(/\D/g, "");
      const hrefPhone = new URL(location.href).searchParams.get("phone")?.replace(/\D/g, "") ?? "";
      const text = String(
        document.querySelector("#main header")?.textContent || document.body?.innerText || "",
      );
      return hrefPhone === normalized || text.replace(/\D/g, "").includes(normalized.slice(-8));
    }, phone)
    .catch(() => false);
  if (!onTargetChat) {
    await page.goto(`https://web.whatsapp.com/send?phone=${phone}&app_absent=0`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
  }
  await page.waitForFunction(() => Boolean(document.body?.innerText?.trim()), { timeout: 90_000 });
  await page.keyboard.press("End").catch(() => null);
  await page.waitForTimeout(2_000);

  const seenTokens = new Set();
  let proof = null;
  const started = Date.now();
  while (Date.now() - started < 150_000) {
    proof = await page.evaluate(
      ({ expectedTokens, expectedAudioExternalId }) => {
        function isVisible(node) {
          if (!node) return false;
          const rect = node.getBoundingClientRect();
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            rect.bottom > 0 &&
            rect.right > 0 &&
            rect.top < window.innerHeight &&
            rect.left < window.innerWidth
          );
        }
        const messageNodes = Array.from(
          document.querySelectorAll("#main .message-out, #main .message-in, #main [data-id]"),
        );
        const mainText = String(document.querySelector("#main")?.textContent || "");
        const visibleTokens = expectedTokens.filter((token) =>
          messageNodes.some(
            (node) => isVisible(node) && String(node.textContent || "").includes(token),
          ),
        );
        const loadedTokens = expectedTokens.filter(
          (token) => visibleTokens.includes(token) || mainText.includes(token),
        );
        const audioNode =
          expectedAudioExternalId && window.CSS?.escape
            ? document.querySelector('[data-id="' + CSS.escape(expectedAudioExternalId) + '"]')
            : null;
        const audioText = String(audioNode?.textContent || "");
        const durationMatches = Array.from(audioText.matchAll(/\b(\d{1,2}):(\d{2})\b/g)).map(
          (match) => Number(match[1]) * 60 + Number(match[2]),
        );
        const maxDurationSeconds = durationMatches.length ? Math.max(...durationMatches) : 0;
        const audioEvidence = Boolean(
          audioNode &&
          isVisible(audioNode) &&
          (audioNode.querySelector(
            [
              '[data-icon="audio-play"]',
              '[data-icon="ptt"]',
              '[data-icon="status-v3-ptt"]',
              'button[aria-label*="Play"]',
              'button[aria-label*="Reproduzir"]',
              "[aria-valuemax]",
            ].join(","),
          ) ||
            maxDurationSeconds >= 20),
        );
        return {
          visibleTokens,
          loadedTokens,
          missingTokens: expectedTokens.filter((token) => !loadedTokens.includes(token)),
          audioEvidence,
          maxDurationSeconds,
          bodyTail: String(document.body?.innerText || "").slice(-1800),
        };
      },
      { expectedTokens: tokensToFind, expectedAudioExternalId: audioExternalId },
    );
    for (const token of proof.loadedTokens) {
      seenTokens.add(token);
    }
    proof.missingTokens = tokensToFind.filter((token) => !seenTokens.has(token));
    if (proof.missingTokens.length === 0 && proof.audioEvidence) {
      break;
    }
    if (proof.missingTokens.length > 0) {
      await page.mouse.wheel(0, -1600).catch(() => null);
    }
    await sleep(1_000);
  }
  if (!proof) {
    throw new Error("WhatsApp proof was not evaluated");
  }
  if (proof.missingTokens.length > 0) {
    throw new Error(`WhatsApp proof missing tokens: ${proof.missingTokens.join(", ")}`);
  }
  if (!proof.audioEvidence) {
    throw new Error(`WhatsApp proof missing long audio bubble: ${audioExternalId}`);
  }
  await page.bringToFront();
  await page.waitForTimeout(1_000);
  await captureDesktopScreenshot(screenshots.wpp);
  return {
    ...proof,
    screenshot: screenshots.wpp,
  };
}

async function captureCampaignApp(campaignName) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const session = await loginApi();
    await context.addCookies(cookiesFromSession(session.cookie, webUrl));
    const page = await context.newPage();
    await page.goto(`${webUrl}/campaigns?tab=recipients`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => null);
    await page
      .waitForFunction(
        () => {
          const text = String(document.body?.innerText || "");
          return (
            text.trim().length > 100 &&
            !text.includes("Carregando sessão") &&
            /Campanhas|Destinatarios|Destinatários|Eventos|Falhas|OK/i.test(text)
          );
        },
        { timeout: 30_000 },
      )
      .catch(() => null);
    const search = page
      .locator('input[type="search"], input[placeholder*="Buscar"], input[placeholder*="busca" i]')
      .first();
    if ((await search.count()) > 0) {
      await search.fill(campaignName);
      await page.waitForTimeout(1_000);
    }
    const proof = await page
      .waitForFunction(
        (expectedCampaignName) => {
          const text = String(document.body?.innerText || "");
          return (
            text.includes(expectedCampaignName) &&
            /EVENTOS|Eventos/i.test(text) &&
            /FALHAS|Falhas/i.test(text) &&
            /\bOK\b/i.test(text)
          );
        },
        campaignName,
        { timeout: 30_000 },
      )
      .then(() => true)
      .catch(() => false);
    if (!proof) {
      const bodyTail = String(
        (
          await page
            .locator("body")
            .innerText()
            .catch(() => "")
        ).slice(0, 2400),
      );
      throw new Error(`campaign app recipients proof missing ${campaignName}: ${bodyTail}`);
    }
    await writeCdpScreenshot(page.context(), page, screenshots.app);
  } finally {
    await browser.close();
  }
}

function cookiesFromSession(cookieHeader, url) {
  return cookieHeader
    .split("; ")
    .map((pair) => {
      const [name, ...rest] = pair.split("=");
      return {
        name,
        value: rest.join("="),
        url,
      };
    })
    .filter((cookie) => cookie.name && cookie.value);
}

function assertScreenshot(pathname, label) {
  const stat = fs.statSync(pathname, { throwIfNoEntry: false });
  if (!stat || stat.size <= 0) {
    throw new Error(`${label} screenshot missing or empty: ${pathname}`);
  }
}

async function main() {
  assertRealSendGuards();
  await assertHttpOk(`${apiUrl}/health`, "api");
  await assertHttpOk(`${webUrl}`, "web");
  await assertHttpOk(`${cdpUrl}/json/version`, "cdp");
  let cleanup = { cancelledRecipients: 0, cancelledJobs: 0 };
  let campaign;
  let executeResult = null;
  let imageAsset = { id: "existing" };
  let videoAsset = { id: "existing" };
  let documentAsset = { id: "existing" };
  let audioAsset = { id: "existing" };
  if (proofCampaignId) {
    campaign = readCampaign(proofCampaignId);
  } else {
    cleanup = cancelStaleSmokeRecipientsIfAllowed();
    assertNoActivePipelineForPhone();

    seedConversation();
    const session = await loginApi();
    const files = await generateMediaFiles();
    [imageAsset, videoAsset, audioAsset, documentAsset] = await Promise.all([
      uploadAsset(session, files.image),
      uploadAsset(session, files.video),
      uploadAsset(session, files.audio),
      uploadAsset(session, files.document),
    ]);
    campaign = await createCampaign(session, {
      image: imageAsset,
      video: videoAsset,
      audio: audioAsset,
      document: documentAsset,
    });
    executeResult = await executeCampaign(session, campaign.id);
  }
  const expectedSteps = [
    "tmp-24",
    "text-main",
    "message-main",
    "link-main",
    "image-main",
    "video-main",
    "pdf-main",
    "audio-long-main",
  ];
  const completed = await waitCampaignCompleted(campaign.id, expectedSteps);
  const evidence = assertCampaignMediaEvidence(completed.events);
  const wppProof = await captureWhatsAppProof({
    tokensToFind: [
      tokens.text,
      tokens.message,
      tokens.link,
      tokens.image,
      tokens.video,
      tokens.document,
    ],
    audioExternalId: evidence.audio.payload.externalId,
  });
  await captureCampaignApp(campaign.name);
  assertScreenshot(screenshots.wpp, "WhatsApp");
  assertScreenshot(screenshots.app, "Campaign app");

  console.log(
    [
      "v2-full-campaign-real-media",
      "status=completed",
      `phone=${phone}`,
      `tokenRoot=${tokenRoot}`,
      `campaign=${campaign.id}`,
      `recipient=${completed.recipient.id}`,
      `jobs=${completed.jobs.map((job) => job.id).join(",")}`,
      `steps=${expectedSteps.join(",")}`,
      `imageAsset=${imageAsset.id}`,
      `videoAsset=${videoAsset.id}`,
      `documentAsset=${documentAsset.id}`,
      `audioAsset=${audioAsset.id}`,
      `longAudioMs=${longAudioMs}`,
      `schedulerJobs=${executeResult?.scheduler?.jobsCreated ?? "proof-only"}`,
      `cancelledStaleRecipients=${cleanup.cancelledRecipients}`,
      `cancelledStaleJobs=${cleanup.cancelledJobs}`,
      `wpp=${screenshots.wpp}`,
      `app=${screenshots.app}`,
      `audioNative=${evidence.audio.payload.nativeVoiceEvidence === true ? 1 : 0}`,
      `audioDurationEvent=${evidence.audio.payload.displayDurationSecs ?? "unknown"}`,
      `audioDurationVisual=${wppProof.maxDurationSeconds}`,
      "ig=nao_aplicavel",
    ].join("|"),
  );
}

main()
  .then(() => {
    db.close();
    process.exit(0);
  })
  .catch((error) => {
    db.close();
    console.error(
      `v2-full-campaign-real-media|failed|phone=${phone}|tokenRoot=${tokenRoot}|ig=nao_aplicavel|error=${error.message}`,
    );
    process.exit(1);
  });
