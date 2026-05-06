import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import Database from "better-sqlite3";
import { chromium } from "playwright";

const execFileAsync = promisify(execFile);
const rootDir = process.cwd();
const dataDir = path.join(rootDir, "data");
const mediaDir = path.join(dataDir, "smoke-media", "real-round-complete");
const dbPath = process.env.DATABASE_URL ?? path.join(dataDir, "nuoma-v2.db");
const apiUrl = process.env.API_URL ?? "http://127.0.0.1:3001";
const webUrl = process.env.WEB_URL ?? "http://127.0.0.1:3002";
const cdpUrl = process.env.CDP_URL ?? "http://127.0.0.1:9223";
const email = process.env.SMOKE_EMAIL ?? "admin@nuoma.local";
const password = process.env.SMOKE_PASSWORD ?? "nuoma-dev-admin-123";
const userId = Number(process.env.SMOKE_USER_ID ?? 1);
const phone = (process.env.SMOKE_PHONE ?? "5531982066263").replace(/\D/g, "");
const tokenRoot = process.env.SMOKE_TOKEN ?? `ROUND-${Date.now()}`;
const replyToken = process.env.REPLY_TOKEN ?? `RX-${tokenRoot}`;
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS ?? 300_000);
const inboundTimeoutMs = Number(process.env.INBOUND_TIMEOUT_MS ?? 600_000);

const tokens = {
  text: `${tokenRoot}-TEXT`,
  photo: `${tokenRoot}-PHOTO`,
  video: `${tokenRoot}-VIDEO`,
  album: `${tokenRoot}-ALBUM5`,
  audio1: `${tokenRoot}-AUDIO1`,
  audio2: `${tokenRoot}-AUDIO2`,
  link: `${tokenRoot}-LINK`,
  emoji: `${tokenRoot}-EMOJI`,
};

const screenshots = {
  app: path.join(dataDir, "v211-real-round-complete-app.png"),
  outbound: path.join(dataDir, "v211-real-round-complete-wpp-outbound.png"),
  inbound: path.join(dataDir, "v211-real-round-complete-wpp-inbound.png"),
};

fs.mkdirSync(mediaDir, { recursive: true });
const db = new Database(dbPath);
db.pragma("busy_timeout = 5000");

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function compact(value) {
  return JSON.stringify(value).replace(/\s+/g, " ");
}

function mediaSeedParts() {
  const digest = crypto.createHash("sha256").update(tokenRoot).digest("hex");
  return {
    photoColor: `0x${digest.slice(0, 6)}`,
    videoColor: `0x${digest.slice(6, 12)}`,
    albumColors: Array.from({ length: 5 }, (_, index) => `0x${digest.slice(12 + index * 4, 18 + index * 4).padEnd(6, "0")}`),
    audioFrequency1: 440 + (parseInt(digest.slice(32, 36), 16) % 360),
    audioFrequency2: 760 + (parseInt(digest.slice(36, 40), 16) % 360),
  };
}

