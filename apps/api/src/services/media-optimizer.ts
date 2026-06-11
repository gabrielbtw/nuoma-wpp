import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import type { ApiEnv } from "@nuoma/config";
import type { MediaAssetType } from "@nuoma/contracts";

export interface OptimizeMediaInput {
  env: ApiEnv;
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  type: MediaAssetType;
}

export interface OptimizeMediaResult {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  optimization: {
    attempted: boolean;
    applied: boolean;
    tool: string | null;
    reason: string | null;
    originalSizeBytes: number;
    outputSizeBytes: number;
  };
}

export async function optimizeMediaForStorage(
  input: OptimizeMediaInput,
): Promise<OptimizeMediaResult> {
  const base = original(input);
  if (!input.env.API_MEDIA_OPTIMIZATION_ENABLED) {
    return withReason(base, "disabled");
  }
  if (input.type === "document" || input.type === "voice") {
    return withReason(base, "type_not_optimized");
  }

  const plan = optimizationPlan(input);
  if (!plan) {
    return withReason(base, "mime_not_supported");
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nuoma-media-opt-"));
  const inputPath = path.join(tempDir, `input${safeExtension(input.fileName) || ".bin"}`);
  const outputPath = path.join(tempDir, `output${plan.extension}`);
  try {
    await fs.writeFile(inputPath, input.buffer);
    const run = await runProcess(input.env.API_MEDIA_OPTIMIZATION_FFMPEG_BIN, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      inputPath,
      ...plan.args,
      outputPath,
    ]);

    if (run.exitCode !== 0) {
      if (input.env.API_MEDIA_OPTIMIZATION_STRICT) {
        throw new Error(`media optimization failed: ${run.stderr || `exit ${run.exitCode}`}`);
      }
      return withReason(base, `tool_failed:${run.exitCode}`);
    }

    const output = await fs.readFile(outputPath);
    if (output.length <= 0) {
      return withReason(base, "empty_output");
    }
    if (output.length >= input.buffer.length) {
      return withReason(base, "not_smaller");
    }

    return {
      buffer: output,
      fileName: replaceExtension(input.fileName, plan.extension),
      mimeType: plan.mimeType,
      optimization: {
        attempted: true,
        applied: true,
        tool: "ffmpeg",
        reason: null,
        originalSizeBytes: input.buffer.length,
        outputSizeBytes: output.length,
      },
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function original(input: OptimizeMediaInput): OptimizeMediaResult {
  return {
    buffer: input.buffer,
    fileName: input.fileName || "upload.bin",
    mimeType: input.mimeType || "application/octet-stream",
    optimization: {
      attempted: false,
      applied: false,
      tool: null,
      reason: null,
      originalSizeBytes: input.buffer.length,
      outputSizeBytes: input.buffer.length,
    },
  };
}

function withReason(result: OptimizeMediaResult, reason: string): OptimizeMediaResult {
  return {
    ...result,
    optimization: {
      ...result.optimization,
      attempted:
        reason !== "disabled" && reason !== "type_not_optimized" && reason !== "mime_not_supported",
      reason,
    },
  };
}

function optimizationPlan(
  input: OptimizeMediaInput,
): { extension: string; mimeType: string; args: string[] } | null {
  if (input.type === "image" && input.mimeType.startsWith("image/")) {
    return {
      extension: ".jpg",
      mimeType: "image/jpeg",
      args: [
        "-vf",
        `scale='min(iw,${input.env.API_MEDIA_OPTIMIZATION_IMAGE_MAX_WIDTH})':-2`,
        "-q:v",
        "4",
        "-frames:v",
        "1",
      ],
    };
  }
  if (input.type === "audio" && input.mimeType.startsWith("audio/")) {
    return {
      extension: ".ogg",
      mimeType: "audio/ogg",
      args: ["-vn", "-c:a", "libopus", "-b:a", `${input.env.API_MEDIA_OPTIMIZATION_AUDIO_KBPS}k`],
    };
  }
  if (input.type === "video" && input.mimeType.startsWith("video/")) {
    return {
      extension: ".mp4",
      mimeType: "video/mp4",
      args: [
        "-vf",
        `scale='min(iw,${input.env.API_MEDIA_OPTIMIZATION_VIDEO_MAX_WIDTH})':-2`,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-b:v",
        `${input.env.API_MEDIA_OPTIMIZATION_VIDEO_KBPS}k`,
        "-c:a",
        "aac",
        "-b:a",
        "96k",
        "-movflags",
        "+faststart",
      ],
    };
  }
  return null;
}

function runProcess(
  command: string,
  args: string[],
): Promise<{ exitCode: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      resolve({ exitCode: 127, stderr: error.message });
    });
    child.on("close", (code) => {
      resolve({ exitCode: code ?? 1, stderr });
    });
  });
}

function replaceExtension(fileName: string, extension: string): string {
  const parsed = path.parse(fileName || "upload");
  return `${parsed.name || "upload"}${extension}`;
}

function safeExtension(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase();
  return /^[a-z0-9.]{1,16}$/.test(extension) ? extension : "";
}
