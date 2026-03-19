import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((value) => {
    if (typeof value === "boolean") {
      return value;
    }

    return ["1", "true", "yes", "on"].includes(value.toLowerCase());
  });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_HOST: z.string().default("127.0.0.1"),
  APP_NAME: z.string().default("Nuoma WPP"),
  DATABASE_PATH: z.string().default("./storage/database/nuoma.db"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DEBUG_MODE: booleanish.default(false),
  LOG_DIR: z.string().default("./storage/logs"),
  UPLOADS_DIR: z.string().default("./storage/uploads"),
  MEDIA_DIR: z.string().default("./storage/media"),
  TEMP_DIR: z.string().default("./storage/temp"),
  SCREENSHOTS_DIR: z.string().default("./storage/screenshots"),
  CHROMIUM_PROFILE_DIR: z.string().default("./storage/chromium-profile/whatsapp"),
  IG_CHROMIUM_PROFILE_DIR: z.string().default("./storage/chromium-profile/instagram"),
  CHROMIUM_CHANNEL: z.enum(["chrome", "chromium", "msedge"]).default("chrome"),
  CHROMIUM_CDP_HOST: z.string().default("127.0.0.1"),
  CHROMIUM_CDP_PORT: z.coerce.number().int().min(1).max(65535).default(9222),
  CHROMIUM_HEADLESS: booleanish.default(false),
  PLAYWRIGHT_SLOW_MO: z.coerce.number().int().min(0).default(0),
  WEB_APP_URL: z.string().default(""),
  WEB_APP_OPEN_ON_STARTUP: booleanish.default(true),
  WA_URL: z.string().url().default("https://web.whatsapp.com"),
  IG_URL: z.string().url().default("https://www.instagram.com/direct/inbox/"),
  IG_USE_SHARED_BROWSER: booleanish.default(true),
  IG_OPEN_ON_STARTUP: booleanish.default(true),
  WA_SYNC_INTERVAL_SEC: z.coerce.number().int().min(10).default(45),
  IG_SYNC_INTERVAL_SEC: z.coerce.number().int().min(10).default(30),
  IG_ENABLE_INBOX_SYNC: booleanish.default(true),
  WA_SYNC_CHATS_LIMIT: z.coerce.number().int().min(1).max(20).default(6),
  WA_SYNC_MESSAGES_LIMIT: z.coerce.number().int().min(5).max(100).default(18),
  IG_SYNC_THREADS_LIMIT: z.coerce.number().int().min(1).max(50).default(10),
  IG_SYNC_MESSAGES_LIMIT: z.coerce.number().int().min(5).max(100).default(20),
  IG_ASSISTED_FIXTURE_PATH: z.string().default(""),
  WORKER_HEARTBEAT_SEC: z.coerce.number().int().min(5).default(20),
  WORKER_MAX_RSS_MB: z.coerce.number().int().min(128).default(700),
  SCHEDULER_INTERVAL_SEC: z.coerce.number().int().min(5).default(20),
  WATCHDOG_STALE_SECONDS: z.coerce.number().int().min(30).default(90),
  ENABLE_PM2_WATCHDOG: booleanish.default(false),
  ENABLE_CAMPAIGNS: booleanish.default(true),
  ENABLE_AUTOMATIONS: booleanish.default(true),
  ENABLE_POST_PROCEDURE: booleanish.default(true),
  ENABLE_UPLOADS: booleanish.default(true),
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(1024).default(200),
  DATA_LAKE_DIR: z.string().default("./storage/data-lake"),
  AI_PROVIDER: z.enum(["auto", "openai", "local"]).default("auto"),
  WHISPER_BIN: z.string().default("whisper-cli"),
  WHISPER_MODEL_PATH: z.string().default("./storage/models/whisper/ggml-base-q5_1.bin"),
  OLLAMA_HOST: z.string().default("http://127.0.0.1:11434"),
  OLLAMA_VISION_MODEL: z.string().default("gemma3:4b"),
  DEFAULT_TIMEZONE: z.string().default("America/Sao_Paulo"),
  DEFAULT_ATTENDANT: z.string().default("Operador Local"),
  SAVE_HTML_ON_CRITICAL_ERROR: booleanish.default(true),
  WORKER_FAILURE_THRESHOLD: z.coerce.number().int().min(1).max(20).default(3),
  OPENAI_API_KEY: z.string().default(""),
  OPENAI_TRANSCRIPTION_MODEL: z.string().default("gpt-4o-mini-transcribe"),
  OPENAI_VISION_MODEL: z.string().default("gpt-4.1-mini")
});

