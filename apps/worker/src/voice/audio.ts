import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const sampleRate = 48_000;
const channels = 1;
const bitDepth = 16;

export interface PreparedVoiceAudio {
  sourcePath: string;
  wavPath: string;
  durationSecs: number;
  durationSource: string;
  sha256: string;
  sizeBytes: number;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
}

export async function prepareVoiceAudio(input: {
  audioPath: string;
  tempDir: string;
}): Promise<PreparedVoiceAudio> {
  const sourcePath = path.resolve(input.audioPath);
  const duration = await probeDuration(sourcePath);
  const wavPath = await ensureWav48kMono({
    sourcePath,
    tempDir: input.tempDir,
  });
  const wavBuffer = await fs.readFile(wavPath);
  const wav = inspectWav(wavBuffer);
  return {
    sourcePath,
    wavPath,
    durationSecs: duration.seconds,
    durationSource: duration.source,
    sha256: createHash("sha256").update(wavBuffer).digest("hex"),
    sizeBytes: wavBuffer.byteLength,
    sampleRate: wav.sampleRate,
    channels: wav.channels,
    bitsPerSample: wav.bitsPerSample,
  };
}

async function ensureWav48kMono(input: { sourcePath: string; tempDir: string }): Promise<string> {
  const ext = path.extname(input.sourcePath).toLowerCase();
  if (ext === ".wav") {
    const wav = inspectWav(await fs.readFile(input.sourcePath));
    if (wav.sampleRate === sampleRate && wav.channels === channels && wav.bitsPerSample === bitDepth) {
      return input.sourcePath;
    }
  }

  await fs.mkdir(input.tempDir, { recursive: true });
  const wavPath = path.join(input.tempDir, `voice-${Date.now()}-${Math.random().toString(16).slice(2)}.wav`);
  const ffmpegCandidates = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "ffmpeg"];
  for (const ffmpegBin of ffmpegCandidates) {
    try {
      await execFileAsync(
        ffmpegBin,
        ["-y", "-i", input.sourcePath, "-ar", String(sampleRate), "-ac", String(channels), wavPath],
        { timeout: 30_000 },
      );
      inspectWav(await fs.readFile(wavPath));
      return wavPath;
    } catch {
      // Try the next converter.
    }
  }

  try {
    await execFileAsync("afconvert", [
      "-f",
      "WAVE",
      "-d",
      "LEI16@48000",
      "-c",
      "1",
      input.sourcePath,
      wavPath,
    ]);
    inspectWav(await fs.readFile(wavPath));
    return wavPath;
  } catch {
    throw new Error(`Could not convert voice audio to 48kHz mono WAV: ${input.sourcePath}`);
  }
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
    const wav = inspectWav(await fs.readFile(audioPath));
    const seconds = wav.dataBytes / (wav.sampleRate * wav.channels * (wav.bitsPerSample / 8));
    if (Number.isFinite(seconds) && seconds > 0) {
      return { source: "wav-header", seconds };
    }
  } catch {
    // Not a readable PCM WAV; duration still unknown.
  }

  throw new Error(`Could not detect voice audio duration: ${audioPath}`);
}

function inspectWav(buffer: Buffer): {
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
  if (wavSampleRate !== sampleRate || wavChannels !== channels || wavBitsPerSample !== bitDepth) {
    throw new Error(
      `Invalid WAV format: expected ${sampleRate}Hz ${channels}ch ${bitDepth}-bit, got ${wavSampleRate}Hz ${wavChannels}ch ${wavBitsPerSample}-bit`,
    );
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
