---
name: wa-voice-regression
description: Run Spike 3 — port V1 voice recording (Web Audio API + ffprobe + WAV 48kHz) literally to V2 environment (Node 22 + Playwright + Docker + Xvfb), validate that audio arrives in WhatsApp as native voice message, duration matches, payload byte-snapshot matches V1. IC-1 invariant check.
user_invocable: true
---

# /wa-voice-regression — Audio (IC-1) port validation

You are running **Spike 3** from [`docs/architecture/V2_SPIKES.md`](../../docs/architecture/V2_SPIKES.md). Goal: prove the V1 voice recording implementation works literally in a V2-like environment, delivering native WhatsApp voice messages with exact duration and byte-equivalent payload.

This is **IC-1 (Invariant Constraint 1)** from [`docs/adr/0010-preserve-v1-audio-and-multistep-sender.md`](../../docs/adr/0010-preserve-v1-audio-and-multistep-sender.md). User declared: "audio is PERFECT — do not regress".

## Boundaries

- **Port literal, do NOT refactor**. Copy code from V1, adapt only paths.
- **Use a test phone number**, never the production number.
- **Run in Docker container** simulating V2 production environment.
- **NEVER claim success unless 3 audios (3s, 30s, 2min) all arrive as native voice messages with correct duration**.

## Workflow

### 1. Identify V1 implementation source

V1 voice code lives in [`apps/wa-worker/src/worker.ts`](../../apps/wa-worker/src/worker.ts) around line 1474+. Functions to study:

- `sendVoiceRecording()` — the main entry point.
- `addInitScript` injection that overrides `MediaRecorder` / `AudioContext`.
- ffprobe call for duration.
- WAV encoding (header + samples).

Also read commits `25c075c`, `73d4322`, `910615f`, `f344094` for context.

### 2. Setup spike playground

```bash
mkdir -p experiments/spike-3-voice
cd experiments/spike-3-voice
```

Files:
- `Dockerfile` — Node 22 + Playwright + Chromium + Xvfb + ffprobe.
- `package.json` — deps: `playwright`, `@types/node`.
- `voice-impl.ts` — copied literal from V1.
- `run-test.ts` — orchestrates 3 audio sends.
- `payloads/` — captured payload snapshots.

### 3. Dockerfile minimum

```dockerfile
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y \
    ffmpeg \
    xvfb \
    chromium \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json .
RUN npm install
RUN npx playwright install chromium

COPY . .

CMD ["sh", "-c", "Xvfb :99 -screen 0 1366x768x24 & DISPLAY=:99 npx tsx run-test.ts"]
```

### 4. Capture V1 baseline first

Before V2 spike, capture V1 baseline:

- Run V1 (existing dev environment).
- Send 1 audio of 30s to test phone.
- Capture the final `MediaSource` payload via Playwright `page.on("request")` interceptor.
- Save as `payloads/v1-baseline-30s.bin`.
- Save WAV header bytes (first 44 bytes) separately as `payloads/v1-header.txt`.

### 5. V2 spike implementation

Port the voice code as-is. Test sends:

```ts
// run-test.ts
import { chromium } from "playwright";
import { sendVoiceRecording } from "./voice-impl";

const TEST_PHONE = process.env.TEST_PHONE!; // owner's secondary chip number

const browser = await chromium.launchPersistentContext("/data/profile-spike", {
  headless: false,
  args: ["--remote-debugging-port=9222", "--no-sandbox"],
});
const page = browser.pages()[0] ?? await browser.newPage();

await page.goto("https://web.whatsapp.com");
// Wait for #pane-side or QR scan
await page.waitForSelector("#pane-side", { timeout: 60_000 });

for (const duration of [3, 30, 120]) {
  console.log(`Sending audio of ${duration}s...`);
  const audioBuffer = generateSineAudio(duration); // pure tone, predictable duration
  const result = await sendVoiceRecording(page, TEST_PHONE, audioBuffer);
  console.log(`Result:`, result);

  // Wait for visual confirmation in WPP
  await page.waitForSelector(`[data-id*="false"]`, { timeout: 10_000 });

  // Capture payload via interceptor
  // Save to payloads/v2-${duration}s.bin
}
```

### 6. Validation

For each duration:

1. **Visual check**: open WhatsApp on the test phone. Audio shows up as **voice message** (waveform UI), not as **audio attachment** (file icon + filename). If file icon: ❌ FAIL.
2. **Duration check**: WhatsApp displays duration label. Compare to expected (3s, 30s, 2min). Tolerance: ±50ms.
3. **Payload byte check**: compare V2 payload bytes vs V1 baseline (use `diff` on hex dumps). Header should match exactly. Sample data may differ (different generated audio) but format markers (chunk IDs, sample rate, bit depth) must match.

### 7. REPORT.md

```md
# Spike 3 Report — Voice Recording (IC-1)

## Summary
- Verde / Amarelo / Vermelho

## Visual confirmation
| Duration | WPP renders as | Pass |
|---|---|---|
| 3s | voice / attachment | ✓/✗ |
| 30s | voice / attachment | ✓/✗ |
| 2min | voice / attachment | ✓/✗ |

## Duration accuracy
| Expected | Reported | Delta |
|---|---|---|
| 3.000s | 3.001s | +1ms ✓ |
| ... | ... | ... |

## Payload comparison
- Header bytes V2 vs V1: diff (binary)
- Sample rate: 48000 ✓/✗
- Bit depth: 16 ✓/✗
- Chunks: RIFF + fmt + data ✓/✗

## Decision
- Verde → aprova ADR 0010, V2.5.21 entra no roadmap real.
- Amarelo → investigar ffprobe binário no container.
- Vermelho → BLOQUEADOR ABSOLUTO. V2 hosted não pode prosseguir sem audio.
```

## Anti-patterns

- DON'T modify `voice-impl.ts` to "make it cleaner". Port LITERAL.
- DON'T test with production phone number.
- DON'T accept "it sounds OK" — must be voice message UI in WhatsApp.
- DON'T skip the byte-level payload comparison.
- DON'T assume Docker = production; if container doesn't replicate Lightsail config, the spike means nothing.

## Reference files

- [`docs/architecture/V2_SPIKES.md`](../../docs/architecture/V2_SPIKES.md) (Spike 3 spec)
- [`docs/adr/0010-preserve-v1-audio-and-multistep-sender.md`](../../docs/adr/0010-preserve-v1-audio-and-multistep-sender.md) (IC-1 contract)
- V1 source: [`apps/wa-worker/src/worker.ts:1474+`](../../apps/wa-worker/src/worker.ts)
- Commits: `25c075c`, `73d4322`, `910615f`, `f344094`.

## When to invoke

User says: "validar áudio V2", "spike voice", "testar regressão de áudio", "IC-1 check", "porta áudio do V1 em container".
