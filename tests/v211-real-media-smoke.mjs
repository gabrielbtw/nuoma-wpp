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
const mediaDir = path.join(dataDir, "smoke-media");
const dbPath = process.env.DATABASE_URL ?? path.join(dataDir, "nuoma-v2.db");
const apiUrl = process.env.API_URL ?? "http://127.0.0.1:3001";
const webUrl = process.env.WEB_URL ?? "http://127.0.0.1:3002";
const cdpUrl = process.env.CDP_URL ?? "http://127.0.0.1:9223";
const email = process.env.SMOKE_EMAIL ?? "admin@nuoma.local";
const password = process.env.SMOKE_PASSWORD ?? "nuoma-dev-admin-123";
const userId = Number(process.env.SMOKE_USER_ID ?? 1);
const phone = process.env.SMOKE_PHONE ?? "5531982066263";
const tokenRoot = process.env.SMOKE_TOKEN ?? `M37-${Date.now()}`;
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS ?? 240_000);

const tokens = {
  text: `${tokenRoot}-TEXT`,
  image: `${tokenRoot}-IMAGE`,
  video: `${tokenRoot}-VIDEO`,
  audio: `${tokenRoot}-AUDIO`,
};

const screenshots = {
  app: path.join(dataDir, "v211-real-media-app.png"),
  text: path.join(dataDir, "v211-real-media-text-wpp.png"),
  image: path.join(dataDir, "v211-real-media-image-wpp.png"),
  video: path.join(dataDir, "v211-real-media-video-wpp.png"),
  audio: path.join(dataDir, "v211-real-media-audio-wpp.png"),
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
    imageColor: `0x${digest.slice(0, 6)}`,
    videoColor: `0x${digest.slice(6, 12)}`,
    audioFrequency: 520 + (parseInt(digest.slice(12, 16), 16) % 520),
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
    timeout: 60_000,
  });
}

async function generateMediaFiles() {
  const imagePath = path.join(mediaDir, `${tokens.image}.jpg`);
  const videoPath = path.join(mediaDir, `${tokens.video}.mp4`);
  const audioPath = path.join(mediaDir, `${tokens.audio}.wav`);
  const seed = mediaSeedParts();

  await runFfmpeg([
    "-f",
    "lavfi",
    "-i",
    `color=c=${seed.imageColor}:s=640x360:d=1`,
    "-frames:v",
    "1",
    imagePath,
  ]);
  await runFfmpeg([
    "-f",
    "lavfi",
    "-i",
    `color=c=${seed.videoColor}:s=320x240:r=15:d=1`,
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=44100:cl=mono",
    "-t",
    "1",
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
    `sine=frequency=${seed.audioFrequency}:duration=1`,
    "-ac",
    "1",
    "-ar",
    "48000",
    "-c:a",
    "pcm_s16le",
    audioPath,
  ]);

  return {
    image: await mediaInput("image", "image/jpeg", imagePath),
    video: await mediaInput("video", "video/mp4", videoPath),
    audio: await mediaInput("audio", "audio/wav", audioPath, 1000),
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
      .run(userId, `Smoke Canary ${phone}`, phone, "Contato canario para smoke real de midia.", now, now);
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
      return job;
    }
    if (["failed", "cancelled", "canceled", "dead"].includes(job.status)) {
      throw new Error(`${label} job ${jobId} ${job.status}: ${job.last_error ?? "no error"}`);
    }
    await sleep(1_000);
  }
  throw new Error(`${label} job ${jobId} timeout after ${timeout}ms`);
}

async function sendAndWait(session, label, procedure, input, eventType) {
  const result = await trpcCall(session, procedure, input);
  const jobId = Number(result?.job?.id ?? result?.jobId ?? result?.id);
  if (!jobId) {
    throw new Error(`${label} did not return job id: ${compact(result)}`);
  }
  await waitJobCompleted(jobId, timeoutMs, label);
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    const event = getSystemEvent(jobId, eventType);
    if (event) {
      return { jobId, event };
    }
    await sleep(500);
  }
  throw new Error(`${label} completed without ${eventType} event`);
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

