import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { chromium, type BrowserContext, type Locator, type Page } from "playwright";

const execFileAsync = promisify(execFile);

const EXPERIMENT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(EXPERIMENT_ROOT, "../..");
const FIXTURES_DIR = path.join(EXPERIMENT_ROOT, "fixtures");
const PAYLOADS_DIR = path.join(EXPERIMENT_ROOT, "payloads");
const SCREENSHOTS_DIR = path.join(EXPERIMENT_ROOT, "screenshots");

const ALLOWED_TARGET_PHONE = "5531982066263";
const SAMPLE_RATE = 48_000;
const CHANNELS = 1;
const BIT_DEPTH = 16;
const BYTES_PER_SAMPLE = BIT_DEPTH / 8;
const DEFAULT_DURATIONS = [3, 30, 120];

type Mode = "generate-only" | "dry-run" | "send";

type CliOptions = {
  mode: Mode;
  durations: number[];
  targetPhone: string;
  waUrl: string;
  profileDir: string;
  cdpPort: number;
  channel: string;
  headless: boolean;
  keepBrowser: boolean;
};

type DurationProbe = {
  source: string;
  seconds: number;
};

type WavInfo = {
  riff: string;
  wave: string;
  fmt: string;
  audioFormat: number;
  channels: number;
  sampleRate: number;
  byteRate: number;
  blockAlign: number;
  bitsPerSample: number;
  dataTag: string;
  dataSize: number;
  durationSecs: number;
  headerHex: string;
};

type PreparedAudio = {
  label: string;
  requestedDurationSecs: number;
  fixturePath: string;
  snapshotPath: string;
  metadataPath: string;
  sha256: string;
  wavInfo: WavInfo;
  ffprobe: DurationProbe;
  ffprobeErrorMs: number;
};

type SendResult = {
  label: string;
  delivered: boolean;
  status: string;
  injectionConsumed: boolean;
  nativeVoiceEvidence: boolean;
  displayDurationSecs: number | null;
  displayErrorMs: number | null;
  bubbleText: string;
};

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value == null || value.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function normalizePhone(value: string) {
  return value.replace(/\D/g, "");
}

function resolveRepoPath(value: string | undefined, fallback: string) {
  const target = value?.trim() || fallback;
  return path.isAbsolute(target) ? target : path.resolve(REPO_ROOT, target);
}