async function assertHttpOk(url, label) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${label} not ok: ${response.status}`);
  }
}

async function runFfmpeg(args) {
  await execFileAsync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], {
    timeout: 90_000,
  });
}

async function generateMediaFiles() {
  const seed = mediaSeedParts();
  const photoPath = path.join(mediaDir, `${tokens.photo}.jpg`);
  const videoPath = path.join(mediaDir, `${tokens.video}.mp4`);
  const audio1Path = path.join(mediaDir, `${tokens.audio1}.wav`);
  const audio2Path = path.join(mediaDir, `${tokens.audio2}.wav`);
  const albumPaths = Array.from({ length: 5 }, (_, index) => path.join(mediaDir, `${tokens.album}-${index + 1}.jpg`));

  await runFfmpeg(["-f", "lavfi", "-i", `color=c=${seed.photoColor}:s=960x1280:d=1`, "-frames:v", "1", photoPath]);
  await runFfmpeg([
    "-f",
    "lavfi",
    "-i",
    `color=c=${seed.videoColor}:s=640x360:r=15:d=2`,
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=44100:cl=mono",
    "-t",
    "2",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    videoPath,
  ]);
  await runFfmpeg(["-f", "lavfi", "-i", `sine=frequency=${seed.audioFrequency1}:duration=2`, "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", audio1Path]);
  await runFfmpeg(["-f", "lavfi", "-i", `sine=frequency=${seed.audioFrequency2}:duration=2`, "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", audio2Path]);
  for (let index = 0; index < albumPaths.length; index += 1) {
    await runFfmpeg(["-f", "lavfi", "-i", `color=c=${seed.albumColors[index]}:s=960x1280:d=1`, "-frames:v", "1", albumPaths[index]]);
  }

  return {
    photo: await mediaInput("image", "image/jpeg", photoPath),
    video: await mediaInput("video", "video/mp4", videoPath),
    audio1: await mediaInput("voice", "audio/wav", audio1Path, 2000),
    audio2: await mediaInput("voice", "audio/wav", audio2Path, 2000),
    album: await Promise.all(albumPaths.map((filePath) => mediaInput("image", "image/jpeg", filePath))),
  };
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
  let contact = db
    .prepare(
      `SELECT * FROM contacts
       WHERE user_id = ? AND deleted_at IS NULL AND phone = ?
       ORDER BY id ASC LIMIT 1`,
    )
    .get(userId, phone);

  if (contact) {
    db.prepare(
      `UPDATE contacts
       SET name = ?, primary_channel = 'whatsapp', status = 'active', updated_at = ?
       WHERE id = ?`,
    ).run(`Smoke Canary ${phone}`, now, contact.id);
  } else {
    const result = db
      .prepare(
        `INSERT INTO contacts
         (user_id, name, phone, email, primary_channel, instagram_handle, status, notes, last_message_at, deleted_at, created_at, updated_at)
         VALUES (?, ?, ?, NULL, 'whatsapp', NULL, 'active', ?, NULL, NULL, ?, ?)`,
      )
      .run(userId, `Smoke Canary ${phone}`, phone, "Contato canario para smoke real completo.", now, now);
    contact = { id: Number(result.lastInsertRowid), phone };
  }

  let conversation = db
    .prepare(
      `SELECT c.*
       FROM conversations c
       LEFT JOIN contacts ct ON ct.id = c.contact_id
       WHERE c.user_id = ?
         AND c.channel = 'whatsapp'
         AND (
           c.contact_id = ?
           OR c.external_thread_id = ?
           OR c.external_thread_id = ?
           OR ct.phone = ?
         )
       ORDER BY c.last_message_at DESC NULLS LAST, c.id ASC
       LIMIT 1`,
    )
    .get(userId, contact.id, phone, `${phone}@c.us`, phone);

  if (conversation) {
    db.prepare(
      `UPDATE conversations
       SET contact_id = ?, title = ?, updated_at = ?
       WHERE id = ?`,
    ).run(contact.id, `Smoke Canary ${phone}`, now, conversation.id);
  } else {
    const result = db
      .prepare(
        `INSERT INTO conversations
         (user_id, contact_id, channel, external_thread_id, title, last_message_at, last_preview, unread_count, is_archived, temporary_messages_until, created_at, updated_at)
         VALUES (?, ?, 'whatsapp', ?, ?, NULL, NULL, 0, 0, NULL, ?, ?)`,
      )
      .run(userId, contact.id, `${phone}@c.us`, `Smoke Canary ${phone}`, now, now);
    conversation = { id: Number(result.lastInsertRowid), contact_id: contact.id };
  }

  return { contactId: Number(contact.id), conversationId: Number(conversation.id) };
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

function enqueueDirectAlbumJob(conversationId, assets, caption) {
  const now = nowIso();
  const payload = JSON.stringify({
    conversationId,
    phone,
    mediaAssetId: assets[0].id,
    mediaAssetIds: assets.map((asset) => asset.id),
    mediaType: "image",
    caption,
    source: "v211-real-round-complete",
    tokenRoot,
  });
  const result = db
    .prepare(
      `INSERT INTO jobs (
        user_id, type, status, payload_json, priority, scheduled_at, claimed_at,
        claimed_by, attempts, max_attempts, created_at, updated_at
      )
      VALUES (
        ?, 'send_media', 'queued', ?, 4, ?, NULL,
        NULL, 0, 3, ?, ?
      )`,
    )
    .run(userId, payload, now, now, now);
  return Number(result.lastInsertRowid);
}

function getJob(id) {
  return db
    .prepare(
      `SELECT id, type, status, attempts, last_error, completed_at, payload_json
       FROM jobs WHERE id = ?`,
    )
    .get(id);
}

function getSystemEvent(jobId, eventType) {
  const row = db
    .prepare(
      `SELECT id, type, payload_json, created_at
       FROM system_events
       WHERE type = ? AND payload_json LIKE ?
       ORDER BY id DESC LIMIT 1`,
    )
    .get(eventType, `%"jobId":${jobId}%`);
  if (!row) return null;
  return { ...row, payload: JSON.parse(row.payload_json) };
}

async function waitJobCompleted(jobId, timeout, label) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const job = getJob(jobId);
    if (!job) {
      throw new Error(`${label} job ${jobId} disappeared`);
    }
    if (job.status === "completed") {
      console.log(`v211-real-round-complete|stage=job_completed|label=${label}|jobId=${jobId}|ig=nao_aplicavel`);
      return job;
    }
    if (["failed", "cancelled", "canceled", "dead"].includes(job.status)) {
      throw new Error(`${label} job ${jobId} ${job.status}: ${job.last_error ?? "no error"}`);
    }
    await sleep(1_000);
  }
  throw new Error(`${label} job ${jobId} timeout after ${timeout}ms`);
}

async function sendAndWait(session, label, procedure, input, eventType, timeout = timeoutMs) {
  const result = await trpcCall(session, procedure, input);
  const jobId = Number(result?.job?.id ?? result?.jobId ?? result?.id);
  if (!jobId) {
    throw new Error(`${label} did not return job id: ${compact(result)}`);
  }
  await waitJobCompleted(jobId, timeout, label);
  return waitForSystemEvent(jobId, eventType, label);
}

async function waitForSystemEvent(jobId, eventType, label) {
  const started = Date.now();
  while (Date.now() - started < 45_000) {
    const event = getSystemEvent(jobId, eventType);
    if (event) {
      return { jobId, event };
    }
    await sleep(500);
  }
  throw new Error(`${label} completed without ${eventType} event`);
}

function enqueueInboundSync(token) {
  const now = nowIso();
  const payload = JSON.stringify({ phone, smoke: "v211-real-round-complete", token });
  const result = db
    .prepare(
      `INSERT INTO jobs (
        user_id, type, status, payload_json, priority, scheduled_at, claimed_at,
        claimed_by, attempts, max_attempts, created_at, updated_at
      )
      VALUES (
        ?, 'sync_inbox_force', 'queued', ?, 0, ?, NULL,
        NULL, 0, 3, ?, ?
      )`,
    )
    .run(userId, payload, now, now, now);
  return Number(result.lastInsertRowid);
}

function countMessages(direction, token, contentType = null) {
  return Number(
    db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM messages
         WHERE user_id = ?
           AND direction = ?
           AND (? IS NULL OR content_type = ?)
           AND (? IS NULL OR body LIKE ?)
           AND created_at >= datetime('now', '-30 minutes')`,
      )
      .get(userId, direction, contentType, contentType, token ? `%${token}%` : null, token ? `%${token}%` : null)?.count ?? 0,
  );
}

