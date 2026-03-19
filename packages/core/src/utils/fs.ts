import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { loadEnv } from "../config/env.js";

export function ensureDir(target: string) {
  if (!existsSync(target)) {
    mkdirSync(target, { recursive: true });
  }
}

export function ensureRuntimeDirectories() {
  const env = loadEnv();
  [
    path.dirname(env.DATABASE_PATH),
    env.LOG_DIR,
    env.UPLOADS_DIR,
    env.MEDIA_DIR,
    env.TEMP_DIR,
    env.SCREENSHOTS_DIR,
    env.DATA_LAKE_DIR,
    path.join(env.DATA_LAKE_DIR, "raw"),
    path.dirname(env.WHISPER_MODEL_PATH),
    env.CHROMIUM_PROFILE_DIR,
    env.IG_CHROMIUM_PROFILE_DIR
  ].forEach(ensureDir);
}

export function resolveStoragePath(...segments: string[]) {
  const env = loadEnv();
  return path.join(env.PROJECT_ROOT, ...segments);
}