function parseOptions(argv: string[]): CliOptions {
  let mode: Mode = "dry-run";
  let durations = DEFAULT_DURATIONS;
  let targetPhone = process.env.TARGET_PHONE ?? "";
  let waUrl = process.env.WA_URL ?? "https://web.whatsapp.com";
  let profileDir = resolveRepoPath(process.env.CHROMIUM_PROFILE_DIR, "storage/chromium-profile/whatsapp");
  let cdpPort = Number(process.env.SPIKE3_CDP_PORT ?? "9233");
  let channel = process.env.SPIKE3_CHROMIUM_CHANNEL ?? process.env.CHROMIUM_CHANNEL ?? "chrome";
  let headless = parseBoolean(process.env.CHROMIUM_HEADLESS, false);
  let keepBrowser = false;

  for (const arg of argv) {
    if (arg === "--generate-only") mode = "generate-only";
    else if (arg === "--dry-run") mode = "dry-run";
    else if (arg === "--send") mode = "send";
    else if (arg === "--headless") headless = true;
    else if (arg === "--headed") headless = false;
    else if (arg === "--keep-browser") keepBrowser = true;
    else if (arg.startsWith("--durations=")) {
      durations = arg
        .slice("--durations=".length)
        .split(",")
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isFinite(value) && value > 0);
    } else if (arg.startsWith("--target=")) {
      targetPhone = arg.slice("--target=".length);
    } else if (arg.startsWith("--wa-url=")) {
      waUrl = arg.slice("--wa-url=".length);
    } else if (arg.startsWith("--profile-dir=")) {
      profileDir = resolveRepoPath(arg.slice("--profile-dir=".length), "storage/chromium-profile/whatsapp");
    } else if (arg.startsWith("--cdp-port=")) {
      cdpPort = Number(arg.slice("--cdp-port=".length));
    } else if (arg.startsWith("--channel=")) {
      channel = arg.slice("--channel=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (durations.length === 0) {
    throw new Error("At least one positive duration is required");
  }
  if (!Number.isInteger(cdpPort) || cdpPort < 1 || cdpPort > 65_535) {
    throw new Error(`Invalid CDP port: ${cdpPort}`);
  }

  return {
    mode,
    durations,
    targetPhone: normalizePhone(targetPhone),
    waUrl,
    profileDir,
    cdpPort,
    channel,
    headless,
    keepBrowser
  };
}

async function ensureDirectories() {
  await fs.mkdir(FIXTURES_DIR, { recursive: true });
  await fs.mkdir(PAYLOADS_DIR, { recursive: true });
  await fs.mkdir(SCREENSHOTS_DIR, { recursive: true });
}

function durationLabel(durationSecs: number) {
  return `${String(durationSecs).replace(".", "p")}s`;
}

function createSineWav(durationSecs: number, frequencyHz: number) {
  const frameCount = Math.round(durationSecs * SAMPLE_RATE);
  const dataSize = frameCount * CHANNELS * BYTES_PER_SAMPLE;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(CHANNELS, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE, 28);
  buffer.writeUInt16LE(CHANNELS * BYTES_PER_SAMPLE, 32);
  buffer.writeUInt16LE(BIT_DEPTH, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);

  for (let frame = 0; frame < frameCount; frame += 1) {
    const sample = Math.sin((2 * Math.PI * frequencyHz * frame) / SAMPLE_RATE);
    const scaled = Math.max(-1, Math.min(1, sample * 0.3));
    buffer.writeInt16LE(Math.round(scaled * 32767), 44 + frame * BYTES_PER_SAMPLE);
  }

  return buffer;
}

function inspectWav(buffer: Buffer): WavInfo {
  if (buffer.length < 44) {
    throw new Error(`WAV buffer too small: ${buffer.length} bytes`);
  }

  const info: WavInfo = {
    riff: buffer.toString("ascii", 0, 4),
    wave: buffer.toString("ascii", 8, 12),
    fmt: buffer.toString("ascii", 12, 16),
    audioFormat: buffer.readUInt16LE(20),
    channels: buffer.readUInt16LE(22),
    sampleRate: buffer.readUInt32LE(24),
    byteRate: buffer.readUInt32LE(28),
    blockAlign: buffer.readUInt16LE(32),
    bitsPerSample: buffer.readUInt16LE(34),
    dataTag: buffer.toString("ascii", 36, 40),
    dataSize: buffer.readUInt32LE(40),
    durationSecs: buffer.readUInt32LE(40) / (SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE),
    headerHex: buffer.subarray(0, 44).toString("hex")
  };

  if (info.riff !== "RIFF" || info.wave !== "WAVE" || info.fmt !== "fmt " || info.dataTag !== "data") {
    throw new Error(`Invalid WAV container header: ${JSON.stringify(info)}`);
  }
  if (info.audioFormat !== 1) {
    throw new Error(`Expected PCM format 1, got ${info.audioFormat}`);
  }
  if (info.channels !== CHANNELS || info.sampleRate !== SAMPLE_RATE || info.bitsPerSample !== BIT_DEPTH) {
    throw new Error(
      `Expected ${SAMPLE_RATE}Hz mono ${BIT_DEPTH}-bit, got ${info.sampleRate}Hz ${info.channels}ch ${info.bitsPerSample}-bit`
    );
  }

  return info;
}

async function probeDuration(audioPath: string): Promise<DurationProbe> {
  const ffprobePaths = ["/opt/homebrew/bin/ffprobe", "/usr/local/bin/ffprobe", "ffprobe"];
  for (const ffprobeBin of ffprobePaths) {
    try {
      const { stdout } = await execFileAsync(
        ffprobeBin,
        ["-i", audioPath, "-show_entries", "format=duration", "-v", "quiet", "-of", "csv=p=0"],
        { timeout: 10_000 }
      );
      const parsed = Number.parseFloat(stdout.trim());
      if (Number.isFinite(parsed) && parsed > 0) {
        return { source: ffprobeBin, seconds: parsed };
      }
    } catch {
      // Keep the V1 behavior: try the next binary path.
    }
  }

  try {
    const { stdout } = await execFileAsync("afinfo", [audioPath], { timeout: 10_000 });
    const match = stdout.match(/estimated duration:\s*([\d.]+)/i);
    const parsed = match ? Number.parseFloat(match[1] ?? "") : NaN;
    if (Number.isFinite(parsed) && parsed > 0) {
      return { source: "afinfo", seconds: parsed };
    }
  } catch {
    // No macOS fallback available.
  }

  throw new Error(`Could not detect audio duration for ${audioPath}`);
}

async function writeJson(filePath: string, value: unknown) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function preparePayloads(durations: number[]) {
  await ensureDirectories();

  const prepared: PreparedAudio[] = [];
  for (const [index, durationSecs] of durations.entries()) {
    const label = `voice-${durationLabel(durationSecs)}`;
    const frequencyHz = 440 + index * 110;
    const fixturePath = path.join(FIXTURES_DIR, `${label}.wav`);
    const snapshotPath = path.join(PAYLOADS_DIR, `${label}.bin`);
    const metadataPath = path.join(PAYLOADS_DIR, `${label}.json`);

    const wavBuffer = createSineWav(durationSecs, frequencyHz);
    const wavInfo = inspectWav(wavBuffer);
    await fs.writeFile(fixturePath, wavBuffer);
    await fs.writeFile(snapshotPath, wavBuffer);

    const ffprobe = await probeDuration(fixturePath);
    const ffprobeErrorMs = Math.abs(ffprobe.seconds - durationSecs) * 1000;
    if (ffprobeErrorMs > 50) {
      throw new Error(`${label}: ffprobe duration error ${ffprobeErrorMs.toFixed(3)}ms exceeds 50ms`);
    }

    const sha256 = createHash("sha256").update(wavBuffer).digest("hex");
    const preparedAudio: PreparedAudio = {
      label,
      requestedDurationSecs: durationSecs,
      fixturePath,
      snapshotPath,
      metadataPath,
      sha256,
      wavInfo,
      ffprobe,
      ffprobeErrorMs
    };

    await writeJson(metadataPath, {
      generatedAt: new Date().toISOString(),
      label,
      requestedDurationSecs: durationSecs,
      source: "deterministic-sine-wave",
      frequencyHz,
      fixtureFile: path.relative(EXPERIMENT_ROOT, fixturePath),
      snapshotFile: path.relative(EXPERIMENT_ROOT, snapshotPath),
      sha256,
      ffprobe,
      ffprobeErrorMs,
      wav: wavInfo
    });

    prepared.push(preparedAudio);
  }

  return prepared;
}

function printPreparedSummary(prepared: PreparedAudio[]) {
  for (const item of prepared) {
    console.log(
      [
        item.label,
        `${item.requestedDurationSecs}s`,
        `ffprobe=${item.ffprobe.seconds.toFixed(6)}s`,
        `error=${item.ffprobeErrorMs.toFixed(3)}ms`,
        `${item.wavInfo.sampleRate}Hz`,
        `${item.wavInfo.channels}ch`,
        `${item.wavInfo.bitsPerSample}-bit`,
        `sha256=${item.sha256.slice(0, 12)}`
      ].join(" | ")
    );
  }
}

async function installVoiceInitScript(page: Page) {
  await page.addInitScript(() => {
    type VoiceWindow = typeof globalThis & {
      __nuomaVoiceInitInstalled?: boolean;
      __nuomaVoiceWavBase64?: string | null;
      __nuomaVoiceLastInjection?: {
        consumedAt: string;
        byteLength: number;
        sampleRate: number;
      } | null;
      webkitAudioContext?: typeof AudioContext;
    };

    const w = globalThis as VoiceWindow;
    if (w.__nuomaVoiceInitInstalled) return;
    w.__nuomaVoiceInitInstalled = true;

    const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints: MediaStreamConstraints) => {
      const b64Data = w.__nuomaVoiceWavBase64;
      if (constraints?.audio && b64Data) {
        w.__nuomaVoiceWavBase64 = null;

        const binaryStr = w.atob(b64Data);
        const bytes = new Uint8Array(binaryStr.length);
        for (let index = 0; index < binaryStr.length; index += 1) {
          bytes[index] = binaryStr.charCodeAt(index);
        }

        const AudioCtx = w.AudioContext || w.webkitAudioContext;
        const audioCtx = new AudioCtx({ sampleRate: 48000 });
        if (audioCtx.state === "suspended") {
          await audioCtx.resume();
        }

        const audioBuffer = await audioCtx.decodeAudioData(bytes.buffer.slice(0));
        const source = audioCtx.createBufferSource();
        source.buffer = audioBuffer;
        const dest = audioCtx.createMediaStreamDestination();
        source.connect(dest);
        source.start(0);

        w.__nuomaVoiceLastInjection = {
          consumedAt: new Date().toISOString(),
          byteLength: bytes.length,
          sampleRate: audioBuffer.sampleRate
        };

        return dest.stream;
      }

      return originalGetUserMedia(constraints);
    };
  });
}