async function waitForMessage(direction, token, timeout) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const syncJobId = enqueueInboundSync(token);
    await waitJobCompleted(syncJobId, 180_000, `sync_${direction}`);
    if (countMessages(direction, token) > 0) {
      return true;
    }
    await sleep(5_000);
  }
  return false;
}

function activeSendJobsCount() {
  return Number(
    db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM jobs
         WHERE user_id = ?
           AND type IN ('send_message', 'send_media', 'send_voice', 'send_document')
           AND status IN ('queued', 'claimed', 'running')`,
      )
      .get(userId)?.count ?? 0,
  );
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

async function captureWhatsAppProof(label, { tokensToFind = [], audioExternalIds = [] } = {}) {
  const screenshotPath = screenshots[label];
  if (!screenshotPath) {
    throw new Error(`unknown WhatsApp proof label: ${label}`);
  }
  const browser = await chromium.connectOverCDP(cdpUrl);
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = context.pages().find((item) => item.url().startsWith("https://web.whatsapp.com")) ?? (await context.newPage());
  const onTargetChat = await page
    .evaluate((expectedPhone) => {
      const normalized = String(expectedPhone || "").replace(/\D/g, "");
      const hrefPhone = new URL(location.href).searchParams.get("phone")?.replace(/\D/g, "") ?? "";
      const text = String(document.querySelector("#main header")?.textContent || document.body?.innerText || "");
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
  let proof = null;
  const seenTokens = new Set();
  const started = Date.now();
  while (Date.now() - started < 120_000) {
    proof = await page.evaluate(
      ({ expectedTokens, expectedAudioExternalIds }) => {
        function isVisible(node) {
          if (!node) return false;
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
        }
        const messageNodes = Array.from(document.querySelectorAll("#main .message-out, #main .message-in, #main [data-id]"));
        const visibleTokens = expectedTokens.filter((token) =>
          messageNodes.some((node) => isVisible(node) && String(node.textContent || "").includes(token)),
        );
        const audioEvidence = expectedAudioExternalIds.map((externalId) => {
          const audioNode =
            externalId && window.CSS?.escape ? document.querySelector('[data-id="' + CSS.escape(externalId) + '"]') : null;
          return Boolean(
            audioNode &&
              isVisible(audioNode) &&
              (audioNode.querySelector(
                [
                  '[data-icon="audio-play"]',
                  '[data-icon="ptt"]',
                  '[data-icon="status-v3-ptt"]',
                  'button[aria-label*="Play"]',
                  'button[aria-label*="Reproduzir"]',
                  '[aria-valuemax]',
                ].join(","),
              ) ||
                /\\b\\d{1,2}:\\d{2}\\b/.test(String(audioNode.textContent || ""))),
          );
        });
        return {
          visibleTokens,
          missingTokens: expectedTokens.filter((token) => !visibleTokens.includes(token)),
          audioEvidence,
        };
      },
      { expectedTokens: tokensToFind, expectedAudioExternalIds: audioExternalIds },
    );
    for (const token of proof.visibleTokens) {
      seenTokens.add(token);
    }
    proof.missingTokens = tokensToFind.filter((token) => !seenTokens.has(token));
    if (proof.missingTokens.length === 0 && proof.audioEvidence.every(Boolean)) {
      break;
    }
    if (proof.missingTokens.length > 0) {
      await page.mouse.wheel(0, -1400).catch(() => null);
    }
    await sleep(1_000);
  }
  if (!proof) {
    throw new Error(`${label} WhatsApp visual proof was not evaluated`);
  }
  if (proof.missingTokens.length > 0) {
    throw new Error(`${label} WhatsApp visual proof missing tokens: ${proof.missingTokens.join(", ")}`);
  }
  if (!proof.audioEvidence.every(Boolean)) {
    throw new Error(`${label} WhatsApp visual proof missing audio bubble`);
  }
  await page.bringToFront();
  await page.waitForTimeout(1_000);
  await captureDesktopScreenshot(screenshotPath);
  return {
    ...proof,
    screenshot: screenshotPath,
  };
}

async function captureApp() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    await page.goto(`${webUrl}/login`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    const emailInput = page.locator('input[type="email"], input[name="email"]').first();
    const passwordInput = page.locator('input[type="password"], input[name="password"]').first();
    if ((await emailInput.count()) > 0 && (await passwordInput.count()) > 0) {
      await emailInput.fill(email);
      await passwordInput.fill(password);
      await page.locator('button[type="submit"], button:has-text("Entrar")').first().click();
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => null);
    }
    await page.goto(`${webUrl}/inbox`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => null);
    const search = page.locator('input[type="search"], input[placeholder*="Buscar"], input[placeholder*="busca" i]').first();
    if ((await search.count()) > 0) {
      await search.fill(phone);
      await page.waitForTimeout(1_000);
    }
    await writeCdpScreenshot(page.context(), page, screenshots.app);
  } finally {
    await browser.close();
  }
}

async function main() {
  await assertHttpOk(`${apiUrl}/health`, "api");
  await assertHttpOk(`${webUrl}`, "web");
  const { conversationId } = seedConversation();
  const session = await loginApi();
  const activeBefore = activeSendJobsCount();
  const mediaFiles = await generateMediaFiles();
  const photoAsset = await uploadAsset(session, mediaFiles.photo);
  const videoAsset = await uploadAsset(session, mediaFiles.video);
  const audio1Asset = await uploadAsset(session, mediaFiles.audio1);
  const audio2Asset = await uploadAsset(session, mediaFiles.audio2);
  const albumAssets = [];
  for (const albumInput of mediaFiles.album) {
    albumAssets.push(await uploadAsset(session, albumInput));
  }

  const results = [];
  results.push(await sendAndWait(session, "text", "messages.send", { conversationId, body: `Smoke texto real ${tokens.text}` }, "sender.text_message.completed"));
  results.push(await sendAndWait(session, "photo", "messages.sendMedia", { conversationId, mediaAssetId: photoAsset.id, caption: `Smoke texto com foto ${tokens.photo}` }, "sender.media_message.completed"));
  results.push(await sendAndWait(session, "video", "messages.sendMedia", { conversationId, mediaAssetId: videoAsset.id, caption: `Smoke texto com video ${tokens.video}` }, "sender.media_message.completed"));
  const albumJobId = enqueueDirectAlbumJob(conversationId, albumAssets, `Smoke envio de 5 fotos juntas ${tokens.album}`);
  await waitJobCompleted(albumJobId, timeoutMs, "album5");
  const albumResult = await waitForSystemEvent(albumJobId, "sender.media_message.completed", "album5");
  if (albumResult.event.payload.mediaCount !== 5) {
    throw new Error(`album5_media_count_invalid:${albumResult.event.payload.mediaCount ?? "null"}`);
  }
  if (albumResult.event.payload.sentByInternalFallback === true) {
    throw new Error("album5_sent_by_single_file_internal_fallback");
  }
  if ((albumResult.event.payload.previewAttachmentCount ?? 0) < 5) {
    throw new Error(`album5_preview_attachment_count_invalid:${albumResult.event.payload.previewAttachmentCount ?? "null"}`);
  }
  results.push(albumResult);
  results.push(await sendAndWait(session, "audio1", "messages.sendVoice", { conversationId, mediaAssetId: audio1Asset.id }, "sender.voice_message.completed", timeoutMs));
  results.push(await sendAndWait(session, "audio2", "messages.sendVoice", { conversationId, mediaAssetId: audio2Asset.id }, "sender.voice_message.completed", timeoutMs));
  results.push(await sendAndWait(session, "link", "messages.send", { conversationId, body: `Smoke link ${tokens.link} https://nuoma.local/smoke?token=${tokenRoot}` }, "sender.text_message.completed"));
  results.push(await sendAndWait(session, "emoji", "messages.send", { conversationId, body: `Smoke emoji ${tokens.emoji} ${String.fromCodePoint(0x1f680)} ${String.fromCodePoint(0x1f44d)}` }, "sender.text_message.completed"));

  const dbChecks = {
    text: countMessages("outbound", tokens.text, "text"),
    photo: countMessages("outbound", tokens.photo, "image"),
    video: countMessages("outbound", tokens.video, "video"),
    album: countMessages("outbound", tokens.album, "image"),
    audio: countMessages("outbound", null, "voice") + countMessages("outbound", null, "audio"),
    link: countMessages("outbound", tokens.link, "text"),
    emoji: countMessages("outbound", tokens.emoji, "text"),
  };
  const missingDb = Object.entries(dbChecks)
    .filter(([key, count]) => (key === "audio" ? count < 2 : count < 1))
    .map(([key, count]) => `${key}:${count}`);
  if (missingDb.length > 0) {
    throw new Error(`db_update_missing:${missingDb.join(",")}`);
  }

  const audioExternalIds = results
    .filter((result) => result.event.type === "sender.voice_message.completed")
    .map((result) => result.event.payload.externalId)
    .filter(Boolean);
  const outboundProof = await captureWhatsAppProof("outbound", {
    tokensToFind: [tokens.text, tokens.photo, tokens.video, tokens.album, tokens.link, tokens.emoji],
    audioExternalIds,
  });
  await captureApp();

  console.log(
    [
      "v211-real-round-complete",
      "stage=waiting_inbound",
      `phone=${phone}`,
      `replyToken=${replyToken}`,
      `timeoutMs=${inboundTimeoutMs}`,
      "instruction=envie este token do celular para o WhatsApp Business",
      "ig=nao_aplicavel",
    ].join("|"),
  );
  const inboundReceived = await waitForMessage("inbound", replyToken, inboundTimeoutMs);
  if (!inboundReceived) {
    throw new Error(`inbound reply with token ${replyToken} was not received within ${inboundTimeoutMs}ms`);
  }
  const inboundProof = await captureWhatsAppProof("inbound", { tokensToFind: [replyToken] });
  const activeAfter = activeSendJobsCount();

  console.log(
    [
      "v211-real-round-complete",
      "stage=complete",
      `phone=${phone}`,
      `tokenRoot=${tokenRoot}`,
      `replyToken=${replyToken}`,
      `jobs=${results.map((result) => result.jobId).join(",")}`,
      `db=${JSON.stringify(dbChecks)}`,
      `activeSendJobsBefore=${activeBefore}`,
      `activeSendJobsAfter=${activeAfter}`,
      `app=${path.relative(rootDir, screenshots.app)}`,
      `wppOutboundShot=${path.relative(rootDir, outboundProof.screenshot)}`,
      `wppInboundShot=${path.relative(rootDir, inboundProof.screenshot)}`,
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
    console.error(`v211-real-round-complete|failed|phone=${phone}|tokenRoot=${tokenRoot}|replyToken=${replyToken}|ig=nao_aplicavel|error=${error.message}`);
    process.exit(1);
  });