export type AppEnv = z.infer<typeof envSchema> & {
  PROJECT_ROOT: string;
  DATABASE_PATH: string;
  LOG_DIR: string;
  UPLOADS_DIR: string;
  MEDIA_DIR: string;
  TEMP_DIR: string;
  SCREENSHOTS_DIR: string;
  DATA_LAKE_DIR: string;
  WHISPER_MODEL_PATH: string;
  CHROMIUM_PROFILE_DIR: string;
  IG_CHROMIUM_PROFILE_DIR: string;
};

let cachedEnv: AppEnv | null = null;

function findProjectRoot(startDir: string): string {
  let currentDir = startDir;

  while (currentDir !== path.dirname(currentDir)) {
    const candidate = path.join(currentDir, "package.json");
    if (existsSync(candidate)) {
      try {
        const packageJson = JSON.parse(readFileSync(candidate, "utf8"));
        if (packageJson.workspaces) {
          return currentDir;
        }
      } catch {
        // Ignore malformed package.json while walking the tree.
      }
    }
    currentDir = path.dirname(currentDir);
  }

  return startDir;
}

function resolveProjectPath(root: string, target: string): string {
  return path.isAbsolute(target) ? target : path.resolve(root, target);
}

function parseDotEnvFile(filePath: string) {
  if (!existsSync(filePath)) {
    return {};
  }

  const lines = readFileSync(filePath, "utf8").split("\n");
  const values: Record<string, string> = {};

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "");
    values[key] = value;
  }

  return values;
}

export function loadEnv(overrides?: Partial<NodeJS.ProcessEnv>): AppEnv {
  if (cachedEnv && !overrides) {
    return cachedEnv;
  }

  const root = findProjectRoot(path.resolve(process.env.INIT_CWD || process.cwd()));
  const dotEnvValues = parseDotEnvFile(path.join(root, ".env"));

  const parsed = envSchema.parse({
    ...dotEnvValues,
    ...process.env,
    ...overrides
  });

  const resolvedEnv: AppEnv = {
    ...parsed,
    PROJECT_ROOT: root,
    DATABASE_PATH: resolveProjectPath(root, parsed.DATABASE_PATH),
    LOG_DIR: resolveProjectPath(root, parsed.LOG_DIR),
    UPLOADS_DIR: resolveProjectPath(root, parsed.UPLOADS_DIR),
    MEDIA_DIR: resolveProjectPath(root, parsed.MEDIA_DIR),
    TEMP_DIR: resolveProjectPath(root, parsed.TEMP_DIR),
    SCREENSHOTS_DIR: resolveProjectPath(root, parsed.SCREENSHOTS_DIR),
    DATA_LAKE_DIR: resolveProjectPath(root, parsed.DATA_LAKE_DIR),
    WHISPER_MODEL_PATH: resolveProjectPath(root, parsed.WHISPER_MODEL_PATH),
    CHROMIUM_PROFILE_DIR: resolveProjectPath(root, parsed.CHROMIUM_PROFILE_DIR),
    IG_CHROMIUM_PROFILE_DIR: resolveProjectPath(root, parsed.IG_CHROMIUM_PROFILE_DIR)
  };

  if (!overrides) {
    cachedEnv = resolvedEnv;
  }

  return resolvedEnv;
}