async function setVoicePayload(page: Page, wavPath: string) {
  const wavBase64 = (await fs.readFile(wavPath)).toString("base64");
  await page.evaluate((b64) => {
    const w = globalThis as typeof globalThis & {
      __nuomaVoiceWavBase64?: string | null;
      __nuomaVoiceLastInjection?: unknown;
    };
    w.__nuomaVoiceWavBase64 = b64;
    w.__nuomaVoiceLastInjection = null;
  }, wavBase64);
}

async function waitForTruthy<T>(label: string, timeoutMs: number, task: () => Promise<T | null | false>) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await task();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function isLikelyLoginScreen(page: Page) {
  const qrVisible = await page
    .locator("canvas[aria-label*='Scan'], canvas[aria-label*='Escaneie'], [data-testid='qrcode']")
    .first()
    .isVisible()
    .catch(() => false);
  if (qrVisible) return true;

  return page
    .getByText(/use whatsapp on your computer|usar o whatsapp|conectar com número de telefone/i)
    .first()
    .isVisible()
    .catch(() => false);
}

async function waitForChatReady(page: Page) {
  await page.getByText(/iniciando conversa/i).first().waitFor({ state: "hidden", timeout: 20_000 }).catch(() => null);

  await waitForTruthy("WhatsApp chat composer", 60_000, async () => {
    if (await isLikelyLoginScreen(page)) {
      throw new Error("WhatsApp profile is not authenticated; QR/login screen is visible");
    }

    const startingConversationModal = await page
      .getByText(/iniciando conversa/i)
      .first()
      .isVisible()
      .catch(() => false);
    if (startingConversationModal) {
      return null;
    }

    const composer = page.locator("footer [contenteditable='true']").first();
    if (await composer.isVisible().catch(() => false)) {
      return composer;
    }
    return null;
  });
}

