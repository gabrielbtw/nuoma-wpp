import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { prepareVoiceAudio } from "./audio.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nuoma-v2-voice-"));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("voice audio preparation", () => {
  it("transcodes browser voice input to OGG/Opus PTT audio", async () => {
    const inputPath = path.join(tempDir, "voice-input.wav");
    await fs.writeFile(inputPath, createTestWav(1));

    const prepared = await prepareVoiceAudio({
      audioPath: inputPath,
      tempDir,
    });

    expect(prepared).toEqual(
      expect.objectContaining({
        sourcePath: inputPath,
        mimeType: "audio/ogg; codecs=opus",
        codec: "opus",
        bitrate: "32k",
        sampleRate: 16000,
        channels: 1,
      }),
    );
    expect(prepared.pttPath).toMatch(/\.ogg$/);
    expect(prepared.pttPath).not.toBe(inputPath);
    expect(prepared.durationSecs).toBeGreaterThan(0);
    expect(prepared.sizeBytes).toBeGreaterThan(0);
    expect(prepared.sha256).toMatch(/^[a-f0-9]{64}$/);
    const output = await fs.readFile(prepared.pttPath);
    expect(output.toString("ascii", 0, 4)).toBe("OggS");
  });
});

function createTestWav(durationSecs: number): Buffer {
  const sampleRate = 48_000;
  const channels = 1;
  const bytesPerSample = 2;
  const frameCount = Math.round(durationSecs * sampleRate);
  const dataSize = frameCount * channels * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  buffer.writeUInt16LE(channels * bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}
