import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const pttSampleRate = 16_000;
const pttChannels = 1;
const pttCodec = "opus";
const pttBitrate = "32k";
const pttMimeType = "audio/ogg; codecs=opus";

export interface PreparedVoiceAudio {
  sourcePath: string;
  pttPath: string;
  mimeType: string;
  codec: string;
  bitrate: string;
  durationSecs: number;
  durationSource: string;
  sha256: string;
  sizeBytes: number;
  sampleRate: number;
  channels: number;
}

export async function prepareVoiceAudio(input: {
  audioPath: string;
  tempDir: string;
}): Promise<PreparedVoiceAudio> {
  const sourcePath = path.resolve(input.audioPath);
  const duration = await probeDuration(sourcePath);
  const pttPath = await ensureOggOpus16kMono({
    sourcePath,
    tempDir: input.tempDir,
  });
  const pttBuffer = await fs.readFile(pttPath);
  inspectOggOpus(await probeAudioStream(pttPath));
  return {
    sourcePath,
    pttPath,
    mimeType: pttMimeType,
    codec: pttCodec,
    bitrate: pttBitrate,
    durationSecs: duration.seconds,
    durationSource: duration.source,
    sha256: createHash("sha256").update(pttBuffer).digest("hex"),
    sizeBytes: pttBuffer.byteLength,
    sampleRate: pttSampleRate,
    channels: pttChannels,
  };
}

async function ensureOggOpus16kMono(input: {
  sourcePath: string;
  tempDir: string;
}): Promise<string> {
  await fs.mkdir(input.tempDir, { recursive: true });
  const pttPath = path.join(
    input.tempDir,
    `voice-${Date.now()}-${Math.random().toString(16).slice(2)}.ogg`,
  );
  const ffmpegCandidates = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "ffmpeg"];
  for (const ffmpegBin of ffmpegCandidates) {
    try {
      await execFileAsync(
        ffmpegBin,
        [
          "-y",
          "-i",
          input.sourcePath,
          "-vn",
          "-map",
          "0:a:0",
          "-c:a",
          "libopus",
          "-b:a",
          pttBitrate,
          "-vbr",
          "on",
          "-compression_level",
          "10",
          "-ar",
          String(pttSampleRate),
          "-ac",
          String(pttChannels),
          "-application",
          "voip",
          pttPath,
        ],
        { timeout: 30_000 },
      );
      inspectOggOpus(await probeAudioStream(pttPath));
      return pttPath;
    } catch {
      // Try the next converter.
    }
  }

  throw new Error(`Could not convert voice audio to OGG/Opus 16kHz mono: ${input.sourcePath}`);
}

async function probeDuration(audioPath: string): Promise<{ source: string; seconds: number }> {
  const ffprobeCandidates = ["/opt/homebrew/bin/ffprobe", "/usr/local/bin/ffprobe", "ffprobe"];
  for (const ffprobeBin of ffprobeCandidates) {
    try {
      const { stdout } = await execFileAsync(
        ffprobeBin,
        ["-i", audioPath, "-show_entries", "format=duration", "-v", "quiet", "-of", "csv=p=0"],
        { timeout: 10_000 },
      );
      const seconds = Number.parseFloat(stdout.trim());
      if (Number.isFinite(seconds) && seconds > 0) {
        return { source: ffprobeBin, seconds };
      }
    } catch {
      // Try the next duration probe.
    }
  }

  try {
    const { stdout } = await execFileAsync("afinfo", [audioPath], { timeout: 10_000 });
    const match = stdout.match(/estimated duration:\s*([\d.]+)/i);
    const seconds = Number.parseFloat(match?.[1] ?? "");
    if (Number.isFinite(seconds) && seconds > 0) {
      return { source: "afinfo", seconds };
    }
  } catch {
    // No macOS fallback available.
  }

  try {
    const wav = inspectPcmWav(await fs.readFile(audioPath));
    const seconds = wav.dataBytes / (wav.sampleRate * wav.channels * (wav.bitsPerSample / 8));
    if (Number.isFinite(seconds) && seconds > 0) {
      return { source: "wav-header", seconds };
    }
  } catch {
    // Not a readable PCM WAV; duration still unknown.
  }

  throw new Error(`Could not detect voice audio duration: ${audioPath}`);
}

async function probeAudioStream(audioPath: string): Promise<{
  codecName: string;
  channels: number;
}> {
  const ffprobeCandidates = ["/opt/homebrew/bin/ffprobe", "/usr/local/bin/ffprobe", "ffprobe"];
  for (const ffprobeBin of ffprobeCandidates) {
    try {
      const { stdout } = await execFileAsync(
        ffprobeBin,
        [
          "-v",
          "error",
          "-select_streams",
          "a:0",
          "-show_entries",
          "stream=codec_name,channels",
          "-of",
          "json",
          audioPath,
        ],
        { timeout: 10_000 },
      );
      const parsed = JSON.parse(stdout) as {
        streams?: Array<{ codec_name?: string; channels?: number }>;
      };
      const stream = parsed.streams?.[0];
      if (stream?.codec_name && typeof stream.channels === "number") {
        return {
          codecName: stream.codec_name,
          channels: stream.channels,
        };
      }
    } catch {
      // Try the next probe.
    }
  }
  throw new Error(`Could not inspect voice audio stream: ${audioPath}`);
}

function inspectOggOpus(stream: { codecName: string; channels: number }): void {
  if (stream.codecName !== pttCodec || stream.channels !== pttChannels) {
    throw new Error(
      `Invalid PTT audio format: expected ${pttCodec} ${pttSampleRate}Hz ${pttChannels}ch, got ${stream.codecName} ${stream.channels}ch`,
    );
  }
}

function inspectPcmWav(buffer: Buffer): {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataBytes: number;
} {
  if (buffer.byteLength < 44) {
    throw new Error(`Invalid WAV: buffer too small (${buffer.byteLength} bytes)`);
  }
  const riff = buffer.toString("ascii", 0, 4);
  const wave = buffer.toString("ascii", 8, 12);
  const fmt = buffer.toString("ascii", 12, 16);
  const audioFormat = buffer.readUInt16LE(20);
  const wavChannels = buffer.readUInt16LE(22);
  const wavSampleRate = buffer.readUInt32LE(24);
  const wavBitsPerSample = buffer.readUInt16LE(34);
  if (riff !== "RIFF" || wave !== "WAVE" || fmt !== "fmt ") {
    throw new Error("Invalid WAV: expected RIFF/WAVE/fmt chunks");
  }
  const dataBytes = getWavDataBytes(buffer);
  if (!dataBytes) {
    throw new Error("Invalid WAV: expected data chunk");
  }
  if (audioFormat !== 1) {
    throw new Error(`Invalid WAV: expected PCM format 1, got ${audioFormat}`);
  }
  return {
    sampleRate: wavSampleRate,
    channels: wavChannels,
    bitsPerSample: wavBitsPerSample,
    dataBytes,
  };
}

function getWavDataBytes(buffer: Buffer): number | null {
  let offset = 12;
  while (offset + 8 <= buffer.byteLength) {
    const tag = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (tag === "data") {
      return size;
    }
    offset += 8 + size + (size % 2);
  }
  return null;
}