async function captureWhatsAppProof(label, { tokensToFind = [], audioExternalId = null } = {}) {
  const screenshotPath = screenshots[label];
  if (!screenshotPath) {
    throw new Error(`unknown WhatsApp proof label: ${label}`);
  }
  const browser = await chromium.connectOverCDP(cdpUrl);
  try {
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
    const started = Date.now();
    while (Date.now() - started < 90_000) {
      await page.keyboard.press("End").catch(() => null);
      proof = await page.evaluate(
        ({ expectedTokens, expectedAudioExternalId }) => {
          function isVisible(node) {
            if (!node) return false;
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
          }
          const messageNodes = Array.from(document.querySelectorAll("#main .message-out, #main [data-id]"));
          const visibleTokens = expectedTokens.filter((token) =>
            messageNodes.some((node) => isVisible(node) && String(node.textContent || "").includes(token)),
          );
          const audioNode =
            expectedAudioExternalId && window.CSS?.escape
              ? document.querySelector('[data-id="' + CSS.escape(expectedAudioExternalId) + '"]')
              : null;
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
                  '[aria-valuemax]',
                ].join(","),
              ) ||
                /\\b\\d{1,2}:\\d{2}\\b/.test(String(audioNode.textContent || ""))),
          );
          const bodyText = String(document.body?.innerText || "");
          return {
            visibleTokens,
            missingTokens: expectedTokens.filter((token) => !visibleTokens.includes(token)),
            audioEvidence,
            bodyTail: bodyText.slice(-1500),
          };
        },
        { expectedTokens: tokensToFind, expectedAudioExternalId: audioExternalId },
      );
      if (proof.missingTokens.length === 0 && (!audioExternalId || proof.audioEvidence)) {
        break;
      }
      await sleep(1_000);
    }
    if (!proof) {
      throw new Error(`${label} WhatsApp visual proof was not evaluated`);
    }
    if (proof.missingTokens.length > 0) {
      throw new Error(`${label} WhatsApp visual proof missing tokens: ${proof.missingTokens.join(", ")}`);
    }
    if (audioExternalId && !proof.audioEvidence) {
      throw new Error(`${label} WhatsApp visual proof missing audio bubble: ${audioExternalId}`);
    }
    await page.bringToFront();
    await page.waitForTimeout(1_000);
    await captureDesktopScreenshot(screenshotPath);
    return {
      ...proof,
      screenshot: screenshotPath,
    };
  } finally {
    // The CDP browser is owned by the worker; do not close it from a smoke proof.
  }
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
  const files = await generateMediaFiles();
  const [imageAsset, videoAsset, audioAsset] = await Promise.all([
    uploadAsset(session, files.image),
    uploadAsset(session, files.video),
    uploadAsset(session, files.audio),
  ]);

  const text = await sendAndWait(
    session,
    "text",
    "messages.send",
    { conversationId, body: `Smoke real V2.11 texto ${tokens.text}` },
    "sender.text_message.completed",
  );
  const textProof = await captureWhatsAppProof("text", { tokensToFind: [tokens.text] });
  const image = await sendAndWait(
    session,
    "image",
    "messages.sendMedia",
    { conversationId, mediaAssetId: imageAsset.id, caption: `Smoke real V2.11 imagem ${tokens.image}` },
    "sender.media_message.completed",
  );
  const imageProof = await captureWhatsAppProof("image", { tokensToFind: [tokens.image] });
  const video = await sendAndWait(
    session,
    "video",
    "messages.sendMedia",
    { conversationId, mediaAssetId: videoAsset.id, caption: `Smoke real V2.11 video ${tokens.video}` },
    "sender.media_message.completed",
  );
  const videoProof = await captureWhatsAppProof("video", { tokensToFind: [tokens.video] });
  const audio = await sendAndWait(
    session,
    "audio",
    "messages.sendVoice",
    { conversationId, mediaAssetId: audioAsset.id },
    "sender.voice_message.completed",
  );

  const audioPayload = audio.event.payload;
  const audioNative = audioPayload.nativeVoiceEvidence === true;
  if (!audioPayload.externalId || !audioNative) {
    throw new Error(
      `audio job completed without verified WhatsApp voice bubble: externalId=${audioPayload.externalId ?? "null"} nativeVoiceEvidence=${String(audioPayload.nativeVoiceEvidence)}`,
    );
  }
  const audioProof = await captureWhatsAppProof("audio", { audioExternalId: audioPayload.externalId });
  await captureApp();

  console.log(
    [
      "v211-real-media",
      `phone=${phone}`,
      `tokenRoot=${tokenRoot}`,
      `text=completed:${text.jobId}`,
      `image=completed:${image.jobId}`,
      `video=completed:${video.jobId}`,
      `audio=completed:${audio.jobId}`,
      `audioNative=${audioNative ? 1 : 0}`,
      `imageAsset=${imageAsset.id}`,
      `videoAsset=${videoAsset.id}`,
      `audioAsset=${audioAsset.id}`,
      `textVisual=1`,
      `imageVisual=1`,
      `videoVisual=1`,
      `audioVisual=1`,
      `textWpp=${path.relative(rootDir, textProof.screenshot)}`,
      `imageWpp=${path.relative(rootDir, imageProof.screenshot)}`,
      `videoWpp=${path.relative(rootDir, videoProof.screenshot)}`,
      `audioWpp=${path.relative(rootDir, audioProof.screenshot)}`,
      `app=${path.relative(rootDir, screenshots.app)}`,
      "ig=nao_aplicavel",
    ].join("|"),
  );
}

main().catch((error) => {
  console.error(`v211-real-media|failed|phone=${phone}|tokenRoot=${tokenRoot}|ig=nao_aplicavel|error=${error.message}`);
  process.exit(1);
});