async function firstVisibleLocator(label: string, locators: Locator[]) {
  for (const locator of locators) {
    if ((await locator.count().catch(() => 0)) > 0 && (await locator.first().isVisible().catch(() => false))) {
      return locator.first();
    }
  }
  throw new Error(`Could not find visible ${label}`);
}

async function saveScreenshot(page: Page, label: string) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `${timestamp}-${label}.png`) }).catch(() => null);
}

async function launchWhatsAppContext(options: CliOptions) {
  await fs.mkdir(options.profileDir, { recursive: true });

  const extraArgs = [
    "--disable-dev-shm-usage",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--window-position=-2000,-2000",
    "--window-size=1512,920",
    "--force-device-scale-factor=1",
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${options.cdpPort}`
  ];

  const context = await chromium.launchPersistentContext(options.profileDir, {
    channel: options.channel,
    headless: options.headless,
    viewport: null,
    permissions: ["microphone"],
    args: extraArgs
  });

  await context.grantPermissions(["microphone"], { origin: options.waUrl }).catch(() => null);
  const page = context.pages()[0] ?? (await context.newPage());
  return { context, page };
}

async function waitForInjectionConsumed(page: Page) {
  return waitForTruthy("voice payload consumption", 8_000, async () => {
    const injection = await page
      .evaluate(() => {
        const w = globalThis as typeof globalThis & {
          __nuomaVoiceLastInjection?: unknown;
        };
        return w.__nuomaVoiceLastInjection ?? null;
      })
      .catch(() => null);
    return injection ? true : null;
  });
}

async function pollDeliveryStatus(page: Page) {
  let lastStatus = "not-polled";
  let delivered = false;

  for (let poll = 0; poll < 20; poll += 1) {
    await page.waitForTimeout(2_000);
    const status = await page
      .evaluate(() => {
        const doc = globalThis.document;
        const messages = doc.querySelectorAll(".message-out");
        const last = messages[messages.length - 1];
        if (!last) return "no-message";
        if (last.querySelector("span[data-icon='msg-dblcheck']")) return "delivered";
        if (last.querySelector("span[data-icon='msg-check']")) return "sent";
        if (last.querySelector("span[data-icon='msg-time']")) return "pending";
        return "unknown";
      })
      .catch(() => "error");
    lastStatus = status;
    if (status === "delivered") {
      delivered = true;
      break;
    }
  }

  return { delivered, status: lastStatus };
}

async function inspectLastOutgoingBubble(page: Page) {
  return page
    .evaluate(() => {
      const doc = globalThis.document;
      const messages = doc.querySelectorAll(".message-out");
      const last = messages[messages.length - 1];
      if (!last) {
        return { found: false, nativeVoiceEvidence: false, text: "" };
      }

      const text = (last.textContent || "").trim().slice(0, 240);
      const nativeVoiceEvidence = Boolean(
        last.querySelector(
          [
            "audio",
            "span[data-icon='audio-play']",
            "span[data-icon='ptt']",
            "[aria-label*='voz']",
            "[aria-label*='Voice']",
            "[aria-label*='voice']"
          ].join(",")
        )
      );

      return { found: true, nativeVoiceEvidence, text };
    })
    .catch(() => ({ found: false, nativeVoiceEvidence: false, text: "evaluate-failed" }));
}

function parseDisplayDurationSecs(text: string) {
  const match = text.match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;

  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
  return minutes * 60 + seconds;
}

async function sendVoice(page: Page, options: CliOptions, audio: PreparedAudio): Promise<SendResult> {
  await page.goto(`${options.waUrl}/send?phone=${encodeURIComponent(options.targetPhone)}`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000
  });
  await waitForChatReady(page);
  await setVoicePayload(page, audio.fixturePath);

  await saveScreenshot(page, `${audio.label}-01-before-mic`);

  const micButton = await firstVisibleLocator("mic button", [
    page.getByRole("button", { name: /mensagem de voz|voice message|record voice|gravar mensagem/i }).last(),
    page.locator("button[aria-label*='voz'], button[aria-label*='Voice'], button:has(span[data-icon='ptt'])").last()
  ]);
  await micButton.click({ force: true });

  await waitForInjectionConsumed(page);
  const recordingStartedAt = Date.now();
  await page.waitForTimeout(500);
  await saveScreenshot(page, `${audio.label}-02-recording`);

  const hasRecordingUi = await page
    .locator(
      "button[aria-label='Pausar'], button[aria-label='Pause'], span[data-icon='audio-cancel'], span[data-icon='delete'], [data-testid='ptt-cancel']"
    )
    .first()
    .isVisible()
    .catch(() => false);

  if (!hasRecordingUi) {
    console.warn(`${audio.label}: recording UI not detected; continuing because getUserMedia payload was consumed`);
  }

  const targetRecordingMs = Math.round(audio.ffprobe.seconds * 1000) + 250;
  const elapsedRecordingMs = Date.now() - recordingStartedAt;
  await page.waitForTimeout(Math.max(0, targetRecordingMs - elapsedRecordingMs));
  await saveScreenshot(page, `${audio.label}-03-before-send`);

  const sendButton = await firstVisibleLocator("send button", [
    page.locator("button[aria-label*='Enviar'], button[aria-label*='Send']").last(),
    page.locator("span[data-icon='send'], div[role='button'][aria-label*='Enviar'], div[role='button'][aria-label*='Send']").last()
  ]);
  await sendButton.click({ force: true });

  const delivery = await pollDeliveryStatus(page);
  await saveScreenshot(page, `${audio.label}-04-after-send`);
  const bubble = await inspectLastOutgoingBubble(page);
  const displayDurationSecs = parseDisplayDurationSecs(bubble.text);
  const displayErrorMs = displayDurationSecs == null ? null : Math.abs(displayDurationSecs - audio.requestedDurationSecs) * 1000;

  return {
    label: audio.label,
    delivered: delivery.delivered,
    status: delivery.status,
    injectionConsumed: true,
    nativeVoiceEvidence: bubble.nativeVoiceEvidence,
    displayDurationSecs,
    displayErrorMs,
    bubbleText: bubble.text
  };
}

function validateSendGuard(options: CliOptions) {
  if (options.mode !== "send") return;
  if (!options.targetPhone) {
    throw new Error("TARGET_PHONE or --target is required in --send mode");
  }
  if (options.targetPhone !== ALLOWED_TARGET_PHONE) {
    throw new Error(
      `Blocked active WhatsApp send to ${options.targetPhone}. This spike only allows ${ALLOWED_TARGET_PHONE}.`
    );
  }
}

async function runSend(options: CliOptions, prepared: PreparedAudio[]) {
  validateSendGuard(options);

  let context: BrowserContext | null = null;
  try {
    const launched = await launchWhatsAppContext(options);
    context = launched.context;
    const page = launched.page;

    await installVoiceInitScript(page);
    await page.goto("about:blank");

    const results: SendResult[] = [];
    for (const audio of prepared) {
      console.log(`sending ${audio.label} to ${options.targetPhone}`);
      results.push(await sendVoice(page, options, audio));
    }

    await writeJson(path.join(PAYLOADS_DIR, "send-results.json"), {
      createdAt: new Date().toISOString(),
      targetPhone: options.targetPhone,
      results
    });

    console.log("send results:");
    for (const result of results) {
      console.log(
        `${result.label} | delivered=${result.delivered} | status=${result.status} | nativeVoiceEvidence=${result.nativeVoiceEvidence} | displayDurationSecs=${result.displayDurationSecs} | displayErrorMs=${result.displayErrorMs}`
      );
    }
  } finally {
    if (context && !options.keepBrowser) {
      await context.close().catch(() => null);
    }
  }
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const prepared = await preparePayloads(options.durations);

  printPreparedSummary(prepared);

  if (options.mode === "generate-only") {
    console.log("generated payloads only");
    return;
  }

  if (options.mode === "dry-run") {
    console.log("dry-run passed: WAV payloads are 48kHz mono 16-bit and ffprobe error is <=50ms");
    return;
  }

  await runSend(options, prepared);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
